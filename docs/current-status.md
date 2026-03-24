# Joudo 当前状态

## 一句话结论

Joudo 当前已经是一个可运行的本地 bridge + Web UI MVP，主链路可用，当前工作的重心是治理、解释和收口，而不是验证是否可行。

## 当前可用能力

### 真实会话闭环

当前网页可以：

- 选择仓库
- 发送 prompt
- 驱动真实 Copilot 会话
- 接收结构化 session snapshot

### 结构化产品面

当前 Web UI 已包含：

- 仓库列表
- Prompt 输入
- 审批队列
- Repo Policy 面板
- Summary
- Timeline
- Activity
- Session History
- 错误面板
- 当前 repo 的 agent 选择与 repo/global agent 数量

### 运行时策略与审批

当前 bridge 已把 repo policy 接入真实权限判定，支持：

- tool allow / confirm / deny
- shell allow / confirm / deny
- read path allow / confirm
- write path allow / confirm / deny
- URL allow / deny

网页审批支持：

- 拒绝
- 允许本次
- 允许并加入 policy

### 历史、恢复与回退判断

当前 bridge 已支持：

- repo-scoped 历史 session index 与 snapshot
- history-only 恢复
- best-effort attach
- 上一轮整体回退判断

### 运行时 agent

当前 bridge 会在运行时扫描：

- Copilot 全局 `agents/`
- 当前 repo `.github/agents/`

如果选中的 agent 在下一轮前消失，bridge 会自动切回默认模式并提醒用户。

当前手机 Web UI 也会展示 agent 区域；如果当前没有发现任何 agent，不再直接隐藏，而是明确提示需要在 `~/.copilot/agents/` 或当前 repo 的 `.github/agents/` 下提供 agent 文件。

当前明确边界是：Joudo bridge 暂时只暴露文件系统中可发现的 Copilot agent，不包含 VS Code 聊天面板里注入的编辑器内 agent（例如当前会话里可见的 `ui-design`）。

## 当前明确边界

### 不是远程 shell

Joudo 不是终端转发器，也不做 TUI 抓取。

### 不是强一致恢复器

恢复优先保证事实可解释，不保证任何旧会话都能安全继续执行。

### agent 选择是运行时状态

`.joudo` 历史快照不会持久化 agent 选择和 agent 列表。

### rollback 仍然只支持上一轮整体回退

当前没有 checkpoint restore，也没有任意历史 turn rewind。

### 当前仍以开发态交付为主

主交付仍然是：

- `apps/bridge`
- `apps/web`
- `apps/desktop` 作为本地控制面

当前默认 desktop 打包链路已经收敛为生成 `.app`，不再把 `.dmg` 成功与否作为主发布路径是否可用的前置条件。

### 桌面控制面的当前启动方式

当前 macOS 桌面控制面是菜单栏托盘 app，而不是常驻前台主窗口。

当前行为是：

- 启动 Joudo desktop 后先驻留在菜单栏托盘
- bridge 会随桌面控制面自动拉起
- 点击菜单栏托盘图标可打开控制面板窗口
- 关闭窗口时不会退出 app，而是回到托盘继续驻留

### 当前 desktop packaging 结论

当前已验证：

- `corepack pnpm build:desktop` 可稳定产出 `.app`
- 默认产物路径是 `apps/desktop/src-tauri/target/release/bundle/macos/Joudo.app`
- packaged `.app` 会从 `Contents/Resources/runtime/node/bin/node` 拉起 bridge，而不是依赖宿主机 Node
- packaged bridge 已验证会监听 `8787`，bridge 入口和 Copilot 子进程都来自 app bundle 内路径

当前已知限制：

- 默认 `.dmg` 现已改走简化的 `hdiutil create -srcfolder Joudo.app` 路径
- 这样绕开了 Tauri create-dmg 辅助脚本在这台 macOS Ventura 开发机上的临时磁盘镜像卸载失败问题

## 当前主要风险

- `/undo` 仍然不是强事务回滚
- 上游 CLI / SDK 行为仍可能影响恢复边界
- policy 治理仍需要继续收紧

## 当前推荐阅读顺序

1. `README.md`
2. `docs/architecture.md`
3. `docs/implementation-notes.md`
4. `docs/policy.md`
5. `docs/next-step-plan.md`