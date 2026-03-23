import assert from "node:assert/strict";
import test from "node:test";

import type { PermissionRequest } from "./copilot-sdk.js";
import { normalizeBridgeError } from "./errors.js";
import type { PolicyDecision } from "./policy/index.js";
import { describePermission } from "./state/approvals.js";

test("normalizeBridgeError maps auth failures to a structured auth error", () => {
  const error = normalizeBridgeError(new Error("Copilot CLI 尚未登录，请先执行 copilot login"));

  assert.equal(error.code, "auth");
  assert.equal(error.statusCode, 401);
  assert.equal(error.retryable, true);
  assert.match(error.nextAction, /copilot login/);
});

test("normalizeBridgeError preserves details for unknown failures", () => {
  const original = new Error("unexpected failure");
  original.stack = "Error: unexpected failure\n    at test";

  const error = normalizeBridgeError(original);

  assert.equal(error.code, "unknown");
  assert.equal(error.statusCode, 500);
  assert.match(error.details ?? "", /at test/);
});

test("normalizeBridgeError classifies by error.code ETIMEDOUT (structured field)", () => {
  const error = Object.assign(new Error("connect failed"), { code: "ETIMEDOUT" });
  const result = normalizeBridgeError(error);
  assert.equal(result.code, "timeout");
  assert.equal(result.statusCode, 408);
});

test("normalizeBridgeError classifies by error.name TimeoutError (structured field)", () => {
  const error = new Error("operation timed out");
  error.name = "TimeoutError";
  const result = normalizeBridgeError(error);
  assert.equal(result.code, "timeout");
});

test("normalizeBridgeError classifies ECONNREFUSED as network error (structured field)", () => {
  const error = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  const result = normalizeBridgeError(error);
  assert.equal(result.code, "network");
  assert.equal(result.statusCode, 502);
});

test("normalizeBridgeError prefers structured field over regex match", () => {
  // Message says "policy" but code says ETIMEDOUT — structural wins
  const error = Object.assign(new Error("policy check timed out"), { code: "ETIMEDOUT" });
  const result = normalizeBridgeError(error);
  assert.equal(result.code, "timeout");
});

test("normalizeBridgeError falls back to regex when no structured fields match", () => {
  const error = new Error("审批超时了");
  const result = normalizeBridgeError(error);
  // "审批" matches approval pattern first
  assert.equal(result.code, "approval");
});

test("describePermission returns queue-ready metadata for read-only shell approvals", () => {
  const decision: PolicyDecision = {
    action: "confirm",
    reason: "未命中 allow_shell 规则。",
    matchedRule: "confirm_shell: pnpm add",
    rules: [],
  };

  const approval = describePermission(
    {
      kind: "shell",
      fullCommandText: "git status --short",
      intention: "检查当前仓库状态。",
      commands: [{ identifier: "git", readOnly: true }],
    } as PermissionRequest,
    decision,
    "/tmp/demo-repo",
  );

  assert.equal(approval.requestKind, "shell");
  assert.equal(approval.approvalType, "shell-readonly");
  assert.equal(approval.riskLevel, "medium");
  assert.equal(approval.target, "git status --short");
  assert.match(approval.scope, /只读 shell/);
  assert.match(approval.impact, /继续读取当前仓库信息/);
  assert.match(approval.whyNow ?? "", /检查当前仓库状态/);
  assert.match(approval.expectedEffect ?? "", /补齐当前仓库状态/);
  assert.match(approval.fallbackIfDenied ?? "", /保守/);
  assert.equal(approval.matchedRule, "confirm_shell: pnpm add");
});

test("describePermission omits matchedRule when no specific policy rule matched", () => {
  const decision: PolicyDecision = {
    action: "confirm",
    reason: "请求超出默认策略范围。",
    rules: [],
  };

  const approval = describePermission(
    {
      kind: "write",
      fileName: "src/new-file.ts",
      intention: "创建实现文件。",
    } as PermissionRequest,
    decision,
    "/tmp/demo-repo",
  );

  assert.equal(approval.requestKind, "write");
  assert.equal(approval.approvalType, "file-write");
  assert.equal(approval.riskLevel, "high");
  assert.equal(approval.target, "src/new-file.ts");
  assert.match(approval.whyNow ?? "", /创建实现文件/);
  assert.match(approval.expectedEffect ?? "", /写入目标文件/);
  assert.equal(Object.hasOwn(approval, "matchedRule"), false);
});

test("describePermission classifies URL fetch approvals separately from local reads", () => {
  const decision: PolicyDecision = {
    action: "confirm",
    reason: "未命中 allowed_urls 规则。",
    matchedRule: "confirm_shell: curl",
    rules: [],
  };

  const approval = describePermission(
    {
      kind: "url",
      url: "https://example.com/docs",
      intention: "抓取网页文档确认接口行为。",
    } as PermissionRequest,
    decision,
    "/tmp/demo-repo",
  );

  assert.equal(approval.approvalType, "url-fetch");
  assert.match(approval.title, /网页|URL/);
  assert.equal(approval.target, "https://example.com/docs");
});

test("describePermission classifies reads outside the repository as external-path-read", () => {
  const decision: PolicyDecision = {
    action: "confirm",
    reason: "请求超出 allowed_paths 范围。",
    rules: [],
  };

  const approval = describePermission(
    {
      kind: "read",
      path: "../shared-secrets/notes.md",
      intention: "读取仓库外的说明文件。",
    } as PermissionRequest,
    decision,
    "/tmp/demo-repo",
  );

  assert.equal(approval.approvalType, "external-path-read");
  assert.match(approval.title, /仓库外路径读取/);
  assert.match(approval.scope, /仓库之外/);
});