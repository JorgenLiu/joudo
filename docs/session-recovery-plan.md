# Joudo 会话恢复

## 目标

当前恢复模型的目标不是保证任何旧会话都能继续运行，而是保证：

- 历史事实不会丢
- 用户能看回摘要、时间线和最近一次 turn 状态
- 在安全且可判断的场景下，bridge 可以尝试接回旧会话

## 当前持久化基础

当前 repo-scoped 持久化位于目标仓库的 `.joudo/` 下。

第一阶段关键文件：

- `.joudo/repo-instructions.md`
- `.joudo/sessions-index.json`
- `.joudo/sessions/<id>/snapshot.json`

注意：snapshot 当前不会持久化运行时 agent 信息。`agent`、`availableAgents` 和 `agentCatalog` 只存在于 bridge 的 live snapshot 中。

这些对象共同支撑：

- 历史会话列表
- history-only 恢复
- 部分接回旧会话
- 最近一次 turn 的 rollback 上下文

## 当前恢复模式

### `attach`

适用于：

- 历史记录里仍保留 `lastKnownCopilotSessionId`
- 当前 bridge 判断这个旧会话还有机会重新接回

当前行为：

- bridge 先恢复持久化历史记录
- 然后 best-effort 查询并尝试 `resumeSession`
- 成功后重新绑定 runtime 与 pending permission handling

### `history-only`

适用于：

- 旧会话无法附着
- 旧会话只值得作为历史记录使用
- bridge 重启后只需要恢复事实，不需要继续执行

当前行为：

- 恢复 summary、timeline、activity、rollback 信息
- 不把旧审批重新当成仍可点击的实时请求
- 不恢复旧的 custom agent 选择；当前 agent 环境会在 bridge 运行时重新扫描
- 用户基于历史记录重新发起下一轮

## 当前恢复约束

### 旧审批不会被假装成仍然有效

如果当前只是恢复了历史 snapshot，而没有真实重新接管 pending permission request，那么网页不会把旧审批当成仍可操作的实时动作。

### 旧会话 attach 失败会自动退回 history-only

当前行为是先尽量接回旧会话，失败后退回只读历史记录，而不是直接报错并丢失记录。

### recovery 的目标是解释性优先

当前恢复流程优先保留：

- 本轮结果
- 权限审批语义
- 最近一次 rollback 状态
- 最近一次 compaction / checkpoint 信息

## 当前 rollback 与恢复的关系

恢复不会绕过 rollback 的安全边界。

如果当前恢复到的只是历史记录，那么：

- 旧 `/undo` 不会被继续暴露成可执行动作
- 旧 rollback 状态只作为历史事实展示

如果当前真的重新附着成功，那么新的 runtime 会根据当前工作区和 session 状态重新判断后续动作。

当前在产品语言上应把这两种模式理解为：

- `attach`：恢复记录后，尝试接回旧会话
- `history-only`：只恢复记录，不续跑旧执行

## 当前风险

### attach 能力受底层 CLI / SDK 行为影响

这部分不是纯本地状态机，仍受上游能力影响。

### 历史 snapshot 能恢复事实，不代表能恢复交互现场

尤其是权限审批、挂起命令和正在运行的旧会话，不应被用户理解成“冻结后可无损继续”。

## 当前建议

- 把恢复当成“保留记录并继续下一轮”的能力
- 把 attach 当成额外收益，而不是产品承诺
- 持续保持 repo-scoped snapshot 和 summary 的结构化质量，因为它们是 history-only 恢复的核心价值