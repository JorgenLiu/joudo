# Joudo 下一步计划

## 文档用途

这份文档只保留当前仍有决策价值的内容：

- 已确认不变的产品边界
- 接下来 1 到 2 个迭代的主线
- 仍需要持续关注的风险

## 当前阶段判断

Joudo 当前已经具备可运行的本地 bridge + Web UI 主链路。

下一阶段的重点不是继续扩展更多底层执行能力，而是把现有能力收敛成更稳定、更可解释、更可治理的产品面。

## 已确认不变的决定

### 产品主形态仍然是本地 bridge + Web UI

当前主线仍然是移动优先网页闭环，不把原生封装或正式安装包当成当前迭代目标。

### rollback authority 继续留在 Joudo

`/undo` 仍然只是执行器，不是真相来源。

### turn truth 继续使用混合证据模型

当前默认依赖：

- candidate paths
- watcher 越界证据
- write journal

不会回到“每轮常态化全仓扫描”的设计。

### 审批模型继续保持三态

当前网页审批保持：

- 拒绝
- 允许本次
- 允许并加入 policy

### write 持久化继续走窄 allowlist

当前 write 审批持久化写入 `allowed_write_paths`，并只接受：

- 明确单文件路径
- `generated` / `__generated__` 目录

### agent 继续保持运行时语义

custom agent 的发现和选择只反映“本次 bridge 运行看到的 Copilot 环境”，不写回 repo-scoped `.joudo` 持久化。

## 下一阶段主线

### 主线 A: 补齐 policy 治理闭环

这是当前最高优先级。

Joudo 已经能把审批结果写回 allowlist，但产品仍然需要更稳定地回答这些问题：

- 这条规则为什么存在
- 它的影响范围是否过宽
- 用户如何撤销或修正它
- 最近新增的规则是否值得保留

当前目标不是再做 YAML 编辑器，而是继续把治理能力保持在“可读、可解释、可回收”的方向上。

### 主线 B: 压缩 recovery / rollback 的理解成本

底层恢复和回退判断已经存在，但产品解释仍然偏长、偏工程化。

接下来需要继续降低用户理解这些状态的成本：

- 为什么当前能回退
- 为什么当前只能 history-only 恢复
- attach 失败后接下来应该做什么
- 当前恢复的是历史事实还是实时会话

### 主线 C: 收敛交付形态

当前 bridge、web、desktop 都已经能工作，但还不是一个完成收口的最终交付形态。

当前已经确认的 desktop 启动方式是：macOS 以菜单栏托盘 app 形式启动，bridge 自动拉起，点击托盘图标再打开控制面板窗口；关闭窗口只隐藏回托盘，不直接退出进程。

后续需要把：

- 开发态启动路径
- 本地控制面能力
- 打包与发布路径

逐步收敛成更稳定的交付模型。

当前主线 C 应进入实作阶段，不再只停留在“最后再做”的占位：下一步优先推进可重复的本机打包流程，先产出稳定 `.app`，再推进 `.dmg`。

当前已收敛的 packaging 决策：默认 desktop 打包命令仍以稳定 `.app` 为主；显式 `.dmg` 步骤已经切换到简化 `hdiutil` 路径，绕过了这台 Ventura 开发机上 Tauri create-dmg 的卸载失败点。

## 当前风险

### 上游 CLI / SDK 语义仍可能影响恢复边界

历史 attach、事件流和 `/undo` 行为仍受上游能力影响。

### policy 会天然累积复杂度

如果治理面不足，allowlist 会逐步变宽，但用户未必能清楚理解其来源和风险。

### 运行时 agent 环境不是稳定事实

custom agent 来自当前运行时目录扫描，因此不能把它当作历史快照的一部分来理解。
- 为什么某个历史会话只能 history-only 恢复
- 为什么某个旧会话还能 attach

这一块优先做解释收敛，而不是扩展新的恢复语义。

这一步当前已经完成第一轮收敛：

- ActivityPanel 已把“能否回退、为什么不能、下一步做什么”改成更短的稳定文案
- SessionHistoryPanel 已把 `attach` 和 `history-only` 的差别收敛成更直接的说明
- bridge 恢复摘要、自动恢复提示和 history-only fallback 文案已经同步收紧

### 主线 C: 最后再推进 packaging

单一安装包、后台服务与正式交付形态依然重要，但不应该早于 policy 治理闭环。

如果产品还不能稳定管理自己写入的 allowlist，过早包装成“更像成品”的交付形态只会放大治理缺口。

## 当前迭代建议

按建议顺序：

1. 已完成：补 `复制规则文本` 等轻量治理辅助动作
2. 已完成：继续压缩 rollback / recovery 的剩余解释面
3. **已完成**：引擎可靠性修复（详见 `docs/audit-2026-03-22.md` P0 + P1，全部落地）
4. 再推进 CI/build/启动体验（详见 `docs/audit-2026-03-22.md` P2）
5. 最后推进 packaging 与远程准备

## 当前主线（2026-03-22 更新）

### 主线 A（已完成）：引擎可靠性

来源：独立审核报告 `docs/audit-2026-03-22.md`

- ✅ 修 `ensureClient()` 并发竞态（promise-slot 锁定模式）
- ✅ 修 MarkdownBody link href XSS（协议白名单）
- ✅ 清理 dead code（`withCopilotRetry` / `approveAll` / `defineTool`）
- ✅ `selectRepo` 阻止运行中切换（409 守卫）
- ✅ POST route body runtime validation（8 条路由 JSON Schema）
- ✅ 补 session-runtime / session-permissions / session-orchestration 专项测试（28 项测试）

### 主线 B：CI + Build + 启动体验

- ✅ Bridge build script + `tsconfig.build.json`（`tsc -p tsconfig.build.json` → `dist/`，排除测试和 fixtures）
- ✅ Bridge 静态托管 Web 打包产物（`@fastify/static`，SPA fallback，auth 只拦截 `/api/` 和 `/ws`）
- ✅ `joudo-start.sh` CLI 启动器（install → web build → bridge build → `node dist/index.js`）
- ✅ Root `pnpm build` 统一入口（typecheck → web build → bridge build）
- ✅ `POST /api/repo/init-policy` + 最小 Web onboarding（初始化推荐 policy、repo 指令和会话索引）
- ✅ 本机可见的 TOTP setup 信息接口（仅 loopback 可访问，避免把绑定密钥暴露到 LAN）
- ✅ Tauri 菜单栏壳已编译验证并可运行（`apps/desktop`，cargo 1.94.0 + Tauri v2.10.3，bridge 生命周期管理、tray 菜单、自动启动 bridge、隐藏窗口/tray-only 模式均已验证）
- ✅ 桌面控制面板已从"手机 Web UI 嵌入"修正为独立管理面板（bridge 起停、TOTP 密钥查看/复制、仓库选择与策略初始化、LAN 地址复制），Tauri IPC 代理 bridge API（避免 CORS），bridge 管理类路由加入本地免认证旁路
- ✅ desktop bridge 启动链路已加固：启动中状态不再被轮询覆盖；bridge dist 过期时可自动触发 `pnpm --filter @joudo/bridge build`
- ✅ desktop 本机启动链路已补强常见用户态 Node/pnpm/corepack 安装路径探测，修复“已安装 Node 但桌面端误报未找到可执行文件”的问题
- ✅ Web 历史页支持清空当前 repo 的会话历史；bridge 会重写空 sessions-index 并删除持久化 snapshots
- ✅ Web fetch 工具已修复“无 body 的 POST 仍强制发送 `Content-Type: application/json`”问题，清空历史/回滚等空 body 请求不再触发 Fastify `body cannot be empty`
- ✅ 本机 TOTP 已支持重绑设备：bridge 可生成新密钥并撤销现有 session token，desktop 控制面板已接入该流程
- ✅ desktop 控制面板现在能识别“外部已运行”的 bridge，不再把可用 bridge 误判成未启动；外部 bridge 场景下 repo/TOTP 管理面仍可正常使用
- ✅ 手机 Web UI 现在即使未发现任何 agent，也会保留 agent 区域并明确提示 agent 目录位置，不再把该能力直接隐藏
- ✅ desktop 默认打包链路已收敛为 `.app`：`corepack pnpm build:desktop` 现在直接走 app bundle，默认产物为 `apps/desktop/src-tauri/target/release/bundle/macos/Joudo.app`
- ✅ 显式 `.dmg` 打包已切换为简化 `hdiutil` 流程，绕过 create-dmg 卸载失败问题
- ✅ desktop 现在会在应用退出路径上回收自己托管的 bridge，减少 8787 端口残留干扰
- ✅ packaged app 启动 bridge 前会补齐手机端 `apps/web/dist`，并把 mobile web 构建目标收紧到 `es2019`
- ✅ desktop `.app` 现在会在打包阶段生成 `bundle-resources/`，把受控 Node runtime、`apps/bridge/dist`、`apps/bridge/node_modules` 和 `apps/web/dist` 一起打进 app resources
- ✅ packaged desktop 启动 bridge 时现在优先且只使用 app 内 bundled Node；一旦检测到 app bundle 资源不完整，不再回退到宿主机 Node
- ✅ 已新增 packaged desktop 回归脚本：可自动验证 `.app` 形态下的 bridge 自动拉起、TOTP 重绑/认证、repo 初始化、历史清空和重启恢复
- ✅ GitHub Actions CI 管线已接入 desktop 质量门：`ci.yml` 负责 typecheck/test/build，`desktop-macos.yml` 对相关路径 PR 和主分支负责 macOS `.app` 构建、packaged desktop 回归与 artifact 上传
- ✅ release workflow 已拆阶段：`release-desktop.yml` 现已手动支持 `.app`、`.dmg` 和 signing readiness 三段式流程
- ✅ 2026-03-24 已修复 GitHub Actions 的 pnpm 引导顺序：所有使用 `cache: pnpm` 的 job 现会先执行 `pnpm/action-setup@v4`，避免 `actions/setup-node@v4` 在缓存阶段报 `Unable to locate executable file: pnpm`
- ✅ 2026-03-24 已收紧 Actions 桌面构建触发与 release 流程：`desktop-macos.yml` 的 `push` 现仅对桌面相关路径触发，`release-desktop.yml` 的 `build-dmg` 现直接复用 `build-app` 上传的 `Joudo.app` artifact，不再重复完整构建
- ✅ 2026-03-24 已修复 clean checkout 下的 Tauri `bundle-resources` 缺失问题：保留生成内容忽略规则，但改为跟踪 `apps/desktop/src-tauri/bundle-resources/.gitkeep`，避免 GitHub Actions 在读取 `tauri.conf.json` 的 resources 配置时因目录不存在而直接失败
- ✅ 2026-03-24 已修复 desktop 打包前置链路：`tauri.conf.json` 的 `beforeBuildCommand` 不再只构建 desktop Vite 前端，而是通过 `apps/desktop` 的 `build:packaging` 先执行 workspace root `build` 生成 `apps/web/dist` 与 `apps/bridge/dist`，再构建 desktop 自身资源，避免 `prepare-bundle-runtime` 在 clean CI 上找不到 `apps/bridge/dist`
- ✅ 2026-03-24 已补强 `bundle-resources/.gitkeep` 的保活：`prepare-bundle-runtime.mjs` 在每次重建 bundle 资源后都会重新写回 `.gitkeep`，避免本地打包把占位文件删掉后，后续提交遗漏该文件，导致 clean CI checkout 再次报 `resource path bundle-resources doesn't exist`
- ✅ UI 重构已进入落地阶段：desktop 控制面板已完成第一轮 Quiet Sanctuary 壳层改造，mobile Web Hero 已改成更清晰的品牌头部与 repo/model/agent 上下文卡片，当前未改动既有功能流
- ✅ mobile Web 第二轮内容区重构已完成：Console / Summary / Policy / History 四个 tab 已补齐 intro、统一卡片层次与阅读流
- ✅ desktop 第二轮状态反馈已完成：bridge 现在显式区分待机、启动中、Joudo 托管、外部 bridge、错误五种状态
- ✅ mobile Web 第三轮模块统一已完成：Approval / Validation / Timeline / Repo Context / Auth 模块已补齐引导层并统一到同一套卡片系统
- ✅ desktop 微交互已补齐：应用首屏淡入、bridge 启动脉冲、状态卡过渡和按钮/卡片轻量反馈已接入
- ✅ mobile Web 第四轮边角态收口已完成：Onboarding / Error / empty state / checkpoint overlay / bootstrap loading / FAQ 与详情展开态已统一到 Quiet Sanctuary 视觉层
- ✅ mobile Web 顶部上下文模块已收敛为可折叠摘要态，折叠后仅保留 model / bridge 状态，避免首屏被仓库上下文占满
- ✅ mobile Web Summary 内的 ActivityPanel 已把卡片密度、内边距和子模块层次收敛到与 Summary / Timeline 同一视觉节奏
- ✅ 品牌图标已进一步统一：web Hero / TOTP、desktop 控制面板、tray 彩色图标与打包资源脚本统一收敛到 Bridge Seal
- ✅ bridge repo 发现已收紧为“显式配置 + 用户手动添加”，不再默认注入本地 `demo` 或工作区派生目录
- ✅ mobile Web 与 desktop 控制面板已移除大部分重复说明性文案，repo 备注模块已收敛到与其他卡片一致的节奏
- ✅ mobile Web 第二轮文案清理已完成：首次配置、首次进入、Repo Policy 和多处空状态已收敛为状态化短文案，TOTP 入口提示也已同步压缩
- ✅ logo / 品牌主标当前视为定稿：继续沿用现有 torii + bridge 方向与当前色板，本轮不再继续改动视觉资产
- ✅ 2026-03-24 已重新验证 desktop `.app` 打包链路：`corepack pnpm build:desktop` 成功产出 `apps/desktop/src-tauri/target/release/bundle/macos/Joudo.app`，随后 packaged runtime 回归脚本通过
- ✅ 2026-03-24 已重新验证 desktop `.dmg` 打包链路：`corepack pnpm build:desktop:dmg` 成功产出 `apps/desktop/src-tauri/target/release/bundle/dmg/Joudo_0.1.0_x64.dmg`，`hdiutil verify` 校验通过，挂载后镜像内包含 `Joudo.app`
- 更完整的 Web / desktop TOTP 引导（二维码展示、重绑流程）

### 主线 C（保留，最后再做）：远程/公网准备

- HTTPS + WSS
- Session token httpOnly cookie
- WebSocket reconnect max retry cap
- ✅ 桌面壳已从"骨架"推进到 bridge 托管、菜单栏状态和本机 tray-only 可用（dev 模式验证通过）
- 桌面壳打包为稳定 `.app`（`tauri build` 产物验证）
- `.dmg` 打包与首次安装说明
- 更完整的 Web / desktop TOTP 引导（二维码展示、重绑流程）

## Packaging 实施顺序

按建议顺序：

1. 已完成：固化 `pnpm build` + `pnpm build:desktop` 的 `.app` 成功路径
2. 已完成：把受控 Node runtime、bridge/web 产物收进 `.app`，并让 packaged desktop 启动链路只认 bundled Node
3. 已完成：验证打包出的 `.app` 可直接拉起 bundled bridge，bridge 监听 `8787`，且运行时只使用 app 内 `Resources/runtime/node/bin/node`
4. 补充打包产物位置、签名要求、已知限制和回归检查清单
5. 最后再收敛 `.dmg` 分发体验与签名/公证细节

在第 3 步验证里，需要明确区分两个层级：

- 当前已修复的是“宿主机其实装了 Node，但 GUI 进程 PATH 不完整导致 desktop 找不到”的启动缺陷
- 当前已经把 bridge 运行时收敛为随 `.app` 一起交付的受控依赖，packaged desktop 不再依赖宿主机 Node/pnpm
- 当前已经验证 packaged `.app` 会实际拉起 app bundle 内的 Node 和 bridge/Copilot 子进程，而不是宿主机 Node
- 当前 packaging / release 计划文档已补齐，tray/window/Dock 的人工回归清单与 GitHub Actions 接管方案见 `docs/packaging-release-plan.md`
- 当前 packaging / release 计划文档已补充“Developer ID 但不上 App Store”的最小待办清单，可按 P0/P1/P2 分阶段推进
- 当前 UI/品牌重构方向已收敛：采用 Quiet Sanctuary，产品 icon 走 Bridge Seal，品牌主标走 Enso Gate；基础规范与候选图标见 `docs/ui-rebrand-plan.md` 和 `docs/branding/`
- 后续仍需继续完善签名、公证、安装说明和无终端场景下的回归验证

## 当前风险

### `/undo` 仍然不是强事务回滚

这个边界是产品事实，不会因为 UI 或文档改善而消失。

### 底层 CLI / SDK 行为仍可能影响恢复边界

任何 attach、事件流和历史恢复行为都需要继续做版本敏感验证。

### 核心引擎层已补齐专项测试

session-runtime (10 项) / session-permissions (8 项) / session-orchestration (14 项) 共 28 项测试已落地。

### `ensureClient()` 并发竞态已修复

采用 promise-slot 锁定模式，首个调用者占位后并发调用者 await 同一 Promise。