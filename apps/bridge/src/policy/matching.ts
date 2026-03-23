import type { PermissionRequest } from "../copilot-sdk.js";

import { buildCanonicalShellCandidates } from "./shell-candidates.js";
import type { CustomToolPermissionRequest, McpPermissionRequest, PolicyAction, RepoPolicy } from "./types.js";
import { normalizeWhitespace } from "./utils.js";

function matchesCommandPattern(pattern: string, command: string): boolean {
  const normalizedPattern = normalizeWhitespace(pattern);
  const normalizedCommand = normalizeWhitespace(command);

  if (!normalizedPattern || !normalizedCommand) {
    return false;
  }

  return normalizedCommand === normalizedPattern || normalizedCommand.startsWith(`${normalizedPattern} `);
}

function matchesAnyCommandPattern(pattern: string, commands: string[]): boolean {
  return commands.some((command) => matchesCommandPattern(pattern, command));
}

function matchesToolRule(rule: string, candidates: string[]): boolean {
  const normalizedRule = rule.trim();
  return candidates.some((candidate) => candidate === normalizedRule);
}

function getToolCandidates(request: PermissionRequest): string[] {
  switch (request.kind) {
    case "mcp": {
      const mcpRequest = request as McpPermissionRequest;
      const specific = mcpRequest.serverName && mcpRequest.toolName ? [`mcp:${mcpRequest.serverName}/${mcpRequest.toolName}`] : [];
      return ["mcp", ...specific];
    }
    case "custom-tool": {
      const customRequest = request as CustomToolPermissionRequest;
      const specific = customRequest.toolName ? [`custom-tool:${customRequest.toolName}`] : [];
      return ["custom-tool", ...specific];
    }
    default:
      return [request.kind];
  }
}

export function matchToolDecision(policy: RepoPolicy, request: PermissionRequest): { action: PolicyAction; matchedRule: string } | null {
  const candidates = getToolCandidates(request);

  for (const rule of policy.denyTools) {
    if (matchesToolRule(rule, candidates)) {
      return { action: "deny", matchedRule: `deny_tools: ${rule}` };
    }
  }

  for (const rule of policy.allowTools) {
    if (matchesToolRule(rule, candidates)) {
      return { action: "allow", matchedRule: `allow_tools: ${rule}` };
    }
  }

  for (const rule of policy.confirmTools) {
    if (matchesToolRule(rule, candidates)) {
      return { action: "confirm", matchedRule: `confirm_tools: ${rule}` };
    }
  }

  return null;
}

export function matchShellDecision(policy: RepoPolicy, fullCommandText: string): { action: PolicyAction; matchedRule: string } | null {
  const candidates = buildCanonicalShellCandidates(fullCommandText);

  for (const rule of policy.denyShell) {
    if (matchesAnyCommandPattern(rule, candidates)) {
      return { action: "deny", matchedRule: `deny_shell: ${rule}` };
    }
  }

  for (const rule of policy.allowShell) {
    if (matchesAnyCommandPattern(rule, candidates)) {
      return { action: "allow", matchedRule: `allow_shell: ${rule}` };
    }
  }

  for (const rule of policy.confirmShell) {
    if (matchesAnyCommandPattern(rule, candidates)) {
      return { action: "confirm", matchedRule: `confirm_shell: ${rule}` };
    }
  }

  return null;
}

export function matchAllowedUrl(allowedUrls: string[], rawUrl: string): string | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const href = parsedUrl.href.toLowerCase();
  const origin = parsedUrl.origin.toLowerCase();

  for (const entry of allowedUrls) {
    const normalizedEntry = entry.trim().toLowerCase();
    if (!normalizedEntry) {
      continue;
    }

    if (normalizedEntry.includes("://")) {
      try {
        const allowedUrl = new URL(normalizedEntry);
        const allowedOrigin = allowedUrl.origin.toLowerCase();
        if (origin === allowedOrigin && href.startsWith(normalizedEntry)) {
          return entry;
        }
      } catch {
        continue;
      }
      continue;
    }

    if (hostname === normalizedEntry || hostname.endsWith(`.${normalizedEntry}`)) {
      return entry;
    }
  }

  return null;
}
