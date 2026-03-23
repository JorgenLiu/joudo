import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LivePolicyValidationReport } from "@joudo/shared";

import { ValidationPanel } from "./ValidationPanel";

const report: LivePolicyValidationReport = {
  generatedAt: "2026-03-20T13:32:39.550Z",
  bridgeOrigin: "http://127.0.0.1:8787",
  reportPath: "/Users/jordan.liu/dev/joudo/.joudo/live-policy-validation.json",
  success: true,
  repo: {
    id: "demo-1",
    name: "demo",
    rootPath: "/Users/jordan.liu/dev/demo",
    policyState: "loaded",
  },
  scenarios: [
    {
      label: "service startup requires approval",
      command: "uvicorn app.main:app --reload",
      expectedResolution: "user-denied",
      expectedMatchedRule: "confirm_shell: uvicorn app.main:app --reload",
      success: true,
      actualResolution: "user-denied",
      actualMatchedRule: "confirm_shell: uvicorn app.main:app --reload",
      attempts: 1,
      notes: "验证服务启动请求会进入网页审批，并能被用户拒绝。",
    },
  ],
  checks: [
    {
      label: "structured approval error from stale approval id",
      p0: ["P0-03"],
      success: true,
      details: {
        code: "approval",
        retryable: true,
        approvalsCount: 1,
      },
    },
  ],
  p0Coverage: {
    "P0-01": [
      {
        label: "startup restore preserves timed-out state and context",
        success: true,
      },
    ],
    "P0-03": [
      {
        label: "structured approval error from stale approval id",
        success: true,
      },
    ],
  },
};

describe("ValidationPanel", () => {
  it("renders scenarios, checks, and p0 coverage from the live validation report", () => {
    render(<ValidationPanel validationReport={report} isRefreshingValidation={false} onRefreshValidation={vi.fn()} />);

    expect(screen.getByText("最近一次 live policy 回归通过")).toBeInTheDocument();
    expect(screen.getByText("service startup requires approval")).toBeInTheDocument();
    expect(screen.getByText("structured approval error from stale approval id")).toBeInTheDocument();
    expect(screen.getByText("P0-01")).toBeInTheDocument();
    expect(screen.getByText("P0-03")).toBeInTheDocument();
    expect(screen.getByText("P0 关联：P0-03")).toBeInTheDocument();
    expect(screen.getByText("retryable")).toBeInTheDocument();
    expect(screen.getByText("是")).toBeInTheDocument();
  });

  it("refreshes the report when the user clicks the refresh button", async () => {
    const onRefreshValidation = vi.fn().mockResolvedValue(undefined);
    render(<ValidationPanel validationReport={report} isRefreshingValidation={false} onRefreshValidation={onRefreshValidation} />);

    fireEvent.click(screen.getByRole("button", { name: "刷新结果" }));

    await waitFor(() => expect(onRefreshValidation).toHaveBeenCalledTimes(1));
  });

  it("shows the empty state when no validation report exists", () => {
    render(<ValidationPanel validationReport={null} isRefreshingValidation={false} onRefreshValidation={vi.fn()} />);

    expect(screen.getByText("还没有 live policy 回归结果。先运行 corepack pnpm validate:policy-live，再刷新这里。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取结果" })).toBeInTheDocument();
  });
});