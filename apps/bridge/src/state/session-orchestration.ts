import type {
  PersistedSessionStatus,
  SessionSnapshot,
  SessionSummary,
  SessionTimelineEntry,
} from "@joudo/shared";

import { JoudoError } from "../errors.js";
import { disconnectRepoSession } from "./repo-context.js";
import { loadSessionIndex, readSessionSnapshot } from "./persistence.js";
import {
  applyPersistedSessionState,
  createHistoricalRecoveryNote,
  mergeHistoricalRecoverySummary,
} from "./history-recovery.js";
import { hydrateResumedSessionState } from "./session-permissions.js";
import type { SessionPermissionOps } from "./session-permissions.js";
import type { SessionRuntime } from "./session-runtime.js";
import {
  createRepoObservationFromWriteJournal,
  createObservedTurn,
  createTurnPathTracker,
  markRollbackUnavailable,
  observeRepoState,
  observeRepoStateForPaths,
  resolveUnexpectedObservedPaths,
} from "./turn-changes.js";
import { applyTurnWriteJournal, createTurnWriteJournal } from "./turn-write-journal.js";
import {
  createAssistantSummary,
  createErrorSummary,
  createPolicyRiskMessages,
  createQueuedSummary,
  createRollbackSummary,
  createSummarySteps,
  createSessionResetSummary,
  createTimeoutSummary,
} from "./summaries.js";
import type { RepoContext } from "./types.js";

const PROMPT_TIMEOUT_MS = Number(process.env.JOUDO_PROMPT_TIMEOUT_MS) || 15 * 60 * 1000;
const ROLLBACK_TIMEOUT_MS = Number(process.env.JOUDO_ROLLBACK_TIMEOUT_MS) || 5 * 60 * 1000;

type TimelineInput = Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string };

type SessionOrchestrationDeps = {
  currentContext: () => RepoContext | null;
  snapshot: () => SessionSnapshot;
  sessionIndices: Map<string, ReturnType<typeof loadSessionIndex>>;
  refreshRepoPolicy: (context: RepoContext) => void;
  ensureJoudoSession: (context: RepoContext) => void;
  pushTimeline: (context: RepoContext, entry: TimelineInput) => void;
  touch: (context: RepoContext, nextStatus: RepoContext["status"]) => void;
  queueRepoPersistence: (
    context: RepoContext,
    options?: { statusOverride?: PersistedSessionStatus; currentSessionId?: string | null },
  ) => void;
  publishIfCurrent: (repoId: string) => void;
  emitSummaryUpdated: (summary: SessionSummary) => void;
  sessionRuntime: SessionRuntime;
  sessionPermissionOps: SessionPermissionOps;
};

function isSessionNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Session not found/i.test(message);
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout/i.test(message);
}

function settlePromptStatus(context: RepoContext): RepoContext["status"] {
  if (context.approvalState.approvals.length > 0) {
    return "awaiting-approval";
  }

  if (context.status === "timed-out") {
    return "timed-out";
  }

  return "idle";
}

function nextTurnId(context: RepoContext) {
  return `${context.lifecycle.joudoSessionId ?? "pending"}-turn-${context.turns.turnCount}`;
}

async function finalizeObservedTurn(context: RepoContext, outcome: "completed" | "failed" | "timed-out") {
  if (!context.turns.activeTurn) {
    context.turns.latestTurn = null;
    context.turns.rollback = null;
    return;
  }

  const snapshot = context.turns.activeTurn.pathTracker.snapshot();
  context.turns.activeTurn.pathTracker.stop();
  const before = createRepoObservationFromWriteJournal(context.turns.activeTurn.writeJournal, context.turns.activeTurn.startedAt);
  const after =
    snapshot.trackedPaths.length > 0
      ? await observeRepoStateForPaths(context.repo.rootPath, snapshot.trackedPaths).catch(() => null)
      : {
          observedAt: new Date().toISOString(),
          digest: before.digest,
          files: before.files,
        };
  if (!after) {
    context.turns.latestTurn = null;
    context.turns.rollback = null;
    return;
  }

  const unexpectedObservedPaths = await resolveUnexpectedObservedPaths({
    repoRoot: context.repo.rootPath,
    before,
    trackedPaths: snapshot.trackedPaths,
    unexpectedObservedPaths: snapshot.unexpectedObservedPaths,
  }).catch(() => snapshot.unexpectedObservedPaths);

  const observedTurn = createObservedTurn({
    turnId: context.turns.activeTurn.id,
    prompt: context.turns.activeTurn.prompt,
    startedAt: context.turns.activeTurn.startedAt,
    outcome,
    before,
    after,
    writeJournal: context.turns.activeTurn.writeJournal,
    trackedPaths: snapshot.trackedPaths,
    unexpectedObservedPaths,
    broadCandidateScope: snapshot.broadCandidateScope,
  });
  context.turns.latestTurn = observedTurn.latestTurn;
  context.turns.latestTurnWriteJournal = context.turns.activeTurn.writeJournal;
  context.turns.rollback = observedTurn.rollback;
}

export function createSessionOrchestration(deps: SessionOrchestrationDeps) {
  function finalizeHistoryOnlyRecovery(
    context: RepoContext,
    persistedSnapshot: NonNullable<ReturnType<typeof readSessionSnapshot>>,
    recoveryMode: ReturnType<typeof loadSessionIndex>["sessions"][number]["recoveryMode"],
    hasPendingApprovals: boolean,
    attachFailureMessage?: string,
  ) {
    applyPersistedSessionState(context, persistedSnapshot);
    context.lifecycle.lastKnownCopilotSessionId = null;
    if (context.turns.rollback?.executor === "copilot-undo") {
      context.turns.rollback = markRollbackUnavailable(
        context.turns.rollback,
        "history-only",
        "当前只恢复了历史记录，不能直接对旧会话执行上一轮 /undo。",
        context.updatedAt,
      );
    }

    const note = createHistoricalRecoveryNote(recoveryMode, hasPendingApprovals, attachFailureMessage);
    context.summary = mergeHistoricalRecoverySummary(context, note);

    deps.touch(context, "idle");
    deps.pushTimeline(context, {
      kind: "status",
      title: note.title,
      body: note.body,
    });
    deps.queueRepoPersistence(context, { statusOverride: "idle", currentSessionId: context.lifecycle.joudoSessionId });
    deps.publishIfCurrent(context.repo.id);
    return deps.snapshot();
  }

  async function recoverHistoricalSession(joudoSessionId: string) {
    const context = deps.currentContext();
    if (!context) {
      throw new JoudoError("validation", "当前没有选中的仓库，无法恢复历史记录。", {
        statusCode: 404,
        nextAction: "先选择目标仓库，再从历史会话列表发起恢复。",
        retryable: true,
      });
    }

    const sessionIndex = deps.sessionIndices.get(context.repo.id) ?? loadSessionIndex(context.repo);
    const entry = sessionIndex.sessions.find((candidate) => candidate.id === joudoSessionId) ?? null;
    const persistedSnapshot = readSessionSnapshot(context.repo.rootPath, joudoSessionId);
    if (!entry || !persistedSnapshot) {
      throw new JoudoError("recovery", "当前历史记录缺少可恢复的快照。", {
        statusCode: 404,
        nextAction: "刷新历史列表后重试；如果这条记录仍然不可用，直接从当前上下文开始新会话。",
        retryable: true,
      });
    }

    deps.refreshRepoPolicy(context);
    await disconnectRepoSession(context);
    context.approvalState.pendingApprovals.clear();
    context.approvalState.approvals = [];
    context.lifecycle.activePrompt = null;
    deps.touch(context, "recovering");
    deps.publishIfCurrent(context.repo.id);

    context.lifecycle.joudoSessionId = entry.id;
    context.lifecycle.joudoSessionCreatedAt = persistedSnapshot.createdAt;
    context.turns.turnCount = entry.turnCount;
    context.lifecycle.lastKnownCopilotSessionId = entry.lastKnownCopilotSessionId;
    applyPersistedSessionState(context, persistedSnapshot);

    if (entry.recoveryMode !== "attach" || !entry.lastKnownCopilotSessionId) {
      return finalizeHistoryOnlyRecovery(context, persistedSnapshot, entry.recoveryMode, entry.hasPendingApprovals);
    }

    deps.pushTimeline(context, {
      kind: "status",
      title: "正在尝试接回旧会话",
      body: `Joudo 正在尝试接回已完成的 Copilot session ${entry.lastKnownCopilotSessionId}。如果失败，会退回到只读历史记录。`,
    });
    deps.touch(context, "recovering");
    deps.publishIfCurrent(context.repo.id);

    try {
      const currentAuth = await deps.sessionRuntime.refreshAuthState();
      if (currentAuth.status !== "authenticated") {
        return finalizeHistoryOnlyRecovery(
          context,
          persistedSnapshot,
          entry.recoveryMode,
          entry.hasPendingApprovals,
          currentAuth.message || "Copilot CLI 尚未登录。",
        );
      }

      const activeClient = await deps.sessionRuntime.ensureClient();
      const sessions = await activeClient.listSessions({ cwd: context.repo.rootPath });
      const exists = sessions.some((candidate) => candidate.sessionId === entry.lastKnownCopilotSessionId);
      if (!exists) {
        throw new Error(`Copilot session ${entry.lastKnownCopilotSessionId} 不存在，无法恢复。`);
      }

      const session = await activeClient.resumeSession(entry.lastKnownCopilotSessionId, deps.sessionRuntime.createSessionConfig(context));
      deps.sessionRuntime.bindSession(context.repo.id, context, session);
  await hydrateResumedSessionState(context, session, deps.sessionPermissionOps);
      deps.pushTimeline(context, {
        kind: "status",
        title: "已接管历史会话",
        body: `Joudo 已接回 Copilot session ${entry.lastKnownCopilotSessionId}。`,
      });
      deps.queueRepoPersistence(context);
      deps.publishIfCurrent(context.repo.id);
      return deps.snapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法恢复历史会话";
      const fallbackMessage = isSessionNotFoundError(error) || /不存在|not found/i.test(message) ? message : `附着失败：${message}`;
      return finalizeHistoryOnlyRecovery(context, persistedSnapshot, entry.recoveryMode, entry.hasPendingApprovals, fallbackMessage);
    }
  }

  async function resumeHistoricalSession(joudoSessionId: string) {
    return recoverHistoricalSession(joudoSessionId);
  }

  async function runPrompt(prompt: string) {
    const context = deps.currentContext();
    if (!context) {
      throw new JoudoError("validation", "当前没有选中的仓库，无法发送 prompt。", {
        statusCode: 404,
        nextAction: "先选择一个仓库，再发送 prompt。",
        retryable: true,
      });
    }

    if (!prompt.trim()) {
      throw new JoudoError("validation", "Prompt 不能为空。", {
        statusCode: 400,
        nextAction: "补充一条具体任务描述后再重新发送。",
        retryable: true,
      });
    }

    if (context.lifecycle.activePrompt) {
      context.summary = {
        title: "已有任务执行中",
        body: "当前仓库已经有一条真实会话在运行，请等本轮完成后再发送下一条提示词。",
        steps: createSummarySteps({ prompt, timeline: context.timeline, status: "running" }),
        executedCommands: context.approvalState.approvedCommands,
        ...(context.approvalState.approvedApprovalTypes.length > 0 ? { approvalTypes: context.approvalState.approvedApprovalTypes } : {}),
        changedFiles: [],
        checks: [],
        risks: createPolicyRiskMessages(context.policy),
        nextAction: "等待当前任务完成，或处理当前待审批请求。",
      };
      deps.queueRepoPersistence(context);
      deps.publishIfCurrent(context.repo.id);
      return deps.snapshot();
    }

    deps.ensureJoudoSession(context);
    context.turns.turnCount += 1;
    context.approvalState.approvedCommands = [];
    context.approvalState.approvedApprovalTypes = [];
    context.lastPrompt = prompt;
    context.turns.latestTurnWriteJournal = null;
    context.turns.activeTurn = {
      id: nextTurnId(context),
      prompt,
      startedAt: new Date().toISOString(),
      pathTracker: createTurnPathTracker(context.repo.rootPath),
      writeJournal: createTurnWriteJournal(),
    };
    deps.pushTimeline(context, {
      kind: "prompt",
      title: "已发送提示词",
      body: prompt,
    });
    context.summary = createQueuedSummary(prompt);
    deps.touch(context, "running");
    deps.queueRepoPersistence(context);
    deps.publishIfCurrent(context.repo.id);

    try {
      const session = await deps.sessionRuntime.ensureSession(context);
      context.lifecycle.activePrompt = session
        .sendAndWait({ prompt }, PROMPT_TIMEOUT_MS)
        .then(async (event) => {
          if (event?.data.content) {
            context.latestAssistantMessage = event.data.content;
          }

          await finalizeObservedTurn(context, "completed");

          if (event?.data.content) {
            context.summary = createAssistantSummary(
              context.repo,
              prompt,
              event.data.content,
              context.approvalState.approvedCommands,
              context.approvalState.approvedApprovalTypes,
              context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [],
              context.policy,
              context.timeline,
            );
            deps.emitSummaryUpdated(context.summary);
          } else {
            context.summary = {
              title: "本轮任务已完成",
              body: "Copilot 会话已经回到空闲状态，但这一轮没有返回可展示的 assistant.message。",
              steps: createSummarySteps({
                prompt,
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
              nextAction: "继续发送下一条提示词，或检查事件流里是否有被过滤掉的结果。",
            };
          }

          deps.queueRepoPersistence(context);
        })
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : "真实会话执行失败";
          await finalizeObservedTurn(context, isTimeoutError(error) ? "timed-out" : "failed");
          if (isSessionNotFoundError(error)) {
            void disconnectRepoSession(context);
            deps.pushTimeline(context, {
              kind: "error",
              title: "当前会话已失效",
              body: message,
            });
            context.summary = createSessionResetSummary(
              message,
              context.approvalState.approvedCommands,
              context.approvalState.approvedApprovalTypes,
              context.policy,
              context.timeline,
            );
            context.turns.rollback = markRollbackUnavailable(
              context.turns.rollback,
              "session-unavailable",
              "当前 Copilot session 已失效，无法直接执行上一轮 /undo。",
              new Date().toISOString(),
            );
          } else if (isTimeoutError(error)) {
            deps.pushTimeline(context, {
              kind: "error",
              title: "本轮任务已超时",
              body: `围绕“${prompt}”的这轮真实会话超过了当前 15 分钟等待窗口。`,
            });
            context.summary = createTimeoutSummary(
              prompt,
              context.approvalState.approvedCommands,
              context.approvalState.approvedApprovalTypes,
              context.policy,
              context.timeline,
            );
            context.summary.changedFiles = context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [];
            context.summary.steps = createSummarySteps({
              prompt,
              timeline: context.timeline,
              executedCommands: context.approvalState.approvedCommands,
              changedFiles: context.summary.changedFiles,
              status: "failed",
            });
            deps.touch(context, "timed-out");
          } else {
            deps.pushTimeline(context, {
              kind: "error",
              title: "提示词执行失败",
              body: message,
            });
            context.summary = createErrorSummary(message);
            context.summary.steps = createSummarySteps({
              prompt,
              timeline: context.timeline,
              errorMessage: message,
              executedCommands: context.approvalState.approvedCommands,
              changedFiles: context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [],
              status: "failed",
            });
          }
          deps.queueRepoPersistence(context);
        })
        .finally(() => {
          context.turns.activeTurn = null;
          context.lifecycle.activePrompt = null;
          deps.touch(context, settlePromptStatus(context));
          context.updatedAt = new Date().toISOString();
          deps.queueRepoPersistence(context);
          deps.publishIfCurrent(context.repo.id);
        });
    } catch (error) {
      context.turns.activeTurn?.pathTracker.stop();
      context.turns.activeTurn = null;
      deps.pushTimeline(context, {
        kind: "error",
        title: "无法启动真实会话",
        body: error instanceof Error ? error.message : "无法创建真实 Copilot 会话",
      });
      context.summary = createErrorSummary(error instanceof Error ? error.message : "无法创建真实 Copilot 会话");
      context.summary.steps = createSummarySteps({
        prompt,
        timeline: context.timeline,
        errorMessage: error instanceof Error ? error.message : "无法创建真实 Copilot 会话",
        status: "failed",
      });
      deps.touch(context, "idle");
      deps.queueRepoPersistence(context);
      deps.publishIfCurrent(context.repo.id);
    }

    return deps.snapshot();
  }

  async function rollbackLatestTurn() {
    const context = deps.currentContext();
    if (!context) {
      throw new JoudoError("validation", "当前没有选中的仓库，无法执行回退。", {
        statusCode: 404,
        nextAction: "先选择目标仓库，再撤回上一轮改动。",
        retryable: true,
      });
    }

    if (context.lifecycle.activePrompt) {
      throw new JoudoError("validation", "当前仍有任务执行中，暂时不能回退上一轮。", {
        statusCode: 409,
        nextAction: "等待当前任务完成或处理审批后，再执行回退。",
        retryable: true,
      });
    }

    if (context.approvalState.approvals.length > 0 || context.status === "recovering") {
      throw new JoudoError("validation", "当前状态不允许直接执行上一轮回退。", {
        statusCode: 409,
        nextAction: "先处理当前审批或等待恢复结束，再尝试回退。",
        retryable: true,
      });
    }

    if (!context.turns.rollback || !context.turns.rollback.targetTurnId || !context.turns.rollback.workspaceDigestAfter) {
      throw new JoudoError("validation", "当前没有可回退的上一轮改动。", {
        statusCode: 409,
        nextAction: "先完成一轮带文件改动的任务，再尝试回退。",
        retryable: true,
      });
    }

    if (context.turns.rollback.executor === "copilot-undo" && !context.lifecycle.session) {
      context.turns.rollback = markRollbackUnavailable(
        context.turns.rollback,
        "session-unavailable",
        "当前未附着到原始 Copilot session，无法直接执行上一轮 /undo。",
      );
      deps.queueRepoPersistence(context);
      deps.publishIfCurrent(context.repo.id);
      throw new JoudoError("recovery", "当前没有附着中的 Copilot session，无法直接执行上一轮 /undo。", {
        statusCode: 409,
        nextAction: "先恢复当前历史会话并重新附着，再尝试回退。",
        retryable: true,
      });
    }

    const trackedPaths = context.turns.rollback.trackedPaths ?? context.turns.rollback.changedFiles.map((item) => item.path);
    const currentObservation = await observeRepoStateForPaths(context.repo.rootPath, trackedPaths);
    if (currentObservation.digest !== context.turns.rollback.workspaceDigestAfter) {
      context.turns.rollback = markRollbackUnavailable(
        context.turns.rollback,
        "workspace-drifted",
        "工作区已经偏离上一轮结束时的状态，当前不能安全整体回退。",
        currentObservation.observedAt,
      );
      deps.queueRepoPersistence(context);
      deps.publishIfCurrent(context.repo.id);
      throw new JoudoError("validation", "工作区已经偏离上一轮结束时的状态，当前不能安全整体回退。", {
        statusCode: 409,
        nextAction: "先检查或整理当前工作区，再决定是否重新发起一轮新的修改。",
        retryable: true,
      });
    }

    deps.touch(context, "running");
    deps.pushTimeline(context, {
      kind: "status",
      title: "正在撤回上一轮改动",
      body:
        context.turns.rollback.executor === "joudo-write-journal"
          ? `Joudo 将按记录的写入基线恢复上一轮观测到的 ${context.turns.rollback.changedFiles.length} 项文件改动。`
          : `Joudo 将通过 /undo 撤回上一轮观测到的 ${context.turns.rollback.changedFiles.length} 项文件改动。`,
    });
    deps.queueRepoPersistence(context);
    deps.publishIfCurrent(context.repo.id);

    context.lifecycle.activePrompt = (context.turns.rollback.executor === "joudo-write-journal"
      ? (async () => {
          const restoredFiles = await applyTurnWriteJournal(context.turns.latestTurnWriteJournal ?? new Map(), context.repo.rootPath);
          const afterUndo = await observeRepoStateForPaths(
            context.repo.rootPath,
            context.turns.rollback?.trackedPaths ?? context.turns.rollback?.changedFiles.map((item) => item.path) ?? [],
          );
          const revertedToBaseline = afterUndo.digest === context.turns.rollback?.workspaceDigestBefore;
          const rollbackMessage = revertedToBaseline
            ? `Joudo 已按记录的写入基线恢复 ${restoredFiles} 个文件。`
            : `Joudo 已按记录的写入基线尝试恢复 ${restoredFiles} 个文件，但工作区没有完全回到上一轮开始前的基线。`;

          context.summary = createRollbackSummary({
            message: rollbackMessage,
            changedFiles: context.turns.rollback?.changedFiles.map((item) => item.path) ?? [],
            approvedCommands: context.approvalState.approvedCommands,
            approvalTypes: context.approvalState.approvedApprovalTypes,
            policy: context.policy,
            revertedToBaseline,
            executor: context.turns.rollback?.executor ?? "joudo-write-journal",
            timeline: context.timeline,
          });
          deps.emitSummaryUpdated(context.summary);
          deps.pushTimeline(context, {
            kind: "status",
            title: "已撤回上一轮改动",
            body: revertedToBaseline
              ? "上一轮观测到的工作区改动已按 Joudo 记录的写入基线恢复。"
              : "已按 Joudo 记录的写入基线尝试恢复，但工作区没有完全回到上一轮开始前的基线。",
          });
          if (context.turns.latestTurn && revertedToBaseline) {
            context.turns.latestTurn = {
              ...context.turns.latestTurn,
              outcome: "rolled-back",
            };
          }
          context.turns.rollback = markRollbackUnavailable(
            context.turns.rollback,
            revertedToBaseline ? "reverted" : "needs-review",
            revertedToBaseline ? "上一轮改动已经按 Joudo 写入基线撤回完成。" : "上一轮已按 Joudo 写入基线尝试恢复，请先人工确认当前工作区状态。",
            afterUndo.observedAt,
          );
        })()
      : context.lifecycle.session!
          .sendAndWait({ prompt: "/undo" }, ROLLBACK_TIMEOUT_MS)
          .then(async (event) => {
            const afterUndo = await observeRepoStateForPaths(
              context.repo.rootPath,
              context.turns.rollback?.trackedPaths ?? context.turns.rollback?.changedFiles.map((item) => item.path) ?? [],
            );
            const revertedToBaseline = afterUndo.digest === context.turns.rollback?.workspaceDigestBefore;
            const rollbackMessage = event?.data.content ?? "Copilot 已执行 /undo。";

            context.summary = createRollbackSummary({
              message: rollbackMessage,
              changedFiles: context.turns.rollback?.changedFiles.map((item) => item.path) ?? [],
              approvedCommands: context.approvalState.approvedCommands,
              approvalTypes: context.approvalState.approvedApprovalTypes,
              policy: context.policy,
              revertedToBaseline,
              executor: context.turns.rollback?.executor ?? "copilot-undo",
              timeline: context.timeline,
            });
            deps.emitSummaryUpdated(context.summary);
            deps.pushTimeline(context, {
              kind: "status",
              title: "已撤回上一轮改动",
              body: revertedToBaseline
                ? "上一轮观测到的工作区改动已回到开始前的基线。"
                : "已执行 /undo，但工作区没有完全回到上一轮开始前的基线。",
            });
            if (context.turns.latestTurn && revertedToBaseline) {
              context.turns.latestTurn = {
                ...context.turns.latestTurn,
                outcome: "rolled-back",
              };
            }
            context.turns.rollback = markRollbackUnavailable(
              context.turns.rollback,
              revertedToBaseline ? "reverted" : "needs-review",
              revertedToBaseline ? "上一轮改动已经撤回完成。" : "上一轮已执行 /undo，请先人工确认当前工作区状态。",
              afterUndo.observedAt,
            );
          }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "上一轮回退失败";
        deps.pushTimeline(context, {
          kind: "error",
          title: "上一轮回退失败",
          body: message,
        });
        context.summary = createErrorSummary(message);
        context.summary.steps = createSummarySteps({
          timeline: context.timeline,
          errorMessage: message,
          status: "failed",
        });
      })
      .finally(() => {
        context.lifecycle.activePrompt = null;
        deps.touch(context, settlePromptStatus(context));
        context.updatedAt = new Date().toISOString();
        deps.queueRepoPersistence(context);
        deps.publishIfCurrent(context.repo.id);
      });

    await context.lifecycle.activePrompt;
    return deps.snapshot();
  }

  return {
    recoverHistoricalSession,
    resumeHistoricalSession,
    runPrompt,
    rollbackLatestTurn,
  };
}