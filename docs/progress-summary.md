# Joudo 进度摘要

## 当前阶段

Joudo 当前处于“本地 bridge + Web UI MVP 已打通，开始收敛策略、恢复和产品面”的阶段。

## 已完成的关键里程碑

### 真实会话闭环

- Web -> bridge -> Copilot CLI 的真实 prompt 流程已经打通
- bridge 可以返回结构化 snapshot，而不是仅依赖终端文本

### 运行时策略与审批

- repo policy 已真正接入运行时权限判定
- 网页审批已经支持三态
- 审批语义已经进入 approval queue、timeline、summary 和 audit

### policy 写回

- shell 审批可写回 `allow_shell`
- read 审批可写回 `allowed_paths`
- 受控 write 审批可写回 `allowed_write_paths`

### policy 可视化

- 当前已有 Repo Policy 面板
- 当前可以直接查看 `allowed_write_paths`
- 最近一次写入 policy 的审批结果会在审批区保留成功提示

### 历史与恢复

- repo-scoped session index 已落地
- snapshot 持久化已落地
- history-only 恢复已落地
- best-effort attach 恢复已落地

### rollback 与工作区证据

- turn-scoped changeset 已落地
- write journal 已落地
- tracked scope + watcher 混合证据模型已落地
- 上一轮整体回退 eligibility 已进入 activity

## 当前最重要的收敛点

### 产品面开始统一

当前的 prompt、审批、summary、activity、history、policy 已开始形成统一产品面，而不是分散的技术实验入口。

### 策略边界比之前更清晰

尤其是 write 持久化，现在已经从“可能变宽”收敛成单独的 `allowed_write_paths`。

### 文档开始从阶段性草稿转向少量事实文档

本轮重写的目标就是把过时讨论文档清掉，保留更短、更稳定的事实来源。

## 当前仍未完成的部分

- allowlist 删除与治理入口
- 更强的 recovery / rollback 解释能力
- 最终交付形态与安装包
- 更系统的产品级 polish

## 当前阶段结论

Joudo 已经跨过“概念验证”阶段，进入“把现有能力收敛成稳定产品面”的阶段。