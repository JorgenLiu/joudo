import { useState } from "react";

import type { ApprovalType, SessionSnapshot, SessionSummary, SessionSummaryStep } from "@joudo/shared";

import { CompactText } from "./CompactText";
import { approvalTypeLabel, sessionStatusLabel, sessionStatusTone, summaryStepKindLabel, summaryStepStatusLabel } from "./display";
import { MarkdownBody } from "./MarkdownBody";

type SummaryPanelProps = {
  snapshot: SessionSnapshot;
};

function normalizeSummaryStep(step: Partial<SessionSummaryStep>, index: number): SessionSummaryStep {
  return {
    id: typeof step.id === "string" && step.id.length > 0 ? step.id : `legacy-step-${index}`,
    kind: step.kind ?? "status",
    status: step.status ?? "completed",
    title: typeof step.title === "string" && step.title.length > 0 ? step.title : `步骤 ${index + 1}`,
    detail: typeof step.detail === "string" ? step.detail : "",
    ...(typeof step.timestamp === "string" ? { timestamp: step.timestamp } : {}),
  };
}

function normalizeSummary(summary: SessionSnapshot["summary"]): SessionSummary | null {
  if (!summary) {
    return null;
  }

  const steps = Array.isArray(summary.steps)
    ? summary.steps.map((step, index) => normalizeSummaryStep(step, index))
    : [];

  return {
    title: typeof summary.title === "string" && summary.title.length > 0 ? summary.title : "已恢复执行摘要",
    body: typeof summary.body === "string" ? summary.body : "",
    steps,
    executedCommands: Array.isArray(summary.executedCommands) ? summary.executedCommands : [],
    approvalTypes: Array.isArray(summary.approvalTypes) ? summary.approvalTypes : [],
    changedFiles: Array.isArray(summary.changedFiles) ? summary.changedFiles : [],
    checks: Array.isArray(summary.checks) ? summary.checks : [],
    risks: Array.isArray(summary.risks) ? summary.risks : [],
    nextAction:
      typeof summary.nextAction === "string" && summary.nextAction.length > 0
        ? summary.nextAction
        : "先查看本轮已恢复的摘要和时间线，再决定是否继续下一步。",
  };
}

function summaryOutcomeTitle(snapshot: SessionSnapshot) {
  if (!snapshot.summary) {
    return "尚未生成执行摘要";
  }

  if (snapshot.status === "running") {
    return "本轮仍在执行中";
  }

  if (snapshot.status === "awaiting-approval") {
    return "当前在等待你的确认";
  }

  if (snapshot.status === "recovering") {
    return "正在恢复历史记录";
  }

  if (snapshot.status === "timed-out") {
    return "当前保留的是一轮超时结果";
  }

  return "当前摘要已经收口";
}

function summaryOutcomeDetail(snapshot: SessionSnapshot) {
  if (!snapshot.summary) {
    return "发送第一条提示词后，这里会开始整理本轮结果、关键风险和下一步。";
  }

  if (snapshot.status === "running") {
    return "摘要已经开始记录当前任务，但结果仍可能继续变化。";
  }

  if (snapshot.status === "awaiting-approval") {
    return "当前结果还没有最终收口，先处理审批才能继续判断这一轮会如何结束。";
  }

  if (snapshot.status === "recovering") {
    return "Joudo 正在把历史记录和当前状态重新整理成可继续使用的视图。";
  }

  if (snapshot.status === "timed-out") {
    return "这轮没有在等待窗口内完成，但已保留到目前为止可解释的结果。";
  }

  return "这一轮当前能解释的结果、风险和下一步已经整理到下面。";
}

function summaryCountLabel(count: number, unit: string) {
  return `${count} ${unit}`;
}

const PILL_COLLAPSE_THRESHOLD = 6;

function RenderSummaryItems({ items, emptyLabel, renderItem }: { items: string[]; emptyLabel: string; renderItem?: (item: string) => string }) {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) {
    return <span className="summaryEmptyLabel">{emptyLabel}</span>;
  }

  const visible = expanded ? items : items.slice(0, PILL_COLLAPSE_THRESHOLD);
  const remaining = items.length - PILL_COLLAPSE_THRESHOLD;

  return (
    <div className="summaryPillList">
      {visible.map((item, index) => (
        <span key={`${item}-${index}`} className="summaryPill">
          <CompactText text={renderItem ? renderItem(item) : item} as="span" maxChars={72} />
        </span>
      ))}
      {!expanded && remaining > 0 ? (
        <button type="button" className="compactToggle" onClick={() => setExpanded(true)}>+{remaining} 更多</button>
      ) : null}
      {expanded && remaining > 0 ? (
        <button type="button" className="compactToggle" onClick={() => setExpanded(false)}>收起</button>
      ) : null}
    </div>
  );
}

const STEP_COLLAPSE_THRESHOLD = 5;

export function SummaryPanel({ snapshot }: SummaryPanelProps) {
  const summary = normalizeSummary(snapshot.summary);
  const [stepsExpanded, setStepsExpanded] = useState(false);

  return (
    <>
      <div className="sectionHeader">
        <h2>摘要</h2>
        <span>{snapshot.model} / 最近更新 {new Date(snapshot.updatedAt).toLocaleTimeString()}</span>
      </div>

      {summary ? (
        <div className="summaryCard">
          <div className="summaryOutcomeHeader">
            <div>
              <h3>{summaryOutcomeTitle(snapshot)}</h3>
              <p>{summaryOutcomeDetail(snapshot)}</p>
            </div>
            <span className={`statusTag ${sessionStatusTone(snapshot.status)}`}>{sessionStatusLabel(snapshot.status)}</span>
          </div>

          <div className="summaryHero">
            <strong>{summary.title}</strong>
            <MarkdownBody text={summary.body} />
          </div>

          <div className="activityCheckpointSection">
            <div className="activitySubsectionHeader">
              <strong>本轮执行步骤</strong>
              <span>{summary.steps.length} 条</span>
            </div>
            <div className="activityItemList">
              {(stepsExpanded ? summary.steps : summary.steps.slice(0, STEP_COLLAPSE_THRESHOLD)).map((step) => (
                <article key={step.id} className={`activityItem ${step.kind}`}>
                  <div className="activityItemMeta">
                    <span>{summaryStepStatusLabel(step.status)}</span>
                    <span>{summaryStepKindLabel(step.kind)}</span>
                  </div>
                  <strong>{step.title}</strong>
                  <CompactText text={step.detail} as="p" maxChars={220} />
                </article>
              ))}
              {!stepsExpanded && summary.steps.length > STEP_COLLAPSE_THRESHOLD ? (
                <button type="button" className="compactToggle" onClick={() => setStepsExpanded(true)}>
                  查看全部 {summary.steps.length} 条
                </button>
              ) : null}
              {stepsExpanded && summary.steps.length > STEP_COLLAPSE_THRESHOLD ? (
                <button type="button" className="compactToggle" onClick={() => setStepsExpanded(false)}>收起</button>
              ) : null}
            </div>
          </div>

          <dl className="summaryList">
            <div>
              <dt>执行命令 <span className="summaryInlineBadge">{summary.executedCommands.length}</span></dt>
              <dd><RenderSummaryItems items={summary.executedCommands} emptyLabel="暂无" /></dd>
            </div>
            <div>
              <dt>审批类型 <span className="summaryInlineBadge">{summary.approvalTypes?.length ?? 0}</span></dt>
              <dd><RenderSummaryItems items={summary.approvalTypes ?? []} emptyLabel="暂无" renderItem={(item) => approvalTypeLabel(item as ApprovalType)} /></dd>
            </div>
            <div>
              <dt>文件变更 <span className="summaryInlineBadge">{summary.changedFiles.length}</span></dt>
              <dd><RenderSummaryItems items={summary.changedFiles} emptyLabel="暂无" /></dd>
            </div>
            <div>
              <dt>检查 <span className="summaryInlineBadge">{summary.checks.length}</span></dt>
              <dd><RenderSummaryItems items={summary.checks} emptyLabel="暂无" /></dd>
            </div>
            <div>
              <dt>风险 <span className="summaryInlineBadge">{summary.risks.length}</span></dt>
              <dd><RenderSummaryItems items={summary.risks} emptyLabel="暂无" /></dd>
            </div>
          </dl>

          <div className="nextAction">
            <span>下一步</span>
            <strong>{summary.nextAction}</strong>
          </div>
        </div>
      ) : (
        <p className="emptyState">bridge 还没有产生摘要。</p>
      )}
    </>
  );
}