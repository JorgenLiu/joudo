import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

import type { SessionAgentCatalog } from "@joudo/shared";

export type DiscoveredAgent = {
  name: string;
  displayName: string;
  sourcePath: string;
  scope: "global" | "repo";
};

export type DiscoveredAgentCatalog = {
  agents: DiscoveredAgent[];
  availableAgents: string[];
  counts: SessionAgentCatalog;
};

const EMPTY_AGENT_CATALOG: SessionAgentCatalog = {
  globalCount: 0,
  repoCount: 0,
  totalCount: 0,
};

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

function defaultCopilotConfigDir(): string {
  return process.env.COPILOT_CONFIG_DIR?.trim() || join(homedir(), ".copilot");
}

function normalizeAgentName(filePath: string, rawName: string | null): string {
  const candidate = rawName?.trim();
  if (candidate) {
    return candidate;
  }

  const fileName = basename(filePath);
  return fileName.replace(/\.agent\.(md|markdown|mdx)$/i, "").replace(/\.(md|markdown|mdx)$/i, "");
}

function extractFrontmatterValue(frontmatter: string, keys: string[]): string | null {
  for (const key of keys) {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
    if (match?.[1]) {
      return match[1].trim().replace(/^['\"]|['\"]$/g, "");
    }
  }

  return null;
}

function parseAgentFile(filePath: string, scope: "global" | "repo"): DiscoveredAgent | null {
  const extension = extname(filePath).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(extension)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
    const frontmatter = frontmatterMatch?.[1] ?? "";
    const name = normalizeAgentName(filePath, extractFrontmatterValue(frontmatter, ["name"]));
    if (!name) {
      return null;
    }

    const displayName = extractFrontmatterValue(frontmatter, ["displayName", "display-name", "title"]) ?? name;

    return {
      name,
      displayName,
      sourcePath: filePath,
      scope,
    };
  } catch {
    return null;
  }
}

function collectAgentFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let children: string[] = [];
    try {
      children = readdirSync(currentDir);
    } catch {
      continue;
    }

    for (const child of children) {
      const childPath = join(currentDir, child);
      let stats;
      try {
        stats = statSync(childPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        queue.push(childPath);
        continue;
      }

      results.push(childPath);
    }
  }

  return results;
}

function collectAgentsFromDir(rootDir: string, scope: "global" | "repo"): DiscoveredAgent[] {
  return collectAgentFiles(rootDir)
    .map((filePath) => parseAgentFile(filePath, scope))
    .filter((agent): agent is DiscoveredAgent => agent !== null);
}

export function emptyAgentCatalog(): DiscoveredAgentCatalog {
  return {
    agents: [],
    availableAgents: [],
    counts: EMPTY_AGENT_CATALOG,
  };
}

export function discoverAgentCatalog(repoRoot: string): DiscoveredAgentCatalog {
  const globalAgents = collectAgentsFromDir(join(defaultCopilotConfigDir(), "agents"), "global");
  const repoAgents = collectAgentsFromDir(join(repoRoot, ".github", "agents"), "repo");

  const merged = new Map<string, DiscoveredAgent>();
  for (const agent of globalAgents) {
    if (!merged.has(agent.name)) {
      merged.set(agent.name, agent);
    }
  }
  for (const agent of repoAgents) {
    merged.set(agent.name, agent);
  }

  const agents = Array.from(merged.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
  return {
    agents,
    availableAgents: agents.map((agent) => agent.name),
    counts: {
      globalCount: globalAgents.length,
      repoCount: repoAgents.length,
      totalCount: agents.length,
    },
  };
}