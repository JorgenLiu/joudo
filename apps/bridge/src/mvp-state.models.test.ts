import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RepoDescriptor } from "@joudo/shared";

import type { CopilotSession, SessionConfig } from "./copilot-sdk.js";
import { createMvpState } from "./mvp-state.js";

class ModelFakeSession {
  readonly sessionId = "model-session";

  readonly rpc = {
    permissions: {
      handlePendingPermissionRequest: async () => ({ kind: "handled" }) as never,
    },
  } as unknown as CopilotSession["rpc"];

  on() {
    return () => undefined;
  }

  async disconnect() {}

  async getMessages() {
    return [];
  }

  async sendAndWait() {
    return null as never;
  }
}

class ModelFakeClient {
  constructor(private readonly models: string[]) {}

  async start() {}

  async stop() {}

  async getAuthStatus() {
    return {
      isAuthenticated: true,
      statusMessage: "authenticated",
    };
  }

  async listModels() {
    return this.models.map((id) => ({ id }));
  }

  async createSession(_config: SessionConfig): Promise<CopilotSession> {
    return new ModelFakeSession() as unknown as CopilotSession;
  }

  async resumeSession(): Promise<CopilotSession> {
    throw new Error("resumeSession should not be used in model tests");
  }

  async listSessions() {
    return [];
  }
}

async function createRepo(rootName: string): Promise<RepoDescriptor> {
  const repoRoot = await mkdtemp(join(tmpdir(), rootName));
  await mkdir(join(repoRoot, ".github"), { recursive: true });
  await writeFile(join(repoRoot, ".github", "joudo-policy.yml"), "version: 1\ntrusted: true\n", "utf8");

  return {
    id: rootName,
    name: rootName,
    rootPath: repoRoot,
    trusted: true,
    policyState: "missing",
  };
}

async function createRepoWithoutPolicy(rootName: string): Promise<RepoDescriptor> {
  const repoRoot = await mkdtemp(join(tmpdir(), rootName));
  await mkdir(join(repoRoot, ".github"), { recursive: true });

  return {
    id: rootName,
    name: rootName,
    rootPath: repoRoot,
    trusted: false,
    policyState: "missing",
  };
}

test("createMvpState prefers runtime-discovered models over static defaults", async () => {
  const repo = await createRepo("joudo-models-");

  try {
    const state = createMvpState({
      repos: [repo],
      createClient: () => new ModelFakeClient(["gpt-5.4", "gpt-5.5"]),
    });

    try {
      await state.refreshAuth();
      assert.deepEqual(state.getSnapshot().availableModels, ["gpt-5-mini", "gpt-5.4", "gpt-5.5"]);
    } finally {
      await state.dispose();
    }
  } finally {
    await rm(repo.rootPath, { recursive: true, force: true });
  }
});

test("createMvpState initializes repo policy, instruction, and session index for the current repo", async () => {
  const repo = await createRepoWithoutPolicy("joudo-init-");

  try {
    const state = createMvpState({
      repos: [repo],
      createClient: () => new ModelFakeClient(["gpt-5.4"]),
    });

    try {
      const result = await state.initRepoPolicy();

      assert.equal(result.createdPolicy, true);
      assert.equal(result.createdInstruction, true);
      assert.equal(result.createdSessionIndex, true);

      const policyRaw = await readFile(join(repo.rootPath, ".github", "joudo-policy.yml"), "utf8");
      assert.match(policyRaw, /version: 1/);
      assert.match(policyRaw, /allowed_paths:/);

      const instructionRaw = await readFile(join(repo.rootPath, ".joudo", "repo-instructions.md"), "utf8");
      assert.match(instructionRaw, /Add repo-specific workflow notes here/);

      const sessionIndexRaw = await readFile(join(repo.rootPath, ".joudo", "sessions-index.json"), "utf8");
      assert.match(sessionIndexRaw, /"schemaVersion": 1/);

      assert.equal(state.getSnapshot().policy?.state, "loaded");
      assert.equal(result.repoInstruction.exists, true);
    } finally {
      await state.dispose();
    }
  } finally {
    await rm(repo.rootPath, { recursive: true, force: true });
  }
});