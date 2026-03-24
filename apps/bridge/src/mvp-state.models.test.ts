import assert from "node:assert/strict";
import { basename } from "node:path";
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
  lastSessionConfig: SessionConfig | null = null;

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

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    this.lastSessionConfig = config;
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

function createManagedRepoDescriptor(rootPath: string): RepoDescriptor {
  const name = basename(rootPath) || "managed-repo";
  return {
    id: `${name}-managed`,
    name,
    rootPath,
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

test("createMvpState can add a repo and initialize Joudo files for it", async () => {
  const baseRepo = await createRepo("joudo-base-");
  const addedRepoRoot = await mkdtemp(join(tmpdir(), "joudo-added-"));
  const addedRepo = createManagedRepoDescriptor(addedRepoRoot);

  try {
    const state = createMvpState({
      repos: [baseRepo],
      createClient: () => new ModelFakeClient(["gpt-5.4"]),
      deps: {
        registerRepo(rootPath) {
          assert.equal(rootPath, addedRepoRoot);
          return addedRepo;
        },
        removeRepo() {},
      },
    });

    try {
      await state.addRepo({
        rootPath: addedRepoRoot,
        initializePolicy: true,
        trusted: false,
      });

      assert.equal(state.getSnapshot().repo?.id, addedRepo.id);
      assert.equal(state.getRepos().some((repo) => repo.id === addedRepo.id), true);

      const policyRaw = await readFile(join(addedRepoRoot, ".github", "joudo-policy.yml"), "utf8");
      assert.match(policyRaw, /version: 1/);

      const instructionRaw = await readFile(join(addedRepoRoot, ".joudo", "repo-instructions.md"), "utf8");
      assert.match(instructionRaw, /Add repo-specific workflow notes here/);
    } finally {
      await state.dispose();
    }
  } finally {
    await rm(baseRepo.rootPath, { recursive: true, force: true });
    await rm(addedRepoRoot, { recursive: true, force: true });
  }
});

test("createMvpState can remove a managed repo without deleting its Joudo files", async () => {
  const baseRepo = await createRepo("joudo-remove-base-");
  const addedRepoRoot = await mkdtemp(join(tmpdir(), "joudo-remove-added-"));
  const addedRepo = createManagedRepoDescriptor(addedRepoRoot);
  const removedRoots: string[] = [];

  await mkdir(join(addedRepoRoot, ".github"), { recursive: true });
  await writeFile(join(addedRepoRoot, ".github", "joudo-policy.yml"), "version: 1\ntrusted: false\n", "utf8");

  try {
    const state = createMvpState({
      repos: [baseRepo, addedRepo],
      createClient: () => new ModelFakeClient(["gpt-5.4"]),
      deps: {
        registerRepo() {
          throw new Error("registerRepo should not be used in removeRepo test");
        },
        removeRepo(rootPath) {
          removedRoots.push(rootPath);
        },
      },
    });

    try {
      state.selectRepo(addedRepo.id);
      await state.removeRepo({ repoId: addedRepo.id });

      assert.deepEqual(removedRoots, [addedRepo.rootPath]);
      assert.equal(state.getSnapshot().repo?.id, baseRepo.id);
      assert.equal(state.getRepos().some((repo) => repo.id === addedRepo.id), false);

      const policyRaw = await readFile(join(addedRepoRoot, ".github", "joudo-policy.yml"), "utf8");
      assert.match(policyRaw, /version: 1/);
    } finally {
      await state.dispose();
    }
  } finally {
    await rm(baseRepo.rootPath, { recursive: true, force: true });
    await rm(addedRepoRoot, { recursive: true, force: true });
  }
});

test("createMvpState can switch the active agent for later sessions", async () => {
  const repo = await createRepo("joudo-agent-");

  try {
    const state = createMvpState({
      repos: [repo],
      createClient: () => new ModelFakeClient(["gpt-5.4"]),
    });

    try {
      const snapshot = await state.setAgent("reviewer");

      assert.equal(snapshot.agent, "reviewer");
      assert.deepEqual(snapshot.availableAgents, ["reviewer"]);

      const resetSnapshot = await state.setAgent(null);
      assert.equal(resetSnapshot.agent, null);
      assert.deepEqual(resetSnapshot.availableAgents, ["reviewer"]);
    } finally {
      await state.dispose();
    }
  } finally {
    await rm(repo.rootPath, { recursive: true, force: true });
  }
});

test("createMvpState falls back to default mode when the selected agent disappears before a prompt", async () => {
  const repo = await createRepo("joudo-agent-refresh-");
  const client = new ModelFakeClient(["gpt-5.4"]);
  let availableAgents = ["reviewer"];

  try {
    const state = createMvpState({
      repos: [repo],
      createClient: () => client,
      deps: {
        discoverAgentCatalog() {
          return {
            agents: availableAgents.map((name) => ({
              name,
              displayName: name,
              sourcePath: join(repo.rootPath, ".github", "agents", `${name}.md`),
              scope: "repo" as const,
            })),
            availableAgents,
            counts: {
              globalCount: 0,
              repoCount: availableAgents.length,
              totalCount: availableAgents.length,
            },
          };
        },
      },
    });

    try {
      await state.setAgent("reviewer");

      availableAgents = [];
      await state.submitPrompt("请检查当前仓库");

      const snapshot = state.getSnapshot();
      assert.equal(snapshot.agent, null);
      assert.deepEqual(snapshot.availableAgents, []);
      assert.equal(snapshot.agentCatalog.repoCount, 0);
      assert.equal(client.lastSessionConfig?.agent, undefined);
      assert.equal(
        snapshot.timeline.some((entry) => entry.title === "执行 agent 已自动回退"),
        true,
      );
    } finally {
      await state.dispose();
    }
  } finally {
    await rm(repo.rootPath, { recursive: true, force: true });
  }
});