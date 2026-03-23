import type { HistoricalSessionRecoveryMode, SessionSummary } from "@joudo/shared";

import type { LoadedSessionSnapshot } from "./persistence.js";
import { createPolicyRiskMessages, createSummarySteps } from "./summaries.js";
import { deserializeTurnWriteJournal } from "./turn-write-journal.js";
import type { RepoContext } from "./types.js";

export type HistoricalRecoveryNote = {
  title: string;
  body: string;
  nextAction: string;
};

export function applyPersistedSessionState(context: RepoContext, persistedSnapshot: LoadedSessionSnapshot) {
  context.lifecycle.joudoSessionId = persistedSnapshot.sessionId;
  context.lifecycle.joudoSessionCreatedAt = persistedSnapshot.createdAt;
  context.lastPrompt = persistedSnapshot.snapshot.lastPrompt;
  context.timeline = persistedSnapshot.snapshot.timeline;
  context.auditLog = persistedSnapshot.snapshot.auditLog;
  context.summary = persistedSnapshot.snapshot.summary;
  context.updatedAt = persistedSnapshot.snapshot.updatedAt;
  context.turns.workspacePath = persistedSnapshot.snapshot.activity?.workspacePath ?? null;
  context.turns.activeTurn = null;
  context.turns.latestTurn = persistedSnapshot.snapshot.activity?.latestTurn ?? null;
  context.turns.latestTurnWriteJournal = deserializeTurnWriteJournal(persistedSnapshot.latestTurnWriteJournal);
  context.turns.rollback = persistedSnapshot.snapshot.activity?.rollback ?? null;
  context.turns.checkpoints = persistedSnapshot.snapshot.activity?.checkpoints ?? [];
  context.turns.latestCompaction = persistedSnapshot.snapshot.activity?.latestCompaction ?? null;
  context.latestAssistantMessage = null;
  context.approvalState.approvedCommands = persistedSnapshot.snapshot.summary?.executedCommands ?? [];
  context.approvalState.approvedApprovalTypes = persistedSnapshot.snapshot.summary?.approvalTypes ?? [];
  context.approvalState.approvals = [];
  context.approvalState.pendingApprovals.clear();
}

export function createHistoricalRecoveryNote(
  recoveryMode: HistoricalSessionRecoveryMode,
  hasPendingApprovals: boolean,
  attachFailureMessage?: string,
): HistoricalRecoveryNote {
  if (attachFailureMessage) {
    return {
      title: "已恢复历史记录",
      body: `未能重新接回旧会话：${attachFailureMessage}。Joudo 已恢复这条记录，你可以直接基于它开始下一轮。`,
      nextAction: "参考这条历史记录，直接发送下一条 prompt。",
    };
  }

  if (recoveryMode === "history-only" && hasPendingApprovals) {
    return {
      title: "已恢复历史记录",
      body: "旧审批不会在 bridge/CLI 重连后继续等待。Joudo 只恢复了这条记录，需要你重新发起下一轮。",
      nextAction: "参考这条历史记录重新发送 prompt；如果仍需权限，等待新的审批请求。",
    };
  }

  if (recoveryMode === "history-only") {
    return {
      title: "已恢复历史记录",
      body: "未完成的 Copilot 执行不会在 CLI 重启后继续。Joudo 已恢复这条记录，你可以从这里继续下一轮。",
      nextAction: "确认历史记录后，直接发送下一条 prompt。",
    };
  }

  return {
    title: "已恢复历史记录",
    body: "Joudo 已恢复这条历史记录，并会在可能时尝试接回旧会话。",
    nextAction: "确认当前上下文后，继续发送 prompt 或查看时间线。",
  };
}

export function mergeHistoricalRecoverySummary(context: RepoContext, note: HistoricalRecoveryNote): SessionSummary {
  if (context.summary) {
    return {
      ...context.summary,
      body: [context.summary.body, note.body].filter(Boolean).join("\n\n"),
      steps: createSummarySteps({
        ...(context.lastPrompt ? { prompt: context.lastPrompt } : {}),
        timeline: context.timeline,
        executedCommands: context.approvalState.approvedCommands,
        changedFiles: context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [],
        status: "completed",
      }),
      nextAction: note.nextAction,
    };
  }

  return {
    title: note.title,
    body: note.body,
    steps: createSummarySteps({
      ...(context.lastPrompt ? { prompt: context.lastPrompt } : {}),
      timeline: context.timeline,
      executedCommands: context.approvalState.approvedCommands,
      changedFiles: context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [],
      status: "completed",
    }),
    executedCommands: context.approvalState.approvedCommands,
    ...(context.approvalState.approvedApprovalTypes.length > 0 ? { approvalTypes: context.approvalState.approvedApprovalTypes } : {}),
    changedFiles: context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [],
    checks: [],
    risks: createPolicyRiskMessages(context.policy),
    nextAction: note.nextAction,
  };
}