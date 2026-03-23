import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionIndexDocument } from "@joudo/shared";

import { SessionHistoryPanel } from "./SessionHistoryPanel";

const sessionIndex: SessionIndexDocument = {
  schemaVersion: 1,
  repoId: "demo-repo",
  repoPath: "/tmp/demo-repo",
  currentSessionId: "joudo-1",
  updatedAt: "2026-03-21T12:00:00.000Z",
  sessions: [
    {
      id: "joudo-1",
      title: "已完成的历史记录",
      createdAt: "2026-03-21T11:00:00.000Z",
      updatedAt: "2026-03-21T11:40:00.000Z",
      status: "idle",
      canAttemptResume: true,
      recoveryMode: "attach",
      turnCount: 2,
      lastPromptPreview: "请总结 bridge 当前结构",
      summaryTitle: "一轮执行完成",
      summaryPreview: "bridge 已经返回结构化结果。",
      hasPendingApprovals: false,
      lastKnownCopilotSessionId: "copilot-1",
    },
    {
      id: "joudo-2",
      title: "中断的审批记录",
      createdAt: "2026-03-21T10:00:00.000Z",
      updatedAt: "2026-03-21T10:20:00.000Z",
      status: "interrupted",
      canAttemptResume: false,
      recoveryMode: "history-only",
      turnCount: 1,
      lastPromptPreview: "继续排查 repo 外部依赖",
      summaryTitle: "等待审批",
      summaryPreview: "上次中断时正在等待权限请求。",
      hasPendingApprovals: true,
      lastKnownCopilotSessionId: null,
    },
  ],
};

describe("SessionHistoryPanel", () => {
  it("renders concise recovery notes for attach and history-only entries", () => {
    render(<SessionHistoryPanel sessionIndex={sessionIndex} isRecoveringSession={false} onRecoverSession={vi.fn()} />);

    expect(screen.getByText("Joudo 会先恢复记录，再尝试接回旧会话。失败时会退回只读历史。")).toBeInTheDocument();
    expect(screen.getByText("这条记录只能恢复记录。旧审批不会在重连后继续等待。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复并尝试接管" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只恢复记录" })).toBeInTheDocument();
  });

  it("forwards the selected history session id when the user starts recovery", () => {
    const onRecoverSession = vi.fn();

    render(<SessionHistoryPanel sessionIndex={sessionIndex} isRecoveringSession={false} onRecoverSession={onRecoverSession} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复并尝试接管" }));

    expect(onRecoverSession).toHaveBeenCalledWith("joudo-1");
  });
});