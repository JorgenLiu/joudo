# 前端评估报告

> 生成日期：2026-03-22  
> 评估范围：`apps/web/src/` 全部组件（14 个）、样式、hook、共享类型  
> 评估角度：信息冗余 / 尺寸膨胀 / 易用性

---

## 一、信息冗余

### 1.1 SummaryPanel 统计网格 + 明细列表双重呈现

**位置**：`SummaryPanel.tsx` 中 `.summaryStats` 和 `.summaryList`

摘要面板同时展示了一个 2×3 的统计卡片网格（执行命令 3 条、审批类型 2 类、文件变更 5 项 …）和紧随其后的一个完整明细列表（把同样的命令、文件名逐条列出）。计数信息已经隐含在明细列表的长度中，两者同时呈现占用大量垂直空间且传递的信息重叠。

**建议**：保留明细列表，把统计数字以 inline badge 形式注入 `<dt>` 标签旁即可，去掉独立的统计网格。

### 1.2 SummaryPanel 尾部 metaBlock 与 HeroPanel 重复

**位置**：`SummaryPanel.tsx` 尾部 `.metaBlock`

底部元信息块展示了"当前会话 ID / 当前模型 / Copilot 认证 / 最近提示词"，其中：
- **模型**已在 HeroPanel 的 `<select>` 中可见。
- **认证状态**已在 HeroPanel 的"未登录" pill 以及 AuthPanel 中体现。
- **最近提示词**已在 Console 的 PromptPanel textarea 里可见。

唯一不重复的是 session ID，但对普通用户意义不大。

**建议**：把 metaBlock 移入 `<details>` 折叠区或直接删除，session ID 改为点击 HeroPanel logo 显示的浮层。

### 1.3 ActivityPanel 回退区块执行器标签重复

**位置**：`ActivityPanel.tsx`，rollback 子区块

`rollbackExecutorLabel()` 在子区块头 `<span>` 和卡片体内 `<p><strong>执行路径：</strong>...` 两处输出相同文本。

**建议**：只在子区块头保留一次。

### 1.4 PolicyPanel 最近新增规则 + 规则列表重复

**位置**：`PolicyPanel.tsx`，`latestPersistedRule` 高亮卡 + 折叠区内的同一条规则卡片

最近一次从审批持久化的规则会在面板顶部用专门卡片展示，同时又出现在下方 `allowed_write_paths / allow_shell / allowed_paths` 折叠区的规则列表里。

**建议**：顶部高亮卡改为一行通知条（banner），点击可滚动到列表中对应规则并高亮。

### 1.5 ApprovalPanel 持久化结果卡与审批队列同时显示

**位置**：`ApprovalPanel.tsx`，`approvalPersistedCard`

当新的待审批请求进来时，上一次"已加入 policy"的结果卡仍然显示在审批面板顶部，分散对当前待审批请求的注意力。

**建议**：新请求进入时自动收起持久化结果卡，或 3 秒后 auto-dismiss，改为 toast 通知。

---

## 二、尺寸膨胀 / 列表增长

### 2.1 ApprovalPanel 单卡高度过高

**位置**：`ApprovalPanel.tsx`

单张审批卡包含：序号 + 标题 + 风险标签 + rationale + 命令预览 + 6 个 `<dl>` 字段（审批类型 / 命中规则 / 作用对象 / 影响范围 / 如果批准 / 如果拒绝）+ 2-3 个按钮。  
一张卡在 375px 宽度（iPhone SE）上估计占约 450-550px 高度，已接近一屏。多张审批卡会严重影响控制台 tab 的可操作性。

**建议**：
- 把"如果批准 / 如果拒绝 / 命中规则"等字段放入 `<details>` 二级折叠。
- 默认只展示：标题 + 风险标签 + 命令预览（截断）+ 操作按钮。
- 3 条以上审批时加分页或虚拟滚动。

### 2.2 TimelinePanel 无分页 / 无虚拟化

**位置**：`TimelinePanel.tsx`

所有 timeline 条目一次性渲染，没有 `maxItems` 限制。一轮中等复杂的会话可能产生 30-80 条事件，全部渲染会导致：
- 历史 tab 加载延迟
- 滚动卡顿
- 内存占用上升

**建议**：默认展示最近 20 条，底部加"加载更多"按钮；或按轮次分组折叠。

### 2.3 ActivityPanel items 列表无限增长

**位置**：`ActivityPanel.tsx`，`.activityItemList`

与 TimelinePanel 相同的问题。所有 activity items 一次性渲染。

**建议**：同 2.2——最近 15 条 + 加载更多。

### 2.4 SummaryPanel steps 和 pill 列表

**位置**：`SummaryPanel.tsx`

- **执行步骤列表**（summary.steps）：每个 step 是一个 `activityItem` 卡片，20+ 步骤时会把摘要面板拉得非常长。
- **Pill 列表**（executedCommands / changedFiles 等）：如果有 30 个变更文件，pill 会折行多行，且每个 pill 内还有 CompactText 展开/收起按钮，操作密度极高。

**建议**：
- Steps 超过 8 个时折叠，只展示前 5 + "查看全部 N 条"。
- Pill 列表超过 6 个时截断，尾部加 "+N 更多"。

### 2.5 RepoInstructionPanel 自动生成内容无高度限制

**位置**：`RepoInstructionPanel.tsx`，`.instructionReadonly`

`<pre>` 元素使用 `white-space: pre-wrap` 且没有 `max-height`。如果自动生成的 repo context 内容很长（如大型 monorepo），会撑开面板几百行。

**建议**：加 `max-height: 240px; overflow-y: auto`，与 checkpoint preview 的 `max-height: 300px` 保持一致。

### 2.6 Checkpoint 预览嵌入位置不合理

**位置**：`ActivityPanel.tsx`，checkpoint preview section

Checkpoint 预览（可能包含几百行代码）直接嵌入 ActivityPanel 中间。虽然 `<pre>` 有 `max-height: 300px`，但它前后的 checkpoint 列表、blocker 列表和 activity items 不会因此消失，导致页面变得非常长且结构混乱。

**建议**：Checkpoint 预览改为全屏/半屏 overlay（抽屉），不嵌入列表流。

### 2.7 Prompt textarea 没有最大高度

**位置**：`PromptPanel.tsx`，textarea

设置了 `resize: vertical` 但没有 `max-height`。用户拖拽可以让它占满整屏，反而遮挡其他面板。

**建议**：加 `max-height: 280px`（约等于 70% 的移动屏幕高度的一半）。

---

## 三、易用性问题

### 3.1 Tab 切换不重置滚动位置

**位置**：`App.tsx`，`.tabContent`

四个 tab 共享一个滚动容器 `.tabContent`。在 Summary tab 滚到底部，切到 Console tab 后滚动位置保留在底部（看到的是空白），用户需要手动滚回顶部。

**建议**：`activeTab` 变化时 `scrollTop = 0`，或每个 tab page 使用独立滚动容器。

### 3.2 初始加载无骨架/Loading 状态

**位置**：`useBridgeApp.ts` bootstrap 阶段

App 首次加载时发起 bootstrap 请求，期间各面板显示空状态文本（如"bridge 还没有产生摘要"）。用户无法区分"正在加载"和"后端确实为空"。

**建议**：添加 `isBootstrapping` 状态，在 bootstrap 完成前显示骨架屏或全局 loading indicator。

### 3.3 空提示词可以发送

**位置**：`PromptPanel.tsx`

submit 按钮的 `disabled` 条件只检查 `isSubmitting || disabled`（disabled 来自审批/运行中状态），不检查 prompt 是否为空。用户可以发送空字符串。

**建议**：加 `prompt.trim().length === 0` 到 disabled 条件。

### 3.4 审批按钮缺乏视觉层级

**位置**：`ApprovalPanel.tsx`

三个按钮（拒绝 / 允许本次 / 允许并加入 policy）：
- "拒绝"和"允许本次"使用相同的 accent 蓝色背景，没有视觉区分。
- "允许并加入 policy" 使用 `var(--danger)` 红色，暗示"危险/不要点"，但实际上它是 power-user 操作而非破坏性操作。
- 最安全的默认操作（允许本次）没有视觉上的突出。

**建议**：
- "拒绝"→ ghost/outline 样式
- "允许本次"→ accent 蓝色（主按钮）
- "允许并加入 policy"→ warning 黄色或橙色，更贴合"谨慎但非禁止"的语义

### 3.5 AuthPanel 文本量过大

**位置**：`AuthPanel.tsx`

4 步操作指引 + 3 段补充说明（令牌存储机制、自动化环境建议、超时排错），在 375px 屏上需要 2-3 屏滚动才能看完。对于首次使用的用户，信息过载会降低完成率。

**建议**：
- 只保留核心 4 步。
- 3 段补充说明放入 `<details>` 折叠，标签为"常见问题"。

### 3.6 WebSocket 断连无显著反馈

**位置**：`HeroPanel.tsx`

WebSocket 连接状态仅在 header 右上角一个 muted 小 pill 中显示。连接断开时不会弹出 toast 或 banner，用户可能在不知情的情况下操作一个过时的 snapshot。

**建议**：断连 > 3 秒时显示 Console tab 顶部的 sticky banner（类似 ErrorPanel 样式），并禁用所有写操作按钮。

### 3.7 CompactText 展开状态在 snapshot 更新时丢失

**位置**：`CompactText.tsx`

`expanded` 状态通过 `useState(false)` 管理，没有持久化。每次 snapshot 推送导致父组件 re-render 时，已展开的文本会重新折叠。在用户正在阅读长文本时尤其恼人。

**建议**：将 expanded state 提升为 context 或 key-stable ref，或者在 snapshot diff 未改变该字段时跳过 re-render。

### 3.8 "历史" tab 混合了不同概念

**位置**：`App.tsx`，history tab

历史 tab 同时包含：
- **SessionHistoryPanel**：过去的会话记录（不同 session）
- **TimelinePanel**：当前会话的事件流（同一 session 内的 prompt/reply/approval 事件）

这两者概念不同，放在同一 tab 容易混淆。Timeline 被放在一个折叠区内，用户可能忽略它。

**建议**：
- Timeline 移入"摘要"tab（与当前 session 的 ActivityPanel 并列更自然）
- "历史"tab 专注于 SessionHistory

### 3.9 列表无搜索/过滤能力

**位置**：TimelinePanel、ActivityPanel、PolicyPanel 规则列表

当列表条目增多时，没有任何搜索、过滤或按类型筛选的能力。

**建议**：
- Timeline / Activity：加 kind 标签过滤（prompt / approval / error …）
- Policy 规则列表：加搜索框过滤 value

### 3.10 HeroPanel 仓库 + 模型选择器在窄屏上的拥挤

**位置**：`HeroPanel.tsx`，`.repoSelector`

两个 `<select>` 在一行内 flex 排列。当仓库名很长时，模型选择器被压缩到几乎不可读。

**建议**：窄屏（< 400px）时改为两行堆叠；或把模型选择器移入 "摘要" tab 的 metaBlock。

### 3.11 无 pull-to-refresh 或手动刷新

**位置**：全局

除了 ValidationPanel 的"刷新结果"和 AuthPanel 的"重新检查登录状态"，没有通用的手动刷新机制。如果 WebSocket 推送出现延迟或遗漏，用户无法主动拉取最新状态。

**建议**：在 HeroPanel 加一个全局 refresh icon button，等效于 re-bootstrap。

### 3.12 ValidationPanel 内容密度过高

**位置**：`ValidationPanel.tsx`

validation scenarios 列表每条展示 label + command + 期望结果 + 实际结果 + 尝试次数 + notes，全部用 `<small>` 标签平铺。当 scenario 数量多时（10+），页面变得极长。

**建议**：scenarios 默认折叠，只显示 pass/fail 汇总条；展开后才显示详情。

---

## 四、优先级总结

| 优先级 | 问题编号 | 影响 |
|---|---|---|
| **P0 – 必须修** | 3.1, 3.3, 3.6 | 滚动错位、空提示可发送、断连无感知 — 直接影响基本操作可靠性 |
| **P1 – 强烈建议** | 2.1, 2.2, 2.3, 3.4, 3.7, 3.8 | 审批卡过高、列表无限增长、按钮语义误导、展开状态丢失 — 中等复杂度会话下即可触发 |
| **P2 – 建议改进** | 1.1, 1.2, 1.3, 1.4, 2.4, 2.5, 3.2, 3.5, 3.10, 3.11 | 冗余信息、Auth 文本过载、选择器拥挤 — 影响认知负担和首次使用体验 |
| **P3 – 可选优化** | 1.5, 2.6, 2.7, 3.9, 3.12 | 持久化结果卡分散、Checkpoint 嵌入位置、搜索过滤 — 长期使用体验改善 |
