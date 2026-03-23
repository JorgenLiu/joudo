import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { PolicyDecisionRule } from "@joudo/shared";

import type { PolicyAction, PolicyDecision, RepoPolicy } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

export function readStringArray(record: Record<string, unknown>, keys: string[], label: string): string[] {
  const value = firstDefined(record, keys);
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} 必须是字符串数组。`);
  }

  return value.map((entry) => entry.trim()).filter(Boolean);
}

export function readBoolean(record: Record<string, unknown>, keys: string[], defaultValue: boolean): boolean {
  const value = firstDefined(record, keys);
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${keys[0]} 必须是布尔值。`);
  }

  return value;
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function addCandidate(candidates: Set<string>, candidate: string | null | undefined) {
  if (!candidate) {
    return;
  }

  const normalizedCandidate = normalizeWhitespace(candidate);
  if (normalizedCandidate) {
    candidates.add(normalizedCandidate);
  }
}

export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let activeQuote: '"' | "'" | null = null;
  let escaped = false;

  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (activeQuote) {
      if (character === activeQuote) {
        activeQuote = null;
        continue;
      }

      if (activeQuote === '"' && character === "\\") {
        escaped = true;
        continue;
      }

      current += character;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === '"' || character === "'") {
      activeQuote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (character === "|" || character === ";" || character === "<" || character === ">") {
      break;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

export function skipLeadingAssignments(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || !isEnvironmentAssignment(token)) {
      break;
    }
    index += 1;
  }

  return tokens.slice(index);
}

export function findPositionalToken(tokens: string[], startIndex: number, optionsWithValue: Set<string>): { token: string; index: number } | null {
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      return null;
    }

    if (!token.startsWith("-")) {
      return { token, index };
    }

    const expectsValue = optionsWithValue.has(token) || [...optionsWithValue].some((option) => token.startsWith(`${option}=`));
    index += 1;

    if (expectsValue && !token.includes("=") && index < tokens.length) {
      index += 1;
    }
  }

  return null;
}

export function findNearestExistingPath(candidatePath: string): string {
  let currentPath = resolve(candidatePath);

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return currentPath;
    }

    currentPath = parentPath;
  }

  return currentPath;
}

export function resolvePathForContainment(candidatePath: string): string {
  const absolutePath = resolve(candidatePath);
  const nearestExistingPath = findNearestExistingPath(absolutePath);

  if (!existsSync(nearestExistingPath)) {
    return absolutePath;
  }

  const realExistingPath = realpathSync(nearestExistingPath);
  const relativeSuffix = relative(nearestExistingPath, absolutePath);
  return relativeSuffix ? resolve(realExistingPath, relativeSuffix) : realExistingPath;
}

export function isWithinPath(rootPath: string, candidatePath: string): boolean {
  const normalizedRootPath = resolvePathForContainment(rootPath);
  const normalizedCandidatePath = resolvePathForContainment(candidatePath);
  const relativePath = relative(normalizedRootPath, normalizedCandidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && relativePath !== "..");
}

export function resolveAgainstRepo(repoRoot: string, candidatePath: string): string {
  return isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(repoRoot, candidatePath);
}

export function buildDecision(action: PolicyAction, reason: string, matchedRule?: string): PolicyDecision {
  const rule: PolicyDecisionRule = {
    source: "joudo-policy",
    action,
    ...(matchedRule ? { matchedRule } : {}),
    reason,
  };

  return {
    action,
    reason,
    ...(matchedRule ? { matchedRule } : {}),
    rules: [rule],
  };
}

export function containsUnquotedShellMeta(command: string): boolean {
  let activeQuote: '"' | "'" | null = null;
  let escaped = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    if (escaped) { escaped = false; i++; continue; }
    if (activeQuote) {
      if (ch === activeQuote) { activeQuote = null; }
      else if (activeQuote === '"' && ch === "\\") { escaped = true; }
      i++; continue;
    }
    if (ch === "\\") { escaped = true; i++; continue; }
    if (ch === '"' || ch === "'") { activeQuote = ch; i++; continue; }

    if (ch === "|") {
      if (command[i + 1] === "|") { return true; } // ||
      return true; // single pipe
    }
    if (ch === "&" && command[i + 1] === "&") { return true; } // &&
    if (ch === ";") { return true; }
    i++;
  }
  return false;
}

export function getAllowedRoots(policy: RepoPolicy, repoRoot: string): string[] {
  const configuredPaths = policy.allowedPaths.length ? policy.allowedPaths : ["."];
  return configuredPaths.map((entry) => resolveAgainstRepo(repoRoot, entry));
}

export function getAllowedWriteRoots(policy: RepoPolicy, repoRoot: string): string[] {
  return policy.allowedWritePaths.map((entry) => resolveAgainstRepo(repoRoot, entry));
}

export function normalizeAllowedPathEntry(repoRoot: string, candidatePath: string): string {
  const absolutePath = resolveAgainstRepo(repoRoot, candidatePath);
  if (!isWithinPath(repoRoot, absolutePath)) {
    return absolutePath;
  }

  const relativePath = relative(repoRoot, absolutePath).split("\\").join("/");
  if (!relativePath || relativePath === ".") {
    return ".";
  }

  return relativePath.startsWith("./") ? relativePath : `./${relativePath}`;
}

export function normalizeAllowedWriteEntry(repoRoot: string, candidatePath: string): string | null {
  const absolutePath = resolveAgainstRepo(repoRoot, candidatePath);
  if (!isWithinPath(repoRoot, absolutePath)) {
    return null;
  }

  const relativePath = relative(repoRoot, absolutePath).split("\\").join("/");
  if (!relativePath || relativePath === "." || relativePath.startsWith("../")) {
    return null;
  }

  const segments = relativePath.split("/").filter(Boolean);
  const generatedIndex = segments.findIndex((segment) => segment === "generated" || segment === "__generated__");
  if (generatedIndex >= 0) {
    return `./${segments.slice(0, generatedIndex + 1).join("/")}`;
  }

  return `./${relativePath}`;
}
