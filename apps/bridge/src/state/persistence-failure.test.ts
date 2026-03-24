import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureJoudoSession, queuePersistence, snapshotForContext } from "./session-store.js";
import { clearSessionHistory, createSessionIndexEntry, saveSessionIndex, saveSessionSnapshot } from "./persistence.js";
import type { RepoContext } from "./types.js";

function createMinimalRepoContext(repoRoot: string): RepoContext {
  const now = new Date().toISOString();
  return {
    repo: {
      id: "test-repo",
      name: "test",
      rootPath: repoRoot,
      trusted: true,
      policyState: "loaded",
    },
    policy: {
      state: "loaded",
      path: join(repoRoot, ".github", "joudo-policy.yml"),
      config: {
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
      },
      error: null,
    },
    currentModel: "gpt-5-mini",
    currentAgent: "reviewer",
    availableAgents: ["reviewer"],
    agentCatalog: {
      globalCount: 1,
      repoCount: 1,
      totalCount: 1,
    },
    status: "idle",
    lastPrompt: null,
    timeline: [],
    auditLog: [],
    summary: null,
    updatedAt: now,
    latestAssistantMessage: null,
    lifecycle: {
      session: null,
      joudoSessionId: null,
      joudoSessionCreatedAt: null,
      lastKnownCopilotSessionId: null,
      activePrompt: null,
      subscriptions: [],
    },
    turns: {
      turnCount: 0,
      activeTurn: null,
      latestTurn: null,
      latestTurnWriteJournal: null,
      checkpoints: [],
      latestCompaction: null,
      rollback: null,
      workspacePath: null,
    },
    approvalState: {
      approvals: [],
      pendingApprovals: new Map(),
      approvedCommands: [],
      approvedApprovalTypes: [],
    },
  };
}

test("queuePersistence successfully writes snapshot and index to disk", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-persist-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await writeFile(join(repoRoot, ".github", "joudo-policy.yml"), "version: 1\ntrusted: true\n", "utf8");

    const context = createMinimalRepoContext(repoRoot);
    ensureJoudoSession(context);

    const persistenceQueues = new Map<string, Promise<void>>();
    const sessionIndices = new Map();
    let errorCalled = false;

    queuePersistence(context, {
      sessionIndices,
      persistenceQueues,
      authState: { status: "authenticated", message: "ok" },
      availableModels: ["gpt-5-mini"],
      defaultModel: "gpt-5-mini",
      onPersistenceError: () => { errorCalled = true; },
    });

    // Wait for the queue to drain
    await persistenceQueues.get("test-repo");

    assert.equal(errorCalled, false, "onPersistenceError should not be called on success");

    // Verify files were written
    const { existsSync } = await import("node:fs");
    const joudoDir = join(repoRoot, ".joudo");
    assert.ok(existsSync(join(joudoDir, "sessions-index.json")), "sessions-index.json should exist");
    assert.ok(
      existsSync(join(joudoDir, "sessions", context.lifecycle.joudoSessionId!)),
      "session directory should exist",
    );

    const persisted = JSON.parse(
      await readFile(join(joudoDir, "sessions", context.lifecycle.joudoSessionId!, "snapshot.json"), "utf8"),
    ) as { snapshot: { agent: string | null; availableAgents: string[]; agentCatalog: { totalCount: number } } };

    assert.equal(persisted.snapshot.agent, null);
    assert.deepEqual(persisted.snapshot.availableAgents, []);
    assert.equal(persisted.snapshot.agentCatalog.totalCount, 0);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("queuePersistence calls onPersistenceError after retries are exhausted", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-persist-fail-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await writeFile(join(repoRoot, ".github", "joudo-policy.yml"), "version: 1\ntrusted: true\n", "utf8");

    // Create the .joudo directory first, then make it read-only to force write failure
    await mkdir(join(repoRoot, ".joudo", "sessions"), { recursive: true });
    await chmod(join(repoRoot, ".joudo", "sessions"), 0o444);
    await chmod(join(repoRoot, ".joudo"), 0o444);

    const context = createMinimalRepoContext(repoRoot);
    ensureJoudoSession(context);

    const persistenceQueues = new Map<string, Promise<void>>();
    const sessionIndices = new Map();
    let errorRepoId: string | null = null;
    let errorValue: unknown = null;

    queuePersistence(context, {
      sessionIndices,
      persistenceQueues,
      authState: { status: "authenticated", message: "ok" },
      availableModels: ["gpt-5-mini"],
      defaultModel: "gpt-5-mini",
      onPersistenceError: (repoId, error) => {
        errorRepoId = repoId;
        errorValue = error;
      },
    });

    // Wait for the queue to drain (including retries)
    await persistenceQueues.get("test-repo");
    // Give the error callback a tick to fire
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(errorRepoId, "test-repo", "onPersistenceError should receive the repo id");
    assert.ok(errorValue !== null, "onPersistenceError should receive the error");
  } finally {
    // Restore permissions for cleanup
    await chmod(join(repoRoot, ".joudo"), 0o755).catch(() => {});
    await chmod(join(repoRoot, ".joudo", "sessions"), 0o755).catch(() => {});
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("queuePersistence is skipped when joudoSessionId is not set", () => {
  const repoRoot = "/tmp/joudo-test-no-session";
  const context = createMinimalRepoContext(repoRoot);
  // Don't call ensureJoudoSession — context.joudoSessionId remains null

  const persistenceQueues = new Map<string, Promise<void>>();
  const sessionIndices = new Map();
  let errorCalled = false;

  queuePersistence(context, {
    sessionIndices,
    persistenceQueues,
    authState: { status: "authenticated", message: "ok" },
    availableModels: ["gpt-5-mini"],
    defaultModel: "gpt-5-mini",
    onPersistenceError: () => { errorCalled = true; },
  });

  // No queue entry should be created
  assert.equal(persistenceQueues.has("test-repo"), false, "No persistence should be queued without a session id");
  assert.equal(errorCalled, false);
});

test("clearSessionHistory removes persisted snapshots and rewrites an empty index", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-clear-history-"));

  try {
    const repo = {
      id: "test-repo",
      name: "test",
      rootPath: repoRoot,
      trusted: true,
      policyState: "loaded" as const,
    };

    const entry = createSessionIndexEntry({
      id: "joudo-1",
      createdAt: new Date("2026-03-23T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-03-23T00:10:00.000Z").toISOString(),
      status: "idle",
      turnCount: 1,
      lastPrompt: "test prompt",
      summaryTitle: "done",
      summaryBody: "done body",
      hasPendingApprovals: false,
      lastKnownCopilotSessionId: null,
    });

    await saveSessionIndex(repoRoot, {
      schemaVersion: 1,
      repoId: repo.id,
      repoPath: repo.rootPath,
      currentSessionId: null,
      updatedAt: entry.updatedAt,
      sessions: [entry],
    });

    await saveSessionSnapshot({
      repoRoot,
      sessionId: entry.id,
      createdAt: entry.createdAt,
      lastKnownCopilotSessionId: null,
      snapshot: snapshotForContext(createMinimalRepoContext(repoRoot), { status: "authenticated", message: "ok" }, ["gpt-5-mini"], "gpt-5-mini"),
    });

    const nextIndex = await clearSessionHistory(repo);
    const indexContent = JSON.parse(await readFile(join(repoRoot, ".joudo", "sessions-index.json"), "utf8")) as { sessions: unknown[] };

    assert.equal(nextIndex.sessions.length, 0);
    assert.equal(indexContent.sessions.length, 0);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(join(repoRoot, ".joudo", "sessions", entry.id)), false);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
