import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRepos, registerRepo, removeRepo } from "./repo-discovery.js";

test("repo discovery merges managed roots and persists hidden defaults", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "joudo-home-"));
  const primaryRepo = await mkdtemp(join(tmpdir(), "joudo-primary-"));
  const managedRepo = await mkdtemp(join(tmpdir(), "joudo-managed-"));
  const registryPath = join(await mkdtemp(join(tmpdir(), "joudo-registry-")), "repo-registry.json");

  const previousHome = process.env.HOME;
  const previousRepoRoot = process.env.JOUDO_REPO_ROOT;
  const previousExtraRepos = process.env.JOUDO_EXTRA_REPOS;
  const previousRegistryPath = process.env.JOUDO_REPO_REGISTRY_PATH;

  process.env.HOME = homeDir;
  process.env.JOUDO_REPO_ROOT = primaryRepo;
  process.env.JOUDO_EXTRA_REPOS = "";
  process.env.JOUDO_REPO_REGISTRY_PATH = registryPath;

  await mkdir(join(primaryRepo, ".github"), { recursive: true });
  await writeFile(join(primaryRepo, ".github", "joudo-policy.yml"), "version: 1\ntrusted: false\n", "utf8");
  await mkdir(join(managedRepo, ".github"), { recursive: true });
  await writeFile(join(managedRepo, ".github", "joudo-policy.yml"), "version: 1\ntrusted: false\n", "utf8");

  try {
    assert.deepEqual(buildRepos().map((repo) => repo.rootPath), [primaryRepo]);

    const addedRepo = registerRepo(managedRepo);
    assert.equal(addedRepo.rootPath, managedRepo);

    assert.deepEqual(
      buildRepos().map((repo) => repo.rootPath).sort(),
      [managedRepo, primaryRepo].sort(),
    );

    removeRepo(primaryRepo);

    assert.deepEqual(buildRepos().map((repo) => repo.rootPath), [managedRepo]);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;

    if (previousRepoRoot === undefined) delete process.env.JOUDO_REPO_ROOT;
    else process.env.JOUDO_REPO_ROOT = previousRepoRoot;

    if (previousExtraRepos === undefined) delete process.env.JOUDO_EXTRA_REPOS;
    else process.env.JOUDO_EXTRA_REPOS = previousExtraRepos;

    if (previousRegistryPath === undefined) delete process.env.JOUDO_REPO_REGISTRY_PATH;
    else process.env.JOUDO_REPO_REGISTRY_PATH = previousRegistryPath;

    await rm(homeDir, { recursive: true, force: true });
    await rm(primaryRepo, { recursive: true, force: true });
    await rm(managedRepo, { recursive: true, force: true });
    await rm(join(registryPath, ".."), { recursive: true, force: true });
  }
});

test("repo discovery does not inject workspace or demo defaults without env configuration", async () => {
  const registryPath = join(await mkdtemp(join(tmpdir(), "joudo-registry-")), "repo-registry.json");

  const previousHome = process.env.HOME;
  const previousRepoRoot = process.env.JOUDO_REPO_ROOT;
  const previousExtraRepos = process.env.JOUDO_EXTRA_REPOS;
  const previousRegistryPath = process.env.JOUDO_REPO_REGISTRY_PATH;

  delete process.env.HOME;
  delete process.env.JOUDO_REPO_ROOT;
  process.env.JOUDO_EXTRA_REPOS = "";
  process.env.JOUDO_REPO_REGISTRY_PATH = registryPath;

  try {
    assert.deepEqual(buildRepos().map((repo) => repo.rootPath), []);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;

    if (previousRepoRoot === undefined) delete process.env.JOUDO_REPO_ROOT;
    else process.env.JOUDO_REPO_ROOT = previousRepoRoot;

    if (previousExtraRepos === undefined) delete process.env.JOUDO_EXTRA_REPOS;
    else process.env.JOUDO_EXTRA_REPOS = previousExtraRepos;

    if (previousRegistryPath === undefined) delete process.env.JOUDO_REPO_REGISTRY_PATH;
    else process.env.JOUDO_REPO_REGISTRY_PATH = previousRegistryPath;

    await rm(join(registryPath, ".."), { recursive: true, force: true });
  }
});