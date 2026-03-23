import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SessionIndexDocument, SessionIndexEntry } from "@joudo/shared";

import { pruneSessionHistory, removeOrphanedSessionDirs } from "./persistence.js";

function makeEntry(id: string, updatedAt: string, overrides?: Partial<SessionIndexEntry>): SessionIndexEntry {
  return {
    id,
    title: `Session ${id}`,
    createdAt: updatedAt,
    updatedAt,
    status: "idle",
    canAttemptResume: false,
    recoveryMode: "history-only",
    turnCount: 1,
    lastPromptPreview: null,
    summaryTitle: null,
    summaryPreview: null,
    hasPendingApprovals: false,
    lastKnownCopilotSessionId: null,
    ...overrides,
  };
}

function makeIndex(sessions: SessionIndexEntry[], currentSessionId: string | null = null): SessionIndexDocument {
  return {
    schemaVersion: 1,
    repoId: "test-repo",
    repoPath: "/tmp/test-repo",
    currentSessionId,
    updatedAt: sessions[0]?.updatedAt ?? null,
    sessions,
  };
}

function createSnapshotDir(repoRoot: string, sessionId: string) {
  const dir = join(repoRoot, ".joudo", "sessions", sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "snapshot.json"), "{}", "utf8");
}

function snapshotExists(repoRoot: string, sessionId: string): boolean {
  return existsSync(join(repoRoot, ".joudo", "sessions", sessionId, "snapshot.json"));
}

test("pruneSessionHistory keeps all sessions when count is within limits", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "prune-test-"));
  try {
    const sessions = Array.from({ length: 3 }, (_, i) =>
      makeEntry(`s${i}`, `2026-01-0${i + 1}T00:00:00Z`),
    );
    for (const s of sessions) createSnapshotDir(tmpRoot, s.id);

    const index = makeIndex(sessions, "s2");
    const result = await pruneSessionHistory(tmpRoot, index);

    assert.equal(result.sessions.length, 3);
    for (const s of sessions) assert.ok(snapshotExists(tmpRoot, s.id));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("pruneSessionHistory keeps current session snapshot even if old", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "prune-test-"));
  try {
    // 8 sessions total, current is the oldest one
    const sessions = Array.from({ length: 8 }, (_, i) =>
      makeEntry(`s${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    for (const s of sessions) createSnapshotDir(tmpRoot, s.id);

    const index = makeIndex(sessions, "s0"); // oldest is current
    const result = await pruneSessionHistory(tmpRoot, index);

    assert.equal(result.sessions.length, 8);
    // Current session snapshot must survive
    assert.ok(snapshotExists(tmpRoot, "s0"));
    // Most recent 5 non-current (s7, s6, s5, s4, s3) keep snapshots
    for (const id of ["s7", "s6", "s5", "s4", "s3"]) {
      assert.ok(snapshotExists(tmpRoot, id), `${id} snapshot should exist`);
    }
    // Older non-current sessions (s1, s2) lose snapshots
    for (const id of ["s1", "s2"]) {
      assert.ok(!snapshotExists(tmpRoot, id), `${id} snapshot should be deleted`);
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("pruneSessionHistory deletes snapshots beyond keep count but retains index entries", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "prune-test-"));
  try {
    // 10 sessions, no current
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`s${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    for (const s of sessions) createSnapshotDir(tmpRoot, s.id);

    const index = makeIndex(sessions);
    const result = await pruneSessionHistory(tmpRoot, index);

    // All 10 entries survive in index (under 50 cap)
    assert.equal(result.sessions.length, 10);

    // Top 5 by updatedAt keep snapshots (s9, s8, s7, s6, s5)
    for (const id of ["s9", "s8", "s7", "s6", "s5"]) {
      assert.ok(snapshotExists(tmpRoot, id), `${id} snapshot should exist`);
    }

    // Older ones lose snapshots (s4, s3, s2, s1, s0)
    for (const id of ["s4", "s3", "s2", "s1", "s0"]) {
      assert.ok(!snapshotExists(tmpRoot, id), `${id} snapshot should be deleted`);
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("pruneSessionHistory drops entries and snapshots beyond index cap", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "prune-test-"));
  try {
    // 55 sessions — 5 should be dropped entirely
    const sessions = Array.from({ length: 55 }, (_, i) =>
      makeEntry(`s${String(i).padStart(3, "0")}`, `2026-01-01T${String(i).padStart(2, "0")}:00:00Z`),
    );
    for (const s of sessions) createSnapshotDir(tmpRoot, s.id);

    const index = makeIndex(sessions);
    const result = await pruneSessionHistory(tmpRoot, index);

    // Only 50 entries survive
    assert.equal(result.sessions.length, 50);

    // Oldest 5 (s000..s004) should be completely gone
    for (let i = 0; i < 5; i++) {
      const id = `s${String(i).padStart(3, "0")}`;
      assert.ok(!result.sessions.some((e) => e.id === id), `${id} should be removed from index`);
      assert.ok(!snapshotExists(tmpRoot, id), `${id} snapshot should be deleted`);
    }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("removeOrphanedSessionDirs cleans up directories not in the index", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "prune-test-"));
  try {
    createSnapshotDir(tmpRoot, "known-session");
    createSnapshotDir(tmpRoot, "orphan-session");

    const index = makeIndex([makeEntry("known-session", "2026-01-01T00:00:00Z")]);
    await removeOrphanedSessionDirs(tmpRoot, index);

    assert.ok(snapshotExists(tmpRoot, "known-session"));
    assert.ok(!existsSync(join(tmpRoot, ".joudo", "sessions", "orphan-session")));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
