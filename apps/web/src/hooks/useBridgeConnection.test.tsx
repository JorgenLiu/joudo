import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useBridgeConnection } from "./useBridgeConnection";

/* ── Mock bridge-utils ─────────────────────────────────── */

vi.mock("./bridge-utils", () => ({
  bridgeSocketOrigin: "ws://localhost:8787",
  getStoredToken: () => "test-token",
  clearStoredToken: vi.fn(),
  normalizeSnapshot: (s: unknown) => s,
  toErrorState: (
    _err: unknown,
    fallback: { message: string },
    retry?: () => void,
    retryLabel?: string,
  ) => ({
    error: { message: fallback.message },
    retry: retry ?? null,
    retryLabel: retryLabel ?? null,
  }),
}));

/* ── Shared mock context ───────────────────────────────── */

const mockCtx = {
  connectionState: "bridge 连接中",
  isBootstrapping: true,
  isDisconnected: false,
  setConnectionState: vi.fn(),
  setIsBootstrapping: vi.fn(),
  setIsDisconnected: vi.fn(),
  setErrorState: vi.fn(),
  setSnapshot: vi.fn(),
  bootstrap: vi.fn().mockResolvedValue(undefined),
};

vi.mock("./BridgeContext", () => ({
  useBridgeContext: () => mockCtx,
}));

/* ── Fake WebSocket ────────────────────────────────────── */

type WSHandler = (event: { data?: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  listeners: Record<string, WSHandler[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: WSHandler) {
    (this.listeners[type] ??= []).push(handler);
  }

  close() {
    this.closed = true;
  }

  /* helpers for tests */
  emit(type: string, data?: Record<string, unknown>) {
    for (const handler of this.listeners[type] ?? []) {
      handler(data ?? {});
    }
  }
}

/* ── Setup / teardown ──────────────────────────────────── */

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  // reset mock call history but keep implementations
  vi.clearAllMocks();
  mockCtx.bootstrap.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = OriginalWebSocket;
});

/* ── Helpers ────────────────────────────────────────────── */

const flushPromises = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

/* ── Tests ─────────────────────────────────────────────── */

describe("useBridgeConnection", () => {
  /* ---------- Bootstrap ---------- */

  it("calls ctx.bootstrap() on mount", async () => {
    renderHook(() => useBridgeConnection());
    await flushPromises();

    expect(mockCtx.bootstrap).toHaveBeenCalledTimes(1);
  });

  it("sets error state when bootstrap fails", async () => {
    mockCtx.bootstrap.mockRejectedValueOnce(new Error("network"));

    renderHook(() => useBridgeConnection());
    await flushPromises();

    expect(mockCtx.setErrorState).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining("无法加载") }) }),
    );
    expect(mockCtx.setConnectionState).toHaveBeenCalledWith("bridge 连接失败");
    expect(mockCtx.setIsBootstrapping).toHaveBeenCalledWith(false);
  });

  /* ---------- WebSocket lifecycle ---------- */

  it("creates a WebSocket connection on mount", () => {
    renderHook(() => useBridgeConnection());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toBe("ws://localhost:8787/ws?token=test-token");
  });

  it("sets connectionState and isDisconnected=false on WS open", async () => {
    renderHook(() => useBridgeConnection());

    const ws = FakeWebSocket.instances[0]!;
    act(() => ws.emit("open"));

    expect(mockCtx.setConnectionState).toHaveBeenCalledWith("bridge 实时通道已连接");
    expect(mockCtx.setIsDisconnected).toHaveBeenCalledWith(false);
  });

  it("parses session.snapshot messages and calls setSnapshot", () => {
    renderHook(() => useBridgeConnection());

    const ws = FakeWebSocket.instances[0]!;
    const payload = { status: "idle", repo: null };

    act(() => {
      ws.emit("message", { data: JSON.stringify({ type: "session.snapshot", payload }) });
    });

    expect(mockCtx.setSnapshot).toHaveBeenCalledWith(payload);
  });

  it("ignores messages with non-snapshot event types", () => {
    renderHook(() => useBridgeConnection());

    const ws = FakeWebSocket.instances[0]!;
    act(() => {
      ws.emit("message", { data: JSON.stringify({ type: "other.event", payload: {} }) });
    });

    expect(mockCtx.setSnapshot).not.toHaveBeenCalled();
  });

  it("does not crash on unparseable WebSocket messages", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => useBridgeConnection());

    const ws = FakeWebSocket.instances[0]!;
    act(() => ws.emit("message", { data: "not-json{{{" }));

    expect(warnSpy).toHaveBeenCalledWith("Failed to parse WebSocket message", "not-json{{{");
    expect(mockCtx.setSnapshot).not.toHaveBeenCalled();
  });

  it("closes the socket on WS error event", () => {
    renderHook(() => useBridgeConnection());

    const ws = FakeWebSocket.instances[0]!;
    act(() => ws.emit("error"));

    expect(ws.closed).toBe(true);
  });

  /* ---------- Reconnection ---------- */

  it("reconnects with exponential backoff on WS close", () => {
    renderHook(() => useBridgeConnection());

    const ws1 = FakeWebSocket.instances[0]!;

    // first close → 1s delay
    act(() => ws1.emit("close"));
    expect(mockCtx.setIsDisconnected).toHaveBeenCalledWith(true);
    expect(mockCtx.setConnectionState).toHaveBeenCalledWith(expect.stringContaining("1 秒后重连"));

    // advance 1s → new socket created
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // second close → 2s delay
    const ws2 = FakeWebSocket.instances[1]!;
    act(() => ws2.emit("close"));
    expect(mockCtx.setConnectionState).toHaveBeenCalledWith(expect.stringContaining("2 秒后重连"));

    // advance 2s → third socket
    act(() => vi.advanceTimersByTime(2000));
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("resets reconnect counter on successful open", () => {
    renderHook(() => useBridgeConnection());

    const ws1 = FakeWebSocket.instances[0]!;

    // close → 1s → new socket → open → close again → should be 1s again (reset)
    act(() => ws1.emit("close"));
    act(() => vi.advanceTimersByTime(1000));
    const ws2 = FakeWebSocket.instances[1]!;
    act(() => ws2.emit("open"));
    act(() => ws2.emit("close"));

    // after open, reconnectAttempt reset to 0, so delay = 1s again
    expect(mockCtx.setConnectionState).toHaveBeenLastCalledWith(expect.stringContaining("1 秒后重连"));
  });

  it("caps backoff at 10 seconds", () => {
    renderHook(() => useBridgeConnection());

    // close 5 times: delays = 1, 2, 4, 8, 10 (capped)
    for (let i = 0; i < 5; i++) {
      const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
      act(() => ws.emit("close"));
      // last iteration should cap at 10s
      if (i === 4) {
        expect(mockCtx.setConnectionState).toHaveBeenLastCalledWith(expect.stringContaining("10 秒后重连"));
      }
      act(() => vi.advanceTimersByTime(10000));
    }
  });

  /* ---------- Cleanup ---------- */

  it("closes socket and clears timers on unmount", () => {
    const { unmount } = renderHook(() => useBridgeConnection());

    const ws = FakeWebSocket.instances[0]!;
    act(() => ws.emit("close")); // schedule a reconnect timer
    expect(FakeWebSocket.instances).toHaveLength(1); // timer pending, no new socket yet

    unmount();

    // advancing should NOT create a new socket because cleanup cancelled the timer
    act(() => vi.advanceTimersByTime(10000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  /* ---------- Rebootstrap ---------- */

  it("rebootstrap resets state and re-calls bootstrap", async () => {
    const { result } = renderHook(() => useBridgeConnection());
    await flushPromises();

    vi.clearAllMocks();
    mockCtx.bootstrap.mockResolvedValue(undefined);

    await act(async () => {
      await result.current.rebootstrap();
    });

    expect(mockCtx.setIsBootstrapping).toHaveBeenCalledWith(true);
    expect(mockCtx.setErrorState).toHaveBeenCalledWith(null);
    expect(mockCtx.bootstrap).toHaveBeenCalledTimes(1);
    expect(mockCtx.setIsBootstrapping).toHaveBeenCalledWith(false);
  });

  it("rebootstrap sets error state on failure", async () => {
    const { result } = renderHook(() => useBridgeConnection());
    await flushPromises();

    vi.clearAllMocks();
    mockCtx.bootstrap.mockRejectedValueOnce(new Error("boom"));

    await act(async () => {
      await result.current.rebootstrap();
    });

    expect(mockCtx.setErrorState).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining("无法重新加载") }) }),
    );
    // isBootstrapping is set to false in finally
    expect(mockCtx.setIsBootstrapping).toHaveBeenCalledWith(false);
  });

  /* ---------- Return shape ---------- */

  it("returns expected properties", () => {
    const { result } = renderHook(() => useBridgeConnection());

    expect(result.current).toHaveProperty("connectionState");
    expect(result.current).toHaveProperty("isBootstrapping");
    expect(result.current).toHaveProperty("isDisconnected");
    expect(typeof result.current.rebootstrap).toBe("function");
  });
});
