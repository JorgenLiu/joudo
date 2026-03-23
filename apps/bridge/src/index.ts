import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type {
  ApprovalResolutionPayload,
  BridgeHealthResponse,
  BridgeErrorResponse,
  RecoverHistoricalSessionPayload,
  LivePolicyValidationReport,
  PromptSubmission,
  RepoInitPolicyPayload,
  RepoInitPolicyResult,
  RepoPolicyRuleDeletePayload,
  RepoInstructionUpdatePayload,
  RepoSelectionPayload,
  RollbackLatestTurnPayload,
  SessionModelSelectionPayload,
  SessionCheckpointDocument,
  ServerEvent,
  TotpSetupResponse,
  TotpVerifyPayload,
  TotpVerifyResponse,
} from "@joudo/shared";

import {
  getTotpUri,
  loadOrCreateSecret,
  printTotpQrCode,
  verifyTotp,
  createSessionToken,
  validateSessionToken,
  renewSessionToken,
} from "./auth/index.js";
import { serializeBridgeError } from "./errors.js";
import { createMvpState } from "./mvp-state.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const WORKSPACE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const LIVE_POLICY_REPORT_PATH = process.env.JOUDO_VALIDATION_REPORT_PATH ?? `${WORKSPACE_ROOT}/.joudo/live-policy-validation.json`;
const WEB_DIST_DIR = path.join(WORKSPACE_ROOT, "apps/web/dist");
const SERVE_STATIC = existsSync(path.join(WEB_DIST_DIR, "index.html"));

const app = Fastify({ logger: true });
const state = createMvpState();

const { secret: totpSecret, isNew: isNewTotpSecret } = loadOrCreateSecret();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void state.dispose().finally(() => {
      process.exit(0);
    });
  });
}

function serialize(event: ServerEvent) {
  return JSON.stringify(event);
}

function loadLivePolicyValidationReport(): LivePolicyValidationReport | null {
  if (!existsSync(LIVE_POLICY_REPORT_PATH)) {
    return null;
  }

  return JSON.parse(readFileSync(LIVE_POLICY_REPORT_PATH, "utf8")) as LivePolicyValidationReport;
}

function isLocalRequest(remoteAddress: string | undefined): boolean {
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

const LOCALHOST_ORIGINS = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://[::1]:${port}`,
  // Vite dev server default port
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || LOCALHOST_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error("CORS origin rejected"), false);
    }
  },
});

await app.register(websocket, {
  options: {
    maxPayload: 1024 * 1024, // 1 MB
  },
});

if (SERVE_STATIC) {
  await app.register(fastifyStatic, {
    root: WEB_DIST_DIR,
    prefix: "/",
    wildcard: false,
  });
}

app.setErrorHandler((error, _request, reply) => {
  const normalized = serializeBridgeError(error);
  void reply.status(normalized.statusCode).send(normalized.payload satisfies BridgeErrorResponse);
});

// /ws is exempt because it validates its own token via query param inside the handler
const AUTH_EXEMPT_ROUTES = new Set(["/health", "/api/auth/totp", "/api/auth/totp/setup", "/ws"]);

app.addHook("onRequest", async (request, reply) => {
  const pathname = request.url.split("?")[0]!;
  if (AUTH_EXEMPT_ROUTES.has(pathname)) {
    return;
  }
  if (SERVE_STATIC && !pathname.startsWith("/api/") && pathname !== "/ws") {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    void reply.status(401).send({ error: { code: "auth", message: "Missing bearer token. Please authenticate with TOTP first.", nextAction: "在手机验证器应用中获取6位验证码，然后在网页上输入。", retryable: false } });
    return;
  }

  const token = authHeader.slice(7);
  if (!validateSessionToken(token)) {
    void reply.status(401).send({ error: { code: "auth", message: "Session expired or invalid. Please re-authenticate.", nextAction: "验证码已过期，请重新输入手机验证器上的6位验证码。", retryable: false } });
    return;
  }

  renewSessionToken(token);
});

app.post<{ Body: TotpVerifyPayload }>("/api/auth/totp", {
  schema: {
    body: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", minLength: 6, maxLength: 6, pattern: "^[0-9]{6}$" } },
      additionalProperties: false,
    },
  },
}, async (request): Promise<TotpVerifyResponse> => {
  const { code } = request.body;

  if (!verifyTotp(totpSecret, code)) {
    return { success: false, message: "验证码无效或已过期，请重新尝试。" };
  }

  const token = createSessionToken();
  return { success: true, token, message: "认证成功。" };
});

app.get("/api/auth/totp/setup", async (request, reply): Promise<TotpSetupResponse> => {
  if (!isLocalRequest(request.ip)) {
    reply.status(403);
    return {
      available: false,
      localOnly: true,
      alreadyPaired: true,
      message: "TOTP 绑定信息只允许在本机访问。请在 Mac 本机打开 Joudo 完成首次绑定。",
    };
  }

  return {
    available: true,
    localOnly: true,
    alreadyPaired: !isNewTotpSecret,
    secret: totpSecret,
    uri: getTotpUri(totpSecret, "Joudo Bridge"),
    message: isNewTotpSecret ? "请使用验证器扫描或手动录入下面的密钥。" : "当前 TOTP 已经存在，你可以用现有密钥重新绑定本机验证器。",
  };
});

app.get("/health", async (): Promise<BridgeHealthResponse> => ({
  status: "ok",
  mode: "mvp",
  transport: "http+ws",
  timestamp: new Date().toISOString(),
}));

app.get("/api/repos", async () => ({
  repos: state.getRepos(),
}));

app.get("/api/session", async () => state.getSnapshot());

app.get("/api/repo/instruction", async () => state.getRepoInstruction());
app.get<{ Params: { checkpointNumber: string } }>("/api/session/checkpoints/:checkpointNumber", async (request, reply): Promise<SessionCheckpointDocument | null> => {
  const num = Number.parseInt(request.params.checkpointNumber, 10);
  if (!Number.isFinite(num) || num < 0) {
    void reply.status(400).send({ error: "Invalid checkpoint number" });
    return null;
  }
  return state.getSessionCheckpoint(num);
});

app.get("/api/repo/sessions", async () => state.getSessionIndex());

app.get("/api/validation/live-policy", async () => loadLivePolicyValidationReport());

app.post<{ Body: RepoInstructionUpdatePayload }>("/api/repo/instruction", {
  schema: {
    body: {
      type: "object",
      required: ["userNotes"],
      properties: { userNotes: { type: "string", maxLength: 50000 } },
      additionalProperties: false,
    },
  },
}, async (request) => {
  return state.updateRepoInstruction(request.body.userNotes);
});

app.post<{ Body: RepoInitPolicyPayload }>("/api/repo/init-policy", {
  schema: {
    body: {
      type: "object",
      properties: {
        trusted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
}, async (request): Promise<RepoInitPolicyResult> => {
  return state.initRepoPolicy(request.body ?? {});
});

app.post<{ Body: RepoPolicyRuleDeletePayload }>("/api/repo/policy/rule/delete", {
  schema: {
    body: {
      type: "object",
      required: ["field", "value"],
      properties: {
        field: { type: "string", enum: ["allowShell", "allowedPaths", "allowedWritePaths"] },
        value: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
}, async (request) => {
  return state.deleteRepoPolicyRule(request.body);
});

app.post("/api/auth/refresh", async () => state.refreshAuth());

app.post<{ Body: RepoSelectionPayload }>("/api/session/select", {
  schema: {
    body: {
      type: "object",
      required: ["repoId"],
      properties: { repoId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
}, async (request) => {
  return state.selectRepo(request.body.repoId);
});

app.post<{ Body: SessionModelSelectionPayload }>("/api/session/model", {
  schema: {
    body: {
      type: "object",
      required: ["model"],
      properties: { model: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
}, async (request) => {
  return state.setModel(request.body.model);
});

const recoverSessionSchema = {
  body: {
    type: "object",
    required: ["joudoSessionId"],
    properties: { joudoSessionId: { type: "string", minLength: 1 } },
    additionalProperties: false,
  },
} as const;

app.post<{ Body: RecoverHistoricalSessionPayload }>("/api/session/recover", {
  schema: recoverSessionSchema,
}, async (request) => {
  return state.recoverHistoricalSession(request.body.joudoSessionId);
});

app.post<{ Body: RecoverHistoricalSessionPayload }>("/api/session/resume", {
  schema: recoverSessionSchema,
}, async (request) => {
  return state.recoverHistoricalSession(request.body.joudoSessionId);
});

app.post<{ Body: PromptSubmission }>("/api/prompt", {
  schema: {
    body: {
      type: "object",
      required: ["prompt"],
      properties: {
        sessionId: { type: "string" },
        prompt: { type: "string", minLength: 1, maxLength: 100000 },
      },
      additionalProperties: false,
    },
  },
}, async (request) => {
  return state.submitPrompt(request.body.prompt);
});

app.post<{ Body: RollbackLatestTurnPayload }>("/api/session/rollback", async () => {
  return state.rollbackLatestTurn();
});

app.post<{ Body: ApprovalResolutionPayload }>("/api/approval", {
  schema: {
    body: {
      type: "object",
      required: ["approvalId", "decision"],
      properties: {
        approvalId: { type: "string", minLength: 1 },
        decision: { type: "string", enum: ["allow-once", "allow-and-persist", "deny"] },
      },
      additionalProperties: false,
    },
  },
}, async (request) => {
  return state.resolveApproval(request.body.approvalId, request.body.decision);
});

const WS_MAX_CONNECTIONS = 10;
const WS_PING_INTERVAL_MS = 30_000;
const wsConnections = new Set<{ terminate(): void }>();

app.get("/ws", { websocket: true }, (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const wsToken = url.searchParams.get("token");

  if (!wsToken || !validateSessionToken(wsToken)) {
    socket.close(4001, "Unauthorized");
    return;
  }

  if (wsConnections.size >= WS_MAX_CONNECTIONS) {
    socket.close(4008, "Too many connections");
    return;
  }

  renewSessionToken(wsToken);

  wsConnections.add(socket);
  let alive = true;

  const pingTimer = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, WS_PING_INTERVAL_MS);

  socket.on("pong", () => {
    alive = true;
  });

  const unsubscribe = state.subscribe((event) => {
    socket.send(serialize(event));
  });

  socket.on("close", () => {
    clearInterval(pingTimer);
    wsConnections.delete(socket);
    unsubscribe();
  });
});

app.setNotFoundHandler(async (_request, reply) => {
  if (SERVE_STATIC) {
    return reply.sendFile("index.html");
  }
  void reply.status(404).send({ error: { code: "unknown", message: "Not found" } });
});

try {
  await app.listen({ port, host });
  app.log.info(`Joudo bridge listening on http://${host}:${port}`);
  if (SERVE_STATIC) {
    app.log.info(`Serving web UI from ${WEB_DIST_DIR}`);
  }

  if (isNewTotpSecret) {
    printTotpQrCode(totpSecret);
  } else {
    console.log("\n[Auth] TOTP secret loaded from ~/.joudo/totp-secret");
    console.log("[Auth] Open your Authenticator app and enter the 6-digit code on the web UI.");
    console.log("[Auth] To re-pair, delete ~/.joudo/totp-secret and restart the bridge.\n");
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}