# Joudo 架构

## 产品定位

Joudo 是 GitHub Copilot CLI 的本地优先、网页优先移动访问前端。

当前产品形态不是远程桌面，也不是终端镜像，而是：

- 一个位于 Mac 本机的 bridge
- 一个移动优先的 Web UI
- 一套 repo-scoped 的策略、审批、摘要、恢复与回退模型

MVP 的目标是让用户在同一局域网内通过手机浏览器安全地使用本机 Copilot CLI，而不是直接暴露一台拥有宽权限的远程 shell。

## 顶层组件

### Web 客户端

位置：`apps/web`

职责：

- 选择仓库
- 发送 prompt
- 展示审批队列
- 展示摘要、时间线、活动视图和历史会话
- 展示 repo policy 摘要，包括 `allowed_write_paths`

当前 UI 已经是结构化界面，不依赖 Copilot CLI 的终端输出解析。

### Bridge

位置：`apps/bridge`

职责：

- 发现可用仓库并维护 repo-scoped state
- 启动、附着、恢复 Copilot 会话
- 评估权限请求并执行 allow / confirm / deny
- 持久化审批结果、摘要、时间线、rollback 证据和历史索引
- 将结构化 snapshot 通过 HTTP 和 WebSocket 提供给前端

Bridge 是当前产品的控制平面。

### Shared 协议层

位置：`packages/shared`

职责：

- 定义前后端共享类型
- 约束 session snapshot、approval payload、timeline、activity、policy 摘要等结构

当前前端不需要自行推断 bridge 内部状态，主要依赖 shared 协议中的结构化对象。

## 会话模型

Joudo 的核心会话是 repo-scoped，而不是 editor-global。

每个 repo 上维护一份 `RepoContext`，包含：

- 当前 policy 与 policy 状态
- 当前 Copilot session 引用
- prompt、timeline、summary、activity
- pending approvals 与 audit log
- 历史会话索引与当前 session snapshot
- rollback 所需的 turn evidence、write journal 和 tracked scope

Joudo 自己维护产品级 session 和 turn 边界，不把 Copilot CLI 的内部会话语义直接当成产品真相来源。

## 权限与策略模型

策略文件位于目标 repo 的 `.github/` 下，当前支持：

- `allow_tools`
- `deny_tools`
- `confirm_tools`
- `allow_shell`
- `deny_shell`
- `confirm_shell`
- `allowed_paths`
- `allowed_write_paths`
- `allowed_urls`

运行时权限决策分三类：

- 自动允许
- 自动拒绝
- 转为网页审批

网页审批当前支持三种动作：

- 拒绝
- 允许本次
- 允许并加入 policy

“允许并加入 policy”当前覆盖：

- shell 请求，写入 `allow_shell`
- read 请求，写入 `allowed_paths`
- 受控 write 请求，写入 `allowed_write_paths`

write 的持久化边界被刻意收紧，只允许：

- 明确单文件路径
- `generated` / `__generated__` 目录

## 审批与审计模型

Joudo 不只记录“批准了没有”，还会记录：

- 审批类型 `approvalType`
- policy 决策结果和命中规则
- 是否写入 policy
- 自动决策还是用户决策

这些信息会进入：

- approval queue
- timeline
- summary
- audit log

因此用户可以回看“这一轮到底放行了什么”和“哪些权限已经被持久化”。

## 非 git 工作区变更与回退模型

当前 rollback authority 在 Joudo，不在 Copilot CLI。

Joudo 当前采用混合证据模型：

- prompt 开始时建立 turn-scoped baseline
- 对 write tool 和 shell possible paths 收集 candidate paths
- 运行期间 watcher 只负责发现候选范围之外的越界写入
- 对 write tool 可见写入记录 write journal
- rollback 时优先依赖 Joudo 自己的证据来判断是否还能安全恢复

当前边界：

- 只支持“上一轮整体回退”
- `/undo` 仍然是一个底层执行器，不是真相来源
- 如果 watcher 发现越界写入或当前工作区与记录状态漂移，rollback 会降级为 `needs-review`

## 持久化模型

当前 repo-scoped 持久化位于目标仓库的 `.joudo/` 下。

第一阶段的事实来源包括：

- `.joudo/repo-instructions.md`
- `.joudo/sessions-index.json`
- `.joudo/sessions/<id>/snapshot.json`

这些持久化对象服务于：

- 历史会话列表
- history-only 恢复
- repo context 自动生成
- 最近一次 turn 的 rollback 判断

## 恢复模型

当前恢复分两类：

- `attach`：对已完成且仍有机会附着的历史会话做 best-effort attach
- `history-only`：只恢复结构化历史上下文，不把旧审批当成仍可操作的实时请求

恢复的重点是保留事实与解释能力，而不是承诺对任何旧会话做强一致继续执行。

## 当前架构结论

当前 Joudo 已经具备一条闭环：

- Web 输入 prompt
- Bridge 驱动真实 Copilot 会话
- Policy 决策和网页审批接管权限请求
- Summary / Timeline / Activity 提供结构化解释
- Repo policy 支持从审批结果反向增量写回

下一阶段的重点不再是“有没有跑通”，而是：

- 继续收紧策略边界
- 继续提高 rollback 与恢复的解释性
- 继续把当前能力收敛成更稳定的产品面