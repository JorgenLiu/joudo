import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovalRequest, ApprovalType, PermissionAuditEntry, SessionStatus, SessionTimelineEntry } from "@joudo/shared";

import type { PermissionRequest, PermissionRequestResult } from "../copilot-sdk.js";
import type { LoadedRepoPolicy, PolicyDecision } from "../policy/index.js";
import { handlePermissionRequest } from "./session-permissions.js";
import type { SessionPermissionOps } from "./session-permissions.js";
import type { RepoContext } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createTestPolicy(overrides?: Partial<LoadedRepoPolicy>): LoadedRepoPolicy {
  return {
    state: "loaded",
    path: "/tmp/test-repo/.github/joudo-policy.yml",
    config: {
      version: 1 as const,
      trusted: false,
      allowTools: [],
      denyTools: [],
      confirmTools: [],
      allowShell: [],
      denyShell: [],
      confirmShell: [],
      allowedPaths: [],
      allowedWritePaths: [],
      allowedUrls: [],
    },
    error: null,
    ...overrides,
  };
}

function createTestContext(overrides?: Partial<RepoContext>): RepoContext {
  return {
    repo: { id: "test-repo", name: "test-repo", rootPath: "/tmp/test-repo", trusted: false },
    policy: createTestPolicy(),
    currentModel: "gpt-4o",
    status: "running",
    lastPrompt: "test prompt",
    timeline: [],
    auditLog: [],
    summary: null,
    updatedAt: new Date().toISOString(),
    latestAssistantMessage: null,
    lifecycle: {
      session: null,
      joudoSessionId: "test-session",
      joudoSessionCreatedAt: new Date().toISOString(),
      lastKnownCopilotSessionId: null,
      activePrompt: Promise.resolve(),
      subscriptions: [],
    },
    turns: {
      turnCount: 1,
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

type OpsLog = {
  auditEntries: PermissionAuditEntry[];
  timelineEntries: Array<Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string }>;
  touchCalls: Array<{ status: SessionStatus }>;
  approvedCommands: string[];
  approvedApprovalTypes: ApprovalType[];
  emittedApprovals: ApprovalRequest[];
  persistenceCalls: number;
  publishCalls: number;
  captureBaselineCalls: number;
  addedApprovals: Array<{ id: string; repoId: string }>;
};

function createTestOps(overrides?: Partial<SessionPermissionOps>): { ops: SessionPermissionOps; log: OpsLog } {
  const log: OpsLog = {
    auditEntries: [],
    timelineEntries: [],
    touchCalls: [],
    approvedCommands: [],
    approvedApprovalTypes: [],
    emittedApprovals: [],
    persistenceCalls: 0,
    publishCalls: 0,
    captureBaselineCalls: 0,
    addedApprovals: [],
  };

  const ops: SessionPermissionOps = {
    refreshRepoPolicy: () => {},
    appendAuditEntry: (_ctx, entry) => {
      log.auditEntries.push(entry);
      _ctx.auditLog = [entry, ..._ctx.auditLog];
    },
    updateAuditEntry: () => {},
    captureTurnWriteBaseline: async () => { log.captureBaselineCalls++; },
    recordApprovedCommand: (_ctx, _req, preview) => {
      const cmd = preview ?? "unknown";
      log.approvedCommands.push(cmd);
      _ctx.approvalState.approvedCommands.push(cmd);
    },
    recordApprovedApprovalType: (_ctx, type) => {
      log.approvedApprovalTypes.push(type);
      _ctx.approvalState.approvedApprovalTypes.push(type);
    },
    pushTimelineEntry: (_ctx, entry) => { log.timelineEntries.push(entry); },
    touch: (_ctx, status) => {
      log.touchCalls.push({ status });
      _ctx.status = status;
    },
    queuePersistence: () => { log.persistenceCalls++; },
    publishIfCurrent: () => { log.publishCalls++; },
    emitApprovalRequested: (approval) => { log.emittedApprovals.push(approval); },
    onApprovalAdded: (id, repoId) => { log.addedApprovals.push({ id, repoId }); },
    ...overrides,
  };

  return { ops, log };
}

function shellRequest(command: string): PermissionRequest {
  return { kind: "shell", fullCommandText: command } as PermissionRequest;
}

function writeRequest(fileName: string): PermissionRequest {
  return { kind: "write", fileName } as PermissionRequest;
}

function readRequest(path: string): PermissionRequest {
  return { kind: "read", path } as PermissionRequest;
}

/* ------------------------------------------------------------------ */
/*  Tests: handlePermissionRequest — allow path                       */
/* ------------------------------------------------------------------ */

test("handlePermissionRequest: auto-allows when policy allows shell", async () => {
  const context = createTestContext({
    policy: createTestPolicy({
      config: {
        version: 1 as const,
        trusted: false,
        allowTools: [], denyTools: [], confirmTools: [],
        allowShell: ["ls"],
        denyShell: [], confirmShell: [],
        allowedPaths: [], allowedWritePaths: [], allowedUrls: [],
      },
    }),
  });
  const { ops, log } = createTestOps();

  const result = await handlePermissionRequest(context, shellRequest("ls"), ops);

  assert.deepEqual(result, { kind: "approved" });
  assert.equal(log.auditEntries.length, 1);
  assert.equal(log.auditEntries[0]!.resolution, "auto-allowed");
  assert.equal(log.captureBaselineCalls, 1);
  assert.equal(log.persistenceCalls, 1);
  assert.equal(log.publishCalls, 1);
  assert.ok(context.summary);
  assert.match(context.summary!.title, /自动批准/);
});

/* ------------------------------------------------------------------ */
/*  Tests: handlePermissionRequest — deny path                        */
/* ------------------------------------------------------------------ */

test("handlePermissionRequest: auto-denies when policy denies shell", async () => {
  const context = createTestContext({
    policy: createTestPolicy({
      config: {
        version: 1 as const,
        trusted: false,
        allowTools: [], denyTools: [], confirmTools: [],
        allowShell: [],
        denyShell: ["rm -rf"],
        confirmShell: [],
        allowedPaths: [], allowedWritePaths: [], allowedUrls: [],
      },
    }),
  });
  const { ops, log } = createTestOps();

  const result = await handlePermissionRequest(context, shellRequest("rm -rf /"), ops);

  assert.equal(result.kind, "denied-by-rules");
  assert.equal(log.auditEntries.length, 1);
  assert.equal(log.auditEntries[0]!.resolution, "auto-denied");
  assert.equal(log.captureBaselineCalls, 0, "should not capture baseline on deny");
  assert.ok(context.summary);
  assert.match(context.summary!.title, /自动拒绝/);
});

/* ------------------------------------------------------------------ */
/*  Tests: handlePermissionRequest — confirm path (interactive)       */
/* ------------------------------------------------------------------ */

test("handlePermissionRequest: confirm returns a pending promise and emits approval", async () => {
  // No allow or deny rules → falls through to confirm
  const context = createTestContext({
    policy: createTestPolicy(),
  });
  const { ops, log } = createTestOps();

  // Start the permission request (it will block on a promise)
  const resultPromise = handlePermissionRequest(context, shellRequest("curl example.com"), ops);

  // Should have emitted an approval and added pending
  assert.equal(log.emittedApprovals.length, 1);
  assert.equal(context.approvalState.pendingApprovals.size, 1);
  assert.equal(log.auditEntries.length, 1);
  assert.equal(log.auditEntries[0]!.resolution, "awaiting-user");

  // Verify status is set to awaiting-approval
  assert.ok(log.touchCalls.some((c) => c.status === "awaiting-approval"));

  // Resolve the pending approval
  const [pendingId, pending] = [...context.approvalState.pendingApprovals.entries()][0]!;
  pending.resolve({ kind: "approved" });

  const result = await resultPromise;
  assert.deepEqual(result, { kind: "approved" });
});

test("handlePermissionRequest: confirm can be denied interactively", async () => {
  const context = createTestContext({ policy: createTestPolicy() });
  const { ops } = createTestOps();

  const resultPromise = handlePermissionRequest(context, writeRequest("/tmp/test-repo/file.txt"), ops);

  const [, pending] = [...context.approvalState.pendingApprovals.entries()][0]!;
  pending.resolve({ kind: "denied-interactively-by-user" });

  const result = await resultPromise;
  assert.deepEqual(result, { kind: "denied-interactively-by-user" });
});

/* ------------------------------------------------------------------ */
/*  Tests: audit entry integrity                                      */
/* ------------------------------------------------------------------ */

test("handlePermissionRequest: audit entries have correct request kind and target", async () => {
  const context = createTestContext({
    policy: createTestPolicy({
      config: {
        version: 1 as const,
        trusted: false,
        allowTools: [], denyTools: [], confirmTools: [],
        allowShell: ["git status"],
        denyShell: [], confirmShell: [],
        allowedPaths: ["/tmp/test-repo/src"], allowedWritePaths: [], allowedUrls: [],
      },
    }),
  });
  const { ops, log } = createTestOps();

  await handlePermissionRequest(context, shellRequest("git status"), ops);
  assert.equal(log.auditEntries[0]!.requestKind, "shell");
  assert.equal(log.auditEntries[0]!.target, "git status");

  await handlePermissionRequest(context, readRequest("/tmp/test-repo/src/index.ts"), ops);
  assert.equal(log.auditEntries[1]!.requestKind, "read");
});

/* ------------------------------------------------------------------ */
/*  Tests: status transitions                                         */
/* ------------------------------------------------------------------ */

test("handlePermissionRequest: sets running after allow when activePrompt present", async () => {
  const context = createTestContext({
    policy: createTestPolicy({
      config: {
        version: 1 as const,
        trusted: false,
        allowTools: [], denyTools: [], confirmTools: [],
        allowShell: ["echo hello"],
        denyShell: [], confirmShell: [],
        allowedPaths: [], allowedWritePaths: [], allowedUrls: [],
      },
    }),
  });
  // activePrompt is set to non-null
  context.lifecycle.activePrompt = Promise.resolve();
  const { ops, log } = createTestOps();

  await handlePermissionRequest(context, shellRequest("echo hello"), ops);

  assert.ok(log.touchCalls.some((c) => c.status === "running"));
});

test("handlePermissionRequest: sets idle after allow when no activePrompt", async () => {
  const context = createTestContext({
    policy: createTestPolicy({
      config: {
        version: 1 as const,
        trusted: false,
        allowTools: [], denyTools: [], confirmTools: [],
        allowShell: ["echo hello"],
        denyShell: [], confirmShell: [],
        allowedPaths: [], allowedWritePaths: [], allowedUrls: [],
      },
    }),
  });
  context.lifecycle.activePrompt = null;
  const { ops, log } = createTestOps();

  await handlePermissionRequest(context, shellRequest("echo hello"), ops);

  assert.ok(log.touchCalls.some((c) => c.status === "idle"));
});
