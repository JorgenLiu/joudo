import type { CopilotAuthState, SessionStatus, SessionSummary, SessionTimelineEntry } from "@joudo/shared";

import { CopilotClient } from "../copilot-sdk.js";
import { JoudoError } from "../errors.js";
import type {
  CopilotSession,
  PermissionRequest,
  PermissionRequestResult,
  ResumeSessionConfig,
  SessionConfig,
} from "../copilot-sdk.js";
import { loadWorkspaceCheckpoints, summarizeCompactionContent } from "./checkpoints.js";
import { createAssistantSummary, createAuthSummary, createErrorSummary } from "./summaries.js";
import type { RepoContext } from "./types.js";

export type CopilotClientLike = {
  start: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  getAuthStatus: () => Promise<{ isAuthenticated: boolean; statusMessage?: string }>;
  listModels?: () => Promise<Array<{ id: string }>>;
  createSession: (config: SessionConfig) => Promise<CopilotSession>;
  resumeSession: (sessionId: string, config: ResumeSessionConfig) => Promise<CopilotSession>;
  listSessions: (filter?: { cwd?: string }) => Promise<Array<{ sessionId: string }>>;
};

export type CreateClientFactory = (cwd: string) => CopilotClientLike;

type ClientRuntimeRef = {
  client: CopilotClientLike | null;
  clientStartPromise: Promise<unknown> | null;
};

type SessionRuntimeDeps = {
  clientRuntimeRef: ClientRuntimeRef;
  createClient: CreateClientFactory | undefined;
  currentContext: () => RepoContext | null;
  repoContexts: Map<string, RepoContext>;
  getAuthState: () => CopilotAuthState;
  setAuthState: (authState: CopilotAuthState) => void;
  getAvailableModels: () => string[];
  setAvailableModels: (models: string[]) => void;
  refreshRepoPolicy: (context: RepoContext) => void;
  queuePersistence: (context: RepoContext) => void;
  pushTimelineEntry: (
    context: RepoContext,
    entry: Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string },
  ) => void;
  touch: (context: RepoContext, nextStatus: SessionStatus) => void;
  publishCurrentSnapshot: () => void;
  publishIfCurrent: (repoId: string) => void;
  emitSummaryUpdated: (summary: SessionSummary) => void;
  handlePermissionRequest: (context: RepoContext, request: PermissionRequest) => Promise<PermissionRequestResult>;
};

function normalizeAuthState(auth: { isAuthenticated: boolean; statusMessage?: string }): CopilotAuthState {
  return auth.isAuthenticated
    ? {
        status: "authenticated",
        message: auth.statusMessage || "Copilot CLI 已登录。",
      }
    : {
        status: "unauthenticated",
        message: auth.statusMessage || "Copilot CLI 尚未登录。",
      };
}

export function createSessionRuntime(deps: SessionRuntimeDeps) {
  async function refreshAvailableModels() {
    try {
      const activeClient = await ensureClient();
      const models = activeClient.listModels ? await activeClient.listModels() : [];
      const nextModels = models.map((model) => model.id).filter(Boolean);

      if (nextModels.length > 0) {
        deps.setAvailableModels(nextModels);
        deps.publishCurrentSnapshot();
      }
    } catch {
      // Keep configured fallback models if runtime discovery fails.
    }

    return deps.getAvailableModels();
  }

  async function refreshWorkspaceCheckpointState(context: RepoContext, session: CopilotSession) {
    const workspacePath = session.workspacePath ?? null;
    context.turns.workspacePath = workspacePath;
    context.turns.checkpoints = await loadWorkspaceCheckpoints(workspacePath);
  }

  function createSessionConfig(context: RepoContext) {
    return {
      workingDirectory: context.repo.rootPath,
      onPermissionRequest: (request: PermissionRequest) => deps.handlePermissionRequest(context, request),
      streaming: true,
      model: context.currentModel,
      ...(context.currentAgent ? { agent: context.currentAgent } : {}),
    };
  }

  async function ensureClient() {
    if (deps.clientRuntimeRef.clientStartPromise) {
      await deps.clientRuntimeRef.clientStartPromise;
      if (!deps.clientRuntimeRef.client) {
        throw new Error("Copilot client 初始化失败。");
      }

      return deps.clientRuntimeRef.client;
    }

    // Claim the promise slot first to prevent concurrent calls from entering
    let resolveStart!: () => void;
    let rejectStart!: (err: unknown) => void;
    const startPromise = new Promise<void>((res, rej) => {
      resolveStart = res;
      rejectStart = rej;
    });
    // Prevent unhandled-rejection when no concurrent caller is waiting on this slot.
    startPromise.catch(() => {});
    deps.clientRuntimeRef.clientStartPromise = startPromise;

    try {
      const nextClient =
        deps.createClient?.(deps.currentContext()?.repo.rootPath ?? process.cwd()) ??
        new CopilotClient({
          cwd: deps.currentContext()?.repo.rootPath ?? process.cwd(),
          logLevel: "error",
        });
      deps.clientRuntimeRef.client = nextClient;
      await nextClient.start();
      resolveStart();
      return nextClient;
    } catch (error) {
      deps.clientRuntimeRef.clientStartPromise = null;
      deps.clientRuntimeRef.client = null;
      rejectStart(error);
      throw error;
    }
  }

  async function refreshAuthState() {
    try {
      const activeClient = await ensureClient();
      const auth = await activeClient.getAuthStatus();
      deps.setAuthState(normalizeAuthState(auth));

      if (auth.isAuthenticated) {
        await refreshAvailableModels();
      }
    } catch (error) {
      deps.setAuthState({
        status: "unknown",
        message: error instanceof Error ? error.message : "无法检查 Copilot CLI 状态。",
      });
    }

    for (const context of deps.repoContexts.values()) {
      if (context.lifecycle.session === null && context.lifecycle.joudoSessionId === null) {
        context.summary = createAuthSummary(context.repo, deps.getAuthState(), context.policy);
        context.updatedAt = new Date().toISOString();
      }
    }

    deps.publishCurrentSnapshot();
    return deps.getAuthState();
  }

  function bindSession(repoId: string, context: RepoContext, session: CopilotSession) {
    context.lifecycle.subscriptions.forEach((unsubscribe) => unsubscribe());
    context.lifecycle.subscriptions = [];
    context.lifecycle.session = session;
    context.lifecycle.lastKnownCopilotSessionId = session.sessionId;
    context.turns.workspacePath = session.workspacePath ?? null;
    context.turns.checkpoints = [];
    context.turns.latestCompaction = null;
    deps.queuePersistence(context);

    void refreshWorkspaceCheckpointState(context, session)
      .then(() => {
        deps.queuePersistence(context);
        deps.publishIfCurrent(repoId);
      })
      .catch((error) => {
        console.warn("Failed to load session workspace checkpoints", error);
      });

    context.lifecycle.subscriptions.push(
      session.on("assistant.message", (event) => {
        context.latestAssistantMessage = event.data.content;
        deps.pushTimelineEntry(context, {
          kind: "assistant",
          title: "Copilot 已回复",
          body: event.data.content,
        });
        context.summary = createAssistantSummary(
          context.repo,
          context.lastPrompt ?? "当前任务",
          event.data.content,
          context.approvalState.approvedCommands,
          context.approvalState.approvedApprovalTypes,
          context.turns.latestTurn?.changedFiles.map((item) => item.path) ?? [],
          context.policy,
          context.timeline,
        );
        deps.queuePersistence(context);
        deps.emitSummaryUpdated(context.summary);
        deps.publishIfCurrent(repoId);
      }),
    );

    context.lifecycle.subscriptions.push(
      session.on("session.error", (event) => {
        deps.pushTimelineEntry(context, {
          kind: "error",
          title: "会话发生错误",
          body: event.data.message,
        });
        context.summary = createErrorSummary(event.data.message);
        deps.touch(context, context.approvalState.approvals.length > 0 ? "awaiting-approval" : "idle");
        deps.queuePersistence(context);
        deps.publishIfCurrent(repoId);
      }),
    );

    context.lifecycle.subscriptions.push(
      session.on("session.compaction_complete", async (event) => {
        try {
          await refreshWorkspaceCheckpointState(context, session);

          const summaryPreview = summarizeCompactionContent(event.data.summaryContent);

          context.turns.latestCompaction = {
            completedAt: event.timestamp,
            messagesRemoved: event.data.messagesRemoved ?? 0,
            tokensRemoved: event.data.tokensRemoved ?? 0,
            ...(event.data.checkpointNumber === undefined ? {} : { checkpointNumber: event.data.checkpointNumber }),
            ...(event.data.checkpointPath ? { checkpointPath: event.data.checkpointPath } : {}),
            ...(summaryPreview ? { summaryPreview } : {}),
          };

          const latestCheckpoint =
            event.data.checkpointNumber === undefined
              ? null
              : context.turns.checkpoints.find((checkpoint) => checkpoint.number === event.data.checkpointNumber) ?? null;
          const checkpointLabel = latestCheckpoint
            ? `${latestCheckpoint.number}. ${latestCheckpoint.title}`
            : event.data.checkpointNumber === undefined
              ? "本次会话压缩"
              : `checkpoint ${event.data.checkpointNumber}`;

          deps.pushTimelineEntry(context, {
            kind: "status",
            title: "已生成会话 checkpoint",
            body: `Compaction 已生成 ${checkpointLabel}，本次压缩移除了 ${event.data.messagesRemoved ?? 0} 条消息，释放了 ${event.data.tokensRemoved ?? 0} tokens。`,
            timestamp: event.timestamp,
          });
          deps.queuePersistence(context);
          deps.publishIfCurrent(repoId);
        } catch (error) {
          console.warn("Failed to process session compaction event", error);
        }
      }),
    );

    context.lifecycle.subscriptions.push(
      session.on("session.idle", () => {
        if (context.lifecycle.activePrompt === null && context.approvalState.approvals.length === 0) {
          deps.touch(context, "idle");
          deps.queuePersistence(context);
          deps.publishIfCurrent(repoId);
        }
      }),
    );
  }

  async function ensureSession(context: RepoContext) {
    if (context.lifecycle.session) {
      return context.lifecycle.session;
    }

    deps.refreshRepoPolicy(context);

    const currentAuth = await refreshAuthState();
    if (currentAuth.status !== "authenticated") {
      throw new JoudoError("auth", currentAuth.message || "Copilot CLI 尚未登录。请先执行 copilot login。", {
        statusCode: 401,
        nextAction: "先在宿主机终端执行 copilot login，再重新发送当前任务。",
        retryable: true,
      });
    }

    const activeClient = await ensureClient();
    const session = await activeClient.createSession(createSessionConfig(context));

    bindSession(context.repo.id, context, session);
    return session;
  }

  async function stopClient() {
    if (deps.clientRuntimeRef.client) {
      await deps.clientRuntimeRef.client.stop();
    }
  }

  return {
    createSessionConfig,
    ensureClient,
    refreshAuthState,
    refreshAvailableModels,
    bindSession,
    ensureSession,
    stopClient,
  };
}

export type SessionRuntime = ReturnType<typeof createSessionRuntime>;