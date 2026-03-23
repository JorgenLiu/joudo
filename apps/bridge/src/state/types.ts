import type {
  ActivityCheckpointRecord,
  ActivityCompactionRecord,
  ActivityRollbackState,
  ActivityTurnRecord,
  ApprovalRequest,
  ApprovalType,
  PermissionAuditEntry,
  RepoInitPolicyPayload,
  RepoInitPolicyResult,
  RepoInstructionDocument,
  RepoPolicyRuleDeletePayload,
  SessionCheckpointDocument,
  SessionIndexDocument,
  SessionSnapshot,
  SessionStatus,
  SessionSummary,
  SessionTimelineEntry,
} from "@joudo/shared";
import type { ApprovalDecision, RepoDescriptor, ServerEvent } from "@joudo/shared";

import type { CopilotSession, PermissionRequest, PermissionRequestResult } from "../copilot-sdk.js";
import type { LoadedRepoPolicy, PolicyDecision } from "../policy/index.js";
import type { TurnPathTracker } from "./turn-changes.js";
import type { TurnWriteJournal } from "./turn-write-journal.js";

export type Listener = (event: ServerEvent) => void;

export type InteractivePermissionRequestResult = Extract<
  PermissionRequestResult,
  { kind: "approved" } | { kind: "denied-interactively-by-user" }
>;

export type PendingApproval = {
  resolve: (result: InteractivePermissionRequestResult) => void | Promise<void>;
  auditId: string | null;
  policyDecision: PolicyDecision;
  request: PermissionRequest;
};

export type SessionLifecycle = {
  session: CopilotSession | null;
  joudoSessionId: string | null;
  joudoSessionCreatedAt: string | null;
  lastKnownCopilotSessionId: string | null;
  activePrompt: Promise<void> | null;
  subscriptions: Array<() => void>;
};

export type TurnTracking = {
  turnCount: number;
  activeTurn: {
    id: string;
    prompt: string;
    startedAt: string;
    pathTracker: TurnPathTracker;
    writeJournal: TurnWriteJournal;
  } | null;
  latestTurn: ActivityTurnRecord | null;
  latestTurnWriteJournal: TurnWriteJournal | null;
  checkpoints: ActivityCheckpointRecord[];
  latestCompaction: ActivityCompactionRecord | null;
  rollback: ActivityRollbackState | null;
  workspacePath: string | null;
};

export type ApprovalState = {
  approvals: ApprovalRequest[];
  pendingApprovals: Map<string, PendingApproval>;
  approvedCommands: string[];
  approvedApprovalTypes: ApprovalType[];
};

export type RepoContext = {
  repo: RepoDescriptor;
  policy: LoadedRepoPolicy;
  currentModel: string;
  status: SessionStatus;
  lastPrompt: string | null;
  timeline: SessionTimelineEntry[];
  auditLog: PermissionAuditEntry[];
  summary: SessionSummary | null;
  updatedAt: string;
  latestAssistantMessage: string | null;
  lifecycle: SessionLifecycle;
  turns: TurnTracking;
  approvalState: ApprovalState;
};

export interface MvpState {
  getRepos(): RepoDescriptor[];
  getSnapshot(): SessionSnapshot;
  getSessionIndex(): SessionIndexDocument | null;
  getRepoInstruction(): Promise<RepoInstructionDocument | null>;
  initRepoPolicy(payload?: RepoInitPolicyPayload): Promise<RepoInitPolicyResult>;
  getSessionCheckpoint(checkpointNumber: number): Promise<SessionCheckpointDocument | null>;
  rollbackLatestTurn(): Promise<SessionSnapshot>;
  updateRepoInstruction(userNotes: string): Promise<RepoInstructionDocument | null>;
  deleteRepoPolicyRule(payload: RepoPolicyRuleDeletePayload): Promise<SessionSnapshot>;
  refreshAuth(): Promise<SessionSnapshot>;
  subscribe(listener: Listener): () => void;
  selectRepo(repoId: string): SessionSnapshot;
  setModel(model: string): Promise<SessionSnapshot>;
  resumeHistoricalSession(joudoSessionId: string): Promise<SessionSnapshot>;
  recoverHistoricalSession(joudoSessionId: string): Promise<SessionSnapshot>;
  submitPrompt(prompt: string): Promise<SessionSnapshot>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<SessionSnapshot>;
  dispose(): Promise<void>;
}