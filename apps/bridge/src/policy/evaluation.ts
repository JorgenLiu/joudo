import type { PermissionRequest } from "../copilot-sdk.js";

import { DANGEROUS_COMMAND_PATTERNS, HIGH_RISK_INTERPRETERS, SAFE_READ_ONLY_COMMANDS } from "./constants.js";
import { matchAllowedUrl, matchShellDecision, matchToolDecision } from "./matching.js";
import { buildCanonicalShellCandidates } from "./shell-candidates.js";
import type {
  CustomToolPermissionRequest,
  LoadedRepoPolicy,
  McpPermissionRequest,
  PolicyDecision,
  ReadPermissionRequest,
  ShellPermissionRequest,
  UrlPermissionRequest,
  WritePermissionRequest,
} from "./types.js";
import {
  buildDecision,
  containsUnquotedShellMeta,
  getAllowedRoots,
  getAllowedWriteRoots,
  isWithinPath,
  resolveAgainstRepo,
} from "./utils.js";

function matchesAnyCommandPattern(pattern: string, commands: string[]): boolean {
  const normalizedPatternTrimmed = pattern.trim().replace(/\s+/g, " ");
  return commands.some((command) => {
    const normalizedCommand = command.trim().replace(/\s+/g, " ");
    return normalizedCommand === normalizedPatternTrimmed || normalizedCommand.startsWith(`${normalizedPatternTrimmed} `);
  });
}

function isSafeReadOnlyShell(request: ShellPermissionRequest, repoRoot: string): boolean {
  const commands = Array.isArray(request.commands) ? request.commands : [];
  if (!commands.length || commands.some((command) => command?.readOnly !== true)) {
    return false;
  }

  const identifiers = commands
    .map((command) => (typeof command?.identifier === "string" ? command.identifier : ""))
    .filter(Boolean);

  if (!identifiers.length || identifiers.some((identifier) => !SAFE_READ_ONLY_COMMANDS.has(identifier))) {
    return false;
  }

  if (request.hasWriteFileRedirection === true) {
    return false;
  }

  const possibleUrls = Array.isArray(request.possibleUrls) ? request.possibleUrls : [];
  if (possibleUrls.length > 0) {
    return false;
  }

  const possiblePaths = Array.isArray(request.possiblePaths) ? request.possiblePaths : [];
  return possiblePaths.every((candidatePath) => isWithinPath(repoRoot, resolveAgainstRepo(repoRoot, candidatePath)));
}

function hasDefaultDangerousShellBehavior(request: ShellPermissionRequest): boolean {
  const fullCommandText = typeof request.fullCommandText === "string" ? request.fullCommandText : "";
  const candidates = buildCanonicalShellCandidates(fullCommandText);
  const commands = Array.isArray(request.commands) ? request.commands : [];
  const identifiers = commands
    .map((command) => (typeof command?.identifier === "string" ? command.identifier : ""))
    .filter(Boolean);

  if (identifiers.some((identifier) => HIGH_RISK_INTERPRETERS.has(identifier))) {
    return true;
  }

  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => matchesAnyCommandPattern(pattern, candidates));
}

function evaluateShellRequest(policy: LoadedRepoPolicy, repoRoot: string, request: ShellPermissionRequest): PolicyDecision {
  const fullCommandText = typeof request.fullCommandText === "string" ? request.fullCommandText : "shell command";
  const commands = Array.isArray(request.commands) ? request.commands : [];
  const allReadOnly = commands.length > 0 && commands.every((command) => command?.readOnly === true);
  const explicitShellDecision = policy.config ? matchShellDecision(policy.config, fullCommandText) : null;
  const toolDecision = policy.config ? matchToolDecision(policy.config, request) : null;

  if (explicitShellDecision?.action === "deny" || toolDecision?.action === "deny") {
    const decision = explicitShellDecision?.action === "deny" ? explicitShellDecision : toolDecision;
    return buildDecision("deny", `命中了拒绝规则，已阻止执行：${fullCommandText}`, decision?.matchedRule);
  }

  if (hasDefaultDangerousShellBehavior(request) && explicitShellDecision?.action !== "allow") {
    return buildDecision("deny", `命中了内置高风险 shell 规则，已阻止执行：${fullCommandText}`);
  }

  if (!policy.config) {
    if (isSafeReadOnlyShell(request, repoRoot)) {
      return buildDecision("allow", "当前仓库缺少有效 policy 文件，但这次请求是仓库内只读探索，已按保守默认值自动允许。");
    }

    return buildDecision("deny", `当前仓库${policy.state === "invalid" ? "的 policy 文件无效" : "缺少 policy 文件"}，bridge 只保留仓库内只读探索能力。`, policy.path ? `policy: ${policy.path}` : undefined);
  }

  const possibleUrls = Array.isArray(request.possibleUrls) ? request.possibleUrls : [];
  for (const possibleUrl of possibleUrls) {
    const rawUrl = typeof possibleUrl?.url === "string" ? possibleUrl.url : "";
    if (!rawUrl) {
      continue;
    }

    const matchedAllowedUrl = matchAllowedUrl(policy.config.allowedUrls, rawUrl);
    if (!matchedAllowedUrl) {
      return buildDecision("deny", `命令可能访问未授权的 URL：${rawUrl}`, "allowed_urls");
    }
  }

  const allowedRoots = getAllowedRoots(policy.config, repoRoot);
  const possiblePaths = Array.isArray(request.possiblePaths) ? request.possiblePaths : [];
  for (const candidatePath of possiblePaths) {
    const absolutePath = resolveAgainstRepo(repoRoot, candidatePath);

    if (!isWithinPath(repoRoot, absolutePath)) {
      if (allReadOnly) {
        return buildDecision("confirm", `命令可能读取当前仓库外的路径：${candidatePath}`, "allowed_paths");
      }

      return buildDecision("deny", `命令可能写入当前仓库外的路径：${candidatePath}`, "allowed_paths");
    }

    const isAllowedPath = allowedRoots.some((allowedRoot) => isWithinPath(allowedRoot, absolutePath));
    if (isAllowedPath) {
      continue;
    }

    if (allReadOnly) {
      return buildDecision("confirm", `命令可能读取策略允许范围外的路径：${candidatePath}`, "allowed_paths");
    }

    return buildDecision("deny", `命令可能写入策略允许范围外的路径：${candidatePath}`, "allowed_paths");
  }

  const isComplexCommand = containsUnquotedShellMeta(fullCommandText);

  if (explicitShellDecision?.action === "allow" || toolDecision?.action === "allow") {
    const decision = explicitShellDecision?.action === "allow" ? explicitShellDecision : toolDecision;
    if (isComplexCommand) {
      return buildDecision("confirm", `命中了自动允许规则，但命令包含管道或链式操作符，需要网页端确认：${fullCommandText}`, decision?.matchedRule);
    }
    return buildDecision("allow", `命中了自动允许规则，已批准执行：${fullCommandText}`, decision?.matchedRule);
  }

  if (explicitShellDecision?.action === "confirm" || toolDecision?.action === "confirm") {
    const decision = explicitShellDecision?.action === "confirm" ? explicitShellDecision : toolDecision;
    return buildDecision("confirm", `命中了需要确认的规则：${fullCommandText}`, decision?.matchedRule);
  }

  if (isComplexCommand) {
    return buildDecision("confirm", `命令包含管道或链式操作符（tokenizer 已知限制），需要网页端确认：${fullCommandText}`);
  }

  if (possibleUrls.length > 0) {
    return buildDecision("confirm", `命令会访问已允许的 URL，但当前没有自动允许规则：${fullCommandText}`, "allowed_urls");
  }

  if (isSafeReadOnlyShell(request, repoRoot)) {
    return buildDecision("allow", "这是仓库内的只读 shell 探索，已按保守默认值自动允许。");
  }

  if (allReadOnly) {
    return buildDecision("confirm", `这是策略未覆盖的只读 shell 请求，需要网页端确认：${fullCommandText}`);
  }

  return buildDecision("confirm", `这是策略未覆盖的 shell 请求，需要网页端确认：${fullCommandText}`);
}

function evaluateWriteRequest(policy: LoadedRepoPolicy, repoRoot: string, request: WritePermissionRequest): PolicyDecision {
  const fileName = typeof request.fileName === "string" ? request.fileName : "未知文件";

  if (!policy.config) {
    return buildDecision("deny", `当前仓库${policy.state === "invalid" ? "的 policy 文件无效" : "缺少 policy 文件"}，bridge 不会自动放行写入请求。`, policy.path ? `policy: ${policy.path}` : undefined);
  }

  const toolDecision = matchToolDecision(policy.config, request);
  if (toolDecision?.action === "deny") {
    return buildDecision("deny", `命中了拒绝规则，已阻止写入：${fileName}`, toolDecision.matchedRule);
  }

  const absolutePath = resolveAgainstRepo(repoRoot, fileName);
  if (!isWithinPath(repoRoot, absolutePath)) {
    return buildDecision("deny", `写入目标超出了当前仓库：${fileName}`, "allowed_paths");
  }

  const allowedWriteRoots = getAllowedWriteRoots(policy.config, repoRoot);
  const isAllowedWritePath = allowedWriteRoots.some((allowedRoot) => isWithinPath(allowedRoot, absolutePath));

  if (isAllowedWritePath && toolDecision?.action === "confirm") {
    return buildDecision("confirm", `命中了需要确认的写入规则：${fileName}`, toolDecision.matchedRule);
  }

  if (isAllowedWritePath) {
    return buildDecision("allow", `写入目标位于写入 allowlist 内，已自动允许：${fileName}`, "allowed_write_paths");
  }

  const allowedRoots = getAllowedRoots(policy.config, repoRoot);
  const isAllowedPath = allowedRoots.some((allowedRoot) => isWithinPath(allowedRoot, absolutePath));
  if (isAllowedPath && toolDecision?.action === "allow") {
    return buildDecision("allow", `命中了自动允许规则，已批准写入：${fileName}`, toolDecision.matchedRule);
  }

  if (isAllowedPath && toolDecision?.action === "confirm") {
    return buildDecision("confirm", `命中了需要确认的写入规则：${fileName}`, toolDecision.matchedRule);
  }

  if (isAllowedPath) {
    return buildDecision("confirm", `写入目标位于允许路径内，但当前没有自动允许规则：${fileName}`, "allowed_paths");
  }

  return buildDecision("confirm", `写入目标位于仓库内但超出了 allowlist，需要网页端确认：${fileName}`, "allowed_paths");
}

function evaluateReadRequest(policy: LoadedRepoPolicy, repoRoot: string, request: ReadPermissionRequest): PolicyDecision {
  const path = typeof request.path === "string" ? request.path : "未知路径";

  if (!policy.config) {
    const absolutePath = resolveAgainstRepo(repoRoot, path);
    if (isWithinPath(repoRoot, absolutePath)) {
      return buildDecision("allow", "当前仓库缺少有效 policy 文件，但这次读取仍在仓库根目录内，已按保守默认值自动允许。");
    }

    return buildDecision("confirm", `这次读取超出了仓库根目录，需要网页端确认：${path}`);
  }

  const toolDecision = matchToolDecision(policy.config, request);
  if (toolDecision?.action === "deny") {
    return buildDecision("deny", `命中了拒绝规则，已阻止读取：${path}`, toolDecision.matchedRule);
  }

  const absolutePath = resolveAgainstRepo(repoRoot, path);
  if (!isWithinPath(repoRoot, absolutePath)) {
    return buildDecision("confirm", `读取目标超出了当前仓库，需要网页端确认：${path}`, "allowed_paths");
  }

  const allowedRoots = getAllowedRoots(policy.config, repoRoot);
  const isAllowedPath = allowedRoots.some((allowedRoot) => isWithinPath(allowedRoot, absolutePath));

  if (isAllowedPath) {
    return buildDecision("allow", `读取目标位于允许路径内，已自动允许：${path}`, toolDecision?.matchedRule ?? "allowed_paths");
  }

  return buildDecision("confirm", `读取目标位于仓库内但超出了 allowlist，需要网页端确认：${path}`, "allowed_paths");
}

function evaluateUrlRequest(policy: LoadedRepoPolicy, request: UrlPermissionRequest): PolicyDecision {
  const url = typeof request.url === "string" ? request.url : "未知 URL";

  if (!policy.config) {
    return buildDecision("deny", `当前仓库${policy.state === "invalid" ? "的 policy 文件无效" : "缺少 policy 文件"}，bridge 默认拒绝联网请求。`, policy.path ? `policy: ${policy.path}` : undefined);
  }

  const toolDecision = matchToolDecision(policy.config, request);
  if (toolDecision?.action === "deny") {
    return buildDecision("deny", `命中了拒绝规则，已阻止访问：${url}`, toolDecision.matchedRule);
  }

  const matchedAllowedUrl = matchAllowedUrl(policy.config.allowedUrls, url);
  if (!matchedAllowedUrl) {
    return buildDecision("deny", `URL 不在 allowlist 中：${url}`, "allowed_urls");
  }

  if (toolDecision?.action === "allow") {
    return buildDecision("allow", `命中了自动允许规则，已批准访问：${url}`, toolDecision.matchedRule);
  }

  return buildDecision("confirm", `URL 已命中 allowlist，但仍需要网页端确认：${url}`, `allowed_urls: ${matchedAllowedUrl}`);
}

function evaluateMcpOrCustomToolRequest(policy: LoadedRepoPolicy, request: McpPermissionRequest | CustomToolPermissionRequest): PolicyDecision {
  const toolLabel =
    request.kind === "mcp"
      ? `${request.serverName ?? "unknown"}/${request.toolName ?? request.toolTitle ?? "tool"}`
      : request.toolName ?? "custom-tool";

  if (!policy.config) {
    if (request.kind === "mcp" && request.readOnly === true) {
      return buildDecision("confirm", `当前仓库缺少有效 policy 文件，read-only MCP 工具需要网页端确认：${toolLabel}`);
    }

    return buildDecision("deny", `当前仓库${policy.state === "invalid" ? "的 policy 文件无效" : "缺少 policy 文件"}，bridge 默认拒绝未建模的工具调用。`, policy.path ? `policy: ${policy.path}` : undefined);
  }

  const toolDecision = matchToolDecision(policy.config, request);
  if (toolDecision?.action) {
    return buildDecision(toolDecision.action, `命中了 ${toolDecision.action === "allow" ? "自动允许" : toolDecision.action === "deny" ? "拒绝" : "确认"} 规则：${toolLabel}`, toolDecision.matchedRule);
  }

  if (request.kind === "mcp" && request.readOnly === true) {
    return buildDecision("confirm", `read-only MCP 工具需要网页端确认：${toolLabel}`);
  }

  return buildDecision("deny", `当前没有覆盖这个工具的 policy 规则，已拒绝：${toolLabel}`);
}

export function evaluatePermissionRequest(policy: LoadedRepoPolicy, repoRoot: string, request: PermissionRequest): PolicyDecision {
  switch (request.kind) {
    case "shell":
      return evaluateShellRequest(policy, repoRoot, request as ShellPermissionRequest);
    case "write":
      return evaluateWriteRequest(policy, repoRoot, request as WritePermissionRequest);
    case "read":
      return evaluateReadRequest(policy, repoRoot, request as ReadPermissionRequest);
    case "url":
      return evaluateUrlRequest(policy, request as UrlPermissionRequest);
    case "mcp":
      return evaluateMcpOrCustomToolRequest(policy, request as McpPermissionRequest);
    case "custom-tool":
      return evaluateMcpOrCustomToolRequest(policy, request as CustomToolPermissionRequest);
    default:
      return buildDecision("deny", `当前 bridge 还没有为 ${request.kind} 权限类型实现安全策略，已默认拒绝。`);
  }
}
