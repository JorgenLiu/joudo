# Bridge 核心文件详解

> 本文档覆盖 `apps/bridge/src/` 下的 4 个核心文件。

---

## 文件列表

| 文件 | 行数 | 职责 |
|---|---|---|
| index.ts | ~500 | HTTP 服务入口，路由注册，WebSocket，认证中间件 |
| mvp-state.ts | ~900+ | 全局状态管理器，所有业务逻辑的聚合入口 |
| copilot-sdk.ts | ~10 | Copilot SDK 类型和客户端的重导出 |
| errors.ts | ~170 | 错误分类、序列化、HTTP 状态码映射 |

---

## index.ts — HTTP 服务入口

### Python 等价

相当于 FastAPI/Flask 的 `app.py`，负责：定义所有路由、注册中间件、启动服务。

### 关键常量

```typescript
const port = 8787;                   // 默认端口
const host = "0.0.0.0";             // 监听所有网卡（LAN 可达）
const WEB_DIST_DIR = "apps/web/dist"; // Web 前端构建产物
const SERVE_STATIC = existsSync(...)  // 如果 web dist 存在，就在同一端口提供静态文件
```

### 中间件栈

```
请求到达
  │
  ├─ CORS 检查
  │   - localhost 系列端口直接通过
  │   - 192.168.x.x (LAN) 通过
  │   - 其他 origin 拒绝
  │
  ├─ 认证中间件 (onRequest hook)
  │   - 免认证路由: /health, /api/auth/totp, /api/auth/totp/setup, /api/auth/totp/rebind, /ws
  │   - 本地管理路由: /api/repos, /api/session/select 等 (仅 localhost 免认证)
  │   - 静态资源路由 (非 /api/ 开头): 跳过认证
  │   - 其他: 必须携带 Bearer Token
  │
  ├─ 路由匹配
  │
  └─ 错误处理器 (setErrorHandler)
      → normalizeBridgeError() → 标准化 JSON 错误响应
```

### 全部路由一览

#### 认证相关

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /api/auth/totp | 验证 6 位 TOTP 码，返回 Session Token |
| GET | /api/auth/totp/setup | 获取 TOTP 密钥和 QR URI（仅 localhost） |
| POST | /api/auth/totp/rebind | 重新生成 TOTP 密钥（仅 localhost） |
| POST | /api/auth/refresh | 刷新 Copilot CLI 认证状态 |

#### 仓库管理

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/repos | 获取已注册仓库列表 |
| POST | /api/repos/add | 添加仓库到注册表 |
| POST | /api/repos/remove | 从注册表移除仓库 |

#### 会话操作

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/session | 获取当前会话快照 |
| POST | /api/session/select | 切换当前仓库 |
| POST | /api/session/model | 切换 AI 模型 |
| POST | /api/session/agent | 切换 Agent |
| POST | /api/session/recover | 恢复历史会话 |
| POST | /api/session/resume | 同 recover（别名） |
| POST | /api/session/rollback | 回滚最后一次 turn |
| GET | /api/session/checkpoints/:num | 获取指定 checkpoint 内容 |

#### Prompt 和审批

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /api/prompt | 提交自然语言 prompt |
| POST | /api/approval | 解决待审批的权限请求 |

#### 仓库配置

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/repo/instruction | 获取仓库指令文档 |
| POST | /api/repo/instruction | 更新仓库指令（用户备注） |
| POST | /api/repo/init-policy | 初始化仓库 Policy 文件 |
| POST | /api/repo/policy/rule/delete | 删除一条 Policy 白名单规则 |
| GET | /api/repo/sessions | 获取会话索引（历史列表） |
| POST | /api/repo/sessions/clear | 清空会话历史 |

#### 验证

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /api/validation/live-policy | 获取策略回归测试报告 |

#### 系统

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /health | 健康检查 |
| WS | /ws | WebSocket 实时推送 |

### WebSocket 细节

```typescript
// 连接限制
const WS_MAX_CONNECTIONS = 10;       // 最多 10 个并发连接
const WS_PING_INTERVAL_MS = 30_000;  // 每 30 秒 ping 一次保活

// 连接建立时
socket.on("connect") → 验证 query param 中的 token
                      → token 无效返回 4001 (Unauthorized)
                      → 连接数超限返回 4008

// 推送内容
state.subscribe(event => socket.send(serialize(event)))
// 事件类型: "session.snapshot" — 完整快照推送

// 断开时
socket.on("close") → 清理计时器，取消订阅
```

### SPA Fallback

```typescript
// 所有未匹配的路由返回 index.html（SPA 前端路由需要）
app.setNotFoundHandler(async (_request, reply) => {
  if (SERVE_STATIC) {
    return reply.sendFile("index.html");
  }
  void reply.status(404).send({ error: ... });
});
```

这个设计的原因：React SPA（单页应用）的路由是前端 JavaScript 处理的，服务端需要把所有非 API 请求都返回 `index.html`，让前端 JS 来决定渲染哪个页面。类比：Python 的 catch-all route 返回同一个模板。

---

## mvp-state.ts — 全局状态管理器

### Python 等价

相当于 Django 的 `views.py` + `models.py` 的合体，但更像一个带内存缓存的 Application 单例。

### 设计模式

```
createMvpState() — 工厂函数
  │
  ├─ 返回 state 对象（实现 MvpState 接口）
  │   ├─ getRepos()
  │   ├─ getSnapshot()
  │   ├─ submitPrompt(prompt)
  │   ├─ resolveApproval(id, decision)
  │   ├─ selectRepo(repoId)
  │   ├─ setModel(model)
  │   ├─ ... 共 20+ 个公开方法
  │   ├─ subscribe(listener) → 取消函数
  │   └─ dispose()
  │
  └─ 内部闭包维护所有状态:
      ├─ repos: RepoDescriptor[]        # 仓库列表
      ├─ repoContexts: Map<id, RepoContext>  # 仓库运行时上下文
      ├─ approvalRepoIndex: Map<approvalId, repoId>  # 审批→仓库映射
      ├─ sessionIndices: Map<id, SessionIndexDocument>  # 会话索引
      ├─ persistenceQueues: Map<id, Promise>  # 持久化写入队列
      ├─ currentRepoId: string | null    # 当前选中仓库
      ├─ authState: CopilotAuthState     # Copilot CLI 认证状态
      ├─ availableModels: string[]       # 可用模型列表
      └─ listeners: Set<Listener>        # WebSocket 订阅者
```

### 为什么用闭包而不是 class？

TypeScript 中用闭包实现 "模块模式" 是常见做法，类比 Python 中：

```python
# Python 等价概念
def create_state():
    _repos = []
    _contexts = {}
    
    def get_repos():
        return _repos
    
    def submit_prompt(prompt):
        ...
    
    return {"get_repos": get_repos, "submit_prompt": submit_prompt}
```

好处：内部变量完全私有，外部只能通过返回的方法访问。

### 依赖注入

`createMvpState()` 接受一个 `deps` 参数，所有外部依赖通过此注入：

```typescript
type MvpStateDeps = {
  buildRepos: () => RepoDescriptor[];        // 发现仓库
  loadRepoPolicy: (path) => LoadedRepoPolicy; // 加载策略
  readSessionSnapshot: (path, id) => ...;     // 读取快照
  // ... 共 20 个依赖
};
```

这使得测试可以轻松 mock 所有依赖（类似 Python 的 `unittest.mock.patch`）。

### 核心业务流程

#### submitPrompt(prompt)

```
1. 检查当前有没有选中仓库
2. 检查当前没有其他操作进行中 (mutationInFlight guard)
3. 刷新 Agent 目录 (可能有新 .md 文件)
4. 委托给 sessionOrchestration.runPrompt()
5. 执行结束后广播新的 snapshot
```

#### resolveApproval(approvalId, decision)

```
1. 从 approvalRepoIndex 找到审批对应的仓库
2. 获取对应 RepoContext
3. 查找 pendingApprovals 中的审批
4. 如果 decision 是 "allow-and-persist":
   → 持久化到 .github/joudo-policy.yml
5. 调用审批的 resolve() 回调，恢复 Copilot 执行
6. 更新审计日志和时间线
7. 广播 snapshot
```

#### selectRepo(repoId)

```
1. 检查旧仓库没有进行中的任务
2. 切换 currentRepoId
3. 刷新 Agent 目录
4. 刷新认证状态
5. 广播 snapshot
```

### 状态发布机制

```typescript
function emit(event: ServerEvent) {
  listeners.forEach(listener => listener(event));
}

function publishCurrentSnapshot() {
  emit({ type: "session.snapshot", payload: snapshot() });
}
```

每次状态变更后调用 `publishIfCurrent(repoId)`，如果变更的仓库正好是当前选中的仓库，就广播新快照到所有 WebSocket 连接。

类比 Python：使用 `asyncio.Event` 或 Redis pub/sub 通知所有监听者。

### 启动时自动恢复

```typescript
restoreLatestContextFromHistory();  // 从磁盘恢复最近的会话历史
sessionRuntime.refreshAuthState();  // 异步检查 Copilot CLI 登录状态
```

启动时自动加载每个仓库的最近会话快照，用户看到的是上次的摘要和时间线。

---

## copilot-sdk.ts — SDK 重导出

这个文件只有几行，作用是将 `@github/copilot-sdk` 的内容重新导出：

```typescript
export { CopilotClient } from "@github/copilot-sdk";
export type { PermissionRequest } from "@github/copilot-sdk";
```

为什么要包一层？
1. 集中管理 SDK 导入路径，如果 SDK 包名变更只需改一处
2. 限制暴露面，只导出项目需要的类型

---

## errors.ts — 错误分类系统

### Python 等价

类似 Django REST Framework 的异常处理 + 自定义 Exception：

```python
# Python 等价
class JoudoError(Exception):
    def __init__(self, code, message, status_code, next_action):
        self.code = code
        self.status_code = status_code
        self.next_action = next_action  # 中文提示，告诉用户下一步怎么做
```

### JoudoError 类

```typescript
class JoudoError extends Error {
  code: BridgeErrorCode;     // "auth" | "timeout" | "policy" | ... (9 种)
  statusCode: number;        // HTTP 状态码
  nextAction: string;        // 中文用户提示
  retryable: boolean;        // 是否可重试
  details?: string;          // 可选的技术细节（stack trace）
}
```

### 错误码 → HTTP 状态码映射

| 错误码 | HTTP 状态码 | 中文提示（nextAction） |
|---|---|---|
| auth | 401 | 先在宿主机终端完成 copilot login |
| timeout | 408 | 检查这轮任务是否需要拆小 |
| session-expired | 409 | 重新发送 prompt 或从历史记录恢复 |
| recovery | 409 | 检查历史记录是否仍然存在 |
| policy | 422 | 先修复当前仓库的 repo policy |
| approval | 409 | 刷新当前会话状态 |
| validation | 400 | 先修正当前输入或仓库选择 |
| network | 502 | 确认网络连接正常后重试 |
| unknown | 500 | 稍后重试 |

### 三阶段错误分类

当捕获到异常时，`normalizeBridgeError()` 按以下顺序尝试分类：

```
阶段 1: 结构化字段匹配
  - 检查 error.code (ENOENT, ETIMEDOUT, ECONNREFUSED...)
  - 检查 error.name (TimeoutError, AuthenticationError...)
  - 检查 error.type (timeout, network, auth...)
  → 优点：不受错误消息文案变更影响

阶段 2: 正则匹配消息文本
  - "copilot cli 尚未登录" → auth
  - "审批|approval" → approval
  - "timed?\\s*out|超时" → timeout
  → 作为结构化匹配的补充

阶段 3: 回退
  → 一律归类为 "unknown"，HTTP 500
```

这个设计的好处：当 Copilot SDK 升级改变了错误消息时，阶段 1 的结构化匹配仍然有效。

### 序列化输出

所有错误最终统一为：

```json
{
  "error": {
    "code": "auth",
    "message": "copilot cli 尚未登录",
    "nextAction": "先在宿主机终端完成 copilot login...",
    "retryable": true
  }
}
```

Web 前端根据 `code` 和 `nextAction` 渲染错误面板。
