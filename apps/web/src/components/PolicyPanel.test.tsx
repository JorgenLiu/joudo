import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionSnapshot } from "@joudo/shared";

import { PolicyPanel } from "./PolicyPanel";

const snapshot: SessionSnapshot = {
  sessionId: "joudo-session-policy",
  status: "idle",
  repo: {
    id: "demo-repo",
    name: "demo-repo",
    rootPath: "/tmp/demo-repo",
    trusted: true,
    policyState: "loaded",
  },
  policy: {
    state: "loaded",
    path: "/tmp/demo-repo/.github/joudo-policy.yml",
    allowShell: ["git status", "pnpm test"],
    confirmShell: ["uvicorn"],
    denyShell: ["git push"],
    allowTools: [],
    confirmTools: [],
    denyTools: [],
    allowedPaths: [".", "./src"],
    allowedWritePaths: ["./src/generated", "./src/index.ts"],
    allowedUrls: ["github.com"],
    rules: [
      {
        id: "allowedWritePaths:./src/generated",
        field: "allowedWritePaths",
        value: "./src/generated",
        matchedRule: "allowed_write_paths: ./src/generated",
        source: "approval-persisted",
        risk: "high",
        note: "由 ./src/generated/routes.ts 归一化为 ./src/generated",
        lastUpdatedAt: "2026-03-21T11:59:00.000Z",
        isPersistedFromApproval: true,
      },
      {
        id: "allowedWritePaths:./src/index.ts",
        field: "allowedWritePaths",
        value: "./src/index.ts",
        matchedRule: "allowed_write_paths: ./src/index.ts",
        source: "policy-file",
        risk: "high",
        note: null,
        lastUpdatedAt: null,
        isPersistedFromApproval: false,
      },
      {
        id: "allowShell:git status",
        field: "allowShell",
        value: "git status",
        matchedRule: "allow_shell: git status",
        source: "policy-file",
        risk: "medium",
        note: null,
        lastUpdatedAt: null,
        isPersistedFromApproval: false,
      },
      {
        id: "allowShell:pnpm test",
        field: "allowShell",
        value: "pnpm test",
        matchedRule: "allow_shell: pnpm test",
        source: "policy-file",
        risk: "medium",
        note: null,
        lastUpdatedAt: null,
        isPersistedFromApproval: false,
      },
      {
        id: "allowedPaths:.",
        field: "allowedPaths",
        value: ".",
        matchedRule: "allowed_paths: .",
        source: "policy-file",
        risk: "low",
        note: null,
        lastUpdatedAt: null,
        isPersistedFromApproval: false,
      },
      {
        id: "allowedPaths:./src",
        field: "allowedPaths",
        value: "./src",
        matchedRule: "allowed_paths: ./src",
        source: "policy-file",
        risk: "low",
        note: null,
        lastUpdatedAt: null,
        isPersistedFromApproval: false,
      },
    ],
    error: null,
  },
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
  lastPrompt: null,
  approvals: [],
  timeline: [],
  auditLog: [],
  activity: null,
  summary: null,
  updatedAt: "2026-03-21T12:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function installClipboardMock() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("PolicyPanel", () => {
  it("renders structured policy rules and recent persisted changes", () => {
    render(<PolicyPanel snapshot={snapshot} onDeleteRule={vi.fn()} />);

    expect(screen.getByText("Policy")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText("2 条受控写入")).toBeInTheDocument();
    expect(screen.getByText("总规则数")).toBeInTheDocument();
    expect(screen.getAllByText("persisted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("./src/generated").length).toBeGreaterThan(0);
    expect(screen.getByText("./src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("git status")).toBeInTheDocument();
    expect(screen.getAllByText("由 ./src/generated/routes.ts 归一化为 ./src/generated").length).toBeGreaterThan(0);
    expect(screen.getByText("/tmp/demo-repo/.github/joudo-policy.yml")).toBeInTheDocument();
  });

  it("confirms before deleting a rule and forwards the rule to the callback", async () => {
    const onDeleteRule = vi.fn().mockResolvedValue(undefined);

    render(<PolicyPanel snapshot={snapshot} onDeleteRule={onDeleteRule} />);
    fireEvent.click(screen.getAllByRole("button", { name: "删除规则" })[0]!);

    // ConfirmDialog should appear
    await waitFor(() => {
      expect(screen.getByText("确认删除规则")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(onDeleteRule).toHaveBeenCalledWith(snapshot.policy!.rules[0]);
    });
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const onDeleteRule = vi.fn().mockResolvedValue(undefined);

    render(<PolicyPanel snapshot={snapshot} onDeleteRule={onDeleteRule} />);
    fireEvent.click(screen.getAllByRole("button", { name: "删除规则" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("确认删除规则")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(onDeleteRule).not.toHaveBeenCalled();
    });
  });

  it("copies the rule text to the clipboard and shows copied feedback", async () => {
    const writeText = installClipboardMock();

    render(<PolicyPanel snapshot={snapshot} onDeleteRule={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "复制规则" })[0]!);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("allowed_write_paths: ./src/generated");
      expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
    });
  });
});