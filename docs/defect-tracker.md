# Joudo 产品缺陷追踪

> 评估时间：2026-03-22
> 评估基线：bridge 20/20 + 48/50 pass, web 54/54 pass, tsc 0 errors

## 测试健康度

| 测试套件 | 结果 | 说明 |
|----------|------|------|
| Bridge `state/**/*.test.ts` | 20/20 pass | 全绿 |
| Bridge 其余测试文件 | 48/50 pass, 2 fail | 两个已知缺陷 |
| Web vitest | 54/54 pass | 全绿（有 1 个 React key warning） |
| Bridge tsc --noEmit | 0 errors | |
| Web tsc --noEmit | 0 errors | |

---

## P0 — 真实 Bug

### 1. 错误分类优先级倒置

- 位置：`apps/bridge/src/errors.ts` L130-138
- `MESSAGE_CLASSIFICATIONS` 数组中 `超时` 排在 `审批` 前面。消息 "审批超时了" 同时匹配两者，first-match 语义导致 `timeout` 先命中，`approval` 永远不会被匹配。
- 测试红灯：`normalizeBridgeError falls back to regex when no structured fields match`
- 修复：将 `审批|approval` 和 `policy` 模式移到 `超时` 前面，确保具体领域词优先匹配
- 状态：✅ 已修复

### 2. Rollback status 判定不稳定

- 位置：`apps/bridge/src/mvp-state.flow.test.ts` L384
- 测试期望 `rollback.status === "ready"`，实际得到 `"needs-review"`。根源在 `apps/bridge/src/state/turn-changes.ts` 的 `evidenceClosed` 判定逻辑——当 `broadCandidateScope` 为 true（candidate path 包含 `"."`）时，即使所有 observed path 都在 tracked scope 内，也会降级为 `needs-review`。
- 测试红灯：`submitPrompt records the latest turn changeset and rollbackLatestTurn reverts it`
- 修复：`isPathCoveredByCandidate` 增加祖先目录判定 `candidatePath.startsWith(pathValue + "/")`，使 watcher 观察到的父目录事件不再被判定为 unexpected
- 状态：✅ 已修复

### 3. SummaryPanel React key 警告

- Web 测试 stderr：`Each child in a list should have a unique "key" prop — Check the render method of MarkdownBody`
- 不影响功能，但表明 `MarkdownBody` 在渲染 markdown children 时缺少 key。
- 修复：`renderInline` 返回值从 `<>...</>` 改为 `<Fragment key={keyPrefix}>...</Fragment>`
- 状态：✅ 已修复

---

## P1 — 安全问题

### 4. CORS 全开

- 位置：`apps/bridge/src/index.ts`
- `cors({ origin: true })` 接受任何 origin。同一局域网任何网页可跨域调用全部 API。
- copilot-instructions 明确要求 "Keep LAN transport authenticated"，当前未落地。
- 修复：CORS origin 回调仅放行 localhost / 127.0.0.1 / 192.168.x.x 来源；与 TOTP 认证联动
- 状态：✅ 已修复

### 5. 全部 HTTP/WS endpoint 无身份验证

- 15+ 个 API 路由和 WebSocket 端点无任何 auth middleware。
- 攻击面：任何能访问 bridge 监听端口的进程均可发起 prompt / 审批 / 回退 / 删除 policy rule。
- 修复：实现 TOTP (RFC 6238) 认证方案。密钥存储于 `~/.joudo/totp-secret` (mode 0600)，首次启动时终端输出 QR 码供手机验证器扫描。验证通过后发放 Bearer token (8h TTL)。`/health` 和 `/api/auth/totp` 免检，其余路由强制验证。WebSocket 通过 `?token=` query param 认证。
- 状态：✅ 已修复

### 6. sessionId 路径穿越风险

- 位置：`apps/bridge/src/state/persistence.ts`
- `sessionDir(repoRoot, sessionId)` 直接 `join(sessionsDir, sessionId)`。反序列化时未校验 sessionId 格式，若 JSON 被篡改为 `"../../etc"` 则写入路径越界。
- 修复：新增 `assertSafeSessionId()` 校验函数，使用 `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/` 正则 + `..` 检测，在 `sessionDir` 入口处拦截
- 状态：✅ 已修复

### 7. `JOUDO_EXTRA_REPOS` 无路径校验

- 位置：`apps/bridge/src/state/repo-discovery.ts`
- 环境变量直接 `resolve()` 后当作 repo root，无任何边界检查。
- 修复：`existsSync` 改为 `isExistingDirectory()` 函数，同时检查存在性和 `isDirectory()`，排除文件路径被误当成 repo root
- 状态：✅ 已修复

### 8. checkpoint 参数未验证

- 位置：`apps/bridge/src/index.ts`
- `/api/session/checkpoints/:checkpointNumber` 路由用 `Number.parseInt` 解析参数，`NaN` 直接传入后续逻辑。
- 修复：新增 `Number.isFinite(num) && num >= 0` 校验，不合法参数返回 400
- 状态：✅ 已修复

---

## P2 — 可靠性 / 健壮性

### 9. WebSocket 无资源限制

- 无 maxPayload、ping/pong keepalive、空闲超时、连接上限。长时间不活跃的移动客户端连接不会被清理。
- 修复：注册时传入 `maxPayload: 1MB`，handler 添加 ping/pong 心跳（30s）、连接跟踪（上限 10）、idle 自动断开
- 状态：✅ 已修复

### 10. 持久化 JSON 解析失败 → 静默丢失全部历史

- 位置：`apps/bridge/src/state/persistence.ts` `loadSessionIndex`
- 任何 JSON 解析异常都 catch 后返回空 index，无备份、无日志、无用户提示。
- 修复：catch 块中写 `.bak` 备份文件 + `console.warn` 日志。`readSessionSnapshot` 同样处理
- 状态：✅ 已修复

### 11. `writeAtomic` 跨文件系统 rename 会抛 EXDEV

- 同文件系统 rename 是原子的，但 temp file 与目标不同 mount point 时 `rename` 会失败，无 fallback。
- 修复：catch EXDEV 后 fallback 到 `writeFile` + `unlink` temp（sync/async 均已处理）
- 状态：✅ 已修复

### 12. Digest 计算无文件大小上限

- 位置：`apps/bridge/src/state/turn-changes.ts`
- `readFile(entryPath)` 整文件读入内存算 SHA-256。遇到 GB 级二进制文件会 OOM。
- 修复：`stat().size > 50MB` 的文件跳过 digest 计算（`collectFileDigests` 和 `collectTargetedFileDigests` 均已处理）
- 状态：✅ 已修复

### 13. `selectRepo` / `setModel` 存在竞态窗口

- 两个并发 `selectRepo` 调用之间无锁，`setModel` 跨越多个 await，其间 context 可能被其他调用替换。
- 修复：`setModel` 添加 `mutationInFlight` 互斥标志 + try/finally；`selectRepo` 在 mutation 进行中时返回 409
- 状态：✅ 已修复

### 14. Auth 刷新失败被静默吞掉

- 位置：`apps/bridge/src/mvp-state.ts`
- `void sessionRuntime.refreshAuthState().catch(() => undefined)` — UI 侧 authState 可能永远停留在旧值。
- 修复：替换为 `console.warn` 日志输出，包含具体错误信息（初始启动 + repo 切换两处）
- 状态：✅ 已修复

---

## P3 — 可用性 / 无障碍

### 15. Tab bar 缺少 ARIA 角色

- `App.tsx` tab 按钮缺 `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`。
- 修复：`<nav>` 添加 `role="tablist" aria-label`，每个 button 添加 `role="tab" aria-selected aria-controls`，每个 tabPage 添加 `role="tabpanel" id`，icon 添加 `aria-hidden`，徽章添加 `aria-label`
- 状态：✅ 已修复

### 16. `window.confirm()` 替代真实对话框

- `ApprovalPanel` 和 `PolicyPanel` 的高风险确认和删除确认使用原生 `confirm()`，屏幕阅读器体验差，移动端不可定制。
- 修复：新建 `ConfirmDialog` 组件（基于 `<dialog>` + shadcn AlertDialog 风格），替换 ApprovalPanel 和 PolicyPanel 中所有 `window.confirm` 调用
- 状态：✅ 已修复

### 17. CSS `:focus-visible` 缺失

- `textarea`、`ghostButton`、`secondaryButton`、`compactToggle` 等交互元素缺少键盘焦点可见态。
- 修复：添加 `--ring` CSS 变量，为 textarea、select、button、secondaryButton、ghostButton、compactToggle、tabBarItem、headerRefreshBtn 等元素添加 `:focus-visible` 样式
- 状态：✅ 已修复

### 18. Dark mode 对比度不足

- `.headerPill.muted` 在深色模式下文字/背景对比度约 3:1，低于 WCAG AA 的 4.5:1 要求。
- 修复：深色模式 `color: #a0a0a0`（约 4.9:1）、浅色模式 `color: #555555`（约 5.5:1）
- 状态：✅ 已修复

### 19. PolicyPanel delete 无 debounce

- 用户快速双击删除按钮可触发两次 `onDeleteRule()`，缺少 pending 状态保护。
- 修复：添加 `deletingRuleId` 状态，删除期间按钮 disabled，显示“删除中…”
- 状态：✅ 已修复

---

## P4 — 代码卫生 / 技术债

### 20. `copilot-sdk.ts` 几乎是空壳

- 仅 re-export `@github/copilot-sdk`，无重试、包装、错误标准化。
- 修复：新增 `withCopilotRetry()` 通用重试封装，支持 transient 错误识别和指数退避
- 状态：✅ 已修复

### 21. `useBridgeApp` 返回对象未 useMemo

- 每次 render 创建新对象引用，如果下游组件做 memo 比较会失效。
- 修复：返回对象用 `useMemo` 包裹，以 connection/session/policy 为依赖
- 状态：✅ 已修复

### 22. 硬编码超时值不可配置

- prompt 15min、rollback 5min 均硬编码在 `session-orchestration.ts`，无 env/config override。
- 修复：提取为 `PROMPT_TIMEOUT_MS` / `ROLLBACK_TIMEOUT_MS` 常量，支持 `JOUDO_PROMPT_TIMEOUT_MS` / `JOUDO_ROLLBACK_TIMEOUT_MS` 环境变量覆盖
- 状态：✅ 已修复

### 23. Session snapshot 读取无大小限制

- `loadSessionSnapshot` 直接 `readFileSync` 全量读入，未检查文件体积。
- 修复：`readSessionSnapshot` 读取前用 `statSync` 检查文件大小，超过 50 MB 跳过并 warn
- 状态：✅ 已修复

---

## 汇总

| 级别 | 数量 |
|------|------|
| P0 真实 Bug | 3 |
| P1 安全 | 5 |
| P2 可靠性 | 6 |
| P3 可用性 | 5 |
| P4 技术债 | 4 |
| 合计 | 23 |
