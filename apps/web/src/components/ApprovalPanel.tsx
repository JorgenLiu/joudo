import { useCallback, useState } from "react";

import type { ApprovalResolutionPayload, ApprovalRequest, SessionTimelineEntry } from "@joudo/shared";

import { CompactText } from "./CompactText";
import { ConfirmDialog } from "./ConfirmDialog";
import { approvalTypeLabel } from "./display";

type ApprovalPanelProps = {
  approvals: ApprovalRequest[];
  latestPersistedApproval?: SessionTimelineEntry | null;
  onResolveApproval: (request: ApprovalRequest, decision: ApprovalResolutionPayload["decision"]) => Promise<void>;
};

type PendingConfirm = {
  request: ApprovalRequest;
  decision: ApprovalResolutionPayload["decision"];
  title: string;
  description: string;
};

export function ApprovalPanel({ approvals, latestPersistedApproval = null, onResolveApproval }: ApprovalPanelProps) {
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  function requestResolve(request: ApprovalRequest, decision: ApprovalResolutionPayload["decision"]) {
    if (decision !== "deny" && request.riskLevel === "high") {
      setPendingConfirm({
        request,
        decision,
        title: "确认放行高风险操作",
        description:
          decision === "allow-and-persist"
            ? `这条审批会放行高风险操作，并把对应规则写入当前仓库 policy：${request.target}\n\n如果继续，Copilot 会立即基于这项权限继续执行，后续同类请求也会优先命中 allowlist。`
            : `这条审批会放行高风险操作：${request.target}\n\n如果继续，Copilot 会立即基于这项权限继续执行。`,
      });
      return;
    }

    if (decision === "allow-and-persist" && request.riskLevel !== "high") {
      setPendingConfirm({
        request,
        decision,
        title: "确认写入 Policy",
        description: `这条审批会把对应规则写入当前仓库 policy：${request.target}\n\n如果继续，后续同类请求会优先命中 allowlist。`,
      });
      return;
    }

    void executeResolve(request, decision);
  }

  async function executeResolve(request: ApprovalRequest, decision: ApprovalResolutionPayload["decision"]) {
    try {
      setPendingApprovalId(request.id);
      await onResolveApproval(request, decision);
    } finally {
      setPendingApprovalId(null);
    }
  }

  const handleConfirm = useCallback(() => {
    if (pendingConfirm) {
      void executeResolve(pendingConfirm.request, pendingConfirm.decision);
    }
    setPendingConfirm(null);
  }, [pendingConfirm]);

  const handleCancelConfirm = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  return (
    <section className="panel approvalPanel">
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description ?? ""}
        confirmLabel="确认放行"
        cancelLabel="取消"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
      />
      <div className="sectionHeader">
        <h2>审批</h2>
        <span>{approvals.length ? `${approvals.length} 条待处理请求` : "当前无待审批请求"}</span>
      </div>
      {latestPersistedApproval?.decision?.matchedRule && !approvals.length ? (
        <div className="approvalPersistedCard">
          <div className="approvalPersistedHeader">
            <strong>已加入当前 repo policy</strong>
            <span className="statusTag recovering">allowlist 已更新</span>
          </div>
          <p>{latestPersistedApproval.body}</p>
          <dl className="approvalMetaList approvalPersistedMetaList">
            <div>
              <dt>写入规则</dt>
              <dd>{latestPersistedApproval.decision.matchedRule}</dd>
            </div>
            <div>
              <dt>权限类型</dt>
              <dd>
                {latestPersistedApproval.decision.approvalType
                  ? approvalTypeLabel(latestPersistedApproval.decision.approvalType)
                  : "策略外请求"}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      {approvals.length ? (
        <div className="approvalQueue">
          {approvals.map((approval, index) => {
            const isPending = pendingApprovalId === approval.id;
            const supportsPolicyPersist = approval.requestKind === "shell" || approval.requestKind === "read" || approval.requestKind === "write";

            return (
              <div key={approval.id} className="approvalCard">
                <div className="approvalHeader">
                  <div>
                    <small>第 {index + 1} / {approvals.length} 条</small>
                    <h3>{approval.title}</h3>
                  </div>
                  <span className={`statusTag ${approval.riskLevel}`}>{approval.riskLevel === "high" ? "高风险" : "中风险"}</span>
                </div>
                <div className="approvalTopline">
                  <span className="approvalToplineLabel">Target</span>
                  <span className="approvalToplineValue">{approval.target}</span>
                </div>
                <p>{approval.rationale}</p>
                <CompactText text={approval.commandPreview} as="code" mono maxChars={200} />
                <details className="collapsible approvalDetailFields">
                  <summary>详细信息</summary>
                  <dl className="approvalMetaList">
                    <div>
                      <dt>审批类型</dt>
                      <dd>{approvalTypeLabel(approval.approvalType)}</dd>
                    </div>
                    <div>
                      <dt>命中规则</dt>
                      <dd>{approval.matchedRule ?? "当前没有更具体的 allowlist 命中，属于策略外请求"}</dd>
                    </div>
                    <div>
                      <dt>作用对象</dt>
                      <dd>{approval.target}</dd>
                    </div>
                    <div>
                      <dt>影响范围</dt>
                      <dd>{approval.scope}</dd>
                    </div>
                    <div>
                      <dt>如果批准</dt>
                      <dd>{approval.impact}</dd>
                    </div>
                    <div>
                      <dt>如果拒绝</dt>
                      <dd>{approval.denyImpact}</dd>
                    </div>
                  </dl>
                </details>
                <div className="approvalActions">
                  <button type="button" className="approvalDenyBtn" disabled={isPending} onClick={() => void requestResolve(approval, "deny")}>
                    {isPending ? "处理中" : "拒绝"}
                  </button>
                  <button type="button" disabled={isPending} onClick={() => void requestResolve(approval, "allow-once")}>
                    {isPending ? "处理中" : "允许本次"}
                  </button>
                  {supportsPolicyPersist ? (
                    <button type="button" className="approvalPersistBtn" disabled={isPending} onClick={() => void requestResolve(approval, "allow-and-persist")}>
                      {isPending ? "处理中" : "允许并加入 policy"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="emptyState">当前没有待审批请求。</p>
      )}
    </section>
  );
}