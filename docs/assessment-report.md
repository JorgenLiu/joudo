# Joudo 项目严苛评估报告

> 评估日期：2026-03-22
> 评估范围：Web UI、交互流程、系统实现（不含打包）
> 代码统计：bridge 8178 行 / web 4961 行 / shared 459 行 / 总计 13598 行
> 测试状态：bridge 12/12 通过 / web 25/25 通过 / TypeScript 编译零错误

---

## 一、总体判断

Joudo 已经完成了完整的技术验证闭环，具备真实 Copilot 会话驱动、运行时策略判定、三态审批、回退验证、历史恢复和结构化摘要能力。**但如果以"可稳定交付给他人使用的产品"为标准，当前存在六个系统性问题需要在产品化之前解决。**

| 等级 | 问题领域 | 一句话结论 |
|------|----------|------------|
| 🔴 严重 | 状态管理架构 | `mvp-state.ts` 和 `useBridgeApp.ts` 都是巨型闭包，不可测试、不可局部替换 |
| 🔴 严重 | 错误处理一致性 | 持久化丢写、静默吞错、基于正则的错误分类，任何一个都能导致用户数据丢失 |
| 🟠 重要 | Web UI 可用性 | 距离真正的"移动优先可用产品"还差响应式布局、触控目标、loading 状态和 Error Boundary |
| 🟠 重要 | 测试覆盖结构 | 策略层测试扎实，但集成层、错误路径和 Web hook 几乎为零 |
| 🟡 需关注 | 安全模型边缘 | Shell 解析不完整、路径 TOCTOU 竞态、所有 repo 默认 trusted |
| 🟡 需关注 | 可维护性 | 中文硬编码无 i18n 出路、Schema 无版本号、魔法数字散落 |

---

## 二、系统实现评估

### 2.1 bridge 整体架构

**当前分层：**

```
index.ts  (HTTP/WS 路由层, 130 行)        ← 干净
mvp-state.ts  (装配/门面层, 739 行)        ← 问题集中区
state/*  (领域逻辑, 20 个模块)             ← 拆分方向正确但边界模糊
policy.ts  (策略引擎, 1231 行)             ← 最大单文件
```

**正面判断：**
- 路由层（`index.ts`）很干净，只做分发
- `state/` 目录的拆分方向正确，session-orchestration / session-runtime / session-permissions / session-store 四件套覆盖了主要领域
- 策略评估管线（request → decision with reason & matched rule）设计合理
- Copilot SDK 的 `/undo` 结果验证不依赖 SDK 的返回值，而是 Joudo 自己验证——这是正确的信任模型
- 审批→写回→治理这条链路完整度在同类项目中少见

**问题清单：**

#### P0：`mvp-state.ts` 仍然是巨型闭包装配层

739 行的 `createMvpState()` 把所有状态困在闭包里。后果：
- **不可测试**：无法给 state 注入 mock 依赖，测试必须走真实文件系统
- **不可局部热替换**：改一行持久化逻辑需要理解整个闭包
- **线性查找审批**：`resolveApproval()` 遍历所有 repoContexts 查找 approvalId，O(n)

```
建议：提取 MvpState interface 为实际的 class 或 module scope；
      把 repoContexts 换成 Map<approvalId, repoId> 索引；
      所有外部依赖通过 deps 对象注入（目前 session-orchestration 已经是这种模式，应推广）
```

#### P0：持久化丢写无感知

`session-store.ts` 的 `queuePersistence()` 使用 Promise 链串行化写入。但：
- 写失败 `.catch()` 只 log 不重试——**用户不知道快照没保存**
- snapshot 和 index 分两步写入，无事务——**第一步成功第二步失败 = 不一致**
- 无 Dead Letter Queue 或降级告知

```
建议：写失败必须反映在 snapshot.errors 或 activity.blockers 里，让 UI 可展示；
      snapshot + index 使用先写临时文件再原子 rename 的模式（persistence.ts 已有但 store 未对齐）；
      加有限重试（最多 2 次，间隔 200ms）
```

#### P0：基于正则的错误分类

`errors.ts` 用正则匹配中文错误消息来判断类型：

```typescript
/copilot cli 尚未登录|copilot cli 未登录|copilot login/i  →  auth error
/timed?\s*out|超时|deadline|ETIMEDOUT/i  →  timeout
```

SDK 升级改一个字符串就会导致分类失败。所有未识别错误退化为 500 unknown。

```
建议：优先检查 error.code / error.name / error.type 等结构化字段；
      中文正则作为最后兜底；
      为每种错误类型增加单元测试锁定预期分类
```

#### P1：Shell 命令解析不完整

`policy.ts` 的 `tokenizeShellCommand()` 存在已知限制：
- 不处理管道 `|`、逻辑链 `&&` `||` 后的第二个命令
- 不展开 `$()` 子命令替换
- 环境变量赋值 `FOG=bar cmd` 跳过但不验证

对于安全产品来说，**解析不完整 = 可能漏判**。

```
建议：当前阶段不需要做完整 shell parser；
      但必须在遇到 pipe/chain 时标记 "complex-command" 并强制进入 confirm 流程；
      tokenizeShellCommand 的已知限制应记录在审批卡片的 whyNow 或 rationale 里
```

#### P1：`policy.ts` 1231 行，策略评估和持久化写回混在一起

`evaluateShellRequest()` 150+ 行嵌套条件，`persistApprovalToPolicy()` 的 YAML 文件读写逻辑和策略评估耦合在同一个模块里。

```
建议：拆成 policy-eval.ts（纯评估）和 policy-persistence.ts（写回）；
      evaluateShellRequest 用表驱动替代嵌套 if，把硬编码的安全命令列表提取为可配置常量
```

#### P1：session 事件订阅可能泄漏

`session-runtime.ts` 的 `bindSession()` 每次调用都注册新监听器到 `context.subscriptions`。如果同一个 context 多次 bind（比如 recovery 后 re-attach），旧监听器不会清理。

```
建议：bindSession 前先 dispose 已有的 subscriptions；
      或在 disconnectRepoSession 时显式清理
```

#### P2：`RepoContext` 类型有 26 个字段

`state/types.ts` 里 `RepoContext` 是一个扁平结构，所有状态混在一起：会话生命周期、策略、审批、时间线、审计、回退证据。没有子状态机。

```
建议：按领域拆为子结构——SessionState / PolicyState / TurnState / ApprovalQueue
      当前改动量大，可先不拆结构体，但至少在类型层面标注哪些字段属于哪个领域
```

---

### 2.2 策略引擎

**正面：** Joudo 当前的策略引擎在同类工具中属于较完整的实现。

已覆盖的决策维度：
- tool allow / confirm / deny
- shell allow / confirm / deny（含命令规范化和家族匹配）
- read path / write path（含符号链接逃逸检测）
- URL allow / deny
- MCP / custom-tool 分类
- write 持久化窄语义（单文件 / generated 目录）

当前策略引擎测试 22 个用例，覆盖命令规范化、路径逃逸、策略写回等核心路径。**这是当前项目测试质量最高的模块。**

**唯一重要问题：** 路径验证的 TOCTOU 竞态——`resolvePathForContainment()` 使用 `realpathSync()` 解析符号链接，但检查和实际执行之间存在时间窗口。对于 Joudo 的本地单用户场景，风险可控，但应在文档中明确声明。

---

### 2.3 共享协议层

`packages/shared/src/index.ts` 导出 60+ 类型，覆盖：
- 会话生命周期（9 种状态 + 恢复模式）
- 审批全链路（请求 → 决策 → 解决 → 审计）
- 活动追踪（阶段、回退、检查点、压缩）
- 策略快照（规则、来源、风险、注释）
- 错误报告（code + message + nextAction + retryable）

**类型设计质量较高：** 使用字面量联合类型做区分、明确 null 语义、语义化命名。

**问题清单：**

| 问题 | 影响 | 建议 |
|------|------|------|
| `SessionSnapshot` 无 `schemaVersion` 字段 | 持久化后无法做兼容性迁移 | 加 `schemaVersion: number`，写入时标记 |
| `ServerEvent` 无版本信封 | 客户端无法检测协议不兼容 | 加 `{ id, schemaVersion, timestamp, payload }` 包装 |
| `SessionTimelineEntry.decision` 对所有 kind 都是可选 | 类型不精确，编译器不帮忙 | 改为按 kind 区分的联合类型 |
| 集合字段无分页 | `timeline[]`、`approvals[]`、`items[]` 无上限声明 | 至少在类型注释中声明最大长度 |
| `ApprovalResolutionPayload` 只带 `approvalId`，无 sessionId | bridge 需要全局扫描来路由 | 加 `repoId` 或 `sessionId` |

---

## 三、Web UI 评估

### 3.1 当前面板结构

| 面板 | 行数 | 职责 | 成熟度 |
|------|------|------|--------|
| HeroPanel | 64 | 仓库选择/模型选择/状态标签 | ⭐⭐⭐ 可用 |
| PromptPanel | 30 | 输入 prompt | ⭐⭐ 极简但能用 |
| ApprovalPanel | 136 | 审批队列 + 三态操作 | ⭐⭐⭐⭐ 较完整 |
| ActivityPanel | 292 | 执行状态/回退/检查点 | ⭐⭐⭐ 功能多但信息密集 |
| SummaryPanel | 204 | 结构化执行摘要 | ⭐⭐⭐ 可用 |
| PolicyPanel | 262 | 策略规则管理（含删除/复制） | ⭐⭐⭐⭐ 治理闭环已落地 |
| TimelinePanel | 40 | 时间线事件列表 | ⭐⭐ 极简 |
| SessionHistoryPanel | 68 | 历史会话恢复 | ⭐⭐ 能用 |
| ValidationPanel | 119 | 策略回归测试结果 | ⭐⭐⭐ 有结构化展示 |
| ErrorPanel | 40 | 错误反馈 | ⭐⭐ 基本 |
| AuthPanel | 42 | 认证引导 | ⭐⭐ 够用 |

### 3.2 移动优先评估

**做到了的：**
- `100dvh` 视口高度 + safe-area-inset 适配刘海屏
- 原生 `<select>` 控件（移动端体验好）
- `-webkit-overflow-scrolling: touch` 惯性滚动
- Flexbox 列布局为主
- 语义化配色变量

**没做到的（缺陷清单）：**

| 缺陷 | 严重性 | 说明 |
|-------|--------|------|
| **零媒体查询** | 🔴 | 当前只有一种布局，无论 320px 还是 1920px 都是同一个尺寸 |
| **文字过小** | 🔴 | `.meta` 0.68rem / `.detail` 0.72rem 在移动端低于可读阈值（推荐 ≥ 0.8rem） |
| **触控目标不足** | 🟠 | 按钮 padding 8px，推荐至少 44×44px（Apple HIG） / 48×48dp（Material） |
| **无暗色模式** | 🟠 | `color-scheme: light` 硬编码，户外/低光环境体验差 |
| **二栏网格在窄屏挤压** | 🟠 | `grid-template-columns: repeat(2, minmax(0, 1fr))` 在 320px 下会挤 |
| **无横屏适配** | 🟡 | 标签栏和头部不随方向调整 |

### 3.3 状态管理

**核心问题：`useBridgeApp.ts` 745 行、23 个 `useState`**

这个 hook 承担了所有通信（HTTP + WebSocket）、所有状态（repo/session/approval/policy/instruction/error）和所有派发逻辑。

后果：
- **不可单元测试**：hook 内部依赖 `fetch` + `WebSocket`，没有抽象层
- **不可复用**：换一种通信方式需要重写整个 hook
- **重渲染范围过大**：任何一个 state 变化都会触发整个 App 重渲染

```
建议拆成三个 hook：
- useBridgeConnection()     → WebSocket 管理 + 重连
- useSessionState()         → snapshot / repo / prompt / approval
- useRepoPolicy()           → policy / instruction / validation

用 React Context 在层间共享，避免 23 个 prop 从 App.tsx 向下传递
```

### 3.4 UI 健壮性

| 缺失项 | 影响 | 当前状态 |
|--------|------|----------|
| **Error Boundary** | 任何一个子组件报错 = 整个 App 白屏 | ❌ 未实现 |
| **加载骨架屏** | 首次连接或 repo 切换时用户看空白 | ❌ 未实现 |
| **WebSocket 消息验证** | 收到非 JSON 消息 = `JSON.parse` 抛异常 | ❌ 未捕获 |
| **请求取消** | 切换 repo 时上一个请求仍在飞行 | ❌ 无 AbortController |
| **指令编辑防抖** | 快速连点保存 = 多个并发请求 | ❌ 无 debounce |
| **Tab 状态持久化** | 刷新页面 = 回到默认 tab | ❌ 未用 URL params |
| **可访问性** | 无 ARIA label、无 focus 样式、图标无 alt | ❌ 极弱 |

### 3.5 CSS 架构

1439 行单文件 CSS，命名自由形式，存在大量重复：

```css
/* 这三个类的 padding 完全相同，可抽为 .panel */
.approvalCard  { padding: 16px; ... }
.summaryCard   { padding: 16px; ... }
.metaBlock     { padding: 16px; ... }
```

无 BEM、无 CSS Modules、无 utility class。当前规模勉强可控，但继续增长会变得不可维护。

```
建议：暂不引入 CSS framework（避免大改）；
      提取公共 .panel / .card / .badge 基础类；
      所有颜色仍走 CSS 变量（当前已做到）；
      `.meta` 系列字号统一提到 0.8rem 以上
```

---

## 四、交互流程评估

### 4.1 正向流程（已打通）

```
选择 repo → 输入 prompt → bridge 发起会话 → 策略评估 →
  ├─ 自动允许 → 继续执行
  ├─ 自动拒绝 → 摘要反馈
  └─ 需要审批 → 审批卡片（deny / allow-once / allow-and-persist）
→ 摘要 → 活动视图 → 时间线
```

这条链路是完整的。

### 4.2 已支持的辅助流程

- 策略规则删除与即时反馈 ✅
- 上一轮回退（当满足条件时） ✅
- 历史会话 attach / 只读恢复 ✅
- 检查点浏览（只读） ✅
- 模型选择（运行时探测 + 环境变量兜底） ✅
- Repo 指令编辑 ✅

### 4.3 交互缺陷

| 缺陷 | 用户感受 | 建议 |
|------|----------|------|
| 审批无倒计时/超时提示 | 不知道还能等多久 | 显示剩余时间或"会话仍在等待" |
| 多个审批时无"第 3/5 个"指示 | 不知道还有多少 | 在审批面板标题加 count |
| 回退文案过长 | 信息密度高难消化 | 用决策树/图标替代长段落 |
| 时间线无筛选 | 24 条以上只能滚动 | 加按类型/时间筛选 |
| 摘要体无 Markdown 渲染 | `body` 内容原样展示 | 加简单 Markdown → React 渲染 |
| 策略面板 `<details>` 折叠 | 关键规则可能被默认隐藏 | 高风险规则默认展开 |
| 切换 repo 后无确认 | 可能意外切走 | 如果当前 session running 则弹确认 |
| 指令保存无防抖 | 快速点击发多个请求 | `setTimeout` 300ms 防抖 |

---

## 五、测试评估

### 5.1 当前覆盖

| 模块 | 测试数 | 质量 | 评价 |
|------|--------|------|------|
| 策略引擎 | 22 | ⭐⭐⭐⭐ | 最扎实的模块，命令规范化/路径逃逸/写回都有 |
| 状态流集成 | 5 | ⭐⭐⭐ | 覆盖了恢复/超时/回退核心路径 |
| 会话恢复 | 3 | ⭐⭐⭐ | attach + history-only 都有 |
| 模型选择 | 1 | ⭐⭐ | 仅运行时合并 |
| 活动/摘要 | 4 | ⭐⭐ | 基本场景，edge case 少 |
| 检查点 | 3 | ⭐⭐⭐ | 索引/扫描/摘要都有 |
| 写入日志 | 6 | ⭐⭐⭐⭐ | 真实文件系统测试 |
| Web 组件 | 25 | ⭐⭐ | 渲染快照 + 基本交互，无 hook 测试 |

### 5.2 关键缺失

| 缺失类型 | 例子 |
|----------|------|
| **集成测试** | bridge → web 的 WebSocket 通信全链路 |
| **错误路径** | 网络断开/策略文件损坏/磁盘满/权限不足 |
| **并发场景** | 多个审批同时 + 回退同时 + prompt 同时 |
| **Hook 测试** | `useBridgeApp` 完全没有测试 |
| **性能边界** | 100+ timeline / 50+ 审批 / 1MB 检查点 |

### 5.3 测试架构问题

- bridge 的 `mvp-state.flow.test.ts` 直接操作真实 temp 目录——这是正确的集成策略，但因为 `createMvpState()` 是不可注入的闭包，mock 困难
- web 的测试全部是组件级渲染测试，没有 hook 测试
- 没有 e2e 测试框架（Playwright/Cypress）

---

## 六、解决方案路线图

### 阶段 A：堵住数据丢失和崩溃风险（最高优先）

> 目标：让当前系统在正常使用中不会静默丢数据或白屏

| 序号 | 事项 | 预计改动范围 |
|------|------|-------------|
| A1 | ✅ 持久化写失败必须反馈到 snapshot.errors | `session-store.ts` + `mvp-state.ts` |
| A2 | ✅ Web App 加 Error Boundary | `ErrorBoundary.tsx` + `main.tsx` |
| A3 | ✅ WebSocket `JSON.parse` 加 try-catch | `useBridgeApp.ts` |
| A4 | ✅ 错误分类优先查结构化字段，正则降级为兜底 | `errors.ts` + 测试 |
| A5 | ✅ Shell 解析遇到 pipe/chain 时强制 confirm | `policy.ts` + 测试 |

### 阶段 B：移动端可用性基线（次高优先）

> 目标：在 iPhone SE / Android 小屏上可正常完成一次完整流程

| 序号 | 事项 | 预计改动范围 |
|------|------|-------------|
| B1 | ✅ 全局最小字号提到 0.8rem | `styles.css` |
| B2 | ✅ 按钮触控目标 ≥ 44px | `styles.css` |
| B3 | ✅ 加 `@media (min-width: 640px)` 桌面适配 | `styles.css` |
| B4 | ✅ 暗色模式 `@media (prefers-color-scheme: light)` | `styles.css` |
| B5 | ✅ 加载状态骨架屏（连接中/切换 repo 中） | `App.tsx` + `styles.css` |

### 阶段 C：状态管理重构（在 B 之后）

> 目标：让核心 hook 可测试、可局部替换

| 序号 | 事项 | 预计改动范围 |
|------|------|-------------|
| C1 | ✅ `useBridgeApp` 拆为 3 个 hook | `hooks/` 目录 |
| C2 | ✅ 引入 React Context 取代 23 prop 透传 | `BridgeContext.tsx` + `main.tsx` |
| C3 | ✅ 为 `useBridgeConnection` 加 hook 测试 | `useBridgeConnection.test.tsx` |
| C4 | ✅ `mvp-state.ts` 的依赖通过 deps 注入 | bridge `mvp-state.ts` |
| C5 | ✅ 审批查找改为 Map 索引 | `mvp-state.ts` |

### 阶段 D：安全加固（可与 B/C 并行）

> 目标：堵住已知的边缘安全问题

| 序号 | 事项 | 预计改动范围 |
|------|------|-------------|
| D1 | Shell pipe/chain 检测 + 强制 confirm | `policy.ts` |
| D2 | 路径 TOCTOU 竞态在文档中显式声明 | `docs/policy.md` |
| D3 | `repo-discovery.ts` 不再默认 `trusted: true` | `repo-discovery.ts` |
| D4 | 事件订阅泄漏修复（bindSession 前清理） | `session-runtime.ts` |
| D5 | hash 算法从 SHA-1 升级为 SHA-256 | `turn-changes.ts` |

### 阶段 E：测试补齐（持续进行）

| 序号 | 事项 |
|------|------|
| E1 | 为 `useBridgeApp` 核心路径加 hook 测试 |
| E2 | 为持久化失败路径加测试 |
| E3 | 为并发审批 + 回退场景加集成测试 |
| E4 | 评估引入 Playwright 做 e2e 冒烟测试 |

---

## 七、不建议现在做的事

| 事项 | 原因 |
|------|------|
| 引入 CSS framework（Tailwind 等） | 改动面太大，当前 CSS 变量体系可继续用 |
| 引入状态管理库（Zustand/Redux） | 先拆 hook，用 Context 就够 |
| 全面 i18n | 当前用户就是你自己，中文硬编码暂时够用 |
| 补全所有次要面板的 edge case 测试 | 先补核心路径（hook + 持久化 + 审批），次要面板后补 |
| 重写 `policy.ts` 为完整 shell parser | 投入产出比太低，标记 + confirm 即可 |
| 对审计日志做不可变性加密 | 本地单用户场景，签名链意义不大 |

---

## 八、结论

Joudo 的技术验证阶段已经完成得很扎实——策略引擎质量高、审批链路完整、回退验证不依赖 SDK 信任。但在通往"可交付产品"的路上，最大的两个障碍是：

1. **数据安全**：持久化静默丢写 + 错误分类脆弱 → 用户可能在不知情的情况下丢失会话数据
2. **移动端可用性**：字号过小 + 零响应式 + 无 Error Boundary → 在实际手机上使用体验不达标

建议按 A → B → D → C → E 的顺序推进。A 和 B 加起来改动量不大但用户感知明显，值得先做。
