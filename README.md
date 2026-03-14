# Joudo

Joudo 是 GitHub Copilot CLI 的一个本地优先、网页优先的移动访问前端。

它的核心思路是：先让手机通过浏览器访问一个安静的聊天界面，而真正执行编码代理的仍然是同一局域网内 Mac 上运行的 Copilot；等闭环跑通后，再把这层网页封装成原生 App。

## Joudo 是什么

- 面向 Copilot CLI 的移动优先 Web 聊天 UI
- 一个按仓库管理 Copilot 会话的 Mac 侧桥接服务
- 一个对工具调用、路径访问和网络访问进行策略控制的审批层
- 一个面向代理结果的结构化摘要视图

## Joudo 不是什么

- 远程桌面应用
- 终端镜像工具
- 默认依赖公网的云中继
- 一个给 Copilot 套上 `--allow-all` 的宽松包装器

## 初始技术方向

- 使用 GitHub Copilot CLI 作为编码引擎。
- 持久会话优先采用 ACP 模式。
- 桥接服务保持在 Mac 本机运行。
- MVP 阶段先交付移动优先网页界面，后续再封装为 App。
- 为每个仓库维护类似 `sudoers` 的策略文件，但覆盖范围扩展到工具、路径和 URL。
- 将摘要、审批请求和进度更新发送到网页客户端 UI。

## 文档

- [架构](docs/architecture.md)
- [策略模型](docs/policy.md)
- [首次配置与登录引导](docs/onboarding.md)
- [阶段工作总结](docs/progress-summary.md)
- [当前实现说明](docs/implementation-notes.md)
- [ACP Demo 计划与现状](docs/acp-demo-plan.md)

## 工程结构

- `apps/bridge`: Mac 本地 bridge 服务，负责 HTTP、WebSocket、会话管理和审批流骨架
- `apps/web`: 移动优先网页客户端，负责提示词输入、审批卡片和摘要展示
- `packages/shared`: 前后端共享的协议类型与事件定义

## 本地启动

1. 安装依赖：`corepack pnpm install`
2. 如果安装依赖遇到网络问题：`source ~/.zshrc && proxyon`
3. 启动 bridge 和 web：`corepack pnpm dev`
4. 网页默认地址：`http://localhost:5173`
5. 如果网页显示 Copilot 未登录：在 Mac 终端执行 `copilot login`，完成浏览器授权后回到网页点击“重新检查登录状态”
6. 开发阶段默认模型是 `gpt-5-mini`；如果要切换模型，可在启动 bridge 前设置 `JOUDO_MODEL`，例如：`JOUDO_MODEL=gpt-5.4 corepack pnpm --filter @joudo/bridge dev`

## MVP 范围

1. 在同一局域网内通过手机浏览器访问 Mac 上的网页界面。
2. 在 Mac 上选择一个受信任仓库。
3. 启动或恢复一个由 ACP 驱动的 Copilot 会话。
4. 将来自网页端的提示词转发进去。
5. 结合仓库策略与网页确认来处理审批请求。
6. 返回精简结果，并可选提供详细转录记录。

## 指导原则

- 本地优先
- 信任范围限定在仓库级别
- 对危险操作默认拒绝
- 不做 TUI 抓取
- 对审批和实际执行的命令保留明确审计轨迹
