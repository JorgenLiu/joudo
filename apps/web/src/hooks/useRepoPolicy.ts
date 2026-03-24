import { useState } from "react";

import type {
  LivePolicyValidationReport,
  RepoInitPolicyResult,
  RecoverHistoricalSessionPayload,
  RepoPolicyRule,
  RepoPolicyRuleDeletePayload,
  RepoInstructionDocument,
  SessionSnapshot,
} from "@joudo/shared";

import { bridgeOrigin, readJson, toErrorState } from "./bridge-utils";
import { useBridgeContext } from "./BridgeContext";

export function useRepoPolicy() {
  const ctx = useBridgeContext();

  const [isRefreshingAuth, setIsRefreshingAuth] = useState(false);
  const [isRefreshingValidation, setIsRefreshingValidation] = useState(false);
  const [isSavingInstruction, setIsSavingInstruction] = useState(false);
  const [isRecoveringSession, setIsRecoveringSession] = useState(false);
  const [isInitializingRepo, setIsInitializingRepo] = useState(false);
  const [isClearingSessionHistory, setIsClearingSessionHistory] = useState(false);

  async function refreshAuth() {
    try {
      setIsRefreshingAuth(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/auth/refresh`, {
        method: "POST",
      });
      ctx.setSnapshot(nextSnapshot);
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "auth",
            message: "刷新登录状态失败。",
            nextAction: "确认 Copilot CLI 已登录，然后重新检查认证状态。",
            retryable: true,
          },
          () => refreshAuth(),
          "重新检查登录状态",
        ),
      );
    } finally {
      setIsRefreshingAuth(false);
    }
  }

  async function refreshValidationReport() {
    try {
      setIsRefreshingValidation(true);
      ctx.setErrorState(null);
      const nextReport = await readJson<LivePolicyValidationReport | null>(`${bridgeOrigin}/api/validation/live-policy`);
      ctx.setValidationReport(nextReport);
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "validation",
            message: "刷新验证结果失败。",
            nextAction: "稍后重新读取最近一次 live policy 回归结果。",
            retryable: true,
          },
          () => refreshValidationReport(),
          "重试读取验证结果",
        ),
      );
    } finally {
      setIsRefreshingValidation(false);
    }
  }

  async function saveRepoInstruction() {
    try {
      setIsSavingInstruction(true);
      ctx.setErrorState(null);
      const nextInstruction = await readJson<RepoInstructionDocument | null>(`${bridgeOrigin}/api/repo/instruction`, {
        method: "POST",
        body: JSON.stringify({
          userNotes: ctx.instructionDraft,
        }),
      });
      ctx.syncInstructionState(nextInstruction, { forceDraftReset: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "validation",
            message: "保存 repo context 失败。",
            nextAction: "检查当前仓库状态后重新保存。",
            retryable: true,
          },
          () => saveRepoInstruction(),
          "重试保存备注",
        ),
      );
    } finally {
      setIsSavingInstruction(false);
    }
  }

  async function initRepoPolicy() {
    try {
      setIsInitializingRepo(true);
      ctx.setErrorState(null);
      const result = await readJson<RepoInitPolicyResult>(`${bridgeOrigin}/api/repo/init-policy`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      ctx.setSnapshot(result.snapshot);
      ctx.syncInstructionState(result.repoInstruction, { forceDraftReset: true });
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "policy",
            message: "初始化当前仓库失败。",
            nextAction: "确认当前仓库可写且还没有损坏的 policy 文件，然后重试初始化。",
            retryable: true,
          },
          () => initRepoPolicy(),
          "重试初始化仓库",
        ),
      );
    } finally {
      setIsInitializingRepo(false);
    }
  }

  async function deletePolicyRule(rule: RepoPolicyRule) {
    try {
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/repo/policy/rule/delete`, {
        method: "POST",
        body: JSON.stringify({
          field: rule.field,
          value: rule.value,
        } satisfies RepoPolicyRuleDeletePayload),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "policy",
            message: "删除 repo policy 规则失败。",
            nextAction: "确认当前规则仍然存在且 policy 文件可写，然后重试删除。",
            retryable: true,
          },
          () => deletePolicyRule(rule),
          "重试删除规则",
        ),
      );
    }
  }

  async function recoverHistoricalSession(joudoSessionId: string) {
    try {
      setIsRecoveringSession(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/session/recover`, {
        method: "POST",
        body: JSON.stringify({
          joudoSessionId,
        } satisfies RecoverHistoricalSessionPayload),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "recovery",
            message: "恢复历史记录失败。",
            nextAction: "刷新历史会话列表后重试；如果问题持续出现，直接重新开始新会话。",
            retryable: true,
          },
          () => recoverHistoricalSession(joudoSessionId),
          "重试恢复",
        ),
      );
    } finally {
      setIsRecoveringSession(false);
    }
  }

  async function clearSessionHistory() {
    try {
      setIsClearingSessionHistory(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/repo/sessions/clear`, {
        method: "POST",
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "recovery",
            message: "清空历史会话失败。",
            nextAction: "确认当前没有运行中的任务或待审批请求，然后重试。",
            retryable: true,
          },
          () => clearSessionHistory(),
          "重试清空历史",
        ),
      );
    } finally {
      setIsClearingSessionHistory(false);
    }
  }

  return {
    isRefreshingAuth,
    isRefreshingValidation,
    isSavingInstruction,
    isRecoveringSession,
    isInitializingRepo,
    isClearingSessionHistory,
    validationReport: ctx.validationReport,
    repoInstruction: ctx.repoInstruction,
    instructionDraft: ctx.instructionDraft,
    sessionIndex: ctx.sessionIndex,
    setInstructionDraft: (value: string) => {
      ctx.setInstructionDraft(value);
      ctx.setIsInstructionDraftDirty(true);
    },
    refreshAuth,
    refreshValidationReport,
    initRepoPolicy,
    saveRepoInstruction,
    deletePolicyRule,
    recoverHistoricalSession,
    clearSessionHistory,
  };
}
