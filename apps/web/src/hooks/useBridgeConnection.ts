import { useEffect } from "react";

import type { ServerEvent } from "@joudo/shared";

import { bridgeSocketOrigin, getStoredToken, clearStoredToken, normalizeSnapshot, toErrorState } from "./bridge-utils";
import { useBridgeContext } from "./BridgeContext";

export function useBridgeConnection() {
  const ctx = useBridgeContext();

  useEffect(() => {
    let isActive = true;

    async function runBootstrap() {
      try {
        if (!isActive) {
          return;
        }

        ctx.setErrorState(null);
        await ctx.bootstrap();
      } catch (error) {
        if (!isActive) {
          return;
        }

        ctx.setErrorState(
          toErrorState(
            error,
            {
              code: "unknown",
              message: "无法加载 bridge 数据。",
              nextAction: "稍后重新加载首页；如果问题持续出现，再检查 bridge 是否仍在运行。",
              retryable: true,
            },
            async () => {
              ctx.setErrorState(null);
              await ctx.bootstrap();
            },
            "重新加载首页",
          ),
        );
        ctx.setConnectionState("bridge 连接失败");
        ctx.setIsBootstrapping(false);
      }
    }

    void runBootstrap();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let reconnectAttempt = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (isDisposed) {
        return;
      }

      const token = getStoredToken();
      if (!token) {
        return;
      }

      const nextSocket = new WebSocket(`${bridgeSocketOrigin}/ws?token=${encodeURIComponent(token)}`);
      socket = nextSocket;

      nextSocket.addEventListener("open", () => {
        reconnectAttempt = 0;
        ctx.setConnectionState("bridge 实时通道已连接");
        ctx.setIsDisconnected(false);
      });

      nextSocket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(message.data as string) as ServerEvent;

          if (event.type === "session.snapshot") {
            ctx.setSnapshot(normalizeSnapshot(event.payload));
          }
        } catch {
          console.warn("Failed to parse WebSocket message", message.data);
        }
      });

      nextSocket.addEventListener("error", () => {
        nextSocket.close();
      });

      nextSocket.addEventListener("close", (event) => {
        if (isDisposed) {
          return;
        }

        if (event.code === 4001) {
          clearStoredToken();
          window.dispatchEvent(new Event("joudo:auth-expired"));
          return;
        }

        const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 10000);
        reconnectAttempt += 1;
        ctx.setConnectionState(`bridge 实时通道已断开，${Math.round(delayMs / 1000)} 秒后重连`);
        ctx.setIsDisconnected(true);
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delayMs);
      });
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  async function rebootstrap() {
    try {
      ctx.setIsBootstrapping(true);
      ctx.setErrorState(null);
      await ctx.bootstrap();
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "unknown",
            message: "无法重新加载 bridge 数据。",
            nextAction: "稍后重新加载首页；如果问题持续出现，再检查 bridge 是否仍在运行。",
            retryable: true,
          },
          () => rebootstrap(),
          "重新加载首页",
        ),
      );
    } finally {
      ctx.setIsBootstrapping(false);
    }
  }

  return {
    connectionState: ctx.connectionState,
    isBootstrapping: ctx.isBootstrapping,
    isDisconnected: ctx.isDisconnected,
    rebootstrap,
  };
}
