import { useState } from "react";

import type { CopilotAuthState, RepoDescriptor, SessionAgentCatalog, SessionStatus } from "@joudo/shared";

import { BrandSealIcon } from "./BrandSealIcon";
import { sessionStatusLabel, sessionStatusTone } from "./display";

type HeroPanelProps = {
  connectionState: string;
  model: string;
  availableModels: string[];
  agent: string | null;
  availableAgents: string[];
  agentCatalog: SessionAgentCatalog;
  auth: CopilotAuthState;
  status: SessionStatus;
  repos: RepoDescriptor[];
  activeRepoId: string | null;
  isSettingModel: boolean;
  isSettingAgent: boolean;
  onSelectRepo: (repoId: string) => void;
  onSelectModel: (model: string) => Promise<void>;
  onSelectAgent: (agent: string | null) => Promise<void>;
  onRebootstrap: () => Promise<void>;
};

export function HeroPanel({
  connectionState,
  model,
  availableModels,
  agent,
  availableAgents,
  agentCatalog,
  auth,
  status,
  repos,
  activeRepoId,
  isSettingModel,
  isSettingAgent,
  onSelectRepo,
  onSelectModel,
  onSelectAgent,
  onRebootstrap,
}: HeroPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const statusTone = sessionStatusTone(status);
  const modelLocked = status === "running" || status === "awaiting-approval" || status === "recovering";
  const hasDiscoveredAgents = availableAgents.length > 0 || agentCatalog.totalCount > 0 || Boolean(agent);
  const bridgeTone = /connected|已连接/i.test(connectionState)
    ? "info"
    : /disconnect|断开|error|失败/i.test(connectionState)
      ? "warning"
      : "muted";

  return (
    <header className={`appHeader${isCollapsed ? " collapsed" : ""}`}>
      <div className="appHeaderTop">
        <div className="appBrandCluster">
          <div className="appBrandMark" aria-hidden="true">
            <BrandSealIcon className="appBrandSeal" />
          </div>
          <div className="appBrandCopy">
            <span className="appEyebrow">Mobile Session Surface</span>
            <strong className="appLogo">Joudo</strong>
          </div>
        </div>
        <div className="appHeaderControls">
          {isCollapsed ? (
            <div className="appHeaderCompactState" aria-label="当前模型与 bridge 状态">
              <span className="headerPill info">{model}</span>
              <span className={`headerPill ${bridgeTone}`}>{connectionState}</span>
            </div>
          ) : null}
          <button
            type="button"
            className="headerChromeBtn headerCollapseBtn"
            title={isCollapsed ? "展开仓库上下文" : "收起仓库上下文"}
            aria-expanded={!isCollapsed}
            onClick={() => setIsCollapsed((value) => !value)}
          >
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4,7 9,12 14,7" />
            </svg>
          </button>
          <button type="button" className="headerChromeBtn headerRefreshBtn" title="重新加载" onClick={() => void onRebootstrap()}>↻</button>
        </div>
      </div>

      {!isCollapsed ? (
        <>
          <div className="appHeaderStatusRow">
            <span className={`headerPill ${statusTone}`}>{sessionStatusLabel(status)}</span>
            {auth.status !== "authenticated" && <span className="headerPill accent">未登录</span>}
            <span className="headerPill muted">{connectionState}</span>
          </div>

          {repos.length > 0 ? (
            <div className="contextDeck">
              <div className="contextCard contextCardWide">
                <span className="contextLabel">当前仓库</span>
                <select
                  value={activeRepoId ?? ""}
                  onChange={(event) => onSelectRepo(event.target.value)}
                >
                  <option value="" disabled>选择仓库</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>{repo.name}</option>
                  ))}
                </select>
              </div>
              <div className="contextRow">
                <div className="contextCard">
                  <span className="contextLabel">模型</span>
                  <select value={model} disabled={modelLocked || isSettingModel} onChange={(event) => void onSelectModel(event.target.value)}>
                    {availableModels.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="contextCard">
                  <span className="contextLabel">Agent</span>
                  <select
                    value={agent ?? ""}
                    disabled={modelLocked || isSettingAgent || !hasDiscoveredAgents}
                    onChange={(event) => void onSelectAgent(event.target.value || null)}
                  >
                    <option value="">默认 agent</option>
                    {availableAgents.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                  <span className="selectorMeta">
                    {hasDiscoveredAgents
                      ? `repo ${agentCatalog.repoCount} / global ${agentCatalog.globalCount}`
                      : "当前未发现文件系统 agent；Joudo 目前只扫描 ~/.copilot/agents 和当前 repo 的 .github/agents，不包含 VS Code 聊天侧的 ui-design 这类编辑器内 agent。"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </header>
  );
}