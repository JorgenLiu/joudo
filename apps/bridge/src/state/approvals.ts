import { relative, resolve } from "node:path";

import type { ApprovalRequest, ApprovalType } from "@joudo/shared";

import type { PermissionRequest } from "../copilot-sdk.js";
import type { PolicyDecision } from "../policy/index.js";

type ApprovalInput = {
  title: string;
  rationale: string;
  riskLevel: "medium" | "high";
  approvalType: ApprovalType;
  commandPreview: string;
  requestKind: string;
  target: string;
  scope: string;
  impact: string;
  denyImpact: string;
  whyNow?: string;
  expectedEffect?: string;
  fallbackIfDenied?: string;
  matchedRule?: string;
};

function baseApproval(input: ApprovalInput): ApprovalRequest {
  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    rationale: input.rationale,
    riskLevel: input.riskLevel,
    requestedAt: new Date().toISOString(),
    approvalType: input.approvalType,
    commandPreview: input.commandPreview,
    requestKind: input.requestKind,
    target: input.target,
    scope: input.scope,
    impact: input.impact,
    denyImpact: input.denyImpact,
    ...(input.whyNow ? { whyNow: input.whyNow } : {}),
    ...(input.expectedEffect ? { expectedEffect: input.expectedEffect } : {}),
    ...(input.fallbackIfDenied ? { fallbackIfDenied: input.fallbackIfDenied } : {}),
    ...(input.matchedRule ? { matchedRule: input.matchedRule } : {}),
  };
}

function withMatchedRule(input: Omit<ApprovalInput, "matchedRule">, matchedRule: string | undefined): ApprovalInput {
  return matchedRule ? { ...input, matchedRule } : input;
}

function isPathWithinRepo(repoRoot: string, pathValue: string) {
  const absolutePath = resolve(repoRoot, pathValue);
  const relativePath = relative(repoRoot, absolutePath).split("\\").join("/");
  return relativePath === "" || relativePath === "." || (!relativePath.startsWith("../") && relativePath !== "..");
}

export function describePermission(request: PermissionRequest, decision: PolicyDecision, repoRoot: string): ApprovalRequest {
  if (request.kind === "shell") {
    const commandPreview = typeof request.fullCommandText === "string" ? request.fullCommandText : "shell command";
    const rationaleBase = typeof request.intention === "string" ? request.intention : "Copilot 请求执行一个 shell 命令。";
    const commands = Array.isArray(request.commands) ? request.commands : [];
    const allReadOnly = commands.every((command) => typeof command === "object" && command !== null && command.readOnly === true);
    return baseApproval(withMatchedRule({
      title: allReadOnly ? "需要确认策略外只读 shell 操作" : "需要确认策略外 shell 操作",
      rationale: `${rationaleBase} ${decision.reason}${decision.matchedRule ? ` 规则：${decision.matchedRule}` : ""}`,
      riskLevel: allReadOnly ? "medium" : "high",
      approvalType: allReadOnly ? "shell-readonly" : "shell-execution",
      commandPreview,
      requestKind: request.kind,
      target: commandPreview,
      scope: allReadOnly ? "当前仓库内的只读 shell 探索" : "当前仓库内的 shell 执行请求",
      impact: allReadOnly ? "如果批准，Copilot 会继续读取当前仓库信息并推进下一步判断。" : "如果批准，Copilot 会继续在当前仓库执行这条命令并基于结果推进任务。",
      denyImpact: allReadOnly ? "如果拒绝，Copilot 会失去这一步所需的仓库信息，通常需要改走保守方案。" : "如果拒绝，这一轮任务可能停在当前步骤，Copilot 需要改写计划或等待新的指令。",
      whyNow: rationaleBase,
      expectedEffect: allReadOnly ? "补齐当前仓库状态与上下文信息，帮助 Copilot 判断下一步。" : "执行这条 shell 命令，并把结果继续用于当前任务。",
      fallbackIfDenied: allReadOnly ? "Copilot 会改用更保守的仓库内信息来源，或者请求你提供替代上下文。" : "当前步骤会被阻断，Copilot 需要改写计划、等待新的权限，或等待你改写提示词。",
    }, decision.matchedRule));
  }

  if (request.kind === "write") {
    const commandPreview = typeof request.fileName === "string" ? request.fileName : "write";
    return baseApproval(withMatchedRule({
      title: "需要确认文件写入",
      rationale: `${typeof request.intention === "string" ? request.intention : "Copilot 请求写入文件。"} ${decision.reason}${decision.matchedRule ? ` 规则：${decision.matchedRule}` : ""}`,
      riskLevel: "high",
      approvalType: "file-write",
      commandPreview,
      requestKind: request.kind,
      target: commandPreview,
      scope: "当前仓库内的文件写入",
      impact: "如果批准，Copilot 会尝试写入这个文件，并基于写入结果继续完成任务。",
      denyImpact: "如果拒绝，这一轮任务可能无法继续完成对应修改，需要你改写 prompt 或调整策略。",
      whyNow: typeof request.intention === "string" ? request.intention : "Copilot 需要落地当前修改，才能继续完成这轮任务。",
      expectedEffect: "把当前修改写入目标文件，并据此继续验证或推进后续步骤。",
      fallbackIfDenied: "这轮任务会停在修改落地之前，通常需要你改写策略、改小任务，或改用只读方案继续。",
    }, decision.matchedRule));
  }

  if (request.kind === "read") {
    const commandPreview = typeof request.path === "string" ? request.path : "read";
    const isRepoRead = typeof request.path === "string" ? isPathWithinRepo(repoRoot, request.path) : true;
    return baseApproval(withMatchedRule({
      title: isRepoRead ? "需要确认路径读取" : "需要确认仓库外路径读取",
      rationale: `${typeof request.intention === "string" ? request.intention : "Copilot 请求读取路径。"} ${decision.reason}${decision.matchedRule ? ` 规则：${decision.matchedRule}` : ""}`,
      riskLevel: "medium",
      approvalType: isRepoRead ? "repo-read" : "external-path-read",
      commandPreview,
      requestKind: request.kind,
      target: commandPreview,
      scope: isRepoRead ? "当前仓库或候选路径读取" : "当前仓库之外的本地路径读取",
      impact: isRepoRead ? "如果批准，Copilot 会读取这个路径并把结果纳入当前推理。" : "如果批准，Copilot 会读取仓库之外的本地路径，并把结果带回当前任务判断。",
      denyImpact: isRepoRead ? "如果拒绝，Copilot 将失去这一步所需的上下文，通常会回到保守判断或请求替代信息。" : "如果拒绝，Copilot 将无法使用仓库外上下文，通常需要你提供替代信息或改用仓库内证据。",
      whyNow: typeof request.intention === "string" ? request.intention : "Copilot 需要读取这个路径来补齐当前任务上下文。",
      expectedEffect: isRepoRead ? "把这个路径中的内容纳入当前判断，用来决定下一步修改或验证动作。" : "把仓库外路径中的内容纳入当前判断，用来补齐当前任务缺失的外部上下文。",
      fallbackIfDenied: isRepoRead ? "Copilot 会失去这部分上下文，可能改走保守方案，或等待你补充替代信息。" : "Copilot 会失去这部分仓库外上下文，通常需要你明确指出替代路径，或把需要的信息带回仓库内。",
    }, decision.matchedRule));
  }

  if (request.kind === "url") {
    const commandPreview = typeof request.url === "string" ? request.url : "url";
    return baseApproval(withMatchedRule({
      title: "需要确认网页或 URL 访问",
      rationale: `${typeof request.intention === "string" ? request.intention : "Copilot 请求访问 URL。"} ${decision.reason}${decision.matchedRule ? ` 规则：${decision.matchedRule}` : ""}`,
      riskLevel: "high",
      approvalType: "url-fetch",
      commandPreview,
      requestKind: request.kind,
      target: commandPreview,
      scope: "当前任务的外部网络访问",
      impact: "如果批准，Copilot 会访问这个 URL 并把外部返回结果纳入当前任务。",
      denyImpact: "如果拒绝，这一轮任务将无法依赖这条外部资源，Copilot 需要改用仓库内信息或等待新的指令。",
      whyNow: typeof request.intention === "string" ? request.intention : "Copilot 需要访问外部资源来补齐当前任务信息。",
      expectedEffect: "读取外部页面或接口返回结果，并把它用于当前任务判断。",
      fallbackIfDenied: "Copilot 只能改用仓库内已有信息，或者等待你提供外部信息后继续。",
    }, decision.matchedRule));
  }

  return baseApproval(withMatchedRule({
    title: `需要确认 ${request.kind} 权限`,
    rationale: `Copilot 请求 ${request.kind} 权限。${decision.reason}${decision.matchedRule ? ` 规则：${decision.matchedRule}` : ""}`,
    riskLevel: "high",
    approvalType: request.kind === "mcp" ? "mcp-execution" : request.kind === "custom-tool" ? "custom-tool" : "other",
    commandPreview: request.kind,
    requestKind: request.kind,
    target: request.kind,
    scope: "当前任务的额外权限请求",
    impact: "如果批准，Copilot 会继续请求并使用这项权限。",
    denyImpact: "如果拒绝，Copilot 可能无法完成当前步骤，需要改写计划或等待新的输入。",
    whyNow: `Copilot 当前需要 ${request.kind} 权限来继续推进这一轮任务。`,
    expectedEffect: "补齐当前步骤所需的权限能力，并据此继续推进任务。",
    fallbackIfDenied: "当前步骤会停下，Copilot 需要改写计划、等待新的输入，或放弃这条执行路径。",
  }, decision.matchedRule));
}