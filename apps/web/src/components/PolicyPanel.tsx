import { useCallback, useEffect, useState } from "react";

import type { RepoPolicyRule, SessionSnapshot } from "@joudo/shared";

import { ConfirmDialog } from "./ConfirmDialog";
import { policyRuleFieldLabel, policyRuleRiskLabel, policyRuleSourceLabel } from "./display";

type PolicyPanelProps = {
  snapshot: SessionSnapshot;
  onDeleteRule: (rule: RepoPolicyRule) => Promise<void>;
};

type CopyTarget = {
  id: string;
  text: string;
};

function policyStateLabel(state: SessionSnapshot["repo"] extends null ? never : NonNullable<SessionSnapshot["policy"]>["state"]) {
  switch (state) {
    case "loaded":
      return "已加载";
    case "invalid":
      return "无效";
    case "missing":
    default:
      return "缺失";
  }
}

function summaryCountLabel(count: number, unit: string) {
  return `${count} ${unit}`;
}

function policySectionDescription(field: RepoPolicyRule["field"]) {
  switch (field) {
    case "allowedWritePaths":
      return "这些规则会决定哪些写入可以在持久化后直接自动允许。";
    case "allowShell":
      return "这些 shell 模式会在命中时直接进入 allowlist。";
    case "allowedPaths":
    default:
      return "这些路径会扩展当前 repo 的自动读取边界。";
  }
}

function deleteImpactCopy(rule: RepoPolicyRule) {
  switch (rule.field) {
    case "allowedWritePaths":
      return "删除后，命中这条写入规则的请求会重新进入审批或被当前策略拒绝。";
    case "allowShell":
      return "删除后，命中这条 shell allowlist 的命令会重新进入策略判定。";
    case "allowedPaths":
    default:
      return "删除后，命中这条读取规则的请求会重新进入审批或被当前策略收紧。";
  }
}

async function copyRuleText(target: CopyTarget, setCopiedRuleId: (value: string | null) => void) {
  if (!navigator.clipboard?.writeText) {
    return;
  }

  await navigator.clipboard.writeText(target.text);
  setCopiedRuleId(target.id);
}

function copyButtonLabel(copiedRuleId: string | null, targetId: string) {
  return copiedRuleId === targetId ? "已复制" : "复制规则";
}

function renderRuleList(
  rules: RepoPolicyRule[],
  emptyLabel: string,
  onRequestDelete: (rule: RepoPolicyRule) => void,
  deletingRuleId: string | null,
  copiedRuleId: string | null,
  setCopiedRuleId: (value: string | null) => void,
) {
  if (!rules.length) {
    return <p className="summaryEmptyLabel">{emptyLabel}</p>;
  }

  return (
    <div className="policyRuleList">
      {rules.map((rule) => (
        <article key={rule.id} className="policyRuleCard">
          <div className="policyRuleHeader">
            <strong>{rule.value}</strong>
            <div className="policyRuleTags">
              <span className="statusTag recovering">{policyRuleSourceLabel(rule.source)}</span>
              <span className={`statusTag ${rule.risk}`}>{policyRuleRiskLabel(rule.risk)}</span>
            </div>
          </div>
          <p className="policyRuleMatched">{rule.matchedRule}</p>
          {rule.note ? <p className="policyRuleNote">{rule.note}</p> : null}
          <dl className="policyRuleMetaList">
            <div>
              <dt>规则类型</dt>
              <dd>{policyRuleFieldLabel(rule.field)}</dd>
            </div>
            <div>
              <dt>最近来源</dt>
              <dd>{rule.lastUpdatedAt ? new Date(rule.lastUpdatedAt).toLocaleString() : "当前未记录"}</dd>
            </div>
          </dl>
          <div className="policyRuleActions">
            <button
              type="button"
              className="secondaryButton"
              onClick={() => void copyRuleText({ id: `rule:${rule.id}`, text: rule.matchedRule }, setCopiedRuleId)}
            >
              {copyButtonLabel(copiedRuleId, `rule:${rule.id}`)}
            </button>
            <button type="button" className="secondaryButton" disabled={deletingRuleId === rule.id} onClick={() => onRequestDelete(rule)}>
              {deletingRuleId === rule.id ? "删除中…" : "删除规则"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PolicyPanel({ snapshot, onDeleteRule }: PolicyPanelProps) {
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RepoPolicyRule | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const policy = snapshot.policy ?? null;
  const rules = policy?.rules ?? [];
  const writeRules = rules.filter((rule) => rule.field === "allowedWritePaths");
  const shellRules = rules.filter((rule) => rule.field === "allowShell");
  const readRules = rules.filter((rule) => rule.field === "allowedPaths");
  const latestPersistedRule = [...rules]
    .filter((rule) => rule.isPersistedFromApproval && rule.lastUpdatedAt)
    .sort((left, right) => Number(new Date(right.lastUpdatedAt ?? 0)) - Number(new Date(left.lastUpdatedAt ?? 0)))[0] ?? null;

  useEffect(() => {
    if (!copiedRuleId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopiedRuleId(null);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copiedRuleId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const rule = deleteTarget;
    setDeleteTarget(null);
    setDeletingRuleId(rule.id);
    try {
      await onDeleteRule(rule);
    } finally {
      setDeletingRuleId(null);
    }
  }, [deleteTarget, onDeleteRule]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  return (
    <section className="panel policyPanel">
      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除规则"
        description={deleteTarget ? `这会从当前 repo policy 删除这条规则：${deleteTarget.value}\n\n${deleteImpactCopy(deleteTarget)}` : ""}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={handleCancelDelete}
      />
      <div className="sectionHeader">
        <h2>Repo Policy</h2>
        <span>{policy ? policyStateLabel(policy.state) : "未加载"}</span>
      </div>

      {policy ? (
        <div className="policyCard">
          <div className="policyHero">
            <strong>
              {writeRules.length
                ? `当前有 ${summaryCountLabel(writeRules.length, "条")}受控写入规则`
                : "当前还没有受控写入规则"}
            </strong>
            <p>
              {writeRules.length
                ? "当前 repo policy 已经开始收敛为结构化规则视图，你可以直接看出哪些规则来自审批持久化。"
                : "当你对 write 审批选择“允许并加入 policy”后，这里会直接显示当前 repo 已持久化的写入目标。"}
            </p>
            <small>{policy.path ? `Policy 文件：${policy.path}` : "当前 repo 还没有 policy 文件。"}</small>
          </div>

          <div className="policyOverviewGrid">
            <article className="policyOverviewStat">
              <span>总规则数</span>
              <strong>{summaryCountLabel(rules.length, "条")}</strong>
            </article>
            <article className="policyOverviewStat">
              <span>受控写入</span>
              <strong>{summaryCountLabel(writeRules.length, "条")}</strong>
            </article>
            <article className="policyOverviewStat">
              <span>Shell allowlist</span>
              <strong>{summaryCountLabel(shellRules.length, "条")}</strong>
            </article>
            <article className="policyOverviewStat">
              <span>读取路径</span>
              <strong>{summaryCountLabel(readRules.length, "条")}</strong>
            </article>
          </div>

          {latestPersistedRule ? (
            <div className="policyRecentBanner">
              <span className="statusTag recovering">来自审批持久化</span>
              <span>最近新增：<strong>{latestPersistedRule.value}</strong>（{policyRuleFieldLabel(latestPersistedRule.field)}）</span>
            </div>
          ) : null}

          <details className="collapsible">
            <summary>{`allowed_write_paths (${writeRules.length})`}</summary>
            <div className="policySectionContent">
              <p className="policySectionDesc">{policySectionDescription("allowedWritePaths")}</p>
              {renderRuleList(writeRules, "当前没有受控写入规则。", setDeleteTarget, deletingRuleId, copiedRuleId, setCopiedRuleId)}
            </div>
          </details>

          <details className="collapsible">
            <summary>{`allow_shell (${shellRules.length})`}</summary>
            <div className="policySectionContent">
              <p className="policySectionDesc">{policySectionDescription("allowShell")}</p>
              {renderRuleList(shellRules, "当前没有 shell allowlist。", setDeleteTarget, deletingRuleId, copiedRuleId, setCopiedRuleId)}
            </div>
          </details>

          <details className="collapsible">
            <summary>{`allowed_paths (${readRules.length})`}</summary>
            <div className="policySectionContent">
              <p className="policySectionDesc">{policySectionDescription("allowedPaths")}</p>
              {renderRuleList(readRules, "当前没有额外读取路径规则。", setDeleteTarget, deletingRuleId, copiedRuleId, setCopiedRuleId)}
            </div>
          </details>

          {policy.error ? <p className="errorBox compact">{policy.error}</p> : null}
        </div>
      ) : (
        <div className="policyCard">
          <p className="emptyState">当前还没有可展示的 repo policy 摘要。</p>
        </div>
      )}
    </section>
  );
}