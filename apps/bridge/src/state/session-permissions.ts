import type { ApprovalRequest, ApprovalType, PermissionAuditEntry, SessionStatus, SessionTimelineEntry } from "@joudo/shared";

import type { CopilotSession, PermissionRequest, PermissionRequestResult } from "../copilot-sdk.js";
import { evaluatePermissionRequest } from "../policy/index.js";
import type { PolicyDecision } from "../policy/index.js";
import { describePermission } from "./approvals.js";
import { createAuditEntry, decisionBody, getRequestTarget } from "./audit.js";
import { createPolicyRiskMessages, createSummarySteps } from "./summaries.js";
import type { InteractivePermissionRequestResult, RepoContext } from "./types.js";

type TimelineInput = Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string };

export type SessionPermissionOps = {
  refreshRepoPolicy: (context: RepoContext) => void;
  appendAuditEntry: (context: RepoContext, entry: PermissionAuditEntry) => void;
  updateAuditEntry: (context: RepoContext, auditId: string, update: Partial<PermissionAuditEntry>) => void;
  captureTurnWriteBaseline: (context: RepoContext, request: PermissionRequest) => Promise<void>;
  recordApprovedCommand: (context: RepoContext, request: PermissionRequest, fallbackPreview?: string) => void;
  recordApprovedApprovalType: (context: RepoContext, approvalType: ApprovalType) => void;
  pushTimelineEntry: (context: RepoContext, entry: TimelineInput) => void;
  touch: (context: RepoContext, nextStatus: SessionStatus) => void;
  queuePersistence: (context: RepoContext) => void;
  publishIfCurrent: (repoId: string) => void;
  emitApprovalRequested: (approval: ApprovalRequest) => void;
  onApprovalAdded?: (approvalId: string, repoId: string) => void;
};

function findPendingAuditId(context: RepoContext, request: PermissionRequest): string | null {
  const target = getRequestTarget(request);
  const pendingEntry = context.auditLog.find((entry) => entry.target === target && entry.resolution === "awaiting-user" && !entry.resolvedAt);
  return pendingEntry?.id ?? null;
}

function ensureAwaitingAuditEntry(
  context: RepoContext,
  request: PermissionRequest,
  decision: PolicyDecision,
  ops: SessionPermissionOps,
): string {
  const existingAuditId = findPendingAuditId(context, request);
  if (existingAuditId) {
    return existingAuditId;
  }

  const auditEntry = createAuditEntry(request, decision, "awaiting-user");
  ops.appendAuditEntry(context, auditEntry);
  return auditEntry.id;
}

async function resolveResumedPendingPermission(
  context: RepoContext,
  session: CopilotSession,
  requestId: string,
  request: PermissionRequest,
  decision: PolicyDecision,
  ops: SessionPermissionOps,
) {
  const approvalType = describePermission(request, decision, context.repo.rootPath).approvalType;

  if (decision.action === "allow") {
    const existingAuditId = findPendingAuditId(context, request);
    if (existingAuditId) {
      ops.updateAuditEntry(context, existingAuditId, {
        resolution: "auto-allowed",
        resolvedAt: new Date().toISOString(),
      });
    } else {
      ops.appendAuditEntry(context, createAuditEntry(request, decision, "auto-allowed"));
    }

    await ops.captureTurnWriteBaseline(context, request);
    ops.recordApprovedCommand(context, request, typeof request.kind === "string" ? request.kind : undefined);
    ops.recordApprovedApprovalType(context, approvalType);
    await session.rpc.permissions.handlePendingPermissionRequest({
      requestId,
      result: { kind: "approved" },
    });
    context.summary = {
      title: "恢复后已自动批准",
      body: decision.reason,
      steps: createSummarySteps({
        timeline: context.timeline,
        executedCommands: context.approvalState.approvedCommands,
        status: "completed",
      }),
      executedCommands: context.approvalState.approvedCommands,
      approvalTypes: context.approvalState.approvedApprovalTypes,
      changedFiles: [],
      checks: [],
      risks: createPolicyRiskMessages(context.policy),
      nextAction: "等待会话继续执行。",
    };
    ops.pushTimelineEntry(context, {
      kind: "approval-resolved",
      title: "恢复后已自动批准",
      body: decisionBody(getRequestTarget(request), decision),
      decision: {
        action: decision.action,
        resolution: "auto-allowed",
        approvalType,
        ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
      },
    });
    return;
  }

  if (decision.action === "deny") {
    const existingAuditId = findPendingAuditId(context, request);
    if (existingAuditId) {
      ops.updateAuditEntry(context, existingAuditId, {
        resolution: "auto-denied",
        resolvedAt: new Date().toISOString(),
      });
    } else {
      ops.appendAuditEntry(context, createAuditEntry(request, decision, "auto-denied"));
    }

    await session.rpc.permissions.handlePendingPermissionRequest({
      requestId,
      result: {
        kind: "denied-by-rules",
        rules: decision.rules,
      },
    });
    context.summary = {
      title: "恢复后已自动拒绝",
      body: decision.reason,
      steps: createSummarySteps({ timeline: context.timeline, status: "failed" }),
      executedCommands: context.approvalState.approvedCommands,
      approvalTypes: context.approvalState.approvedApprovalTypes,
      changedFiles: [],
      checks: [],
      risks: ["当前请求已被 Joudo policy 拒绝", ...createPolicyRiskMessages(context.policy)],
      nextAction: "等待 Copilot 根据拒绝结果调整计划，或重新发送 prompt。",
    };
    ops.pushTimelineEntry(context, {
      kind: "approval-resolved",
      title: "恢复后已自动拒绝",
      body: decisionBody(getRequestTarget(request), decision),
      decision: {
        action: decision.action,
        resolution: "auto-denied",
        approvalType,
        ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
      },
    });
    return;
  }

  if (context.approvalState.approvals.some((approval) => approval.commandPreview === getRequestTarget(request))) {
    return;
  }

  const auditId = ensureAwaitingAuditEntry(context, request, decision, ops);
  const approval = {
    ...describePermission(request, decision, context.repo.rootPath),
    id: requestId,
    requestedAt: new Date().toISOString(),
  };
  context.approvalState.approvals = [...context.approvalState.approvals.filter((item) => item.id !== requestId), approval];
  context.approvalState.pendingApprovals.set(requestId, {
    resolve: async (result: InteractivePermissionRequestResult) => {
      await session.rpc.permissions.handlePendingPermissionRequest({ requestId, result });
    },
    auditId,
    policyDecision: decision,
    request,
  });
  ops.onApprovalAdded?.(requestId, context.repo.id);
  context.summary = {
    title: "已恢复待审批状态",
    body: `Joudo 已接回历史 Copilot 会话，并检测到仍待处理的权限请求。${decision.reason}`,
    steps: createSummarySteps({ timeline: context.timeline, status: "blocked" }),
    executedCommands: context.approvalState.approvedCommands,
    approvalTypes: context.approvalState.approvedApprovalTypes,
    changedFiles: [],
    checks: [],
    risks: [`当前请求类型：${request.kind}`, ...createPolicyRiskMessages(context.policy)],
    nextAction: "在网页端批准或拒绝该请求，然后等待会话继续。",
  };
  ops.touch(context, "awaiting-approval");
}

export async function hydrateResumedSessionState(context: RepoContext, session: CopilotSession, ops: SessionPermissionOps) {
  const events = await session.getMessages();
  let lastUserPrompt: string | null = null;
  let lastAssistantMessage: string | null = null;
  const requestedPermissions = new Map<string, PermissionRequest>();
  const completedPermissions = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "user.message":
        lastUserPrompt = event.data.content;
        break;
      case "assistant.message":
        lastAssistantMessage = event.data.content;
        break;
      case "permission.requested":
        requestedPermissions.set(event.data.requestId, event.data.permissionRequest as PermissionRequest);
        break;
      case "permission.completed":
        completedPermissions.add(event.data.requestId);
        break;
      default:
        break;
    }
  }

  if (lastUserPrompt) {
    context.lastPrompt = lastUserPrompt;
  }

  if (lastAssistantMessage) {
    context.latestAssistantMessage = lastAssistantMessage;
  }

  context.approvalState.approvals = [];
  context.approvalState.pendingApprovals.clear();

  for (const [requestId, request] of requestedPermissions.entries()) {
    if (completedPermissions.has(requestId)) {
      continue;
    }

    const decision = evaluatePermissionRequest(context.policy, context.repo.rootPath, request);
    await resolveResumedPendingPermission(context, session, requestId, request, decision, ops);
  }

  const lastEvent = events.at(-1) ?? null;
  if (context.approvalState.approvals.length > 0) {
    ops.touch(context, "awaiting-approval");
    return;
  }

  if (lastEvent?.type === "user.message") {
    ops.touch(context, "running");
    return;
  }

  if (lastEvent?.type === "session.error") {
    ops.touch(context, "idle");
    return;
  }

  ops.touch(context, "idle");
}

export async function handlePermissionRequest(
  context: RepoContext,
  request: PermissionRequest,
  ops: SessionPermissionOps,
): Promise<PermissionRequestResult> {
  ops.refreshRepoPolicy(context);
  const decision = evaluatePermissionRequest(context.policy, context.repo.rootPath, request);
  const approval = describePermission(request, decision, context.repo.rootPath);

  if (decision.action === "allow") {
    await ops.captureTurnWriteBaseline(context, request);
    const auditEntry = createAuditEntry(request, decision, "auto-allowed");
    ops.appendAuditEntry(context, auditEntry);
    ops.recordApprovedCommand(context, request, typeof request.kind === "string" ? request.kind : undefined);
    ops.recordApprovedApprovalType(context, approval.approvalType);
    context.summary = {
      title: "策略已自动批准",
      body: decision.reason,
      steps: createSummarySteps({
        timeline: context.timeline,
        executedCommands: context.approvalState.approvedCommands,
        status: "completed",
      }),
      executedCommands: context.approvalState.approvedCommands,
      approvalTypes: context.approvalState.approvedApprovalTypes,
      changedFiles: [],
      checks: [],
      risks: createPolicyRiskMessages(context.policy),
      nextAction: "等待会话继续执行。",
    };
    ops.pushTimelineEntry(context, {
      kind: "approval-resolved",
      title: "策略已自动批准",
      body: decisionBody(auditEntry.target, decision),
      decision: {
        action: decision.action,
        resolution: auditEntry.resolution,
        approvalType: approval.approvalType,
        ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
      },
    });
    ops.touch(context, context.lifecycle.activePrompt ? "running" : "idle");
    ops.queuePersistence(context);
    ops.publishIfCurrent(context.repo.id);
    return { kind: "approved" };
  }

  if (decision.action === "deny") {
    const auditEntry = createAuditEntry(request, decision, "auto-denied");
    ops.appendAuditEntry(context, auditEntry);
    context.summary = {
      title: "策略已自动拒绝",
      body: decision.reason,
      steps: createSummarySteps({ timeline: context.timeline, status: "failed" }),
      executedCommands: context.approvalState.approvedCommands,
      approvalTypes: context.approvalState.approvedApprovalTypes,
      changedFiles: [],
      checks: [],
      risks: ["当前请求已被 Joudo policy 拒绝", ...createPolicyRiskMessages(context.policy)],
      nextAction: "等待 Copilot 根据拒绝结果调整计划，或修改 repo policy 后重试。",
    };
    ops.pushTimelineEntry(context, {
      kind: "approval-resolved",
      title: "策略已自动拒绝",
      body: decisionBody(auditEntry.target, decision),
      decision: {
        action: decision.action,
        resolution: auditEntry.resolution,
        approvalType: approval.approvalType,
        ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
      },
    });
    ops.touch(context, context.lifecycle.activePrompt ? "running" : "idle");
    ops.queuePersistence(context);
    ops.publishIfCurrent(context.repo.id);
    return {
      kind: "denied-by-rules",
      rules: decision.rules,
    };
  }

  const auditEntry = createAuditEntry(request, decision, "awaiting-user");
  ops.appendAuditEntry(context, auditEntry);
  context.approvalState.approvals = [...context.approvalState.approvals, approval];
  context.summary = {
    title: "等待真实权限审批",
    body: `Copilot 在 ${context.repo.name} 上发起了权限请求。${decision.reason}`,
    steps: createSummarySteps({ timeline: context.timeline, status: "blocked" }),
    executedCommands: context.approvalState.approvedCommands,
    approvalTypes: context.approvalState.approvedApprovalTypes,
    changedFiles: [],
    checks: [],
    risks: [`当前请求类型：${request.kind}`, ...createPolicyRiskMessages(context.policy)],
    nextAction: "在网页端批准或拒绝该请求，然后等待会话继续。",
  };
  ops.pushTimelineEntry(context, {
    kind: "approval-requested",
    title: approval.title,
    body: decisionBody(auditEntry.target, decision),
    decision: {
      action: decision.action,
      resolution: auditEntry.resolution,
      approvalType: approval.approvalType,
      ...(decision.matchedRule ? { matchedRule: decision.matchedRule } : {}),
    },
  });
  ops.touch(context, "awaiting-approval");
  ops.emitApprovalRequested(approval);
  ops.queuePersistence(context);
  ops.publishIfCurrent(context.repo.id);

  return new Promise<PermissionRequestResult>((resolve) => {
    context.approvalState.pendingApprovals.set(approval.id, {
      resolve: (result: InteractivePermissionRequestResult) => resolve(result),
      auditId: auditEntry.id,
      policyDecision: decision,
      request,
    });
    ops.onApprovalAdded?.(approval.id, context.repo.id);
  });
}