import type { PolicyDecisionAction, PolicyDecisionDetails, PolicyDecisionRule, RepoDescriptor } from "@joudo/shared";

import type { PermissionRequest } from "../copilot-sdk.js";

export type PolicyAction = PolicyDecisionAction;

export type ShellPermissionRequest = PermissionRequest & {
  kind: "shell";
  fullCommandText?: string;
  intention?: string;
  commands?: Array<{
    identifier?: string;
    readOnly?: boolean;
  }>;
  possiblePaths?: string[];
  possibleUrls?: Array<{ url?: string }>;
  hasWriteFileRedirection?: boolean;
  warning?: string;
};

export type WritePermissionRequest = PermissionRequest & {
  kind: "write";
  intention?: string;
  fileName?: string;
  diff?: string;
};

export type ReadPermissionRequest = PermissionRequest & {
  kind: "read";
  intention?: string;
  path?: string;
};

export type UrlPermissionRequest = PermissionRequest & {
  kind: "url";
  intention?: string;
  url?: string;
};

export type McpPermissionRequest = PermissionRequest & {
  kind: "mcp";
  serverName?: string;
  toolName?: string;
  toolTitle?: string;
  readOnly?: boolean;
};

export type CustomToolPermissionRequest = PermissionRequest & {
  kind: "custom-tool";
  toolName?: string;
};

export interface RepoPolicy {
  version: 1;
  trusted: boolean;
  allowTools: string[];
  denyTools: string[];
  confirmTools: string[];
  allowShell: string[];
  denyShell: string[];
  confirmShell: string[];
  allowedPaths: string[];
  allowedWritePaths: string[];
  allowedUrls: string[];
}

export interface LoadedRepoPolicy {
  state: RepoDescriptor["policyState"];
  path: string | null;
  config: RepoPolicy | null;
  error: string | null;
}

export type PolicyDecision = PolicyDecisionDetails;

export interface PersistedPolicyAllowlistEntry {
  field: "allowShell" | "allowedPaths" | "allowedWritePaths";
  entry: string;
  matchedRule: string;
  note: string | null;
  policyPath: string;
  trackedPath: string;
  createdPolicy: boolean;
}
