export type PolicyState = "missing" | "loaded" | "invalid";

export type SessionStatus = "disconnected" | "idle" | "running" | "awaiting-approval";

export type ApprovalDecision = "allow" | "deny";

export interface RepoDescriptor {
  id: string;
  name: string;
  rootPath: string;
  trusted: boolean;
  policyState: PolicyState;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  rationale: string;
  riskLevel: "medium" | "high";
  requestedAt: string;
  commandPreview: string;
}

export interface SessionSummary {
  title: string;
  body: string;
  executedCommands: string[];
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
}

export interface SessionSnapshot {
  sessionId: string;
  status: SessionStatus;
  repo: RepoDescriptor | null;
  model: string;
  auth: CopilotAuthState;
  lastPrompt: string | null;
  approvals: ApprovalRequest[];
  timeline: SessionTimelineEntry[];
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

export interface PromptSubmission {
  sessionId: string;
  prompt: string;
}

export interface ApprovalResolutionPayload {
  approvalId: string;
  decision: ApprovalDecision;
}

export type ServerEvent =
  | { type: "bridge.ready"; payload: { timestamp: string } }
  | { type: "session.snapshot"; payload: SessionSnapshot }
  | { type: "approval.requested"; payload: ApprovalRequest }
  | { type: "summary.updated"; payload: SessionSummary };
