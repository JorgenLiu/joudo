import type {
  ActivityBlocker,
  ActivityCommandRecord,
  ActivityPhase,
  SessionActivity,
  SessionActivityItem,
  SessionStatus,
} from "@joudo/shared";

import type { RepoContext } from "./types.js";

const ACTIVITY_ITEM_LIMIT = 6;
const COMMAND_LIMIT = 5;

function phaseForStatus(status: SessionStatus, context: RepoContext): ActivityPhase {
  if (status === "awaiting-approval") {
    return "awaiting-approval";
  }

  if (status === "recovering") {
    return "recovering";
  }

  if (status === "timed-out") {
    return "timed-out";
  }

  if (status === "running") {
    const latestTitle = context.timeline[0]?.title ?? "";
    if (/验证|回归|检查|测试/.test(latestTitle)) {
      return "validating";
    }

    if (/写入|修改|更新|生成/.test(latestTitle)) {
      return "editing";
    }

    return context.approvalState.approvedCommands.length > 0 ? "editing" : "analyzing";
  }

  if (context.lastPrompt && context.latestAssistantMessage) {
    return "completed";
  }

  return context.lastPrompt ? "queued" : "idle";
}

function createHeadline(phase: ActivityPhase, context: RepoContext): { headline: string; detail: string } {
  switch (phase) {
    case "awaiting-approval":
      return {
        headline: "正在等待用户审批",
        detail: context.approvalState.approvals[0]?.whyNow ?? context.summary?.nextAction ?? "先处理当前审批，请求通过后会话才会继续。",
      };
    case "recovering":
      return {
        headline: "正在恢复历史记录",
        detail: context.summary?.body ?? "Joudo 正在恢复最近一次历史记录，或尝试接回旧会话。",
      };
    case "timed-out":
      return {
        headline: "上一轮任务已超时",
        detail: context.summary?.nextAction ?? "检查当前摘要与时间线后，决定是重试还是拆小任务后重试。",
      };
    case "completed":
      return {
        headline: "上一轮任务已收口",
        detail: context.summary?.body ?? context.latestAssistantMessage ?? "真实会话已经返回结果。",
      };
    case "editing":
      return {
        headline: "正在推进修改与执行",
        detail: context.summary?.nextAction ?? "Joudo 正在基于当前信息继续推进任务。",
      };
    case "validating":
      return {
        headline: "正在执行验证",
        detail: context.summary?.nextAction ?? "Joudo 正在验证当前修改是否符合预期。",
      };
    case "analyzing":
      return {
        headline: "正在分析当前任务",
        detail: context.summary?.body ?? "Joudo 正在整理仓库上下文并决定下一步动作。",
      };
    case "queued":
      return {
        headline: "提示词已入队",
        detail: context.summary?.body ?? "真实 Copilot 会话正在处理这条提示词。",
      };
    case "failed":
      return {
        headline: "当前任务执行失败",
        detail: context.summary?.body ?? "本轮任务没有完成，需要先确认失败原因。",
      };
    case "idle":
    default:
      return {
        headline: "等待下一步任务",
        detail: context.summary?.nextAction ?? "当前仓库已经就绪，等待新的提示词。",
      };
  }
}

function activityItems(context: RepoContext, phase: ActivityPhase): SessionActivityItem[] {
  const items: SessionActivityItem[] = [];

  if (context.turns.latestCompaction) {
    const latestCheckpoint =
      context.turns.latestCompaction.checkpointNumber === undefined
        ? null
        : context.turns.checkpoints.find((checkpoint) => checkpoint.number === context.turns.latestCompaction?.checkpointNumber) ?? null;
    const checkpointLabel = latestCheckpoint
      ? `checkpoint ${latestCheckpoint.number}: ${latestCheckpoint.title}`
      : context.turns.latestCompaction.checkpointNumber === undefined
        ? "最近一次会话压缩"
        : `checkpoint ${context.turns.latestCompaction.checkpointNumber}`;

    items.push({
      id: `checkpoint-${context.turns.latestCompaction.completedAt}`,
      kind: "note",
      status: "completed",
      title: "已生成会话 checkpoint",
      detail:
        context.turns.latestCompaction.summaryPreview ??
        `最近一次 compaction 已生成 ${checkpointLabel}，可作为后续恢复与历史浏览的锚点。`,
      timestamp: context.turns.latestCompaction.completedAt,
      phase,
      evidence: [{ source: "runtime" }],
    });
  }

  return [
    ...items,
    ...context.timeline.slice(0, ACTIVITY_ITEM_LIMIT - items.length).map(
      (entry): SessionActivityItem => ({
        id: entry.id,
        kind:
          entry.kind === "approval-requested"
            ? "approval"
            : entry.kind === "approval-resolved"
              ? "approval"
              : entry.kind === "error"
                ? "error"
                : entry.kind === "assistant"
                  ? "note"
                  : entry.kind === "prompt"
                    ? "phase"
                    : "note",
        status:
          entry.kind === "error"
            ? "failed"
            : entry.kind === "approval-requested"
              ? "blocked"
              : phase === "completed"
                ? "completed"
                : phase === "awaiting-approval"
                  ? "blocked"
                  : phase === "timed-out"
                    ? "failed"
                    : "running",
        title: entry.title,
        detail: entry.body,
        timestamp: entry.timestamp,
        phase,
        evidence: [{ source: "timeline", id: entry.id }],
      }),
    ),
  ];
}

function commandRecords(context: RepoContext): ActivityCommandRecord[] {
  return context.approvalState.approvedCommands.slice(-COMMAND_LIMIT).reverse().map((command, index) => ({
    id: `command-${index}-${command}`,
    command,
    status: context.status === "timed-out" ? "failed" : "completed",
    startedAt: context.updatedAt,
    ...(context.status === "timed-out" ? {} : { completedAt: context.updatedAt }),
    requestKind: "shell",
  }));
}

function blockers(context: RepoContext): ActivityBlocker[] {
  if (context.approvalState.approvals.length > 0) {
    return context.approvalState.approvals.map((approval) => ({
      kind: "approval",
      title: approval.title,
      detail: approval.whyNow ?? approval.rationale,
      nextAction: approval.fallbackIfDenied ?? "先处理当前审批，再继续这一轮任务。",
      relatedId: approval.id,
    }));
  }

  if (context.status === "timed-out") {
    return [
      {
        kind: "timeout",
        title: "本轮任务超过等待窗口",
        detail: context.summary?.body ?? "这轮任务没有在当前等待窗口内完成。",
        ...(context.summary?.nextAction ? { nextAction: context.summary.nextAction } : {}),
      },
    ];
  }

  const latestError = context.timeline.find((entry) => entry.kind === "error");
  if (latestError) {
    return [
      {
        kind: "error",
        title: latestError.title,
        detail: latestError.body,
        ...(context.summary?.nextAction ? { nextAction: context.summary.nextAction } : {}),
        relatedId: latestError.id,
      },
    ];
  }

  return [];
}

export function createSessionActivity(context: RepoContext | null): SessionActivity | null {
  if (!context) {
    return null;
  }

  const phase = phaseForStatus(context.status, context);
  const { headline, detail } = createHeadline(phase, context);

  return {
    phase,
    intent: context.lastPrompt,
    headline,
    detail,
    updatedAt: context.updatedAt,
    workspacePath: context.turns.workspacePath,
    items: activityItems(context, phase),
    commands: commandRecords(context),
    changedFiles: context.turns.latestTurn?.changedFiles ?? [],
    latestTurn: context.turns.latestTurn,
    rollback: context.turns.rollback,
    checkpoints: context.turns.checkpoints,
    latestCompaction: context.turns.latestCompaction,
    blockers: blockers(context),
  };
}