import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionTimelineEntry } from "@joudo/shared";

import { TimelinePanel } from "./TimelinePanel";

const timeline: SessionTimelineEntry[] = [
  {
    id: "approval-resolved-1",
    kind: "approval-resolved",
    title: "审批已通过",
    body: "允许读取仓库外路径。",
    timestamp: "2026-03-21T12:00:00.000Z",
    decision: {
      action: "confirm",
      resolution: "user-allowed",
      approvalType: "external-path-read",
      persistedToPolicy: true,
      matchedRule: "allowed_paths",
    },
  },
];

describe("TimelinePanel", () => {
  it("renders semantic approval types for approval-related timeline entries", () => {
    render(<TimelinePanel timeline={timeline} />);

    expect(screen.getByText("审批结果")).toBeInTheDocument();
    expect(screen.getByText("审批已通过")).toBeInTheDocument();
    expect(screen.getByText("允许读取仓库外路径。")).toBeInTheDocument();
    expect(screen.getByText(/用户批准 \/ confirm \/ 仓库外读取 \/ 已写入 policy \/ allowed_paths/)).toBeInTheDocument();
  });
});