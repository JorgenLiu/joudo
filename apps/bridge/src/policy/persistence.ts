import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { parse, stringify } from "yaml";

import type { PermissionRequest } from "../copilot-sdk.js";

import { POLICY_CANDIDATES } from "./constants.js";
import { selectPersistedShellPattern } from "./shell-candidates.js";
import type { LoadedRepoPolicy, PersistedPolicyAllowlistEntry, RepoPolicy } from "./types.js";
import {
  isRecord,
  firstDefined,
  normalizeAllowedPathEntry,
  normalizeAllowedWriteEntry,
  normalizeWhitespace,
  readBoolean,
  readStringArray,
} from "./utils.js";

function parsePolicyDocument(document: unknown): RepoPolicy {
  if (!isRecord(document)) {
    throw new Error("policy 文件必须是对象。\n");
  }

  const version = firstDefined(document, ["version"]);
  if (version !== 1) {
    throw new Error("policy version 目前只支持 1。\n");
  }

  return {
    version: 1,
    trusted: readBoolean(document, ["trusted"], true),
    allowTools: readStringArray(document, ["allow_tools", "allowTools"], "allow_tools"),
    denyTools: readStringArray(document, ["deny_tools", "denyTools"], "deny_tools"),
    confirmTools: readStringArray(document, ["confirm_tools", "confirmTools"], "confirm_tools"),
    allowShell: readStringArray(document, ["allow_shell", "allowShell"], "allow_shell"),
    denyShell: readStringArray(document, ["deny_shell", "denyShell"], "deny_shell"),
    confirmShell: readStringArray(document, ["confirm_shell", "confirmShell"], "confirm_shell"),
    allowedPaths: readStringArray(document, ["allowed_paths", "allowedPaths"], "allowed_paths"),
    allowedWritePaths: readStringArray(document, ["allowed_write_paths", "allowedWritePaths"], "allowed_write_paths"),
    allowedUrls: readStringArray(document, ["allowed_urls", "allowedUrls"], "allowed_urls"),
  };
}

function createDefaultRepoPolicy(): RepoPolicy {
  return {
    version: 1,
    trusted: true,
    allowTools: [],
    denyTools: [],
    confirmTools: [],
    allowShell: [],
    denyShell: [],
    confirmShell: [],
    allowedPaths: ["."],
    allowedWritePaths: [],
    allowedUrls: [],
  };
}

function serializePolicyDocument(config: RepoPolicy): string {
  return `${stringify({
    version: config.version,
    trusted: config.trusted,
    allow_tools: config.allowTools,
    deny_tools: config.denyTools,
    confirm_tools: config.confirmTools,
    allow_shell: config.allowShell,
    deny_shell: config.denyShell,
    confirm_shell: config.confirmShell,
    allowed_paths: config.allowedPaths,
    allowed_write_paths: config.allowedWritePaths,
    allowed_urls: config.allowedUrls,
  }).trimEnd()}\n`;
}

function derivePersistedAllowlistEntry(
  repoRoot: string,
  request: PermissionRequest,
): Omit<PersistedPolicyAllowlistEntry, "policyPath" | "trackedPath" | "createdPolicy"> | null {
  if (request.kind === "shell") {
    const fullCommandText = typeof request.fullCommandText === "string" ? request.fullCommandText : "";
    const entry = selectPersistedShellPattern(fullCommandText);
    if (!entry) {
      return null;
    }

    const normalizedCommand = normalizeWhitespace(fullCommandText);

    return {
      field: "allowShell",
      entry,
      matchedRule: `allow_shell: ${entry}`,
      note:
        normalizedCommand && normalizedCommand !== entry
          ? `由 ${normalizedCommand} 归一化为 ${entry}`
          : "按可复用的 shell 模式写入 allowlist。",
    };
  }

  if (request.kind === "read") {
    const pathValue = typeof request.path === "string" ? request.path : "";
    if (!pathValue) {
      return null;
    }

    const entry = normalizeAllowedPathEntry(repoRoot, pathValue);
    const normalizedPath = normalizeAllowedPathEntry(repoRoot, pathValue);
    return {
      field: "allowedPaths",
      entry,
      matchedRule: `allowed_paths: ${entry}`,
      note: normalizedPath !== pathValue ? `按仓库相对路径保存为 ${entry}` : "按当前读取路径写入 allowlist。",
    };
  }

  if (request.kind === "write") {
    const fileName = typeof request.fileName === "string" ? request.fileName : "";
    if (!fileName) {
      return null;
    }

    const entry = normalizeAllowedWriteEntry(repoRoot, fileName);
    if (!entry) {
      return null;
    }

    const normalizedFile = normalizeAllowedPathEntry(repoRoot, fileName);

    return {
      field: "allowedWritePaths",
      entry,
      matchedRule: `allowed_write_paths: ${entry}`,
      note:
        entry !== normalizedFile
          ? `由 ${normalizedFile} 归一化为 ${entry}`
          : "按单文件精确写入保存。",
    };
  }

  return null;
}

export function findRepoPolicyPath(rootPath: string): string | null {
  for (const candidate of POLICY_CANDIDATES) {
    const absolutePath = join(rootPath, candidate);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}

export function loadRepoPolicy(rootPath: string): LoadedRepoPolicy {
  const policyPath = findRepoPolicyPath(rootPath);
  if (!policyPath) {
    return {
      state: "missing",
      path: null,
      config: null,
      error: null,
    };
  }

  try {
    const rawText = readFileSync(policyPath, "utf8");
    const document = parse(rawText);
    const config = parsePolicyDocument(document);
    return {
      state: "loaded",
      path: policyPath,
      config,
      error: null,
    };
  } catch (error) {
    return {
      state: "invalid",
      path: policyPath,
      config: null,
      error: error instanceof Error ? error.message.trim() : "无法解析 policy 文件。",
    };
  }
}

export function initializeRepoPolicy(
  rootPath: string,
  options: { trusted?: boolean } = {},
): { policy: LoadedRepoPolicy; created: boolean; path: string } {
  const existingPolicy = loadRepoPolicy(rootPath);
  if (existingPolicy.path) {
    return {
      policy: existingPolicy,
      created: false,
      path: existingPolicy.path,
    };
  }

  const defaultPolicyCandidate = POLICY_CANDIDATES[0];
  if (!defaultPolicyCandidate) {
    throw new Error("未找到可写入的默认 repo policy 路径。");
  }

  const targetPath = join(rootPath, defaultPolicyCandidate);
  const nextConfig: RepoPolicy = {
    ...createDefaultRepoPolicy(),
    ...(options.trusted !== undefined ? { trusted: options.trusted } : {}),
  };

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, serializePolicyDocument(nextConfig), "utf8");

  const reloadedPolicy = loadRepoPolicy(rootPath);
  if (reloadedPolicy.state !== "loaded" || !reloadedPolicy.path) {
    throw new Error("初始化 repo policy 后重新加载失败，请检查生成的 policy 文件。");
  }

  return {
    policy: reloadedPolicy,
    created: true,
    path: reloadedPolicy.path,
  };
}

export function persistApprovalToPolicy(
  rootPath: string,
  policy: LoadedRepoPolicy,
  request: PermissionRequest,
): { policy: LoadedRepoPolicy; added: boolean; entry: PersistedPolicyAllowlistEntry } {
  if (policy.state === "invalid") {
    throw new Error("当前 repo policy 无法解析，不能直接追加 allowlist。请先修复 policy 文件。");
  }

  const nextEntry = derivePersistedAllowlistEntry(rootPath, request);
  if (!nextEntry) {
    throw new Error(`当前 ${request.kind} 权限还不支持直接写入 repo policy allowlist。`);
  }

  const defaultPolicyCandidate = POLICY_CANDIDATES[0];
  if (!defaultPolicyCandidate) {
    throw new Error("未找到可写入的默认 repo policy 路径。 ");
  }

  const targetPath = policy.path ?? join(rootPath, defaultPolicyCandidate);
  const nextConfig = policy.config
    ? {
        ...policy.config,
        allowTools: [...policy.config.allowTools],
        denyTools: [...policy.config.denyTools],
        confirmTools: [...policy.config.confirmTools],
        allowShell: [...policy.config.allowShell],
        denyShell: [...policy.config.denyShell],
        confirmShell: [...policy.config.confirmShell],
        allowedPaths: [...policy.config.allowedPaths],
        allowedWritePaths: [...policy.config.allowedWritePaths],
        allowedUrls: [...policy.config.allowedUrls],
      }
    : createDefaultRepoPolicy();

  const bucket = nextConfig[nextEntry.field];
  const added = !bucket.includes(nextEntry.entry);
  if (added) {
    bucket.push(nextEntry.entry);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, serializePolicyDocument(nextConfig), "utf8");

  const reloadedPolicy = loadRepoPolicy(rootPath);
  if (reloadedPolicy.state !== "loaded" || !reloadedPolicy.config) {
    throw new Error("写入 repo policy 后重新加载失败，请检查生成的 policy 文件。 ");
  }

  return {
    policy: reloadedPolicy,
    added,
    entry: {
      ...nextEntry,
      policyPath: targetPath,
      trackedPath: relative(rootPath, targetPath).split("\\").join("/"),
      createdPolicy: policy.state === "missing",
    },
  };
}

export function removePolicyRule(
  rootPath: string,
  policy: LoadedRepoPolicy,
  field: PersistedPolicyAllowlistEntry["field"],
  value: string,
): { policy: LoadedRepoPolicy; removed: boolean; trackedPath: string } {
  if (policy.state === "missing" || !policy.path || !policy.config) {
    throw new Error("当前 repo 还没有可删除规则的 policy 文件。 ");
  }

  if (policy.state === "invalid") {
    throw new Error("当前 repo policy 无法解析，不能直接删除 allowlist 规则。请先修复 policy 文件。");
  }

  const nextConfig: RepoPolicy = {
    ...policy.config,
    allowTools: [...policy.config.allowTools],
    denyTools: [...policy.config.denyTools],
    confirmTools: [...policy.config.confirmTools],
    allowShell: [...policy.config.allowShell],
    denyShell: [...policy.config.denyShell],
    confirmShell: [...policy.config.confirmShell],
    allowedPaths: [...policy.config.allowedPaths],
    allowedWritePaths: [...policy.config.allowedWritePaths],
    allowedUrls: [...policy.config.allowedUrls],
  };

  const bucket = nextConfig[field];
  const nextBucket = bucket.filter((entry) => entry !== value);
  const removed = nextBucket.length !== bucket.length;
  nextConfig[field] = nextBucket;

  if (!removed) {
    return {
      policy,
      removed: false,
      trackedPath: relative(rootPath, policy.path).split("\\").join("/"),
    };
  }

  writeFileSync(policy.path, serializePolicyDocument(nextConfig), "utf8");

  const reloadedPolicy = loadRepoPolicy(rootPath);
  if (reloadedPolicy.state !== "loaded" || !reloadedPolicy.config) {
    throw new Error("删除 repo policy 规则后重新加载失败，请检查生成的 policy 文件。 ");
  }

  return {
    policy: reloadedPolicy,
    removed: true,
    trackedPath: relative(rootPath, policy.path).split("\\").join("/"),
  };
}
