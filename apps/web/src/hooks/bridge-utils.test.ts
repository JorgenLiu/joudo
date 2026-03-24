import { afterEach, describe, expect, it, vi } from "vitest";

import { emptySnapshot, normalizeSnapshot, readJson } from "./bridge-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

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
      agent: "reviewer",
      availableAgents: ["reviewer"],
      updatedAt: "2026-03-22T10:00:00.000Z",
      approvals: [],
      timeline: [],
      auditLog: [],
    };
    const result = normalizeSnapshot(input);
    expect(result.sessionId).toBe("my-session");
    expect(result.status).toBe("running");
    expect(result.model).toBe("gpt-5");
    expect(result.agent).toBe("reviewer");
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
      availableAgents: [null, "reviewer", 123],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = normalizeSnapshot(input);
    expect(result.approvals).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.auditLog).toEqual([]);
    expect(result.availableModels).toEqual(emptySnapshot.availableModels);
    expect(result.availableAgents).toEqual(["reviewer"]);
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

describe("readJson", () => {
  it("does not set content-type for POST requests without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await readJson<{ ok: boolean }>("/api/repo/sessions/clear", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).not.toHaveProperty("Content-Type");
  });

  it("sets content-type for requests with a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await readJson<{ ok: boolean }>("/api/session/recover", {
      method: "POST",
      body: JSON.stringify({ joudoSessionId: "test-session" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });
});
