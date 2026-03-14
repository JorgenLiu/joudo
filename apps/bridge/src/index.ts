import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type {
  ApprovalResolutionPayload,
  BridgeHealthResponse,
  PromptSubmission,
  RepoSelectionPayload,
  ServerEvent,
} from "@joudo/shared";

import { createMvpState } from "./mvp-state.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });
const state = createMvpState();

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

await app.register(cors, {
  origin: true,
});

await app.register(websocket);

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

app.post("/api/auth/refresh", async () => state.refreshAuth());

app.post<{ Body: RepoSelectionPayload }>("/api/session/select", async (request) => {
  return state.selectRepo(request.body.repoId);
});

app.post<{ Body: PromptSubmission }>("/api/prompt", async (request) => {
  return state.submitPrompt(request.body.prompt);
});

app.post<{ Body: ApprovalResolutionPayload }>("/api/approval", async (request) => {
  return state.resolveApproval(request.body.approvalId, request.body.decision);
});

app.get("/ws", { websocket: true }, (socket) => {
  const unsubscribe = state.subscribe((event) => {
    socket.send(serialize(event));
  });

  socket.on("close", () => {
    unsubscribe();
  });
});

try {
  await app.listen({ port, host });
  app.log.info(`Joudo bridge listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}