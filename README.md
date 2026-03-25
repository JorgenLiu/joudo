# Joudo

Joudo 是 GitHub Copilot CLI 的本地优先、网页优先移动访问前端。

它的目标不是把终端搬到手机上，而是在同一局域网里提供一个 repo-scoped、可审批、可恢复、可解释的 Copilot 使用面。当前产品形态是运行在 Mac 本机的 bridge，加上一个移动优先 Web UI。

## 当前结论

Joudo 已经不是纯概念验证。

当前仓库已经具备一条真实闭环：

- Web UI 发送 prompt
- Bridge 驱动真实 Copilot CLI 会话
- Repo policy 在运行时参与权限判定
- 网页审批处理策略外请求
- Summary、Timeline、Activity、History 提供结构化解释
- 审批结果可以按规则写回 repo policy

如果只用一句话概括现在的阶段：这是一个可运行、受控、已打通主链路的 MVP，下一步重点是把治理和产品面收紧，而不是继续堆新的底层能力。

## Joudo 是什么

- 一个移动优先的 Copilot Web 界面
- 一个运行在 Mac 本机的 repo-scoped bridge
- 一套围绕工具、shell、路径、写入和 URL 的策略与审批模型
- 一个把代理过程转成结构化状态的产品层，而不是终端镜像

## Joudo 不是什么

- 远程桌面
- 终端转发器
- 依赖 TUI 抓取或 OCR 的 CLI 包装器
- 默认给 Copilot 开大权限的 `--allow-all` 壳

## 当前已经完成的能力

### 真实会话

- 启动真实 Copilot 会话
- 发送 prompt
- 获取结构化 session snapshot
- 保存 repo-scoped 历史会话与 snapshot
- 对历史会话执行 best-effort attach 或 history-only 恢复

### 策略与审批

- 运行时执行 repo policy 判定
- 支持三态审批：拒绝、允许本次、允许并加入 policy
- 支持把审批结果写回 allowlist
- 审批语义进入 timeline、summary、activity 和审计记录

### Policy 写回

- shell 审批可写入 `allow_shell`
- read 审批可写入 `allowed_paths`
- 受控 write 审批可写入 `allowed_write_paths`

当前 write 持久化是窄权限模型，不会把一次写入审批升级成全局 `allow_tools: write`。

### 结构化 UI

当前 Web UI 已包含：

- 仓库列表
- Prompt 面板
- 审批面板
- Repo Policy 面板
- Summary
- Timeline
- Activity
- Session History
- Error Panel
- live policy 回归结果展示

### 恢复与回退判断

- repo-scoped 历史索引与 snapshot 持久化
- history-only 恢复
- best-effort attach
- 基于 tracked scope、watcher 和 write journal 的上一轮回退判断

## 当前边界

- 当前不是最终安装包，而是开发态 bridge + web 组合
- 当前 rollback 只支持“上一轮整体回退”，不是任意 turn rewind
- 当前恢复优先保证事实可解释，不保证强一致继续执行
- 当前 policy 管理主要支持新增与展示，还没有完整的删除与回收入口

## 快速开始

### 前置条件

- macOS 本机可运行 GitHub Copilot CLI
- 已安装 Node.js、Corepack 和 `pnpm`
- Copilot CLI 已可登录

以上前置条件针对开发环境成立。

打包后的 desktop `.app` 现在会随包携带受控 Node runtime，正常使用不再依赖宿主机预装 Node；但本仓库里执行构建和打包仍然需要本机有 Node/Corepack/pnpm。

### 安装依赖

```bash
corepack pnpm install
```

如果依赖安装遇到网络问题：

```bash
source ~/.zshrc
proxyon
corepack pnpm install
```

### 启动开发环境

启动 bridge 和 web：

```bash
corepack pnpm dev
```

也可以分别启动：

```bash
corepack pnpm dev:bridge
corepack pnpm dev:web
```

默认地址：

- Web: `http://localhost:5173`
- Bridge: `http://localhost:8787`

### 登录 Copilot CLI

如果网页显示未登录，在宿主机终端执行：

```bash
copilot login
```

完成授权后，回到网页点击“重新检查登录状态”。

### 切换模型

开发阶段默认模型是 `gpt-5-mini`。

如果要切换模型，可在启动 bridge 前设置：

```bash
JOUDO_MODEL=gpt-5.4 corepack pnpm --filter @joudo/bridge dev
```

## 推荐体验路径

1. 打开 Web UI。
2. 选择一个受信任仓库。
3. 查看 Repo Context 和 Repo Policy 面板。
4. 发送一条会触发真实权限请求的 prompt。
5. 在审批区选择“拒绝”“允许本次”或“允许并加入 policy”。
6. 查看 Summary、Timeline、Activity 和 Session History。

## Policy 与验证

推荐起始模板：

- [docs/examples/joudo-policy.recommended.yml](docs/examples/joudo-policy.recommended.yml)

推荐将模板复制到目标仓库：

- `.github/joudo-policy.yml`

运行 live policy 回归：

```bash
corepack pnpm validate:policy-live
```

可选环境变量：

- `JOUDO_BRIDGE_URL`：覆盖默认 bridge 地址
- `JOUDO_VALIDATE_REPO`：指定回归验证仓库

## 常用开发命令

```bash
corepack pnpm typecheck
corepack pnpm --filter @joudo/bridge test
corepack pnpm --filter @joudo/web test
corepack pnpm build
corepack pnpm build:desktop
```

## Desktop 打包

当前仓库已经把默认 desktop 打包路径收敛为稳定 `.app`：

```bash
corepack pnpm build:desktop
```

默认产物位置：

- `apps/desktop/src-tauri/target/release/bundle/macos/Joudo.app`

当前 `.app` 会在打包阶段自动执行 `pnpm prepare:bundle-runtime`，把 bridge 运行依赖、bridge/web 构建产物和固定 Node runtime 一起放进 app resources。

因此 packaged desktop 启动 bridge 时会优先且只使用 app 内自带的 Node，不会再去抢宿主机 Node。

如果要回归验证 packaged `.app` 的桌面管理链路，可以直接运行：

```bash
corepack pnpm validate:desktop:packaged
```

这个检查会实际启动 `Joudo.app`，验证 bridge 自动拉起、TOTP 重绑与重新认证、临时 repo 初始化、会话历史清空，以及 packaged app 重启后 bridge/TOTP 是否仍正常工作。

如果要继续尝试 `.dmg` 安装包，可显式执行：

```bash
corepack pnpm build:desktop:dmg
```

当前 `.dmg` 生成已经切换到更简单的 `hdiutil create -srcfolder Joudo.app` 路径，避开 Tauri create-dmg 辅助脚本在这台 Ventura 开发机上的临时磁盘镜像卸载失败问题。

默认 `.dmg` 产物位置：

- `apps/desktop/src-tauri/target/release/bundle/dmg/Joudo_0.1.0_x64.dmg`

## 仓库结构

- `apps/bridge`: bridge 控制平面，负责会话、权限、恢复、持久化和审计
- `apps/web`: 移动优先 Web UI
- `packages/shared`: 前后端共享协议类型
- `docs`: 当前事实文档

如果要从代码入口阅读，推荐顺序是：

1. `apps/bridge/src/index.ts`
2. `apps/bridge/src/mvp-state.ts`
3. `apps/bridge/src/state/session-orchestration.ts`
4. `apps/web/src/hooks/useBridgeApp.ts`
5. `docs/implementation-notes.md`

## 文档地图

- [docs/current-status.md](docs/current-status.md): 当前产品状态与能力评估
- [docs/iteration-plan.md](docs/iteration-plan.md): 迭代计划与人工回归清单
- [docs/policy-guide.md](docs/policy-guide.md): policy 使用指南
- [docs/quickstart.md](docs/quickstart.md): 快速上手（开发环境 + 测试版安装）
- [docs/examples/joudo-policy.recommended.yml](docs/examples/joudo-policy.recommended.yml): 推荐 policy 模板

## 当前最值得关注的下一步

当前最缺的不是新的执行通道，而是 policy 治理闭环和分发信任链。

详见 [docs/iteration-plan.md](docs/iteration-plan.md)。
