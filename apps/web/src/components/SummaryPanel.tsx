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
    title: typeof summary.title === "string" && summary.title.length > 0 ? summary.title : "result",
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
        : "等待后续操作。",
  };
}

function summaryOutcomeTitle(snapshot: SessionSnapshot) {
  if (!snapshot.summary) {
    return "idle";
  }

  if (snapshot.status === "running") {
    return "running";
  }

  if (snapshot.status === "awaiting-approval") {
    return "approval_pending";
  }

  if (snapshot.status === "recovering") {
    return "recovering";
  }

  if (snapshot.status === "timed-out") {
    return "timed_out";
  }

  return "done";
}

function summaryOutcomeDetail(snapshot: SessionSnapshot) {
  if (!snapshot.summary) {
    return "result_pending";
  }

  if (snapshot.status === "running") {
    return "result_streaming";
  }

  if (snapshot.status === "awaiting-approval") {
    return "approval_blocked";
  }

  if (snapshot.status === "recovering") {
    return "history_recovering";
  }

  if (snapshot.status === "timed-out") {
    return "partial_result";
  }

  return "result_ready";
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
        <h2>summary</h2>
        <span>{snapshot.model} / 最近更新 {new Date(snapshot.updatedAt).toLocaleTimeString()}</span>
      </div>

      {summary ? (
        <div className="summaryCard">
          <div className="summaryTopline">
            <span className="summaryToplineLabel">state</span>
            <span className="summaryToplineValue">{summary.title}</span>
          </div>
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
              <strong>steps</strong>
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
              <dt>commands <span className="summaryInlineBadge">{summary.executedCommands.length}</span></dt>
              <dd><RenderSummaryItems items={summary.executedCommands} emptyLabel="当前没有执行命令" /></dd>
            </div>
            <div>
              <dt>approval_types <span className="summaryInlineBadge">{summary.approvalTypes?.length ?? 0}</span></dt>
              <dd><RenderSummaryItems items={summary.approvalTypes ?? []} emptyLabel="当前没有审批类型" renderItem={(item) => approvalTypeLabel(item as ApprovalType)} /></dd>
            </div>
            <div>
              <dt>files <span className="summaryInlineBadge">{summary.changedFiles.length}</span></dt>
              <dd><RenderSummaryItems items={summary.changedFiles} emptyLabel="当前没有文件变更" /></dd>
            </div>
            <div>
              <dt>checks <span className="summaryInlineBadge">{summary.checks.length}</span></dt>
              <dd><RenderSummaryItems items={summary.checks} emptyLabel="当前没有检查结果" /></dd>
            </div>
            <div>
              <dt>risks <span className="summaryInlineBadge">{summary.risks.length}</span></dt>
              <dd><RenderSummaryItems items={summary.risks} emptyLabel="当前没有风险项" /></dd>
            </div>
          </dl>

          <div className="nextAction">
            <span>next_action</span>
            <strong>{summary.nextAction}</strong>
          </div>
        </div>
      ) : (
        <p className="emptyState">当前没有 summary。</p>
      )}
    </>
  );
}