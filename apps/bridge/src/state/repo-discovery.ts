import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { RepoDescriptor } from "@joudo/shared";

import { loadRepoPolicy } from "../policy/index.js";
import { hideRepoRoot, loadRepoRegistry, registerManagedRepoRoot, unhideRepoRoot } from "./repo-registry.js";

function isExistingDirectory(candidatePath: string): boolean {
  try {
    return existsSync(candidatePath) && statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function createRepoId(rootPath: string): string {
  const stem = basename(rootPath).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || "repo";
  const suffix = createHash("sha256").update(rootPath).digest("hex").slice(0, 8);
  return `${stem}-${suffix}`;
}

function defaultRepoRoots(): string[] {
  const configuredRoot = process.env.JOUDO_REPO_ROOT ? resolve(process.env.JOUDO_REPO_ROOT) : null;
  const extraRoots = (process.env.JOUDO_EXTRA_REPOS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));
  const candidates = [
    ...(configuredRoot ? [configuredRoot] : []),
    ...extraRoots,
  ];
  return [...new Set(candidates)].filter((rootPath) => isExistingDirectory(rootPath));
}

export function describeRepo(rootPath: string): RepoDescriptor {
  const normalizedRoot = resolve(rootPath);
  const policy = loadRepoPolicy(normalizedRoot);
  return {
    id: createRepoId(normalizedRoot),
    name: basename(normalizedRoot) || "repo",
    rootPath: normalizedRoot,
    trusted: policy.config?.trusted ?? false,
    policyState: policy.state,
  };
}

export function buildRepos(): RepoDescriptor[] {
  const defaults = defaultRepoRoots();
  const registry = loadRepoRegistry();
  const hiddenRoots = new Set(registry.hiddenRoots.map((rootPath) => resolve(rootPath)));
  const uniqueRoots = [...new Set([...defaults, ...registry.managedRoots])]
    .map((rootPath) => resolve(rootPath))
    .filter((rootPath) => isExistingDirectory(rootPath) && !hiddenRoots.has(rootPath));

  return uniqueRoots.map((rootPath) => describeRepo(rootPath));
}

export function registerRepo(rootPath: string): RepoDescriptor {
  const normalizedRoot = resolve(rootPath);
  if (!isExistingDirectory(normalizedRoot)) {
    throw new Error(`目录不存在或不可访问: ${normalizedRoot}`);
  }

  registerManagedRepoRoot(normalizedRoot);
  unhideRepoRoot(normalizedRoot);
  return describeRepo(normalizedRoot);
}

export function removeRepo(rootPath: string) {
  hideRepoRoot(resolve(rootPath));
}