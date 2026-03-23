import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { ActivityFileChangeRecord, ActivityRollbackState, ActivityTurnRecord } from "@joudo/shared";

import { canRollbackWithTurnWriteJournal } from "./turn-write-journal.js";
import type { TurnWriteJournal } from "./turn-write-journal.js";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".joudo",
  ".next",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv",
  ".venv",
]);

export type RepoObservation = {
  observedAt: string;
  digest: string;
  files: Record<string, string>;
};

export type TurnPathTrackerSnapshot = {
  trackedPaths: string[];
  unexpectedObservedPaths: string[];
  broadCandidateScope: boolean;
};

export type TurnPathTracker = {
  addCandidatePaths: (paths: string[] | undefined) => void;
  ignoreObservedPaths: (paths: string[] | undefined) => void;
  snapshot: () => TurnPathTrackerSnapshot;
  stop: () => void;
};

function normalizeRelativePath(repoRoot: string, filePath: string) {
  return relative(repoRoot, filePath).split("\\").join("/");
}

function normalizeTrackedPath(repoRoot: string, pathValue: string | Buffer): string | null {
  const rawPath = Buffer.isBuffer(pathValue) ? pathValue.toString("utf8") : pathValue;
  if (!rawPath || rawPath === ".") {
    return ".";
  }

  const absolutePath = resolve(repoRoot, rawPath);
  const relativePath = normalizeRelativePath(repoRoot, absolutePath);
  if (!relativePath || relativePath === "." || relativePath === ".." || relativePath.startsWith("../")) {
    return null;
  }

  if (relativePath.split("/").some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) {
    return null;
  }

  return relativePath;
}

function isPathCoveredByCandidate(pathValue: string, candidatePath: string) {
  return candidatePath === pathValue || pathValue.startsWith(`${candidatePath}/`) || candidatePath.startsWith(`${pathValue}/`);
}

const MAX_DIGEST_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — skip larger files for digest

async function collectFileDigests(repoRoot: string, currentPath: string, files: Record<string, string>) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      await collectFileDigests(repoRoot, entryPath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(entryPath).catch(() => null);
    if (!fileStat || fileStat.size > MAX_DIGEST_FILE_BYTES) {
      continue;
    }

    const content = await readFile(entryPath);
    files[normalizeRelativePath(repoRoot, entryPath)] = createHash("sha256").update(content).digest("hex");
  }
}

async function collectTargetedFileDigests(repoRoot: string, candidatePath: string, files: Record<string, string>) {
  const normalizedPath = normalizeTrackedPath(repoRoot, candidatePath);
  if (!normalizedPath) {
    return;
  }

  if (normalizedPath === ".") {
    await collectFileDigests(repoRoot, repoRoot, files);
    return;
  }

  const absolutePath = resolve(repoRoot, normalizedPath);
  try {
    const currentStat = await stat(absolutePath);
    if (currentStat.isDirectory()) {
      await collectFileDigests(repoRoot, absolutePath, files);
      return;
    }

    if (!currentStat.isFile() || currentStat.size > MAX_DIGEST_FILE_BYTES) {
      return;
    }

    const content = await readFile(absolutePath);
    files[normalizedPath] = createHash("sha256").update(content).digest("hex");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function computeObservationDigest(files: Record<string, string>) {
  const digest = createHash("sha256");
  for (const filePath of Object.keys(files).sort()) {
    digest.update(filePath);
    digest.update("\0");
    digest.update(files[filePath] ?? "");
    digest.update("\n");
  }

  return digest.digest("hex");
}

function pairRenames(created: Map<string, string>, deleted: Map<string, string>) {
  const renamed = new Map<string, { fromPath: string; toPath: string }>();

  for (const [createdPath, createdDigest] of created) {
    const deletedMatch = [...deleted.entries()].find(([, deletedDigest]) => deletedDigest === createdDigest) ?? null;
    if (!deletedMatch) {
      continue;
    }

    const [deletedPath] = deletedMatch;
    renamed.set(createdPath, { fromPath: deletedPath, toPath: createdPath });
    created.delete(createdPath);
    deleted.delete(deletedPath);
  }

  return renamed;
}

export async function observeRepoState(repoRoot: string): Promise<RepoObservation> {
  const files: Record<string, string> = {};
  await collectFileDigests(repoRoot, repoRoot, files);
  return {
    observedAt: new Date().toISOString(),
    digest: computeObservationDigest(files),
    files,
  };
}

export async function observeRepoStateForPaths(repoRoot: string, trackedPaths: Iterable<string>): Promise<RepoObservation> {
  const files: Record<string, string> = {};
  for (const trackedPath of [...new Set(trackedPaths)].sort((left, right) => left.localeCompare(right))) {
    await collectTargetedFileDigests(repoRoot, trackedPath, files);
  }
  return {
    observedAt: new Date().toISOString(),
    digest: computeObservationDigest(files),
    files,
  };
}

export function createRepoObservationFromWriteJournal(writeJournal: TurnWriteJournal, observedAt = new Date().toISOString()): RepoObservation {
  const files: Record<string, string> = {};

  for (const entry of [...writeJournal.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (!entry.existedBefore || entry.contentBase64 === null) {
      continue;
    }

    files[entry.path] = createHash("sha256").update(Buffer.from(entry.contentBase64, "base64")).digest("hex");
  }

  return {
    observedAt,
    digest: computeObservationDigest(files),
    files,
  };
}

export function createTurnPathTracker(repoRoot: string): TurnPathTracker {
  const candidatePaths = new Set<string>();
  const observedPaths = new Set<string>();
  const ignoredObservedPaths = new Set<string>();
  let broadCandidateScope = false;
  let stopped = false;
  let stopWatcher = () => undefined;

  try {
    const watcher = watch(repoRoot, { recursive: true }, (_eventType, fileName) => {
      if (!fileName) {
        return;
      }

      const normalizedPath = normalizeTrackedPath(repoRoot, fileName);
      if (!normalizedPath || normalizedPath === ".") {
        return;
      }

      observedPaths.add(normalizedPath);
    });
    stopWatcher = () => {
      watcher.close();
      return undefined;
    };
  } catch {
    stopWatcher = () => undefined;
  }

  return {
    addCandidatePaths(paths) {
      for (const pathValue of paths ?? []) {
        if (!pathValue) {
          continue;
        }

        const normalizedPath = normalizeTrackedPath(repoRoot, pathValue);
        if (!normalizedPath) {
          continue;
        }

        if (normalizedPath === ".") {
          broadCandidateScope = true;
          continue;
        }

        candidatePaths.add(normalizedPath);
      }
    },
    ignoreObservedPaths(paths) {
      for (const pathValue of paths ?? []) {
        if (!pathValue) {
          continue;
        }

        const normalizedPath = normalizeTrackedPath(repoRoot, pathValue);
        if (!normalizedPath || normalizedPath === ".") {
          continue;
        }

        ignoredObservedPaths.add(normalizedPath);
      }
    },
    snapshot() {
      const trackedPaths = [...candidatePaths].sort((left, right) => left.localeCompare(right));
      const unexpectedObservedPaths = [...observedPaths]
        .filter((pathValue) => !ignoredObservedPaths.has(pathValue))
        .filter((pathValue) => !trackedPaths.some((candidatePath) => isPathCoveredByCandidate(pathValue, candidatePath)))
        .sort((left, right) => left.localeCompare(right));

      return {
        trackedPaths,
        unexpectedObservedPaths,
        broadCandidateScope,
      };
    },
    stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      stopWatcher();
    },
  };
}

function mergeUnexpectedObservedPaths(
  changedFiles: ActivityFileChangeRecord[],
  unexpectedObservedPaths: string[],
): ActivityFileChangeRecord[] {
  const knownPaths = new Set(changedFiles.map((item) => item.path));
  const derivedUnexpectedChanges = unexpectedObservedPaths
    .filter((pathValue) => !knownPaths.has(pathValue))
    .map((pathValue) => ({
      path: pathValue,
      changeKind: "updated" as const,
      source: "derived" as const,
      summary: "observed outside declared candidate paths",
    }));

  return [...changedFiles, ...derivedUnexpectedChanges].sort((left, right) => left.path.localeCompare(right.path));
}

export function computeTurnChangedFiles(before: RepoObservation, after: RepoObservation): ActivityFileChangeRecord[] {
  const created = new Map<string, string>();
  const deleted = new Map<string, string>();
  const updated: ActivityFileChangeRecord[] = [];

  const allPaths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);

  for (const filePath of [...allPaths].sort()) {
    const beforeDigest = before.files[filePath] ?? null;
    const afterDigest = after.files[filePath] ?? null;

    if (beforeDigest === afterDigest) {
      continue;
    }

    if (!beforeDigest && afterDigest) {
      created.set(filePath, afterDigest);
      continue;
    }

    if (beforeDigest && !afterDigest) {
      deleted.set(filePath, beforeDigest);
      continue;
    }

    updated.push({
      path: filePath,
      changeKind: "updated",
      source: "observed",
    });
  }

  const renamed = pairRenames(created, deleted);

  return [
    ...[...renamed.values()].map(({ fromPath, toPath }) => ({
      path: toPath,
      changeKind: "renamed" as const,
      summary: `from ${fromPath}`,
      source: "observed" as const,
    })),
    ...[...created.keys()].map((filePath) => ({
      path: filePath,
      changeKind: "created" as const,
      source: "observed" as const,
    })),
    ...updated,
    ...[...deleted.keys()].map((filePath) => ({
      path: filePath,
      changeKind: "deleted" as const,
      source: "observed" as const,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export async function resolveUnexpectedObservedPaths(input: {
  repoRoot: string;
  before: RepoObservation;
  trackedPaths: Iterable<string>;
  unexpectedObservedPaths: Iterable<string>;
}): Promise<string[]> {
  const trackedPaths = [...new Set(input.trackedPaths)].sort((left, right) => left.localeCompare(right));
  const unexpectedObservedPaths = [...new Set(input.unexpectedObservedPaths)].sort((left, right) => left.localeCompare(right));
  if (unexpectedObservedPaths.length === 0) {
    return [];
  }

  const beforeFiles = Object.fromEntries(
    Object.entries(input.before.files).filter(([filePath]) =>
      unexpectedObservedPaths.some((candidatePath) => isPathCoveredByCandidate(filePath, candidatePath)),
    ),
  );
  const after = await observeRepoStateForPaths(input.repoRoot, unexpectedObservedPaths);

  return computeTurnChangedFiles(
    {
      observedAt: input.before.observedAt,
      digest: "",
      files: beforeFiles,
    },
    after,
  )
    .map((item) => item.path)
    .filter((pathValue) => !trackedPaths.some((candidatePath) => isPathCoveredByCandidate(pathValue, candidatePath)));
}

export function createObservedTurn(input: {
  turnId: string;
  prompt: string;
  startedAt: string;
  outcome: ActivityTurnRecord["outcome"];
  before: RepoObservation;
  after: RepoObservation;
  writeJournal?: TurnWriteJournal | null;
  trackedPaths?: Iterable<string> | null;
  unexpectedObservedPaths?: string[];
  broadCandidateScope?: boolean;
}): { latestTurn: ActivityTurnRecord; rollback: ActivityRollbackState } {
  const trackedPaths = [...new Set(input.trackedPaths ?? [])].sort((left, right) => left.localeCompare(right));
  const unexpectedObservedPaths = [...new Set(input.unexpectedObservedPaths ?? [])].sort((left, right) => left.localeCompare(right));
  const changedFiles = mergeUnexpectedObservedPaths(computeTurnChangedFiles(input.before, input.after), unexpectedObservedPaths);
  const canUseWriteJournalRollback = canRollbackWithTurnWriteJournal(changedFiles, input.writeJournal ?? null);
  const evidenceClosed = !input.broadCandidateScope && unexpectedObservedPaths.length === 0;
  const latestTurn: ActivityTurnRecord = {
    id: input.turnId,
    prompt: input.prompt,
    startedAt: input.startedAt,
    completedAt: input.after.observedAt,
    outcome: input.outcome,
    changedFiles,
  };

  return {
    latestTurn,
    rollback: {
      authority: "joudo",
      executor: canUseWriteJournalRollback ? "joudo-write-journal" : "copilot-undo",
      status: changedFiles.length === 0 ? "no-changes" : evidenceClosed ? "ready" : "needs-review",
      canRollback: changedFiles.length > 0 && evidenceClosed,
      reason:
        changedFiles.length === 0
          ? "上一轮没有观测到文件改动。"
          : input.broadCandidateScope
            ? "当前这轮命中的候选路径范围过宽，Joudo 不会把它标记为可确定性回退。"
            : unexpectedObservedPaths.length > 0
              ? `检测到 ${unexpectedObservedPaths.length} 个候选路径之外的实际写入，Joudo 不会自动扩大上一轮回退边界。`
              : canUseWriteJournalRollback
                ? "可以按 Joudo 记录的写入基线直接撤回上一轮文件改动。"
                : "可以尝试撤回上一轮工作区改动。",
      targetTurnId: changedFiles.length > 0 ? input.turnId : null,
      changedFiles,
      ...(trackedPaths.length > 0 ? { trackedPaths } : {}),
      evaluatedAt: input.after.observedAt,
      workspaceDigestBefore: input.before.digest,
      workspaceDigestAfter: input.after.digest,
    },
  };
}

export function markRollbackUnavailable(
  rollback: ActivityRollbackState | null,
  status: Exclude<ActivityRollbackState["status"], "ready">,
  reason: string,
  evaluatedAt = new Date().toISOString(),
): ActivityRollbackState | null {
  if (!rollback) {
    return null;
  }

  return {
    ...rollback,
    status,
    canRollback: false,
    reason,
    evaluatedAt,
  };
}