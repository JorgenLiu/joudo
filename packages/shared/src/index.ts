export type PolicyState = "missing" | "loaded" | "invalid";
export type PolicyDecisionAction = "allow" | "confirm" | "deny";
export type PermissionResolution = "auto-allowed" | "auto-denied" | "awaiting-user" | "user-allowed" | "user-denied";
export type BridgeErrorCode =
  | "auth"
  | "network"
  | "policy"
  | "recovery"
  | "timeout"
  | "session-expired"
  | "approval"
  | "validation"
  | "unknown";

export type SessionStatus = "disconnected" | "idle" | "running" | "awaiting-approval" | "recovering" | "timed-out";
export type PersistedSessionStatus = SessionStatus | "interrupted";
export type HistoricalSessionRecoveryMode = "attach" | "history-only";

export type ApprovalDecision = "allow-once" | "allow-and-persist" | "deny";

export type ApprovalType =
  | "shell-readonly"
  | "shell-execution"
  | "file-write"
  | "repo-read"
  | "external-path-read"
  | "url-fetch"
  | "mcp-readonly"
  | "mcp-execution"
  | "custom-tool"
  | "other";

export interface RepoDescriptor {
  id: string;
  name: string;
  rootPath: string;
  trusted: boolean;
  policyState: PolicyState;
}

export type RepoPolicyRuleField = "allowShell" | "allowedPaths" | "allowedWritePaths";
export type RepoPolicyRuleSource = "policy-file" | "approval-persisted";
export type RepoPolicyRuleRisk = "low" | "medium" | "high";

export interface RepoPolicyRule {
  id: string;
  field: RepoPolicyRuleField;
  value: string;
  matchedRule: string;
  source: RepoPolicyRuleSource;
  risk: RepoPolicyRuleRisk;
  note: string | null;
  lastUpdatedAt: string | null;
  isPersistedFromApproval: boolean;
}

export interface RepoPolicySnapshot {
  state: PolicyState;
  path: string | null;
  allowShell: string[];
  confirmShell: string[];
  denyShell: string[];
  allowTools: string[];
  confirmTools: string[];
  denyTools: string[];
  allowedPaths: string[];
  allowedWritePaths: string[];
  allowedUrls: string[];
  rules: RepoPolicyRule[];
  error: string | null;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  rationale: string;
  riskLevel: "medium" | "high";
  requestedAt: string;
  approvalType: ApprovalType;
  commandPreview: string;
  requestKind: string;
  target: string;
  scope: string;
  impact: string;
  denyImpact: string;
  whyNow?: string;
  expectedEffect?: string;
  fallbackIfDenied?: string;
  matchedRule?: string;
}

export type ActivityPhase =
  | "idle"
  | "queued"
  | "analyzing"
  | "editing"
  | "validating"
  | "awaiting-approval"
  | "recovering"
  | "timed-out"
  | "completed"
  | "failed";

export type ActivityItemStatus = "running" | "completed" | "blocked" | "failed";

export type ActivityItemKind =
  | "phase"
  | "command"
  | "file-change"
  | "approval"
  | "validation"
  | "error"
  | "note";

export interface ActivityEvidenceRef {
  source: "timeline" | "audit" | "approval" | "summary" | "runtime";
  id?: string;
}

export interface ActivityCommandRecord {
  id: string;
  command: string;
  status: ActivityItemStatus;
  startedAt: string;
  completedAt?: string;
  requestKind?: string;
  rationale?: string;
}

export interface ActivityFileChangeRecord {
  path: string;
  changeKind: "created" | "updated" | "deleted" | "renamed";
  summary?: string;
  source: "observed" | "derived";
}

export interface ActivityTurnRecord {
  id: string;
  prompt: string;
  startedAt: string;
  completedAt: string;
  outcome: "completed" | "failed" | "timed-out" | "rolled-back";
  changedFiles: ActivityFileChangeRecord[];
}

export type ActivityRollbackStatus =
  | "ready"
  | "no-changes"
  | "history-only"
  | "session-unavailable"
  | "workspace-drifted"
  | "reverted"
  | "needs-review";

export type ActivityRollbackExecutor = "copilot-undo" | "joudo-write-journal";

export interface ActivityRollbackState {
  authority: "joudo";
  executor: ActivityRollbackExecutor;
  status: ActivityRollbackStatus;
  canRollback: boolean;
  reason: string;
  targetTurnId: string | null;
  changedFiles: ActivityFileChangeRecord[];
  trackedPaths?: string[];
  evaluatedAt: string;
  workspaceDigestBefore?: string;
  workspaceDigestAfter?: string;
}

export interface ActivityCheckpointRecord {
  number: number;
  title: string;
  fileName: string;
  path: string;
}

export interface ActivityCompactionRecord {
  completedAt: string;
  messagesRemoved: number;
  tokensRemoved: number;
  checkpointNumber?: number;
  checkpointPath?: string;
  summaryPreview?: string;
}

export interface ActivityBlocker {
  kind: "approval" | "error" | "timeout";
  title: string;
  detail: string;
  nextAction?: string;
  relatedId?: string;
}

export interface SessionActivityItem {
  id: string;
  kind: ActivityItemKind;
  status: ActivityItemStatus;
  title: string;
  detail: string;
  timestamp: string;
  phase: ActivityPhase;
  evidence?: ActivityEvidenceRef[];
}

export interface SessionActivity {
  phase: ActivityPhase;
  intent: string | null;
  headline: string;
  detail: string;
  updatedAt: string;
  workspacePath: string | null;
  items: SessionActivityItem[];
  commands: ActivityCommandRecord[];
  changedFiles: ActivityFileChangeRecord[];
  latestTurn: ActivityTurnRecord | null;
  rollback: ActivityRollbackState | null;
  checkpoints: ActivityCheckpointRecord[];
  latestCompaction: ActivityCompactionRecord | null;
  blockers: ActivityBlocker[];
}

export interface BridgeOperationError {
  code: BridgeErrorCode;
  message: string;
  nextAction: string;
  retryable: boolean;
  details?: string;
}

export interface BridgeErrorResponse {
  error: BridgeOperationError;
}

export interface RepoInstructionDocument {
  repoId: string;
  repoPath: string;
  path: string;
  exists: boolean;
  generatedContent: string;
  userNotes: string;
  content: string;
  updatedAt: string | null;
}

export interface SessionCheckpointDocument {
  number: number;
  title: string;
  fileName: string;
  path: string;
  workspacePath: string;
  content: string;
}

export interface SessionAgentCatalog {
  globalCount: number;
  repoCount: number;
  totalCount: number;
}

export interface RepoInstructionUpdatePayload {
  userNotes: string;
}

export interface RepoAddPayload {
  rootPath: string;
  initializePolicy?: boolean;
  trusted?: boolean;
}

export interface RepoRemovePayload {
  repoId: string;
}

export interface RepoInitPolicyPayload {
  trusted?: boolean;
}

export interface RepoInitPolicyResult {
  repoId: string;
  repoPath: string;
  policyPath: string;
  instructionPath: string;
  sessionIndexPath: string;
  createdPolicy: boolean;
  createdInstruction: boolean;
  createdSessionIndex: boolean;
  policyAlreadyExisted: boolean;
  instructionAlreadyExisted: boolean;
  sessionIndexAlreadyExisted: boolean;
  snapshot: SessionSnapshot;
  repoInstruction: RepoInstructionDocument;
}

export interface RepoPolicyRuleDeletePayload {
  field: RepoPolicyRuleField;
  value: string;
}

export interface RecoverHistoricalSessionPayload {
  joudoSessionId: string;
}

export type ResumeHistoricalSessionPayload = RecoverHistoricalSessionPayload;

export interface SessionIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: PersistedSessionStatus;
  canAttemptResume: boolean;
  recoveryMode: HistoricalSessionRecoveryMode;
  turnCount: number;
  lastPromptPreview: string | null;
  summaryTitle: string | null;
  summaryPreview: string | null;
  hasPendingApprovals: boolean;
  lastKnownCopilotSessionId: string | null;
}

export interface SessionIndexDocument {
  schemaVersion: number;
  repoId: string;
  repoPath: string;
  currentSessionId: string | null;
  updatedAt: string | null;
  sessions: SessionIndexEntry[];
}

export interface PolicyDecisionRule {
  source: string;
  action: PolicyDecisionAction;
  matchedRule?: string;
  reason: string;
}

export interface PolicyDecisionDetails {
  action: PolicyDecisionAction;
  reason: string;
  matchedRule?: string;
  rules: PolicyDecisionRule[];
}

export interface PermissionAuditEntry {
  id: string;
  requestKind: string;
  target: string;
  requestedAt: string;
  resolvedAt?: string;
  resolution: PermissionResolution;
  decision: PolicyDecisionDetails;
}

export interface LivePolicyValidationScenarioReport {
  label: string;
  command: string;
  expectedResolution: PermissionResolution;
  expectedMatchedRule: string;
  success: boolean;
  actualResolution?: PermissionResolution;
  actualMatchedRule?: string;
  attempts: number;
  notes?: string;
}

export interface LivePolicyValidationCheckReport {
  label: string;
  p0: string[];
  success: boolean;
  details?: Record<string, unknown>;
}

export interface LivePolicyValidationCoverageEntry {
  label: string;
  success: boolean;
}

export type LivePolicyValidationCoverageReport = Record<string, LivePolicyValidationCoverageEntry[]>;

export interface LivePolicyValidationReport {
  generatedAt: string;
  bridgeOrigin: string;
  reportPath: string;
  success: boolean;
  repo: {
    id: string;
    name: string;
    rootPath: string;
    policyState: PolicyState;
  };
  scenarios: LivePolicyValidationScenarioReport[];
  checks: LivePolicyValidationCheckReport[];
  p0Coverage: LivePolicyValidationCoverageReport;
  failureMessage?: string;
}

export type SessionSummaryStepKind = "prompt" | "status" | "approval" | "assistant" | "command" | "file-change" | "error";
export type SessionSummaryStepStatus = "completed" | "running" | "blocked" | "failed";

export interface SessionSummaryStep {
  id: string;
  kind: SessionSummaryStepKind;
  status: SessionSummaryStepStatus;
  title: string;
  detail: string;
  timestamp?: string;
}

export interface SessionSummary {
  title: string;
  body: string;
  steps: SessionSummaryStep[];
  executedCommands: string[];
  approvalTypes?: ApprovalType[];
  changedFiles: string[];
  checks: string[];
  risks: string[];
  nextAction: string;
}

export interface CopilotAuthState {
  status: "unknown" | "authenticated" | "unauthenticated";
  message: string;
}

export interface SessionTimelineEntry {
  id: string;
  kind: "status" | "prompt" | "assistant" | "approval-requested" | "approval-resolved" | "error";
  title: string;
  body: string;
  timestamp: string;
  decision?: {
    action: PolicyDecisionAction;
    resolution?: PermissionResolution;
    approvalType?: ApprovalType;
    persistedToPolicy?: boolean;
    persistedField?: RepoPolicyRuleField;
    persistedValue?: string;
    persistedNote?: string | null;
    matchedRule?: string;
  };
}

export interface SessionSnapshot {
  sessionId: string;
  status: SessionStatus;
  repo: RepoDescriptor | null;
  policy?: RepoPolicySnapshot | null;
  model: string;
  availableModels: string[];
  agent: string | null;
  availableAgents: string[];
  agentCatalog: SessionAgentCatalog;
  auth: CopilotAuthState;
  lastPrompt: string | null;
  approvals: ApprovalRequest[];
  timeline: SessionTimelineEntry[];
  auditLog: PermissionAuditEntry[];
  activity: SessionActivity | null;
  summary: SessionSummary | null;
  updatedAt: string;
}

export interface BridgeHealthResponse {
  status: "ok";
  mode: "mvp";
  transport: "http+ws";
  timestamp: string;
}

export interface RepoSelectionPayload {
  repoId: string;
}

export interface SessionModelSelectionPayload {
  model: string;
}

export interface SessionAgentSelectionPayload {
  agent: string | null;
}

export interface PromptSubmission {
  sessionId: string;
  prompt: string;
}

export interface RollbackLatestTurnPayload {
  sessionId: string;
}

export interface ApprovalResolutionPayload {
  approvalId: string;
  decision: ApprovalDecision;
}

export interface TotpVerifyPayload {
  code: string;
}

export interface TotpSetupResponse {
  available: boolean;
  localOnly: boolean;
  alreadyPaired: boolean;
  secret?: string;
  uri?: string;
  message: string;
}

export interface TotpRebindResponse {
  success: boolean;
  message: string;
  secret: string;
  uri: string;
}

export interface TotpVerifyResponse {
  success: boolean;
  token?: string;
  message: string;
}

export type ServerEvent =
  | { type: "bridge.ready"; payload: { timestamp: string } }
  | { type: "session.snapshot"; payload: SessionSnapshot }
  | { type: "approval.requested"; payload: ApprovalRequest }
  | { type: "summary.updated"; payload: SessionSummary };
