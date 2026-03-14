import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ApprovalDecision,
  ApprovalRequest,
  CopilotAuthState,
  RepoDescriptor,
  ServerEvent,
  SessionSnapshot,
  SessionSummary,
  SessionStatus,
  SessionTimelineEntry,
} from "@joudo/shared";

import { CopilotClient } from "./copilot-sdk.js";
import type { CopilotSession, PermissionRequest, PermissionRequestResult } from "./copilot-sdk.js";

type Listener = (event: ServerEvent) => void;

type PendingApproval = {
  resolve: (result: PermissionRequestResult) => void;
};

type RepoContext = {
  repo: RepoDescriptor;
  session: CopilotSession | null;
  status: SessionStatus;
  lastPrompt: string | null;
  approvals: ApprovalRequest[];
  timeline: SessionTimelineEntry[];
  summary: SessionSummary | null;
  updatedAt: string;
  latestAssistantMessage: string | null;
  approvedCommands: string[];
  pendingApprovals: Map<string, PendingApproval>;
  activePrompt: Promise<void> | null;
  subscriptions: Array<() => void>;
};

const DEFAULT_AUTH: CopilotAuthState = {
  status: "unknown",
  message: "正在检查 Copilot CLI 登录状态。",
};

const WORKSPACE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_MODEL = process.env.JOUDO_MODEL ?? "gpt-5-mini";
const TIMELINE_LIMIT = 24;

function detectPolicyState(rootPath: string): RepoDescriptor["policyState"] {
  const candidates = [
    join(rootPath, ".github", "joudo-policy.yml"),
    join(rootPath, ".github", "joudo-policy.yaml"),
    join(rootPath, ".github", "policy.yml"),
    join(rootPath, ".github", "policy.yaml"),
  ];

  return candidates.some((candidate) => existsSync(candidate)) ? "loaded" : "missing";
}

function createRepoId(rootPath: string, index: number): string {
  const stem = basename(rootPath).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || `repo-${index + 1}`;
  return `${stem}-${index + 1}`;
}

function buildRepos(): RepoDescriptor[] {
  const homeDir = process.env.HOME ? resolve(process.env.HOME) : null;
  const configuredRoot = process.env.JOUDO_REPO_ROOT ? resolve(process.env.JOUDO_REPO_ROOT) : null;
  const extraRoots = (process.env.JOUDO_EXTRA_REPOS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
  const candidates = [
    ...(homeDir ? [resolve(homeDir, "dev", "demo")] : []),
    ...(configuredRoot ? [configuredRoot] : [resolve(WORKSPACE_ROOT)]),
    ...extraRoots,
  ];
  const uniqueRoots = [...new Set(candidates)].filter((rootPath) => existsSync(rootPath));

  return uniqueRoots.map((rootPath, index) => ({
    id: createRepoId(rootPath, index),
    name: basename(rootPath) || `repo-${index + 1}`,
    rootPath,
    trusted: true,
    policyState: detectPolicyState(rootPath),
  }));
}

function createInitialSummary(repo: RepoDescriptor): SessionSummary {
  return {
    title: "等待真实 ACP 会话",
    body: `${repo.name} 已经进入 Joudo 的受信任仓库列表。下一步会在这个仓库上启动真实 Copilot 会话。`,
    executedCommands: [],
    changedFiles: [],
    checks: [],
    risks: repo.policyState === "missing" ? ["当前仓库还没有可执行的 repo policy 文件"] : [],
    nextAction: "发送提示词，验证真实 ACP 会话、审批流和网页摘要是否能闭环。",
  };
}

function createQueuedSummary(prompt: string): SessionSummary {
  return {
    title: "提示词已入队",
    body: `真实 Copilot 会话正在处理这条提示词：${prompt}`,
    executedCommands: [],
    changedFiles: [],
    checks: [],
    risks: [],
    nextAction: "等待会话返回摘要，或处理中途发出的审批请求。",
  };
}

function createAuthSummary(repo: RepoDescriptor, auth: CopilotAuthState): SessionSummary {
  return {
    title: auth.status === "authenticated" ? "Copilot CLI 已就绪" : "Copilot CLI 尚未登录",
    body:
      auth.status === "authenticated"
        ? `已经可以在 ${repo.name} 上创建真实 ACP 会话。`
        : auth.message,
    executedCommands: [],
    changedFiles: [],
    checks: [],
    risks: auth.status === "authenticated" ? [] : ["未完成认证前，bridge 无法创建真实 Copilot 会话"],
    nextAction:
      auth.status === "authenticated"
        ? "直接发送提示词开始真实会话。"
        : "先在终端完成 copilot login，再回到网页继续发送提示词。",
  };
}

function createAssistantSummary(repo: RepoDescriptor, prompt: string, message: string, approvedCommands: string[]): SessionSummary {
  return {
    title: "真实会话已返回结果",
    body: message,
    executedCommands: approvedCommands,
    changedFiles: [],
    checks: [],
    risks: repo.policyState === "missing" ? ["当前还没有 policy 文件，后续应补上 allow/confirm/deny 规则"] : [],
    nextAction: `继续围绕“${prompt}”推进下一步，或开始为 ${repo.name} 补充 repo policy。`,
  };
}

function createErrorSummary(message: string): SessionSummary {
  return {
    title: "真实会话执行失败",
    body: message,
    executedCommands: [],
    changedFiles: [],
    checks: [],
    risks: ["当前会话没有完成本轮任务，需要先排除 bridge 或认证问题"],
    nextAction: "检查 Copilot 登录状态、仓库权限和本轮 prompt 内容后再重试。",
  };
}

function describePermission(request: PermissionRequest): ApprovalRequest {
  if (request.kind === "shell") {
    const commandPreview = typeof request.fullCommandText === "string" ? request.fullCommandText : "shell command";
    const rationale = typeof request.intention === "string" ? request.intention : "Copilot 请求执行一个 shell 命令。";
    const commands = Array.isArray(request.commands) ? request.commands : [];
    const allReadOnly = commands.every((command) => typeof command === "object" && command !== null && command.readOnly === true);
    return {
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: allReadOnly ? "需要确认只读 shell 操作" : "需要确认高风险 shell 操作",
      rationale,
      riskLevel: allReadOnly ? "medium" : "high",
      requestedAt: new Date().toISOString(),
      commandPreview,
    };
  }

  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `需要确认 ${request.kind} 权限`,
    rationale: `Copilot 请求 ${request.kind} 权限。当前 bridge 会把这次请求转成网页审批。`,
    riskLevel: request.kind === "read" ? "medium" : "high",
    requestedAt: new Date().toISOString(),
    commandPreview: request.kind,
  };
}

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

function createRepoContext(repo: RepoDescriptor): RepoContext {
  const timestamp = new Date().toISOString();
  return {
    repo,
    session: null,
    status: "idle",
    lastPrompt: null,
    approvals: [],
    timeline: [
      {
        id: `status-${timestamp}`,
        kind: "status",
        title: "仓库已就绪",
        body: `${repo.name} 已进入 Joudo 的受信任仓库列表，等待第一条真实提示词。`,
        timestamp,
      },
    ],
    summary: createInitialSummary(repo),
    updatedAt: timestamp,
    latestAssistantMessage: null,
    approvedCommands: [],
    pendingApprovals: new Map(),
    activePrompt: null,
    subscriptions: [],
  };
}

export function createMvpState() {
  const repos = buildRepos();
  const listeners = new Set<Listener>();
  const repoContexts = new Map(repos.map((repo) => [repo.id, createRepoContext(repo)]));

  let currentRepoId = repos[0]?.id ?? null;
  let authState: CopilotAuthState = DEFAULT_AUTH;
  let client: CopilotClient | null = null;
  let clientStartPromise: Promise<void> | null = null;

  function currentContext(): RepoContext | null {
    return currentRepoId ? repoContexts.get(currentRepoId) ?? null : null;
  }

  function snapshot(): SessionSnapshot {
    const context = currentContext();
    return {
      sessionId: context?.session?.sessionId ?? "pending-session",
      status: context?.status ?? "disconnected",
      repo: context?.repo ?? null,
      model: DEFAULT_MODEL,
      auth: authState,
      lastPrompt: context?.lastPrompt ?? null,
      approvals: context?.approvals ?? [],
      timeline: context?.timeline ?? [],
      summary: context?.summary ?? null,
      updatedAt: context?.updatedAt ?? new Date().toISOString(),
    };
  }

  function emit(event: ServerEvent) {
    listeners.forEach((listener) => listener(event));
  }

  function touch(context: RepoContext, nextStatus: SessionStatus) {
    context.status = nextStatus;
    context.updatedAt = new Date().toISOString();
  }

  function pushTimelineEntry(context: RepoContext, entry: Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string }) {
    const timestamp = entry.timestamp ?? new Date().toISOString();
    context.timeline = [
      {
        id: `${entry.kind}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
        ...entry,
      },
      ...context.timeline,
    ].slice(0, TIMELINE_LIMIT);
    context.updatedAt = timestamp;
  }

  function publishCurrentSnapshot() {
    emit({ type: "session.snapshot", payload: snapshot() });
  }

  function publishIfCurrent(repoId: string) {
    if (currentRepoId === repoId) {
      publishCurrentSnapshot();
    }
  }

  async function ensureClient() {
    if (clientStartPromise) {
      await clientStartPromise;
      return client!;
    }

    client = new CopilotClient({
      cwd: currentContext()?.repo.rootPath ?? process.cwd(),
      logLevel: "error",
    });
    clientStartPromise = client.start();

    try {
      await clientStartPromise;
      return client;
    } catch (error) {
      clientStartPromise = null;
      client = null;
      throw error;
    }
  }

  async function refreshAuthState() {
    try {
      const activeClient = await ensureClient();
      const auth = await activeClient.getAuthStatus();
      authState = normalizeAuthState(auth);
    } catch (error) {
      authState = {
        status: "unknown",
        message: error instanceof Error ? error.message : "无法检查 Copilot CLI 状态。",
      };
    }

    for (const context of repoContexts.values()) {
      if (context.session === null && context.summary?.title !== "真实会话已返回结果") {
        context.summary = createAuthSummary(context.repo, authState);
        context.updatedAt = new Date().toISOString();
      }
    }

    publishCurrentSnapshot();
    return authState;
  }

  function bindSession(repoId: string, context: RepoContext, session: CopilotSession) {
    context.subscriptions.forEach((unsubscribe) => unsubscribe());
    context.subscriptions = [];
    context.session = session;

    context.subscriptions.push(
      session.on("assistant.message", (event) => {
        context.latestAssistantMessage = event.data.content;
        context.summary = createAssistantSummary(context.repo, context.lastPrompt ?? "当前任务", event.data.content, context.approvedCommands);
        pushTimelineEntry(context, {
          kind: "assistant",
          title: "Copilot 已回复",
          body: event.data.content,
        });
        emit({ type: "summary.updated", payload: context.summary });
        publishIfCurrent(repoId);
      }),
    );

    context.subscriptions.push(
      session.on("session.error", (event) => {
        context.summary = createErrorSummary(event.data.message);
        pushTimelineEntry(context, {
          kind: "error",
          title: "会话发生错误",
          body: event.data.message,
        });
        touch(context, context.approvals.length > 0 ? "awaiting-approval" : "idle");
        publishIfCurrent(repoId);
      }),
    );

    context.subscriptions.push(
      session.on("session.idle", () => {
        if (context.activePrompt === null && context.approvals.length === 0) {
          touch(context, "idle");
          publishIfCurrent(repoId);
        }
      }),
    );
  }

  async function ensureSession(context: RepoContext) {
    if (context.session) {
      return context.session;
    }

    const currentAuth = await refreshAuthState();
    if (currentAuth.status !== "authenticated") {
      throw new Error(currentAuth.message || "Copilot CLI 尚未登录。请先执行 copilot login。");
    }

    const activeClient = await ensureClient();
    const session = await activeClient.createSession({
      workingDirectory: context.repo.rootPath,
      onPermissionRequest: (request) => {
        const approval = describePermission(request);
        context.approvals = [...context.approvals, approval];
        context.summary = {
          title: "等待真实权限审批",
          body: `Copilot 在 ${context.repo.name} 上发起了真实权限请求，当前已转到网页审批。`,
          executedCommands: context.approvedCommands,
          changedFiles: [],
          checks: [],
          risks: [`当前请求类型：${request.kind}`],
          nextAction: "在网页端批准或拒绝该请求，然后等待会话继续。",
        };
        pushTimelineEntry(context, {
          kind: "approval-requested",
          title: approval.title,
          body: approval.commandPreview,
        });
        touch(context, "awaiting-approval");
        emit({ type: "approval.requested", payload: approval });
        publishIfCurrent(context.repo.id);

        return new Promise<PermissionRequestResult>((resolve) => {
          context.pendingApprovals.set(approval.id, { resolve });
        });
      },
      streaming: true,
      model: DEFAULT_MODEL,
    });

    bindSession(context.repo.id, context, session);
    return session;
  }

  async function runPrompt(context: RepoContext, prompt: string) {
    if (context.activePrompt) {
      context.summary = {
        title: "已有任务执行中",
        body: "当前仓库已经有一条真实会话在运行，请等本轮完成后再发送下一条提示词。",
        executedCommands: context.approvedCommands,
        changedFiles: [],
        checks: [],
        risks: [],
        nextAction: "等待当前任务完成，或处理当前待审批请求。",
      };
      publishIfCurrent(context.repo.id);
      return;
    }

    context.lastPrompt = prompt;
    context.summary = createQueuedSummary(prompt);
    pushTimelineEntry(context, {
      kind: "prompt",
      title: "已发送提示词",
      body: prompt,
    });
    touch(context, "running");
    publishIfCurrent(context.repo.id);

    try {
      const session = await ensureSession(context);
      context.activePrompt = session
        .sendAndWait({ prompt }, 15 * 60 * 1000)
        .then((event) => {
          if (event?.data.content) {
            context.latestAssistantMessage = event.data.content;
            context.summary = createAssistantSummary(context.repo, prompt, event.data.content, context.approvedCommands);
            emit({ type: "summary.updated", payload: context.summary });
          } else {
            context.summary = {
              title: "本轮任务已完成",
              body: "Copilot 会话已经回到空闲状态，但这一轮没有返回可展示的 assistant.message。",
              executedCommands: context.approvedCommands,
              changedFiles: [],
              checks: [],
              risks: [],
              nextAction: "继续发送下一条提示词，或检查事件流里是否有被过滤掉的结果。",
            };
          }
        })
        .catch((error) => {
          context.summary = createErrorSummary(error instanceof Error ? error.message : "真实会话执行失败");
          pushTimelineEntry(context, {
            kind: "error",
            title: "提示词执行失败",
            body: error instanceof Error ? error.message : "真实会话执行失败",
          });
        })
        .finally(() => {
          context.activePrompt = null;
          touch(context, context.approvals.length > 0 ? "awaiting-approval" : "idle");
          context.updatedAt = new Date().toISOString();
          publishIfCurrent(context.repo.id);
        });
    } catch (error) {
      context.summary = createErrorSummary(error instanceof Error ? error.message : "无法创建真实 Copilot 会话");
      pushTimelineEntry(context, {
        kind: "error",
        title: "无法启动真实会话",
        body: error instanceof Error ? error.message : "无法创建真实 Copilot 会话",
      });
      touch(context, "idle");
      publishIfCurrent(context.repo.id);
    }
  }

  void refreshAuthState().catch(() => undefined);

  return {
    getRepos() {
      return repos;
    },
    getSnapshot() {
      return snapshot();
    },
    async refreshAuth() {
      await refreshAuthState();
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
      currentRepoId = repoContexts.has(repoId) ? repoId : currentRepoId;
      const context = currentContext();
      if (context) {
        context.summary = createAuthSummary(context.repo, authState);
        pushTimelineEntry(context, {
          kind: "status",
          title: "已切换仓库",
          body: `当前会话已切换到 ${context.repo.name}。`,
        });
      }
      void refreshAuthState().catch(() => undefined);
      publishCurrentSnapshot();
      return snapshot();
    },
    async submitPrompt(prompt: string) {
      const context = currentContext();
      if (!context) {
        return snapshot();
      }

      await runPrompt(context, prompt);
      return snapshot();
    },
    resolveApproval(approvalId: string, decision: ApprovalDecision) {
      for (const context of repoContexts.values()) {
        const pendingApproval = context.pendingApprovals.get(approvalId);
        if (!pendingApproval) {
          continue;
        }

        context.pendingApprovals.delete(approvalId);
        const approval = context.approvals.find((item) => item.id === approvalId) ?? null;
        context.approvals = context.approvals.filter((approval) => approval.id !== approvalId);
        if (decision === "allow") {
          if (approval?.commandPreview) {
            context.approvedCommands.push(approval.commandPreview);
          }
          pendingApproval.resolve({ kind: "approved" });
          pushTimelineEntry(context, {
            kind: "approval-resolved",
            title: "审批已通过",
            body: approval?.commandPreview ?? "用户已批准本次权限请求。",
          });
          context.summary = {
            title: "审批已通过",
            body: "网页端已经批准本次真实权限请求，Copilot 会话会继续执行。",
            executedCommands: context.approvedCommands,
            changedFiles: [],
            checks: [],
            risks: [],
            nextAction: "等待会话继续返回结果。",
          };
        } else {
          pendingApproval.resolve({ kind: "denied-interactively-by-user" });
          pushTimelineEntry(context, {
            kind: "approval-resolved",
            title: "审批已拒绝",
            body: approval?.commandPreview ?? "用户已拒绝本次权限请求。",
          });
          context.summary = {
            title: "审批已拒绝",
            body: "网页端已经拒绝这次真实权限请求，本轮任务可能会根据拒绝结果停止或改写计划。",
            executedCommands: context.approvedCommands,
            changedFiles: [],
            checks: [],
            risks: ["本轮任务可能因为关键权限被拒绝而无法继续完成"],
            nextAction: "等待 Copilot 会话根据拒绝结果返回新的说明。",
          };
        }

        touch(context, context.activePrompt ? "running" : "idle");
        publishIfCurrent(context.repo.id);
        return snapshot();
      }

      return snapshot();
    },
    async dispose() {
      for (const context of repoContexts.values()) {
        context.subscriptions.forEach((unsubscribe) => unsubscribe());
        context.subscriptions = [];
        if (context.session) {
          await context.session.disconnect();
          context.session = null;
        }
      }

      if (client) {
        await client.stop();
      }
    },
  };
}
