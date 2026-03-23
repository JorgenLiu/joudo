import type { CopilotAuthState, RepoDescriptor, SessionStatus } from "@joudo/shared";

import { sessionStatusLabel, sessionStatusTone } from "./display";

type HeroPanelProps = {
  connectionState: string;
  model: string;
  availableModels: string[];
  auth: CopilotAuthState;
  status: SessionStatus;
  repos: RepoDescriptor[];
  activeRepoId: string | null;
  isSettingModel: boolean;
  onSelectRepo: (repoId: string) => void;
  onSelectModel: (model: string) => Promise<void>;
  onRebootstrap: () => Promise<void>;
};

export function HeroPanel({
  connectionState,
  model,
  availableModels,
  auth,
  status,
  repos,
  activeRepoId,
  isSettingModel,
  onSelectRepo,
  onSelectModel,
  onRebootstrap,
}: HeroPanelProps) {
  const statusTone = sessionStatusTone(status);
  const modelLocked = status === "running" || status === "awaiting-approval" || status === "recovering";

  return (
    <header className="appHeader">
      <div className="appHeaderRow">
        <strong className="appLogo">Joudo</strong>
        <div className="appHeaderPills">
          <span className={`headerPill ${statusTone}`}>{sessionStatusLabel(status)}</span>
          {auth.status !== "authenticated" && <span className="headerPill accent">未登录</span>}
          <span className="headerPill muted">{connectionState}</span>
          <button type="button" className="headerRefreshBtn" title="重新加载" onClick={() => void onRebootstrap()}>↻</button>
        </div>
      </div>
      {repos.length > 0 && (
        <div className="repoSelector">
          <select
            value={activeRepoId ?? ""}
            onChange={(event) => onSelectRepo(event.target.value)}
          >
            <option value="" disabled>选择仓库</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>{repo.name}</option>
            ))}
          </select>
          <select value={model} disabled={modelLocked || isSettingModel} onChange={(event) => void onSelectModel(event.target.value)}>
            {availableModels.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </div>
      )}
    </header>
  );
}