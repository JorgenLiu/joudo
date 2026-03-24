import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type RepoRegistryDocument = {
  schemaVersion: 1;
  managedRoots: string[];
  hiddenRoots: string[];
};

const REPO_REGISTRY_SCHEMA_VERSION = 1;

function defaultRepoRegistry(): RepoRegistryDocument {
  return {
    schemaVersion: REPO_REGISTRY_SCHEMA_VERSION,
    managedRoots: [],
    hiddenRoots: [],
  };
}

function registryBaseDir(): string {
  const home = process.env.HOME ? resolve(process.env.HOME) : null;
  if (process.env.JOUDO_REPO_REGISTRY_PATH) {
    return dirname(resolve(process.env.JOUDO_REPO_REGISTRY_PATH));
  }
  if (process.platform === "darwin" && home) {
    return join(home, "Library", "Application Support", "Joudo");
  }
  if (process.env.XDG_STATE_HOME) {
    return join(resolve(process.env.XDG_STATE_HOME), "joudo");
  }
  if (home) {
    return join(home, ".joudo");
  }
  return resolve(".joudo");
}

export function getRepoRegistryPath(): string {
  if (process.env.JOUDO_REPO_REGISTRY_PATH) {
    return resolve(process.env.JOUDO_REPO_REGISTRY_PATH);
  }
  return join(registryBaseDir(), "repo-registry.json");
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath);
}

export function loadRepoRegistry(): RepoRegistryDocument {
  const targetPath = getRepoRegistryPath();
  if (!existsSync(targetPath)) {
    return defaultRepoRegistry();
  }

  try {
    const parsed = JSON.parse(readFileSync(targetPath, "utf8")) as Partial<RepoRegistryDocument>;
    const managedRoots = Array.isArray(parsed.managedRoots)
      ? parsed.managedRoots.filter((entry): entry is string => typeof entry === "string").map(normalizeRootPath)
      : [];
    const hiddenRoots = Array.isArray(parsed.hiddenRoots)
      ? parsed.hiddenRoots.filter((entry): entry is string => typeof entry === "string").map(normalizeRootPath)
      : [];

    return {
      schemaVersion: REPO_REGISTRY_SCHEMA_VERSION,
      managedRoots: Array.from(new Set(managedRoots)),
      hiddenRoots: Array.from(new Set(hiddenRoots)),
    };
  } catch {
    return defaultRepoRegistry();
  }
}

function saveRepoRegistry(document: RepoRegistryDocument) {
  const targetPath = getRepoRegistryPath();
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function updateRepoRegistry(mutator: (document: RepoRegistryDocument) => RepoRegistryDocument) {
  const nextDocument = mutator(loadRepoRegistry());
  saveRepoRegistry({
    schemaVersion: REPO_REGISTRY_SCHEMA_VERSION,
    managedRoots: Array.from(new Set(nextDocument.managedRoots.map(normalizeRootPath))),
    hiddenRoots: Array.from(new Set(nextDocument.hiddenRoots.map(normalizeRootPath))),
  });
}

export function registerManagedRepoRoot(rootPath: string) {
  const normalizedRoot = normalizeRootPath(rootPath);
  updateRepoRegistry((document) => ({
    ...document,
    managedRoots: [...document.managedRoots.filter((entry) => entry !== normalizedRoot), normalizedRoot],
    hiddenRoots: document.hiddenRoots.filter((entry) => entry !== normalizedRoot),
  }));
}

export function hideRepoRoot(rootPath: string) {
  const normalizedRoot = normalizeRootPath(rootPath);
  updateRepoRegistry((document) => ({
    ...document,
    managedRoots: document.managedRoots.filter((entry) => entry !== normalizedRoot),
    hiddenRoots: [...document.hiddenRoots.filter((entry) => entry !== normalizedRoot), normalizedRoot],
  }));
}

export function unhideRepoRoot(rootPath: string) {
  const normalizedRoot = normalizeRootPath(rootPath);
  updateRepoRegistry((document) => ({
    ...document,
    hiddenRoots: document.hiddenRoots.filter((entry) => entry !== normalizedRoot),
  }));
}