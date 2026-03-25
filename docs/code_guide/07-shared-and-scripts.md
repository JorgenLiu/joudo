# 共享类型包 + 运维脚本详解

> 本文档覆盖 `packages/shared/` 和 `scripts/` 目录，以及根目录的配置文件。

---

## packages/shared — 共享类型包

### 定位

Shared 包是 Joudo 所有模块之间的 **类型契约**。它只包含 TypeScript 类型定义，**没有运行时代码**。

类比 Python：一个只包含 Pydantic models 的 `schemas` 包，其他包都依赖它来定义 API 接口。

### 包配置

```json
{
  "name": "@joudo/shared",
  "exports": { ".": "./src/index.ts" },
  "devDependencies": { "typescript": "^5.8.2" }
}
```

注意：没有 `dependencies`（运行时依赖为零），只有 `devDependencies`（TypeScript 编译器）。

### 核心类型全表

#### 枚举类型

| 类型 | 值 | 用途 |
|---|---|---|
| `PolicyState` | "missing" \| "loaded" \| "invalid" | 策略文件加载状态 |
| `PolicyDecisionAction` | "allow" \| "confirm" \| "deny" | 策略评估结果 |
| `PermissionResolution` | "auto-allowed" \| "auto-denied" \| "awaiting-user" \| "user-allowed" \| "user-denied" | 权限请求最终结果 |
| `SessionStatus` | "disconnected" \| "idle" \| "running" \| "awaiting-approval" \| "recovering" \| "timed-out" | 会话状态 |
| `ApprovalDecision` | "allow-once" \| "allow-and-persist" \| "deny" | 用户审批决定 |
| `ApprovalType` | shell-readonly \| shell-execution \| file-write \| repo-read \| ... | 审批类型分类 |
| `ActivityPhase` | idle \| queued \| analyzing \| editing \| ... | 活动阶段 |

#### 仓库 & 策略

```typescript
// 仓库描述符
type RepoDescriptor = {
  id: string;              // 唯一 ID (路径 hash)
  name: string;            // 显示名称
  rootPath: string;        // 绝对路径
  trusted: boolean;        // 是否信任
  policyState: PolicyState;
};

// 策略规则（前端展示用）
type RepoPolicyRule = {
  id: string;
  field: string;           // "allowShell" | "denyShell" | ...
  value: string;           // "git push" | "src/" | ...
  matchedRule: string;     // 原始匹配规则
  source: "policy-file" | "approval-persisted";
  risk: "low" | "medium" | "high";
  note: string;
  lastUpdatedAt: string;
  isPersistedFromApproval: boolean;
};

// 策略快照（发送给前端的完整策略信息）
type RepoPolicySnapshot = {
  state: PolicyState;
  path: string | null;
  allowTools: RepoPolicyRule[];
  denyTools: RepoPolicyRule[];
  confirmTools: RepoPolicyRule[];
  allowShell: RepoPolicyRule[];
  denyShell: RepoPolicyRule[];
  confirmShell: RepoPolicyRule[];
  allowedPaths: RepoPolicyRule[];
  allowedWritePaths: RepoPolicyRule[];
  allowedUrls: RepoPolicyRule[];
  error: string | null;
};
```

#### 审批 & 会话

```typescript
// 审批请求（推送到前端的审批卡片）
type ApprovalRequest = {
  id: string;
  title: string;           // "执行 Shell 命令"
  rationale: string;       // "代理请求执行 git push"
  riskLevel: "low" | "medium" | "high";
  requestedAt: string;
  approvalType: ApprovalType;
  commandPreview: string;  // "git push origin main"
  requestKind: string;     // "shell" | "write" | ...
  target: string;
  scope: string;
  impact: string;
  denyImpact: string;
  whyNow: string;
  expectedEffect: string;
  fallbackIfDenied: string;
  matchedRule: string | null;
};

// 会话快照（核心数据结构，Bridge → Web 的完整状态传输）
type SessionSnapshot = {
  sessionId: string | null;
  status: SessionStatus;
  repo: RepoDescriptor | null;
  policy: RepoPolicySnapshot;
  model: string;
  availableModels: string[];
  agent: string | null;
  availableAgents: string[];
  agentCatalog: Record<string, number>;
  auth: CopilotAuthState;
  lastPrompt: string | null;
  approvals: ApprovalRequest[];
  timeline: SessionTimelineEntry[];
  auditLog: PermissionAuditEntry[];
  activity: SessionActivityItem[];
  summary: SessionSummary | null;
  updatedAt: string;
};
```

#### 活动 & 审计

```typescript
// 轮次记录
type ActivityTurnRecord = {
  id: string;
  prompt: string;
  startedAt: string;
  completedAt: string;
  outcome: "completed" | "failed" | "timed-out" | "rolled-back";
  changedFiles: string[];
};

// 回滚状态
type ActivityRollbackState = {
  authority: string;
  executor: string;
  status: "ready" | "no-changes" | "history-only" | "session-unavailable" 
        | "workspace-drifted" | "reverted" | "needs-review";
  canRollback: boolean;
  reason: string;
  targetTurnId: string | null;
  changedFiles: string[];
  trackedPaths: string[];
  workspaceDigestBefore: string | null;
  workspaceDigestAfter: string | null;
};

// 审计日志条目
type PermissionAuditEntry = {
  id: string;
  timestamp: string;
  requestKind: string;
  target: string;
  decision: string;
  resolution: PermissionResolution;
  matchedRule: string | null;
  riskLevel: string;
};
```

#### 摘要 & Checkpoint

```typescript
// 执行摘要（中文用户可读）
type SessionSummary = {
  title: string;
  body: string;
  steps: SummaryStep[];
  executedCommands: string[];
  approvalTypes?: ApprovalType[];
  changedFiles: string[];
  checks: string[];
  risks: string[];
  nextAction: string;
};

// Checkpoint 文档
type SessionCheckpointDocument = {
  number: number;
  title: string;
  fileName: string;
  path: string;
  workspacePath: string;
  content: string;
};
```

#### 策略验证

```typescript
// 策略回归测试报告
type LivePolicyValidationReport = {
  success: boolean;
  generatedAt: string;
  p0Coverage: Record<string, {
    success: boolean;
    details: Record<string, unknown>;
  }>;
};
```

#### API Payload 类型

```typescript
// 请求体类型
type PromptSubmission = { sessionId?: string; prompt: string };
type ApprovalResolutionPayload = { approvalId: string; decision: ApprovalDecision };
type RepoSelectionPayload = { repoId: string };
type RepoInitPolicyPayload = { trusted?: boolean };
type RepoPolicyRuleDeletePayload = { field: string; value: string };
type RepoInstructionUpdatePayload = { userNotes: string };
type RollbackLatestTurnPayload = { targetTurnId?: string };
type RecoverHistoricalSessionPayload = { joudoSessionId: string; recoveryMode?: string };

// 响应体类型
type TotpVerifyResponse = { success: boolean; token?: string; message: string };
type BridgeHealthResponse = { status: string; mode: string; transport: string; timestamp: string };
type RepoInitPolicyResult = { 
  repoId: string; policyPath: string; instructionPath: string;
  createdPolicy: boolean; createdInstruction: boolean; createdSessionIndex: boolean;
  snapshot: SessionSnapshot;
};
```

#### 错误 & 事件

```typescript
// 错误类型
type BridgeErrorCode = "auth" | "network" | "policy" | "recovery" | "timeout"
                     | "session-expired" | "approval" | "validation" | "unknown";
type BridgeOperationError = {
  code: BridgeErrorCode;
  message: string;
  nextAction: string;     // 中文用户提示
  retryable: boolean;
  details?: string;
};

// WebSocket 事件
type ServerEvent = {
  type: "session.snapshot" | "bridge.ready" | "approval.requested" | "summary.updated";
  payload: unknown;
};
```

---

## scripts/ — 运维脚本

### cleanup-dev.sh — 开发环境清理

```bash
# 删除所有构建产物和缓存，恢复干净状态
rm -rf apps/bridge/dist
rm -rf apps/web/dist
rm -rf apps/desktop/dist
rm -rf apps/desktop/src-tauri/bundle-resources
rm -rf apps/desktop/src-tauri/target
rm -rf node_modules
```

类比 Python：`make clean` 或删除 `__pycache__/`、`.venv/`。

### joudo-start.sh — 快速启动

```bash
# 一键启动开发环境
# 启动 Bridge + Web 开发服务器
cd /path/to/joudo
corepack pnpm dev
```

### smoke-test-prod.mjs — 生产冒烟测试

```javascript
// 启动 Bridge 的生产构建，执行基本健康检查
// 验证: 启动 → /health → TOTP → session
```

### validate-policy-live.mjs — 策略验证

```javascript
// 对指定仓库运行策略回归测试
// 检查策略文件的各项规则是否符合预期
// 输出 LivePolicyValidationReport
```

---

## 根目录配置文件

### package.json — 根 Monorepo 配置

```json
{
  "name": "joudo",
  "private": true,
  "packageManager": "pnpm@10.6.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @joudo/bridge --filter @joudo/web dev",
    "build": "pnpm typecheck && pnpm --filter @joudo/web build && pnpm --filter @joudo/bridge build",
    "typecheck": "pnpm --recursive --filter @joudo/shared --filter @joudo/bridge --filter @joudo/web typecheck",
    "start": "pnpm --filter @joudo/bridge start"
  }
}
```

常用命令：

| 命令 | 作用 |
|---|---|
| `corepack pnpm dev` | 同时启动 Bridge + Web 开发服务器 |
| `corepack pnpm build` | 类型检查 + 构建全部 |
| `corepack pnpm typecheck` | 仅类型检查 |
| `corepack pnpm start` | 启动生产 Bridge |
| `corepack pnpm build:desktop` | 构建桌面应用 |
| `corepack pnpm build:desktop:dmg` | 构建 DMG 安装包 |

#### 为什么用 `corepack`？

corepack 是 Node.js 内置的包管理器管理工具。它确保项目使用 `package.json` 中声明的 pnpm 版本（10.6.0），避免版本不一致导致的问题。

类比 Python：`pyenv exec python` 或 `poetry run python`。

### pnpm-workspace.yaml

```yaml
packages:
  - apps/*       # apps/bridge, apps/web, apps/desktop
  - packages/*   # packages/shared
```

定义 monorepo 中的包位置。pnpm 会自动解析 `workspace:*` 引用。

### tsconfig.base.json — 共享 TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,                        // 严格类型检查
    "skipLibCheck": true,                  // 跳过 node_modules 类型检查
    "noUncheckedIndexedAccess": true,      // 数组/字典访问默认可能 undefined
    "exactOptionalPropertyTypes": true,    // 可选属性必须显式声明 undefined
    "resolveJsonModule": true,             // 允许 import JSON 文件
    "isolatedModules": true,               // 每个文件独立编译
    "verbatimModuleSyntax": true           // 保留 import type 语法
  }
}
```

类比 Python：
- `strict: true` 相当于 `mypy --strict`
- `noUncheckedIndexedAccess` 相当于强制 `dict.get()` 而非 `dict[]`
- `exactOptionalPropertyTypes` 相当于区分 `Optional[str]` 和 `str | None`

每个子项目的 `tsconfig.json` 继承此基础配置并添加项目特定设置。

---

## Monorepo 依赖关系

```
@joudo/shared (类型定义)
  ▲           ▲
  │           │
@joudo/bridge   @joudo/web
(后端服务)     (前端界面)
  ▲
  │
@joudo/desktop
(桌面壳程序, 通过 process.spawn 启动 bridge)
```

- `@joudo/bridge` 和 `@joudo/web` 都通过 `"@joudo/shared": "workspace:*"` 引用 shared 包
- `@joudo/desktop` 不直接依赖其他 Joudo 包，而是通过文件系统（bundle-resources）使用 bridge 和 web 的构建产物
