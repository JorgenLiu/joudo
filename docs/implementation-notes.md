# Joudo 实现说明

## 目的

这份文档只回答三件事：

- 当前代码如何分层
- 当前关键状态放在哪里
- 当前哪些实现约束最容易被后续改坏

它不是历史设计讨论存档。

## 代码入口

推荐阅读顺序：

1. `apps/bridge/src/index.ts`
2. `apps/bridge/src/mvp-state.ts`
3. `apps/bridge/src/state/session-orchestration.ts`
4. `apps/bridge/src/state/session-runtime.ts`
5. `apps/bridge/src/state/session-permissions.ts`
6. `apps/web/src/hooks/useBridgeApp.ts`
7. `packages/shared/src/index.ts`

## Bridge 模块划分

### `index.ts`

负责：

- Fastify HTTP 路由
- WebSocket snapshot 推送
- bridge 进程生命周期

### `mvp-state.ts`

负责：

- 聚合 repo contexts
- 暴露外部可调用的高层状态 API
- 连接 runtime、orchestration、permissions、store

这里仍是当前 bridge 的装配层，但不应继续把具体状态逻辑重新堆回这里。

### `state/session-orchestration.ts`

负责：

- prompt 生命周期
- session attach / recover / rollback 的主流程
- turn 开始和结束时的状态收口

### `state/session-runtime.ts`

负责：

- 与 Copilot client / session 的运行时集成
- 事件监听
- runtime 级别错误与结束状态处理

### `state/session-permissions.ts`

负责：

- 权限请求进入后的策略判定
- auto-allow / auto-deny / awaiting-user
- 恢复旧 session 时对未完成权限请求的重新接管

### `state/session-store.ts`

负责：

- session snapshot 组装
- timeline / audit 更新
- repo-scoped 持久化排队

### `policy.ts`

负责：

- repo policy 解析
- 权限请求评估
- 审批结果写回 allowlist

当前 policy 模块已经不只是“读配置”，也承担了受控写回逻辑。

## Web 模块划分

### `hooks/useBridgeApp.ts`

负责：

- 读取 bridge HTTP 接口
- 建立 WebSocket 订阅
- 管理页面级状态
- 派发 prompt、审批、恢复、rollback 等动作

### 关键面板组件

- `RepoInstructionPanel.tsx`: repo context 备注
- `PolicyPanel.tsx`: 当前 repo policy 摘要
- `ApprovalPanel.tsx`: 待审批请求和最近一次写回 policy 的成功卡片
- `SummaryPanel.tsx`: 本轮收口结果
- `ActivityPanel.tsx`: 当前执行状态、blocker、rollback 与 checkpoint 信息
- `TimelinePanel.tsx`: 历史事件账本
- `SessionHistoryPanel.tsx`: 历史 session 列表与恢复入口
- `ValidationPanel.tsx`: live policy 回归结果

## Shared 协议中最关键的对象

### `SessionSnapshot`

前端主要依赖它渲染当前状态，当前已包含：

- repo
- policy 摘要
- approvals
- timeline
- auditLog
- activity
- summary

### `ApprovalRequest`

当前审批卡片不仅展示 request kind，还展示：

- `approvalType`
- rationale
- impact / denyImpact
- matchedRule

### `SessionTimelineEntry`

审批相关 timeline 当前还能表达：

- resolution
- approvalType
- persistedToPolicy
- matchedRule

## 当前实现中的关键约束

### policy 写回不能污染 turn drift

当用户选择“允许并加入 policy”时，bridge 自己写入的 policy 文件不能被误判成当前 Copilot turn 的工作区改动。

这也是为什么 turn path tracker 有忽略 bridge 自写路径的机制。

### `allowed_write_paths` 必须保持窄语义

这个字段的存在就是为了避免把一次受控写入变成全局 `allow_tools: write`。

后续改动不能把它重新做宽。

### 恢复时旧审批不能被当成仍然可执行

历史恢复可以恢复事实，但不能把旧审批重新展示成仍可点击的实时动作，除非 bridge 当前真实附着并重新接管了该 pending request。

### `/undo` 结果必须经过 Joudo 自己验证

不能因为底层执行了 `/undo` 就直接宣称 rollback 成功。

## 当前最容易继续演化的点

- Repo Policy 面板可以继续增加规则管理动作
- write allowlist 的可视化和管理能力还可以继续做细
- rollback/activity 文案仍有压缩空间
- packaging 仍未进入收口阶段