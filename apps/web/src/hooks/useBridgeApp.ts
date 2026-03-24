import { useMemo } from "react";
import { useBridgeConnection } from "./useBridgeConnection";
import { useRepoPolicy } from "./useRepoPolicy";
import { useSessionState } from "./useSessionState";

export function useBridgeApp() {
  const connection = useBridgeConnection();
  const session = useSessionState();
  const policy = useRepoPolicy();

  return useMemo(() => ({
    repos: session.repos,
    snapshot: session.snapshot,
    prompt: session.prompt,
    connectionState: connection.connectionState,
    isSubmitting: session.isSubmitting,
    isRefreshingAuth: policy.isRefreshingAuth,
    isSettingModel: session.isSettingModel,
    isSettingAgent: session.isSettingAgent,
    isBootstrapping: connection.isBootstrapping,
    isDisconnected: connection.isDisconnected,
    validationReport: policy.validationReport,
    isRefreshingValidation: policy.isRefreshingValidation,
    repoInstruction: policy.repoInstruction,
    instructionDraft: policy.instructionDraft,
    isSavingInstruction: policy.isSavingInstruction,
    sessionIndex: policy.sessionIndex,
    isRecoveringSession: policy.isRecoveringSession,
    isInitializingRepo: policy.isInitializingRepo,
    isClearingSessionHistory: policy.isClearingSessionHistory,
    selectedCheckpoint: session.selectedCheckpoint,
    isLoadingCheckpoint: session.isLoadingCheckpoint,
    isRollingBack: session.isRollingBack,
    errorState: session.errorState,
    activeApproval: session.activeApproval,
    latestPersistedApproval: session.latestPersistedApproval,
    promptHint: session.promptHint,
    dismissError: session.dismissError,
    setPrompt: session.setPrompt,
    setModel: session.setModel,
    setAgent: session.setAgent,
    setInstructionDraft: policy.setInstructionDraft,
    selectRepo: session.selectRepo,
    submitPrompt: session.submitPrompt,
    resolveApproval: session.resolveApproval,
    refreshAuth: policy.refreshAuth,
    refreshValidationReport: policy.refreshValidationReport,
    initRepoPolicy: policy.initRepoPolicy,
    saveRepoInstruction: policy.saveRepoInstruction,
    deletePolicyRule: policy.deletePolicyRule,
    recoverHistoricalSession: policy.recoverHistoricalSession,
    clearSessionHistory: policy.clearSessionHistory,
    openCheckpoint: session.openCheckpoint,
    rollbackLatestTurn: session.rollbackLatestTurn,
    rebootstrap: connection.rebootstrap,
    clearCheckpointSelection: session.clearCheckpointSelection,
  }), [connection, session, policy]);
}