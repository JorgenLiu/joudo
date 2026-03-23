import assert from "node:assert/strict";
import test from "node:test";

import type { CopilotAuthState, SessionSummary, SessionTimelineEntry } from "@joudo/shared";

import type { PermissionRequest, PermissionRequestResult, SessionConfig } from "../copilot-sdk.js";
import type { CopilotClientLike, CreateClientFactory } from "./session-runtime.js";
import { createSessionRuntime } from "./session-runtime.js";
import type { RepoContext } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createMinimalRepoContext(overrides?: Partial<RepoContext>): RepoContext {
  return {
    repo: { id: "test-repo", name: "test-repo", rootPath: "/tmp/test-repo", trusted: false },
    policy: { state: "not-found", path: null, config: null, error: null },
    currentModel: "gpt-4o",
    status: "disconnected",
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

class StubClient implements CopilotClientLike {
  startCallCount = 0;
  stopped = false;
  private readonly startDelay: number;
  private readonly shouldFail: boolean;

  constructor(opts?: { startDelay?: number; shouldFail?: boolean }) {
    this.startDelay = opts?.startDelay ?? 0;
    this.shouldFail = opts?.shouldFail ?? false;
  }

  async start() {
    this.startCallCount++;
    if (this.startDelay > 0) {
      await new Promise((r) => setTimeout(r, this.startDelay));
    }
    if (this.shouldFail) {
      throw new Error("start failed");
    }
  }

  async stop() {
    this.stopped = true;
  }

  async getAuthStatus() {
    return { isAuthenticated: true, statusMessage: "ok" };
  }

  async listModels() {
    return [{ id: "gpt-4o" }];
  }

  async createSession(config: SessionConfig) {
    return { sessionId: "stub-session" } as never;
  }

  async resumeSession() {
    return { sessionId: "stub-session" } as never;
  }

  async listSessions() {
    return [];
  }
}

type RuntimeDepsOverrides = {
  createClient?: CreateClientFactory;
  currentContext?: () => RepoContext | null;
};

function createTestRuntime(overrides: RuntimeDepsOverrides = {}) {
  let authState: CopilotAuthState = { status: "unknown", message: "" };
  let availableModels: string[] = ["gpt-4o"];
  const clientRuntimeRef = { client: null as CopilotClientLike | null, clientStartPromise: null as Promise<unknown> | null };
  const context = createMinimalRepoContext();
  const repoContexts = new Map<string, RepoContext>([["test-repo", context]]);

  const deps = {
    clientRuntimeRef,
    createClient: overrides.createClient,
    currentContext: overrides.currentContext ?? (() => context),
    repoContexts,
    getAuthState: () => authState,
    setAuthState: (s: CopilotAuthState) => { authState = s; },
    getAvailableModels: () => availableModels,
    setAvailableModels: (m: string[]) => { availableModels = m; },
    refreshRepoPolicy: () => {},
    queuePersistence: () => {},
    pushTimelineEntry: () => {},
    touch: () => {},
    publishCurrentSnapshot: () => {},
    publishIfCurrent: () => {},
    emitSummaryUpdated: () => {},
    handlePermissionRequest: async () => ({ kind: "approved" }) as PermissionRequestResult,
  };

  const runtime = createSessionRuntime(deps);
  return { runtime, deps, clientRuntimeRef, context };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

test("ensureClient: concurrent calls return the same client", async () => {
  let created = 0;
  const sharedClient = new StubClient({ startDelay: 50 });
  const { runtime } = createTestRuntime({
    createClient: () => {
      created++;
      return sharedClient;
    },
  });

  const [a, b] = await Promise.all([runtime.ensureClient(), runtime.ensureClient()]);

  assert.equal(a, b, "both calls should return the same client instance");
  assert.equal(created, 1, "factory should be called exactly once");
  assert.equal(sharedClient.startCallCount, 1, "start() should be called once");
});

test("ensureClient: second call reuses already-started client", async () => {
  let created = 0;
  const sharedClient = new StubClient();
  const { runtime } = createTestRuntime({
    createClient: () => {
      created++;
      return sharedClient;
    },
  });

  const first = await runtime.ensureClient();
  const second = await runtime.ensureClient();

  assert.equal(first, second);
  assert.equal(created, 1);
});

test("ensureClient: start failure clears state and allows retry", async () => {
  let callCount = 0;
  const { runtime } = createTestRuntime({
    createClient: () => {
      callCount++;
      if (callCount === 1) {
        return new StubClient({ shouldFail: true });
      }
      return new StubClient();
    },
  });

  await assert.rejects(() => runtime.ensureClient(), /start failed/);

  // Second call should create a fresh client
  const client = await runtime.ensureClient();
  assert.ok(client);
  assert.equal(callCount, 2);
});

test("ensureClient: concurrent calls where start fails all reject", async () => {
  const { runtime } = createTestRuntime({
    createClient: () => new StubClient({ startDelay: 30, shouldFail: true }),
  });

  const results = await Promise.allSettled([runtime.ensureClient(), runtime.ensureClient()]);
  assert.equal(results[0]!.status, "rejected");
  assert.equal(results[1]!.status, "rejected");
});

test("refreshAuthState: sets authenticated state", async () => {
  const { runtime, deps } = createTestRuntime({
    createClient: () => new StubClient(),
  });

  const state = await runtime.refreshAuthState();
  assert.equal(state.status, "authenticated");
  assert.equal(deps.getAuthState().status, "authenticated");
});

test("refreshAuthState: handles unauthenticated status", async () => {
  const client = new StubClient();
  client.getAuthStatus = async () => ({ isAuthenticated: false, statusMessage: "not logged in" });

  const { runtime, deps } = createTestRuntime({
    createClient: () => client,
  });

  const state = await runtime.refreshAuthState();
  assert.equal(state.status, "unauthenticated");
  assert.match(state.message, /not logged in/);
});

test("refreshAuthState: handles client error gracefully", async () => {
  const client = new StubClient();
  client.getAuthStatus = async () => { throw new Error("network down"); };

  const { runtime, deps } = createTestRuntime({
    createClient: () => client,
  });

  const state = await runtime.refreshAuthState();
  assert.equal(state.status, "unknown");
  assert.match(state.message, /network down/);
});

test("bindSession: stores session and copilot session id", async () => {
  const { runtime, context } = createTestRuntime({
    createClient: () => new StubClient(),
  });

  const fakeSession = {
    sessionId: "copilot-session-42",
    workspacePath: "/tmp/workspace",
    on: () => () => {},
    disconnect: async () => {},
    getMessages: async () => [],
    sendAndWait: async () => ({ type: "assistant.message" as const, data: { content: "" }, timestamp: "" }),
    rpc: { permissions: { handlePendingPermissionRequest: async () => ({}) } },
  } as never;

  runtime.bindSession("test-repo", context, fakeSession);

  assert.equal(context.lifecycle.session, fakeSession);
  assert.equal(context.lifecycle.lastKnownCopilotSessionId, "copilot-session-42");
});

test("bindSession: cleans up previous subscriptions", async () => {
  const { runtime, context } = createTestRuntime({
    createClient: () => new StubClient(),
  });

  let cleanedUp = false;
  context.lifecycle.subscriptions = [() => { cleanedUp = true; }];

  const fakeSession = {
    sessionId: "new-session",
    workspacePath: null,
    on: () => () => {},
    disconnect: async () => {},
    getMessages: async () => [],
    sendAndWait: async () => ({ type: "assistant.message" as const, data: { content: "" }, timestamp: "" }),
    rpc: { permissions: { handlePendingPermissionRequest: async () => ({}) } },
  } as never;

  runtime.bindSession("test-repo", context, fakeSession);

  assert.ok(cleanedUp, "previous subscriptions should be cleaned up");
});

test("stopClient: stops the active client", async () => {
  const client = new StubClient();
  const { runtime } = createTestRuntime({
    createClient: () => client,
  });

  await runtime.ensureClient();
  await runtime.stopClient();

  assert.ok(client.stopped);
});
