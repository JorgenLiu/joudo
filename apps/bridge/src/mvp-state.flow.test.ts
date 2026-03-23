import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RepoDescriptor, SessionSnapshot } from "@joudo/shared";

import type { CopilotSession, PermissionRequest, SessionConfig, SessionEvent } from "./copilot-sdk.js";
import { createMvpState } from "./mvp-state.js";
import { createSessionIndexEntry, loadSessionIndex, saveSessionIndex, saveSessionSnapshot, upsertSessionIndexEntry } from "./state/persistence.js";
import { observeRepoStateForPaths } from "./state/turn-changes.js";

class FlowFakeSession {
  readonly sessionId: string;

  readonly rpc = {
    permissions: {
      handlePendingPermissionRequest: async () => ({ kind: "handled" }) as never,
    },
  } as unknown as CopilotSession["rpc"];

  private readonly listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  private readonly sendAndWaitImpl: (
    input: { prompt: string },
    onPermissionRequest: SessionConfig["onPermissionRequest"] | undefined,
  ) => Promise<never>;
  private readonly onPermissionRequest: SessionConfig["onPermissionRequest"] | undefined;

  constructor(
    sessionId: string,
    onPermissionRequest: SessionConfig["onPermissionRequest"] | undefined,
    sendAndWaitImpl: (input: { prompt: string }, onPermissionRequest: SessionConfig["onPermissionRequest"] | undefined) => Promise<never>,
  ) {
    this.sessionId = sessionId;
    this.onPermissionRequest = onPermissionRequest;
    this.sendAndWaitImpl = sendAndWaitImpl;
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
    return [] as SessionEvent[];
  }

  async sendAndWait(input: { prompt: string }) {
    return this.sendAndWaitImpl(input, this.onPermissionRequest);
  }
}

class FlowFakeClient {
  constructor(
    private readonly sessionFactory: (config: SessionConfig) => FlowFakeSession,
    private readonly models: string[] = ["gpt-5-mini", "gpt-5.4"],
  ) {}

  async start() {}

  async stop() {}

  async getAuthStatus() {
    return {
      isAuthenticated: true,
      statusMessage: "authenticated",
    };
  }

  async listModels() {
    return this.models.map((id) => ({ id }));
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    return this.sessionFactory(config) as unknown as CopilotSession;
  }

  async resumeSession(): Promise<CopilotSession> {
    throw new Error("resumeSession should not be used in flow tests");
  }

  async listSessions() {
    return [];
  }
}

function createBaseSnapshot(
  repo: RepoDescriptor,
  input: { status?: SessionSnapshot["status"]; lastPrompt: string; title: string; body: string; updatedAt?: string },
): SessionSnapshot {
  const timestamp = input.updatedAt ?? new Date().toISOString();
  return {
    sessionId: "persisted-session",
    status: input.status ?? "idle",
    repo,
    model: "gpt-5-mini",
    availableModels: ["gpt-5-mini", "gpt-5.4"],
    auth: {
      status: "authenticated",
      message: "authenticated",
    },
    lastPrompt: input.lastPrompt,
    approvals: [],
    timeline: [
      {
        id: `status-${timestamp}`,
        kind: "status",
        title: input.title,
        body: input.body,
        timestamp,
      },
    ],
    auditLog: [],
    activity: null,
    summary: {
      title: input.title,
      body: input.body,
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

async function createRepo(rootName: string): Promise<RepoDescriptor> {
  const repoRoot = await mkdtemp(join(tmpdir(), rootName));
  await mkdir(join(repoRoot, ".github"), { recursive: true });
  await mkdir(join(repoRoot, "src"), { recursive: true });
  await writeFile(
    join(repoRoot, ".github", "joudo-policy.yml"),
    [
      "version: 1",
      "trusted: true",
      "allow_tools:",
      "  - write",
      "allow_shell:",
      "  - python3",
      "allowed_paths:",
      "  - .",
    ].join("\n"),
    "utf8",
  );

  return {
    id: rootName,
    name: rootName,
    rootPath: repoRoot,
    trusted: true,
    policyState: "missing",
  };
}

async function settleAsyncState() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function cleanupRepoRoot(repoRoot: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(repoRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function waitForSnapshotState(
  readSnapshot: () => SessionSnapshot,
  predicate: (snapshot: SessionSnapshot) => boolean,
  timeoutMs = 500,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = readSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return readSnapshot();
}

async function approveWritePermission(
  onPermissionRequest: SessionConfig["onPermissionRequest"] | undefined,
  request: PermissionRequest,
) {
  assert.ok(onPermissionRequest, "Expected onPermissionRequest callback");
  const result = await (onPermissionRequest as (request: PermissionRequest) => Promise<{ kind: string }>)(request);
  assert.equal(result.kind, "approved");
}

test("createMvpState restores the most recent historical context on startup", async () => {
  const olderRepo = await createRepo("joudo-older-");
  const recentRepo = await createRepo("joudo-recent-");

  try {
    const olderCreatedAt = new Date(Date.now() - 60_000).toISOString();
    const recentCreatedAt = new Date().toISOString();

    const recentSnapshot = createBaseSnapshot(recentRepo, {
      status: "timed-out",
      lastPrompt: "继续检查超时前的摘要",
      title: "本轮任务已超时",
      body: "上一轮任务在等待窗口内没有完成。",
      updatedAt: recentCreatedAt,
    });
    const olderSnapshot = createBaseSnapshot(olderRepo, {
      lastPrompt: "旧仓库提示词",
      title: "旧摘要",
      body: "旧仓库历史记录。",
      updatedAt: olderCreatedAt,
    });

    const olderIndex = upsertSessionIndexEntry(
      loadSessionIndex(olderRepo),
      createSessionIndexEntry({
        id: "older-session",
        createdAt: olderCreatedAt,
        updatedAt: olderSnapshot.updatedAt,
        status: "idle",
        turnCount: 1,
        lastPrompt: olderSnapshot.lastPrompt,
        summaryTitle: olderSnapshot.summary?.title ?? null,
        summaryBody: olderSnapshot.summary?.body ?? null,
        hasPendingApprovals: false,
        lastKnownCopilotSessionId: "copilot-older",
      }),
      null,
    );
    const recentIndex = upsertSessionIndexEntry(
      loadSessionIndex(recentRepo),
      createSessionIndexEntry({
        id: "recent-session",
        createdAt: recentCreatedAt,
        updatedAt: recentSnapshot.updatedAt,
        status: "timed-out",
        turnCount: 2,
        lastPrompt: recentSnapshot.lastPrompt,
        summaryTitle: recentSnapshot.summary?.title ?? null,
        summaryBody: recentSnapshot.summary?.body ?? null,
        hasPendingApprovals: false,
        lastKnownCopilotSessionId: null,
      }),
      null,
    );

    await saveSessionIndex(olderRepo.rootPath, olderIndex);
    await saveSessionIndex(recentRepo.rootPath, recentIndex);
    await saveSessionSnapshot({
      repoRoot: olderRepo.rootPath,
      sessionId: "older-session",
      createdAt: olderCreatedAt,
      lastKnownCopilotSessionId: "copilot-older",
      snapshot: olderSnapshot,
    });
    await saveSessionSnapshot({
      repoRoot: recentRepo.rootPath,
      sessionId: "recent-session",
      createdAt: recentCreatedAt,
      lastKnownCopilotSessionId: null,
      snapshot: recentSnapshot,
    });

    const state = createMvpState({
      repos: [olderRepo, recentRepo],
      createClient: () => new FlowFakeClient((config) => new FlowFakeSession("unused", config.onPermissionRequest, async () => {
        throw new Error("unused");
      })),
    });

    try {
      const snapshot = state.getSnapshot();

      assert.equal(snapshot.repo?.id, recentRepo.id);
      assert.equal(snapshot.status, "timed-out");
      assert.equal(snapshot.lastPrompt, "继续检查超时前的摘要");
      assert.match(snapshot.summary?.body ?? "", /自动载入最近一次超时记录/);
    } finally {
      await state.dispose();
      await settleAsyncState();
    }
  } finally {
    await cleanupRepoRoot(olderRepo.rootPath);
    await cleanupRepoRoot(recentRepo.rootPath);
  }
});


test("submitPrompt preserves a timed-out status when the session exceeds the wait window", async () => {
  const repo = await createRepo("joudo-timeout-");

  try {
    const state = createMvpState({
      repos: [repo],
      createClient: () =>
        new FlowFakeClient(
          (config) =>
            new FlowFakeSession("copilot-timeout", config.onPermissionRequest, async () => {
              throw new Error("Request timed out after 900000ms");
            }),
        ),
    });

    try {
      await state.refreshAuth();
      await state.submitPrompt("请继续处理一个会超时的任务");
      await settleAsyncState();

      const snapshot = state.getSnapshot();
      assert.equal(snapshot.status, "timed-out");
      assert.equal(snapshot.summary?.title, "本轮任务已超时");
      assert.match(snapshot.timeline[0]?.title ?? "", /本轮任务已超时/);
    } finally {
      await state.dispose();
      await settleAsyncState();
    }
  } finally {
    await cleanupRepoRoot(repo.rootPath);
  }
});

test("submitPrompt records the latest turn changeset and rollbackLatestTurn reverts it", async () => {
  const repo = await createRepo("joudo-rollback-");
  const featureFile = join(repo.rootPath, "src", "feature.ts");

  try {
    await writeFile(featureFile, "export const value = 'before';\n", "utf8");

    const state = createMvpState({
      repos: [repo],
      createClient: () =>
        new FlowFakeClient(
          (config) =>
            new FlowFakeSession("copilot-rollback", config.onPermissionRequest, async ({ prompt }, onPermissionRequest) => {
              if (prompt === "/undo") {
                await writeFile(featureFile, "export const value = 'before';\n", "utf8");
                return { data: { content: "已撤销最后一步改动。" } } as never;
              }

              await approveWritePermission(onPermissionRequest, {
                kind: "write",
                fileName: "src/feature.ts",
                intention: "更新 feature 文件",
              } as PermissionRequest);
              await writeFile(featureFile, "export const value = 'after';\n", "utf8");
              return { data: { content: "已经修改 feature 文件。" } } as never;
            }),
        ),
    });

    try {
      await state.refreshAuth();
      await state.submitPrompt("请修改 feature 文件");
      const afterPromptSnapshot = await waitForSnapshotState(
        () => state.getSnapshot(),
        (snapshot) => snapshot.status === "idle" && snapshot.summary?.title === "真实会话已返回结果",
      );
      const approvalResolvedEntry = afterPromptSnapshot.timeline.find((entry) => entry.kind === "approval-resolved");

      assert.ok(afterPromptSnapshot.summary?.changedFiles.includes("src/feature.ts"));
      assert.deepEqual(afterPromptSnapshot.summary?.approvalTypes, ["file-write"]);
      assert.ok(afterPromptSnapshot.activity?.changedFiles.some((item) => item.path === "src/feature.ts"));
      assert.equal(afterPromptSnapshot.activity?.rollback?.status, "ready");
      assert.equal(afterPromptSnapshot.activity?.rollback?.canRollback, true);
      assert.equal(approvalResolvedEntry?.decision?.approvalType, "file-write");

      const rollbackSnapshot = await state.rollbackLatestTurn();
      const fileContent = await readFile(featureFile, "utf8");

      assert.equal(fileContent, "export const value = 'before';\n");
      assert.equal(rollbackSnapshot.summary?.title, "已撤回上一轮改动");
      assert.deepEqual(rollbackSnapshot.summary?.approvalTypes, ["file-write"]);
      assert.equal(rollbackSnapshot.activity?.latestTurn?.outcome, "rolled-back");
      assert.equal(rollbackSnapshot.activity?.rollback?.status, "reverted");
      assert.equal(rollbackSnapshot.activity?.rollback?.canRollback, false);
      assert.match(rollbackSnapshot.timeline[0]?.title ?? "", /已撤回上一轮改动/);
    } finally {
      await state.dispose();
      await settleAsyncState();
    }
  } finally {
    await cleanupRepoRoot(repo.rootPath);
  }
});

test("rollbackLatestTurn keeps the turn outcome unchanged when /undo does not restore the baseline", async () => {
  const repo = await createRepo("joudo-rollback-review-");
  const featureFile = join(repo.rootPath, "src", "feature.ts");
  const generatedFile = join(repo.rootPath, "src", "generated.ts");

  try {
    await writeFile(featureFile, "export const value = 'before';\n", "utf8");

    const state = createMvpState({
      repos: [repo],
      createClient: () =>
        new FlowFakeClient(
          (config) =>
            new FlowFakeSession("copilot-rollback-review", config.onPermissionRequest, async ({ prompt }, onPermissionRequest) => {
              if (prompt === "/undo") {
                await writeFile(featureFile, "export const value = 'still-after';\n", "utf8");
                await writeFile(generatedFile, "export const generated = 'still-after';\n", "utf8");
                return { data: { content: "已尝试撤销最后一步改动。" } } as never;
              }

              await approveWritePermission(onPermissionRequest, {
                kind: "shell",
                fullCommandText: "python3 scripts/update.py",
                intention: "批量更新 src 目录文件",
                commands: [{ identifier: "python3", readOnly: false }],
                possiblePaths: ["src"],
                hasWriteFileRedirection: false,
              } as PermissionRequest);
              await writeFile(featureFile, "export const value = 'after';\n", "utf8");
              await writeFile(generatedFile, "export const generated = 'after';\n", "utf8");
              return { data: { content: "已经修改 feature 文件。" } } as never;
            }),
        ),
    });

    try {
      await state.refreshAuth();
      await state.submitPrompt("请修改 feature 文件");
      await waitForSnapshotState(
        () => state.getSnapshot(),
        (snapshot) => snapshot.status === "idle" && snapshot.summary?.title === "真实会话已返回结果",
      );

      const rollbackSnapshot = await state.rollbackLatestTurn();
      const fileContent = await readFile(featureFile, "utf8");

      assert.equal(fileContent, "export const value = 'still-after';\n");
      assert.equal(rollbackSnapshot.activity?.latestTurn?.outcome, "completed");
      assert.equal(rollbackSnapshot.activity?.rollback?.status, "needs-review");
      assert.equal(rollbackSnapshot.activity?.rollback?.canRollback, false);
      assert.match(rollbackSnapshot.activity?.rollback?.reason ?? "", /人工确认/);
      assert.match(rollbackSnapshot.timeline[0]?.body ?? "", /没有完全回到上一轮开始前的基线/);
    } finally {
      await state.dispose();
      await settleAsyncState();
    }
  } finally {
    await cleanupRepoRoot(repo.rootPath);
  }
});

test("createMvpState preserves Joudo journal rollback after restart", async () => {
  const repo = await createRepo("joudo-journal-restart-");
  const featureFile = join(repo.rootPath, "src", "feature.ts");

  try {
    await writeFile(featureFile, "export const value = 'before';\n", "utf8");
    const before = await observeRepoStateForPaths(repo.rootPath, ["src/feature.ts"]);
    await writeFile(featureFile, "export const value = 'after';\n", "utf8");
    const after = await observeRepoStateForPaths(repo.rootPath, ["src/feature.ts"]);

    const createdAt = new Date().toISOString();
    const snapshot = createBaseSnapshot(repo, {
      lastPrompt: "请修改 feature 文件",
      title: "真实会话已返回结果",
      body: "已经修改 feature 文件。",
      updatedAt: after.observedAt,
    });
    snapshot.activity = {
      phase: "completed",
      intent: snapshot.lastPrompt,
      headline: "真实会话已返回结果",
      detail: "已经修改 feature 文件。",
      updatedAt: after.observedAt,
      workspacePath: null,
      items: [],
      commands: [],
      changedFiles: [
        {
          path: "src/feature.ts",
          changeKind: "updated",
          source: "observed",
        },
      ],
      latestTurn: {
        id: "persisted-turn-1",
        prompt: snapshot.lastPrompt ?? "",
        startedAt: before.observedAt,
        completedAt: after.observedAt,
        outcome: "completed",
        changedFiles: [
          {
            path: "src/feature.ts",
            changeKind: "updated",
            source: "observed",
          },
        ],
      },
      rollback: {
        authority: "joudo",
        executor: "joudo-write-journal",
        status: "ready",
        canRollback: true,
        reason: "可以按 Joudo 记录的写入基线直接撤回上一轮文件改动。",
        targetTurnId: "persisted-turn-1",
        changedFiles: [
          {
            path: "src/feature.ts",
            changeKind: "updated",
            source: "observed",
          },
        ],
        trackedPaths: ["src/feature.ts"],
        evaluatedAt: after.observedAt,
        workspaceDigestBefore: before.digest,
        workspaceDigestAfter: after.digest,
      },
      checkpoints: [],
      latestCompaction: null,
      blockers: [],
    };
    snapshot.summary = {
      title: "真实会话已返回结果",
      body: "已经修改 feature 文件。",
      steps: [],
      executedCommands: [],
      changedFiles: ["src/feature.ts"],
      checks: [],
      risks: [],
      nextAction: "可以继续发送下一条 prompt。",
    };

    const index = upsertSessionIndexEntry(
      loadSessionIndex(repo),
      createSessionIndexEntry({
        id: "persisted-journal-session",
        createdAt,
        updatedAt: after.observedAt,
        status: "idle",
        turnCount: 1,
        lastPrompt: snapshot.lastPrompt,
        summaryTitle: snapshot.summary?.title ?? null,
        summaryBody: snapshot.summary?.body ?? null,
        hasPendingApprovals: false,
        lastKnownCopilotSessionId: null,
      }),
      null,
    );

    await saveSessionIndex(repo.rootPath, index);
    await saveSessionSnapshot({
      repoRoot: repo.rootPath,
      sessionId: "persisted-journal-session",
      createdAt,
      lastKnownCopilotSessionId: null,
      latestTurnWriteJournal: [
        {
          path: "src/feature.ts",
          existedBefore: true,
          contentBase64: Buffer.from("export const value = 'before';\n", "utf8").toString("base64"),
        },
      ],
      snapshot,
    });

    const state = createMvpState({
      repos: [repo],
      createClient: () =>
        new FlowFakeClient(() => {
          throw new Error("journal rollback should not create or resume a Copilot session");
        }),
    });

    try {
      const restoredSnapshot = state.getSnapshot();
      assert.equal(restoredSnapshot.activity?.rollback?.executor, "joudo-write-journal");
      assert.equal(restoredSnapshot.activity?.rollback?.status, "ready");
      assert.equal(restoredSnapshot.activity?.rollback?.canRollback, true);

      const rollbackSnapshot = await state.rollbackLatestTurn();

      assert.equal(await readFile(featureFile, "utf8"), "export const value = 'before';\n");
      assert.equal(rollbackSnapshot.activity?.latestTurn?.outcome, "rolled-back");
      assert.equal(rollbackSnapshot.activity?.rollback?.status, "reverted");
      assert.equal(rollbackSnapshot.activity?.rollback?.canRollback, false);
      assert.match(rollbackSnapshot.summary?.body ?? "", /Joudo 已按记录的写入基线恢复/);
    } finally {
      await state.dispose();
      await settleAsyncState();
    }
  } finally {
    await cleanupRepoRoot(repo.rootPath);
  }
});

test("submitPrompt degrades rollback when the watcher sees writes outside declared candidate paths", async () => {
  const repo = await createRepo("joudo-unexpected-write-");
  const featureFile = join(repo.rootPath, "src", "feature.ts");
  const rogueFile = join(repo.rootPath, "rogue.ts");

  try {
    await writeFile(featureFile, "export const value = 'before';\n", "utf8");

    const state = createMvpState({
      repos: [repo],
      createClient: () =>
        new FlowFakeClient(
          (config) =>
            new FlowFakeSession("copilot-unexpected-write", config.onPermissionRequest, async (_input, onPermissionRequest) => {
              await approveWritePermission(onPermissionRequest, {
                kind: "write",
                fileName: "src/feature.ts",
                intention: "更新 feature 文件",
              } as PermissionRequest);
              await writeFile(featureFile, "export const value = 'after';\n", "utf8");
              await writeFile(rogueFile, "export const rogue = true;\n", "utf8");
              await new Promise((resolve) => setTimeout(resolve, 20));
              return { data: { content: "已经修改 feature 文件，但还有额外写入。" } } as never;
            }),
        ),
    });

    try {
      await state.refreshAuth();
      await state.submitPrompt("请修改 feature 文件");
      const snapshot = await waitForSnapshotState(
        () => state.getSnapshot(),
        (nextSnapshot) => nextSnapshot.status === "idle" && nextSnapshot.summary?.title === "真实会话已返回结果",
      );

      assert.equal(snapshot.activity?.rollback?.status, "needs-review");
      assert.equal(snapshot.activity?.rollback?.canRollback, false);
      assert.match(snapshot.activity?.rollback?.reason ?? "", /候选路径之外/);
      assert.equal(snapshot.activity?.changedFiles.some((item) => item.source === "derived"), true);
    } finally {
      await state.dispose();
      await settleAsyncState();
    }
  } finally {
    await cleanupRepoRoot(repo.rootPath);
  }
});