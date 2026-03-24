import type {
  RepoAddPayload,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalType,
  CopilotAuthState,
  PermissionAuditEntry,
  PersistedSessionStatus,
  RepoDescriptor,
  RepoInitPolicyPayload,
  RepoInitPolicyResult,
  RepoInstructionDocument,
  RepoPolicyRuleDeletePayload,
  RepoRemovePayload,
  SessionCheckpointDocument,
  ServerEvent,
  SessionIndexDocument,
  SessionSnapshot,
  SessionTimelineEntry,
} from "@joudo/shared";

import { JoudoError } from "./errors.js";
import type { PermissionRequest } from "./copilot-sdk.js";
import {
  initializeRepoPolicy as defaultInitializeRepoPolicy,
  loadRepoPolicy as defaultLoadRepoPolicy,
  persistApprovalToPolicy as defaultPersistApprovalToPolicy,
  removePolicyRule as defaultRemovePolicyRule,
} from "./policy/index.js";
import type { LoadedRepoPolicy } from "./policy/index.js";
import { decisionBody, getRequestTarget } from "./state/audit.js";
import {
  getRepoInstructionPath as defaultGetRepoInstructionPath,
  getSessionIndexPath as defaultGetSessionIndexPath,
  initializeRepoInstruction as defaultInitializeRepoInstruction,
  initializeSessionIndex as defaultInitializeSessionIndex,
  clearSessionHistory as defaultClearSessionHistory,
  loadSessionIndex as defaultLoadSessionIndex,
  readSessionSnapshot as defaultReadSessionSnapshot,
  readOrCreateRepoInstruction as defaultReadOrCreateRepoInstruction,
  saveRepoInstruction as defaultSaveRepoInstruction,
} from "./state/persistence.js";
import {
  createRepoContext as defaultCreateRepoContext,
  disconnectRepoSession as defaultDisconnectRepoSession,
} from "./state/repo-context.js";
import { readWorkspaceCheckpoint as defaultReadWorkspaceCheckpoint } from "./state/checkpoints.js";
import { discoverAgentCatalog as defaultDiscoverAgentCatalog } from "./state/agent-discovery.js";
import {
  buildRepos as defaultBuildRepos,
  registerRepo as defaultRegisterRepo,
  removeRepo as defaultRemoveRepo,
} from "./state/repo-discovery.js";
import { applyPersistedSessionState } from "./state/history-recovery.js";
import { handlePermissionRequest } from "./state/session-permissions.js";
import { describePermission } from "./state/approvals.js";
import { markRollbackUnavailable } from "./state/turn-changes.js";
import { createSessionOrchestration } from "./state/session-orchestration.js";
import { createSessionRuntime } from "./state/session-runtime.js";
import type { CopilotClientLike, CreateClientFactory } from "./state/session-runtime.js";
import {
  captureTurnWriteBaseline as captureTurnWriteBaselineForJournal,
  captureTurnWriteBaselinesForPaths,
} from "./state/turn-write-journal.js";
import {
  appendAuditEntry,
  ensureJoudoSession,
  pushTimelineEntry,
  queuePersistence,
  snapshotForContext,
  touch,
  updateAuditEntry,
} from "./state/session-store.js";
import {
  createAuthSummary,
  createSummarySteps,
  createPolicyRiskMessages,
} from "./state/summaries.js";
import type { Listener, MvpState, RepoContext } from "./state/types.js";

const DEFAULT_AUTH: CopilotAuthState = {
  status: "unknown",
  message: "正在检查 Copilot CLI 登录状态。",
};

const DEFAULT_MODEL = process.env.JOUDO_MODEL ?? "gpt-5-mini";
const CONFIGURED_AVAILABLE_MODELS = parseAvailableModels(process.env.JOUDO_AVAILABLE_MODELS, DEFAULT_MODEL);
const TIMELINE_LIMIT = 24;
const AUDIT_LOG_LIMIT = 40;

export type MvpStateDeps = {
  buildRepos: () => RepoDescriptor[];
  registerRepo: (rootPath: string) => RepoDescriptor;
  removeRepo: (rootPath: string) => void;
  discoverAgentCatalog: (rootPath: string) => ReturnType<typeof defaultDiscoverAgentCatalog>;
  createRepoContext: (
    repo: RepoDescriptor,
    model: string,
    agent: string | null,
    availableAgents: string[],
    agentCatalog: ReturnType<typeof defaultDiscoverAgentCatalog>["counts"],
  ) => RepoContext;
  disconnectRepoSession: (context: RepoContext) => Promise<void>;
  loadRepoPolicy: (rootPath: string) => LoadedRepoPolicy;
  initializeRepoPolicy: typeof defaultInitializeRepoPolicy;
  persistApprovalToPolicy: typeof defaultPersistApprovalToPolicy;
  removePolicyRule: typeof defaultRemovePolicyRule;
  loadSessionIndex: (repo: RepoDescriptor) => SessionIndexDocument;
  readSessionSnapshot: typeof defaultReadSessionSnapshot;
  readOrCreateRepoInstruction: typeof defaultReadOrCreateRepoInstruction;
  initializeRepoInstruction: typeof defaultInitializeRepoInstruction;
  initializeSessionIndex: typeof defaultInitializeSessionIndex;
  clearSessionHistory: typeof defaultClearSessionHistory;
  getRepoInstructionPath: typeof defaultGetRepoInstructionPath;
  getSessionIndexPath: typeof defaultGetSessionIndexPath;
  saveRepoInstruction: typeof defaultSaveRepoInstruction;
  readWorkspaceCheckpoint: typeof defaultReadWorkspaceCheckpoint;
};

const defaultDeps: MvpStateDeps = {
  buildRepos: defaultBuildRepos,
  registerRepo: defaultRegisterRepo,
  removeRepo: defaultRemoveRepo,
  discoverAgentCatalog: defaultDiscoverAgentCatalog,
  createRepoContext: defaultCreateRepoContext,
  disconnectRepoSession: defaultDisconnectRepoSession,
  loadRepoPolicy: defaultLoadRepoPolicy,
  initializeRepoPolicy: defaultInitializeRepoPolicy,
  persistApprovalToPolicy: defaultPersistApprovalToPolicy,
  removePolicyRule: defaultRemovePolicyRule,
  loadSessionIndex: defaultLoadSessionIndex,
  readSessionSnapshot: defaultReadSessionSnapshot,
  readOrCreateRepoInstruction: defaultReadOrCreateRepoInstruction,
  initializeRepoInstruction: defaultInitializeRepoInstruction,
  initializeSessionIndex: defaultInitializeSessionIndex,
  clearSessionHistory: defaultClearSessionHistory,
  getRepoInstructionPath: defaultGetRepoInstructionPath,
  getSessionIndexPath: defaultGetSessionIndexPath,
  saveRepoInstruction: defaultSaveRepoInstruction,
  readWorkspaceCheckpoint: defaultReadWorkspaceCheckpoint,
};

type CreateMvpStateOptions = {
  repos?: RepoDescriptor[];
  createClient?: CreateClientFactory;
  deps?: Partial<MvpStateDeps>;
};

function parseAvailableModels(rawValue: string | undefined, defaultModel: string): string[] {
  const parsed = (rawValue ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(parsed.length > 0 ? [defaultModel, ...parsed] : [defaultModel]));
}

export function createMvpState(options: CreateMvpStateOptions = {}) {
  const deps: MvpStateDeps = { ...defaultDeps, ...options.deps };
  let repos = options.repos ?? deps.buildRepos();
  const listeners = new Set<Listener>();
  const repoContexts = new Map(repos.map((repo) => [repo.id, createContext(repo, DEFAULT_MODEL, null)]));
  const approvalRepoIndex = new Map<string, string>();
  const sessionIndices = new Map<string, SessionIndexDocument>(repos.map((repo) => [repo.id, deps.loadSessionIndex(repo)]));
  const persistenceQueues = new Map<string, Promise<void>>();
  let availableModels = CONFIGURED_AVAILABLE_MODELS;

  let currentRepoId = findMostRecentlyActiveRepoId(repos, sessionIndices) ?? repos[0]?.id ?? null;
  let authState: CopilotAuthState = DEFAULT_AUTH;
  let mutationInFlight = false;
  const clientRuntimeRef: { client: CopilotClientLike | null; clientStartPromise: Promise<unknown> | null } = {
    client: null,
    clientStartPromise: null,
  };

  function refreshRepoPolicy(context: RepoContext) {
    context.policy = deps.loadRepoPolicy(context.repo.rootPath);
    context.repo.policyState = context.policy.state;
  }

  function recordApprovedCommand(context: RepoContext, request: PermissionRequest, fallbackPreview?: string) {
    const preview =
      request.kind === "shell"
        ? typeof request.fullCommandText === "string"
          ? request.fullCommandText
          : fallbackPreview
        : fallbackPreview;

    if (preview) {
      context.approvalState.approvedCommands.push(preview);
    }
  }

  function recordApprovedApprovalType(context: RepoContext, approvalType: ApprovalType) {
    if (!context.approvalState.approvedApprovalTypes.includes(approvalType)) {
      context.approvalState.approvedApprovalTypes.push(approvalType);
    }
  }

  async function captureTurnWriteBaseline(context: RepoContext, request: PermissionRequest) {
    if (!context.turns.activeTurn) {
      return;
    }

    if (request.kind === "write") {
      if (typeof request.fileName === "string") {
        context.turns.activeTurn.pathTracker.addCandidatePaths([request.fileName]);
      }

      await captureTurnWriteBaselineForJournal(
        context.turns.activeTurn.writeJournal,
        context.repo.rootPath,
        typeof request.fileName === "string" ? request.fileName : undefined,
      );
      return;
    }

    if (request.kind === "shell") {
      const commands = Array.isArray(request.commands)
        ? request.commands.filter(
            (command): command is { readOnly?: boolean } => typeof command === "object" && command !== null,
          )
        : [];
      const possiblePaths = Array.isArray(request.possiblePaths)
        ? request.possiblePaths.filter((candidate): candidate is string => typeof candidate === "string")
        : [];
      const mayWriteFiles = request.hasWriteFileRedirection === true || commands.some((command) => !command.readOnly);
      if (!mayWriteFiles) {
        return;
      }

      context.turns.activeTurn.pathTracker.addCandidatePaths(possiblePaths);
      await captureTurnWriteBaselinesForPaths(context.turns.activeTurn.writeJournal, context.repo.rootPath, possiblePaths);
    }
  }

  function currentContext(): RepoContext | null {
    return currentRepoId ? repoContexts.get(currentRepoId) ?? null : null;
  }

  function createContext(repo: RepoDescriptor, model: string, agent: string | null) {
    const catalog = deps.discoverAgentCatalog(repo.rootPath);
    const nextAgent = agent && catalog.availableAgents.includes(agent) ? agent : null;
    return deps.createRepoContext(repo, model, nextAgent, catalog.availableAgents, catalog.counts);
  }

  function refreshContextAgents(context: RepoContext, options?: { notifyIfSelectionMissing?: boolean }) {
    const catalog = deps.discoverAgentCatalog(context.repo.rootPath);
    context.availableAgents = catalog.availableAgents;
    context.agentCatalog = catalog.counts;

    if (context.currentAgent && !catalog.availableAgents.includes(context.currentAgent)) {
      const removedAgent = context.currentAgent;
      context.currentAgent = null;

      if (options?.notifyIfSelectionMissing) {
        pushTimeline(context, {
          kind: "status",
          title: "执行 agent 已自动回退",
          body: `之前选择的 agent ${removedAgent} 已不存在或已被移除。Joudo 已切回默认模式，并把它从当前列表中移除。`,
        });
      }

      return { removedAgent };
    }

    return { removedAgent: null as string | null };
  }

  async function refreshContextAgentsForPrompt(context: RepoContext) {
    const { removedAgent } = refreshContextAgents(context, { notifyIfSelectionMissing: true });
    if (!removedAgent) {
      return;
    }

    if (context.lifecycle.session && !context.lifecycle.activePrompt) {
      await deps.disconnectRepoSession(context);
    }

    context.summary = {
      title: "执行 agent 已自动回退",
      body: `之前选择的 agent ${removedAgent} 已不存在或已被移除。Joudo 已切回默认模式，并将在本轮按默认模式继续执行。`,
      steps: createSummarySteps({ timeline: context.timeline, status: "completed" }),
      executedCommands: [],
      changedFiles: [],
      checks: ["当前仓库已切回默认 agent 模式"],
      risks: createPolicyRiskMessages(context.policy),
      nextAction: "如果你仍然需要自定义 agent，请先在 Copilot 的全局或当前仓库目录里重新添加它。",
    };
    touch(context, "idle");
    queueRepoPersistence(context);
    publishIfCurrent(context.repo.id);
  }

  function normalizeAvailableModels(nextModels: string[]) {
    return Array.from(
      new Set([
        DEFAULT_MODEL,
        ...Array.from(repoContexts.values()).map((context) => context.currentModel),
        ...nextModels,
      ].filter(Boolean)),
    );
  }

  function setAvailableModels(nextModels: string[]) {
    availableModels = normalizeAvailableModels(nextModels);
  }

  function restoreDisplayStatus(status: PersistedSessionStatus): RepoContext["status"] {
    if (status === "timed-out") {
      return "timed-out";
    }

    return "idle";
  }

  function autoRestoreNote(entry: SessionIndexDocument["sessions"][number]): { body: string; nextAction: string } {
    if (entry.recoveryMode === "attach") {
      return {
        body: "Joudo 已自动载入最近一次历史记录。如果你想继续接回旧会话，可以在“历史会话”里点“恢复并尝试接管”。",
        nextAction: "先确认当前摘要与时间线；如果要接回旧会话，再从历史列表发起恢复。",
      };
    }

    if (entry.status === "timed-out") {
      return {
        body: "Joudo 已自动载入最近一次超时记录。当前不会自动续跑旧任务，你可以确认上下文后直接重试。",
        nextAction: "先看超时前的摘要与时间线，再决定是重试还是拆小任务。",
      };
    }

    if (entry.hasPendingApprovals) {
      return {
        body: "Joudo 已自动载入最近一次历史记录。旧审批不会在 bridge 重启后继续等待，你需要重新发起下一轮。",
        nextAction: "参考这条历史记录重新发送 prompt；如果仍需权限，等待新的审批请求。",
      };
    }

    return {
      body: "Joudo 已自动载入最近一次历史记录。当前不会自动续跑旧任务，但你可以直接从这里继续下一轮。",
      nextAction: "确认当前摘要与时间线后，直接发送下一条 prompt。",
    };
  }

  function restoreLatestContextFromHistory() {
    const context = currentContext();
    if (!context) {
      return;
    }

    const sessionIndex = sessionIndices.get(context.repo.id);
    const latestEntry = sessionIndex?.sessions[0] ?? null;
    if (!latestEntry) {
      return;
    }

    const persistedSnapshot = deps.readSessionSnapshot(context.repo.rootPath, latestEntry.id);
    if (!persistedSnapshot) {
      return;
    }

    applyPersistedSessionState(context, persistedSnapshot);
    context.turns.turnCount = latestEntry.turnCount;
    context.lifecycle.lastKnownCopilotSessionId = latestEntry.lastKnownCopilotSessionId;
    context.status = restoreDisplayStatus(latestEntry.status);
    if (context.turns.rollback?.executor === "copilot-undo") {
      context.turns.rollback = markRollbackUnavailable(
        context.turns.rollback,
        "history-only",
        "当前只恢复了历史记录；如果需要执行上一轮 /undo，请先重新接回原始 Copilot session。",
        context.updatedAt,
      );
    }

    const note = autoRestoreNote(latestEntry);
    if (context.summary) {
      context.summary = {
        ...context.summary,
        body: [context.summary.body, note.body].filter(Boolean).join("\n\n"),
        nextAction: note.nextAction,
      };
    }
  }

  function snapshot(): SessionSnapshot {
    return snapshotForContext(currentContext(), authState, availableModels, DEFAULT_MODEL);
  }

  function emit(event: ServerEvent) {
    listeners.forEach((listener) => listener(event));
  }

  const pushTimeline = (context: RepoContext, entry: Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string }) =>
    pushTimelineEntry(context, entry, TIMELINE_LIMIT);
  const appendAudit = (context: RepoContext, entry: PermissionAuditEntry) => appendAuditEntry(context, entry, AUDIT_LOG_LIMIT);

  function publishCurrentSnapshot() {
    emit({ type: "session.snapshot", payload: snapshot() });
  }

  function publishIfCurrent(repoId: string) {
    if (currentRepoId === repoId) {
      publishCurrentSnapshot();
    }
  }

  function ensureCurrentContextSummary(context: RepoContext, title: string, body: string) {
    refreshRepoPolicy(context);
    if (!context.lifecycle.joudoSessionId || !context.summary) {
      context.summary = createAuthSummary(context.repo, authState, context.policy);
      pushTimeline(context, {
        kind: "status",
        title,
        body,
      });
    }
  }

  function attachRepo(repo: RepoDescriptor) {
    repos = [...repos.filter((entry) => entry.id !== repo.id), repo];
    repoContexts.set(repo.id, createContext(repo, DEFAULT_MODEL, null));
    sessionIndices.set(repo.id, deps.loadSessionIndex(repo));
  }

  function pickNextRepoId(excludedRepoId?: string): string | null {
    const candidateRepos = excludedRepoId ? repos.filter((repo) => repo.id !== excludedRepoId) : repos;
    const latest = findMostRecentlyActiveRepoId(candidateRepos, sessionIndices);
    return latest ?? candidateRepos[0]?.id ?? null;
  }

  const queueRepoPersistence = (context: RepoContext, options?: { statusOverride?: PersistedSessionStatus; currentSessionId?: string | null }) =>
    queuePersistence(
      context,
      {
        sessionIndices,
        persistenceQueues,
        authState,
        availableModels,
        defaultModel: DEFAULT_MODEL,
        onPersistenceError(repoId, error) {
          const ctx = repoContexts.get(repoId);
          if (!ctx) {
            return;
          }

          const errorMessage = error instanceof Error ? error.message : "unknown error";
          pushTimeline(ctx, {
            kind: "error",
            title: "持久化写入失败",
            body: `会话快照保存失败（已重试 2 次）：${errorMessage}`,
          });
          publishIfCurrent(repoId);
        },
      },
      options,
    );

  const sessionPermissionOps = {
    refreshRepoPolicy,
    appendAuditEntry: appendAudit,
    updateAuditEntry,
    captureTurnWriteBaseline,
    recordApprovedCommand,
    recordApprovedApprovalType,
    pushTimelineEntry: pushTimeline,
    touch,
    queuePersistence: queueRepoPersistence,
    publishIfCurrent,
    emitApprovalRequested(approval: ApprovalRequest) {
      emit({ type: "approval.requested", payload: approval });
    },
    onApprovalAdded(approvalId: string, repoId: string) {
      approvalRepoIndex.set(approvalId, repoId);
    },
  };

  const sessionRuntime = createSessionRuntime({
    clientRuntimeRef,
    createClient: options.createClient,
    currentContext,
    repoContexts,
    getAuthState: () => authState,
    setAuthState: (nextAuthState) => {
      authState = nextAuthState;
    },
    getAvailableModels: () => availableModels,
    setAvailableModels,
    refreshRepoPolicy,
    queuePersistence: queueRepoPersistence,
    pushTimelineEntry: pushTimeline,
    touch,
    publishCurrentSnapshot,
    publishIfCurrent,
    emitSummaryUpdated(summary) {
      emit({ type: "summary.updated", payload: summary });
    },
    handlePermissionRequest: (context, request) => handlePermissionRequest(context, request, sessionPermissionOps),
  });

  const sessionOrchestration = createSessionOrchestration({
    currentContext,
    snapshot,
    sessionIndices,
    refreshRepoPolicy,
    ensureJoudoSession,
    pushTimeline,
    touch,
    queueRepoPersistence,
    publishIfCurrent,
    emitSummaryUpdated(summary) {
      emit({ type: "summary.updated", payload: summary });
    },
    sessionRuntime,
    sessionPermissionOps,
  });

  restoreLatestContextFromHistory();

  void sessionRuntime.refreshAuthState().catch((error: unknown) => {
    console.warn("[bridge] Initial auth refresh failed:", error instanceof Error ? error.message : error);
  });

  const state: MvpState = {
    getRepos() {
      return repos;
    },
    getSnapshot() {
      return snapshot();
    },
    getSessionIndex() {
      const context = currentContext();
      return context ? sessionIndices.get(context.repo.id) ?? deps.loadSessionIndex(context.repo) : null;
    },
    async getRepoInstruction(): Promise<RepoInstructionDocument | null> {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再读取 repo context。",
          retryable: true,
        });
      }

      return deps.readOrCreateRepoInstruction(context.repo, context.policy);
    },
    async addRepo(payload: RepoAddPayload): Promise<SessionSnapshot> {
      if (mutationInFlight) {
        throw new JoudoError("validation", "另一个操作正在进行中，请稍后再试。", {
          statusCode: 409,
          nextAction: "等待当前操作完成后重试。",
          retryable: true,
        });
      }

      mutationInFlight = true;
      try {
        const oldContext = currentContext();
        const nextRepo = deps.registerRepo(payload.rootPath);

        if (oldContext && oldContext.repo.id !== nextRepo.id && oldContext.lifecycle.activePrompt) {
          throw new JoudoError("validation", "当前仓库有正在运行的任务，请等待完成后再添加并切换仓库。", {
            statusCode: 409,
            nextAction: "等待当前 prompt 执行完毕，或处理当前待审批请求后重试。",
            retryable: true,
          });
        }

        if (!repoContexts.has(nextRepo.id)) {
          attachRepo(nextRepo);
        }

        currentRepoId = nextRepo.id;
        const context = currentContext();
        if (!context) {
          throw new JoudoError("validation", "新仓库上下文初始化失败。", {
            statusCode: 500,
            nextAction: "重新添加该目录；如果问题持续存在，请检查该目录是否可读写。",
            retryable: true,
          });
        }

        ensureCurrentContextSummary(context, "已添加仓库", `${context.repo.name} 已加入 Joudo 当前的仓库列表。`);
        publishCurrentSnapshot();

        if (payload.initializePolicy !== false) {
          await state.initRepoPolicy({ trusted: payload.trusted ?? false });
        }

        return snapshot();
      } finally {
        mutationInFlight = false;
      }
    },
    async initRepoPolicy(payload: RepoInitPolicyPayload = {}): Promise<RepoInitPolicyResult> {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再初始化 Joudo repo。",
          retryable: true,
        });
      }

      const initializedPolicy = deps.initializeRepoPolicy(context.repo.rootPath, payload);
      context.policy = initializedPolicy.policy;
      context.repo.policyState = initializedPolicy.policy.state;

      const instructionInit = await deps.initializeRepoInstruction(context.repo, context.policy);
      const sessionIndexInit = await deps.initializeSessionIndex(context.repo);
      sessionIndices.set(context.repo.id, sessionIndexInit.document);

      pushTimeline(context, {
        kind: "status",
        title: initializedPolicy.created ? "已初始化 Joudo repo" : "Joudo repo 已可用",
        body: initializedPolicy.created
          ? `已为 ${context.repo.name} 写入推荐的 repo policy，并准备好 Joudo 的 repo-scoped 持久化文件。`
          : `当前仓库已经存在 repo policy，Joudo 已补齐缺失的 repo 指令或会话索引文件。`,
      });

      context.summary = {
        title: initializedPolicy.created ? "已初始化当前仓库" : "当前仓库已具备 Joudo 基础文件",
        body: initializedPolicy.created
          ? "bridge 已创建推荐的 repo policy、repo 指令文件和历史会话索引。接下来可以先检查策略，再开始第一轮任务。"
          : "bridge 检查了当前仓库的 Joudo 基础文件，并补齐了缺失部分。你可以继续完善备注或直接开始使用。",
        steps: createSummarySteps({ timeline: context.timeline, status: "completed" }),
        executedCommands: context.approvalState.approvedCommands,
        ...(context.approvalState.approvedApprovalTypes.length > 0 ? { approvalTypes: context.approvalState.approvedApprovalTypes } : {}),
        changedFiles: [],
        checks: [],
        risks: createPolicyRiskMessages(context.policy),
        nextAction: "先确认推荐 policy 是否符合当前仓库边界，再完成 TOTP 绑定和第一轮 prompt。",
      };

      touch(context, context.lifecycle.activePrompt ? "running" : "idle");
      queueRepoPersistence(context);
      publishIfCurrent(context.repo.id);

      return {
        repoId: context.repo.id,
        repoPath: context.repo.rootPath,
        policyPath: initializedPolicy.path,
        instructionPath: deps.getRepoInstructionPath(context.repo.rootPath),
        sessionIndexPath: deps.getSessionIndexPath(context.repo.rootPath),
        createdPolicy: initializedPolicy.created,
        createdInstruction: instructionInit.created,
        createdSessionIndex: sessionIndexInit.created,
        policyAlreadyExisted: !initializedPolicy.created,
        instructionAlreadyExisted: !instructionInit.created,
        sessionIndexAlreadyExisted: !sessionIndexInit.created,
        snapshot: snapshot(),
        repoInstruction: instructionInit.document,
      };
    },
    async clearSessionHistory() {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再管理历史会话。",
          retryable: true,
        });
      }

      if (context.lifecycle.activePrompt || context.approvalState.approvals.length > 0 || context.status === "recovering") {
        throw new JoudoError("validation", "当前存在进行中的任务或审批，暂时不能清空历史。", {
          statusCode: 409,
          nextAction: "等待当前任务完成，或先处理待审批请求后再清空历史。",
          retryable: true,
        });
      }

      await deps.disconnectRepoSession(context);
      for (const [approvalId, repoId] of approvalRepoIndex.entries()) {
        if (repoId === context.repo.id) {
          approvalRepoIndex.delete(approvalId);
        }
      }

      const nextContext = createContext(context.repo, context.currentModel, context.currentAgent);
      nextContext.summary = createAuthSummary(nextContext.repo, authState, nextContext.policy);
      pushTimeline(nextContext, {
        kind: "status",
        title: "已清空历史会话",
        body: `当前仓库 ${nextContext.repo.name} 的历史记录和持久化快照已清空。`,
      });
      touch(nextContext, "idle");

      repoContexts.set(nextContext.repo.id, nextContext);
      sessionIndices.set(nextContext.repo.id, await deps.clearSessionHistory(nextContext.repo));
      publishIfCurrent(nextContext.repo.id);
      return snapshot();
    },
    async getSessionCheckpoint(checkpointNumber: number): Promise<SessionCheckpointDocument | null> {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再读取 checkpoint。",
          retryable: true,
        });
      }

      if (!context.turns.workspacePath) {
        throw new JoudoError("recovery", "当前会话还没有可用的 session workspace。", {
          statusCode: 404,
          nextAction: "先等待一次 compaction 生成 checkpoint，或恢复一条已有 checkpoint 的历史上下文。",
          retryable: true,
        });
      }

      const checkpoint = context.turns.checkpoints.find((item) => item.number === checkpointNumber) ?? null;
      if (!checkpoint) {
        throw new JoudoError("validation", `未找到 checkpoint #${checkpointNumber}。`, {
          statusCode: 404,
          nextAction: "刷新当前会话状态，确认有哪些可用 checkpoints 后再重试。",
          retryable: true,
        });
      }

      return deps.readWorkspaceCheckpoint(context.turns.workspacePath, checkpoint);
    },
    async rollbackLatestTurn() {
      return sessionOrchestration.rollbackLatestTurn();
    },
    async updateRepoInstruction(userNotes: string): Promise<RepoInstructionDocument | null> {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再保存 repo context。",
          retryable: true,
        });
      }

      return deps.saveRepoInstruction(context.repo, context.policy, userNotes);
    },
    async deleteRepoPolicyRule(payload: RepoPolicyRuleDeletePayload) {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再管理 repo policy 规则。",
          retryable: true,
        });
      }

      try {
        const result = deps.removePolicyRule(context.repo.rootPath, context.policy, payload.field, payload.value);
        context.policy = result.policy;
        context.repo.policyState = result.policy.state;
        context.turns.activeTurn?.pathTracker.ignoreObservedPaths([result.trackedPath]);

        if (result.removed) {
          pushTimeline(context, {
            kind: "status",
            title: "repo policy 规则已删除",
            body: `已从当前 repo policy 删除 ${payload.field} 中的规则 ${payload.value}。后续同类请求会重新按当前策略判定。`,
          });
          context.summary = {
            title: "repo policy 规则已删除",
            body: "网页端已经删除当前 repo policy 中的一条 allowlist 规则。后续同类请求会重新进入策略判定或网页审批。",
            steps: createSummarySteps({ timeline: context.timeline, status: "completed" }),
            executedCommands: context.approvalState.approvedCommands,
            approvalTypes: context.approvalState.approvedApprovalTypes,
            changedFiles: [],
            checks: [],
            risks: createPolicyRiskMessages(context.policy),
            nextAction: "确认新的 repo policy 结构是否符合预期，再继续执行下一轮任务。",
          };
          touch(context, context.lifecycle.activePrompt ? "running" : "idle");
          queueRepoPersistence(context);
          publishIfCurrent(context.repo.id);
        }

        return snapshot();
      } catch (error) {
        throw new JoudoError("policy", "无法删除当前 repo policy 规则。", {
          statusCode: 422,
          nextAction: "确认 policy 文件仍然可写且结构有效，然后重试删除。",
          retryable: true,
          ...(error instanceof Error ? { details: error.message } : {}),
        });
      }
    },
    async removeRepo(payload: RepoRemovePayload): Promise<SessionSnapshot> {
      if (mutationInFlight) {
        throw new JoudoError("validation", "另一个操作正在进行中，请稍后再试。", {
          statusCode: 409,
          nextAction: "等待当前操作完成后重试。",
          retryable: true,
        });
      }

      const context = repoContexts.get(payload.repoId) ?? null;
      if (!context) {
        throw new JoudoError("validation", `未找到仓库 ${payload.repoId}。`, {
          statusCode: 404,
          nextAction: "刷新仓库列表后重试。",
          retryable: true,
        });
      }

      if (context.lifecycle.activePrompt) {
        throw new JoudoError("validation", "当前仓库还有进行中的任务，暂时不能移除。", {
          statusCode: 409,
          nextAction: "等待当前任务完成后，再移除该仓库。",
          retryable: true,
        });
      }

      mutationInFlight = true;
      try {
        context.approvalState.pendingApprovals.clear();
        context.approvalState.approvals = [];
        context.lifecycle.activePrompt = null;

        await deps.disconnectRepoSession(context);
        for (const [approvalId, repoId] of approvalRepoIndex.entries()) {
          if (repoId === payload.repoId) {
            approvalRepoIndex.delete(approvalId);
          }
        }

        deps.removeRepo(context.repo.rootPath);
        repos = repos.filter((repo) => repo.id !== payload.repoId);
        repoContexts.delete(payload.repoId);
        sessionIndices.delete(payload.repoId);
        persistenceQueues.delete(payload.repoId);

        currentRepoId = currentRepoId === payload.repoId ? pickNextRepoId(payload.repoId) : currentRepoId;
        const nextContext = currentContext();
        if (nextContext) {
          refreshContextAgents(nextContext, { notifyIfSelectionMissing: true });
          ensureCurrentContextSummary(nextContext, "已切换仓库", `已从列表中移除 ${context.repo.name}，当前仓库切换为 ${nextContext.repo.name}。`);
        }

        publishCurrentSnapshot();
        return snapshot();
      } finally {
        mutationInFlight = false;
      }
    },
    async refreshAuth() {
      await sessionRuntime.refreshAuthState();
      const context = currentContext();
      if (context) {
        refreshContextAgents(context, { notifyIfSelectionMissing: true });
      }
      return snapshot();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      listener({ type: "bridge.ready", payload: { timestamp: new Date().toISOString() } });
      listener({ type: "session.snapshot", payload: snapshot() });
      return () => {
        listeners.delete(listener);
      };
    },
    selectRepo(repoId: string) {
      if (mutationInFlight) {
        throw new JoudoError("validation", "另一个操作正在进行中，请稍后再试。", {
          statusCode: 409,
          nextAction: "等待当前操作完成后重试。",
          retryable: true,
        });
      }
      if (!repoContexts.has(repoId)) {
        throw new JoudoError("validation", `未找到仓库 ${repoId}。`, {
          statusCode: 404,
          nextAction: "刷新仓库列表后重新选择一个有效仓库。",
          retryable: true,
        });
      }

      const oldContext = currentContext();
      if (oldContext && oldContext.repo.id !== repoId && oldContext.lifecycle.activePrompt) {
        throw new JoudoError("validation", "当前仓库有正在运行的任务，请等待完成后再切换。", {
          statusCode: 409,
          nextAction: "等待当前 prompt 执行完毕，或处理当前待审批请求后重试。",
          retryable: true,
        });
      }

      currentRepoId = repoContexts.has(repoId) ? repoId : currentRepoId;
      const context = currentContext();
      if (context) {
        refreshContextAgents(context, { notifyIfSelectionMissing: true });
        ensureCurrentContextSummary(context, "已切换仓库", `当前会话已切换到 ${context.repo.name}。`);
      }
      void sessionRuntime.refreshAuthState().catch((error: unknown) => {
        console.warn("[bridge] Auth refresh on repo switch failed:", error instanceof Error ? error.message : error);
      });
      publishCurrentSnapshot();
      return snapshot();
    },
    async setModel(model: string) {
      if (mutationInFlight) {
        throw new JoudoError("validation", "另一个操作正在进行中，请稍后再试。", {
          statusCode: 409,
          nextAction: "等待当前操作完成后重试。",
          retryable: true,
        });
      }
      mutationInFlight = true;
      try {
      const context = currentContext();
      if (!context) {
        throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
          statusCode: 404,
          nextAction: "先选择一个仓库，再切换执行模型。",
          retryable: true,
        });
      }

      if (!availableModels.includes(model)) {
        await sessionRuntime.refreshAvailableModels();
      }

      if (!availableModels.includes(model)) {
        throw new JoudoError("validation", `当前模型 ${model} 不在允许列表中。`, {
          statusCode: 400,
          nextAction: `改用这些模型之一：${availableModels.join(" / ")}。`,
          retryable: true,
        });
      }

      if (context.lifecycle.activePrompt || context.approvalState.approvals.length > 0 || context.status === "recovering") {
        throw new JoudoError("validation", "当前状态不允许切换执行模型。", {
          statusCode: 409,
          nextAction: "等待当前任务、审批或恢复流程结束后，再切换模型。",
          retryable: true,
        });
      }

      if (context.currentModel === model) {
        return snapshot();
      }

      const previousModel = context.currentModel;
      context.currentModel = model;

      let body = `后续会话将从 ${previousModel} 切换为 ${model}。`;
      if (context.lifecycle.session) {
        await deps.disconnectRepoSession(context);
        body = `${body} 当前空闲会话已断开，下一条提示词会按新模型重新创建 ACP 会话。`;
      }

      pushTimeline(context, {
        kind: "status",
        title: "已切换执行模型",
        body,
      });
      context.summary = {
        title: "执行模型已切换",
        body,
        steps: createSummarySteps({ timeline: context.timeline, status: "completed" }),
        executedCommands: [],
        changedFiles: [],
        checks: [`当前仓库默认模型已切换为 ${model}`],
        risks: createPolicyRiskMessages(context.policy),
        nextAction: "继续发送下一条提示词，bridge 会按新模型创建或续接会话。",
      };
      touch(context, "idle");
      queueRepoPersistence(context);
      publishIfCurrent(context.repo.id);
      return snapshot();
      } finally {
        mutationInFlight = false;
      }
    },
    async setAgent(agent: string | null) {
      if (mutationInFlight) {
        throw new JoudoError("validation", "另一个操作正在进行中，请稍后再试。", {
          statusCode: 409,
          nextAction: "等待当前操作完成后重试。",
          retryable: true,
        });
      }
      mutationInFlight = true;
      try {
        const context = currentContext();
        if (!context) {
          throw new JoudoError("validation", "当前没有可用的仓库上下文。", {
            statusCode: 404,
            nextAction: "先选择一个仓库，再切换执行 agent。",
            retryable: true,
          });
        }

        const nextAgent = agent?.trim() ? agent.trim() : null;
        refreshContextAgents(context, { notifyIfSelectionMissing: false });

        if (nextAgent && !context.availableAgents.includes(nextAgent)) {
          throw new JoudoError("validation", `当前 agent ${nextAgent} 不在允许列表中。`, {
            statusCode: 400,
            nextAction:
              context.availableAgents.length > 0
                ? `改用这些 agent 之一：${context.availableAgents.join(" / ")}，或切回默认模式。`
                : "当前没有可用的自定义 agent。请先在 Copilot 全局目录或当前仓库的 .github/agents 中添加它。",
            retryable: true,
          });
        }

        if (context.lifecycle.activePrompt || context.approvalState.approvals.length > 0 || context.status === "recovering") {
          throw new JoudoError("validation", "当前状态不允许切换执行 agent。", {
            statusCode: 409,
            nextAction: "等待当前任务、审批或恢复流程结束后，再切换 agent。",
            retryable: true,
          });
        }

        if (context.currentAgent === nextAgent) {
          return snapshot();
        }

        const previousAgent = context.currentAgent;
        context.currentAgent = nextAgent;

        const previousLabel = previousAgent ?? "默认模式";
        const nextLabel = nextAgent ?? "默认模式";
        let body = `后续会话将从 ${previousLabel} 切换为 ${nextLabel}。`;
        if (context.lifecycle.session) {
          await deps.disconnectRepoSession(context);
          body = `${body} 当前空闲会话已断开，下一条提示词会按新 agent 设置重新创建 ACP 会话。`;
        }

        pushTimeline(context, {
          kind: "status",
          title: "已切换执行 agent",
          body,
        });
        context.summary = {
          title: "执行 agent 已切换",
          body,
          steps: createSummarySteps({ timeline: context.timeline, status: "completed" }),
          executedCommands: [],
          changedFiles: [],
          checks: [
            nextAgent ? `当前仓库默认 agent 已切换为 ${nextAgent}` : "当前仓库已切回默认 agent 模式",
          ],
          risks: createPolicyRiskMessages(context.policy),
          nextAction: "继续发送下一条提示词，bridge 会按新的 agent 设置创建或续接会话。",
        };
        touch(context, "idle");
        queueRepoPersistence(context);
        publishIfCurrent(context.repo.id);
        return snapshot();
      } finally {
        mutationInFlight = false;
      }
    },
    async resumeHistoricalSession(joudoSessionId: string) {
      return sessionOrchestration.resumeHistoricalSession(joudoSessionId);
    },
    async recoverHistoricalSession(joudoSessionId: string) {
      return sessionOrchestration.recoverHistoricalSession(joudoSessionId);
    },
    async submitPrompt(prompt: string) {
      const context = currentContext();
      if (context) {
        await refreshContextAgentsForPrompt(context);
      }
      return sessionOrchestration.runPrompt(prompt);
    },
    async resolveApproval(approvalId: string, decision: ApprovalDecision) {
      const ownerRepoId = approvalRepoIndex.get(approvalId);
      const context = ownerRepoId ? repoContexts.get(ownerRepoId) : null;
      if (context) {
        const pendingApproval = context.approvalState.pendingApprovals.get(approvalId);
        if (!pendingApproval) {
          throw new JoudoError("approval", "该审批请求已经过期或不存在。", {
            statusCode: 404,
            nextAction: "刷新当前会话状态后重试。",
            retryable: true,
          });
        }

        approvalRepoIndex.delete(approvalId);
        context.approvalState.pendingApprovals.delete(approvalId);
        const approval = context.approvalState.approvals.find((item) => item.id === approvalId) ?? null;
        context.approvalState.approvals = context.approvalState.approvals.filter((approval) => approval.id !== approvalId);
        if (decision !== "deny") {
          const persistToPolicy = decision === "allow-and-persist";
          const approvalType = approval?.approvalType ?? describePermission(pendingApproval.request, pendingApproval.policyDecision, context.repo.rootPath).approvalType;
          let persistedRule: string | null = null;
          let persistedField: "allowShell" | "allowedPaths" | "allowedWritePaths" | null = null;
          let persistedValue: string | null = null;
          let persistedNote: string | null = null;

          if (persistToPolicy) {
            try {
              const persisted = deps.persistApprovalToPolicy(context.repo.rootPath, context.policy, pendingApproval.request);
              context.policy = persisted.policy;
              context.repo.policyState = persisted.policy.state;
              context.turns.activeTurn?.pathTracker.ignoreObservedPaths([persisted.entry.trackedPath]);
              persistedRule = persisted.entry.matchedRule;
              persistedField = persisted.entry.field;
              persistedValue = persisted.entry.entry;
              persistedNote = persisted.entry.note;
            } catch (error) {
              throw new JoudoError("policy", "无法把这条审批写入当前仓库 policy。", {
                statusCode: 422,
                nextAction: "先修复当前仓库的 repo policy，或改用“允许本次”继续当前任务。",
                retryable: true,
                ...(error instanceof Error ? { details: error.message } : {}),
              });
            }
          }

          await captureTurnWriteBaseline(context, pendingApproval.request);
          if (pendingApproval.auditId) {
            updateAuditEntry(context, pendingApproval.auditId, {
              resolution: "user-allowed",
              resolvedAt: new Date().toISOString(),
            });
          }
          if (approval?.commandPreview) {
            context.approvalState.approvedCommands.push(approval.commandPreview);
          }
          recordApprovedApprovalType(context, approvalType);
          await Promise.resolve(pendingApproval.resolve({ kind: "approved" }));
          pushTimeline(context, {
            kind: "approval-resolved",
            title: persistToPolicy ? "审批已通过并写入策略" : "审批已通过",
            body: persistToPolicy
              ? `${decisionBody(getRequestTarget(pendingApproval.request), pendingApproval.policyDecision)} 已将当前请求写入 repo allowlist。`
              : decisionBody(getRequestTarget(pendingApproval.request), pendingApproval.policyDecision),
            decision: {
              action: pendingApproval.policyDecision.action,
              resolution: "user-allowed",
              approvalType,
              ...(persistToPolicy ? { persistedToPolicy: true } : {}),
              ...(persistToPolicy && persistedField ? { persistedField } : {}),
              ...(persistToPolicy && persistedValue ? { persistedValue } : {}),
              ...(persistToPolicy ? { persistedNote } : {}),
              ...((persistedRule ?? pendingApproval.policyDecision.matchedRule)
                ? { matchedRule: persistedRule ?? pendingApproval.policyDecision.matchedRule }
                : {}),
            },
          });
          context.summary = {
            title: persistToPolicy ? "审批已通过并写入策略" : "审批已通过",
            body: persistToPolicy
              ? "网页端已经批准这次真实权限请求，并把对应规则写入当前 repo policy allowlist。Copilot 会话会继续执行。"
              : "网页端已经批准本次真实权限请求，Copilot 会话会继续执行。",
            steps: createSummarySteps({
              timeline: context.timeline,
              executedCommands: context.approvalState.approvedCommands,
              status: "blocked",
            }),
            executedCommands: context.approvalState.approvedCommands,
            approvalTypes: context.approvalState.approvedApprovalTypes,
            changedFiles: [],
            checks: [],
            risks: createPolicyRiskMessages(context.policy),
            nextAction: persistToPolicy ? "等待会话继续返回结果；后续同类请求会优先命中新的 allowlist。" : "等待会话继续返回结果。",
          };
        } else {
          if (pendingApproval.auditId) {
            updateAuditEntry(context, pendingApproval.auditId, {
              resolution: "user-denied",
              resolvedAt: new Date().toISOString(),
            });
          }
          await Promise.resolve(pendingApproval.resolve({ kind: "denied-interactively-by-user" }));
          pushTimeline(context, {
            kind: "approval-resolved",
            title: "审批已拒绝",
            body: decisionBody(getRequestTarget(pendingApproval.request), pendingApproval.policyDecision),
            decision: {
              action: pendingApproval.policyDecision.action,
              resolution: "user-denied",
              approvalType: approval?.approvalType ?? describePermission(pendingApproval.request, pendingApproval.policyDecision, context.repo.rootPath).approvalType,
              persistedToPolicy: false,
              ...(pendingApproval.policyDecision.matchedRule ? { matchedRule: pendingApproval.policyDecision.matchedRule } : {}),
            },
          });
          context.summary = {
            title: "审批已拒绝",
            body: "网页端已经拒绝这次真实权限请求，本轮任务可能会根据拒绝结果停止或改写计划。",
            steps: createSummarySteps({ timeline: context.timeline, status: "failed" }),
            executedCommands: context.approvalState.approvedCommands,
            approvalTypes: context.approvalState.approvedApprovalTypes,
            changedFiles: [],
            checks: [],
            risks: ["本轮任务可能因为关键权限被拒绝而无法继续完成", ...createPolicyRiskMessages(context.policy)],
            nextAction: "等待 Copilot 会话根据拒绝结果返回新的说明。",
          };
        }

        touch(context, context.lifecycle.activePrompt ? "running" : "idle");
        queueRepoPersistence(context);
        publishIfCurrent(context.repo.id);
        return snapshot();
      }

      throw new JoudoError("approval", `未找到审批 ${approvalId}，它可能已经被处理或失效。`, {
        statusCode: 404,
        nextAction: "刷新当前会话状态，确认还剩哪些待处理审批，然后再继续。",
        retryable: true,
      });
    },
    async dispose() {
      const pendingWrites = Array.from(repoContexts.values()).map(async (context) => {
        if (!context.lifecycle.joudoSessionId) {
          return;
        }

        const finalStatus: PersistedSessionStatus =
          context.status === "running" || context.status === "awaiting-approval" ? "interrupted" : context.status;
        queueRepoPersistence(context, { statusOverride: finalStatus, currentSessionId: null });
      });

      await Promise.all(pendingWrites);
      await Promise.all(Array.from(persistenceQueues.values()).map((task) => task.catch(() => undefined)));

      for (const context of repoContexts.values()) {
        await deps.disconnectRepoSession(context);
      }

      await sessionRuntime.stopClient();
    },
  };

  return state;
}

function findMostRecentlyActiveRepoId(repos: RepoDescriptor[], sessionIndices: Map<string, SessionIndexDocument>): string | null {
  const latest = repos
    .map((repo) => ({
      repoId: repo.id,
      updatedAt: sessionIndices.get(repo.id)?.updatedAt ?? null,
      sessionCount: sessionIndices.get(repo.id)?.sessions.length ?? 0,
    }))
    .filter((entry) => entry.updatedAt && entry.sessionCount > 0)
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0];

  return latest?.repoId ?? null;
}
