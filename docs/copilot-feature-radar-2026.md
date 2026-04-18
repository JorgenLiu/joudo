# GitHub Copilot 新特性雷达（2026-04）

> 本文档整理自 GitHub Copilot 官方最新文档（截至 2026 年 4 月），系统分析各项新特性与 Joudo 的契合度、当前状态与整合路径。
>
> **阅读指引：** 每个特性包含「目前状态」「整合机会」「优先级」三个维度。优先级分 P0（直接收益）/ P1（中期增强）/ P2（未来方向）。

---

## 一、全景总结

| 特性 | 类别 | Joudo 相关度 | 推荐优先级 |
|------|------|-------------|-----------|
| ACP TCP 模式 + 官方 TS SDK | 通信协议 | ★★★★★ | P0 |
| Hooks（preToolUse / postToolUse） | 安全策略 | ★★★★★ | P0 |
| Plan Mode（互动规划模式） | 会话 UX | ★★★★☆ | P0 |
| 模型选择（`--model` / `/model`） | 会话控制 | ★★★★☆ | P0 |
| 自动 Context 压缩（Auto-compaction） | 会话稳定性 | ★★★★☆ | P1 |
| Copilot Memory（持久仓库记忆） | 上下文增强 | ★★★★☆ | P1 |
| Custom Instructions 多层叠加 | 项目配置 | ★★★★☆ | P1 |
| Agent Skills | 专业化任务 | ★★★☆☆ | P1 |
| `--deny-tool` / `--allow-tool` flags | 策略编译 | ★★★★★ | P0（已部分实现） |
| 拒绝时内联反馈（Inline rejection feedback） | 审批 UX | ★★★★☆ | P1 |
| 消息排队（Enqueue messages） | 会话 UX | ★★★☆☆ | P2 |
| 视觉输入（图片附件） | 输入扩展 | ★★☆☆☆ | P2 |
| Third-party Coding Agents | Agent 生态 | ★★★☆☆ | P2 |
| MCP 注册表策略管理 | 企业管理 | ★★☆☆☆ | P2 |

---

## 二、特性详解

### 2.1 ACP（Agent Client Protocol）— TCP 模式 + 官方 TS SDK

**最新变化**

官方文档正式将 ACP 定义为 Copilot CLI 的标准外部通信协议，并提供了两种模式：

- `--acp --stdio`：通过标准输入/输出通信（推荐用于 IDE 集成，即 Joudo 当前方式）
- `--acp --port 3000`：通过 TCP 通信（新增，适合多进程/远程场景）

官方同时发布 `@agentclientprotocol/sdk` TypeScript 客户端库，其 API 已稳定：

```typescript
const connection = new acp.ClientSideConnection((_agent) => client, stream);
await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
const sessionResult = await connection.newSession({ cwd: process.cwd(), mcpServers: [] });
const promptResult = await connection.prompt({
  sessionId: sessionResult.sessionId,
  prompt: [{ type: "text", text: promptText }],
});
```

**当前状态**

Joudo 已通过 Copilot SDK（`@github/copilot-sdk`）在内部使用 ACP，但没有直接依赖 `@agentclientprotocol/sdk` 官方客户端。

**整合机会**

1. **迁移到官方 ACP SDK**：目前使用的 `@github/copilot-sdk` 是 GitHub 内部封装，`@agentclientprotocol/sdk` 是开放标准。评估两者 API 差异，如官方 SDK 已稳定，可考虑在下一次 SDK 大版本升级时统一切换，以降低上游依赖风险。

2. **TCP 模式探索**：当前 bridge 以 stdio pipe 方式启动 Copilot 子进程。TCP 模式将 Copilot CLI 作为独立守护进程运行，bridge 通过网络连接，与 Copilot 进程完全解耦。这将改善以下场景：
   - 多 bridge 实例共享单个 Copilot 进程（省资源）
   - Copilot 进程崩溃后 bridge 可直接重连而无需重新 spawn
   - 跨网络调试更简单

3. **ACP `stopReason` 精化**：官方 `promptResult.stopReason` 有明确语义（`end_turn`、限制、取消等）。当前 bridge 的会话状态机可以对齐这些语义，使 `running → idle` 转换更准确，减少靠轮询判定的情况。

**优先级：P0**（迁移 TCP 模式是中期重要架构决策，建议先做调研 spike）

---

### 2.2 Hooks（.github/hooks/*.json）

**最新变化**

这是 2026 年最重要的新能力之一。Copilot CLI 和 Cloud Agent 现在支持在以下生命周期点执行自定义 shell 命令：

| Hook 类型 | 触发时机 | 最关键用途 |
|-----------|----------|-----------|
| `preToolUse` | 工具调用前 | **可编程批准或拒绝工具执行** |
| `postToolUse` | 工具调用后 | 审计日志、结果记录 |
| `sessionStart` | 会话开始 | 初始化、日志 |
| `sessionEnd` | 会话结束 | 清理、报告 |
| `userPromptSubmitted` | 用户提交提示词 | 请求日志 |
| `errorOccurred` | 发生错误 | 错误追踪 |

`preToolUse` hook 的 JSON 输入包含完整的工具调用上下文，脚本的退出码和 stdout 决定是否批准：

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "./scripts/security-check.sh",
        "cwd": "scripts",
        "timeoutSec": 15
      }
    ]
  }
}
```

**当前状态**

Joudo 目前的审批流完全发生在 bridge 层（TypeScript）：`policy/evaluation.ts` 对 `PermissionRequest` 做规则匹配，通过 WebSocket 发送 `ApprovalRequest` 到 Web 前端，等待用户响应后再调用 Copilot SDK 的 `approve/deny`。这是"拦截-转发-等待"模式。

**整合机会**

Hooks 与 Joudo 的 policy 系统是**互补而非替代**关系：

1. **`preToolUse` hook 作为第一道快速静态防线**：在 bridge 的动态审批之前，通过 `preToolUse` hook 脚本执行纯静态规则（如：拒绝所有 `rm -rf`、拒绝访问 `.env` 文件）。好处是即使 Joudo bridge 不在或出现异常，这层防线依然有效。相当于在 Copilot 层放置了一个轻量守门人。

2. **`postToolUse` hook 作为审计日志补充**：当前 `state/audit.ts` 在 bridge 内记录审批历史。`postToolUse` hook 可在 Copilot CLI 层直接将工具执行结果写入 `.joudo/audit.jsonl`，提供独立于 bridge 进程的持久审计轨迹。

3. **`userPromptSubmitted` hook 记录提示词**：目前用户提示词只在 bridge 内存中留有记录，通过此 hook 可以在会话级别独立持久化所有提示词输入。

4. **`sessionStart` / `sessionEnd` hooks**：可用于在 `.joudo/sessions/<id>/` 目录自动写入 session 元数据，与 Joudo 的 `sessions-index.json` 保持同步，作为容灾层。

**整合路径**

- 在 bridge 启动 Copilot CLI 时，自动将 `.github/hooks/joudo-policy.json` hook 配置写入目标仓库（或通过 env 指定 hooks 目录）
- hook 脚本读取 `.joudo/repo-policy.yml` 的静态 `denyShell` / `denyTools` 规则，对已知危险命令直接短路拒绝，无需经过 bridge 审批流
- 所有 hook 脚本产出写入 `.joudo/hook-trace.jsonl`，bridge 读取该文件作为辅助审计信息展示在 UI

**优先级：P0**（与 Joudo 安全架构高度契合，建议作为下一个主要特性实现）

---

### 2.3 Plan Mode（互动规划模式）

**最新变化**

Copilot CLI 现在有两种交互模式，通过 `Shift+Tab` 切换：

- **Ask/Execute 模式**（默认）：即时执行型，直接完成任务
- **Plan 模式**（新增）：交互式规划，在写代码前提问、澄清需求、构建结构化实现方案

Plan 模式在 Joudo 的上下文中尤为有价值：手机用户发起的任务往往描述粗略，Plan 模式可以让 Copilot 主动追问而不是盲目执行，减少不必要的权限请求和危险动作。

**当前状态**

Joudo 目前没有暴露模式切换能力。所有会话以默认的 ask/execute 模式运行。

**整合机会**

1. **Web UI 中暴露模式选择**：在 Console tab 的 prompt 输入区增加一个切换开关，让用户选择「直接执行」或「先规划」。这映射到启动 Copilot CLI 时是否传入 `--plan-mode` flag（如果 SDK 支持）或通过 ACP 协议发送 mode 切换信号。

2. **Plan 模式作为高风险任务的默认**：当用户提示词包含高风险关键词（如"删除"、"重构全部"、"清理"），bridge 可以自动建议切换到 plan 模式，减少破坏性操作的可能性。

3. **规划产物持久化**：Plan 模式会生成结构化实现方案。bridge 可以捕获这些规划内容，存入 `.joudo/sessions/<id>/plan.json`，让用户可以在 History tab 回顾。

**优先级：P0**（可以作为 Console tab 的 UX 增强先行实现，逻辑简单但用户价值明显）

---

### 2.4 模型选择（`--model` / `/model`）

**最新变化**

Copilot CLI 默认使用 Claude Sonnet 4.5，可通过以下方式切换：
- `--model` 命令行参数（启动时）
- `/model` 斜线命令（会话中）
- 每次 prompt 消耗 premium request 配额，倍数取决于模型

**当前状态**

bridge 在 `mvp-state.ts` 中已有模型切换逻辑（搜索 "按新模型重新创建 ACP 会话"），说明已有基础，但 UI 层的模型选择器在 Web 端可能尚不完整。

**整合机会**

1. **在 Console tab 增加模型选择器**：下拉菜单显示可用模型列表（需通过 ACP 或 Copilot CLI 的 `/model` 命令获取），选择后记录到会话配置，重启 ACP 会话时带入。

2. **模型配额可视化**：获取当前月度 premium request 余量，以进度条或数字显示在 UI 中，避免用户超量使用高倍数模型。

3. **repo 级别模型偏好**：将模型选择持久化到 `.joudo/repo-instructions.md` 或一个新的 `.joudo/session-defaults.json`，下次打开同一 repo 时自动使用上次选择的模型。

**优先级：P0**（改进已有特性，成本低，用户价值直接）

---

### 2.5 自动 Context 压缩（Auto-compaction）

**最新变化**

Copilot CLI 现在在会话 context 达到 **95% token 用量**时自动在后台压缩历史，实现"近乎无限对话"。同时支持：

- `/compact`：手动触发压缩
- `/context`：显示详细 token 用量明细
- `Escape`：取消正在进行的手动压缩

**当前状态**

Joudo 的 `state/activity.ts` 和 `state/checkpoints.ts` 对会话状态有记录，但当前没有对 context 窗口长度做监控或管理。当 ACP 会话因 context 限制导致行为异常时，bridge 可能只能捕获到通用错误而非 context-full 的具体原因。

**整合机会**

1. **通过 ACP 监测 context 状态**：如果 ACP 协议暴露了 token 用量信息，bridge 可以将 context 饱和度透传给 Web UI，显示"当前会话 context 剩余 X%"的提示，让用户了解何时会触发自动压缩或需要开新会话。

2. **主动 compact 触发**：bridge 检测到会话已进行 N 轮（可配置阈值），自动发送 `/compact` 命令，避免 context 在关键时刻触发自动压缩导致时机不可控。

3. **压缩前状态快照**：在 `/compact` 执行前，将当前完整 timeline 写入 `.joudo/sessions/<id>/pre-compact-snapshot.json`，作为压缩损失的补偿存档。

**优先级：P1**（对长会话稳定性有实质帮助，但需要 ACP 协议支持 token 信息）

---

### 2.6 Copilot Memory（持久仓库记忆）

**最新变化**

Copilot Memory 是 **public preview** 特性，允许 Copilot 在工作过程中自动发现并存储仓库的关键特征（如编码规范、常见模式、需要同步的配置项），并在后续操作中自动引用这些记忆：

- 记忆是仓库作用域的（repo-scoped），不与用户绑定
- 记忆存储带有 citation（代码位置引用），使用前会重新验证，过期则废弃
- 记忆自动在 28 天后过期；如被验证使用则续期
- 目前可用于：Copilot Cloud Agent、Copilot Code Review、Copilot CLI

**当前状态**

Joudo 已有 `.joudo/repo-instructions.md` 作为仓库级别的手动指令文件，作用类似于 Copilot Memory 的人工编写版本。

**整合机会**

1. **与 `.joudo/repo-instructions.md` 协同设计**：当 Copilot Memory 生成了关于某仓库的 memory 后，bridge 可以通过 GitHub API 或 Copilot Memory 管理接口查询这些记忆，将重要的记忆自动同步到 `.joudo/repo-instructions.md`，形成可编辑的持久化副本。这样即使 Copilot Memory 过期，人工维护的版本仍有效。

2. **Memory 状态可视化**：在 Policy tab 旁新增一个 Memory tab 或侧边栏，展示当前仓库的 Copilot Memory 内容和 citation，让用户了解 Copilot 目前"知道"这个仓库的哪些信息，并支持手动删除某条记忆。

3. **结合 onboarding 流程**：当用户首次为某 repo 初始化 Joudo 时，如果该 repo 已有 Copilot Memory，自动将其导入 `.joudo/repo-instructions.md` 作为初始内容，减少用户手写 instructions 的负担。

**优先级：P1**（需要 Copilot Memory 管理 API 可用，目前仍是 preview，可跟踪中观察）

---

### 2.7 Custom Instructions 多层叠加

**最新变化**

Copilot CLI 现在支持**多层 custom instructions 同时生效**（而不是优先级后备机制）：

| 类型 | 文件位置 | 作用域 |
|------|----------|--------|
| 仓库级 | `.github/copilot-instructions.md` | 全仓库 |
| 路径特定 | `.github/instructions/*.instructions.md` | 特定文件路径（glob） |
| Agent 指令 | `AGENTS.md`（根目录或当前目录）| 各 AI agent 通用 |
| 本地用户级 | `~/.copilot/copilot-instructions.md` | 所有项目 |
| 环境变量级 | `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | 指定目录 |

路径特定指令支持 `excludeAgent` 字段，可将某条指令排除给特定 agent（如 code-review、coding-agent）。

**当前状态**

Joudo 已有 `.joudo/repo-instructions.md`，这是 Joudo 自己的 meta 层，用于传递仓库上下文给 Copilot。但目前尚未系统地管理 `.github/copilot-instructions.md` 的生命周期。

**整合机会**

1. **Joudo 作为 custom instructions 的管理层**：在 Joudo 初始化仓库时（`POST /api/repo/init`），自动检查并引导用户创建/更新 `.github/copilot-instructions.md`。可以在 Web UI 的 Policy tab 提供一个"项目说明编辑器"，编辑后写回该文件。

2. **`.joudo/repo-instructions.md` → `.github/copilot-instructions.md` 迁移路径**：考虑将 `.joudo/repo-instructions.md` 的内容合并进或连接到 `.github/copilot-instructions.md`，使其同时被 Joudo bridge 和 CLI 原生读取。

3. **路径特定指令的 UI 支持**：未来在 Policy tab 增加"智能指令管理"，允许用户针对特定文件类型（如 `**/*.test.ts`）添加专属 Copilot 指令。这些指令以 `.github/instructions/` 目录下的文件存储。

4. **`AGENTS.md` 感知**：agent-discovery.ts 目前扫描自定义 agent 文件。可以扩展为同时感知 `AGENTS.md` 的存在，当用户已有 `AGENTS.md` 时，bridge 可以将其内容导入 Joudo 的 agent catalog，减少重复配置。

**优先级：P1**

---

### 2.8 Agent Skills

**最新变化**

Agent Skills 是**开放标准**（agentskills 规范），允许开发者在特定目录存放"技能包"（教学型指令 + 脚本 + 资源），让 Copilot 在需要时自动加载：

- 项目级：`.github/skills/`、`.claude/skills/`、`.agents/skills/`
- 用户级：`~/.copilot/skills/`、`~/.claude/skills/`

可参考公开 skill 库：`anthropics/skills`、`github/awesome-copilot`

**当前状态**

Joudo 的 `agent-discovery.ts` 已经扫描 `~/.copilot/` 目录下的 `.agent.md` 文件。Agent Skills 目录与当前扫描路径有重叠，但格式和用途不同（agent 文件 vs skill 文件）。

**整合机会**

1. **扩展 agent-discovery 为 skill-discovery**：在扫描 `~/.copilot/` 时，同时识别 skills 目录，将可用的 skill 展示在 Web UI 中，让用户了解当前会话涉及的仓库有哪些预定义 skill 可用。

2. **Joudo 特定 skill 包**：创建 `.github/skills/joudo-workflow/` skill 包，内含 Joudo 的最佳使用教学（如如何安全地批准 write 权限、如何配置 policy 等），使新接入用户能更好地使用 Joudo。

3. **Skill 市场集成**：在 Web UI 增加"发现 skill"入口，链接到 `github/awesome-copilot`，允许用户一键安装某个 skill 到当前仓库。

**优先级：P1**

---

### 2.9 `--deny-tool` / `--allow-tool` Flags（已部分实现）

**最新变化**

Copilot CLI 的 tool approval flags 已经成熟，文档完整：

```bash
# 完全允许所有工具，但拒绝 rm 和 git push
copilot --allow-all-tools --deny-tool='shell(rm)' --deny-tool='shell(git push)'

# 允许特定 MCP server 的所有工具，但拒绝特定工具
copilot --allow-tool='My-MCP-Server' --deny-tool='My-MCP-Server(tool_name)'

# 允许使用 write 工具（文件修改）无需每次确认
copilot --allow-tool='write'
```

**当前状态**

`policy/evaluation.ts` 已经将 policy 规则编译成传递给 Copilot SDK 的 flags（`allowTools`、`denyTools`、`confirmTools`、`allowShell`、`denyShell`）。这是正确方向。

**整合机会**

1. **MCP Server 粒度控制**：当前 policy 类型中有 `McpPermissionRequest`（serverName + toolName），但可能尚未充分利用 `--deny-tool='MCP_SERVER_NAME(tool)'` 的粒度。确保 MCP 类型的 policy 规则能被正确编译为这种格式。

2. **`shell(git push)` 子命令级控制**：文档确认 `git` 和 `gh` 命令支持一级子命令粒度控制。Joudo 的 `shell-candidates.ts` 中的高危命令模式应更新为使用这种更精确的格式，而不是宽泛的 `shell(git)`。

3. **Policy 编译测试覆盖**：`policy.test.ts` 中已有 "ACP git variants" 相关测试，可以在此基础上补充 MCP 工具粒度控制和 `shell(git push)` 子命令格式的测试。

**优先级：P0**（改进已有实现，成本低，安全性提升明显）

---

### 2.10 拒绝时内联反馈（Inline Rejection Feedback）

**最新变化**

当用户在 Copilot CLI 中拒绝一个工具权限请求时，现在可以**同时提供原因说明**，让 Copilot 了解为什么被拒绝，从而调整策略而不是中断任务。

这使"拒绝"的语义从「停止执行」升级为「导引调整」。

**当前状态**

Joudo 的审批流返回 `approve` 或 `deny`，deny 时只传递一个布尔值，没有附带文字理由。Copilot SDK 的 `PermissionRequestResult` 可能支持 `reason` 字段，但目前尚未使用。

**整合机会**

1. **Deny 理由文本输入框**：在 Web UI 的审批卡片上，当用户点击"拒绝"时，显示一个可选的文本输入框，让用户填写拒绝原因（如"请用只读方式，不要直接修改"）。这个理由通过 bridge 传递给 Copilot SDK 的 deny 调用。

2. **预设拒绝模板**：提供几个快速选择（"请提供计划而不是直接执行"、"这个路径超出了本仓库范围"、"请先获取我的确认"），让移动端用户可以快速表达常见的拒绝理由。

3. **拒绝理由作为审计记录**：将用户填写的拒绝理由写入 `state/audit.ts` 的审计日志，形成完整的决策记录。

**优先级：P1**（改善会话连续性的高效 UX 改进）

---

### 2.11 消息排队（Enqueue Messages）

**最新变化**

Copilot CLI 在 agent 思考/执行过程中，用户现在可以**排队新消息**，这些消息会在当前响应完成后被处理，无需等待。这让对话更自然，并让用户可以在不打断当前任务的情况下提前给出下一步指令。

**当前状态**

Joudo 的 Web UI 目前在 Copilot `running` 状态时 prompt 输入框是否禁用不明确，需要检查。

**整合机会**

1. **Running 状态下保持输入框可用**：当会话 status 为 `running` 时，不禁用 prompt 输入框，而是改为"排队发送"状态，提示用户"当前任务完成后将自动发送此消息"。

2. **排队消息队列可视化**：在 Console tab 显示一个待发送队列，用户可以取消排队的消息。

**优先级：P2**（UX 优化，实现相对简单）

---

### 2.12 视觉输入（图片附件）

**最新变化**

Copilot Cloud Agent 和 Copilot Chat 现在支持将图片附加到 issue 或 prompt 中，让 Copilot 理解视觉内容（如 UI 截图、设计稿、报错截图）。

**当前状态**

Joudo 的 prompt 输入目前是纯文本。

**整合机会**

移动端场景尤其需要图片输入：用户可以直接拍摄手机屏幕上的报错信息或 UI 设计稿发给 Copilot。

1. **图片 Prompt 支持**：在 Web UI 的 Console prompt 区增加图片上传按钮（`<input type="file" accept="image/*" capture="environment">`），上传后作为附件随 prompt 一起通过 ACP 发送。需要确认 Copilot CLI ACP 协议是否支持图片类型的 prompt content。

2. **截图直接粘贴**：同时支持 paste 图片（`Ctrl+V` / 长按粘贴），适合移动端场景。

**优先级：P2**（移动端杀手级功能，但需要 ACP 协议支持图片 content type 才能实现）

---

### 2.13 Third-party Coding Agents（Public Preview）

**最新变化**

GitHub 现在支持在 Copilot 旁边使用第三方 coding agents（如 Devin、Cursor 的 agent 等），通过标准化接口协调多 agent 任务。

**当前状态**

Joudo 的 `agent-discovery.ts` 已扫描本地 `.agent.md` 文件，建立了一个简单的 agent catalog，但这些 agent 是 Copilot 内部的 custom agents，而不是外部三方 agent。

**整合机会**

1. **将 Joudo 注册为 Third-party Agent**：从更长期的视角看，Joudo 的 bridge 理念（本地代理 + 策略控制 + 移动前端）与 third-party agent 概念高度兼容。未来可以将 Joudo bridge 包装为一个可被 GitHub 平台调度的第三方 agent。

2. **多 agent 场景的策略扩展**：当同一仓库有多个 agent 工作时，policy 需要能跨 agent 协调（如互斥写入某文件）。这是长期架构方向。

**优先级：P2**（方向清晰但时机尚早）

---

## 三、安全对齐分析

新特性中与 Joudo 安全架构高度相关的关键点：

### Hooks 的安全注意事项（Joudo 层面）

官方文档明确指出 hooks 的安全风险，值得在 Joudo 实现时严格遵守：

- **sanitize hook 输入**：hook 脚本接收 JSON 输入（工具调用上下文）。如果脚本将这些输入直接传入 shell 命令，存在注入风险。Joudo 提供的标准 hook 脚本必须使用 `jq` 解析 JSON 而不是字符串拼接。
- **严格文件权限**：hook 脚本和 `.joudo/hook-trace.jsonl` 应设置 `600` 权限，防止其他进程读取敏感的执行日志。
- **`preToolUse` hook 决策原则**：Joudo 提供的 hook 脚本应实现**默认拒绝（deny-by-default）**逻辑，明确允许的操作进白名单，而不是黑名单所有危险命令。此原则与现有 policy 模型一致。
- **hook 执行超时**：所有 Joudo 提供的 hook 脚本应设置合理的 `timeoutSec`（建议 5–10 秒），避免阻塞 Copilot 执行。

### ACP `requestPermission` 回调

ACP 官方 SDK 的 `requestPermission` 回调是 bridge 审批流的最重要接入点。Joudo 应确保：

- 永远不在 `requestPermission` 中返回 `outcome: "cancelled"` 而不记录原因
- 在 bridge 崩溃恢复时，旧的 `awaiting-approval` 请求**绝对不能**被自动通过（当前已有相关保护，值得验证仍然有效）

---

## 四、优先级行动建议

### P0 — 近期迭代（1–2 个 sprint）

1. **`--deny-tool` 精化**：将 `shell-candidates.ts` 的高危命令模式升级为使用 `shell(git push)` / `shell(git push --force)` 子命令格式；补充 MCP 工具级拒绝的 policy 编译逻辑和测试。

2. **Plan Mode 暴露**：在 Console tab 的 prompt 输入区增加一个"先规划/直接执行"切换按钮，通过 bridge API 传递模式选择，在启动 Copilot CLI 时带入对应参数。

3. **模型选择器完善**：确认 bridge 中已有的模型切换逻辑是否完整，补全 Web UI 端的模型选择 + 当前会话模型展示。

4. **Deny 理由文本输入**：审批卡片新增可选的理由输入框，理由通过 Copilot SDK 的 deny 回调传递，同时记入审计日志。

### P1 — 中期迭代（1–2 个月）

5. **Hooks 基础设施**：实现 `preToolUse` hook 脚本（安全静态过滤）和 `postToolUse` hook 脚本（独立审计日志），在 bridge `startCopilot` 流程中自动部署到目标仓库。

6. **Custom Instructions 管理**：在 Web UI Policy tab 增加 `.github/copilot-instructions.md` 查看和编辑入口；bridge 初始化时检查并提示创建该文件。

7. **Context 饱和度提示**：如果 ACP 协议暴露 token 用量，在 UI 显示 context 剩余百分比；到达阈值时提示用户考虑压缩或新建会话。

8. **Skill 目录扫描**：扩展 agent-discovery 同时扫描 `.github/skills/` 和 `~/.copilot/skills/`，在 UI 展示可用的 skill。

### P2 — 长期跟踪

9. **ACP TCP 模式**：评估并做技术 spike，确定是否切换到 TCP 模式可带来可量化的稳定性或性能提升。
10. **Copilot Memory API 集成**：待 Memory 管理 API 正式 GA 后，实现 Memory 可视化和与 `.joudo/repo-instructions.md` 的双向同步。
11. **图片 Prompt**：待确认 ACP 协议支持图片 content type 后实现。
12. **Third-party Agent 注册**：将 Joudo bridge 包装为可被 GitHub 平台识别的 third-party agent。

---

## 五、参考链接

| 文档 | URL |
|------|-----|
| GitHub Copilot features 总览 | https://docs.github.com/en/copilot/get-started/features |
| About Copilot CLI | https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli |
| Copilot CLI ACP server | https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server |
| About hooks | https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks |
| About agentic memory | https://docs.github.com/en/copilot/concepts/agents/copilot-memory |
| Agent skills | https://docs.github.com/en/copilot/concepts/agents/about-agent-skills |
| Custom instructions for CLI | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions |
| MCP server management | https://docs.github.com/en/copilot/concepts/mcp-management |
| Copilot cloud agent | https://docs.github.com/en/copilot/using-github-copilot/coding-agent |
| ACP official docs | https://agentclientprotocol.com/protocol/overview |
| Agent skills spec | https://github.com/agentskills/agentskills |
| Awesome Copilot skills | https://github.com/github/awesome-copilot |
