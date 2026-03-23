import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RepoDescriptor, SessionSnapshot } from "@joudo/shared";

import type { CopilotSession, PermissionRequest, SessionConfig, SessionEvent } from "./copilot-sdk.js";
import { createMvpState } from "./mvp-state.js";
import { JoudoError } from "./errors.js";

// ---------------------------------------------------------------------------
// Fakes – lightweight mirrors of the flow-test helpers
// ---------------------------------------------------------------------------

class FakeSession {
  readonly sessionId: string;
  readonly workspacePath: string | undefined;
  readonly rpc = {
    permissions: {
      handlePendingPermissionRequest: async () => ({ kind: "handled" }) as never,
    },
  } as unknown as CopilotSession["rpc"];

  private readonly onPR: SessionConfig["onPermissionRequest"] | undefined;
  private readonly impl: (
    input: { prompt: string },
    onPR: SessionConfig["onPermissionRequest"] | undefined,
  ) => Promise<never>;

  constructor(
    sessionId: string,
    onPR: SessionConfig["onPermissionRequest"] | undefined,
    impl: (input: { prompt: string }, onPR: SessionConfig["onPermissionRequest"] | undefined) => Promise<never>,
  ) {
    this.sessionId = sessionId;
    this.onPR = onPR;
    this.impl = impl;
  }

  on() {
    return () => {};
  }
  async disconnect() {}
  async getMessages() {
    return [] as SessionEvent[];
  }
  async sendAndWait(input: { prompt: string }) {
    return this.impl(input, this.onPR);
  }
}

class FakeClient {
  constructor(private readonly factory: (config: SessionConfig) => FakeSession) {}
  async start() {}
  async stop() {}
  async getAuthStatus() {
    return { isAuthenticated: true, statusMessage: "authenticated" };
  }
  async listModels() {
    return [{ id: "gpt-5-mini" }];
  }
  async createSession(config: SessionConfig): Promise<CopilotSession> {
    return this.factory(config) as unknown as CopilotSession;
  }
  async resumeSession(): Promise<CopilotSession> {
    throw new Error("no resume in test");
  }
  async listSessions() {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createRepo(prefix: string): Promise<RepoDescriptor> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, ".github"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  // Use "confirm" default policy so shell/write requests go to user approval
  await writeFile(
    join(root, ".github", "joudo-policy.yml"),
    ["version: 1", "trusted: true"].join("\n"),
    "utf8",
  );
  return { id: prefix, name: prefix, rootPath: root, trusted: true, policyState: "missing" };
}

async function cleanup(root: string) {
  for (let i = 0; i < 5; i++) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(
  read: () => SessionSnapshot,
  predicate: (s: SessionSnapshot) => boolean,
  ms = 500,
) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (predicate(read())) return read();
    await new Promise((r) => setTimeout(r, 10));
  }
  return read();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("resolveApproval on an already-resolved id throws approval error", async () => {
  const repo = await createRepo("joudo-dup-resolve-");
  try {
    // Shell with readOnly:false and no allow_shell → confirm → pending approval
    const client = new FakeClient((config) =>
      new FakeSession("sess-1", config.onPermissionRequest, async (_input, onPR) => {
        assert.ok(onPR, "onPR must exist");
        const fire = onPR as (req: PermissionRequest) => Promise<{ kind: string }>;
        const result = await fire({
          kind: "shell",
          fullCommandText: "npm test",
          intention: "run test suite",
          commands: [{ identifier: "npm", readOnly: false }],
        } as PermissionRequest);
        assert.equal(result.kind, "approved");
        return { type: "assistant.message", data: { content: "done" } } as never;
      }),
    );

    const state = createMvpState({
      repos: [repo],
      createClient: () => client as never,
    });

    state.selectRepo(repo.id);
    await state.submitPrompt("test dup resolve");
    const snap1 = await waitFor(() => state.getSnapshot(), (s) => s.approvals.length > 0);
    assert.ok(snap1.approvals.length >= 1, "should have at least one pending approval");

    const approvalId = snap1.approvals[0]!.id;

    // First resolve succeeds
    await state.resolveApproval(approvalId, "allow-once");
    await settle();

    // Second resolve on same id should throw 404
    await assert.rejects(
      () => state.resolveApproval(approvalId, "allow-once"),
      (err: unknown) => {
        assert.ok(err instanceof JoudoError);
        assert.equal(err.code, "approval");
        assert.equal(err.statusCode, 404);
        return true;
      },
    );

    await settle();
    await state.dispose();
  } finally {
    await cleanup(repo.rootPath);
  }
});

test("two concurrent approvals can be resolved in any order", async () => {
  const repo = await createRepo("joudo-multi-approve-");
  try {
    const client = new FakeClient((config) =>
      new FakeSession("sess-2", config.onPermissionRequest, async (_input, onPR) => {
        assert.ok(onPR, "onPR must exist");
        const fire = onPR as (req: PermissionRequest) => Promise<{ kind: string }>;

        // Two non-readonly shell requests — both get "confirm"
        const p1 = fire({
          kind: "shell",
          fullCommandText: "npm test",
          intention: "run tests",
          commands: [{ identifier: "npm", readOnly: false }],
        } as PermissionRequest);

        // Small delay so first one is registered before second
        await new Promise((r) => setTimeout(r, 30));

        const p2 = fire({
          kind: "write",
          fileName: "src/output.ts",
          intention: "write output file",
        } as PermissionRequest);

        const [r1, r2] = await Promise.all([p1, p2]);
        assert.equal(r1.kind, "approved");
        assert.equal(r2.kind, "approved");
        return { type: "assistant.message", data: { content: "both approved" } } as never;
      }),
    );

    const state = createMvpState({
      repos: [repo],
      createClient: () => client as never,
    });

    state.selectRepo(repo.id);
    await state.submitPrompt("multi-approval test");

    // Wait for both approvals
    const snap = await waitFor(() => state.getSnapshot(), (s) => s.approvals.length >= 2, 2000);
    assert.equal(snap.approvals.length, 2, "expected 2 pending approvals");

    const first = snap.approvals[0]!;
    const second = snap.approvals[1]!;

    // Resolve in reverse order — second first
    await state.resolveApproval(second.id, "allow-once");
    await settle();

    const midSnap = state.getSnapshot();
    assert.ok(!midSnap.approvals.some((a) => a.id === second.id), "second approval should be gone");

    // Resolve the first one
    if (midSnap.approvals.some((a) => a.id === first.id)) {
      await state.resolveApproval(first.id, "allow-once");
    }
    await settle();

    const finalSnap = await waitFor(() => state.getSnapshot(), (s) => s.approvals.length === 0, 1000);
    assert.equal(finalSnap.approvals.length, 0, "all approvals resolved");

    await state.dispose();
  } finally {
    await cleanup(repo.rootPath);
  }
});

test("deny one approval while approving another", async () => {
  const repo = await createRepo("joudo-mixed-decision-");
  try {
    const client = new FakeClient((config) =>
      new FakeSession("sess-3", config.onPermissionRequest, async (_input, onPR) => {
        assert.ok(onPR, "onPR must exist");
        const fire = onPR as (req: PermissionRequest) => Promise<{ kind: string }>;

        // Two non-readonly shell requests
        const p1 = fire({
          kind: "shell",
          fullCommandText: "npm run build",
          intention: "build project",
          commands: [{ identifier: "npm", readOnly: false }],
        } as PermissionRequest);

        await new Promise((r) => setTimeout(r, 30));

        const p2 = fire({
          kind: "shell",
          fullCommandText: "pnpm lint",
          intention: "lint code",
          commands: [{ identifier: "pnpm", readOnly: false }],
        } as PermissionRequest);

        await Promise.all([p1, p2]);
        return { type: "assistant.message", data: { content: "mixed" } } as never;
      }),
    );

    const state = createMvpState({
      repos: [repo],
      createClient: () => client as never,
    });

    state.selectRepo(repo.id);
    await state.submitPrompt("mixed decision test");

    const snap = await waitFor(() => state.getSnapshot(), (s) => s.approvals.length >= 2, 2000);
    assert.ok(snap.approvals.length >= 2, "expected at least 2 approvals");

    const buildApproval = snap.approvals.find((a) => a.commandPreview.includes("build"));
    const lintApproval = snap.approvals.find((a) => a.commandPreview.includes("lint"));
    assert.ok(buildApproval, "should have build approval");
    assert.ok(lintApproval, "should have lint approval");

    // Deny one, approve the other
    await state.resolveApproval(buildApproval.id, "deny");
    await settle();
    await state.resolveApproval(lintApproval.id, "allow-once");
    await settle();

    const finalSnap = state.getSnapshot();
    assert.equal(finalSnap.approvals.length, 0, "no pending approvals");

    // Timeline should contain both resolution entries
    const resolutions = finalSnap.timeline.filter((t) => t.kind === "approval-resolved");
    assert.ok(resolutions.length >= 2, `expected >= 2 approval-resolved entries, got ${resolutions.length}`);

    await state.dispose();
  } finally {
    await cleanup(repo.rootPath);
  }
});

test("rollbackLatestTurn is rejected while approvals are pending", async () => {
  const repo = await createRepo("joudo-rollback-guard-");
  try {
    const client = new FakeClient((config) =>
      new FakeSession("sess-4", config.onPermissionRequest, async (_input, onPR) => {
        assert.ok(onPR);
        const fire = onPR as (req: PermissionRequest) => Promise<{ kind: string }>;
        // Non-readonly request → confirm → blocks waiting for resolution
        await fire({
          kind: "shell",
          fullCommandText: "npm run deploy",
          intention: "deploy",
          commands: [{ identifier: "npm", readOnly: false }],
        } as PermissionRequest);
        return { type: "assistant.message", data: { content: "ok" } } as never;
      }),
    );

    const state = createMvpState({
      repos: [repo],
      createClient: () => client as never,
    });

    state.selectRepo(repo.id);
    await state.submitPrompt("rollback guard test");

    const snap = await waitFor(() => state.getSnapshot(), (s) => s.approvals.length > 0);
    assert.ok(snap.approvals.length > 0, "should have pending approvals");

    // Attempt rollback while approval pending → should be rejected with 409
    await assert.rejects(
      () => state.rollbackLatestTurn(),
      (err: unknown) => {
        assert.ok(err instanceof JoudoError);
        assert.equal(err.code, "validation");
        assert.equal(err.statusCode, 409);
        return true;
      },
    );

    // Clean up: resolve the approval
    await state.resolveApproval(snap.approvals[0]!.id, "allow-once");
    await settle();
    await state.dispose();
  } finally {
    await cleanup(repo.rootPath);
  }
});

test("rollbackLatestTurn is rejected when no rollback data exists", async () => {
  const repo = await createRepo("joudo-no-rollback-");
  try {
    // Session that completes immediately with no file changes
    const client = new FakeClient((config) =>
      new FakeSession("sess-5", config.onPermissionRequest, async () => {
        return { type: "assistant.message", data: { content: "no changes" } } as never;
      }),
    );

    const state = createMvpState({
      repos: [repo],
      createClient: () => client as never,
    });

    state.selectRepo(repo.id);
    await state.submitPrompt("no-op prompt");
    await waitFor(() => state.getSnapshot(), (s) => s.status === "idle", 2000);

    await assert.rejects(
      () => state.rollbackLatestTurn(),
      (err: unknown) => {
        assert.ok(err instanceof JoudoError);
        assert.equal(err.code, "validation");
        assert.equal(err.statusCode, 409);
        return true;
      },
    );

    await state.dispose();
  } finally {
    await cleanup(repo.rootPath);
  }
});
