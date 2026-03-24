import type {
  BridgeErrorResponse,
  BridgeOperationError,
  SessionSnapshot,
} from "@joudo/shared";

export const bridgeOrigin = import.meta.env.VITE_BRIDGE_ORIGIN ?? `http://${window.location.hostname}:8787`;
export const bridgeSocketOrigin = bridgeOrigin.replace("http://", "ws://").replace("https://", "wss://");

const AUTH_TOKEN_KEY = "joudo_auth_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export type ErrorState = {
  error: BridgeOperationError;
  retryLabel?: string;
  retry?: () => Promise<void>;
};

export type RefreshRepoScopedStateOptions = {
  preserveUnsavedInstructionDraft?: boolean;
};

export class BridgeClientError extends Error {
  readonly operationError: BridgeOperationError;

  constructor(operationError: BridgeOperationError) {
    super(operationError.message);
    this.name = "BridgeClientError";
    this.operationError = operationError;
  }
}

export const emptySnapshot: SessionSnapshot = {
  sessionId: "mvp-session",
  status: "disconnected",
  repo: null,
  policy: null,
  model: "gpt-5-mini",
  availableModels: ["gpt-5-mini"],
  agent: null,
  availableAgents: [],
  agentCatalog: {
    globalCount: 0,
    repoCount: 0,
    totalCount: 0,
  },
  auth: {
    status: "unknown",
    message: "正在检查 Copilot CLI 登录状态。",
  },
  lastPrompt: null,
  approvals: [],
  timeline: [],
  auditLog: [],
  activity: null,
  summary: null,
  updatedAt: new Date(0).toISOString(),
};

function normalizeSummary(summary: SessionSnapshot["summary"]): SessionSnapshot["summary"] {
  if (!summary || typeof summary !== "object") {
    return null;
  }

  return {
    title: typeof summary.title === "string" && summary.title.length > 0 ? summary.title : "已恢复执行摘要",
    body: typeof summary.body === "string" ? summary.body : "",
    steps: Array.isArray(summary.steps) ? summary.steps : [],
    executedCommands: Array.isArray(summary.executedCommands) ? summary.executedCommands : [],
    approvalTypes: Array.isArray(summary.approvalTypes) ? summary.approvalTypes : [],
    changedFiles: Array.isArray(summary.changedFiles) ? summary.changedFiles : [],
    checks: Array.isArray(summary.checks) ? summary.checks : [],
    risks: Array.isArray(summary.risks) ? summary.risks : [],
    nextAction:
      typeof summary.nextAction === "string" && summary.nextAction.length > 0
        ? summary.nextAction
        : "先查看本轮已恢复的摘要和时间线，再决定是否继续下一步。",
  };
}

export function normalizeSnapshot(next: SessionSnapshot | null | undefined): SessionSnapshot {
  if (!next || typeof next !== "object") {
    return emptySnapshot;
  }

  const approvals = Array.isArray(next.approvals) ? next.approvals : [];
  const timeline = Array.isArray(next.timeline) ? next.timeline : [];
  const auditLog = Array.isArray(next.auditLog) ? next.auditLog : [];
  const availableModels = Array.isArray(next.availableModels) && next.availableModels.length > 0
    ? next.availableModels
    : emptySnapshot.availableModels;
  const availableAgents = Array.isArray(next.availableAgents)
    ? next.availableAgents.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
    : emptySnapshot.availableAgents;
  const agentCatalog = next.agentCatalog && typeof next.agentCatalog === "object"
    ? {
        globalCount:
          typeof next.agentCatalog.globalCount === "number" && Number.isFinite(next.agentCatalog.globalCount)
            ? next.agentCatalog.globalCount
            : emptySnapshot.agentCatalog.globalCount,
        repoCount:
          typeof next.agentCatalog.repoCount === "number" && Number.isFinite(next.agentCatalog.repoCount)
            ? next.agentCatalog.repoCount
            : emptySnapshot.agentCatalog.repoCount,
        totalCount:
          typeof next.agentCatalog.totalCount === "number" && Number.isFinite(next.agentCatalog.totalCount)
            ? next.agentCatalog.totalCount
            : emptySnapshot.agentCatalog.totalCount,
      }
    : emptySnapshot.agentCatalog;

  return {
    ...emptySnapshot,
    ...next,
    sessionId: typeof next.sessionId === "string" && next.sessionId.length > 0 ? next.sessionId : emptySnapshot.sessionId,
    model: typeof next.model === "string" && next.model.length > 0 ? next.model : emptySnapshot.model,
    agent: typeof next.agent === "string" && next.agent.length > 0 ? next.agent : null,
    updatedAt: typeof next.updatedAt === "string" && next.updatedAt.length > 0 ? next.updatedAt : new Date().toISOString(),
    approvals,
    timeline,
    auditLog,
    availableModels,
    availableAgents,
    agentCatalog,
    summary: normalizeSummary(next.summary),
    auth: next.auth && typeof next.auth === "object"
      ? {
          status:
            next.auth.status === "authenticated" || next.auth.status === "unauthenticated" || next.auth.status === "unknown"
              ? next.auth.status
              : emptySnapshot.auth.status,
          message: typeof next.auth.message === "string" ? next.auth.message : emptySnapshot.auth.message,
        }
      : emptySnapshot.auth,
  };
}

function isBridgeErrorResponse(value: unknown): value is BridgeErrorResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as BridgeErrorResponse;
  return Boolean(candidate.error && typeof candidate.error.code === "string" && typeof candidate.error.message === "string");
}

export async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  try {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(input, {
      ...init,
      headers,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      if (response.status === 401) {
        clearStoredToken();
        window.dispatchEvent(new Event("joudo:auth-expired"));
      }

      if (payload && isBridgeErrorResponse(payload)) {
        throw new BridgeClientError(payload.error);
      }

      throw new BridgeClientError({
        code: "unknown",
        message: `Request failed with ${response.status}`,
        nextAction: "稍后重试；如果问题持续出现，再检查 bridge 日志。",
        retryable: true,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof BridgeClientError) {
      throw error;
    }

    const details = error instanceof Error ? error.message : undefined;

    throw new BridgeClientError({
      code: "network",
      message: "无法连接 Joudo bridge。",
      nextAction: "确认 bridge 进程仍在运行、当前端口可访问，然后重试。",
      retryable: true,
      ...(details ? { details } : {}),
    });
  }
}

export function toErrorState(error: unknown, fallback: BridgeOperationError, retry?: () => Promise<void>, retryLabel?: string): ErrorState {
  if (error instanceof BridgeClientError) {
    return {
      error: error.operationError,
      ...(retry ? { retry } : {}),
      ...(retryLabel ? { retryLabel } : {}),
    };
  }

  return {
    error: {
      ...fallback,
      ...(error instanceof Error ? { details: error.message } : {}),
    },
    ...(retry ? { retry } : {}),
    ...(retryLabel ? { retryLabel } : {}),
  };
}
