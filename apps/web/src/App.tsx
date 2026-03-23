import { useCallback, useEffect, useRef, useState } from "react";

import { sessionStatusLabel, sessionStatusTone } from "./components/display";
import { ApprovalPanel } from "./components/ApprovalPanel";
import { ActivityPanel } from "./components/ActivityPanel";
import { AuthPanel } from "./components/AuthPanel";
import { ErrorPanel } from "./components/ErrorPanel";
import { HeroPanel } from "./components/HeroPanel";
import { OnboardingPanel } from "./components/OnboardingPanel";
import { PolicyPanel } from "./components/PolicyPanel";
import { PromptPanel } from "./components/PromptPanel";
import { RepoInstructionPanel } from "./components/RepoInstructionPanel";
import { SessionHistoryPanel } from "./components/SessionHistoryPanel";
import { SummaryPanel } from "./components/SummaryPanel";
import { TimelinePanel } from "./components/TimelinePanel";
import { TotpGate } from "./components/TotpGate";
import { ValidationPanel } from "./components/ValidationPanel";
import { getStoredToken, setStoredToken } from "./hooks/bridge-utils";
import { useBridgeApp } from "./hooks/useBridgeApp";

type TabId = "console" | "summary" | "policy" | "history";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getStoredToken()));

  const handleAuthExpired = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    window.addEventListener("joudo:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("joudo:auth-expired", handleAuthExpired);
  }, [handleAuthExpired]);

  if (!isAuthenticated) {
    return (
      <TotpGate
        onAuthenticated={(token) => {
          setStoredToken(token);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [activeTab, setActiveTab] = useState<TabId>("console");
  const tabContentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    tabContentRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  const {
    repos,
    snapshot,
    prompt,
    connectionState,
    isSubmitting,
    isRefreshingAuth,
    isSettingModel,
    validationReport,
    isRefreshingValidation,
    errorState,
    latestPersistedApproval,
    promptHint,
    repoInstruction,
    instructionDraft,
    isSavingInstruction,
    sessionIndex,
    isRecoveringSession,
    isInitializingRepo,
    selectedCheckpoint,
    isLoadingCheckpoint,
    isRollingBack,
    isBootstrapping,
    isDisconnected,
    setPrompt,
    setModel,
    setInstructionDraft,
    selectRepo,
    submitPrompt,
    resolveApproval,
    refreshAuth,
    refreshValidationReport,
    initRepoPolicy,
    saveRepoInstruction,
    deletePolicyRule,
    recoverHistoricalSession,
    openCheckpoint,
    rollbackLatestTurn,
    clearCheckpointSelection,
    dismissError,
    rebootstrap,
  } = useBridgeApp();

  const approvalBadge = snapshot.approvals.length || null;

  return (
    <div className="mobileShell">
      <HeroPanel
        connectionState={connectionState}
        model={snapshot.model}
        availableModels={snapshot.availableModels}
        auth={snapshot.auth}
        status={snapshot.status}
        repos={repos}
        activeRepoId={snapshot.repo?.id ?? null}
        isSettingModel={isSettingModel}
        onSelectRepo={selectRepo}
        onSelectModel={setModel}
        onRebootstrap={rebootstrap}
      />

      <main className="tabContent" ref={tabContentRef}>
        {isBootstrapping && (
          <div className="bootstrapOverlay">
            <span className="bootstrapSpinner" />
            <span>正在加载 bridge 数据…</span>
            <div className="skeletonGroup">
              <div className="skeleton skeletonBlock" />
              <div className="skeleton skeletonLine" style={{ width: "60%" }} />
              <div className="skeleton skeletonLine" style={{ width: "80%" }} />
              <div className="skeleton skeletonCard" />
            </div>
          </div>
        )}
        {isDisconnected && (
          <div className="disconnectBanner">实时通道已断开，数据可能不是最新状态</div>
        )}
        {activeTab === "console" && (
          <div className="tabPage" role="tabpanel" id="tabpanel-console">
            <ErrorPanel
              error={errorState?.error ?? null}
              retryLabel={errorState?.retryLabel ?? null}
              onRetry={errorState?.retry ?? null}
              onDismiss={dismissError}
            />
            {snapshot.repo && snapshot.policy?.state !== "loaded" && (
              <OnboardingPanel
                repo={snapshot.repo}
                policyState={snapshot.policy?.state ?? "missing"}
                isInitializing={isInitializingRepo}
                onInitRepo={initRepoPolicy}
              />
            )}
            <AuthPanel visible={snapshot.auth.status !== "authenticated"} isRefreshingAuth={isRefreshingAuth} onRefreshAuth={refreshAuth} />
            <PromptPanel
              prompt={prompt}
              promptHint={promptHint}
              isSubmitting={isSubmitting}
              disabled={snapshot.approvals.length > 0 || snapshot.status === "running" || snapshot.status === "recovering"}
              onPromptChange={setPrompt}
              onSubmit={submitPrompt}
            />
            <ApprovalPanel approvals={snapshot.approvals} latestPersistedApproval={latestPersistedApproval} onResolveApproval={resolveApproval} />
            {snapshot.summary && (
              <button type="button" className="summaryPreviewCard" onClick={() => setActiveTab("summary")}>
                <div className="summaryPreviewHeader">
                  <strong>{snapshot.summary.title}</strong>
                  <span className={`statusTag ${sessionStatusTone(snapshot.status)}`}>{sessionStatusLabel(snapshot.status)}</span>
                </div>
                <p className="summaryPreviewBody">
                  {(snapshot.summary.body?.length ?? 0) > 140 ? `${snapshot.summary.body.slice(0, 140)}…` : snapshot.summary.body ?? ""}
                </p>
                <span className="summaryPreviewLink">查看完整摘要 →</span>
              </button>
            )}
          </div>
        )}

        {activeTab === "summary" && (
          <div className="tabPage" role="tabpanel" id="tabpanel-summary">
            <SummaryPanel snapshot={snapshot} />
            <details className="collapsible" open>
              <summary>执行轨迹</summary>
              <ActivityPanel
                activity={snapshot.activity}
                selectedCheckpoint={selectedCheckpoint}
                isLoadingCheckpoint={isLoadingCheckpoint}
                isRollingBack={isRollingBack}
                onOpenCheckpoint={openCheckpoint}
                onRollbackLatestTurn={rollbackLatestTurn}
                onClearCheckpointSelection={clearCheckpointSelection}
              />
            </details>
            <details className="collapsible">
              <summary>时间线 ({snapshot.timeline.length})</summary>
              <TimelinePanel timeline={snapshot.timeline} />
            </details>
          </div>
        )}

        {activeTab === "policy" && (
          <div className="tabPage" role="tabpanel" id="tabpanel-policy">
            <PolicyPanel snapshot={snapshot} onDeleteRule={deletePolicyRule} />
            <details className="collapsible">
              <summary>Repo 备注</summary>
              <RepoInstructionPanel
                repoInstruction={repoInstruction}
                instructionDraft={instructionDraft}
                isSavingInstruction={isSavingInstruction}
                onInstructionChange={setInstructionDraft}
                onSaveInstruction={saveRepoInstruction}
              />
            </details>
            <details className="collapsible">
              <summary>策略回归</summary>
              <ValidationPanel
                validationReport={validationReport}
                isRefreshingValidation={isRefreshingValidation}
                onRefreshValidation={refreshValidationReport}
              />
            </details>
          </div>
        )}

        {activeTab === "history" && (
          <div className="tabPage" role="tabpanel" id="tabpanel-history">
            <SessionHistoryPanel
              sessionIndex={sessionIndex}
              isRecoveringSession={isRecoveringSession}
              onRecoverSession={recoverHistoricalSession}
            />
          </div>
        )}
      </main>

      <nav className="tabBar" role="tablist" aria-label="主导航">
        <button type="button" role="tab" aria-selected={activeTab === "console"} aria-controls="tabpanel-console" className={`tabBarItem${activeTab === "console" ? " active" : ""}`} onClick={() => setActiveTab("console")}>
          <span className="tabBarIcon" aria-hidden="true">⌘</span>
          <span className="tabBarLabel">控制台</span>
          {approvalBadge ? <span className="tabBadge" aria-label={`${approvalBadge} 条待审批`}>{approvalBadge}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "summary"} aria-controls="tabpanel-summary" className={`tabBarItem${activeTab === "summary" ? " active" : ""}`} onClick={() => setActiveTab("summary")}>
          <span className="tabBarIcon" aria-hidden="true">◉</span>
          <span className="tabBarLabel">摘要</span>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "policy"} aria-controls="tabpanel-policy" className={`tabBarItem${activeTab === "policy" ? " active" : ""}`} onClick={() => setActiveTab("policy")}>
          <span className="tabBarIcon" aria-hidden="true">⛨</span>
          <span className="tabBarLabel">策略</span>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "history"} aria-controls="tabpanel-history" className={`tabBarItem${activeTab === "history" ? " active" : ""}`} onClick={() => setActiveTab("history")}>
          <span className="tabBarIcon" aria-hidden="true">↻</span>
          <span className="tabBarLabel">历史</span>
        </button>
      </nav>
    </div>
  );
}
