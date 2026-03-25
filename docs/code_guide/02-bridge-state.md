# Bridge State 子模块详解

> 本文档覆盖 `apps/bridge/src/state/` 下的 18 个非测试文件。
> 这是 Joudo 最复杂的模块，负责所有运行时状态管理。

---

## 模块总览

State 子模块是 Joudo Bridge 的 "内核"，类比 Python 中 Django 的 models + services 层。每个文件负责一个明确的关注点：

```
state/
├── types.ts                  # 类型定义（数据结构）
├── repo-context.ts           # 仓库上下文工厂
├── repo-discovery.ts         # 仓库自动发现
├── repo-registry.ts          # 仓库注册表持久化
├── agent-discovery.ts        # Agent 目录扫描
├── session-orchestration.ts  # 会话编排（核心业务逻辑）
├── session-runtime.ts        # Copilot 客户端生命周期
├── session-permissions.ts    # 权限评估 → 审批流程
├── persistence.ts            # 磁盘读写（快照/索引/指令）
├── checkpoints.ts            # Copilot Checkpoint 加载
├── history-recovery.ts       # 历史会话恢复
├── turn-changes.ts           # 文件变更跟踪
├── turn-write-journal.ts     # 写入基线捕获（用于回滚）
├── audit.ts                  # 审计日志格式化
├── activity.ts               # UI 活动状态派生
├── summaries.ts              # 中文摘要生成
├── approvals.ts              # 审批卡片格式化
└── session-store.ts          # 快照生成 + 持久化协调
```

---

## 依赖关系图

```
mvp-state.ts
  │
  ├─→ session-orchestration  ←─ 核心：接收所有高级操作
  │     ├─→ session-runtime  ←─ 管理 Copilot SDK 客户端
  │     ├─→ session-permissions  ←─ 权限评估
  │     │     ├─→ policy/evaluation  ←─ 策略引擎
  │     │     ├─→ approvals  ←─ 格式化审批卡片
  │     │     └─→ audit  ←─ 审计日志
  │     ├─→ turn-changes  ←─ 跟踪文件变更
  │     ├─→ turn-write-journal  ←─ 写前基线
  │     ├─→ history-recovery  ←─ 恢复历史数据
  │     └─→ summaries  ←─ 中文摘要
  │
  ├─→ session-store  ←─ 快照 + 持久化
  │     ├─→ activity  ←─ 活动状态
  │     ├─→ persistence  ←─ 磁盘读写
  │     └─→ checkpoints  ←─ Checkpoint 读取
  │
  ├─→ repo-discovery  ←─ 仓库发现
  │     └─→ repo-registry  ←─ JSON 注册表
  │
  ├─→ repo-context  ←─ 上下文工厂
  │     └─→ policy/  ←─ 策略加载
  │
  └─→ agent-discovery  ←─ Agent 扫描
```

---

## 各文件详解

### types.ts — 核心类型定义

这是所有 state 文件的基础，定义了运行时数据结构。

#### RepoContext — 最重要的类型

```typescript
// 类比 Python:
// class RepoContext:
//     repo: RepoDescriptor         # 仓库基本信息
//     status: SessionStatus        # 当前状态
//     policy: LoadedRepoPolicy     # 策略加载结果
//     lifecycle: SessionLifecycle  # 会话生命周期
//     turns: TurnTracking          # 轮次跟踪
//     approvalState: ApprovalState # 审批状态
//     timeline: list               # 事件时间线
//     auditLog: list               # 审计日志
//     summary: dict                # 摘要
//     activity: dict               # UI 活动
//     ...

type RepoContext = {
  repo: RepoDescriptor;
  status: SessionStatus;          // "idle" | "running" | "awaiting-approval" | ...
  policy: LoadedRepoPolicy;
  currentModel: string;
  currentAgent: string | null;
  availableAgents: string[];
  agentCatalog: Record<string, number>;

  lifecycle: SessionLifecycle;     // 会话生命周期管理
  turns: TurnTracking;            // 轮次跟踪（检查点、回滚、变更）
  approvalState: ApprovalState;   // 审批队列和已批准记录

  timeline: SessionTimelineEntry[];
  auditLog: PermissionAuditEntry[];
  summary: SessionSummary | null;
  activity: SessionActivityItem[];
  updatedAt: string;
};
```

#### SessionLifecycle

```typescript
type SessionLifecycle = {
  joudoSessionId: string | null;           // Joudo 内部会话 ID
  session: CopilotSession | null;          // Copilot SDK 会话对象
  activePrompt: ActivePrompt | null;       // 当前执行中的 prompt
  lastKnownCopilotSessionId: string | null; // 用于恢复
};
```

#### TurnTracking

```typescript
type TurnTracking = {
  turnCount: number;              // 已完成轮次数
  workspacePath: string | null;   // Copilot 工作区路径
  activeTurn: ActiveTurn | null;  // 当前轮次（含 pathTracker, writeJournal）
  checkpoints: CheckpointRecord[];
  rollback: RollbackState | null; // 回滚状态
  lastTurnActivity: TurnRecord | null; // 最后一轮记录
};
```

#### ApprovalState

```typescript
type ApprovalState = {
  approvals: ApprovalRequest[];            // 对外展示的审批列表
  pendingApprovals: Map<string, PendingApproval>; // 内部等待解决的审批
  approvedCommands: string[];              // 已批准的命令列表
  approvedApprovalTypes: ApprovalType[];   // 已批准的审批类型
};
```

#### MvpState 接口

```typescript
type MvpState = {
  getRepos(): RepoDescriptor[];
  getSnapshot(): SessionSnapshot;
  submitPrompt(prompt: string): Promise<SessionSnapshot>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<SessionSnapshot>;
  selectRepo(repoId: string): SessionSnapshot;
  // ... 共 20+ 方法
  subscribe(listener: Listener): () => void;
  dispose(): Promise<void>;
};
```

#### Listener 类型

```typescript
type Listener = (event: ServerEvent) => void;
// 类比 Python callback:
// def listener(event: dict) -> None: ...
```

---

### repo-context.ts — 仓库上下文工厂

**一句话**：创建一个空白的 `RepoContext` 实例。

```typescript
export function createRepoContext(
  repo: RepoDescriptor,
  model: string,
  agent: string | null,
  availableAgents: string[],
  agentCatalog: Record<string, number>,
): RepoContext {
  return {
    repo,
    status: "idle",
    policy: loadRepoPolicy(repo.rootPath),
    currentModel: model,
    currentAgent: agent,
    // ... 所有字段初始化为空/默认值
  };
}
```

类比 Python：`RepoContext.__init__()` 构造函数。

同时导出 `disconnectRepoSession()`：断开 Copilot 会话并清理状态。

---

### repo-discovery.ts — 仓库自动发现

**一句话**：启动时从环境变量和注册表中找到所有可用仓库。

```typescript
export function buildRepos(): RepoDescriptor[] {
  // 1. 从环境变量 JOUDO_REPOS 读取（逗号分隔的路径）
  // 2. 从 repo-registry.json 读取已注册仓库
  // 3. 合并去重
  // 4. 验证路径存在性
  // 5. 返回 RepoDescriptor 列表
}

export function registerRepo(rootPath: string): RepoDescriptor {
  // 将路径标准化 → 检查是否已存在 → 写入 registry → 返回描述符
}

export function removeRepo(rootPath: string): void {
  // 从 registry 中移除
}
```

类比：像 Django 的 `DATABASES` 配置，但是运行时可增减。

---

### repo-registry.ts — 仓库注册表

**一句话**：管理 `~/.copilot/repo-registry.json` 文件。

```json
// ~/.copilot/repo-registry.json 的内容
{
  "repos": [
    { "rootPath": "/Users/jordan/dev/myproject", "name": "myproject" },
    { "rootPath": "/Users/jordan/dev/another", "name": "another" }
  ]
}
```

函数：
- `loadRepoRegistry()` → 读取 JSON
- `saveRepoRegistry()` → 写入 JSON
- `registerRepoInRegistry()` → 添加条目
- `removeRepoFromRegistry()` → 移除条目

---

### agent-discovery.ts — Agent 扫描

**一句话**：扫描仓库目录中的 `.md` 文件，寻找 Copilot Agent 定义。

Copilot Agent 是通过 Markdown 文件的 frontmatter（YAML 头）定义的：

```markdown
---
name: my-agent
description: A helpful agent
---
# Agent instructions...
```

此模块扫描 `.github/copilot/` 等约定位置，收集可用 agent 名称和数量。

---

### session-orchestration.ts — 会话编排器 ⭐

**这是最核心的业务逻辑文件。**

类比：Django 的 `views.py` 中最复杂的业务逻辑，或者 Python 的 Service 层。

#### 创建方式

```typescript
const orchestration = createSessionOrchestration({
  currentContext,        // 获取当前 RepoContext
  snapshot,              // 获取快照
  sessionRuntime,        // Copilot 客户端管理
  sessionPermissionOps,  // 权限操作回调集
  // ... 其他依赖
});
```

#### 三个核心方法

##### 1. runPrompt(prompt) — 执行 Prompt

```
完整执行流程:

1. 获取当前 RepoContext
2. 检查没有进行中的 prompt（互斥锁）
3. 刷新 Agent 目录
4. 确保有 Joudo Session ID（首次时生成 UUID）
5. 创建新的 ActiveTurn:
   - pathTracker: 文件路径跟踪器
   - writeJournal: 写入基线日志
6. 确保 Copilot Session 已建立:
   - 首次: createClient() → startSession()
   - 已有: 复用
7. 调用 copilotClient.sendPrompt(prompt):
   - 设置 15 分钟超时
   - 注册权限处理回调 → session-permissions
   - 注册文件变更观察回调 → turn-changes
8. Prompt 完成后:
   - 收集文件变更摘要
   - 加载最新 checkpoints
   - 生成中文摘要
   - 更新审计日志
   - 持久化快照到磁盘
   - 广播更新到 WebSocket
```

##### 2. rollbackLatestTurn() — 回滚

```
回滚策略（二选一）:

A. Journal 回滚（优先）:
   - 有 writeJournal 基线 → 直接恢复文件到 turn 前的状态
   - 精确、可靠，不依赖 Copilot

B. Copilot /undo（备选）:
   - 没有 journal → 调用 Copilot 的 /undo 命令
   - 需要 Copilot session 还存活
   - 结果不可预测
```

##### 3. recoverHistoricalSession(sessionId) — 恢复历史会话

```
恢复流程:

1. 从 sessions-index.json 找到目标会话
2. 读取 snapshot.json
3. 将历史数据（timeline, audit, summary）应用到当前 context
4. 标记回滚为 "history-only"
5. 不尝试接管旧的 Copilot session
```

---

### session-runtime.ts — Copilot 客户端生命周期

**一句话**：管理 `CopilotClient` 的创建、启动、认证检查。

```typescript
const runtime = createSessionRuntime({
  clientRuntimeRef,    // { client, clientStartPromise } 引用
  createClient,        // 工厂函数
  currentContext,      // 当前上下文
  handlePermissionRequest,  // 权限回调
  // ... 
});

// 主要方法:
runtime.ensureClient()         // 确保客户端已启动
runtime.refreshAuthState()     // 检查 `copilot auth status`
runtime.startSession(context)  // 创建 Copilot 会话
runtime.attachSession(context, id)  // 接回已有会话
```

启动流程：
1. `new CopilotClient()` 创建客户端
2. `client.start()` 启动（会检查 Copilot CLI 是否已安装和登录）
3. 注册事件监听器（模型列表、权限请求、摘要更新等）
4. `client.createSession(rootPath)` 在指定仓库创建会话

---

### session-permissions.ts — 权限审批

**一句话**：将 Copilot SDK 的权限请求转化为用户可理解的审批流程。

```
Copilot SDK 发来 PermissionRequest
  │
  ▼
handlePermissionRequest(context, request)
  │
  ├─ 1. 创建审计条目
  ├─ 2. 调用 policy/evaluation 评估权限
  ├─ 3. 根据评估结果:
  │     ├─ "allow" → 自动允许，更新审计，继续
  │     ├─ "deny"  → 自动拒绝，更新审计，继续
  │     └─ "confirm" → 进入人工审批流程:
  │           ├─ 调用 approvals.describePermission() 生成中文描述
  │           ├─ 创建 ApprovalRequest 对象
  │           ├─ 推送到 WebSocket
  │           └─ 返回 Promise（等用户在手机上点击后 resolve）
  └─ 4. 广播快照更新
```

关键设计：`handlePermissionRequest` 返回一个 **Promise**，当 Copilot 需要用户确认时，这个 Promise 会 **挂起**，直到用户在 Web 界面做出决定（allow/deny）。之后 resolve/reject 这个 Promise，Copilot SDK 据此继续或中止操作。

类比 Python：`asyncio.Future()`，等待外部 `future.set_result()` 来解除阻塞。

---

### persistence.ts — 磁盘读写

**一句话**：处理所有文件系统操作（会话快照、索引、仓库指令）。

#### 关键函数

| 函数 | 用途 |
|---|---|
| `readSessionSnapshot(rootPath, id)` | 读取 `.joudo/sessions/<id>/snapshot.json` |
| `writeSessionSnapshot(rootPath, id, data)` | 原子写入快照 |
| `loadSessionIndex(repo)` | 读取 `.joudo/sessions-index.json` |
| `saveSessionIndex(rootPath, index)` | 原子写入索引 |
| `readOrCreateRepoInstruction(repo, policy)` | 读取/创建 `.joudo/repo-instructions.md` |
| `saveRepoInstruction(repo, policy, notes)` | 保存用户备注到指令文件 |
| `clearSessionHistory(repo)` | 清空历史（删除快照目录 + 重置索引） |
| `initializeRepoInstruction(repo, policy)` | 创建初始指令文件 |
| `initializeSessionIndex(repo)` | 创建初始索引文件 |

#### 原子写入

```typescript
// 原子写入：先写临时文件，再 rename
async function atomicWriteFile(filePath: string, content: string) {
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}
```

类比 Python：
```python
import tempfile, os
with tempfile.NamedTemporaryFile(delete=False, dir=os.path.dirname(path)) as f:
    f.write(content)
os.rename(f.name, path)
```

#### 修剪策略

```typescript
const MAX_SESSION_SNAPSHOTS = 5;       // 最多保留 5 个快照
const MAX_SESSION_INDEX_ENTRIES = 50;  // 索引最多 50 条
```

---

### checkpoints.ts — Checkpoint 加载

**一句话**：从 Copilot 工作区读取 checkpoint 文件内容。

Copilot 在执行过程中会生成 checkpoint（类似 git stash 的快照点）。此模块读取这些 checkpoint 文件的内容，供前端展示差异。

```typescript
export async function readWorkspaceCheckpoint(
  workspacePath: string,
  checkpoint: CheckpointRecord,
): Promise<SessionCheckpointDocument> {
  // 在 workspacePath 下读取 checkpoint 对应的文件
  // 返回包含 number, title, fileName, content 的文档
}
```

---

### history-recovery.ts — 历史恢复

**一句话**：将磁盘上的快照数据应用到当前 RepoContext。

```typescript
export function applyPersistedSessionState(
  context: RepoContext,
  snapshot: PersistedSessionSnapshot,
) {
  // 恢复: timeline, auditLog, summary, activity
  // 恢复: turns.checkpoints, turns.rollback, turns.lastTurnActivity
  // 恢复: approvalState.approvedCommands, approvedApprovalTypes
  // 不恢复: lifecycle.session (Copilot 客户端需要重新建立)
  // 不恢复: pendingApprovals (旧审批不再有效)
}
```

关键原则：
- **恢复只读数据**（历史记录），不恢复可执行状态（审批、客户端）
- 旧审批请求不会在重启后继续等待

---

### turn-changes.ts — 文件变更跟踪

**一句话**：监控 Copilot 在执行过程中修改了哪些文件。

```typescript
// 使用 Node.js 的 fs.watch 监控目录变更
// 记录每个变更文件的路径和 SHA256 哈希
// 执行结束后生成 changedFiles 列表
```

同时管理 **回滚状态**：

| 状态 | 说明 |
|---|---|
| ready | 可以回滚 |
| no-changes | 没有文件变更，无需回滚 |
| history-only | 只有历史数据，无法回滚 |
| session-unavailable | Copilot session 不可用 |
| workspace-drifted | 工作区已发生变更，回滚不安全 |
| reverted | 已回滚完成 |
| needs-review | 回滚结果需要人工检查 |

---

### turn-write-journal.ts — 写入基线

**一句话**：在 Copilot 写入文件之前，捕获文件的原始内容和哈希。

```
Copilot 要写入 src/main.ts
  │
  ▼
captureTurnWriteBaseline(journal, repoRoot, "src/main.ts")
  │
  ├─ 计算当前 src/main.ts 的 SHA256 哈希
  ├─ 读取当前文件内容
  └─ 存入 journal: { path, hash, content }
```

回滚时使用：
```
rollback()
  │
  ├─ 遍历 journal 中的每个文件
  ├─ 检查当前哈希是否只被 Copilot 修改过（没有人工修改）
  └─ 如果安全，恢复到 journal 中记录的原始内容
```

类比 Python：类似数据库的 Write-Ahead Log (WAL)，先记录旧值再写入新值。

---

### audit.ts — 审计日志

**一句话**：格式化权限审计记录。

```typescript
export function decisionBody(decision: PolicyDecision): string {
  // 将策略决策转为中文描述
  // 例: "自动允许 (allow)，匹配规则：allowShell → git status"
}

export function getRequestTarget(request: PermissionRequest): string {
  // 提取请求目标的人类可读描述
  // 例: "shell: git push origin main"
  // 例: "write: src/index.ts"
}
```

---

### activity.ts — UI 活动状态

**一句话**：根据 RepoContext 派生当前 UI 应该显示的活动信息。

```typescript
export function deriveActivity(context: RepoContext): SessionActivityItem[] {
  // 输入: 完整的 RepoContext
  // 输出: 精简的活动列表，供 UI 展示
  //
  // 包含: 最新轮次、checkpoint 列表、回滚状态、待审批数
  // 目的: 让前端不需要解析复杂的内部状态
}
```

类比：Django REST Framework 的 `Serializer`，把内部模型转为 API 响应格式。

---

### summaries.ts — 中文摘要生成

**一句话**：根据会话状态生成用户可读的中文摘要。

```typescript
export function createAuthSummary(repo, authState, policy): SessionSummary {
  // 根据 Copilot 认证状态生成摘要
  // 未登录: "请先在终端执行 copilot login"
  // 已登录: "就绪，可以开始发送 prompt"
}

export function createSummarySteps(options): SummaryStep[] {
  // 从 timeline 提取有意义的步骤
  // 过滤掉内部状态变更，只保留用户关心的操作
}

export function createPolicyRiskMessages(policy): string[] {
  // 根据策略状态生成风险提示
  // 例: "当前仓库还没有 repo policy" 
  // 例: "策略文件存在语法错误"
}
```

---

### approvals.ts — 审批卡片格式化

**一句话**：将 Copilot 的权限请求转为人类可读的审批卡片。

```typescript
export function describePermission(request: PermissionRequest): {
  title: string;          // 例: "执行 Shell 命令"
  rationale: string;      // 例: "代理请求执行 git push origin main"
  riskLevel: "low" | "medium" | "high";
  approvalType: ApprovalType;
  commandPreview: string; // 例: "git push origin main"
  // ... 更多描述字段
} {
  // 根据请求类型（shell/write/read/url/mcp）生成不同格式的描述
  // 所有文案都是中文
}
```

UI 使用这些字段渲染审批面板，让非技术用户也能理解 Copilot 想做什么。

---

### session-store.ts — 快照 + 持久化协调

**一句话**：将 RepoContext 序列化为 SessionSnapshot，并协调异步持久化。

#### 关键函数

```typescript
export function snapshotForContext(
  context: RepoContext | null,
  authState: CopilotAuthState,
  availableModels: string[],
  defaultModel: string,
): SessionSnapshot {
  // 将内部 RepoContext 序列化为可传输的 SessionSnapshot
  // SessionSnapshot 是发送给 Web 前端的完整数据
}

export function ensureJoudoSession(context: RepoContext): string {
  // 确保有 Joudo session ID (UUID v4)
  // 首次时生成，之后复用
}

export function pushTimelineEntry(context, entry, limit) {
  // 添加事件到 timeline，自动修剪到 limit
}

export function appendAuditEntry(context, entry, limit) {
  // 添加审计记录，自动修剪到 limit
}

export function touch(context, status) {
  // 更新 context.status 和 context.updatedAt
  // 同时重新派生 activity
}

export function queuePersistence(context, deps, options?) {
  // 将持久化操作排队：
  // 1. 生成快照
  // 2. 写入 snapshot.json
  // 3. 更新 sessions-index.json
  // 使用 Promise 链保证串行执行
  // 失败时重试 2 次
}
```

排队写入的原因：高频操作（如 Copilot 快速产生多个文件变更）可能同时触发多次持久化，排队保证磁盘写入不冲突。

类比 Python：`asyncio.Queue` + worker 消费模式。

---

## 核心流程详解

### 流程 1: 提交 Prompt

```
submitPrompt("修复 login bug")
  │
  │ [mvp-state.ts]
  ├─ 1. 获取 currentContext()
  ├─ 2. refreshContextAgentsForPrompt() → 刷新 agent 目录
  ├─ 3. ensureCurrentContextSummary() → 确保有初始摘要
  │
  │ [session-orchestration.ts]
  ├─ 4. ensureJoudoSession() → 生成 session ID
  ├─ 5. 创建 ActiveTurn { pathTracker, writeJournal }
  │
  │ [session-runtime.ts]
  ├─ 6. ensureClient() → CopilotClient.start()
  ├─ 7. startSession() → client.createSession(repoPath)
  │
  │ [copilot-sdk]
  ├─ 8. client.sendPrompt("修复 login bug")
  │     │
  │     │ [session-permissions.ts]
  │     ├─ Copilot 请求 shell → handlePermissionRequest()
  │     │   ├─ evaluateShellRequest() → "allow" → 继续
  │     │   └─ evaluateWriteRequest() → "confirm" → 等待用户
  │     │
  │     │ [turn-write-journal.ts]
  │     ├─ Copilot 写文件前 → captureTurnWriteBaseline()
  │     │
  │     │ [turn-changes.ts]
  │     └─ Copilot 修改文件 → pathTracker 记录
  │
  │ [session-orchestration.ts]
  ├─ 9. 收集 changedFiles
  ├─ 10. 加载最新 checkpoints
  │
  │ [summaries.ts]
  ├─ 11. 生成中文摘要
  │
  │ [session-store.ts]
  ├─ 12. queuePersistence() → 写入磁盘
  │
  │ [mvp-state.ts]
  └─ 13. publishIfCurrent() → WebSocket 广播
```

### 流程 2: 回滚

```
rollbackLatestTurn()
  │
  │ [session-orchestration.ts]
  ├─ 1. 检查 rollback.status === "ready"
  ├─ 2. 检查回滚方式:
  │     │
  │     ├─ 有 writeJournal → Journal 回滚
  │     │   ├─ 遍历 journal 中每个文件
  │     │   ├─ 检查当前 SHA256 === journal 记录的 "修改后" 哈希
  │     │   ├─ 如果匹配 → 恢复为 journal 记录的 "修改前" 内容
  │     │   └─ 如果不匹配 → workspace-drifted，需要人工检查
  │     │
  │     └─ 无 journal → Copilot /undo
  │         ├─ 调用 client.sendPrompt("/undo")
  │         └─ 观察文件变更确认回滚
  │
  ├─ 3. 更新摘要
  ├─ 4. 持久化
  └─ 5. 广播
```

### 流程 3: 恢复历史会话

```
recoverHistoricalSession("abc-123")
  │
  │ [session-orchestration.ts]
  ├─ 1. 从 sessionIndices 查找 "abc-123"
  ├─ 2. 读取 .joudo/sessions/abc-123/snapshot.json
  │
  │ [history-recovery.ts]
  ├─ 3. applyPersistedSessionState():
  │     ├─ 恢复 timeline
  │     ├─ 恢复 auditLog
  │     ├─ 恢复 summary
  │     ├─ 恢复 checkpoints
  │     └─ 标记 rollback = "history-only"
  │
  ├─ 4. 推送 timeline 事件 "已恢复历史会话"
  ├─ 5. 持久化
  └─ 6. 广播
```
