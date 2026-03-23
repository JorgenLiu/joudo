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
    detail: "先初始化推荐的 repo-scoped policy 和基础文件，再开始第一轮任务。",
  },
  invalid: {
    title: "当前仓库的 policy 文件不可用",
    detail: "初始化不会覆盖损坏文件，但会帮你补齐 repo 指令和会话索引。建议先修复 policy，再继续使用。",
  },
  loaded: {
    title: "当前仓库已完成基础初始化",
    detail: "你可以继续完善 repo 备注，或者直接开始第一轮 prompt。",
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
        <div className="onboardingStepList">
          <div className="onboardingStep">
            <strong>1. 完成设备绑定</strong>
            <p>验证码验证已经走通后，当前浏览器会拿到本地 bridge 的会话令牌。</p>
          </div>
          <div className="onboardingStep active">
            <strong>2. 初始化 repo policy</strong>
            <p>{copy.title}</p>
            <small>{copy.detail}</small>
          </div>
          <div className="onboardingStep">
            <strong>3. 补 repo 备注并开始第一轮</strong>
            <p>初始化完成后，可以先检查推荐 policy，再去“策略”页补 repo 备注。</p>
          </div>
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
