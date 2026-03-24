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
    isSettingAgent,
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
    isClearingSessionHistory,
    selectedCheckpoint,
    isLoadingCheckpoint,
    isRollingBack,
    isBootstrapping,
    isDisconnected,
    setPrompt,
    setModel,
    setAgent,
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
    clearSessionHistory,
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
        agent={snapshot.agent}
        availableAgents={snapshot.availableAgents}
        agentCatalog={snapshot.agentCatalog}
        auth={snapshot.auth}
        status={snapshot.status}
        repos={repos}
        activeRepoId={snapshot.repo?.id ?? null}
        isSettingModel={isSettingModel}
        isSettingAgent={isSettingAgent}
        onSelectRepo={selectRepo}
        onSelectModel={setModel}
        onSelectAgent={setAgent}
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
            <section className="tabIntro tabIntroConsole">
              <div>
                <span className="tabIntroEyebrow">Console</span>
                <h1>把当前 repo 的执行、审批和首轮输入放在同一条工作流里。</h1>
              </div>
              <p>这里优先呈现当前会话能否继续、是否需要初始化，以及现在可以安全发出的下一条提示词。</p>
            </section>
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
            <section className="tabIntro tabIntroSummary">
              <div>
                <span className="tabIntroEyebrow">Summary</span>
                <h1>从结果、步骤和回退证据三个角度读这一轮。</h1>
              </div>
              <p>摘要页不追求原始事件完整暴露，而是先给出能解释当前局面的稳定结论，再下钻到活动轨迹和时间线。</p>
            </section>
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
            <section className="tabIntro tabIntroPolicy">
              <div>
                <span className="tabIntroEyebrow">Policy</span>
                <h1>把 repo 规则看成治理面，而不是 YAML 细节。</h1>
              </div>
              <p>这里集中回答三件事：当前边界是什么、哪些规则来自审批沉淀、以及最近应该删掉还是保留什么。</p>
            </section>
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
            <section className="tabIntro tabIntroHistory">
              <div>
                <span className="tabIntroEyebrow">History</span>
                <h1>只保留对继续工作真正有帮助的历史会话。</h1>
              </div>
              <p>历史页强调恢复模式差异，让你先知道这条记录是可尝试接回，还是只能作为只读事实重新载入。</p>
            </section>
            <SessionHistoryPanel
              sessionIndex={sessionIndex}
              isRecoveringSession={isRecoveringSession}
              isClearingSessionHistory={isClearingSessionHistory}
              onRecoverSession={recoverHistoricalSession}
              onClearSessionHistory={clearSessionHistory}
            />
          </div>
        )}
      </main>

      <nav className="tabBar" role="tablist" aria-label="主导航">
        <button type="button" role="tab" aria-selected={activeTab === "console"} aria-controls="tabpanel-console" className={`tabBarItem${activeTab === "console" ? " active" : ""}`} onClick={() => setActiveTab("console")}>
          <span className="tabBarIcon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,6 8,9 4,12" /><line x1="10" y1="12" x2="14" y2="12" /></svg></span>
          <span className="tabBarLabel">控制台</span>
          {approvalBadge ? <span className="tabBadge" aria-label={`${approvalBadge} 条待审批`}>{approvalBadge}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "summary"} aria-controls="tabpanel-summary" className={`tabBarItem${activeTab === "summary" ? " active" : ""}`} onClick={() => setActiveTab("summary")}>
          <span className="tabBarIcon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="12" height="14" rx="2" /><line x1="6" y1="6" x2="12" y2="6" /><line x1="6" y1="9" x2="12" y2="9" /><line x1="6" y1="12" x2="9" y2="12" /></svg></span>
          <span className="tabBarLabel">摘要</span>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "policy"} aria-controls="tabpanel-policy" className={`tabBarItem${activeTab === "policy" ? " active" : ""}`} onClick={() => setActiveTab("policy")}>
          <span className="tabBarIcon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2L3 5v4c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V5L9 2z" /></svg></span>
          <span className="tabBarLabel">策略</span>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "history"} aria-controls="tabpanel-history" className={`tabBarItem${activeTab === "history" ? " active" : ""}`} onClick={() => setActiveTab("history")}>
          <span className="tabBarIcon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 3v4h4" /><path d="M2.5 7a7 7 0 1 1 1.5 5" /><polyline points="9,5 9,9 12,10.5" /></svg></span>
          <span className="tabBarLabel">历史</span>
        </button>
      </nav>
    </div>
  );
}
