import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluatePermissionRequest, loadRepoPolicy, persistApprovalToPolicy, removePolicyRule } from "./policy/index.js";
import type { LoadedRepoPolicy } from "./policy/index.js";

const FIXTURE_ROOT = fileURLToPath(new URL("./__fixtures__/", import.meta.url));
const VALID_REPO_ROOT = fileURLToPath(new URL("./__fixtures__/repo-valid/", import.meta.url));
const INVALID_REPO_ROOT = fileURLToPath(new URL("./__fixtures__/repo-invalid/", import.meta.url));

function createLoadedPolicy(repoRoot: string): LoadedRepoPolicy {
  return {
    state: "loaded",
    path: join(repoRoot, ".github", "joudo-policy.yml"),
    config: {
      version: 1,
      trusted: true,
      allowTools: ["write"],
      denyTools: [],
      confirmTools: [],
      allowShell: [],
      denyShell: [],
      confirmShell: [],
      allowedPaths: ["./src"],
      allowedWritePaths: [],
      allowedUrls: [],
    },
    error: null,
  };
}

test("loadRepoPolicy parses a valid fixture policy", () => {
  const result = loadRepoPolicy(VALID_REPO_ROOT);

  assert.equal(result.state, "loaded");
  assert.ok(result.path);
  assert.equal(result.config?.version, 1);
  assert.deepEqual(result.config?.allowTools, ["write"]);
  assert.deepEqual(result.config?.confirmShell, ["pnpm add"]);
  assert.deepEqual(result.config?.allowedPaths, [".", "./src", "./tests"]);
  assert.deepEqual(result.config?.allowedWritePaths, []);
  assert.deepEqual(result.config?.allowedUrls, ["github.com", "api.github.com"]);
});

test("loadRepoPolicy reports invalid fixture policy", () => {
  const result = loadRepoPolicy(INVALID_REPO_ROOT);

  assert.equal(result.state, "invalid");
  assert.ok(result.path);
  assert.match(result.error ?? "", /allow_tools 必须是字符串数组/);
});

test("evaluatePermissionRequest allows repo-local read-only shell without a valid policy", () => {
  const decision = evaluatePermissionRequest(
    { state: "missing", path: null, config: null, error: null },
    FIXTURE_ROOT,
    {
      kind: "shell",
      fullCommandText: "rg policy src",
      commands: [{ identifier: "rg", readOnly: true }],
      possiblePaths: ["src"],
      possibleUrls: [],
      hasWriteFileRedirection: false,
    },
  );

  assert.equal(decision.action, "allow");
  assert.match(decision.reason, /只读探索/);
});

test("evaluatePermissionRequest denies dangerous shell via explicit policy rule", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "git push origin main",
    commands: [{ identifier: "git", readOnly: false }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "deny");
  assert.equal(decision.matchedRule, "deny_shell: git push");
});

test("evaluatePermissionRequest allows ACP git status variants via canonical git signature", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "git --no-pager status --porcelain -b",
    commands: [{ identifier: "git", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: git status");
});

test("evaluatePermissionRequest denies ACP git push variants with leading git options", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "git -c color.ui=always push origin main",
    commands: [{ identifier: "git", readOnly: false }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "deny");
  assert.equal(decision.matchedRule, "deny_shell: git push");
});

test("evaluatePermissionRequest normalizes python -V to the version allow rule", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "python3 -V",
    commands: [{ identifier: "python3", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: python3 --version");
});

test("evaluatePermissionRequest allows ACP git diff variants via canonical git subcommand", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "git --no-pager diff --stat",
    commands: [{ identifier: "git", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: git diff");
});

test("evaluatePermissionRequest canonicalizes pnpm filtered lint commands", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "pnpm --filter @joudo/web lint",
    commands: [{ identifier: "pnpm", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: pnpm lint");
});

test("evaluatePermissionRequest canonicalizes npm run typecheck commands with prefix options", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "npm --prefix apps/web run typecheck",
    commands: [{ identifier: "npm", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: npm run typecheck");
});

test("evaluatePermissionRequest canonicalizes python module pytest commands", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "python3 -m pytest -q",
    commands: [{ identifier: "python3", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: python3 -m pytest");
});

test("evaluatePermissionRequest canonicalizes tsc noEmit validation commands", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "tsc -p tsconfig.json --noEmit",
    commands: [{ identifier: "tsc", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_shell: tsc --noEmit");
});

test("evaluatePermissionRequest allows writes inside allowed paths when write tool is allowlisted", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "write",
    fileName: "src/example.ts",
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allow_tools: write");
});

test("evaluatePermissionRequest allows writes inside allowed_write_paths without global write allow", () => {
  const policy: LoadedRepoPolicy = {
    state: "loaded",
    path: join(VALID_REPO_ROOT, ".github", "joudo-policy.yml"),
    config: {
      version: 1,
      trusted: true,
      allowTools: [],
      denyTools: [],
      confirmTools: [],
      allowShell: [],
      denyShell: [],
      confirmShell: [],
      allowedPaths: ["."],
      allowedWritePaths: ["./src/generated"],
      allowedUrls: [],
    },
    error: null,
  };

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "write",
    fileName: "src/generated/routes.ts",
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.matchedRule, "allowed_write_paths");
});

test("evaluatePermissionRequest requests confirmation for reads outside allowed paths", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "read",
    path: "../private-notes.md",
  });

  assert.equal(decision.action, "confirm");
  assert.equal(decision.matchedRule, "allowed_paths");
});

test("evaluatePermissionRequest denies URLs outside the allowlist", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "url",
    url: "https://example.com/data.json",
  });

  assert.equal(decision.action, "deny");
  assert.equal(decision.matchedRule, "allowed_urls");
});

test("evaluatePermissionRequest denies writes through symlinked allowed paths even when the target file does not exist", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-repo-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "joudo-policy-outside-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await symlink(outsideRoot, join(repoRoot, "src"));

    const decision = evaluatePermissionRequest(createLoadedPolicy(repoRoot), repoRoot, {
      kind: "write",
      fileName: "src/generated/new-file.ts",
    });

    assert.equal(decision.action, "deny");
    assert.equal(decision.matchedRule, "allowed_paths");
    assert.match(decision.reason, /超出了当前仓库/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("evaluatePermissionRequest requests confirmation for reads that escape through a symlinked allowed path", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-repo-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "joudo-policy-outside-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await symlink(outsideRoot, join(repoRoot, "src"));

    const decision = evaluatePermissionRequest(createLoadedPolicy(repoRoot), repoRoot, {
      kind: "read",
      path: "src/secret.txt",
    });

    assert.equal(decision.action, "confirm");
    assert.equal(decision.matchedRule, "allowed_paths");
    assert.match(decision.reason, /超出了当前仓库/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("evaluatePermissionRequest requests confirmation for read-only shell paths that escape through a symlinked allowed path", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-repo-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "joudo-policy-outside-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await symlink(outsideRoot, join(repoRoot, "src"));

    const decision = evaluatePermissionRequest(createLoadedPolicy(repoRoot), repoRoot, {
      kind: "shell",
      fullCommandText: "rg secret src/missing.txt",
      commands: [{ identifier: "rg", readOnly: true }],
      possiblePaths: ["src/missing.txt"],
      possibleUrls: [],
      hasWriteFileRedirection: false,
    });

    assert.equal(decision.action, "confirm");
    assert.equal(decision.matchedRule, "allowed_paths");
    assert.match(decision.reason, /当前仓库外的路径/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("persistApprovalToPolicy appends canonical shell allow rules", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-persist-shell-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await rm(join(repoRoot, ".github", "joudo-policy.yml"), { force: true });

    const persisted = persistApprovalToPolicy(
      repoRoot,
      { state: "missing", path: null, config: null, error: null },
      {
        kind: "shell",
        fullCommandText: "git --no-pager status --short",
        commands: [{ identifier: "git", readOnly: true }],
      },
    );

    assert.equal(persisted.added, true);
    assert.equal(persisted.entry.field, "allowShell");
    assert.equal(persisted.entry.entry, "git status");
    assert.equal(persisted.entry.matchedRule, "allow_shell: git status");
    assert.equal(persisted.policy.state, "loaded");
    assert.deepEqual(persisted.policy.config?.allowShell, ["git status"]);
    assert.deepEqual(persisted.policy.config?.allowedPaths, ["."]);

    const rawPolicy = await readFile(join(repoRoot, ".github", "joudo-policy.yml"), "utf8");
    assert.match(rawPolicy, /allow_shell:\n  - git status/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("persistApprovalToPolicy appends normalized path allow rules", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-persist-path-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await mkdir(join(repoRoot, "docs", "guides"), { recursive: true });
    await rm(join(repoRoot, ".github", "joudo-policy.yml"), { force: true });

    const loadedPolicy: LoadedRepoPolicy = {
      state: "loaded",
      path: join(repoRoot, ".github", "joudo-policy.yml"),
      config: {
        version: 1,
        trusted: true,
        allowTools: [],
        denyTools: [],
        confirmTools: [],
        allowShell: [],
        denyShell: [],
        confirmShell: [],
        allowedPaths: ["."],
        allowedWritePaths: [],
        allowedUrls: [],
      },
      error: null,
    };

    const persisted = persistApprovalToPolicy(repoRoot, loadedPolicy, {
      kind: "read",
      path: "docs/guides",
    });

    assert.equal(persisted.added, true);
    assert.equal(persisted.entry.field, "allowedPaths");
    assert.equal(persisted.entry.entry, "./docs/guides");
    assert.equal(persisted.entry.matchedRule, "allowed_paths: ./docs/guides");
    assert.deepEqual(persisted.policy.config?.allowedPaths, [".", "./docs/guides"]);

    const duplicate = persistApprovalToPolicy(repoRoot, persisted.policy, {
      kind: "read",
      path: "./docs/guides",
    });

    assert.equal(duplicate.added, false);
    assert.deepEqual(duplicate.policy.config?.allowedPaths, [".", "./docs/guides"]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("persistApprovalToPolicy appends write allow rules for a single file", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-persist-write-file-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await mkdir(join(repoRoot, "src"), { recursive: true });

    const persisted = persistApprovalToPolicy(
      repoRoot,
      { state: "missing", path: null, config: null, error: null },
      {
        kind: "write",
        fileName: "src/index.ts",
      },
    );

    assert.equal(persisted.added, true);
    assert.equal(persisted.entry.field, "allowedWritePaths");
    assert.equal(persisted.entry.entry, "./src/index.ts");
    assert.equal(persisted.entry.matchedRule, "allowed_write_paths: ./src/index.ts");
    assert.deepEqual(persisted.policy.config?.allowedWritePaths, ["./src/index.ts"]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("persistApprovalToPolicy folds generated writes into a generated directory allow rule", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-persist-write-generated-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });
    await mkdir(join(repoRoot, "src", "generated"), { recursive: true });

    const persisted = persistApprovalToPolicy(
      repoRoot,
      { state: "missing", path: null, config: null, error: null },
      {
        kind: "write",
        fileName: "src/generated/routes.ts",
      },
    );

    assert.equal(persisted.added, true);
    assert.equal(persisted.entry.field, "allowedWritePaths");
    assert.equal(persisted.entry.entry, "./src/generated");
    assert.equal(persisted.entry.matchedRule, "allowed_write_paths: ./src/generated");
    assert.deepEqual(persisted.policy.config?.allowedWritePaths, ["./src/generated"]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("removePolicyRule deletes an existing allow_shell rule", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-remove-shell-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });

    const persisted = persistApprovalToPolicy(
      repoRoot,
      { state: "missing", path: null, config: null, error: null },
      {
        kind: "shell",
        fullCommandText: "git --no-pager status --short",
        commands: [{ identifier: "git", readOnly: true }],
      },
    );

    const removed = removePolicyRule(repoRoot, persisted.policy, "allowShell", "git status");

    assert.equal(removed.removed, true);
    assert.deepEqual(removed.policy.config?.allowShell, []);

    const rawPolicy = await readFile(join(repoRoot, ".github", "joudo-policy.yml"), "utf8");
    assert.doesNotMatch(rawPolicy, /git status/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("removePolicyRule reports no-op when the target rule does not exist", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-policy-remove-missing-"));

  try {
    await mkdir(join(repoRoot, ".github"), { recursive: true });

    const persisted = persistApprovalToPolicy(
      repoRoot,
      { state: "missing", path: null, config: null, error: null },
      {
        kind: "write",
        fileName: "src/generated/routes.ts",
      },
    );

    const removed = removePolicyRule(repoRoot, persisted.policy, "allowedWritePaths", "./src/other.ts");

    assert.equal(removed.removed, false);
    assert.deepEqual(removed.policy.config?.allowedWritePaths, ["./src/generated"]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("evaluatePermissionRequest forces confirm for pipe command even with allow rule", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "git status | grep modified",
    commands: [{ identifier: "git", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "confirm");
  assert.match(decision.reason, /管道或链式操作符/);
});

test("evaluatePermissionRequest forces confirm for && chain command", () => {
  const policy = loadRepoPolicy(VALID_REPO_ROOT);
  assert.equal(policy.state, "loaded");

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "pnpm lint && pnpm test",
    commands: [{ identifier: "pnpm", readOnly: true }],
    possiblePaths: ["."],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "confirm");
  assert.match(decision.reason, /管道或链式操作符/);
});

test("evaluatePermissionRequest forces confirm for semicolon-chained commands", () => {
  const policy = createLoadedPolicy(VALID_REPO_ROOT);

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "echo hello; rm -rf /",
    commands: [{ identifier: "echo", readOnly: true }],
    possiblePaths: [],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.equal(decision.action, "confirm");
  assert.match(decision.reason, /管道或链式操作符/);
});

test("evaluatePermissionRequest ignores pipe characters inside quotes", () => {
  const policy = createLoadedPolicy(VALID_REPO_ROOT);

  const decision = evaluatePermissionRequest(policy, VALID_REPO_ROOT, {
    kind: "shell",
    fullCommandText: "grep 'a|b' src/file.ts",
    commands: [{ identifier: "grep", readOnly: true }],
    possiblePaths: ["src/file.ts"],
    possibleUrls: [],
    hasWriteFileRedirection: false,
  });

  assert.notEqual(decision.action, "deny");
  assert.ok(!decision.reason.includes("管道或链式操作符"));
});