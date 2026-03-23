# Joudo 上手

## 适用范围

这份文档面向当前仓库的开发与演示环境，不是最终用户安装手册。

## 前置条件

需要满足：

- macOS 本机可运行 GitHub Copilot CLI
- 已安装 Node.js 与 Corepack
- 可以使用 `pnpm`
- Copilot CLI 已可登录

## 安装依赖

在仓库根目录执行：

```bash
corepack pnpm install
```

如果安装依赖遇到网络问题，在当前 shell 里执行：

```bash
source ~/.zshrc
proxyon
corepack pnpm install
```

## 启动开发环境

启动 bridge 和 web：

```bash
corepack pnpm dev
```

也可以分别启动：

```bash
corepack pnpm dev:bridge
corepack pnpm dev:web
```

默认端口：

- Web: `http://localhost:5173`
- Bridge: `http://localhost:8787`

## 登录 Copilot CLI

如果网页显示 Copilot 未登录，在宿主机终端执行：

```bash
copilot login
```

完成授权后，回到网页点击“重新检查登录状态”。

## 当前推荐体验路径

1. 打开网页
2. 选择一个受信任仓库
3. 检查 Repo Context 与 Repo Policy 面板
4. 发送一条会触发真实权限请求的 prompt
5. 在审批区处理权限请求
6. 查看摘要、活动视图、时间线和历史会话

## 当前常用验证命令

全量类型检查：

```bash
corepack pnpm typecheck
```

bridge 测试：

```bash
corepack pnpm --filter @joudo/bridge test
```

web 测试：

```bash
corepack pnpm --filter @joudo/web test
```

live policy 回归：

```bash
corepack pnpm validate:policy-live
```

## 当前策略模板

推荐起始模板位于：

- `docs/examples/joudo-policy.recommended.yml`

如果要在目标 repo 上启用 policy，优先复制到：

- `.github/joudo-policy.yml`

## 当前模型选择

开发阶段默认模型是 `gpt-5-mini`。

Web UI 现在会直接显示并切换当前 repo 的执行模型；切换会写回 bridge 当前上下文，并在下一条提示词生效。

bridge 会优先通过 Copilot SDK 运行时探测可用模型列表；只有探测失败时，才回退到环境变量里的静态列表。

如果要切换模型，可在启动 bridge 前设置：

```bash
JOUDO_MODEL=gpt-5.4 corepack pnpm --filter @joudo/bridge dev
```

如果要显式提供可选模型列表，可额外设置：

```bash
JOUDO_AVAILABLE_MODELS=gpt-5-mini,gpt-5.4,gpt-5 corepack pnpm --filter @joudo/bridge dev
```

这个变量现在主要作为兜底配置，而不是前端模型列表的唯一来源。

## 当前边界

- 这是开发态工作流，不是最终安装包形态
- 当前体验依赖本机运行 bridge
- 当前恢复与 rollback 仍然是受控能力，不是强一致事务系统