# Joudo Packaging / Release Plan

## 文档目的

这份文档聚焦两件事：

- packaged desktop 在发布前还需要做哪些人工回归
- 如何把当前本地构建/测试链路迁移到 GitHub Actions

## 当前状态

已经完成的基础：

- `corepack pnpm build:desktop` 可稳定产出 macOS `.app`
- `corepack pnpm build:desktop:dmg` 已验证可稳定产出 macOS `.dmg`
- `.app` 已内置受控 Node runtime、bridge 运行依赖、bridge/web 构建产物
- packaged desktop 已验证只使用 app bundle 内的 Node/runtime
- desktop 首次启动现在会主动显示控制面板；后续启动继续保持 tray-only
- packaged runtime 已完成两轮瘦身：
   - 只再内置 `node` 可执行文件，不再复制整套宿主机 Node 安装树
   - bridge bundle 会移除已 hoist 的 `.pnpm` 虚拟仓副本
   - `@github/copilot` 中非当前平台的 `prebuilds` 与 `ripgrep` 二进制已在打包阶段裁剪
- 当前这台 macOS x64 开发机上的 `.app` 体积已从约 `1.9G` 压到约 `364M`
- `corepack pnpm validate:desktop:packaged` 已可自动验证：
  - bridge 自动拉起
  - TOTP 重绑与重新认证
  - 临时 repo 初始化
  - 会话历史清空
  - packaged app 重启后 bridge/TOTP 继续可用
- 2026-03-24 已本机重新验证 `.dmg` 产物：`hdiutil verify` 返回 VALID，挂载检查确认镜像内包含 `Joudo.app`
- 仓库已新增 GitHub Actions workflow：
   - `.github/workflows/ci.yml`
   - `.github/workflows/desktop-macos.yml`
   - `.github/workflows/release-desktop.yml`
- `desktop-macos.yml` 现已在 macOS runner 上执行 packaged desktop 回归，`validate:desktop:packaged` 已进入 workflow 质量门
- `release-desktop.yml` 已把 release 流程拆成手动触发的 `.app`、`.dmg` 和 signing readiness 三个阶段
- GitHub Actions 的 desktop / release workflow 当前固定使用 `macos-13` Intel runner，避免向 x64 测试用户发出 Apple Silicon-only 包
- `release-desktop.yml` 现在会在手动 release 时同时构建 `x64` 和 `arm64` 两套 macOS 产物，artifact 名称显式带架构后缀

尚未自动化的部分主要是 tray / window / Dock 交互语义。

## Desktop 人工回归清单

目标：覆盖当前自动化脚本无法可靠验证、但会直接影响交付体验的桌面交互行为。

建议在每次准备发布 `.app` 或调整 tray/window 生命周期后执行一次。

### A. 启动与托盘驻留

1. 双击 `Joudo.app` 后，不应先弹出报错对话框
2. 应能在 macOS 菜单栏看到 Joudo tray 图标
3. 首次启动应主动显示控制面板窗口；完成首次引导后，后续启动可保持 tray-only
4. `8787` 应由 bundled bridge 拉起并处于监听状态

### B. 托盘菜单行为

1. 点击 tray 图标，应能打开控制面板窗口
2. tray 菜单中的“打开 Joudo”应能打开或聚焦控制面板
3. tray 菜单中的“手机访问”应能打开当前 LAN URL
4. tray 菜单中的“退出”应退出 app，并回收其托管的 bridge

### C. 窗口生命周期

1. 打开控制面板后，窗口标题、图标和内容应正常显示
2. 点击窗口关闭按钮时，应隐藏回 tray，而不是直接退出 app
3. 隐藏后再次点击 tray 图标，应能重新打开同一控制面板
4. 窗口反复打开/关闭后，不应出现重复 bridge 实例或端口残留

### D. Dock 行为

1. 打开控制面板时，Dock 图标应按当前设计正常出现
2. 隐藏回 tray 后，Dock 行为应与当前产品设计一致，不应留下异常前台窗口状态
3. 通过系统 `Quit` 或 Dock 菜单退出时，应与 tray 菜单“退出”具有相同的 bridge 清理结果

### E. 控制面板功能冒烟

1. Bridge 状态卡片应正确显示“运行中 / 已停止 / 外部运行”
2. TOTP 区域应能展示密钥和二维码
3. “重新绑定设备”后应生成新密钥
4. 仓库选择、初始化策略、移除仓库应正常工作
5. LAN URL 复制按钮应正常复制

### F. 退出后清理

1. 退出 app 后，`Joudo.app` 主进程不应残留
2. 如果 bridge 是由 packaged desktop 托管启动，退出后 `8787` 不应继续监听
3. 不应残留 bundle 内的 Copilot headless 子进程

## GitHub Actions 接管 CI 的评估

## 结论

适合接管，而且建议分两层推进：

1. 先把“代码质量 + 基础构建”接进 PR 级 CI
2. 再把“macOS packaged desktop 构建与回归”接进主分支或手动触发工作流

原因很直接：当前仓库的脚本已经具备清晰入口，但 desktop 打包仍然是 macOS 专属且成本更高，不适合一开始就把所有 PR 都绑到最重的 job 上。

## 现有脚本基线

当前已经可直接复用的命令：

- `corepack pnpm typecheck`
- `corepack pnpm --filter @joudo/bridge test`
- `corepack pnpm --filter @joudo/web test`
- `corepack pnpm build`
- `corepack pnpm build:desktop`
- `corepack pnpm validate:desktop:packaged`

这意味着 GitHub Actions 不需要先发明新的 CI 命令，先编排现有脚本就够了。

## 推荐的 GitHub Actions 分层

### Workflow 1: `ci.yml`

用途：PR 和 push 的默认质量门。

建议触发：

- `pull_request`
- `push` 到主分支

建议 job：

1. `typecheck-and-tests` on `ubuntu-latest`
   - checkout
   - setup node 22 + corepack
   - cache pnpm store
   - `corepack pnpm install --frozen-lockfile`
   - `corepack pnpm typecheck`
   - `corepack pnpm --filter @joudo/bridge test`
   - `corepack pnpm --filter @joudo/web test`

2. `build-web-and-bridge` on `ubuntu-latest`
   - `corepack pnpm install --frozen-lockfile`
   - `corepack pnpm build`

为什么先放 Ubuntu：

- 成本低
- 队列快
- 足够覆盖 TS/React/Node 主体逻辑
- 不需要引入 macOS runner 成本就能拦住大部分回归

### Workflow 2: `desktop-macos.yml`

用途：验证 packaged desktop，而不是只验证源码能编译。

建议触发：

- `workflow_dispatch`
- `push` 到主分支
- 对修改 `apps/desktop/**`、`apps/bridge/**`、`apps/web/**`、`packages/shared/**` 及根级构建配置的 PR 触发

建议 job：

1. `build-packaged-desktop` on `macos-latest`
   - checkout
   - setup node 22 + corepack
   - setup rust stable
   - `corepack pnpm install --frozen-lockfile`
   - `corepack pnpm build:desktop`
   - 上传 `Joudo.app` 作为 artifact

2. `validate-packaged-desktop` on `macos-latest`
   - 下载 `Joudo.app` artifact 或直接复用同 job 工作区
   - `corepack pnpm validate:desktop:packaged`

为什么单独拆出来：

- Tauri `.app` 打包只能在 macOS runner 上跑
- packaged runtime 回归比普通单测更慢
- 这条链路适合作为“发布质量门”或“主分支质量门”，不一定适合所有 PR

## Release workflow 设计

当前已新增：`release-desktop.yml`

它的目的不是替代日常 CI，而是把 release 阶段拆成手动触发的独立流程：

1. `build-app`
   - 分别构建 unsigned `x64` / `arm64` `.app`
   - 跑 packaged desktop 回归
   - 归档并上传带架构后缀的 `Joudo.app` artifact

2. `build-dmg`
   - 按输入决定是否构建 `.dmg`
   - 分别下载并解包对应架构的 `Joudo.app`
   - 上传带架构后缀的 `.dmg` artifact

3. `signing-readiness`
   - 当前只是显式占位阶段
   - 用来约束后续签名、公证接入点

这个 workflow 当前故意不直接做 codesign / notarize，因为仓库还没有：

- Developer ID 证书导入流程
- notarization 所需 secrets
- stapling 验证命令

## 当前不建议一开始就放进 CI 的内容

1. 签名 / 公证
   - 需要额外 secrets、证书和 Apple notarization 流程
   - 应在 `.app` 构建和 packaged 回归稳定后再接入

2. 依赖真实 Copilot 登录的端到端验证
   - CI 不应依赖开发者个人登录态
   - 当前 packaged 回归脚本已经避开了这一依赖

## Developer ID 最小方案（不上 App Store）

这里说的签名方案，目标不是上架 App Store，而是降低开发者用户下载 `.dmg` / `.app` 后的 Gatekeeper 摩擦。

适用前提：

- 通过 GitHub Releases 或官网分发
- 用户主要是开发者
- 不准备走 App Store 审核和发布链路

当前建议分成两个层级：

### 层级 A：开发者测试版，可接受手动放行

这个层级下，不把 Developer ID 作为 release blocker。

必须补齐的是：

- 安装说明
- 首次启动放行说明
- 支持的 macOS 版本和架构说明
- 已知限制

### 层级 B：开发者公开分发，尽量减少安装摩擦

这个层级下，建议接入 Developer ID Application 签名；如果预算和账号条件允许，再继续接 notarization。

注意：

- 不需要 App Store 证书
- 不需要 App Store Connect 发布流程
- 需要的是 Developer ID Application 证书

## Developer ID 最小待办清单

下面的清单按优先级排序，目标是实现“站外分发，但不上 App Store”的最小闭环。

### P0：先做出可对开发者发放的 release 包

1. 明确 release 级别
   - 决定当前目标是“开发者测试版”还是“开发者公开分发版”

2. 补安装说明
   - 说明如何下载 `.dmg`
   - 说明如何拖拽或打开 `Joudo.app`
   - 如果当前仍是 unsigned，说明如何在 macOS 上手动放行

3. 补支持矩阵
   - 写清最低 macOS 版本
   - 写清当前支持的 CPU 架构
   - 写清当前是否只验证过单架构构建

当前实际支持矩阵（2026-03-25）：

- 已验证发布链路：macOS x64（Intel）
- 当前 GitHub Actions release 默认产物：macOS x64（`macos-13`）+ macOS arm64（`macos-14`）
- Apple Silicon 通用包 / universal binary：尚未接入，当前采用双产物分发

4. 补 release notes 模板
   - 包含版本号
   - 包含已知限制
   - 包含首次启动 / TOTP 绑定说明

### P1：把 Developer ID 接入 workflow，但不碰 App Store

1. 准备 Apple Developer 账号能力
   - 确认团队具备 Developer ID Application 证书申请权限

2. 生成并导出证书
   - 导出为 `.p12`
   - 为 `.p12` 设置导出密码

3. 设计 GitHub Secrets
   - `APPLE_CERTIFICATE_P12_BASE64`
   - `APPLE_CERTIFICATE_PASSWORD`
   - `APPLE_TEAM_ID`

4. 在 release workflow 中增加 signing 阶段
   - 导入临时 keychain
   - 导入 Developer ID Application 证书
   - 对 `Joudo.app` 执行 `codesign --deep --force --options runtime`
   - 对 `.dmg` 执行签名

5. 增加签名验证步骤
   - `codesign --verify --deep --strict`
   - `spctl --assess --type exec`

### P2：如果需要，再补 notarization

1. 准备 notarization 凭据
   - Apple ID / app-specific password，或 App Store Connect API key

2. 增加 notary 提交步骤
   - `xcrun notarytool submit`
   - 等待完成并读取结果

3. 增加 stapling
   - 对 `.app` 或 `.dmg` 执行 `xcrun stapler staple`

4. 增加最终校验
   - 再次运行 `spctl --assess`
   - 记录 notarization 成功产物

## 当前建议

对 Joudo 现在这个阶段，更合理的是：

1. 把 P0 做完，先发开发者测试版
2. 再决定是否进入 P1，接入 Developer ID
3. notarization 放到 P2，而不是当前 blocker

## 推荐的落地顺序

1. 已完成：新建 `ci.yml`
   - 已接管 install / typecheck / bridge test / web test / build

2. 已完成：新建 `desktop-macos.yml`
   - 已执行 `build:desktop`
   - 已执行 `validate:desktop:packaged`
   - `.app` artifact 仍会上传，便于回看失败样本

3. 已完成：新建 `release-desktop.yml`
   - 已拆出 `.app`、`.dmg`、signing readiness 三个 release 阶段

4. 最后再把 signing / notarization 真正接进 release workflow
   - 证书导入
   - codesign
   - notarytool submit
   - stapler

## 已知风险与注意点

1. `README.md` 当前已经引用本文件，之前文件不存在；现在这条文档链路已补齐
2. macOS runner 成本显著高于 Ubuntu runner，desktop workflow 不应无差别覆盖所有提交
3. `apps/bridge` 的 `build` 脚本使用 `rm -rf dist`，在 GitHub-hosted Ubuntu/macOS runner 上可用
4. `validate:desktop:packaged` 依赖 macOS 的 `open` 和 `osascript`，因此只能放在 macOS workflow
5. `release-desktop.yml` 当前只实现 unsigned app / dmg artifact 和 signing 占位，不应误认为已经具备签名发行能力

## 下一步建议

如果要正式开始接管 CI，建议先做最小可用版本：

1. 已完成：`ci.yml` 已接管 `typecheck + bridge test + web test + build`
2. 已完成：`desktop-macos.yml` 已对相关路径 PR 开启 macOS 质量门，并接管 `build:desktop + validate:desktop:packaged`
3. 已完成：`release-desktop.yml` 已把 `.app` / `.dmg` / signing readiness 拆成独立 release 阶段
4. 后续再把签名、公证 secrets 和命令真正接进 release workflow