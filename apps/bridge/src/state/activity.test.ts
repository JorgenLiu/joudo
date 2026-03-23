import assert from "node:assert/strict";
import test from "node:test";

import type { RepoDescriptor } from "@joudo/shared";

import { createRepoContext } from "./repo-context.js";
import { createSessionActivity } from "./activity.js";

function createRepoDescriptor(): RepoDescriptor {
  return {
    id: "demo-repo",
    name: "demo",
    rootPath: "/tmp/demo",
    trusted: true,
    policyState: "loaded",
  };
}

test("createSessionActivity builds blocker and approval detail from the current approval queue", () => {
  const context = createRepoContext(createRepoDescriptor());
  context.status = "awaiting-approval";
  context.lastPrompt = "启动本地服务验证修复";
  context.approvalState.approvals = [
    {
      id: "approval-1",
      title: "需要确认策略外 shell 操作",
      rationale: "需要启动本地服务来验证修复。",
      riskLevel: "high",
      requestedAt: "2026-03-21T00:00:00.000Z",
      approvalType: "shell-execution",
      commandPreview: "uvicorn app.main:app --reload",
      requestKind: "shell",
      target: "uvicorn app.main:app --reload",
      scope: "当前仓库内的 shell 执行请求",
      impact: "如果批准，Copilot 会继续在当前仓库执行这条命令并基于结果推进任务。",
      denyImpact: "如果拒绝，这一轮任务可能停在当前步骤，Copilot 需要改写计划或等待新的指令。",
      whyNow: "需要启动本地服务来验证修复。",
      expectedEffect: "执行这条 shell 命令，并把结果继续用于当前任务。",
      fallbackIfDenied: "当前步骤会被阻断，Copilot 需要改写计划、等待新的权限，或等待你改写提示词。",
    },
  ];

  const activity = createSessionActivity(context);

  assert.ok(activity);
  assert.equal(activity.phase, "awaiting-approval");
  assert.equal(activity.intent, "启动本地服务验证修复");
  assert.match(activity.headline, /等待用户审批/);
  assert.equal(activity.workspacePath, null);
  assert.equal(activity.latestTurn, null);
  assert.equal(activity.rollback, null);
  assert.deepEqual(activity.checkpoints, []);
  assert.equal(activity.latestCompaction, null);
  assert.equal(activity.blockers.length, 1);
  assert.equal(activity.blockers[0]?.kind, "approval");
  assert.match(activity.blockers[0]?.detail ?? "", /启动本地服务/);
});

test("createSessionActivity surfaces the latest checkpoint created by compaction", () => {
  const context = createRepoContext(createRepoDescriptor());
  context.status = "idle";
  context.turns.workspacePath = "/tmp/demo/.copilot/session-state/session-1";
  context.turns.checkpoints = [
    {
      number: 2,
      title: "Refine validation flow",
      fileName: "002-refine-validation-flow.md",
      path: "checkpoints/002-refine-validation-flow.md",
    },
  ];
  context.turns.latestCompaction = {
    completedAt: "2026-03-21T01:00:00.000Z",
    messagesRemoved: 14,
    tokensRemoved: 929,
    checkpointNumber: 2,
    checkpointPath: "/tmp/demo/.copilot/session-state/session-1/checkpoints/002-refine-validation-flow.md",
    summaryPreview: "最近一次 compaction 已经把前两轮工作压缩成 checkpoint 摘要。",
  };

  const activity = createSessionActivity(context);

  assert.ok(activity);
  assert.equal(activity.workspacePath, "/tmp/demo/.copilot/session-state/session-1");
  assert.equal(activity.checkpoints.length, 1);
  assert.equal(activity.latestCompaction?.checkpointNumber, 2);
  assert.equal(activity.latestTurn, null);
  assert.equal(activity.rollback, null);
  assert.equal(activity.items[0]?.title, "已生成会话 checkpoint");
  assert.match(activity.items[0]?.detail ?? "", /compaction/);
});

test("createSessionActivity exposes the latest observed turn and rollback state", () => {
  const context = createRepoContext(createRepoDescriptor());
  context.status = "idle";
  context.turns.latestTurn = {
    id: "turn-1",
    prompt: "修改验证逻辑",
    startedAt: "2026-03-21T00:00:00.000Z",
    completedAt: "2026-03-21T00:02:00.000Z",
    outcome: "completed",
    changedFiles: [
      {
        path: "src/validation.ts",
        changeKind: "updated",
        source: "observed",
      },
    ],
  };
  context.turns.rollback = {
    authority: "joudo",
    executor: "copilot-undo",
    status: "ready",
    canRollback: true,
    reason: "可以尝试撤回上一轮工作区改动。",
    targetTurnId: "turn-1",
    changedFiles: context.turns.latestTurn.changedFiles,
    evaluatedAt: "2026-03-21T00:02:00.000Z",
    workspaceDigestBefore: "before",
    workspaceDigestAfter: "after",
  };

  const activity = createSessionActivity(context);

  assert.ok(activity);
  assert.equal(activity.changedFiles[0]?.path, "src/validation.ts");
  assert.equal(activity.latestTurn?.id, "turn-1");
  assert.equal(activity.rollback?.status, "ready");
  assert.equal(activity.rollback?.canRollback, true);
});