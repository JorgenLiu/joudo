import { createContext, useContext, useState, type ReactNode } from "react";

import type {
  LivePolicyValidationReport,
  RepoDescriptor,
  RepoInstructionDocument,
  SessionIndexDocument,
  SessionSnapshot,
} from "@joudo/shared";

import {
  bridgeOrigin,
  emptySnapshot,
  normalizeSnapshot,
  readJson,
  type ErrorState,
  type RefreshRepoScopedStateOptions,
} from "./bridge-utils";

export interface BridgeSharedState {
  repos: RepoDescriptor[];
  setRepos: (repos: RepoDescriptor[]) => void;

  snapshot: SessionSnapshot;
  setSnapshot: (snapshot: SessionSnapshot) => void;

  errorState: ErrorState | null;
  setErrorState: (state: ErrorState | null) => void;

  connectionState: string;
  setConnectionState: (state: string) => void;

  isBootstrapping: boolean;
  setIsBootstrapping: (val: boolean) => void;

  isDisconnected: boolean;
  setIsDisconnected: (val: boolean) => void;

  validationReport: LivePolicyValidationReport | null;
  setValidationReport: (report: LivePolicyValidationReport | null) => void;

  repoInstruction: RepoInstructionDocument | null;
  instructionDraft: string;
  instructionDraftRepoId: string | null;
  isInstructionDraftDirty: boolean;

  setRepoInstruction: (doc: RepoInstructionDocument | null) => void;
  setInstructionDraft: (draft: string) => void;
  setInstructionDraftRepoId: (id: string | null) => void;
  setIsInstructionDraftDirty: (dirty: boolean) => void;

  sessionIndex: SessionIndexDocument | null;
  setSessionIndex: (index: SessionIndexDocument | null) => void;

  syncInstructionState: (
    nextInstruction: RepoInstructionDocument | null,
    options?: { forceDraftReset?: boolean },
  ) => void;
  refreshRepoScopedState: (options?: RefreshRepoScopedStateOptions) => Promise<void>;
  resetRepoScopedState: () => void;
  bootstrap: () => Promise<void>;
}

const BridgeContext = createContext<BridgeSharedState | null>(null);

export function useBridgeContext(): BridgeSharedState {
  const ctx = useContext(BridgeContext);
  if (!ctx) {
    throw new Error("useBridgeContext must be used within <BridgeProvider>");
  }
  return ctx;
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<RepoDescriptor[]>([]);
  const [snapshot, setSnapshotRaw] = useState<SessionSnapshot>(emptySnapshot);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [connectionState, setConnectionState] = useState("bridge 连接中");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isDisconnected, setIsDisconnected] = useState(false);

  const [validationReport, setValidationReport] = useState<LivePolicyValidationReport | null>(null);
  const [repoInstruction, setRepoInstruction] = useState<RepoInstructionDocument | null>(null);
  const [instructionDraft, setInstructionDraft] = useState("");
  const [instructionDraftRepoId, setInstructionDraftRepoId] = useState<string | null>(null);
  const [isInstructionDraftDirty, setIsInstructionDraftDirty] = useState(false);
  const [sessionIndex, setSessionIndex] = useState<SessionIndexDocument | null>(null);

  function setSnapshot(next: SessionSnapshot) {
    setSnapshotRaw(normalizeSnapshot(next));
  }

  function syncInstructionState(
    nextInstruction: RepoInstructionDocument | null,
    options?: { forceDraftReset?: boolean },
  ) {
    const nextRepoId = nextInstruction?.repoId ?? null;
    const shouldResetDraft =
      options?.forceDraftReset === true ||
      !isInstructionDraftDirty ||
      instructionDraftRepoId !== nextRepoId;

    setRepoInstruction(nextInstruction);

    if (shouldResetDraft) {
      setInstructionDraft(nextInstruction?.userNotes ?? "");
      setInstructionDraftRepoId(nextRepoId);
      setIsInstructionDraftDirty(false);
    }
  }

  function resetRepoScopedState() {
    syncInstructionState(null, { forceDraftReset: true });
    setSessionIndex(null);
  }

  async function refreshRepoScopedState(options?: RefreshRepoScopedStateOptions) {
    const [instructionResult, sessionIndexResult] = await Promise.allSettled([
      readJson<RepoInstructionDocument | null>(`${bridgeOrigin}/api/repo/instruction`),
      readJson<SessionIndexDocument | null>(`${bridgeOrigin}/api/repo/sessions`),
    ]);

    if (instructionResult.status === "fulfilled") {
      syncInstructionState(instructionResult.value, {
        forceDraftReset: options?.preserveUnsavedInstructionDraft !== true,
      });
    } else {
      console.warn("Failed to refresh repo instruction", instructionResult.reason);
      if (options?.preserveUnsavedInstructionDraft !== true) {
        syncInstructionState(null, { forceDraftReset: true });
      }
    }

    if (sessionIndexResult.status === "fulfilled") {
      setSessionIndex(sessionIndexResult.value);
    } else {
      console.warn("Failed to refresh session index", sessionIndexResult.reason);
      setSessionIndex(null);
    }
  }

  async function bootstrap() {
    const [repoResponse, sessionResponse] = await Promise.all([
      readJson<{ repos: RepoDescriptor[] }>(`${bridgeOrigin}/api/repos`),
      readJson<SessionSnapshot>(`${bridgeOrigin}/api/session`),
    ]);

    const validationResult = await readJson<LivePolicyValidationReport | null>(`${bridgeOrigin}/api/validation/live-policy`)
      .then((value) => ({ ok: true as const, value }))
      .catch((error) => {
        console.warn("Failed to load live policy validation report", error);
        return { ok: false as const, value: null };
      });

    setRepos(repoResponse.repos);
    setSnapshot(sessionResponse);
    setValidationReport(validationResult.value);
    setConnectionState("bridge 已连接");
    setIsBootstrapping(false);
    await refreshRepoScopedState();
  }

  const value: BridgeSharedState = {
    repos,
    setRepos,
    snapshot,
    setSnapshot,
    errorState,
    setErrorState,
    connectionState,
    setConnectionState,
    isBootstrapping,
    setIsBootstrapping,
    isDisconnected,
    setIsDisconnected,
    validationReport,
    setValidationReport,
    repoInstruction,
    instructionDraft,
    instructionDraftRepoId,
    isInstructionDraftDirty,
    setRepoInstruction,
    setInstructionDraft,
    setInstructionDraftRepoId,
    setIsInstructionDraftDirty,
    sessionIndex,
    setSessionIndex,
    syncInstructionState,
    refreshRepoScopedState,
    resetRepoScopedState,
    bootstrap,
  };

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}
