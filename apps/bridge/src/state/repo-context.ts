import type { RepoDescriptor } from "@joudo/shared";

import { loadRepoPolicy } from "../policy/index.js";
import { createInitialSummary } from "./summaries.js";
import type { RepoContext } from "./types.js";

export function createRepoContext(repo: RepoDescriptor, defaultModel = "gpt-5-mini"): RepoContext {
  const timestamp = new Date().toISOString();
  const policy = loadRepoPolicy(repo.rootPath);
  repo.policyState = policy.state;
  return {
    repo,
    policy,
    currentModel: defaultModel,
    status: "idle",
    lastPrompt: null,
    timeline: [
      {
        id: `status-${timestamp}`,
        kind: "status",
        title: "仓库已就绪",
        body: `${repo.name} 已进入 Joudo 的受信任仓库列表，等待第一条真实提示词。`,
        timestamp,
      },
    ],
    auditLog: [],
    summary: createInitialSummary(repo, policy),
    updatedAt: timestamp,
    latestAssistantMessage: null,
    lifecycle: {
      session: null,
      joudoSessionId: null,
      joudoSessionCreatedAt: null,
      lastKnownCopilotSessionId: null,
      activePrompt: null,
      subscriptions: [],
    },
    turns: {
      turnCount: 0,
      activeTurn: null,
      latestTurn: null,
      latestTurnWriteJournal: null,
      checkpoints: [],
      latestCompaction: null,
      rollback: null,
      workspacePath: null,
    },
    approvalState: {
      approvals: [],
      pendingApprovals: new Map(),
      approvedCommands: [],
      approvedApprovalTypes: [],
    },
  };
}

export async function disconnectRepoSession(context: RepoContext) {
  context.lifecycle.subscriptions.forEach((unsubscribe) => unsubscribe());
  context.lifecycle.subscriptions = [];

  if (context.lifecycle.session) {
    try {
      await context.lifecycle.session.disconnect();
    } catch {
      // Ignore cleanup failures for already-expired sessions.
    }
  }

  context.lifecycle.session = null;
}