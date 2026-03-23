import { describe, expect, it } from "vitest";

import { emptySnapshot, normalizeSnapshot } from "./bridge-utils";

describe("normalizeSnapshot", () => {
  it("returns emptySnapshot for null input", () => {
    expect(normalizeSnapshot(null)).toEqual(emptySnapshot);
  });

  it("returns emptySnapshot for undefined input", () => {
    expect(normalizeSnapshot(undefined)).toEqual(emptySnapshot);
  });

  it("returns emptySnapshot for non-object input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeSnapshot("bad" as any)).toEqual(emptySnapshot);
  });

  it("preserves valid snapshot fields", () => {
    const input = {
      ...emptySnapshot,
      sessionId: "my-session",
      status: "running" as const,
      model: "gpt-5",
      updatedAt: "2026-03-22T10:00:00.000Z",
      approvals: [],
      timeline: [],
      auditLog: [],
    };
    const result = normalizeSnapshot(input);
    expect(result.sessionId).toBe("my-session");
    expect(result.status).toBe("running");
    expect(result.model).toBe("gpt-5");
    expect(result.updatedAt).toBe("2026-03-22T10:00:00.000Z");
  });

  it("falls back to defaults for missing or invalid scalar fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = { ...emptySnapshot, sessionId: "", model: "" } as any;
    const result = normalizeSnapshot(input);
    expect(result.sessionId).toBe(emptySnapshot.sessionId);
    expect(result.model).toBe(emptySnapshot.model);
  });

  it("normalizes non-array collection fields to empty arrays", () => {
    const input = {
      ...emptySnapshot,
      approvals: null,
      timeline: "bad",
      auditLog: undefined,
      availableModels: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = normalizeSnapshot(input);
    expect(result.approvals).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.auditLog).toEqual([]);
    expect(result.availableModels).toEqual(emptySnapshot.availableModels);
  });

  it("normalizes auth with invalid status to default", () => {
    const input = {
      ...emptySnapshot,
      auth: { status: "broken", message: "test" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = normalizeSnapshot(input);
    expect(result.auth.status).toBe("unknown");
    expect(result.auth.message).toBe("test");
  });

  it("normalizes null auth to default", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = { ...emptySnapshot, auth: null } as any;
    const result = normalizeSnapshot(input);
    expect(result.auth).toEqual(emptySnapshot.auth);
  });

  it("normalizes summary with missing fields", () => {
    const input = {
      ...emptySnapshot,
      summary: {
        title: "",
        body: null,
        steps: "not-an-array",
        executedCommands: null,
        approvalTypes: undefined,
        changedFiles: null,
        checks: null,
        risks: null,
        nextAction: "",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = normalizeSnapshot(input);
    expect(result.summary).not.toBeNull();
    expect(result.summary!.title).toBe("已恢复执行摘要");
    expect(result.summary!.body).toBe("");
    expect(result.summary!.steps).toEqual([]);
    expect(result.summary!.executedCommands).toEqual([]);
    expect(result.summary!.approvalTypes).toEqual([]);
    expect(result.summary!.changedFiles).toEqual([]);
    expect(result.summary!.checks).toEqual([]);
    expect(result.summary!.risks).toEqual([]);
    expect(result.summary!.nextAction).toContain("先查看");
  });

  it("preserves valid summary fields", () => {
    const summary = {
      title: "Test Summary",
      body: "Test body content",
      steps: [{ id: "s1", kind: "command" as const, status: "completed" as const, title: "Step 1", detail: "detail" }],
      executedCommands: ["git status"],
      approvalTypes: ["shell-execution" as const],
      changedFiles: ["src/index.ts"],
      checks: ["lint passed"],
      risks: ["no risks"],
      nextAction: "Continue working",
    };
    const input = { ...emptySnapshot, summary };
    const result = normalizeSnapshot(input);
    expect(result.summary).toEqual(summary);
  });

  it("returns null summary for null input", () => {
    const input = { ...emptySnapshot, summary: null };
    const result = normalizeSnapshot(input);
    expect(result.summary).toBeNull();
  });

  it("generates updatedAt when missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input = { ...emptySnapshot, updatedAt: "" } as any;
    const result = normalizeSnapshot(input);
    expect(typeof result.updatedAt).toBe("string");
    expect(result.updatedAt.length).toBeGreaterThan(0);
  });
});
