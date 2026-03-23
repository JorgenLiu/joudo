import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionSnapshot } from "@joudo/shared";

import { SummaryPanel } from "./SummaryPanel";

const snapshot: SessionSnapshot = {
  sessionId: "joudo-session-1",
  status: "idle",
  repo: {
    id: "demo-repo",
    name: "demo-repo",
    rootPath: "/tmp/demo-repo",
    trusted: true,
    policyState: "loaded",
  },
  model: "gpt-5-mini",
  availableModels: ["gpt-5-mini", "gpt-5.4"],
  auth: {
    status: "authenticated",
    message: "authenticated",
  },
  lastPrompt: "请修复表单提交并验证结果",
  approvals: [],
  timeline: [],
  auditLog: [],
  activity: null,
  summary: {
    title: "真实会话已返回结果",
    body: "已经修复提交逻辑，并补了一轮校验。",
    steps: [
      {
        id: "step-prompt",
        kind: "prompt",
        status: "completed",
        title: "已发送提示词",
        detail: "请修复表单提交并验证结果",
      },
      {
        id: "step-command",
        kind: "command",
        status: "completed",
        title: "执行了 2 条命令",
        detail: "pnpm test\npnpm typecheck",
      },
      {
        id: "step-files",
        kind: "file-change",
        status: "completed",
        title: "产生了 2 项文件变更",
        detail: "apps/web/src/components/Form.tsx\napps/web/src/components/Form.test.tsx",
      },
    ],
    executedCommands: ["pnpm test", "pnpm typecheck"],
    approvalTypes: ["file-write", "shell-readonly"],
    changedFiles: ["apps/web/src/components/Form.tsx", "apps/web/src/components/Form.test.tsx"],
    checks: ["本轮已经形成可展示的执行结果", "已记录 2 类获批权限", "已记录 2 项文件变更"],
    risks: ["当前仓库缺少 repo policy 文件，bridge 会按保守默认值处理权限请求"],
    nextAction: "先检查这轮记录下来的文件变更，再决定是否继续围绕“请修复表单提交并验证结果”推进下一步。",
  },
  updatedAt: "2026-03-21T12:00:00.000Z",
};

describe("SummaryPanel", () => {
  it("renders the execution summary as a result-oriented panel", () => {
    render(<SummaryPanel snapshot={snapshot} />);

    expect(screen.getByText("当前摘要已经收口")).toBeInTheDocument();
    expect(screen.getByText("这一轮当前能解释的结果、风险和下一步已经整理到下面。")).toBeInTheDocument();
    expect(screen.getByText("空闲")).toBeInTheDocument();
    expect(screen.getByText("真实会话已返回结果")).toBeInTheDocument();
    expect(screen.getByText("已经修复提交逻辑，并补了一轮校验。")).toBeInTheDocument();
    expect(screen.getByText("本轮执行步骤")).toBeInTheDocument();
    expect(screen.getByText("已发送提示词")).toBeInTheDocument();
    expect(screen.getByText("执行了 2 条命令")).toBeInTheDocument();
    expect(screen.getByText("产生了 2 项文件变更")).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByText("文件写入")).toBeInTheDocument();
    expect(screen.getByText("只读 shell")).toBeInTheDocument();
    expect(screen.getAllByText("apps/web/src/components/Form.tsx").length).toBeGreaterThan(0);
    expect(screen.getByText("本轮已经形成可展示的执行结果")).toBeInTheDocument();
    expect(screen.getByText("当前仓库缺少 repo policy 文件，bridge 会按保守默认值处理权限请求")).toBeInTheDocument();
    expect(screen.getByText("先检查这轮记录下来的文件变更，再决定是否继续围绕“请修复表单提交并验证结果”推进下一步。")).toBeInTheDocument();
  });

  it("renders legacy summaries with missing arrays without crashing", () => {
    const legacySnapshot = {
      ...snapshot,
      summary: {
        title: "历史摘要",
        body: "这是从旧快照恢复的摘要。",
      },
    } as SessionSnapshot;

    render(<SummaryPanel snapshot={legacySnapshot} />);

    expect(screen.getByText("历史摘要")).toBeInTheDocument();
    expect(screen.getByText("这是从旧快照恢复的摘要。")).toBeInTheDocument();
    expect(screen.getAllByText("0 条").length).toBeGreaterThan(0);
    expect(screen.getByText("先查看本轮已恢复的摘要和时间线，再决定是否继续下一步。")).toBeInTheDocument();
  });
});