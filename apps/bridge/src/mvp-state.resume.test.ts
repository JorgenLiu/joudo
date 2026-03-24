import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RepoDescriptor, SessionSnapshot } from "@joudo/shared";

import type { CopilotSession, PermissionRequest, SessionEvent } from "./copilot-sdk.js";
import { createMvpState } from "./mvp-state.js";
import { createSessionIndexEntry, loadSessionIndex, saveSessionIndex, saveSessionSnapshot, upsertSessionIndexEntry } from "./state/persistence.js";
import type { MvpState } from "./state/types.js";

class FakeSession {
  readonly sessionId: string;
  readonly events: SessionEvent[];
  readonly handledPendingRequests: Array<{ requestId: string; result: { kind: string } }> = [];

  readonly rpc = {
    permissions: {
      handlePendingPermissionRequest: async ({ requestId, result }: { requestId: string; result: { kind: string } }) => {
        this.handledPendingRequests.push({ requestId, result });
        return { kind: "handled" } as never;
      },
    },
  } as unknown as CopilotSession["rpc"];

  private readonly listeners = new Map<string, Set<(event: SessionEvent) => void>>();

  constructor(sessionId: string, events: SessionEvent[]) {
    this.sessionId = sessionId;
    this.events = events;
  }

  on(eventName: string, handler: (event: SessionEvent) => void) {
    const handlers = this.listeners.get(eventName) ?? new Set<(event: SessionEvent) => void>();
    handlers.add(handler);
    this.listeners.set(eventName, handlers);
    return () => {
      handlers.delete(handler);
    };
  }

  async disconnect() {}

  async getMessages() {
    return this.events;
  }

  async sendAndWait() {
    return null as never;
  }
}

class FakeClient {
  readonly resumedSessionIds: string[] = [];

  constructor(private readonly sessions: Map<string, FakeSession>) {}

  async start() {}

  async stop() {}

  async getAuthStatus() {
    return {
      isAuthenticated: true,
      statusMessage: "authenticated",
    };
  }

  async listModels() {
    return [{ id: "gpt-5-mini" }, { id: "gpt-5.4" }];
  }

  async createSession(): Promise<CopilotSession> {
    throw new Error("createSession should not be used in resume tests");
  }

  async resumeSession(sessionId: string): Promise<CopilotSession> {
    const session = this.sessions.get(sessionId);
    assert.ok(session, `Missing fake session ${sessionId}`);
    this.resumedSessionIds.push(sessionId);
    return session as unknown as CopilotSession;
  }

  async listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({ sessionId: session.sessionId }));
  }
}

type ResumeHarness = {
  repo: RepoDescriptor;
  state: MvpState;
  fakeClient: FakeClient;
  fakeSession: FakeSession;
  cleanup: () => Promise<void>;
};

function createBaseSnapshot(repo: RepoDescriptor, lastPrompt: string, title: string, body: string): SessionSnapshot {
  const timestamp = new Date().toISOString();
  return {
    sessionId: "persisted-session",
    status: "idle",
    repo,
    model: "gpt-5-mini",
    availableModels: ["gpt-5-mini", "gpt-5.4"],
    agent: null,
    availableAgents: [],
    agentCatalog: {
      globalCount: 0,
      repoCount: 0,
      totalCount: 0,
    },
    auth: {
      status: "authenticated",
      message: "authenticated",
    },
    lastPrompt,
    approvals: [],
    timeline: [
      {
        id: `status-${timestamp}`,
        kind: "status",
        title: "历史快照",
        body,
        timestamp,
      },
    ],
    auditLog: [],
    activity: null,
    summary: {
      title,
      body,
      steps: [],
      executedCommands: [],
      changedFiles: [],
      checks: [],
      risks: [],
      nextAction: "等待恢复。",
    },
    updatedAt: timestamp,
  };
}

function userMessage(content: string): SessionEvent {
  return {
    type: "user.message",
    data: { content },
  } as SessionEvent;
}

function assistantMessage(content: string): SessionEvent {
  return {
    type: "assistant.message",
    data: { content },
  } as SessionEvent;
}

function permissionRequested(requestId: string, permissionRequest: PermissionRequest): SessionEvent {
  return {
    type: "permission.requested",
    data: { requestId, permissionRequest },
  } as SessionEvent;
}

async function createResumeHarness(input: {
  joudoSessionId: string;
  copilotSessionId: string;
  status: "idle" | "interrupted";
  lastPrompt: string;
  summaryTitle: string;
  summaryBody: string;
  turnCount: number;
  hasPendingApprovals: boolean;
  events: SessionEvent[];
}): Promise<ResumeHarness> {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-resume-"));
  await mkdir(join(repoRoot, "src"), { recursive: true });

  const repo: RepoDescriptor = {
    id: "resume-repo",
    name: "resume-repo",
    rootPath: repoRoot,
    trusted: true,
    policyState: "missing",
  };

  const createdAt = new Date().toISOString();
  const snapshot = createBaseSnapshot(repo, input.lastPrompt, input.summaryTitle, input.summaryBody);
  const entry = createSessionIndexEntry({
    id: input.joudoSessionId,
    createdAt,
    updatedAt: snapshot.updatedAt,
    status: input.status,
    turnCount: input.turnCount,
    lastPrompt: input.lastPrompt,
    summaryTitle: input.summaryTitle,
    summaryBody: input.summaryBody,
    hasPendingApprovals: input.hasPendingApprovals,
    lastKnownCopilotSessionId: input.copilotSessionId,
  });
  const index = upsertSessionIndexEntry(loadSessionIndex(repo), entry, null);

  await saveSessionIndex(repoRoot, index);
  await saveSessionSnapshot({
    repoRoot,
    sessionId: input.joudoSessionId,
    createdAt,
    lastKnownCopilotSessionId: input.copilotSessionId,
    snapshot,
  });

  const fakeSession = new FakeSession(input.copilotSessionId, input.events);
  const fakeClient = new FakeClient(new Map([[input.copilotSessionId, fakeSession]]));
  const state = createMvpState({
    repos: [repo],
    createClient: () => fakeClient,
  });

  const cleanup = async () => {
    await state.dispose();
    await rm(repoRoot, { recursive: true, force: true });
  };

  return {
    repo,
    state,
    fakeClient,
    fakeSession,
    cleanup,
  };
}

test("recoverHistoricalSession reattaches a completed idle session when the Copilot session still exists", async () => {
  const harness = await createResumeHarness({
    joudoSessionId: "joudo-idle",
    copilotSessionId: "copilot-idle",
    status: "idle",
    lastPrompt: "请总结 bridge 当前结构",
    summaryTitle: "上次执行完成",
    summaryBody: "已经拿到一轮 assistant 结果。",
    turnCount: 1,
    hasPendingApprovals: false,
    events: [userMessage("请总结 bridge 当前结构"), assistantMessage("bridge 当前分成 transport、policy、state 三层")],
  });

  try {
    const nextSnapshot = await harness.state.recoverHistoricalSession("joudo-idle");

    assert.equal(nextSnapshot.status, "idle");
    assert.equal(nextSnapshot.lastPrompt, "请总结 bridge 当前结构");
    assert.equal(harness.fakeClient.resumedSessionIds[0], "copilot-idle");
    assert.match(nextSnapshot.timeline[0]?.title ?? "", /已接管历史会话/);
    assert.match(nextSnapshot.timeline[0]?.body ?? "", /已接回 Copilot session copilot-idle/);
  } finally {
    await harness.cleanup();
  }
});

test("recoverHistoricalSession restores interrupted approval sessions as history-only context", async () => {
  const request: PermissionRequest = {
    kind: "read",
    path: "../outside-notes.md",
  } as PermissionRequest;
  const harness = await createResumeHarness({
    joudoSessionId: "joudo-awaiting",
    copilotSessionId: "copilot-awaiting",
    status: "interrupted",
    lastPrompt: "继续排查 repo 外部依赖",
    summaryTitle: "等待审批",
    summaryBody: "上次中断时正在等待一个权限请求。",
    turnCount: 2,
    hasPendingApprovals: true,
    events: [userMessage("继续排查 repo 外部依赖"), permissionRequested("request-1", request)],
  });

  try {
    const resumedSnapshot = await harness.state.recoverHistoricalSession("joudo-awaiting");

    assert.equal(resumedSnapshot.status, "idle");
    assert.equal(resumedSnapshot.approvals.length, 0);
    assert.equal(harness.fakeClient.resumedSessionIds.length, 0);
    assert.match(resumedSnapshot.timeline[0]?.body ?? "", /旧审批不会在 bridge\/CLI 重连后继续等待/);
  } finally {
    await harness.cleanup();
  }
});

test("recoverHistoricalSession restores interrupted active sessions as history-only context", async () => {
  const harness = await createResumeHarness({
    joudoSessionId: "joudo-running",
    copilotSessionId: "copilot-running",
    status: "interrupted",
    lastPrompt: "继续实现 resume api",
    summaryTitle: "执行中断",
    summaryBody: "上次中断时 Copilot 仍在持续输出前。",
    turnCount: 3,
    hasPendingApprovals: false,
    events: [userMessage("继续实现 resume api")],
  });

  try {
    const nextSnapshot = await harness.state.recoverHistoricalSession("joudo-running");

    assert.equal(nextSnapshot.status, "idle");
    assert.equal(nextSnapshot.approvals.length, 0);
    assert.equal(harness.fakeClient.resumedSessionIds.length, 0);
    assert.match(nextSnapshot.timeline[0]?.body ?? "", /未完成的 Copilot 执行不会在 CLI 重启后继续/);
  } finally {
    await harness.cleanup();
  }
});