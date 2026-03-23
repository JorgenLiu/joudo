import type { RepoDescriptor } from "@joudo/shared";

type RepoListPanelProps = {
  repos: RepoDescriptor[];
  activeRepoId: string | null;
  onSelectRepo: (repoId: string) => void;
};

export function RepoListPanel({ repos, activeRepoId, onSelectRepo }: RepoListPanelProps) {
  return (
    <aside className="panel column">
      <div className="sectionHeader">
        <h2>仓库</h2>
        <span>{repos.length} 个可选项</span>
      </div>
      <div className="stack">
        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId;
          return (
            <button
              key={repo.id}
              className={`repoCard${isActive ? " active" : ""}`}
              type="button"
              onClick={() => onSelectRepo(repo.id)}
            >
              <strong>{repo.name}</strong>
              <span>{repo.rootPath}</span>
              <em>
                {repo.trusted ? "受信任仓库" : "未受信任"} / 策略 {repo.policyState}
              </em>
            </button>
          );
        })}
      </div>
    </aside>
  );
}