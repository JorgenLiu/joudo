import type {
  CopilotAuthState,
  PermissionAuditEntry,
  PersistedSessionStatus,
  RepoPolicyRule,
  RepoPolicyRuleField,
  RepoPolicySnapshot,
  SessionIndexDocument,
  SessionSnapshot,
  SessionStatus,
  SessionTimelineEntry,
} from "@joudo/shared";

import {
  createSessionActivity,
} from "./activity.js";
import {
  createSessionIndexEntry,
  loadSessionIndex,
  pruneSessionHistory,
  removeOrphanedSessionDirs,
  saveSessionIndex,
  saveSessionSnapshot,
  upsertSessionIndexEntry,
} from "./persistence.js";
import { serializeTurnWriteJournal } from "./turn-write-journal.js";
import type { RepoContext } from "./types.js";

const PRUNE_THROTTLE_MS = 10 * 60 * 1000; // run pruning at most once per 10 minutes per repo
const lastPruneTimestamps = new Map<string, number>();

function matchedRuleForField(field: RepoPolicyRuleField, value: string) {
  switch (field) {
    case "allowShell":
      return `allow_shell: ${value}`;
    case "allowedWritePaths":
      return `allowed_write_paths: ${value}`;
    case "allowedPaths":
    default:
      return `allowed_paths: ${value}`;
  }
}

function riskForField(field: RepoPolicyRuleField): RepoPolicyRule["risk"] {
  switch (field) {
    case "allowedWritePaths":
      return "high";
    case "allowShell":
      return "medium";
    case "allowedPaths":
    default:
      return "low";
  }
}

function buildPersistedRuleMetadata(timeline: SessionTimelineEntry[]) {
  const metadata = new Map<string, Pick<RepoPolicyRule, "source" | "note" | "lastUpdatedAt" | "isPersistedFromApproval">>();

  for (const entry of timeline) {
    if (entry.kind !== "approval-resolved" || entry.decision?.persistedToPolicy !== true) {
      continue;
    }

    const field = entry.decision.persistedField;
    const value = entry.decision.persistedValue;
    if (!field || !value) {
      continue;
    }

    const key = `${field}:${value}`;
    if (metadata.has(key)) {
      continue;
    }

    metadata.set(key, {
      source: "approval-persisted",
      note: entry.decision.persistedNote ?? null,
      lastUpdatedAt: entry.timestamp,
      isPersistedFromApproval: true,
    });
  }

  return metadata;
}

function buildPolicyRules(context: RepoContext): RepoPolicyRule[] {
  const persistedMetadata = buildPersistedRuleMetadata(context.timeline);
  const config = context.policy.config;
  const rawRules: Array<{ field: RepoPolicyRuleField; values: string[] }> = [
    { field: "allowedWritePaths", values: config?.allowedWritePaths ?? [] },
    { field: "allowShell", values: config?.allowShell ?? [] },
    { field: "allowedPaths", values: config?.allowedPaths ?? [] },
  ];

  return rawRules.flatMap(({ field, values }) =>
    values.map((value) => {
      const metadata = persistedMetadata.get(`${field}:${value}`);

      return {
        id: `${field}:${value}`,
        field,
        value,
        matchedRule: matchedRuleForField(field, value),
        source: metadata?.source ?? "policy-file",
        risk: riskForField(field),
        note: metadata?.note ?? null,
        lastUpdatedAt: metadata?.lastUpdatedAt ?? null,
        isPersistedFromApproval: metadata?.isPersistedFromApproval ?? false,
      } satisfies RepoPolicyRule;
    }),
  );
}

function snapshotPolicyForContext(context: RepoContext | null): RepoPolicySnapshot | null {
  if (!context) {
    return null;
  }

  return {
    state: context.policy.state,
    path: context.policy.path,
    allowShell: context.policy.config?.allowShell ?? [],
    confirmShell: context.policy.config?.confirmShell ?? [],
    denyShell: context.policy.config?.denyShell ?? [],
    allowTools: context.policy.config?.allowTools ?? [],
    confirmTools: context.policy.config?.confirmTools ?? [],
    denyTools: context.policy.config?.denyTools ?? [],
    allowedPaths: context.policy.config?.allowedPaths ?? [],
    allowedWritePaths: context.policy.config?.allowedWritePaths ?? [],
    allowedUrls: context.policy.config?.allowedUrls ?? [],
    rules: buildPolicyRules(context),
    error: context.policy.error,
  };
}

export function nextJoudoSessionId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `joudo-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export function snapshotForContext(
  context: RepoContext | null,
  authState: CopilotAuthState,
  availableModels: string[],
  defaultModel: string,
  statusOverride?: SessionStatus | PersistedSessionStatus,
): SessionSnapshot {
  return {
    sessionId: context?.lifecycle.session?.sessionId ?? "pending-session",
    status: (statusOverride && statusOverride !== "interrupted" ? statusOverride : context?.status) ?? "disconnected",
    repo: context?.repo ?? null,
    policy: snapshotPolicyForContext(context),
    model: context?.currentModel ?? defaultModel,
    availableModels,
    agent: context?.currentAgent ?? null,
    availableAgents: context?.availableAgents ?? [],
    agentCatalog: context?.agentCatalog ?? { globalCount: 0, repoCount: 0, totalCount: 0 },
    auth: authState,
    lastPrompt: context?.lastPrompt ?? null,
    approvals: context?.approvalState.approvals ?? [],
    timeline: context?.timeline ?? [],
    auditLog: context?.auditLog ?? [],
    activity: createSessionActivity(context),
    summary: context?.summary ?? null,
    updatedAt: context?.updatedAt ?? new Date().toISOString(),
  };
}

export function touch(context: RepoContext, nextStatus: SessionStatus) {
  context.status = nextStatus;
  context.updatedAt = new Date().toISOString();
}

export function pushTimelineEntry(
  context: RepoContext,
  entry: Omit<SessionTimelineEntry, "id" | "timestamp"> & { timestamp?: string },
  timelineLimit: number,
) {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  context.timeline = [
    {
      id: `${entry.kind}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      ...entry,
    },
    ...context.timeline,
  ].slice(0, timelineLimit);
  context.updatedAt = timestamp;
}

export function appendAuditEntry(context: RepoContext, entry: PermissionAuditEntry, auditLogLimit: number) {
  context.auditLog = [entry, ...context.auditLog].slice(0, auditLogLimit);
}

export function updateAuditEntry(context: RepoContext, auditId: string, update: Partial<PermissionAuditEntry>) {
  context.auditLog = context.auditLog.map((entry) => (entry.id === auditId ? { ...entry, ...update } : entry));
}

export function ensureJoudoSession(context: RepoContext) {
  if (!context.lifecycle.joudoSessionId) {
    context.lifecycle.joudoSessionId = nextJoudoSessionId();
    context.lifecycle.joudoSessionCreatedAt = new Date().toISOString();
    context.turns.turnCount = 0;
  }
}

const PERSISTENCE_MAX_RETRIES = 2;
const PERSISTENCE_RETRY_DELAY_MS = 200;

export function queuePersistence(
  context: RepoContext,
  deps: {
    sessionIndices: Map<string, SessionIndexDocument>;
    persistenceQueues: Map<string, Promise<void>>;
    authState: CopilotAuthState;
    availableModels: string[];
    defaultModel: string;
    onPersistenceError?: (repoId: string, error: unknown) => void;
  },
  options?: { statusOverride?: PersistedSessionStatus; currentSessionId?: string | null },
) {
  if (!context.lifecycle.joudoSessionId || !context.lifecycle.joudoSessionCreatedAt) {
    return;
  }

  const status = options?.statusOverride ?? context.status;
  const entry = createSessionIndexEntry({
    id: context.lifecycle.joudoSessionId,
    createdAt: context.lifecycle.joudoSessionCreatedAt,
    updatedAt: context.updatedAt,
    status,
    turnCount: context.turns.turnCount,
    lastPrompt: context.lastPrompt,
    summaryTitle: context.summary?.title ?? null,
    summaryBody: context.summary?.body ?? null,
    hasPendingApprovals: context.approvalState.approvals.length > 0,
    lastKnownCopilotSessionId: context.lifecycle.lastKnownCopilotSessionId,
  });
  const currentIndex = deps.sessionIndices.get(context.repo.id) ?? loadSessionIndex(context.repo);
  const nextIndex = upsertSessionIndexEntry(currentIndex, entry, options?.currentSessionId ?? context.lifecycle.joudoSessionId);
  deps.sessionIndices.set(context.repo.id, nextIndex);

  async function persistWithRetry() {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PERSISTENCE_MAX_RETRIES; attempt++) {
      try {
        await saveSessionSnapshot({
          repoRoot: context.repo.rootPath,
          sessionId: context.lifecycle.joudoSessionId!,
          createdAt: context.lifecycle.joudoSessionCreatedAt!,
          lastKnownCopilotSessionId: context.lifecycle.lastKnownCopilotSessionId,
          latestTurnWriteJournal: serializeTurnWriteJournal(context.turns.latestTurnWriteJournal),
          snapshot: stripRuntimeOnlyAgentState(snapshotForContext(context, deps.authState, deps.availableModels, deps.defaultModel, status)),
        });
        await saveSessionIndex(context.repo.rootPath, nextIndex);
        return; // success
      } catch (error) {
        lastError = error;
        if (attempt < PERSISTENCE_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, PERSISTENCE_RETRY_DELAY_MS));
        }
      }
    }
    throw lastError;
  }

  const previous = deps.persistenceQueues.get(context.repo.id) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      await persistWithRetry();

      // Throttled pruning — at most once per PRUNE_THROTTLE_MS per repo
      const repoId = context.repo.id;
      const now = Date.now();
      const lastPrune = lastPruneTimestamps.get(repoId) ?? 0;
      if (now - lastPrune >= PRUNE_THROTTLE_MS) {
        lastPruneTimestamps.set(repoId, now);
        const prunedIndex = await pruneSessionHistory(context.repo.rootPath, nextIndex);
        if (prunedIndex.sessions.length !== nextIndex.sessions.length) {
          deps.sessionIndices.set(repoId, prunedIndex);
          await saveSessionIndex(context.repo.rootPath, prunedIndex);
          await removeOrphanedSessionDirs(context.repo.rootPath, prunedIndex);
        }
      }
    });

  deps.persistenceQueues.set(context.repo.id, task.catch(() => undefined));
  void task.catch((error) => {
    console.error("Failed to persist Joudo repo state after retries", error);
    deps.onPersistenceError?.(context.repo.id, error);
  });
}

function stripRuntimeOnlyAgentState(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    agent: null,
    availableAgents: [],
    agentCatalog: {
      globalCount: 0,
      repoCount: 0,
      totalCount: 0,
    },
  };
}