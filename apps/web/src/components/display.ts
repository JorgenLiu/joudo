import type {
  ActivityItemStatus,
  ActivityPhase,
  ApprovalType,
  BridgeErrorCode,
  PermissionResolution,
  PersistedSessionStatus,
  RepoPolicyRule,
  SessionSummaryStep,
  SessionStatus,
  SessionTimelineEntry,
} from "@joudo/shared";

export function bridgeErrorCodeLabel(code: BridgeErrorCode) {
  switch (code) {
    case "auth":
      return "认证失败";
    case "network":
      return "网络连接失败";
    case "policy":
      return "策略校验失败";
    case "recovery":
      return "恢复失败";
    case "timeout":
      return "请求超时";
    case "session-expired":
      return "会话已失效";
    case "approval":
      return "审批状态失效";
    case "validation":
      return "请求无效";
    default:
      return "未知错误";
  }
}

export function decisionResolutionLabel(resolution?: PermissionResolution) {
  switch (resolution) {
    case "auto-allowed":
      return "自动允许";
    case "auto-denied":
      return "自动拒绝";
    case "awaiting-user":
      return "等待确认";
    case "user-allowed":
      return "用户批准";
    case "user-denied":
      return "用户拒绝";
    default:
      return null;
  }
}

export function timelineLabel(entry: SessionTimelineEntry) {
  switch (entry.kind) {
    case "prompt":
      return "提示词";
    case "assistant":
      return "回复";
    case "approval-requested":
      return "待审批";
    case "approval-resolved":
      return "审批结果";
    case "error":
      return "错误";
    case "status":
    default:
      return "状态";
  }
}

export function persistedSessionStatusLabel(status: PersistedSessionStatus) {
  switch (status) {
    case "interrupted":
      return "已中断";
    default:
      return sessionStatusLabel(status);
  }
}

export function sessionStatusLabel(status: SessionStatus | Exclude<PersistedSessionStatus, "interrupted">) {
  switch (status) {
    case "running":
      return "执行中";
    case "awaiting-approval":
      return "待审批";
    case "recovering":
      return "恢复中";
    case "timed-out":
      return "已超时";
    case "idle":
      return "空闲";
    case "disconnected":
      return "已断开";
    default:
      return status;
  }
}

export function sessionStatusTone(status: SessionStatus | PersistedSessionStatus) {
  switch (status) {
    case "awaiting-approval":
    case "timed-out":
    case "interrupted":
      return "warning";
    case "recovering":
      return "info";
    case "disconnected":
      return "muted";
    default:
      return "default";
  }
}

export function activityPhaseLabel(phase: ActivityPhase) {
  switch (phase) {
    case "queued":
      return "已入队";
    case "analyzing":
      return "分析中";
    case "editing":
      return "修改中";
    case "validating":
      return "验证中";
    case "awaiting-approval":
      return "待审批";
    case "recovering":
      return "恢复中";
    case "timed-out":
      return "已超时";
    case "completed":
      return "已收口";
    case "failed":
      return "失败";
    case "idle":
    default:
      return "空闲";
  }
}

export function activityPhaseTone(phase: ActivityPhase) {
  switch (phase) {
    case "awaiting-approval":
    case "timed-out":
    case "failed":
      return "warning";
    case "recovering":
    case "analyzing":
    case "validating":
      return "info";
    case "completed":
    case "editing":
      return "default";
    case "queued":
      return "accent";
    case "idle":
    default:
      return "muted";
  }
}

export function activityItemStatusLabel(status: ActivityItemStatus) {
  switch (status) {
    case "completed":
      return "已完成";
    case "blocked":
      return "阻塞中";
    case "failed":
      return "失败";
    case "running":
    default:
      return "进行中";
  }
}

export function approvalTypeLabel(type: ApprovalType) {
  switch (type) {
    case "shell-readonly":
      return "只读 shell";
    case "shell-execution":
      return "可执行 shell";
    case "file-write":
      return "文件写入";
    case "repo-read":
      return "仓库内读取";
    case "external-path-read":
      return "仓库外读取";
    case "url-fetch":
      return "网页抓取";
    case "mcp-readonly":
      return "只读 MCP 工具";
    case "mcp-execution":
      return "MCP 工具执行";
    case "custom-tool":
      return "自定义工具";
    case "other":
    default:
      return "其他审批";
  }
}

export function summaryStepKindLabel(kind: SessionSummaryStep["kind"]) {
  switch (kind) {
    case "prompt":
      return "提示词";
    case "assistant":
      return "结果";
    case "approval":
      return "审批";
    case "command":
      return "命令";
    case "file-change":
      return "文件变更";
    case "error":
      return "错误";
    case "status":
    default:
      return "状态";
  }
}

export function summaryStepStatusLabel(status: SessionSummaryStep["status"]) {
  switch (status) {
    case "completed":
      return "已完成";
    case "blocked":
      return "阻塞中";
    case "failed":
      return "失败";
    case "running":
    default:
      return "进行中";
  }
}

export function policyRuleFieldLabel(field: RepoPolicyRule["field"]) {
  switch (field) {
    case "allowShell":
      return "Shell allowlist";
    case "allowedWritePaths":
      return "受控写入";
    case "allowedPaths":
    default:
      return "读取路径";
  }
}

export function policyRuleSourceLabel(source: RepoPolicyRule["source"]) {
  switch (source) {
    case "approval-persisted":
      return "来自审批持久化";
    case "policy-file":
    default:
      return "来自 policy 文件";
  }
}

export function policyRuleRiskLabel(risk: RepoPolicyRule["risk"]) {
  switch (risk) {
    case "high":
      return "高敏感";
    case "medium":
      return "中敏感";
    case "low":
    default:
      return "低敏感";
  }
}