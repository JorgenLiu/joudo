import type { SessionIndexDocument } from "@joudo/shared";

import { persistedSessionStatusLabel } from "./display";

type SessionHistoryPanelProps = {
  sessionIndex: SessionIndexDocument | null;
  isRecoveringSession: boolean;
  onRecoverSession: (joudoSessionId: string) => void | Promise<void>;
};

function recoveryNote(entry: NonNullable<SessionIndexDocument>["sessions"][number]) {
  if (entry.status === "timed-out") {
    return "这条记录上次已超时。只能恢复记录，不能直接续跑旧任务。";
  }

  if (entry.recoveryMode === "attach") {
    return "Joudo 会先恢复记录，再尝试接回旧会话。失败时会退回只读历史。";
  }

  if (entry.hasPendingApprovals) {
    return "这条记录只能恢复记录。旧审批不会在重连后继续等待。";
  }

  return "这条记录只能恢复记录，未完成的执行不会继续。";
}

function recoveryActionLabel(entry: NonNullable<SessionIndexDocument>["sessions"][number], isRecoveringSession: boolean) {
  if (isRecoveringSession) {
    return entry.recoveryMode === "attach" ? "恢复中..." : "载入中...";
  }

  return entry.recoveryMode === "attach" ? "恢复并尝试接管" : "只恢复记录";
}

export function SessionHistoryPanel({ sessionIndex, isRecoveringSession, onRecoverSession }: SessionHistoryPanelProps) {
  return (
    <div className="sessionHistoryPanel">
      <div className="sectionHeader">
        <h2>历史会话</h2>
        <span>{sessionIndex ? `${sessionIndex.sessions.length} 条记录` : "尚未加载"}</span>
      </div>

      {sessionIndex && sessionIndex.sessions.length ? (
        <div className="sessionHistoryList">
          {sessionIndex.sessions.map((entry) => (
            <article key={entry.id} className="sessionHistoryCard">
              <div className="sessionHistoryHeader">
                <strong>{entry.title}</strong>
                <span className={`statusTag ${entry.status}`}>{persistedSessionStatusLabel(entry.status)}</span>
              </div>
              <small>更新于 {new Date(entry.updatedAt).toLocaleString()}</small>
              <small>轮次 {entry.turnCount}</small>
              {entry.lastPromptPreview ? <p>{entry.lastPromptPreview}</p> : null}
              {entry.summaryPreview ? <small>{entry.summaryPreview}</small> : null}
              <small className="sessionHistoryNote">{recoveryNote(entry)}</small>
              <div className="sessionHistoryActions">
                <button className="secondaryButton" type="button" disabled={isRecoveringSession} onClick={() => void onRecoverSession(entry.id)}>
                  {recoveryActionLabel(entry, isRecoveringSession)}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="emptyState">当前 repo 还没有历史会话记录。</p>
      )}
    </div>
  );
}