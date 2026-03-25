# Joudo 快速上手

## 适用范围

本指南面向开发环境。打包后的 desktop `.app` 不需要预装 Node，但在本仓库执行构建和开发仍需要以下工具。

## 前置条件

- macOS
- Node.js（建议 22+）
- Corepack（`corepack enable`）
- pnpm（由 Corepack 自动管理，版本 10.6.0）
- GitHub Copilot CLI 已登录（`copilot login`）

## 安装依赖

```bash
corepack pnpm install
```

如果遇到网络问题：

```bash
source ~/.zshrc && proxyon
corepack pnpm install
```

## 启动开发环境

同时启动 bridge 和 web：

```bash
corepack pnpm dev
```

分别启动：

```bash
corepack pnpm dev:bridge   # bridge → http://localhost:8787
corepack pnpm dev:web      # web → http://localhost:5173
```

启动 desktop（Tauri dev 模式）：

```bash
corepack pnpm dev:desktop
```

## 手机访问

1. 确保手机和电脑在同一 LAN
2. 打开 desktop 控制面板，复制 LAN 地址
3. 手机浏览器打开该地址
4. 用 TOTP 验证码登录

## 体验路径

1. 打开 Web UI
2. 选择一个仓库
3. 如果没有 policy，点击初始化
4. 发送一条 prompt
5. 在审批区处理权限请求
6. 查看 Summary、Timeline、Activity、History

## 常用命令

```bash
# 类型检查
corepack pnpm typecheck

# bridge 测试
corepack pnpm --filter @joudo/bridge test

# web 测试
corepack pnpm --filter @joudo/web test

# 全量构建
corepack pnpm build

# desktop .app 打包
corepack pnpm build:desktop

# desktop .dmg 打包
corepack pnpm build:desktop:dmg

# packaged desktop 回归验证
corepack pnpm validate:desktop:packaged

# live policy 回归
corepack pnpm validate:policy-live
```

## 模型选择

Web UI 可以直接切换模型，切换后下一条 prompt 生效。

bridge 优先通过 Copilot SDK 运行时探测可用模型列表；如果探测失败，回退到环境变量：

```bash
JOUDO_MODEL=gpt-5.4 corepack pnpm dev:bridge
JOUDO_AVAILABLE_MODELS=gpt-5-mini,gpt-5.4,gpt-5 corepack pnpm dev:bridge
```

## 策略模板

推荐起始模板：`docs/examples/joudo-policy.recommended.yml`

复制到目标仓库：

```bash
cp docs/examples/joudo-policy.recommended.yml /path/to/your-repo/.github/joudo-policy.yml
```

详细 policy 说明见 `docs/policy-guide.md`。

## 安装测试版 desktop（unsigned）

1. 从 GitHub Release 下载与你机器架构匹配的 `.dmg`（x64 或 arm64）
2. 打开 `.dmg`，将 `Joudo.app` 拖入 `Applications`
3. 首次打开若看到"无法验证开发者"，先取消
4. 打开"系统设置 → 隐私与安全性"，找到 Joudo 的阻止提示，选择"仍要打开"
5. 再次启动 `Joudo.app`

备用方法：在 Finder 中按住 Control 点击 `Joudo.app`，选择"打开"，在弹窗中确认。

## 当前边界

- 这是开发态 + 测试版，不是正式签名发行版
- 当前仅限 LAN 使用，无 HTTPS/WSS
- rollback 只支持上一轮整体回退
- 恢复优先保证事实可解释，不保证旧会话安全续跑
