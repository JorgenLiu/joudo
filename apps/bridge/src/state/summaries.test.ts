import assert from "node:assert/strict";
import test from "node:test";

import { createSummarySteps } from "./summaries.js";

test("createSummarySteps aggregates timeline signals instead of replaying raw events", () => {
  const steps = createSummarySteps({
    prompt: "请修复表单提交并验证结果",
    timeline: [
      {
        id: "status-1",
        kind: "status",
        title: "进入执行阶段",
        body: "Copilot 会话已经开始处理当前任务。",
        timestamp: "2026-03-22T10:00:00.000Z",
      },
      {
        id: "assistant-1",
        kind: "assistant",
        title: "Copilot 已回复",
        body: "已经修复提交逻辑，并补了一轮校验。",
        timestamp: "2026-03-22T10:00:05.000Z",
      },
      {
        id: "approval-1",
        kind: "approval-requested",
        title: "等待文件写入审批",
        body: "需要确认是否允许写入表单组件。",
        timestamp: "2026-03-22T10:00:02.000Z",
      },
    ],
    assistantMessage: "已经修复提交逻辑，并补了一轮校验。",
    executedCommands: ["pnpm test", "pnpm typecheck"],
    changedFiles: ["apps/web/src/components/Form.tsx"],
    status: "completed",
  });

  assert.equal(steps.filter((step) => step.kind === "assistant").length, 1);
  assert.equal(steps.filter((step) => step.kind === "approval").length, 1);
  assert.equal(steps.filter((step) => step.kind === "status").length, 0);
  assert.equal(steps[0]?.kind, "prompt");
  assert.match(steps.find((step) => step.kind === "approval")?.title ?? "", /等待文件写入审批/);
});