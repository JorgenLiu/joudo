#!/usr/bin/env python3
"""One-shot script to write the 4 reorganized docs. Delete after use."""
import pathlib

DOCS = pathlib.Path(__file__).resolve().parent.parent / "docs"

# ---------- 1. current-status.md ----------
(DOCS / "current-status.md").write_text("""\
# Joudo 当前状态（2026-03-25）

## 一句话结论

Joudo 是一个可运行的本地 Copilot bridge + 移动优先 Web UI，主链路已打通，CI/CD 已接入，desktop 打包已稳定，当前处于首次 unsigned 测试版分发阶段。

## 仓库结构

```
joudo/
├── apps/
│   ├── bridge/     # Node.js Fastify 后端，驱动 Copilot SDK
│   ├── web/        # React 移动优先 Web UI
│   └── desktop/    # Tauri v2 macOS 桌面壳
├── packages/
│   └── shared/     # 共享类型定义（无运行时代码）
├── scripts/        # 启动器、烟测、policy 验证
├── docs/           # 项目文档
└── .github/        # CI/CD workflows
```

## 核心数字

| 指标 | 数值 |
|------|------|
| Bridge API 路由 | 26（17 POST / 8 GET / 1 WS） |
| Web 组件 | 28 |
| Bridge 状态模块 | 30 |
| 测试文件 | 26（Bridge 16 + Web 10） |
| CI Workflow | 3（ci / desktop-macos / release-desktop） |
| 产品版本 | 0.1.0 |

## 已完成的能力

### 真实会话闭环

- 选择仓库 → 发送 prompt → 驱动 Copilot SDK → 获取结构化 snapshot
- repo-scoped 历史保存、history-only 恢复、best-effort attach
- 上一轮整体回退判断（基于 write journal + watcher）

### 策略与审批

- 运行时 repo policy 加载与判定（tool / shell / read / write / URL）
- 三态审批：拒绝 / 允许本次 / 允许并加入 policy
- write 持久化走窄 allowlist，不会升级为全局 `allow_tools: write`
- 高风险解释器和危险命令模式默认拒绝

### 产品 UI

- 移动优先 Web UI：4 tab（Console / Summary / Policy / History）
- 品牌视觉体系：Quiet Sanctuary + Bridge Seal 图标
- desktop 控制面板：bridge 状态管理、TOTP 查看/重绑、仓库管理、LAN 地址

### 认证

- TOTP（RFC 6238）本地认证
- Session token 自动续期
- 重绑设备支持
- desktop 本地回环免认证旁路

### desktop 打包

- Tauri v2 macOS `.app`，内置受控 Node runtime + bridge + web 产物
- packaged desktop 不依赖宿主机 Node/pnpm
- 自动化回归脚本覆盖：bridge 拉起、TOTP、repo 管理、重启恢复
- 桌面壳为菜单栏托盘 app：启动后驻留 tray，bridge 自动拉起，关窗回 tray

### CI/CD

- `ci.yml`：PR + main 推送 → typecheck + tests + build（Ubuntu）
- `desktop-macos.yml`：桌面相关路径变更 → macOS `.app` 构建 + packaged 回归
- `release-desktop.yml`：手动触发 → 双架构（x64 / arm64）`.app` + `.dmg` 产物

### 分发

- 双架构 DMG：`macos-15-intel`（x64）/ `macos-14`（arm64）
- 当前为 unsigned developer test build
- 首次打开需在"系统设置 → 隐私与安全性"手动允许
- 尚无 Apple Developer 证书，签名/公证待后续接入

### 会话恢复

- repo-scoped 持久化：`.joudo/sessions-index.json` + `.joudo/sessions/<id>/snapshot.json`
- history-only 恢复：只还原记录，不续跑旧执行
- best-effort attach：尝试接回旧 Copilot 会话，失败自动退回 history-only
- 旧审批不会被假装成仍然有效
- agent 选择不持久化，每次 bridge 启动重新扫描

## 当前明确边界

- **不是远程 shell**：不做终端转发或 TUI 抓取
- **不是强一致恢复器**：恢复优先保证事实可解释，不保证旧会话安全续跑
- **rollback 只支持上一轮整体回退**：无 checkpoint restore，无任意 turn rewind
- **agent 是运行时状态**：来自文件系统扫描，不持久化到历史快照
- **当前无 HTTPS/WSS**：仅限 LAN 使用

## 当前风险

| 风险 | 说明 |
|------|------|
| `/undo` 非强事务 | 产品事实，不会因 UI 改善消失 |
| 上游 CLI/SDK 语义漂移 | attach、事件流和恢复行为受上游版本影响 |
| policy 累积 | allowlist 只增不删，缺乏回收入口 |
| 路径 TOCTOU | 检查与执行之间存在时间窗口，本地单用户场景下风险可控 |
| unsigned 分发 | Gatekeeper 拦截，需手动放行 |
""", encoding="utf-8")

# ---------- 2. iteration-plan.md ----------
(DOCS / "iteration-plan.md").write_text("""\
# Joudo 迭代计划（2026-03-25）

## 当前阶段

Joudo 已越过"是否可行"阶段，主链路、CI、desktop 打包和首次 release 流程均已打通。

当前工作应聚焦在三件事上：

1. 治理闭环：让 policy 可回收、可解释
2. 分发信任：从 unsigned 测试版推进到签名分发
3. 产品收口：把开发态能力收敛成可交付体验

## 近期待办

### P0：测试版分发闭环

目标：让少量已知测试者可以下载、安装、打开 Joudo。

- [ ] 在 GitHub Release 页面补 release notes（版本号、架构选择、已知限制）
- [ ] 在 release notes 或 README 中写明 Gatekeeper 手动放行步骤
- [ ] 确认双架构 DMG 可被测试者正常下载并安装
- [ ] 收集首轮测试反馈

### P1：policy 治理收口

目标：让 allowlist 不只进不出。

- [ ] 补 allowlist 规则删除入口（Web UI + bridge API，已有 `POST /api/repo/policy/rule/delete`）
- [ ] 补规则来源追踪：每条规则标记是"手动写入"还是"审批持久化"
- [ ] 考虑 allowlist 宽度检查：当某条规则过宽时给出提示
- [ ] 补 URL 持久化审批（当前 URL 只支持 allow/deny，无 persist）

### P2：Developer ID 签名

前提：拿到 Apple Developer 证书。

- [ ] 导出 `.p12` 并设置 GitHub Secrets
- [ ] 在 `release-desktop.yml` 增加 codesign 阶段
- [ ] 增加签名验证步骤（`codesign --verify` + `spctl --assess`）
- [ ] 可选：补 notarization（`xcrun notarytool submit` + `xcrun stapler staple`）

### P3：产品体验收口

- [ ] 补 TOTP 二维码展示和重绑流程的完整 Web/desktop 引导
- [ ] 把恢复/回退状态的产品语言从工程化描述改成用户语言
- [ ] 补首次启动引导（desktop 安装后的 onboarding 流程）
- [ ] 考虑远程/公网准备：HTTPS + WSS、httpOnly session cookie

## 长期方向

以下方向确认存在但不在当前迭代范围内：

- HTTPS/WSS 远程访问
- 多用户场景
- App Store 上架
- 跨平台 desktop（Windows/Linux）
- checkpoint restore / 任意 turn rewind

## 人工回归清单

以下内容在每次准备发布 `.app` 或调整 tray/window 生命周期后执行一次。

### 启动与托盘

1. 双击 `Joudo.app`，不应弹出报错
2. 菜单栏出现 Joudo tray 图标
3. 首次启动显示控制面板；后续启动保持 tray-only
4. `8787` 端口由 bundled bridge 监听

### 托盘菜单

1. 点击 tray 图标可打开控制面板
2. "打开 Joudo"打开或聚焦控制面板
3. "手机访问"打开 LAN URL
4. "退出"退出 app 并回收 bridge

### 窗口生命周期

1. 控制面板标题、图标、内容正常
2. 关闭窗口 → 隐藏回 tray，不退出 app
3. 再次点击 tray → 重新打开同一面板
4. 反复开关不产生重复 bridge 实例

### 控制面板冒烟

1. Bridge 状态 → 运行中 / 已停止 / 外部运行
2. TOTP 区域 → 密钥和二维码
3. "重新绑定设备"→ 生成新密钥
4. 仓库选择、初始化、移除正常
5. LAN URL 复制正常

### 退出清理

1. 退出后主进程不残留
2. `8787` 不继续监听
3. 无 Copilot headless 子进程残留
""", encoding="utf-8")

# ---------- 3. policy-guide.md ----------
(DOCS / "policy-guide.md").write_text("""\
# Joudo Policy 使用指南

## 什么是 Joudo Policy

Joudo policy 是一份 repo-scoped 的 YAML 配置，用来控制 Copilot 在这个仓库里可以做什么。

它不是"默认放开一切再限制"，而是"默认收紧再逐步放开"。

## 放在哪里

bridge 按以下顺序查找 policy 文件（找到第一个即停止）：

1. `.github/joudo-policy.yml`
2. `.github/joudo-policy.yaml`
3. `.github/policy.yml`
4. `.github/policy.yaml`

推荐使用 `.github/joudo-policy.yml`。

## 支持的字段

```yaml
version: 1
trusted: true

# shell 命令
allow_shell:    []   # 自动允许的 shell 命令
confirm_shell:  []   # 需要手动确认的 shell 命令
deny_shell:     []   # 直接拒绝的 shell 命令

# 工具权限
allow_tools:    []   # 自动允许的 Copilot 工具
deny_tools:     []   # 直接拒绝的工具
confirm_tools:  []   # 需要确认的工具

# 路径权限
allowed_paths:       []   # 允许读取的路径
allowed_write_paths: []   # 允许写入的路径（窄 allowlist）

# URL 权限
allowed_urls:   []   # 允许访问的域名
```

## 推荐起始模板

完整模板见 `docs/examples/joudo-policy.recommended.yml`，核心思路：

```yaml
version: 1
trusted: true

allow_shell:
  - git status
  - git diff
  - git log
  - ls
  - cat
  - rg
  - pnpm test
  - pnpm typecheck

confirm_shell:
  - pnpm install
  - pip install
  - git checkout

deny_shell:
  - rm
  - sudo
  - ssh
  - git push

allowed_paths:
  - .
  - ./src
  - ./tests

allowed_write_paths:
  - ./src/generated

allowed_urls:
  - github.com
  - api.github.com
```

## 运行时决策逻辑

当 Copilot 发出权限请求时，bridge 按以下逻辑判定：

### shell 命令

1. 命中 `deny_shell` 或匹配危险模式（`sudo`、`rm`、管道重定向等）→ **拒绝**
2. 命中 `allow_shell` 且是 repo 内只读操作 → **允许**
3. 命中 `confirm_shell` → **进入网页审批**
4. 高风险解释器（`bash`、`python`、`node`、`ruby`、`sh`、`zsh`）未被显式允许 → **拒绝**
5. 其他 → **进入网页审批**

### 读取路径

1. repo 内且命中 `allowed_paths` → **允许**
2. repo 外 → **进入确认**

### 写入路径

1. repo 外 → **拒绝**
2. repo 内且命中 `allowed_write_paths` → **允许**
3. repo 内但未命中 → **进入确认**

### URL

1. 命中 `allowed_urls` → **允许**
2. 未命中 → **拒绝**

## 网页审批

当请求进入网页审批时，用户有三个选项：

| 动作 | 效果 |
|------|------|
| 拒绝 | 本次拒绝，不写回 policy |
| 允许本次 | 仅本次允许，下次同类请求仍会弹出 |
| 允许并加入 policy | 允许本次，并把规则写回 repo policy 文件 |

写回规则时：

- shell 审批 → 写入 `allow_shell`
- read 审批 → 写入 `allowed_paths`
- write 审批 → 写入 `allowed_write_paths`

## `allowed_write_paths` 的设计意图

write allowlist 采用窄权限模型。一次 write 审批不会升级成全局 `allow_tools: write`。

当前只建议在 `allowed_write_paths` 中放：

- 明确的单文件路径，如 `./src/index.ts`
- generated 目录，如 `./src/generated`

不建议放：

- `.`（仓库根目录）
- `./src`（整片业务源码）
- 任何过宽的目录

## 初始化 policy

在 Web UI 中选择仓库后，如果当前没有 policy 文件，会提示初始化。

初始化会：

1. 在 `.github/joudo-policy.yml` 写入推荐模板
2. 在 `.joudo/repo-instructions.md` 生成 repo 指令文档
3. 在 `.joudo/sessions-index.json` 初始化空会话索引

也可以手动复制 `docs/examples/joudo-policy.recommended.yml` 到目标仓库的 `.github/joudo-policy.yml`。

## 规则删除

Web UI 的 Policy 面板支持删除已有规则。

当前支持删除的字段：`allow_shell`、`allowed_paths`、`allowed_write_paths`。

## 已知限制

- 还没有 URL 持久化审批（URL 只支持静态 allowlist）
- 还没有规则来源追踪（无法区分"手动写入"和"审批持久化"）
- 路径验证存在 TOCTOU 窗口（本地单用户场景下风险可控）
""", encoding="utf-8")

# ---------- 4. quickstart.md ----------
(DOCS / "quickstart.md").write_text("""\
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
""", encoding="utf-8")

print("All 4 docs written successfully.")
