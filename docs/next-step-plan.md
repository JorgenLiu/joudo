# Joudo 下一步计划

## 文档用途

这份文档只保留三类内容：

- 当前已经确定、不再反复讨论的产品边界
- 接下来 1 到 2 个迭代的明确主线
- 仍会改变实现顺序的关键风险

## 当前阶段判断

Joudo 已经完成“主链路打通”阶段，进入“把受控 MVP 收敛成稳定产品面”阶段。

因此接下来不应该把重点继续放在扩展更多底层执行实验，而应该优先补齐治理、解释和用户信任面。

## 最近完成

- bridge UT 稳定性修复：
  - `turn-changes.ts` 对 watcher 捕获到的候选路径外事件新增二次确认，只把经 targeted observe 证实的真实文件变化记为 `unexpectedObservedPaths`
  - 修复 macOS 下目录级或噪声 watcher 事件导致回滚状态被误判为 `needs-review` 的问题
- 移动端可用性基线（评估报告 Phase B）：
  - B1：全局最小字号提升到 0.8rem，消除 0.6–0.78rem 的 36 处小字体
  - B2：所有交互元素（按钮、tab、select、collapsible summary）加入 `min-height: 44px` 触控目标
  - B3：640px / 900px 桌面断点增强：summary 网格 3→4 列、validation 覆盖率三列、header 居中约束
  - B4：新增 `@media (prefers-color-scheme: light)` 浅色主题，基于 VSCode Light 色板自动跟随系统
  - B5：bootstrap 加载态从纯 spinner 升级为 skeleton 骨架屏（shimmer 动画 + 占位块）
- 状态管理重构（评估报告 Phase C）：
  - C3：`useBridgeConnection` 新增 15 项 hook 测试（bootstrap 成功/失败、WebSocket 生命周期、重连指数退避、rebootstrap、清理）
  - C4：`mvp-state.ts` 引入 `MvpStateDeps` 接口，11 个外部 I/O 依赖（policy/persistence/repo/checkpoint）通过 `deps` 对象注入，默认值保持向后兼容
- 安全加固（评估报告 Phase D）：
  - 路径验证 TOCTOU 竞态条件已记录到 `docs/policy.md`，评估后认定当前本地单用户场景下风险可接受
  - `repo-discovery.ts` 中 `trusted: true` 硬编码修复为从实际仓库 policy 文件读取 `trusted` 配置
  - `turn-changes.ts` 中全部 4 处 `createHash("sha1")` 升级为 `createHash("sha256")`
  - `bindSession()` 订阅清理确认无泄漏（既有代码已正确处理）
- 测试补齐（评估报告 Phase E）：
  - `bridge-utils.test.ts`：12 项 normalizeSnapshot 测试（空值处理、字段保留、回退机制、auth/summary 归一化）
  - `persistence-failure.test.ts`：3 项持久化写入失败路径测试（成功写入、EACCES 重试后回调、无 session 时跳过）
  - `approval-rollback.test.ts`：5 项并发审批与回退集成测试（重复解析 404、乱序解析、混合决策、审批期间回退拒绝、无回退数据拒绝）
- 摘要页面崩溃修复：
  - `normalizeSnapshot` 新增 `normalizeSummary()` 确保 summary 所有字段都有安全默认值
  - `CompactText` 空值保护：`text.trim()` → `(text ?? "").trim()`
  - `App.tsx` summaryPreviewCard 可选链保护：`snapshot.summary.body?.length ?? 0`
- 错误处理与状态管理架构修复（评估报告 Phase A + Phase C）：
  - 错误分类从纯 regex 升级为三阶段结构化分类（structural fields → regex → unknown）
  - 持久化写入加入重试（2 次，200ms 间隔）和失败回调，失败会在时间线中可视化
  - WebSocket JSON.parse 加入 try-catch 保护
  - shell 管道/链式命令（`|` `&&` `||` `;`）检测：即使命中 allow 规则也强制进入 confirm 流程
  - Web App 加入 React Error Boundary，防止子组件异常导致白屏
  - `useBridgeApp` 拆分为 `useBridgeConnection` / `useSessionState` / `useRepoPolicy` 三个领域 hook + `BridgeProvider` Context
  - 审批解析从线性扫描改为 `Map<approvalId, repoId>` 索引 O(1) 查找
- Web UI 已支持按 repo 选择当前执行模型；bridge 会校验允许列表，并在空闲会话上切换到下一条 prompt 生效
- `SessionSummary` 已开始返回结构化 `steps`，把 timeline、命令和文件变更整理为更适合人读的执行步骤
- bridge 现在会优先通过 Copilot SDK 运行时探测可用模型列表，`JOUDO_AVAILABLE_MODELS` 退回为兜底来源
- 摘要页的 `steps` 已改为聚合型步骤，不再把历史时间线事件原样重放，减少与 Timeline 视图的重复
- session 持久化已加入保留上限：当前 + 最近 5 条保留 snapshot，历史索引保留 50 条，并清理孤儿目录
- Web UI 已对摘要、轨迹、审批、时间线的长文本加入折叠显示，避免大段脚本/路径占满页面

## 已确认不变的决定

### 产品主形态仍然是本地 bridge + Web UI

当前主线仍然是移动优先网页闭环，不把原生封装或正式安装包当成当前迭代目标。

### rollback authority 继续留在 Joudo

`/undo` 仍然只是执行器，不是真相来源。

### turn truth 继续使用混合证据模型

当前默认依赖：

- candidate paths
- watcher 越界证据
- write journal

不会回到“每轮常态化全仓扫描”的设计。

### 审批模型继续保持三态

当前网页审批保持：

- 拒绝
- 允许本次
- 允许并加入 policy

### write 持久化继续走窄 allowlist

当前 write 审批持久化写入 `allowed_write_paths`，并只接受：

- 明确单文件路径
- `generated` / `__generated__` 目录

## 下一阶段主线

### 主线 A: 做完整的 policy 治理闭环

这是当前最高优先级。

原因很直接：Joudo 已经能把人工批准写回 allowlist，但还不能同等质量地回答下面几个产品级问题：

- 这条规则是谁、因为什么加进去的
- 这条规则现在是否还应该存在
- 这条规则覆盖范围是否过宽
- 用户如何撤销一次错误的持久化批准

如果这些问题不解决，policy 会持续增长，但产品无法提供足够的治理能力。对一个以“安全、受控、repo-scoped”作为核心价值的系统来说，这是当前最大的产品缺口。

本主线建议拆成三个连续交付：

1. 在 Repo Policy 面板中高亮最近一次新增规则，并显示其来源类型
2. 支持删除或撤销 allowlist 规则
3. 为 write allowlist 增加范围解释，明确它为何被归一化成单文件或目录

#### 建议交互方案

目标不是把 Repo Policy 面板做成 YAML 编辑器，而是先做成一个可读、可解释、可回收的规则治理面板。

第一版建议采用三层结构：

1. 顶部概览区
2. 最近变更区
3. 分类规则列表区

##### 1. 顶部概览区

保留当前“policy 是否已加载”和“文件路径”信息，同时补三项内容：

- 当前总规则数
- 最近一次持久化写入是否成功
- 当前最敏感的规则类型数量，优先显示 `allowed_write_paths`

这一层的目标是让用户不用先读明细，就能判断当前 repo policy 是不是已经开始变宽。

##### 2. 最近变更区

把当前审批区里的“已加入当前 repo policy”成功卡片，与 Repo Policy 面板联动成同一条事实链。

最近变更区至少显示：

- 新增的规则内容
- 规则类型，例如 shell / read / write
- 来源，例如“来自审批持久化”
- 归一化说明，例如“单文件写入折叠为 generated 目录”
- 变更动作，第一版只需要“删除这条规则”

这样用户在批准后可以立刻完成第二个动作：确认这条规则到底被写成了什么。

这一步当前也已经完成，最近变更区和分类规则列表都已经落地。

##### 3. 分类规则列表区

当前 `allowed_write_paths`、`allow_shell`、`allowed_paths` 三组展示方式要从“纯 pill 列表”升级为“规则项列表”。

每条规则建议显示：

- 规则值
- 规则类型
- 来源标签
- 风险标签
- 可选说明
- 操作按钮

第一版操作当前已落地：

- 删除

`复制规则文本` 仍然可以作为后续补充，但已经不再阻塞当前治理闭环。

不要在第一版上来就支持拖拽、批量编辑或任意 YAML 修改，这会把复杂度拉高，但不直接提升治理闭环。

#### 删除交互

删除已经成为当前治理主线里的第一个真实动作，并且已经落地。

当前实现：

1. 用户点击规则上的“删除”
2. 弹出确认层
3. 确认层明确显示将被删除的精确规则和值
4. 如果这条规则是最近一次持久化结果，额外提示“删除后同类请求将重新进入审批”
5. 删除成功后刷新当前 snapshot.policy，并通过 summary / timeline 给出结构化反馈

确认文案当前已经避免只写“确定删除吗”，而是明确说明删除后的运行时影响。

#### 来源与解释模型

要让治理面板成立，当前仅有字符串数组还不够。

这一步当前已经完成：shared / bridge 数据已经把规则项从“字符串数组”提升为“结构化规则对象列表”，并开始在 Web UI 中展示来源、风险和归一化说明。

当前结构至少包含：

- `value`
- `field`
- `source`
- `note`
- `lastUpdatedAt`
- `isPersistedFromApproval`
- `risk`

其中 `source` 当前至少区分：

- `policy-file`
- `approval-persisted`

`note` 当前主要用于解释 write 规则为何被归一化，例如：

- “由 ./src/generated/foo.ts 折叠为 ./src/generated”
- “按单文件精确写入保存”

#### 与当前代码结构的衔接

这套方案可以直接沿用当前已有入口，不需要大改页面结构：

- ApprovalPanel 继续承担“刚批准后的即时反馈”
- PolicyPanel 承担“长期治理和回收”
- timeline 继续承担“按时间回看发生过什么”

对应实现拆分建议：

1. 已完成：扩 shared 的 `RepoPolicySnapshot`，把字符串数组升级为结构化规则项
2. 已完成：bridge 在组装 snapshot 时补规则来源和解释字段
3. 已完成：web 重写 PolicyPanel，把 pill 展示升级为规则列表
4. 已完成：bridge 增加删除规则接口
5. 已完成：web 为每条规则接上删除动作和成功反馈

#### 暂不做的项

为了保持这一轮实现收敛，先不做：

- 任意 YAML 在线编辑
- 规则批量删除
- URL allowlist 持久化治理
- 复杂筛选与排序
- 审批来源的跨会话审计回溯

这些都可以等第一版“可删除、可解释、可确认来源”的治理闭环稳定之后再补。

### 主线 B: 压缩 rollback / recovery 的解释成本

这是第二优先级。

底层能力已经基本到位，但用户仍然需要更短、更稳定的解释来理解：

- 为什么当前 turn 可以回退
- 为什么当前 turn 只能 `needs-review`
- 为什么某个历史会话只能 history-only 恢复
- 为什么某个旧会话还能 attach

这一块优先做解释收敛，而不是扩展新的恢复语义。

这一步当前已经完成第一轮收敛：

- ActivityPanel 已把“能否回退、为什么不能、下一步做什么”改成更短的稳定文案
- SessionHistoryPanel 已把 `attach` 和 `history-only` 的差别收敛成更直接的说明
- bridge 恢复摘要、自动恢复提示和 history-only fallback 文案已经同步收紧

### 主线 C: 最后再推进 packaging

单一安装包、后台服务与正式交付形态依然重要，但不应该早于 policy 治理闭环。

如果产品还不能稳定管理自己写入的 allowlist，过早包装成“更像成品”的交付形态只会放大治理缺口。

## 当前迭代建议

按建议顺序：

1. 已完成：补 `复制规则文本` 等轻量治理辅助动作
2. 已完成：继续压缩 rollback / recovery 的剩余解释面
3. **已完成**：引擎可靠性修复（详见 `docs/audit-2026-03-22.md` P0 + P1，全部落地）
4. 再推进 CI/build/启动体验（详见 `docs/audit-2026-03-22.md` P2）
5. 最后推进 packaging 与远程准备

## 当前主线（2026-03-22 更新）

### 主线 A（已完成）：引擎可靠性

来源：独立审核报告 `docs/audit-2026-03-22.md`

- ✅ 修 `ensureClient()` 并发竞态（promise-slot 锁定模式）
- ✅ 修 MarkdownBody link href XSS（协议白名单）
- ✅ 清理 dead code（`withCopilotRetry` / `approveAll` / `defineTool`）
- ✅ `selectRepo` 阻止运行中切换（409 守卫）
- ✅ POST route body runtime validation（8 条路由 JSON Schema）
- ✅ 补 session-runtime / session-permissions / session-orchestration 专项测试（28 项测试）

### 主线 B：CI + Build + 启动体验

- ✅ Bridge build script + `tsconfig.build.json`（`tsc -p tsconfig.build.json` → `dist/`，排除测试和 fixtures）
- ✅ Bridge 静态托管 Web 打包产物（`@fastify/static`，SPA fallback，auth 只拦截 `/api/` 和 `/ws`）
- ✅ `joudo-start.sh` CLI 启动器（install → web build → bridge build → `node dist/index.js`）
- ✅ Root `pnpm build` 统一入口（typecheck → web build → bridge build）
- ✅ `POST /api/repo/init-policy` + 最小 Web onboarding（初始化推荐 policy、repo 指令和会话索引）
- ✅ 本机可见的 TOTP setup 信息接口（仅 loopback 可访问，避免把绑定密钥暴露到 LAN）
- 🟡 Tauri 菜单栏壳最小骨架已落地（`apps/desktop`，当前机器缺少 `cargo`，未做 Rust 编译验证）
- GitHub Actions CI 管线（typecheck + test + build）
- 更完整的 Web / desktop TOTP 引导（二维码展示、重绑流程）

### 主线 C（保留，最后再做）：远程/公网准备

- HTTPS + WSS
- Session token httpOnly cookie
- WebSocket reconnect max retry cap
- 桌面壳从“骨架”推进到 bridge 托管、菜单栏状态和本机 onboarding 正式可用

## 当前风险

### `/undo` 仍然不是强事务回滚

这个边界是产品事实，不会因为 UI 或文档改善而消失。

### 底层 CLI / SDK 行为仍可能影响恢复边界

任何 attach、事件流和历史恢复行为都需要继续做版本敏感验证。

### 核心引擎层已补齐专项测试

session-runtime (10 项) / session-permissions (8 项) / session-orchestration (14 项) 共 28 项测试已落地。

### `ensureClient()` 并发竞态已修复

采用 promise-slot 锁定模式，首个调用者占位后并发调用者 await 同一 Promise。