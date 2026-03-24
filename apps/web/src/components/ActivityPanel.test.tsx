import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionActivity } from "@joudo/shared";

import { ActivityPanel } from "./ActivityPanel";

const activity: SessionActivity = {
  phase: "awaiting-approval",
  intent: "启动本地服务验证修复",
  headline: "正在等待用户审批",
  detail: "当前步骤卡在启动本地服务，需要你确认是否继续。",
  updatedAt: "2026-03-21T10:00:00.000Z",
  workspacePath: "/tmp/demo/.copilot/session-state/session-1",
  commands: [
    {
      id: "command-1",
      command: "uvicorn app.main:app --reload",
      status: "completed",
      startedAt: "2026-03-21T09:59:00.000Z",
      completedAt: "2026-03-21T09:59:30.000Z",
      requestKind: "shell",
    },
  ],
  changedFiles: [
    {
      path: "apps/web/src/components/ValidationPanel.tsx",
      changeKind: "updated",
      source: "observed",
    },
  ],
  latestTurn: {
    id: "turn-2",
    prompt: "启动本地服务验证修复",
    startedAt: "2026-03-21T09:55:00.000Z",
    completedAt: "2026-03-21T09:59:00.000Z",
    outcome: "completed",
    changedFiles: [
      {
        path: "apps/web/src/components/ValidationPanel.tsx",
        changeKind: "updated",
        source: "observed",
      },
    ],
  },
  rollback: {
    authority: "joudo",
    executor: "copilot-undo",
    status: "ready",
    canRollback: true,
    reason: "可以尝试撤回上一轮工作区改动。",
    targetTurnId: "turn-2",
    changedFiles: [
      {
        path: "apps/web/src/components/ValidationPanel.tsx",
        changeKind: "updated",
        source: "observed",
      },
    ],
    trackedPaths: ["apps/web/src/components/ValidationPanel.tsx"],
    evaluatedAt: "2026-03-21T10:00:00.000Z",
    workspaceDigestBefore: "before-digest",
    workspaceDigestAfter: "after-digest",
  },
  checkpoints: [
    {
      number: 2,
      title: "Refine validation flow",
      fileName: "002-refine-validation-flow.md",
      path: "checkpoints/002-refine-validation-flow.md",
    },
  ],
  latestCompaction: {
    completedAt: "2026-03-21T09:58:00.000Z",
    messagesRemoved: 14,
    tokensRemoved: 929,
    checkpointNumber: 2,
    checkpointPath: "/tmp/demo/.copilot/session-state/session-1/checkpoints/002-refine-validation-flow.md",
    summaryPreview: "最近一次 compaction 已经把前两轮工作压缩成 checkpoint 摘要。",
  },
  blockers: [
    {
      kind: "approval",
      title: "需要确认策略外 shell 操作",
      detail: "需要启动本地服务来验证修复。",
      nextAction: "先处理当前审批，再继续这一轮任务。",
      relatedId: "approval-1",
    },
  ],
  items: [
    {
      id: "timeline-1",
      kind: "approval",
      status: "blocked",
      title: "需要确认策略外 shell 操作",
      detail: "Copilot 请求启动本地服务。",
      timestamp: "2026-03-21T09:59:40.000Z",
      phase: "awaiting-approval",
      evidence: [{ source: "timeline", id: "timeline-1" }],
    },
  ],
};

describe("ActivityPanel", () => {
  it("renders current activity state, blockers, and recent items", () => {
    render(
      <ActivityPanel
        activity={activity}
        selectedCheckpoint={null}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={async () => {}}
        onRollbackLatestTurn={async () => {}}
        onClearCheckpointSelection={() => {}}
      />,
    );

    expect(screen.getByText("正在等待用户审批")).toBeInTheDocument();
    expect(screen.getByText("当前步骤卡在启动本地服务，需要你确认是否继续。")).toBeInTheDocument();
    expect(screen.getByText("启动本地服务验证修复")).toBeInTheDocument();
    expect(screen.getAllByText("需要确认策略外 shell 操作")).toHaveLength(2);
    expect(screen.getByText("需要启动本地服务来验证修复。")).toBeInTheDocument();
    expect(screen.getByText("uvicorn app.main:app --reload")).toBeInTheDocument();
    expect(screen.getByText("/tmp/demo/.copilot/session-state/session-1")).toBeInTheDocument();
    expect(screen.getByText("1 个")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint 列表")).toBeInTheDocument();
    expect(screen.getByText("#2 Refine validation flow")).toBeInTheDocument();
    expect(screen.getByText("002-refine-validation-flow.md")).toBeInTheDocument();
    expect(screen.getByText(/最近一次 compaction 已经把前两轮工作压缩成 checkpoint 摘要/)).toBeInTheDocument();
    expect(screen.getAllByText("可直接回退（/undo）").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Copilot /undo").length).toBeGreaterThan(0);
    expect(screen.getByText("上一轮改动仍在 Joudo 的证据边界内，可以直接尝试 /undo。")).toBeInTheDocument();
    expect(screen.getByText("已跟踪路径：")).toBeInTheDocument();
    expect(screen.getAllByText("apps/web/src/components/ValidationPanel.tsx").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "撤回上一轮改动" })).toBeInTheDocument();
    expect(screen.getByText("待审批")).toBeInTheDocument();
  });

  it("renders checkpoint preview as a read-only recovery aid", () => {
    const onOpenCheckpoint = async () => {};

    render(
      <ActivityPanel
        activity={activity}
        selectedCheckpoint={{
          number: 2,
          title: "Refine validation flow",
          fileName: "002-refine-validation-flow.md",
          path: "checkpoints/002-refine-validation-flow.md",
          workspacePath: "/tmp/demo/.copilot/session-state/session-1",
          content: "<overview>checkpoint body</overview>",
        }}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={onOpenCheckpoint}
        onRollbackLatestTurn={async () => {}}
        onClearCheckpointSelection={() => {}}
      />,
    );

    expect(screen.getAllByText("#2 Refine validation flow").length).toBeGreaterThan(0);
    expect(screen.getByText("<overview>checkpoint body</overview>")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("查看 checkpoint")[0]!);
  });

  it("triggers rollback when the current turn is eligible", () => {
    const onRollbackLatestTurn = vi.fn().mockResolvedValue(undefined);

    render(
      <ActivityPanel
        activity={activity}
        selectedCheckpoint={null}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={async () => {}}
        onRollbackLatestTurn={onRollbackLatestTurn}
        onClearCheckpointSelection={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "撤回上一轮改动" }));

    expect(onRollbackLatestTurn).toHaveBeenCalledTimes(1);
  });

  it("renders the deterministic journal rollback executor label when available", () => {
    render(
      <ActivityPanel
        activity={{
          ...activity,
          rollback: {
            ...activity.rollback!,
            executor: "joudo-write-journal",
          },
        }}
        selectedCheckpoint={null}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={async () => {}}
        onRollbackLatestTurn={async () => {}}
        onClearCheckpointSelection={() => {}}
      />,
    );

    expect(screen.getAllByText("Joudo 基线回退").length).toBeGreaterThan(0);
    expect(screen.getAllByText("可直接回退（Joudo 基线）").length).toBeGreaterThan(0);
  });

  it("explains watcher-based degradation when writes escape the tracked scope", () => {
    render(
      <ActivityPanel
        activity={{
          ...activity,
          rollback: {
            ...activity.rollback!,
            status: "needs-review",
            canRollback: false,
            reason: "检测到 1 个候选路径之外的实际写入，Joudo 不会自动扩大上一轮回退边界。",
            changedFiles: [
              ...activity.rollback!.changedFiles,
              {
                path: "rogue.ts",
                changeKind: "updated",
                source: "derived",
                summary: "observed outside declared candidate paths",
              },
            ],
          },
          changedFiles: [
            ...activity.changedFiles,
            {
              path: "rogue.ts",
              changeKind: "updated",
              source: "derived",
              summary: "observed outside declared candidate paths",
            },
          ],
        }}
        selectedCheckpoint={null}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={async () => {}}
        onRollbackLatestTurn={async () => {}}
        onClearCheckpointSelection={() => {}}
      />,
    );

    expect(screen.getAllByText("检测到越界写入，需人工确认").length).toBeGreaterThan(0);
    expect(screen.getByText("检测到了候选路径之外的写入。Joudo 不会自动扩大回退范围，所以这里先要求人工确认。")).toBeInTheDocument();
    expect(screen.getByText("越界写入：")).toBeInTheDocument();
    expect(screen.getByText("rogue.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤回上一轮改动" })).toBeDisabled();
  });

  it("renders the empty state when no activity is available", () => {
    render(
      <ActivityPanel
        activity={null}
        selectedCheckpoint={null}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={async () => {}}
        onRollbackLatestTurn={async () => {}}
        onClearCheckpointSelection={() => {}}
      />,
    );

    expect(screen.getByText("当前没有执行轨迹。")).toBeInTheDocument();
  });

  it("renders legacy activity records with missing arrays without crashing", () => {
    const legacyActivity = {
      ...activity,
      commands: undefined,
      changedFiles: undefined,
      checkpoints: undefined,
      blockers: undefined,
      items: undefined,
      latestTurn: {
        ...activity.latestTurn,
        changedFiles: undefined,
      },
      rollback: {
        ...activity.rollback!,
        changedFiles: undefined,
        trackedPaths: undefined,
      },
      latestCompaction: {
        ...activity.latestCompaction!,
        messagesRemoved: undefined,
        tokensRemoved: undefined,
      },
    } as unknown as SessionActivity;

    render(
      <ActivityPanel
        activity={legacyActivity}
        selectedCheckpoint={null}
        isLoadingCheckpoint={false}
        isRollingBack={false}
        onOpenCheckpoint={async () => {}}
        onRollbackLatestTurn={async () => {}}
        onClearCheckpointSelection={() => {}}
      />,
    );

    expect(screen.getByText("正在等待用户审批")).toBeInTheDocument();
    expect(screen.getAllByText("暂无").length).toBeGreaterThan(0);
    expect(screen.getByText("当前没有记录到上一轮文件改动。")).toBeInTheDocument();
  });
});