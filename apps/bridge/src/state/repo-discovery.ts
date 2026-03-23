import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RepoDescriptor } from "@joudo/shared";

import { loadRepoPolicy } from "../policy/index.js";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function isExistingDirectory(candidatePath: string): boolean {
  try {
    return existsSync(candidatePath) && statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function createRepoId(rootPath: string, index: number): string {
  const stem = basename(rootPath).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase() || `repo-${index + 1}`;
  return `${stem}-${index + 1}`;
}

export function buildRepos(): RepoDescriptor[] {
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
  const uniqueRoots = [...new Set(candidates)].filter((rootPath) => isExistingDirectory(rootPath));

  return uniqueRoots.map((rootPath, index) => {
    const policy = loadRepoPolicy(rootPath);
    return {
      id: createRepoId(rootPath, index),
      name: basename(rootPath) || `repo-${index + 1}`,
      rootPath,
      trusted: policy.config?.trusted ?? false,
      policyState: policy.state,
    };
  });
}