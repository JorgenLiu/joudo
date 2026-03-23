import type { PermissionAuditEntry, PermissionResolution } from "@joudo/shared";

import type { PermissionRequest } from "../copilot-sdk.js";
import type { PolicyDecision } from "../policy/index.js";

export function getRequestTarget(request: PermissionRequest): string {
  switch (request.kind) {
    case "shell":
      return typeof request.fullCommandText === "string" ? request.fullCommandText : "shell command";
    case "write":
      return typeof request.fileName === "string" ? request.fileName : "write";
    case "read":
      return typeof request.path === "string" ? request.path : "read";
    case "url":
      return typeof request.url === "string" ? request.url : "url";
    case "mcp":
      return `${typeof request.serverName === "string" ? request.serverName : "unknown"}/${typeof request.toolName === "string" ? request.toolName : typeof request.toolTitle === "string" ? request.toolTitle : "tool"}`;
    case "custom-tool":
      return typeof request.toolName === "string" ? request.toolName : "custom-tool";
    default:
      return request.kind;
  }
}

export function createAuditEntry(request: PermissionRequest, decision: PolicyDecision, resolution: PermissionResolution): PermissionAuditEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    requestKind: request.kind,
    target: getRequestTarget(request),
    requestedAt: new Date().toISOString(),
    resolution,
    decision,
  };
}

export function decisionBody(target: string, decision: PolicyDecision): string {
  return decision.matchedRule ? `${target} / ${decision.reason} / ${decision.matchedRule}` : `${target} / ${decision.reason}`;
}