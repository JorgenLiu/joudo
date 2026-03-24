import type { PolicyState, RepoDescriptor } from "@joudo/shared";

type OnboardingPanelProps = {
  repo: RepoDescriptor;
  policyState: PolicyState;
  isInitializing: boolean;
  onInitRepo: () => Promise<void>;
};

const policyStateCopy: Record<PolicyState, { title: string; detail: string }> = {
  missing: {
    title: "当前仓库还没有 Joudo policy",
    detail: "需要先初始化基础文件。",
  },
  invalid: {
    title: "当前仓库的 policy 文件不可用",
    detail: "建议先修复后再继续。",
  },
  loaded: {
    title: "当前仓库已完成基础初始化",
    detail: "可以直接开始使用。",
  },
};

export function OnboardingPanel({ repo, policyState, isInitializing, onInitRepo }: OnboardingPanelProps) {
  const copy = policyStateCopy[policyState];

  return (
    <section className="panel onboardingPanel">
      <div className="sectionHeader">
        <h2>首次进入当前仓库</h2>
        <span>{repo.name}</span>
      </div>
      <div className="onboardingCard">
        <div className="onboardingStatus">
          <strong>{copy.title}</strong>
          <p>{copy.detail}</p>
          <small>{policyState === "loaded" ? "Repo 备注和提示词输入已可用。" : "初始化会补齐当前 repo 的基础 Joudo 文件。"}</small>
        </div>
        <div className="onboardingActions">
          <button type="button" disabled={isInitializing} onClick={() => void onInitRepo()}>
            {isInitializing ? "初始化中…" : policyState === "loaded" ? "重新检查基础文件" : "初始化当前仓库"}
          </button>
        </div>
      </div>
    </section>
  );
}
