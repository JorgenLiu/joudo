import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  HistoricalSessionRecoveryMode,
  RepoDescriptor,
  RepoInstructionDocument,
  SessionIndexDocument,
  SessionIndexEntry,
  SessionSnapshot,
} from "@joudo/shared";

import type { LoadedRepoPolicy } from "../policy/index.js";
import type { TurnWriteJournalEntry } from "./turn-write-journal.js";

const JOUDO_DIR_NAME = ".joudo";
const REPO_INSTRUCTION_FILE = "repo-instructions.md";
const SESSION_INDEX_FILE = "sessions-index.json";
const SESSIONS_DIR_NAME = "sessions";
const SESSION_INDEX_SCHEMA_VERSION = 1;
const SESSION_SNAPSHOT_SCHEMA_VERSION = 1;

type PersistedSessionSnapshotDocument = {
  schemaVersion: number;
  sessionId: string;
  createdAt: string;
  lastKnownCopilotSessionId: string | null;
  latestTurnWriteJournal?: TurnWriteJournalEntry[];
  snapshot: SessionSnapshot;
};

export type LoadedSessionSnapshot = PersistedSessionSnapshotDocument;

function repoStateDir(repoRoot: string): string {
  return join(repoRoot, JOUDO_DIR_NAME);
}

function sessionsDir(repoRoot: string): string {
  return join(repoStateDir(repoRoot), SESSIONS_DIR_NAME);
}

function instructionPath(repoRoot: string): string {
  return join(repoStateDir(repoRoot), REPO_INSTRUCTION_FILE);
}

function sessionIndexPath(repoRoot: string): string {
  return join(repoStateDir(repoRoot), SESSION_INDEX_FILE);
}

export function getRepoInstructionPath(repoRoot: string): string {
  return instructionPath(repoRoot);
}

export function getSessionIndexPath(repoRoot: string): string {
  return sessionIndexPath(repoRoot);
}

const VALID_SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function assertSafeSessionId(sessionId: string): void {
  if (!VALID_SESSION_ID_PATTERN.test(sessionId) || sessionId.includes("..")) {
    throw new Error(`Invalid session id: ${sessionId.slice(0, 40)}`);
  }
}

function sessionDir(repoRoot: string, sessionId: string): string {
  assertSafeSessionId(sessionId);
  return join(sessionsDir(repoRoot), sessionId);
}

function sessionSnapshotPath(repoRoot: string, sessionId: string): string {
  return join(sessionDir(repoRoot, sessionId), "snapshot.json");
}

function ensureParentDirectorySync(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

async function ensureParentDirectory(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

function writeAtomicSync(filePath: string, content: string) {
  ensureParentDirectorySync(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, "utf8");
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "EXDEV") {
      writeFileSync(filePath, content, "utf8");
      try { unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
    } else {
      throw error;
    }
  }
}

async function writeAtomic(filePath: string, content: string) {
  await ensureParentDirectory(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "EXDEV") {
      await writeFile(filePath, content, "utf8");
      try { await unlink(tempPath); } catch { /* best-effort cleanup */ }
    } else {
      throw error;
    }
  }
}

function truncatePreview(value: string | null, maxLength = 140): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function createEmptySessionIndex(repo: RepoDescriptor): SessionIndexDocument {
  return {
    schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
    repoId: repo.id,
    repoPath: repo.rootPath,
    currentSessionId: null,
    updatedAt: null,
    sessions: [],
  };
}

function defaultRepoInstructionContent(repo: RepoDescriptor): string {
  return [
    "- Add repo-specific workflow notes here.",
    "- Add anything Joudo should prefer or avoid in this repository.",
    "- Keep short-lived context here only if it should apply across multiple prompts.",
  ].join("\n");
}

function buildGeneratedRepoInstruction(repo: RepoDescriptor, policy: LoadedRepoPolicy): string {
  const lines = [
    `# Generated Joudo Repo Context: ${repo.name}`,
    "",
    `- Repo path: ${repo.rootPath}`,
    `- Trusted: ${repo.trusted ? "yes" : "no"}`,
    `- Policy state: ${policy.state}`,
  ];

  if (policy.path) {
    lines.push(`- Policy file: ${policy.path}`);
  }

  if (policy.error) {
    lines.push(`- Policy issue: ${policy.error}`);
  }

  lines.push("", "## Policy Summary");

  if (!policy.config) {
    lines.push("- No valid repo policy is currently loaded.");
    return lines.join("\n");
  }

  lines.push(
    `- allow_shell: ${policy.config.allowShell.length ? policy.config.allowShell.join(", ") : "none"}`,
    `- confirm_shell: ${policy.config.confirmShell.length ? policy.config.confirmShell.join(", ") : "none"}`,
    `- deny_shell: ${policy.config.denyShell.length ? policy.config.denyShell.join(", ") : "none"}`,
    `- allow_tools: ${policy.config.allowTools.length ? policy.config.allowTools.join(", ") : "none"}`,
    `- confirm_tools: ${policy.config.confirmTools.length ? policy.config.confirmTools.join(", ") : "none"}`,
    `- deny_tools: ${policy.config.denyTools.length ? policy.config.denyTools.join(", ") : "none"}`,
    `- allowed_paths: ${policy.config.allowedPaths.length ? policy.config.allowedPaths.join(", ") : "."}`,
    `- allowed_write_paths: ${policy.config.allowedWritePaths.length ? policy.config.allowedWritePaths.join(", ") : "none"}`,
    `- allowed_urls: ${policy.config.allowedUrls.length ? policy.config.allowedUrls.join(", ") : "none"}`,
  );

  return lines.join("\n");
}

function composeRepoInstruction(generatedContent: string, userNotes: string): string {
  return [generatedContent, "", "## User Notes", userNotes.trim() || "- No user notes yet."].join("\n");
}

function isPersistedSessionStatus(value: unknown): value is SessionIndexEntry["status"] {
  return (
    value === "interrupted" ||
    value === "disconnected" ||
    value === "idle" ||
    value === "running" ||
    value === "awaiting-approval" ||
    value === "recovering" ||
    value === "timed-out"
  );
}

function getRecoveryMode(status: SessionIndexEntry["status"], lastKnownCopilotSessionId: string | null): HistoricalSessionRecoveryMode {
  if (lastKnownCopilotSessionId && (status === "idle" || status === "disconnected")) {
    return "attach";
  }

  return "history-only";
}

function normalizeSessionIndex(repo: RepoDescriptor, raw: unknown): SessionIndexDocument {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return createEmptySessionIndex(repo);
  }

  const record = raw as Record<string, unknown>;
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  const normalizedSessions: SessionIndexEntry[] = sessions
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => {
      const status = isPersistedSessionStatus(entry.status) ? entry.status : "idle";
      const lastKnownCopilotSessionId = typeof entry.lastKnownCopilotSessionId === "string" ? entry.lastKnownCopilotSessionId : null;
      const recoveryMode = getRecoveryMode(status, lastKnownCopilotSessionId);

      return {
        id: typeof entry.id === "string" ? entry.id : `session-${Date.now()}`,
        title: typeof entry.title === "string" ? entry.title : "Joudo Session",
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date(0).toISOString(),
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString(),
        status,
        canAttemptResume: recoveryMode === "attach",
        recoveryMode,
        turnCount: typeof entry.turnCount === "number" && Number.isFinite(entry.turnCount) ? entry.turnCount : 0,
        lastPromptPreview: typeof entry.lastPromptPreview === "string" ? entry.lastPromptPreview : null,
        summaryTitle: typeof entry.summaryTitle === "string" ? entry.summaryTitle : null,
        summaryPreview: typeof entry.summaryPreview === "string" ? entry.summaryPreview : null,
        hasPendingApprovals: entry.hasPendingApprovals === true,
        lastKnownCopilotSessionId,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const currentSessionId = typeof record.currentSessionId === "string" ? record.currentSessionId : null;
  const nextIndex: SessionIndexDocument = {
    schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
    repoId: typeof record.repoId === "string" ? record.repoId : repo.id,
    repoPath: typeof record.repoPath === "string" ? record.repoPath : repo.rootPath,
    currentSessionId,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    sessions: normalizedSessions,
  };

  if (!nextIndex.currentSessionId) {
    return nextIndex;
  }

  const currentEntry = nextIndex.sessions.find((entry) => entry.id === nextIndex.currentSessionId) ?? null;
  if (!currentEntry) {
    return {
      ...nextIndex,
      currentSessionId: null,
    };
  }

  if (currentEntry.status === "running" || currentEntry.status === "awaiting-approval" || currentEntry.status === "recovering") {
    currentEntry.status = "interrupted";
    currentEntry.recoveryMode = getRecoveryMode(currentEntry.status, currentEntry.lastKnownCopilotSessionId);
    currentEntry.canAttemptResume = currentEntry.recoveryMode === "attach";
    return {
      ...nextIndex,
      currentSessionId: null,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    ...nextIndex,
    currentSessionId: null,
  };
}

export function createSessionIndexEntry(input: {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SessionIndexEntry["status"];
  turnCount: number;
  lastPrompt: string | null;
  summaryTitle: string | null;
  summaryBody: string | null;
  hasPendingApprovals: boolean;
  lastKnownCopilotSessionId: string | null;
}): SessionIndexEntry {
  const recoveryMode = getRecoveryMode(input.status, input.lastKnownCopilotSessionId);
  return {
    id: input.id,
    title: truncatePreview(input.summaryTitle ?? input.lastPrompt ?? "Joudo Session", 80) ?? "Joudo Session",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    status: input.status,
    canAttemptResume: recoveryMode === "attach",
    recoveryMode,
    turnCount: input.turnCount,
    lastPromptPreview: truncatePreview(input.lastPrompt, 120),
    summaryTitle: truncatePreview(input.summaryTitle, 80),
    summaryPreview: truncatePreview(input.summaryBody, 180),
    hasPendingApprovals: input.hasPendingApprovals,
    lastKnownCopilotSessionId: input.lastKnownCopilotSessionId,
  };
}

export function upsertSessionIndexEntry(document: SessionIndexDocument, entry: SessionIndexEntry, currentSessionId: string | null): SessionIndexDocument {
  const sessions = [entry, ...document.sessions.filter((candidate) => candidate.id !== entry.id)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  return {
    ...document,
    currentSessionId,
    updatedAt: entry.updatedAt,
    sessions,
  };
}

export function loadSessionIndex(repo: RepoDescriptor): SessionIndexDocument {
  const filePath = sessionIndexPath(repo.rootPath);
  if (!existsSync(filePath)) {
    return createEmptySessionIndex(repo);
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const document = normalizeSessionIndex(repo, JSON.parse(content) as unknown);
    writeAtomicSync(filePath, `${JSON.stringify(document, null, 2)}\n`);
    return document;
  } catch (error) {
    console.warn(`[persistence] Failed to parse session index at ${filePath}, creating backup:`, error instanceof Error ? error.message : error);
    try {
      const backupPath = `${filePath}.${Date.now()}.bak`;
      const raw = readFileSync(filePath);
      writeFileSync(backupPath, raw);
    } catch { /* best-effort backup */ }
    return createEmptySessionIndex(repo);
  }
}

export async function saveSessionIndex(repoRoot: string, document: SessionIndexDocument): Promise<void> {
  await writeAtomic(sessionIndexPath(repoRoot), `${JSON.stringify(document, null, 2)}\n`);
}

export async function readOrCreateRepoInstruction(repo: RepoDescriptor, policy: LoadedRepoPolicy): Promise<RepoInstructionDocument> {
  const filePath = instructionPath(repo.rootPath);
  if (!existsSync(filePath)) {
    const content = defaultRepoInstructionContent(repo);
    await writeAtomic(filePath, content);
  }

  const userNotes = readFileSync(filePath, "utf8");
  const details = statSync(filePath);
  const generatedContent = buildGeneratedRepoInstruction(repo, policy);
  return {
    repoId: repo.id,
    repoPath: repo.rootPath,
    path: filePath,
    exists: true,
    generatedContent,
    userNotes,
    content: composeRepoInstruction(generatedContent, userNotes),
    updatedAt: details.mtime.toISOString(),
  };
}

export async function saveRepoInstruction(repo: RepoDescriptor, policy: LoadedRepoPolicy, userNotes: string): Promise<RepoInstructionDocument> {
  const filePath = instructionPath(repo.rootPath);
  await writeAtomic(filePath, userNotes);
  const details = await stat(filePath);
  const generatedContent = buildGeneratedRepoInstruction(repo, policy);
  return {
    repoId: repo.id,
    repoPath: repo.rootPath,
    path: filePath,
    exists: true,
    generatedContent,
    userNotes,
    content: composeRepoInstruction(generatedContent, userNotes),
    updatedAt: details.mtime.toISOString(),
  };
}

export async function initializeRepoInstruction(repo: RepoDescriptor, policy: LoadedRepoPolicy): Promise<{ created: boolean; document: RepoInstructionDocument }> {
  const filePath = instructionPath(repo.rootPath);
  const existed = existsSync(filePath);
  const document = await readOrCreateRepoInstruction(repo, policy);
  return {
    created: !existed,
    document,
  };
}

export async function initializeSessionIndex(repo: RepoDescriptor): Promise<{ created: boolean; document: SessionIndexDocument }> {
  const filePath = sessionIndexPath(repo.rootPath);
  const existed = existsSync(filePath);
  const document = loadSessionIndex(repo);
  if (!existed) {
    await saveSessionIndex(repo.rootPath, document);
  }

  return {
    created: !existed,
    document,
  };
}

export async function clearSessionHistory(repo: RepoDescriptor): Promise<SessionIndexDocument> {
  const emptyIndex = createEmptySessionIndex(repo);
  await rm(sessionsDir(repo.rootPath), { recursive: true, force: true }).catch(() => {});
  await saveSessionIndex(repo.rootPath, emptyIndex);
  return emptyIndex;
}

export async function saveSessionSnapshot(input: {
  repoRoot: string;
  sessionId: string;
  createdAt: string;
  lastKnownCopilotSessionId: string | null;
  latestTurnWriteJournal?: TurnWriteJournalEntry[];
  snapshot: SessionSnapshot;
}): Promise<void> {
  const payload: PersistedSessionSnapshotDocument = {
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    lastKnownCopilotSessionId: input.lastKnownCopilotSessionId,
    ...(input.latestTurnWriteJournal ? { latestTurnWriteJournal: input.latestTurnWriteJournal } : {}),
    snapshot: input.snapshot,
  };

  await writeAtomic(sessionSnapshotPath(input.repoRoot, input.sessionId), `${JSON.stringify(payload, null, 2)}\n`);
}

export function readSessionSnapshot(repoRoot: string, sessionId: string): LoadedSessionSnapshot | null {
  const filePath = sessionSnapshotPath(repoRoot, sessionId);
  if (!existsSync(filePath)) {
    return null;
  }

  const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024; // 50 MB
  const fileSize = statSync(filePath).size;
  if (fileSize > MAX_SNAPSHOT_BYTES) {
    console.warn(`[persistence] Skipping oversized snapshot (${(fileSize / 1024 / 1024).toFixed(1)} MB): ${filePath}`);
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const payload = JSON.parse(content) as LoadedSessionSnapshot;
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return payload;
  } catch (error) {
    console.warn(`[persistence] Failed to parse session snapshot at ${filePath}, creating backup:`, error instanceof Error ? error.message : error);
    try {
      const backupPath = `${filePath}.${Date.now()}.bak`;
      const raw = readFileSync(filePath);
      writeFileSync(backupPath, raw);
    } catch { /* best-effort backup */ }
    return null;
  }
}

// --- Session pruning ---

const SNAPSHOT_KEEP_COUNT = 5;
const INDEX_KEEP_COUNT = 50;

/**
 * Enforce session retention policy:
 *  - Current session: always keep snapshot + index
 *  - Most recent SNAPSHOT_KEEP_COUNT completed sessions: keep snapshot + index
 *  - Older sessions up to INDEX_KEEP_COUNT total: keep index entry, delete snapshot
 *  - Beyond INDEX_KEEP_COUNT: remove from index and delete snapshot
 *
 * Returns the pruned SessionIndexDocument (caller should persist it).
 */
export async function pruneSessionHistory(
  repoRoot: string,
  index: SessionIndexDocument,
): Promise<SessionIndexDocument> {
  const currentId = index.currentSessionId;
  const sorted = [...index.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const kept: SessionIndexEntry[] = [];
  let snapshotKept = 0;

  for (const entry of sorted) {
    const isCurrent = entry.id === currentId;

    if (isCurrent) {
      // Always keep the current session fully
      kept.push(entry);
      snapshotKept++;
      continue;
    }

    if (kept.length >= INDEX_KEEP_COUNT) {
      // Beyond index cap — discard entry and delete snapshot
      await removeSessionSnapshot(repoRoot, entry.id);
      continue;
    }

    if (snapshotKept < SNAPSHOT_KEEP_COUNT) {
      // Within snapshot budget — keep snapshot
      kept.push(entry);
      snapshotKept++;
    } else {
      // Beyond snapshot budget — keep index entry, delete snapshot
      kept.push(entry);
      await removeSessionSnapshot(repoRoot, entry.id);
    }
  }

  return {
    ...index,
    sessions: kept,
  };
}

async function removeSessionSnapshot(repoRoot: string, sessionId: string): Promise<void> {
  const dir = sessionDir(repoRoot, sessionId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — ignore errors
  }
}

/**
 * Remove orphaned session directories that are not in the index.
 */
export async function removeOrphanedSessionDirs(repoRoot: string, index: SessionIndexDocument): Promise<void> {
  const dir = sessionsDir(repoRoot);
  if (!existsSync(dir)) {
    return;
  }

  const knownIds = new Set(index.sessions.map((s) => s.id));
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !knownIds.has(entry.name)) {
        await rm(join(dir, entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // Best-effort — ignore errors
  }
}