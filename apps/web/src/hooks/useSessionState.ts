import { useEffect, useMemo, useState } from "react";

import type {
  ApprovalResolutionPayload,
  ApprovalRequest,
  SessionAgentSelectionPayload,
  SessionCheckpointDocument,
  SessionModelSelectionPayload,
  SessionSnapshot,
  SessionTimelineEntry,
  RollbackLatestTurnPayload,
} from "@joudo/shared";

import { bridgeOrigin, readJson, toErrorState } from "./bridge-utils";
import { useBridgeContext } from "./BridgeContext";

export function useSessionState() {
  const ctx = useBridgeContext();

  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSettingModel, setIsSettingModel] = useState(false);
  const [isSettingAgent, setIsSettingAgent] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<SessionCheckpointDocument | null>(null);
  const [isLoadingCheckpoint, setIsLoadingCheckpoint] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);

  useEffect(() => {
    if (!selectedCheckpoint) {
      return;
    }

    const stillExists = ctx.snapshot.activity?.checkpoints.some((checkpoint) => checkpoint.number === selectedCheckpoint.number) ?? false;
    if (!stillExists) {
      setSelectedCheckpoint(null);
    }
  }, [selectedCheckpoint, ctx.snapshot.activity]);

  const activeApproval = ctx.snapshot.approvals[0] ?? null;

  const latestPersistedApproval = useMemo<SessionTimelineEntry | null>(() => {
    for (const entry of ctx.snapshot.timeline) {
      if (entry.kind !== "approval-resolved") {
        continue;
      }

      if (entry.decision?.persistedToPolicy !== true) {
        continue;
      }

      return entry;
    }

    return null;
  }, [ctx.snapshot.timeline]);

  const promptHint = useMemo(() => {
    if (ctx.snapshot.auth.status === "unauthenticated") {
      return "当前 Copilot CLI 未登录，先在终端执行 copilot login，再回来继续发送提示词。";
    }

    if (ctx.snapshot.status === "recovering") {
      return "Joudo 正在恢复最近的历史记录或尝试接回旧会话，先等待恢复完成。";
    }

    if (ctx.snapshot.status === "running") {
      return "当前仓库正在执行一轮真实会话，先等待结果或处理待审批请求。";
    }

    if (ctx.snapshot.status === "timed-out") {
      return "上一轮真实会话已经超时。先检查摘要与时间线，再决定是重试当前任务还是重新发起下一轮。";
    }

    if (activeApproval) {
      return "当前有待审批请求，先处理审批再继续发送新提示词。";
    }

    return "现在会优先尝试真实 ACP 会话；遇到权限请求时会转到网页审批。";
  }, [activeApproval, ctx.snapshot.auth.status, ctx.snapshot.status]);

  async function selectRepo(repoId: string) {
    try {
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/session/select`, {
        method: "POST",
        body: JSON.stringify({ repoId }),
      });
      ctx.setSnapshot(nextSnapshot);
      ctx.resetRepoScopedState();
      await ctx.refreshRepoScopedState();
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "validation",
            message: "无法切换仓库。",
            nextAction: "刷新仓库列表后，重新选择一个有效仓库。",
            retryable: true,
          },
          () => selectRepo(repoId),
          "重试切换仓库",
        ),
      );
    }
  }

  async function submitPrompt() {
    if (!prompt.trim()) {
      return;
    }

    try {
      setIsSubmitting(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/prompt`, {
        method: "POST",
        body: JSON.stringify({
          sessionId: ctx.snapshot.sessionId,
          prompt,
        }),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "unknown",
            message: "提交提示词失败。",
            nextAction: "检查当前仓库状态后重新发送这条 prompt。",
            retryable: true,
          },
          () => submitPrompt(),
          "重试发送 prompt",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setModel(model: string) {
    if (!model || model === ctx.snapshot.model) {
      return;
    }

    try {
      setIsSettingModel(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/session/model`, {
        method: "POST",
        body: JSON.stringify({ model } satisfies SessionModelSelectionPayload),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "validation",
            message: "切换执行模型失败。",
            nextAction: "等待当前状态允许切换后，再重新选择模型。",
            retryable: true,
          },
          () => setModel(model),
          "重试切换模型",
        ),
      );
    } finally {
      setIsSettingModel(false);
    }
  }

  async function setAgent(agent: string | null) {
    if (agent === ctx.snapshot.agent) {
      return;
    }

    try {
      setIsSettingAgent(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/session/agent`, {
        method: "POST",
        body: JSON.stringify({ agent } satisfies SessionAgentSelectionPayload),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "validation",
            message: "切换执行 agent 失败。",
            nextAction: "等待当前状态允许切换后，再重新选择 agent。",
            retryable: true,
          },
          () => setAgent(agent),
          "重试切换 agent",
        ),
      );
    } finally {
      setIsSettingAgent(false);
    }
  }

  async function resolveApproval(request: ApprovalRequest, decision: ApprovalResolutionPayload["decision"]) {
    try {
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/approval`, {
        method: "POST",
        body: JSON.stringify({
          approvalId: request.id,
          decision,
        }),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "approval",
            message: "处理审批失败。",
            nextAction: "刷新当前会话状态，确认这条审批仍然有效后再继续。",
            retryable: true,
          },
          () => resolveApproval(request, decision),
          "重试处理审批",
        ),
      );
    }
  }

  async function openCheckpoint(checkpointNumber: number) {
    try {
      setIsLoadingCheckpoint(true);
      ctx.setErrorState(null);
      const checkpoint = await readJson<SessionCheckpointDocument | null>(
        `${bridgeOrigin}/api/session/checkpoints/${checkpointNumber}`,
      );
      setSelectedCheckpoint(checkpoint);
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "recovery",
            message: "读取 checkpoint 内容失败。",
            nextAction: "稍后重试；如果当前会话刚完成 compaction，先等待 bridge 快照同步完成。",
            retryable: true,
          },
          () => openCheckpoint(checkpointNumber),
          "重试读取 checkpoint",
        ),
      );
    } finally {
      setIsLoadingCheckpoint(false);
    }
  }

  async function rollbackLatestTurn() {
    try {
      setIsRollingBack(true);
      ctx.setErrorState(null);
      const nextSnapshot = await readJson<SessionSnapshot>(`${bridgeOrigin}/api/session/rollback`, {
        method: "POST",
        body: JSON.stringify({
          sessionId: ctx.snapshot.sessionId,
        } satisfies RollbackLatestTurnPayload),
      });
      ctx.setSnapshot(nextSnapshot);
      await ctx.refreshRepoScopedState({ preserveUnsavedInstructionDraft: true });
    } catch (error) {
      ctx.setErrorState(
        toErrorState(
          error,
          {
            code: "recovery",
            message: "撤回上一轮改动失败。",
            nextAction: "确认当前工作区与会话状态后，再重试上一轮回退。",
            retryable: true,
          },
          () => rollbackLatestTurn(),
          "重试撤回上一轮",
        ),
      );
    } finally {
      setIsRollingBack(false);
    }
  }

  return {
    repos: ctx.repos,
    snapshot: ctx.snapshot,
    prompt,
    setPrompt,
    isSubmitting,
    isSettingModel,
    isSettingAgent,
    activeApproval,
    latestPersistedApproval,
    promptHint,
    selectedCheckpoint,
    isLoadingCheckpoint,
    isRollingBack,
    errorState: ctx.errorState,
    dismissError: () => ctx.setErrorState(null),
    selectRepo,
    submitPrompt,
    setModel,
    setAgent,
    resolveApproval,
    openCheckpoint,
    rollbackLatestTurn,
    clearCheckpointSelection: () => setSelectedCheckpoint(null),
  };
}
