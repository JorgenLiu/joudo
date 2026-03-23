import type { BridgeErrorCode, BridgeErrorResponse, BridgeOperationError } from "@joudo/shared";

type JoudoErrorOptions = {
  statusCode: number;
  nextAction: string;
  retryable?: boolean;
  details?: string;
};

export class JoudoError extends Error {
  readonly code: BridgeErrorCode;
  readonly statusCode: number;
  readonly nextAction: string;
  readonly retryable: boolean;
  readonly details?: string;

  constructor(code: BridgeErrorCode, message: string, options: JoudoErrorOptions) {
    super(message);
    this.name = "JoudoError";
    this.code = code;
    this.statusCode = options.statusCode;
    this.nextAction = options.nextAction;
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function toBridgeOperationError(error: JoudoError): BridgeOperationError {
  return {
    code: error.code,
    message: error.message,
    nextAction: error.nextAction,
    retryable: error.retryable,
    ...(error.details ? { details: error.details } : {}),
  };
}

export function serializeBridgeError(error: unknown): { statusCode: number; payload: BridgeErrorResponse } {
  const normalized = normalizeBridgeError(error);
  return {
    statusCode: normalized.statusCode,
    payload: {
      error: toBridgeOperationError(normalized),
    },
  };
}

export function normalizeBridgeError(error: unknown): JoudoError {
  if (error instanceof JoudoError) {
    return error;
  }

  // Phase 1: Check structured fields (code, name, type) for classification.
  // This survives SDK upgrades that change error message text.
  const structuralCode = classifyByStructuredFields(error);
  if (structuralCode) {
    return buildFromClassification(structuralCode, error);
  }

  // Phase 2: Fallback — regex match on message text.
  const message = error instanceof Error ? error.message : "发生了未知错误。";
  const regexCode = classifyByMessage(message);
  if (regexCode) {
    return buildFromClassification(regexCode, error);
  }

  // Phase 3: Unclassified → unknown
  const details = error instanceof Error && error.stack ? error.stack : undefined;
  return new JoudoError("unknown", message, {
    statusCode: 500,
    nextAction: "稍后重试；如果问题持续出现，再检查 bridge 日志。",
    retryable: true,
    ...(details ? { details } : {}),
  });
}

type ClassifiableError = { code?: string; name?: string; type?: string; [key: string]: unknown };

const STRUCTURAL_CLASSIFICATIONS: Array<{
  test: (error: ClassifiableError) => boolean;
  code: BridgeErrorCode;
}> = [
  {
    test: (error) =>
      error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM",
    code: "validation",
  },
  {
    test: (error) =>
      error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT" ||
      error.name === "TimeoutError" || error.type === "timeout",
    code: "timeout",
  },
  {
    test: (error) =>
      error.code === "ECONNREFUSED" || error.code === "ECONNRESET" ||
      error.code === "ENOTFOUND" || error.name === "FetchError" || error.type === "network",
    code: "network",
  },
  {
    test: (error) =>
      error.code === "ERR_AUTH" || error.name === "AuthenticationError" || error.type === "auth",
    code: "auth",
  },
  {
    test: (error) =>
      error.code === "ERR_SESSION_EXPIRED" || error.type === "session-expired",
    code: "session-expired",
  },
];

function classifyByStructuredFields(error: unknown): BridgeErrorCode | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as ClassifiableError;
  for (const rule of STRUCTURAL_CLASSIFICATIONS) {
    if (rule.test(candidate)) {
      return rule.code;
    }
  }

  return null;
}

const MESSAGE_CLASSIFICATIONS: Array<{ pattern: RegExp; code: BridgeErrorCode }> = [
  { pattern: /copilot cli 尚未登录|copilot cli 未登录|copilot login|尚未登录/i, code: "auth" },
  { pattern: /审批|approval/i, code: "approval" },
  { pattern: /policy/i, code: "policy" },
  { pattern: /timed?\s*out|超时|deadline|ETIMEDOUT/i, code: "timeout" },
  { pattern: /session not found|会话已失效|copilot session .*不存在/i, code: "session-expired" },
  { pattern: /历史记录缺少可恢复的快照|无法恢复历史会话|恢复/i, code: "recovery" },
  { pattern: /仓库|repo|prompt 不能为空|未选择/i, code: "validation" },
];

function classifyByMessage(message: string): BridgeErrorCode | null {
  for (const rule of MESSAGE_CLASSIFICATIONS) {
    if (rule.pattern.test(message)) {
      return rule.code;
    }
  }

  return null;
}

const ERROR_CODE_DEFAULTS: Record<BridgeErrorCode, { statusCode: number; nextAction: string }> = {
  auth: { statusCode: 401, nextAction: "先在宿主机终端完成 copilot login，然后重新执行当前操作。" },
  timeout: { statusCode: 408, nextAction: "检查这轮任务是否需要拆小，或直接重试当前操作。" },
  "session-expired": { statusCode: 409, nextAction: "重新发送 prompt 或从历史记录重新发起恢复，bridge 会创建新会话或退回只读历史记录。" },
  recovery: { statusCode: 409, nextAction: "检查历史记录是否仍然存在；如果这条记录已损坏，直接从当前上下文重新开始新一轮。" },
  policy: { statusCode: 422, nextAction: "先修复当前仓库的 repo policy，再重新执行当前操作。" },
  approval: { statusCode: 409, nextAction: "刷新当前会话状态，确认这条审批是否仍然有效，然后再重试。" },
  validation: { statusCode: 400, nextAction: "先修正当前输入或仓库选择，再重新执行这个操作。" },
  network: { statusCode: 502, nextAction: "确认网络连接正常后重试。" },
  unknown: { statusCode: 500, nextAction: "稍后重试；如果问题持续出现，再检查 bridge 日志。" },
};

function buildFromClassification(code: BridgeErrorCode, error: unknown): JoudoError {
  const message = error instanceof Error ? error.message : "发生了未知错误。";
  const defaults = ERROR_CODE_DEFAULTS[code];
  const details = error instanceof Error && error.stack ? error.stack : undefined;

  return new JoudoError(code, message, {
    statusCode: defaults.statusCode,
    nextAction: defaults.nextAction,
    retryable: true,
    ...(details ? { details } : {}),
  });
}