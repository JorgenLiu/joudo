# Web 前端详解

> 本文档覆盖 `apps/web/src/` 下的所有文件。
> 如果你没有前端经验，请先阅读 00-architecture-overview.md 的 "前端核心概念快速理解" 部分。

---

## 前端基础速览

### React 是什么？

React 是一个 UI 框架。核心思想：**UI 是状态的函数**。

```
# Python 等价理解
def render_page(state: dict) -> str:
    if state["is_loading"]:
        return "<div>加载中...</div>"
    return f"<div>{state['content']}</div>"

# React 版本
function Page({ state }) {
  if (state.isLoading) return <div>加载中...</div>;
  return <div>{state.content}</div>;
}
```

关键概念：
- **组件 (Component)**：一个返回 UI 的函数。类比 Jinja2 宏。
- **Props**：传给组件的参数。类比函数参数。
- **State (useState)**：组件内部的可变状态。类比实例变量。
- **Effect (useEffect)**：副作用。类比 `__init__` 中的初始化逻辑。
- **Hook**：以 `use` 开头的函数，封装状态 + 副作用逻辑。类比 mixin。

### Vite 是什么？

开发时：提供热重载开发服务器（改代码后浏览器自动刷新）
生产时：将所有 .tsx 文件打包成浏览器可运行的 .js + .css 文件

类比：`python setup.py build` 但更复杂，因为浏览器不直接认识 TypeScript。

---

## 模块总览

```
web/src/
├── main.tsx              # 入口：挂载 React 到 HTML
├── App.tsx               # 主组件：认证 + 标签页布局
├── styles.css            # 全局样式
├── vite-env.d.ts         # Vite 类型声明
│
├── hooks/                # 状态管理 Hooks（连接 Bridge API）
│   ├── useBridgeApp.ts       # 聚合 Hook（60+ 属性）
│   ├── BridgeContext.tsx      # 共享状态容器
│   ├── bridge-utils.ts        # HTTP 请求工具
│   ├── useBridgeConnection.ts # 启动 + WebSocket
│   ├── useSessionState.ts     # Prompt + 审批
│   └── useRepoPolicy.ts      # 策略 + 验证
│
├── components/           # UI 组件（25+ 个）
│   ├── PromptPanel.tsx        # 输入框
│   ├── ApprovalPanel.tsx      # 审批面板
│   ├── SummaryPanel.tsx       # 摘要展示
│   ├── PolicyPanel.tsx        # 策略规则展示
│   ├── HeroPanel.tsx          # 顶部导航栏
│   ├── ... 更多组件
│   └── display.ts             # 枚举→显示文本映射
│
├── styles/               # CSS 模块
│   └── themes/
│
└── test/                 # 测试文件（vitest）
```

---

## 入口文件

### main.tsx — 应用入口

```tsx
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BridgeProvider } from "./hooks/BridgeContext";
import App from "./App";

// 挂载到 HTML 中的 <div id="root"> 元素
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <BridgeProvider>
      <App />
    </BridgeProvider>
  </ErrorBoundary>
);
```

类比 Python：
```python
# 类似 Flask
app = Flask(__name__)
# ErrorBoundary = 异常处理中间件
# BridgeProvider = 注入全局依赖
# App = 主路由/视图
```

组件嵌套关系：
```
ErrorBoundary（捕获所有 UI 异常，防止白屏）
  └─ BridgeProvider（提供全局状态，类似 Flask 的 g 对象）
       └─ App（主界面）
```

### App.tsx — 主组件

```tsx
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    Boolean(getStoredToken())  // 检查 localStorage 是否已有 token
  );

  if (!isAuthenticated) {
    return <TotpGate onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return <AuthenticatedApp />;
}
```

流程：
1. 检查浏览器是否已存储 token
2. 没有 → 显示 TOTP 验证码输入界面
3. 有 → 进入主界面

#### AuthenticatedApp — 认证后的主界面

4 个标签页（移动端底部切换）：

| 标签 | 组件 | 功能 |
|---|---|---|
| 控制台 (console) | PromptPanel + ApprovalPanel + SummaryPreview | 输入 prompt、处理审批 |
| 摘要 (summary) | SummaryPanel + ActivityPanel + TimelinePanel | 查看执行结果 |
| 策略 (policy) | PolicyPanel + RepoInstructionPanel + ValidationPanel | 管理权限规则 |
| 历史 (history) | SessionHistoryPanel | 查看/恢复历史会话 |

---

## Hooks 层 — 状态管理

### 整体架构

```
useBridgeApp  ←── 聚合层，被 App.tsx 调用
    │
    ├── useBridgeConnection  ←── 启动 + WebSocket 连接
    │       └── BridgeContext  ←── 共享状态存储
    │
    ├── useSessionState  ←── Prompt 提交 + 审批处理
    │
    └── useRepoPolicy  ←── 策略操作 + 验证
```

### BridgeContext.tsx — 共享状态容器

类比 Python：Flask 的 `g` 对象或 Django 的 `request` 对象——一个请求范围内共享的状态容器。

在 React 中叫 "Context"，提供组件树中的全局状态。

```tsx
// 存储的状态
type BridgeState = {
  repos: RepoDescriptor[];           // 仓库列表
  snapshot: SessionSnapshot;          // 当前会话快照
  errorState: BridgeOperationError | null;  // 错误信息
  connectionState: "online" | "offline" | "connecting";
  isBootstrapping: boolean;           // 是否正在启动
  isDisconnected: boolean;            // 是否断开
  validationReport: LivePolicyValidationReport | null;
  repoInstruction: RepoInstructionDocument | null;
  instructionDraft: string;           // 指令编辑草稿
  sessionIndex: SessionIndexDocument | null;
};
```

关键方法：
```typescript
bootstrap()              // 启动时调用：GET /api/repos + GET /api/session + ...
refreshRepoScopedState() // 切换仓库后刷新关联数据
syncInstructionState()   // 同步指令编辑状态
```

### useBridgeConnection.ts — 启动 + WebSocket

#### 应用启动流程

```
React 挂载
  │
  ├─ useEffect() 触发 (类似 __init__)
  │   └─ bootstrap()
  │       ├─ GET /api/repos → 加载仓库列表
  │       ├─ GET /api/session → 加载当前快照
  │       ├─ GET /api/validation/live-policy → 加载验证报告
  │       └─ GET /api/repo/instruction → 加载仓库指令
  │
  └─ 建立 WebSocket 连接
      ├─ ws://bridge:8787/ws?token=xxx
      ├─ 收到 session.snapshot → 更新本地 snapshot
      ├─ 断开时自动重连（指数退避: 1s → 2s → 4s → 8s → max 10s）
      └─ 收到 4001 (auth expired) → 清除 token → 跳回登录页
```

#### WebSocket 重连机制

```typescript
// 指数退避重连
let reconnectDelay = 1000;  // 起始 1 秒

function reconnect() {
  setTimeout(() => {
    connectWebSocket();
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);  // 最多 10 秒
  }, reconnectDelay);
}

function onConnected() {
  reconnectDelay = 1000;  // 连接成功后重置
}
```

### useSessionState.ts — Prompt + 审批

```typescript
// 提供的方法
submitPrompt(prompt: string)     // POST /api/prompt
resolveApproval(id, decision)    // POST /api/approval
selectRepo(repoId)               // POST /api/session/select
setModel(model)                  // POST /api/session/model
setAgent(agent)                  // POST /api/session/agent
rollbackLatestTurn()             // POST /api/session/rollback
openCheckpoint(number)           // GET /api/session/checkpoints/:num

// 提供的状态
prompt: string                    // 输入框内容
isSubmitting: boolean             // 是否正在提交
isRollingBack: boolean            // 是否正在回滚
latestPersistedApproval: ...     // 最近一次持久化的审批
promptHint: string               // 输入框提示文本
```

### useRepoPolicy.ts — 策略操作

```typescript
// 提供的方法
refreshAuth()                     // POST /api/auth/refresh
initRepoPolicy()                 // POST /api/repo/init-policy
deletePolicyRule(field, value)   // POST /api/repo/policy/rule/delete
saveRepoInstruction(notes)       // POST /api/repo/instruction
recoverHistoricalSession(id)     // POST /api/session/recover
clearSessionHistory()            // POST /api/repo/sessions/clear

// 提供的状态
isRefreshingAuth: boolean
isSavingInstruction: boolean
isClearingSessionHistory: boolean
```

### useBridgeApp.ts — 聚合 Hook

这个 Hook 把上面三个 Hook 合并成一个，提供 **约 60 个属性和方法**，是 App.tsx 唯一需要调用的入口。

```typescript
const app = useBridgeApp();

// 使用示例
app.repos                  // 仓库列表
app.snapshot               // 当前快照
app.submitPrompt("...")    // 提交 prompt
app.resolveApproval(...)   // 处理审批
app.isSubmitting           // 提交中？
// ... 更多
```

类比 Python：一个 Service 类聚合了所有子服务的方法。

### bridge-utils.ts — HTTP 工具

```typescript
// Bridge 地址
const bridgeOrigin = import.meta.env.VITE_BRIDGE_ORIGIN ?? "http://localhost:8787";

// Token 管理（浏览器 localStorage）
getStoredToken()  → string | null
setStoredToken(token)
clearStoredToken()

// 通用 API 调用
async function readJson<T>(url, options?): Promise<T> {
  // 自动加 Bearer Token
  // 自动解析 JSON 响应
  // 自动处理 BridgeErrorResponse
}

// 空白快照（未连接时使用）
const emptySnapshot: SessionSnapshot = { ... };
```

---

## 组件层

### 组件列表

| 组件 | 文件 | 用途 |
|---|---|---|
| **HeroPanel** | HeroPanel.tsx | 顶部栏：品牌 logo + 模型/agent/仓库选择器 + 连接状态 |
| **PromptPanel** | PromptPanel.tsx | 主输入框：textarea + 提交按钮 |
| **ApprovalPanel** | ApprovalPanel.tsx | 审批卡片列表：允许/允许并记住/拒绝 按钮 |
| **SummaryPanel** | SummaryPanel.tsx | 执行摘要：标题、正文、步骤、命令、文件、风险 |
| **ActivityPanel** | ActivityPanel.tsx | 活动面板：checkpoint 列表、回滚按钮、阻塞状态 |
| **TimelinePanel** | TimelinePanel.tsx | 事件时间线：类型过滤、展开/折叠、限制 20 条 |
| **PolicyPanel** | PolicyPanel.tsx | 策略规则：按字段分组显示 allow/confirm/deny 规则 |
| **ValidationPanel** | ValidationPanel.tsx | 策略回归检查：成功/失败计数 |
| **SessionHistoryPanel** | SessionHistoryPanel.tsx | 历史会话列表：恢复模式选择、清空历史 |
| **TotpGate** | TotpGate.tsx | TOTP 登录界面：6 位输入框 |
| **ErrorPanel** | ErrorPanel.tsx | 错误展示：消息 + nextAction + 重试按钮 |
| **ErrorBoundary** | ErrorBoundary.tsx | 异常边界：防止 JS 异常导致白屏 |
| **ConfirmDialog** | ConfirmDialog.tsx | 确认弹窗：二次确认危险操作 |
| **OnboardingPanel** | OnboardingPanel.tsx | 引导面板：初始化策略按钮 |
| **AuthPanel** | AuthPanel.tsx | 认证指引：Copilot CLI 登录说明 |
| **RepoInstructionPanel** | RepoInstructionPanel.tsx | 仓库指令编辑器：用户备注 + 自动生成内容 |
| **RepoListPanel** | RepoListPanel.tsx | 仓库列表侧栏 |
| **MarkdownBody** | MarkdownBody.tsx | Markdown 渲染（安全：无 dangerouslySetInnerHTML） |
| **CompactText** | CompactText.tsx | 文本截断 |
| **BrandSealIcon** | BrandSealIcon.tsx | Logo SVG 组件 |
| **display.ts** | display.ts | 枚举值 → 中文显示文本映射 |

### 关键组件详解

#### PromptPanel — 输入面板

```tsx
function PromptPanel({ prompt, setPrompt, onSubmit, isSubmitting, disabled, hint }) {
  return (
    <div>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={hint}
        disabled={disabled}
      />
      <button
        onClick={onSubmit}
        disabled={isSubmitting || disabled || !prompt.trim()}
      >
        {isSubmitting ? "执行中..." : "发送"}
      </button>
    </div>
  );
}
```

按钮在以下情况禁用：
- 正在提交 (isSubmitting)
- 未认证 Copilot CLI
- 有待审批的请求
- 输入为空

#### ApprovalPanel — 审批面板

```tsx
function ApprovalPanel({ approvals, onResolve }) {
  return approvals.map(approval => (
    <div key={approval.id}>
      <h3>{approval.title}</h3>
      <p>风险等级: {approval.riskLevel}</p>
      <p>{approval.rationale}</p>
      <code>{approval.commandPreview}</code>

      <button onClick={() => onResolve(approval.id, "allow-once")}>
        允许一次
      </button>
      <button onClick={() => {
        // 高风险操作需要二次确认
        if (approval.riskLevel === "high") {
          showConfirmDialog(() => onResolve(approval.id, "allow-and-persist"));
        } else {
          onResolve(approval.id, "allow-and-persist");
        }
      }}>
        允许并记住
      </button>
      <button onClick={() => onResolve(approval.id, "deny")}>
        拒绝
      </button>
    </div>
  ));
}
```

三个选项：
- **允许一次**：本次允许，下次相同操作仍然需要审批
- **允许并记住**：写入 `.github/joudo-policy.yml`，以后自动允许
- **拒绝**：拒绝操作，Copilot 会尝试其他方案

#### SummaryPanel — 摘要面板

展示 Copilot 执行完成后的摘要，包含：

```
┌──────────────────────────────┐
│ 标题: 已修复登录逻辑         │
│                              │
│ 正文: 修改了 auth.ts 中的    │
│ token 验证逻辑...            │
│                              │
│ 执行步骤:                    │
│ 1. 分析了 login 函数         │
│ 2. 修改了 validateToken()   │
│ 3. 添加了错误处理            │
│                              │
│ 执行命令:                    │
│ - pnpm test                  │
│                              │
│ 修改文件:                    │
│ - src/auth.ts                │
│                              │
│ 风险提示:                    │
│ - 当前仓库没有配置写路径限制  │
│                              │
│ 下一步: 检查 auth.ts 的变更  │
└──────────────────────────────┘
```

#### TotpGate — 登录界面

```
┌──────────────────────────────┐
│                              │
│     Joudo                    │
│                              │
│  请输入验证器上的 6 位码      │
│                              │
│  ┌──────────────────────┐    │
│  │ 1 2 3 4 5 6          │    │
│  └──────────────────────┘    │
│                              │
│  [ 验证 ]                    │
│                              │
│  首次使用？在 Mac 终端查看    │
│  Bridge 启动日志中的 QR 码   │
│                              │
└──────────────────────────────┘
```

#### MarkdownBody — 安全 Markdown 渲染

**重要安全设计**：不使用 `dangerouslySetInnerHTML`（React 中直接插入 HTML 的方式，容易导致 XSS）。

而是自己解析 Markdown 语法，逐个渲染为 React 元素：

```tsx
function MarkdownBody({ text }) {
  // 解析: **bold**, *italic*, `code`, [link](url), - list
  // 每种语法映射到安全的 React 元素
  // 不支持: 图片、HTML 标签、script
}
```

类比 Python：用 `bleach` 库清洗 HTML，而不是 `Markup()` 直接信任。

---

## 数据流总结

```
Bridge (HTTP + WS)
  │
  │ HTTP: GET/POST /api/*
  │ WS: 实时 session.snapshot 推送
  │
  ▼
bridge-utils.ts (HTTP 客户端)
  │
  ▼
BridgeContext.tsx (全局状态存储)
  │
  ├─→ useBridgeConnection (启动 + WS)
  ├─→ useSessionState (prompt + 审批)
  └─→ useRepoPolicy (策略 + 验证)
      │
      ▼
  useBridgeApp (聚合)
      │
      ▼
  App.tsx (主组件)
      │
      ├─→ HeroPanel (导航栏)
      ├─→ PromptPanel (输入)
      ├─→ ApprovalPanel (审批)
      ├─→ SummaryPanel (摘要)
      ├─→ ActivityPanel (活动)
      ├─→ PolicyPanel (策略)
      └─→ ...
```

---

## 测试

Web 测试使用 **Vitest** + **Testing Library**（React 组件测试工具）。

```bash
corepack pnpm --filter @joudo/web test
```

测试文件位于 `apps/web/src/test/` 目录。
测试风格：渲染组件 → 模拟用户交互 → 断言 UI 输出。

类比 Python：pytest + selenium，但不需要真实浏览器。
