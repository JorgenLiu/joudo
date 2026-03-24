import { useState } from "react";

import type { SessionActivity, SessionCheckpointDocument } from "@joudo/shared";

import { CompactText } from "./CompactText";
import { activityItemStatusLabel, activityPhaseLabel, activityPhaseTone } from "./display";

const ACTIVITY_ITEMS_LIMIT = 15;

type ActivityPanelProps = {
  activity: SessionActivity | null;
  selectedCheckpoint: SessionCheckpointDocument | null;
  isLoadingCheckpoint: boolean;
  isRollingBack: boolean;
  onOpenCheckpoint: (checkpointNumber: number) => Promise<void>;
  onRollbackLatestTurn: () => Promise<void>;
  onClearCheckpointSelection: () => void;
};

function normalizeActivity(activity: SessionActivity | null): SessionActivity | null {
  if (!activity) {
    return null;
  }

  return {
    ...activity,
    items: Array.isArray(activity.items) ? activity.items : [],
    commands: Array.isArray(activity.commands) ? activity.commands : [],
    changedFiles: Array.isArray(activity.changedFiles) ? activity.changedFiles : [],
    checkpoints: Array.isArray(activity.checkpoints) ? activity.checkpoints : [],
    blockers: Array.isArray(activity.blockers) ? activity.blockers : [],
    latestCompaction: activity.latestCompaction
      ? {
          ...activity.latestCompaction,
          messagesRemoved:
            typeof activity.latestCompaction.messagesRemoved === "number" ? activity.latestCompaction.messagesRemoved : 0,
          tokensRemoved:
            typeof activity.latestCompaction.tokensRemoved === "number" ? activity.latestCompaction.tokensRemoved : 0,
        }
      : null,
    latestTurn: activity.latestTurn
      ? {
          ...activity.latestTurn,
          changedFiles: Array.isArray(activity.latestTurn.changedFiles) ? activity.latestTurn.changedFiles : [],
        }
      : null,
    rollback: activity.rollback
      ? {
          ...activity.rollback,
          changedFiles: Array.isArray(activity.rollback.changedFiles) ? activity.rollback.changedFiles : [],
          trackedPaths: Array.isArray(activity.rollback.trackedPaths) ? activity.rollback.trackedPaths : [],
        }
      : null,
  };
}

function compactionSummary(activity: SessionActivity) {
  if (!activity.latestCompaction) {
    return "暂无";
  }

  const checkpointLabel =
    activity.latestCompaction.checkpointNumber === undefined
      ? "最近一次会话压缩"
      : `checkpoint #${activity.latestCompaction.checkpointNumber}`;

  const summaryPreview = activity.latestCompaction.summaryPreview
    ? ` / ${activity.latestCompaction.summaryPreview}`
    : "";

  return `${checkpointLabel} / 移除 ${activity.latestCompaction.messagesRemoved} 条消息 / 释放 ${activity.latestCompaction.tokensRemoved} tokens${summaryPreview}`;
}

function rollbackStatusLabel(activity: SessionActivity) {
  if (!activity.rollback) {
    return "暂无可回退记录";
  }

  switch (activity.rollback.status) {
    case "no-changes":
      return "本轮无可回退改动";
    case "ready":
      return activity.rollback.executor === "joudo-write-journal" ? "可直接回退（Joudo 基线）" : "可直接回退（/undo）";
    case "reverted":
      return "已回到上一轮基线";
    case "needs-review":
      return activity.rollback.changedFiles.some((item) => item.source === "derived") ? "检测到越界写入，需人工确认" : "需人工确认";
    case "history-only":
      return "当前只有历史记录";
    case "session-unavailable":
      return "旧会话不可用";
    case "workspace-drifted":
      return "工作区已偏离记录状态";
    default:
      return activity.rollback.reason;
  }
}

function rollbackExecutorLabel(activity: SessionActivity) {
  if (!activity.rollback) {
    return "Joudo 判定";
  }

  return activity.rollback.executor === "joudo-write-journal" ? "Joudo 基线回退" : "Copilot /undo";
}

function rollbackDecisionHint(activity: SessionActivity) {
  if (!activity.rollback) {
    return null;
  }

  switch (activity.rollback.status) {
    case "ready":
      return activity.rollback.executor === "joudo-write-journal"
        ? "上一轮改动全部落在 Joudo 已记录的基线内，可以直接恢复。"
        : "上一轮改动仍在 Joudo 的证据边界内，可以直接尝试 /undo。";
    case "needs-review":
      return activity.rollback.changedFiles.some((item) => item.source === "derived")
        ? "检测到了候选路径之外的写入。Joudo 不会自动扩大回退范围，所以这里先要求人工确认。"
        : "这轮回退还没有被 Joudo 验证为完整恢复，继续前先人工确认当前工作区。";
    case "history-only":
      return "当前只恢复了历史记录，不能直接把旧会话当成可执行回退目标。";
    case "session-unavailable":
      return "原始 Copilot session 已不可用。只有 Joudo 自己掌握完整基线时，才可能继续回退。";
    case "workspace-drifted":
      return "当前工作区已经偏离上一轮记录结束时的状态，Joudo 不再把它视为安全的一键回退。";
    case "reverted":
      return "Joudo 已重新校验，当前工作区已经回到上一轮开始前的基线。";
    case "no-changes":
      return "这一轮没有形成 Joudo 可解释的改动记录，所以不会提供回退动作。";
    default:
      return null;
  }
}

function rollbackTrackedScope(activity: SessionActivity) {
  if (!activity.rollback?.trackedPaths?.length) {
    return null;
  }

  return activity.rollback.trackedPaths.join(" / ");
}

function rollbackUnexpectedChanges(activity: SessionActivity) {
  return activity.rollback?.changedFiles.filter((item) => item.source === "derived") ?? [];
}

export function ActivityPanel({
  activity,
  selectedCheckpoint,
  isLoadingCheckpoint,
  isRollingBack,
  onOpenCheckpoint,
  onRollbackLatestTurn,
  onClearCheckpointSelection,
}: ActivityPanelProps) {
  const safeActivity = normalizeActivity(activity);
  const [itemsExpanded, setItemsExpanded] = useState(false);

  return (
    <div className="activityPanel">
      <div className="sectionHeader">
        <h2>执行轨迹</h2>
        <span>{safeActivity ? new Date(safeActivity.updatedAt).toLocaleTimeString() : "尚未开始"}</span>
      </div>

      {safeActivity ? (
        <div className="activityCard">
          <div className="activityHeader">
            <div>
              <strong>{safeActivity.headline}</strong>
              <p>{safeActivity.detail}</p>
            </div>
            <span className={`statusTag ${activityPhaseTone(safeActivity.phase)}`}>{activityPhaseLabel(safeActivity.phase)}</span>
          </div>

          <dl className="activityMetaList">
            <div>
              <dt>当前意图</dt>
              <dd>
                <CompactText text={safeActivity.intent ?? "尚未发送提示词"} as="span" maxChars={140} />
              </dd>
            </div>
            <div>
              <dt>最近命令</dt>
              <dd>
                <CompactText
                  text={safeActivity.commands.length ? safeActivity.commands.map((item) => item.command).join(" / ") : "暂无"}
                  as="span"
                  maxChars={220}
                />
              </dd>
            </div>
            <div>
              <dt>已观测文件变更</dt>
              <dd>
                <CompactText
                  text={safeActivity.changedFiles.length ? safeActivity.changedFiles.map((item) => item.path).join(" / ") : "暂无"}
                  as="span"
                  maxChars={220}
                />
              </dd>
            </div>
            <div>
              <dt>Session Workspace</dt>
              <dd className="activityPathValue">
                <CompactText text={safeActivity.workspacePath ?? "暂无"} as="span" mono maxChars={160} />
              </dd>
            </div>
            <div>
              <dt>最近一次 Compaction</dt>
              <dd>
                <CompactText text={compactionSummary(safeActivity)} as="span" maxChars={220} />
              </dd>
            </div>
            <div>
              <dt>可用 Checkpoints</dt>
              <dd>{safeActivity.checkpoints.length ? `${safeActivity.checkpoints.length} 个` : "暂无"}</dd>
            </div>
            <div>
              <dt>上一轮回退</dt>
              <dd>{rollbackStatusLabel(safeActivity)}</dd>
            </div>
          </dl>

          {safeActivity.rollback ? (
            <div className="activityCheckpointSection">
              <div className="activitySubsectionHeader">
                <strong>撤回上一轮改动</strong>
                <span>{rollbackExecutorLabel(safeActivity)}</span>
              </div>
              <div className="activityRollbackCard">
                <p>
                  <strong>当前判定：</strong>
                  {rollbackStatusLabel(safeActivity)}
                </p>
                <p>{rollbackDecisionHint(safeActivity) ?? safeActivity.rollback.reason}</p>
                {rollbackTrackedScope(safeActivity) ? (
                  <p>
                    <strong>已跟踪路径：</strong>
                    <CompactText text={rollbackTrackedScope(safeActivity) ?? ""} as="span" mono maxChars={180} />
                  </p>
                ) : null}
                <p>
                  <CompactText
                    text={safeActivity.rollback.changedFiles.length
                      ? `上一轮改动：${safeActivity.rollback.changedFiles.map((item) => item.path).join(" / ")}`
                      : "当前没有记录到上一轮文件改动。"}
                    as="span"
                    mono
                    maxChars={220}
                  />
                </p>
                {rollbackUnexpectedChanges(safeActivity).length ? (
                  <p>
                    <strong>越界写入：</strong>
                    <CompactText
                      text={rollbackUnexpectedChanges(safeActivity)
                        .map((item) => item.path)
                        .join(" / ")}
                      as="span"
                      mono
                      maxChars={180}
                    />
                  </p>
                ) : null}
                <div className="activityCheckpointActions">
                  <button
                    type="button"
                    onClick={() => void onRollbackLatestTurn()}
                    disabled={!safeActivity.rollback.canRollback || isRollingBack}
                  >
                    {isRollingBack ? "正在撤回…" : "撤回上一轮改动"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {safeActivity.checkpoints.length ? (
            <div className="activityCheckpointSection">
              <div className="activitySubsectionHeader">
                <strong>Checkpoint 列表</strong>
                <span>按最近优先显示</span>
              </div>
              <div className="activityCheckpointList">
                {safeActivity.checkpoints.map((checkpoint) => (
                  <article key={checkpoint.path} className="activityCheckpointCard">
                    <div className="activityCheckpointHeader">
                      <strong>{`#${checkpoint.number} ${checkpoint.title}`}</strong>
                      <span className="statusTag muted">{checkpoint.fileName}</span>
                    </div>
                    <CompactText text={checkpoint.path} as="p" mono maxChars={140} />
                    <div className="activityCheckpointActions">
                      <button type="button" onClick={() => void onOpenCheckpoint(checkpoint.number)} disabled={isLoadingCheckpoint}>
                        查看 checkpoint
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {selectedCheckpoint || isLoadingCheckpoint ? (
            <div className="checkpointOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClearCheckpointSelection(); }}>
              <div className="checkpointOverlayContent">
                <div className="checkpointOverlayHeader">
                  <strong>{selectedCheckpoint ? `#${selectedCheckpoint.number} ${selectedCheckpoint.title}` : "Checkpoint 预览"}</strong>
                  <button type="button" className="activityGhostButton" onClick={onClearCheckpointSelection}>关闭</button>
                </div>
                {selectedCheckpoint ? (
                  <>
                    <p className="activityPathValue">
                      <CompactText text={`${selectedCheckpoint.workspacePath}/${selectedCheckpoint.path}`} as="span" mono maxChars={260} />
                    </p>
                    <pre>{selectedCheckpoint.content}</pre>
                  </>
                ) : (
                  <p className="emptyState checkpointOverlayEmpty">正在读取当前 checkpoint 内容…</p>
                )}
              </div>
            </div>
          ) : null}

          {safeActivity.blockers.length ? (
            <div className="activityBlockerList">
              {safeActivity.blockers.map((blocker) => (
                <article key={`${blocker.kind}-${blocker.relatedId ?? blocker.title}`} className="activityBlocker">
                  <strong>{blocker.title}</strong>
                  <p>{blocker.detail}</p>
                  {blocker.nextAction ? <small>下一步：{blocker.nextAction}</small> : null}
                </article>
              ))}
            </div>
          ) : null}

          <div className="activityItemList">
            {(itemsExpanded ? safeActivity.items : safeActivity.items.slice(0, ACTIVITY_ITEMS_LIMIT)).map((item) => (
              <article key={item.id} className={`activityItem ${item.kind}`}>
                <div className="activityItemMeta">
                  <span>{activityItemStatusLabel(item.status)}</span>
                  <time>{new Date(item.timestamp).toLocaleTimeString()}</time>
                </div>
                <strong>{item.title}</strong>
                <CompactText text={item.detail} as="p" maxChars={220} />
              </article>
            ))}
            {!itemsExpanded && safeActivity.items.length > ACTIVITY_ITEMS_LIMIT ? (
              <button type="button" className="compactToggle" onClick={() => setItemsExpanded(true)}>
                加载全部 {safeActivity.items.length} 条
              </button>
            ) : null}
            {itemsExpanded && safeActivity.items.length > ACTIVITY_ITEMS_LIMIT ? (
              <button type="button" className="compactToggle" onClick={() => setItemsExpanded(false)}>收起</button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="activityCard">
          <p className="emptyState">当前没有执行轨迹。</p>
        </div>
      )}
    </div>
  );
}