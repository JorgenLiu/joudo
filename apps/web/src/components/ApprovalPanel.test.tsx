import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApprovalRequest, SessionTimelineEntry } from "@joudo/shared";

import { ApprovalPanel } from "./ApprovalPanel";

const baseApproval: ApprovalRequest = {
  id: "approval-1",
  title: "允许启动本地服务",
  rationale: "需要运行开发服务来验证修复是否生效。",
  riskLevel: "high",
  requestedAt: "2026-03-20T13:00:00.000Z",
  approvalType: "shell-execution",
  commandPreview: "uvicorn app.main:app --reload",
  requestKind: "shell",
  target: "uvicorn app.main:app --reload",
  scope: "当前仓库的本地开发服务",
  impact: "允许 CLI 在本机启动持续运行的开发进程。",
  denyImpact: "当前验证会停在这里，直到你改用别的方式继续。",
  matchedRule: "confirm_shell: uvicorn app.main:app --reload",
};

const latestPersistedApproval: SessionTimelineEntry = {
  id: "approval-resolved-persisted",
  kind: "approval-resolved",
  title: "审批已通过并写入策略",
  body: "已允许读取 docs/guides，并写入当前 repo allowlist。",
  timestamp: "2026-03-21T12:00:00.000Z",
  decision: {
    action: "confirm",
    resolution: "user-allowed",
    approvalType: "repo-read",
    persistedToPolicy: true,
    matchedRule: "allowed_paths: ./docs/guides",
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApprovalPanel", () => {
  it("renders approval rationale and metadata for the queue", () => {
    render(<ApprovalPanel approvals={[baseApproval]} onResolveApproval={vi.fn()} />);

    expect(screen.getByText("允许启动本地服务")).toBeInTheDocument();
    expect(screen.getByText("需要运行开发服务来验证修复是否生效。")).toBeInTheDocument();
    expect(screen.getByText("可执行 shell")).toBeInTheDocument();
    expect(screen.getByText("confirm_shell: uvicorn app.main:app --reload")).toBeInTheDocument();
    expect(screen.getByText("当前仓库的本地开发服务")).toBeInTheDocument();
    expect(screen.getByText("允许 CLI 在本机启动持续运行的开发进程。")).toBeInTheDocument();
  });

  it("renders the latest persisted allowlist rule as a success card", () => {
    render(<ApprovalPanel approvals={[]} latestPersistedApproval={latestPersistedApproval} onResolveApproval={vi.fn()} />);

    expect(screen.getByText("已加入当前 repo policy")).toBeInTheDocument();
    expect(screen.getByText("allowlist 已更新")).toBeInTheDocument();
    expect(screen.getByText("已允许读取 docs/guides，并写入当前 repo allowlist。")).toBeInTheDocument();
    expect(screen.getByText("allowed_paths: ./docs/guides")).toBeInTheDocument();
    expect(screen.getByText("仓库内读取")).toBeInTheDocument();
  });

  it("asks for confirmation before allowing a high-risk approval", async () => {
    const onResolveApproval = vi.fn().mockResolvedValue(undefined);

    render(<ApprovalPanel approvals={[baseApproval]} onResolveApproval={onResolveApproval} />);
    fireEvent.click(screen.getByRole("button", { name: "允许本次" }));

    // ConfirmDialog should appear
    await waitFor(() => {
      expect(screen.getByText("确认放行高风险操作")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "确认放行" }));

    await waitFor(() => {
      expect(onResolveApproval).toHaveBeenCalledWith(baseApproval, "allow-once");
    });
  });

  it("does not resolve a high-risk approval when confirmation is cancelled", async () => {
    const onResolveApproval = vi.fn().mockResolvedValue(undefined);

    render(<ApprovalPanel approvals={[baseApproval]} onResolveApproval={onResolveApproval} />);
    fireEvent.click(screen.getByRole("button", { name: "允许并加入 policy" }));

    await waitFor(() => {
      expect(screen.getByText("确认放行高风险操作")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(onResolveApproval).not.toHaveBeenCalled();
    });
  });

  it("persists supported approvals into policy when requested", async () => {
    const onResolveApproval = vi.fn().mockResolvedValue(undefined);

    render(<ApprovalPanel approvals={[baseApproval]} onResolveApproval={onResolveApproval} />);
    fireEvent.click(screen.getByRole("button", { name: "允许并加入 policy" }));

    await waitFor(() => {
      expect(screen.getByText("确认放行高风险操作")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "确认放行" }));

    await waitFor(() => {
      expect(onResolveApproval).toHaveBeenCalledWith(baseApproval, "allow-and-persist");
    });
  });

  it("keeps the persist button hidden for unsupported approval kinds", () => {
    render(
      <ApprovalPanel
        approvals={[
          {
            ...baseApproval,
            id: "approval-url",
            requestKind: "url",
            approvalType: "url-fetch",
            target: "https://example.com/docs",
            commandPreview: "https://example.com/docs",
          },
        ]}
        onResolveApproval={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "允许并加入 policy" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "允许本次" })).toBeInTheDocument();
  });

  it("shows the persist button for write approvals", () => {
    render(
      <ApprovalPanel
        approvals={[
          {
            ...baseApproval,
            id: "approval-write",
            title: "需要确认文件写入",
            requestKind: "write",
            approvalType: "file-write",
            target: "src/generated/routes.ts",
            commandPreview: "src/generated/routes.ts",
            matchedRule: "allowed_paths",
          },
        ]}
        onResolveApproval={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "允许并加入 policy" })).toBeInTheDocument();
  });
});