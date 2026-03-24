import type { RepoInstructionDocument } from "@joudo/shared";

type RepoInstructionPanelProps = {
  repoInstruction: RepoInstructionDocument | null;
  instructionDraft: string;
  isSavingInstruction: boolean;
  onInstructionChange: (value: string) => void;
  onSaveInstruction: () => Promise<void>;
};

export function RepoInstructionPanel({
  repoInstruction,
  instructionDraft,
  isSavingInstruction,
  onInstructionChange,
  onSaveInstruction,
}: RepoInstructionPanelProps) {
  return (
    <section className="panel instructionPanel">
      <div className="sectionHeader">
        <h2>Repo 备注</h2>
        <span>{repoInstruction?.updatedAt ? `备注更新于 ${new Date(repoInstruction.updatedAt).toLocaleTimeString()}` : "尚未加载"}</span>
      </div>

      {repoInstruction ? (
        <>
          <div className="instructionBlock">
            <div className="moduleBlockHeader">
              <strong>自动上下文</strong>
              <small>只读</small>
            </div>
            <pre className="instructionReadonly">{repoInstruction.generatedContent}</pre>
          </div>

          <div className="instructionBlock">
            <div className="moduleBlockHeader">
              <strong>用户备注</strong>
              <small>保存路径：{repoInstruction.path}</small>
            </div>
            <textarea
              className="instructionNotes"
              value={instructionDraft}
              onChange={(event) => onInstructionChange(event.target.value)}
              placeholder="补充 repo 特有的工作流、验证方式、禁区和长期偏好。"
              rows={7}
            />
            <div className="instructionActions">
              <button type="button" className="secondaryButton" onClick={() => void onSaveInstruction()} disabled={isSavingInstruction}>
                {isSavingInstruction ? "保存中" : "保存备注"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="emptyState">当前没有 repo 备注。</p>
      )}
    </section>
  );
}