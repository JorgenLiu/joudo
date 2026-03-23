import type {
  ApprovalType,
  CopilotAuthState,
  RepoDescriptor,
  SessionSummary,
  SessionSummaryStep,
  SessionSummaryStepKind,
  SessionTimelineEntry,
} from "@joudo/shared";

import type { LoadedRepoPolicy } from "../policy/index.js";

type SummaryStepStatus = SessionSummaryStep["status"];

type SummaryStepInput = {
  prompt?: string;
  timeline?: SessionTimelineEntry[];
  assistantMessage?: string;
  errorMessage?: string;
  executedCommands?: string[];
  changedFiles?: string[];
  status: SummaryStepStatus;
};

function latestTimelineEntry(timeline: SessionTimelineEntry[], kind: SessionTimelineEntry["kind"]) {
  return timeline.find((entry) => entry.kind === kind) ?? null;
}

function summaryStepStatusForTimelineEntry(entry: SessionTimelineEntry): SummaryStepStatus {
  switch (entry.kind) {
    case "approval-requested":
      return "blocked";
    case "error":
      return "failed";
    default:
      return "completed";
  }
}

function summaryStepKindForTimelineEntry(entry: SessionTimelineEntry): SessionSummaryStepKind {
  switch (entry.kind) {
    case "prompt":
      return "prompt";
    case "assistant":
      return "assistant";
    case "approval-requested":
    case "approval-resolved":
      return "approval";
    case "error":
      return "error";
    case "status":
    default:
      return "status";
  }
}

function uniqueSummarySteps(steps: SessionSummaryStep[]): SessionSummaryStep[] {
  const seen = new Set<string>();

  return steps.filter((step) => {
    const key = `${step.kind}:${step.title}:${step.detail}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function createSummarySteps(input: SummaryStepInput): SessionSummaryStep[] {
  const steps: SessionSummaryStep[] = [];
  const timeline = input.timeline ?? [];
  const latestApprovalRequest = latestTimelineEntry(timeline, "approval-requested");
  const latestApprovalResolution = latestTimelineEntry(timeline, "approval-resolved");
  const latestStatus = latestTimelineEntry(timeline, "status");
  const latestTimelineError = latestTimelineEntry(timeline, "error");

  if (input.prompt && !steps.some((step) => step.kind === "prompt" && step.detail === input.prompt)) {
    steps.unshift({
      id: `prompt-${input.prompt}`,
      kind: "prompt",
      status: input.status === "failed" ? "completed" : input.status,
      title: "已发送提示词",
      detail: input.prompt,
    });
  }

  const relevantApproval = latestApprovalRequest ?? latestApprovalResolution;
  if (relevantApproval) {
    steps.push({
      id: `approval-${relevantApproval.id}`,
      kind: "approval",
      status: summaryStepStatusForTimelineEntry(relevantApproval),
      title: relevantApproval.title,
      detail: relevantApproval.body,
      timestamp: relevantApproval.timestamp,
    });
  }

  if (input.assistantMessage && !steps.some((step) => step.kind === "assistant" && step.detail === input.assistantMessage)) {
    steps.push({
      id: `assistant-${input.assistantMessage}`,
      kind: "assistant",
      status: input.status === "blocked" ? "blocked" : input.status === "running" ? "running" : "completed",
      title: input.status === "running" ? "Copilot 正在返回结果" : "Copilot 已返回结果",
      detail: input.assistantMessage,
    });
  }

  const effectiveErrorMessage = input.errorMessage ?? latestTimelineError?.body;
  if (effectiveErrorMessage && !steps.some((step) => step.kind === "error" && step.detail === effectiveErrorMessage)) {
    steps.push({
      id: `error-${latestTimelineError?.id ?? effectiveErrorMessage}`,
      kind: "error",
      status: "failed",
      title: "本轮执行失败",
      detail: effectiveErrorMessage,
      ...(latestTimelineError ? { timestamp: latestTimelineError.timestamp } : {}),
    });
  }

  if ((input.executedCommands ?? []).length > 0) {
    steps.push({
      id: `commands-${(input.executedCommands ?? []).join("|")}`,
      kind: "command",
      status: input.status === "failed" ? "failed" : "completed",
      title: `执行了 ${(input.executedCommands ?? []).length} 条命令`,
      detail: (input.executedCommands ?? []).join("\n"),
    });
  }

  if ((input.changedFiles ?? []).length > 0) {
    steps.push({
      id: `files-${(input.changedFiles ?? []).join("|")}`,
      kind: "file-change",
      status: input.status === "failed" ? "failed" : "completed",
      title: `产生了 ${(input.changedFiles ?? []).length} 项文件变更`,
      detail: (input.changedFiles ?? []).join("\n"),
    });
  }

  const shouldIncludeStatus =
    Boolean(latestStatus) &&
    !steps.some((step) => step.kind === "assistant") &&
    !steps.some((step) => step.kind === "approval") &&
    !steps.some((step) => step.kind === "error");

  if (latestStatus && shouldIncludeStatus) {
    steps.push({
      id: `status-${latestStatus.id}`,
      kind: summaryStepKindForTimelineEntry(latestStatus),
      status: summaryStepStatusForTimelineEntry(latestStatus),
      title: latestStatus.title,
      detail: latestStatus.body,
      timestamp: latestStatus.timestamp,
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: `status-${input.status}`,
      kind: "status",
      status: input.status,
      title: input.status === "running" ? "正在等待结果" : "当前还没有可展示的执行步骤",
      detail: input.status === "running" ? "真实 Copilot 会话已经开始处理当前任务。" : "发送提示词后，这里会显示本轮执行步骤。",
    });
  }

  return uniqueSummarySteps(steps);
}

function buildExecutionChecks(approvedCommands: string[], approvalTypes: ApprovalType[], changedFiles: string[]): string[] {
  const checks: string[] = [];

  checks.push("本轮已经形成可展示的执行结果");

  if (approvedCommands.length > 0) {
    checks.push(`已记录 ${approvedCommands.length} 条获批执行`);
  }

  if (approvalTypes.length > 0) {
    checks.push(`已记录 ${approvalTypes.length} 类获批权限`);
  }

  if (changedFiles.length > 0) {
    checks.push(`已记录 ${changedFiles.length} 项文件变更`);
  } else {
    checks.push("当前摘要未记录文件变更");
  }

  return checks;
}

export function createPolicyRiskMessages(policy: LoadedRepoPolicy): string[] {
  if (policy.state === "missing") {
    return ["当前仓库缺少 repo policy 文件，bridge 会按保守默认值处理权限请求"];
  }

  if (policy.state === "invalid") {
    return [`当前仓库 policy 文件无效：${policy.error ?? "无法解析"}`];
  }

  return [];
}

export function createInitialSummary(repo: RepoDescriptor, policy: LoadedRepoPolicy): SessionSummary {
  return {
    title: "等待真实 ACP 会话",
    body: `${repo.name} 已经进入 Joudo 的受信任仓库列表。下一步会在这个仓库上启动真实 Copilot 会话。`,
    steps: createSummarySteps({ status: "completed" }),
    executedCommands: [],
    changedFiles: [],
    checks: [],
    risks: createPolicyRiskMessages(policy),
    nextAction:
      policy.state === "loaded"
        ? "发送提示词，验证真实 ACP 会话、审批流和网页摘要是否能闭环。"
        : "先发送提示词验证权限闭环，再尽快补上或修复 repo policy。",
  };
}

export function createQueuedSummary(prompt: string): SessionSummary {
  return {
    title: "提示词已入队",
    body: `真实 Copilot 会话正在处理这条提示词：${prompt}`,
    steps: createSummarySteps({ prompt, status: "running" }),
    executedCommands: [],
    changedFiles: [],
    checks: ["真实会话已接收这条提示词", "当前仍在等待本轮结果或审批"],
    risks: [],
    nextAction: "等待会话返回摘要，或处理中途发出的审批请求。",
  };
}

export function createAuthSummary(repo: RepoDescriptor, auth: CopilotAuthState, policy: LoadedRepoPolicy): SessionSummary {
  return {
    title: auth.status === "authenticated" ? "Copilot CLI 已就绪" : "Copilot CLI 尚未登录",
    body:
      auth.status === "authenticated"
        ? `已经可以在 ${repo.name} 上创建真实 ACP 会话。`
        : auth.message,
    steps: createSummarySteps({ status: auth.status === "authenticated" ? "completed" : "blocked" }),
    executedCommands: [],
    changedFiles: [],
    checks: [],
    risks:
      auth.status === "authenticated"
        ? createPolicyRiskMessages(policy)
        : ["未完成认证前，bridge 无法创建真实 Copilot 会话", ...createPolicyRiskMessages(policy)],
    nextAction:
      auth.status === "authenticated"
        ? "直接发送提示词开始真实会话。"
        : "先在终端完成 copilot login，再回到网页继续发送提示词。",
  };
}

export function createAssistantSummary(
  repo: RepoDescriptor,
  prompt: string,
  message: string,
  approvedCommands: string[],
  approvalTypes: ApprovalType[],
  changedFiles: string[],
  policy: LoadedRepoPolicy,
  timeline: SessionTimelineEntry[] = [],
): SessionSummary {
  return {
    title: "真实会话已返回结果",
    body: message,
    steps: createSummarySteps({
      prompt,
      timeline,
      assistantMessage: message,
      executedCommands: approvedCommands,
      changedFiles,
      status: "completed",
    }),
    executedCommands: approvedCommands,
    ...(approvalTypes.length > 0 ? { approvalTypes } : {}),
    changedFiles,
    checks: buildExecutionChecks(approvedCommands, approvalTypes, changedFiles),
    risks: createPolicyRiskMessages(policy),
    nextAction:
      changedFiles.length > 0
        ? `先检查这轮记录下来的文件变更，再决定是否继续围绕“${prompt}”推进下一步。`
        : policy.state === "loaded"
          ? `继续围绕“${prompt}”推进下一步，或补一轮明确验证。`
          : `继续围绕“${prompt}”推进下一步，或开始为 ${repo.name} 补充 repo policy。`,
  };
}

export function createErrorSummary(message: string): SessionSummary {
  return {
    title: "真实会话执行失败",
    body: message,
    steps: createSummarySteps({ errorMessage: message, status: "failed" }),
    executedCommands: [],
    changedFiles: [],
    checks: ["本轮没有形成可确认的完成结果"],
    risks: ["当前会话没有完成本轮任务，需要先排除 bridge 或认证问题"],
    nextAction: "检查 Copilot 登录状态、仓库权限和本轮 prompt 内容后再重试。",
  };
}

export function createTimeoutSummary(
  prompt: string,
  approvedCommands: string[],
  approvalTypes: ApprovalType[],
  policy: LoadedRepoPolicy,
  timeline: SessionTimelineEntry[] = [],
): SessionSummary {
  return {
    title: "本轮任务已超时",
    body: `围绕“${prompt}”的这轮真实会话超过了当前 15 分钟等待窗口。Joudo 已保留本轮摘要和时间线，但不会把它误判成已完成。`,
    steps: createSummarySteps({
      prompt,
      timeline,
      executedCommands: approvedCommands,
      status: "failed",
    }),
    executedCommands: approvedCommands,
    ...(approvalTypes.length > 0 ? { approvalTypes } : {}),
    changedFiles: [],
    checks:
      approvedCommands.length > 0
        ? [
            `超时前已记录 ${approvedCommands.length} 条获批执行`,
            ...(approvalTypes.length > 0 ? [`超时前已记录 ${approvalTypes.length} 类获批权限`] : []),
          ]
        : [
            "超时前没有记录到可确认的执行结果",
            ...(approvalTypes.length > 0 ? [`超时前已记录 ${approvalTypes.length} 类获批权限`] : []),
          ],
    risks: ["本轮任务在等待窗口内没有完成", ...createPolicyRiskMessages(policy)],
    nextAction: "检查当前摘要与时间线后，决定是重试当前任务，还是拆小后重新发起。",
  };
}

export function createSessionResetSummary(
  message: string,
  approvedCommands: string[],
  approvalTypes: ApprovalType[],
  policy: LoadedRepoPolicy,
  timeline: SessionTimelineEntry[] = [],
): SessionSummary {
  return {
    title: "真实会话已失效",
    body: `${message} bridge 会在下一条提示词到来时自动重建 ACP 会话。`,
    steps: createSummarySteps({
      timeline,
      errorMessage: message,
      executedCommands: approvedCommands,
      status: "failed",
    }),
    executedCommands: approvedCommands,
    ...(approvalTypes.length > 0 ? { approvalTypes } : {}),
    changedFiles: [],
    checks:
      approvedCommands.length > 0
        ? [
            `失效前已记录 ${approvedCommands.length} 条获批执行`,
            ...(approvalTypes.length > 0 ? [`失效前已记录 ${approvalTypes.length} 类获批权限`] : []),
          ]
        : [
            "当前这轮没有保留下可确认的执行结果",
            ...(approvalTypes.length > 0 ? [`失效前已记录 ${approvalTypes.length} 类获批权限`] : []),
          ],
    risks: ["当前 ACP 会话已经失效，本轮提示词需要重试", ...createPolicyRiskMessages(policy)],
    nextAction: "重新发送当前提示词，或继续下一条任务，bridge 会自动创建新会话。",
  };
}

export function createRollbackSummary(input: {
  message: string;
  changedFiles: string[];
  approvedCommands: string[];
  approvalTypes: ApprovalType[];
  policy: LoadedRepoPolicy;
  revertedToBaseline: boolean;
  executor: "copilot-undo" | "joudo-write-journal";
  timeline?: SessionTimelineEntry[];
}): SessionSummary {
  const checks = input.revertedToBaseline
    ? [
        input.executor === "joudo-write-journal"
          ? "工作区已按 Joudo 记录的基线恢复"
          : "工作区已回到上一轮开始前的基线",
      ]
    : [
        input.executor === "joudo-write-journal"
          ? "已按 Joudo 基线尝试恢复，但工作区还没完全回到上一轮基线"
          : "已执行 /undo，但工作区还没完全回到上一轮基线",
      ];

  return {
    title: input.revertedToBaseline ? "已撤回上一轮改动" : "已执行上一轮回退",
    body: input.message,
    steps: createSummarySteps({
      ...(input.timeline ? { timeline: input.timeline } : {}),
      executedCommands: input.approvedCommands,
      changedFiles: input.changedFiles,
      status: input.revertedToBaseline ? "completed" : "failed",
    }),
    executedCommands: input.approvedCommands,
    ...(input.approvalTypes.length > 0 ? { approvalTypes: input.approvalTypes } : {}),
    changedFiles: input.changedFiles,
    checks,
    risks: input.revertedToBaseline ? createPolicyRiskMessages(input.policy) : ["当前工作区仍与上一轮开始前的基线不同", ...createPolicyRiskMessages(input.policy)],
    nextAction: input.revertedToBaseline ? "确认摘要与时间线后继续下一轮。" : "先检查当前工作区差异，再决定是否继续回退。",
  };
}