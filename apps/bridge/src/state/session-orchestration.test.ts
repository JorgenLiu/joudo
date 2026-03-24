import assert from "node:assert/strict";
import test from "node:test";

import type { PersistedSessionStatus, SessionSnapshot, SessionSummary, SessionTimelineEntry } from "@joudo/shared";

import type { CopilotSession, PermissionRequest, PermissionRequestResult, SessionConfig } from "../copilot-sdk.js";
import { JoudoError } from "../errors.js";
import type { LoadedRepoPolicy } from "../policy/index.js";
import { createSessionOrchestration } from "./session-orchestration.js";
import type { SessionPermissionOps } from "./session-permissions.js";
import type { SessionRuntime } from "./session-runtime.js";
import type { RepoContext } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Minimal stub types & helpers                                      */
/* ------------------------------------------------------------------ */

function createTestPolicy(): LoadedRepoPolicy {
  return {
    state: "loaded",
    path: "/tmp/test-repo/.github/joudo-policy.yml",
    config: {
      version: 1 as const,
      trusted: false,
      allowTools: [], denyTools: [], confirmTools: [],
      allowShell: [], denyShell: [], confirmShell: [],
      allowedPaths: [], allowedWritePaths: [], allowedUrls: [],
    },
    error: null,
  };
}

function createTestContext(overrides?: Partial<RepoContext>): RepoContext {
  return {
    repo: { id: "test-repo", name: "test-repo", rootPath: "/tmp/test-repo", trusted: false },
    policy: createTestPolicy(),
    currentModel: "gpt-4o",
    status: "idle",
    lastPrompt: null,
    timeline: [],
    auditLog: [],
    summary: null,
    updatedAt: new Date().toISOString(),
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
    ...overrides,
  } as RepoContext;
}

class TestSession {
  readonly sessionId = "test-copilot-session";
  readonly workspacePath = "/tmp/test-workspace";

  private resolve!: (value: unknown) => void;
  private reject!: (reason: unknown) => void;

  readonly rpc = {
    permissions: {
      handlePendingPermissionRequest: async () => ({ kind: "handled" }),
    },
  } as unknown as CopilotSession["rpc"];

  on() {
    return () => {};
  }

  async disconnect() {}

  async getMessages() {
    return [];
  }

  sendAndWait(_input: { prompt: string }, _timeout?: number): Promise<{ type: string; data: { content: string }; timestamp: string }> {
    return new Promise((res, rej) => {
      this.resolve = res as (value: unknown) => void;
      this.reject = rej;
    });
  }

  /** Simulate a successful completion */
  completeWith(content: string) {
    this.resolve({ type: "assistant.message", data: { content }, timestamp: new Date().toISOString() });
  }

  /** Simulate an error */
  failWith(error: Error) {
    this.reject(error);
  }
}

type TimelineInput = Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string };
type OrcheLog = {
  timelineEntries: TimelineInput[];
  touchCalls: string[];
  persistenceCalls: number;
  publishCalls: number;
  summaryUpdates: SessionSummary[];
};

function createTestDeps(context: RepoContext, session?: TestSession) {
  const log: OrcheLog = {
    timelineEntries: [],
    touchCalls: [],
    persistenceCalls: 0,
    publishCalls: 0,
    summaryUpdates: [],
  };

  const testSession = session ?? new TestSession();

  const stubRuntime: SessionRuntime = {
    createSessionConfig: () => ({
      workingDirectory: context.repo.rootPath,
      onPermissionRequest: async () => ({ kind: "approved" }) as PermissionRequestResult,
      streaming: true,
      model: context.currentModel,
    }),
    ensureClient: async () => ({ start: async () => {}, stop: async () => {} }) as never,
    refreshAuthState: async () => ({ status: "authenticated" as const, message: "ok" }),
    refreshAvailableModels: async () => ["gpt-4o"],
    bindSession: () => {},
    ensureSession: async () => testSession as unknown as CopilotSession,
    stopClient: async () => {},
  };

  const stubPermissionOps: SessionPermissionOps = {
    refreshRepoPolicy: () => {},
    appendAuditEntry: () => {},
    updateAuditEntry: () => {},
    captureTurnWriteBaseline: async () => {},
    recordApprovedCommand: () => {},
    recordApprovedApprovalType: () => {},
    pushTimelineEntry: () => {},
    touch: () => {},
    queuePersistence: () => {},
    publishIfCurrent: () => {},
    emitApprovalRequested: () => {},
  };

  const snapshotResult: SessionSnapshot = {
    sessionId: "test-session",
    status: "idle",
    repo: context.repo,
    policy: null,
    model: "gpt-4o",
    availableModels: ["gpt-4o"],
    agent: null,
    availableAgents: [],
    agentCatalog: {
      globalCount: 0,
      repoCount: 0,
      totalCount: 0,
    },
    auth: { status: "authenticated", message: "ok" },
    lastPrompt: null,
    approvals: [],
    timeline: [],
    auditLog: [],
    activity: null,
    summary: null,
    updatedAt: new Date().toISOString(),
  };

  const deps = {
    currentContext: () => context,
    snapshot: () => ({ ...snapshotResult, status: context.status, lastPrompt: context.lastPrompt }),
    sessionIndices: new Map(),
    refreshRepoPolicy: () => {},
    ensureJoudoSession: (ctx: RepoContext) => {
      if (!ctx.lifecycle.joudoSessionId) {
        ctx.lifecycle.joudoSessionId = "test-joudo-session";
        ctx.lifecycle.joudoSessionCreatedAt = new Date().toISOString();
      }
    },
    pushTimeline: (_ctx: RepoContext, entry: TimelineInput) => { log.timelineEntries.push(entry); },
    touch: (ctx: RepoContext, status: RepoContext["status"]) => {
      log.touchCalls.push(status);
      ctx.status = status;
    },
    queueRepoPersistence: () => { log.persistenceCalls++; },
    publishIfCurrent: () => { log.publishCalls++; },
    emitSummaryUpdated: (summary: SessionSummary) => { log.summaryUpdates.push(summary); },
    sessionRuntime: stubRuntime,
    sessionPermissionOps: stubPermissionOps,
  };

  const orchestration = createSessionOrchestration(deps);
  return { orchestration, deps, log, testSession };
}

/* ------------------------------------------------------------------ */
/*  Tests: runPrompt                                                  */
/* ------------------------------------------------------------------ */

test("runPrompt: rejects empty prompt", async () => {
  const context = createTestContext();
  const { orchestration } = createTestDeps(context);

  await assert.rejects(
    () => orchestration.runPrompt(""),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 400,
  );
});

test("runPrompt: rejects whitespace-only prompt", async () => {
  const context = createTestContext();
  const { orchestration } = createTestDeps(context);

  await assert.rejects(
    () => orchestration.runPrompt("   "),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 400,
  );
});

test("runPrompt: returns snapshot when prompt already active", async () => {
  const context = createTestContext();
  context.lifecycle.activePrompt = new Promise(() => {}); // never resolves
  const { orchestration, log } = createTestDeps(context);

  const result = await orchestration.runPrompt("do something");

  // Should return a snapshot with a summary about the active prompt
  assert.ok(result);
  assert.ok(context.summary);
  assert.match(context.summary.title, /已有任务执行中/);
});

test("runPrompt: rejects when no repo context", async () => {
  const context = createTestContext();
  const { log } = createTestDeps(context);

  // Override currentContext to return null
  const emptyDeps = {
    currentContext: () => null as RepoContext | null,
    snapshot: () => ({}) as SessionSnapshot,
    sessionIndices: new Map(),
    refreshRepoPolicy: () => {},
    ensureJoudoSession: () => {},
    pushTimeline: () => {},
    touch: () => {},
    queueRepoPersistence: () => {},
    publishIfCurrent: () => {},
    emitSummaryUpdated: () => {},
    sessionRuntime: {
      createSessionConfig: () => ({}) as never,
      ensureClient: async () => ({}) as never,
      refreshAuthState: async () => ({ status: "authenticated" as const, message: "ok" }),
      refreshAvailableModels: async () => [],
      bindSession: () => {},
      ensureSession: async () => ({}) as never,
      stopClient: async () => {},
    } as SessionRuntime,
    sessionPermissionOps: {} as SessionPermissionOps,
  };
  const orchestration = createSessionOrchestration(emptyDeps);

  await assert.rejects(
    () => orchestration.runPrompt("test"),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 404,
  );
});

test("runPrompt: sets up turn tracking and session state correctly", async () => {
  const context = createTestContext();
  const testSession = new TestSession();
  const { orchestration, log } = createTestDeps(context, testSession);

  // Start prompt — it will block until we resolve the session
  const promptPromise = orchestration.runPrompt("build feature X");

  // Give the microtask queue a tick for the then/catch/finally chain to set up
  await new Promise((r) => setTimeout(r, 10));

  // Verify setup happened
  assert.equal(context.lastPrompt, "build feature X");
  assert.equal(context.turns.turnCount, 1);
  assert.ok(context.lifecycle.joudoSessionId);

  // Complete the session
  testSession.completeWith("Done!");

  const result = await promptPromise;
  assert.ok(result);

  // The .then/.catch/.finally chain on activePrompt is async — await it to let cleanup run
  if (context.lifecycle.activePrompt) {
    await context.lifecycle.activePrompt;
  }
  assert.equal(context.lifecycle.activePrompt, null);
});

test("runPrompt: handles session creation failure gracefully", async () => {
  const context = createTestContext();
  const failingRuntime: SessionRuntime = {
    createSessionConfig: () => ({}) as never,
    ensureClient: async () => ({}) as never,
    refreshAuthState: async () => ({ status: "authenticated" as const, message: "ok" }),
    refreshAvailableModels: async () => [],
    bindSession: () => {},
    ensureSession: async () => { throw new Error("cannot start copilot"); },
    stopClient: async () => {},
  };

  const deps = {
    currentContext: () => context,
    snapshot: () => ({}) as SessionSnapshot,
    sessionIndices: new Map(),
    refreshRepoPolicy: () => {},
    ensureJoudoSession: (ctx: RepoContext) => {
      ctx.lifecycle.joudoSessionId = "test-session";
      ctx.lifecycle.joudoSessionCreatedAt = new Date().toISOString();
    },
    pushTimeline: () => {},
    touch: (ctx: RepoContext, status: RepoContext["status"]) => { ctx.status = status; },
    queueRepoPersistence: () => {},
    publishIfCurrent: () => {},
    emitSummaryUpdated: () => {},
    sessionRuntime: failingRuntime,
    sessionPermissionOps: {} as SessionPermissionOps,
  };
  const orchestration = createSessionOrchestration(deps);

  const result = await orchestration.runPrompt("attempt something");

  // Should not throw — return a snapshot with error summary
  assert.ok(result);
  assert.ok(context.summary);
  assert.equal(context.status, "idle");
});

test("runPrompt: handles sendAndWait error", async () => {
  const context = createTestContext();
  const testSession = new TestSession();
  const { orchestration, log } = createTestDeps(context, testSession);

  const promptPromise = orchestration.runPrompt("try this");

  await new Promise((r) => setTimeout(r, 10));

  testSession.failWith(new Error("execution failed"));

  const result = await promptPromise;
  assert.ok(result);

  // The .then/.catch/.finally chain on activePrompt is async — await it to let cleanup run
  if (context.lifecycle.activePrompt) {
    await context.lifecycle.activePrompt;
  }
  // activePrompt should be cleaned up
  assert.equal(context.lifecycle.activePrompt, null);
  // Status should settle to idle
  assert.equal(context.status, "idle");
  // Error should be in summary
  assert.ok(context.summary);
});

/* ------------------------------------------------------------------ */
/*  Tests: rollbackLatestTurn                                         */
/* ------------------------------------------------------------------ */

test("rollbackLatestTurn: rejects when no repo context", async () => {
  const emptyDeps = {
    currentContext: () => null as RepoContext | null,
    snapshot: () => ({}) as SessionSnapshot,
    sessionIndices: new Map(),
    refreshRepoPolicy: () => {},
    ensureJoudoSession: () => {},
    pushTimeline: () => {},
    touch: () => {},
    queueRepoPersistence: () => {},
    publishIfCurrent: () => {},
    emitSummaryUpdated: () => {},
    sessionRuntime: {} as SessionRuntime,
    sessionPermissionOps: {} as SessionPermissionOps,
  };
  const orchestration = createSessionOrchestration(emptyDeps);

  await assert.rejects(
    () => orchestration.rollbackLatestTurn(),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 404,
  );
});

test("rollbackLatestTurn: rejects when prompt is active", async () => {
  const context = createTestContext();
  context.lifecycle.activePrompt = new Promise(() => {});
  const { orchestration } = createTestDeps(context);

  await assert.rejects(
    () => orchestration.rollbackLatestTurn(),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 409,
  );
});

test("rollbackLatestTurn: rejects when approvals are pending", async () => {
  const context = createTestContext();
  context.approvalState.approvals = [{ id: "approval-1" } as never];
  const { orchestration } = createTestDeps(context);

  await assert.rejects(
    () => orchestration.rollbackLatestTurn(),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 409,
  );
});

test("rollbackLatestTurn: rejects when no rollback data", async () => {
  const context = createTestContext();
  context.turns.rollback = null;
  const { orchestration } = createTestDeps(context);

  await assert.rejects(
    () => orchestration.rollbackLatestTurn(),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 409,
  );
});

/* ------------------------------------------------------------------ */
/*  Tests: recoverHistoricalSession                                   */
/* ------------------------------------------------------------------ */

test("recoverHistoricalSession: rejects when no repo context", async () => {
  const emptyDeps = {
    currentContext: () => null as RepoContext | null,
    snapshot: () => ({}) as SessionSnapshot,
    sessionIndices: new Map(),
    refreshRepoPolicy: () => {},
    ensureJoudoSession: () => {},
    pushTimeline: () => {},
    touch: () => {},
    queueRepoPersistence: () => {},
    publishIfCurrent: () => {},
    emitSummaryUpdated: () => {},
    sessionRuntime: {} as SessionRuntime,
    sessionPermissionOps: {} as SessionPermissionOps,
  };
  const orchestration = createSessionOrchestration(emptyDeps);

  await assert.rejects(
    () => orchestration.recoverHistoricalSession("some-session-id"),
    (error: unknown) => error instanceof JoudoError && error.statusCode === 404,
  );
});
