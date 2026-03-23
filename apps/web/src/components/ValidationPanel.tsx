import type { LivePolicyValidationCheckReport, LivePolicyValidationCoverageEntry, LivePolicyValidationReport } from "@joudo/shared";

import { decisionResolutionLabel } from "./display";

type ValidationPanelProps = {
  validationReport: LivePolicyValidationReport | null;
  isRefreshingValidation: boolean;
  onRefreshValidation: () => Promise<void>;
};

function detailValueLabel(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(" / ");
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (value === null || value === undefined) {
    return "-";
  }

  return String(value);
}

function checkTone(check: LivePolicyValidationCheckReport) {
  return check.success ? "success" : "failure";
}

function coverageTone(entries: LivePolicyValidationCoverageEntry[]) {
  return entries.every((entry) => entry.success) ? "success" : "failure";
}

export function ValidationPanel({ validationReport, isRefreshingValidation, onRefreshValidation }: ValidationPanelProps) {
  const coverageEntries = validationReport ? Object.entries(validationReport.p0Coverage) : [];

  return (
    <div className="validationPanel">
      <div className="sectionHeader">
        <h2>策略回归</h2>
        <span>{validationReport ? new Date(validationReport.generatedAt).toLocaleTimeString() : "尚未生成"}</span>
      </div>
      {validationReport ? (
        <div className="validationCard">
          <div className="validationHeaderRow">
            <strong>{validationReport.success ? "最近一次 live policy 回归通过" : "最近一次 live policy 回归失败"}</strong>
            <button type="button" className="secondaryButton" onClick={() => void onRefreshValidation()} disabled={isRefreshingValidation}>
              {isRefreshingValidation ? "刷新中" : "刷新结果"}
            </button>
          </div>
          <p>{validationReport.repo.name} / {validationReport.repo.rootPath}</p>
          <small>报告文件：{validationReport.reportPath}</small>
          {coverageEntries.length ? (
            <div className="validationCoverageList">
              {coverageEntries.map(([p0Key, entries]) => (
                <article key={p0Key} className={`validationCoverage ${coverageTone(entries)}`}>
                  <div className="validationCoverageHeader">
                    <strong>{p0Key}</strong>
                    <span>{entries.every((entry) => entry.success) ? "已覆盖" : "存在失败"}</span>
                  </div>
                  <small>{entries.length} 条回归检查</small>
                </article>
              ))}
            </div>
          ) : null}
          {validationReport.scenarios.length ? (
            <details className="collapsible">
              <summary>场景详情（{validationReport.scenarios.filter((s) => s.success).length}/{validationReport.scenarios.length} 通过）</summary>
              <div className="validationScenarioList" style={{ padding: "0 10px 10px" }}>
                {validationReport.scenarios.map((scenario) => (
                  <article key={`${scenario.label}-${scenario.command}`} className={`validationScenario${scenario.success ? " success" : " failure"}`}>
                    <strong>{scenario.label}</strong>
                    <p>{scenario.command}</p>
                    <small>
                      期望 {decisionResolutionLabel(scenario.expectedResolution) ?? scenario.expectedResolution}
                      {scenario.expectedMatchedRule ? ` / ${scenario.expectedMatchedRule}` : ""}
                    </small>
                    <small>
                      实际 {decisionResolutionLabel(scenario.actualResolution) ?? scenario.actualResolution ?? "未完成"}
                      {scenario.actualMatchedRule ? ` / ${scenario.actualMatchedRule}` : ""}
                    </small>
                    <small>尝试次数 {scenario.attempts}</small>
                    {scenario.notes ? <small>{scenario.notes}</small> : null}
                  </article>
                ))}
              </div>
            </details>
          ) : null}
          {validationReport.checks.length ? (
            <div className="validationCheckList">
              {validationReport.checks.map((check) => (
                <article key={check.label} className={`validationCheck ${checkTone(check)}`}>
                  <div className="validationCheckHeader">
                    <strong>{check.label}</strong>
                    <span>{check.success ? "通过" : "失败"}</span>
                  </div>
                  <small>P0 关联：{check.p0.join(", ")}</small>
                  {check.details ? (
                    <dl className="validationDetailList">
                      {Object.entries(check.details).map(([detailKey, detailValue]) => (
                        <div key={detailKey}>
                          <dt>{detailKey}</dt>
                          <dd>{detailValueLabel(detailValue)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
          {validationReport.failureMessage ? <p className="errorBox compact">{validationReport.failureMessage}</p> : null}
        </div>
      ) : (
        <div className="validationCard">
          <p className="emptyState">还没有 live policy 回归结果。先运行 corepack pnpm validate:policy-live，再刷新这里。</p>
          <button type="button" className="secondaryButton" onClick={() => void onRefreshValidation()} disabled={isRefreshingValidation}>
            {isRefreshingValidation ? "刷新中" : "读取结果"}
          </button>
        </div>
      )}
    </div>
  );
}