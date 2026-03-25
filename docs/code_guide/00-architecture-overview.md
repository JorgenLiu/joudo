# Joudo 代码总览

> 面向 Python 后端 + CI/CD 背景的开发者，不假设前端经验。

---

## 目录

1. [项目定位](#项目定位)
2. [技术栈速查](#技术栈速查)
3. [仓库结构](#仓库结构)
4. [核心架构](#核心架构)
5. [数据流](#数据流)
6. [认证流程](#认证流程)
7. [策略系统（Policy）](#策略系统policy)
8. [会话生命周期（Session）](#会话生命周期session)
9. [持久化与恢复](#持久化与恢复)
10. [打包与分发](#打包与分发)
11. [CI/CD 管线](#cicd-管线)
12. [依赖管理与清理](#依赖管理与清理)
13. [关键术语对照表](#关键术语对照表)

---

## 项目定位

Joudo 是一个 **本地优先（local-first）** 的 GitHub Copilot CLI 前端：

- 你在手机浏览器/桌面 App 上输入自然语言指令
- Joudo Bridge（一个 Node.js HTTP 服务）把指令转发给 Copilot CLI SDK
- Copilot 在你的 Mac 本地执行代码修改
- Bridge 对每个操作做 **权限审查**（读/写/Shell/URL），高危操作必须人工确认
- 所有状态存储在本地磁盘，不依赖任何云服务

类比 Python 世界：Bridge 相当于一个 FastAPI 服务，Web 前端相当于一个连接它的 Streamlit/Gradio 界面。

---

## 技术栈速查

| 层 | 技术 | Python 等价物 |
|---|---|---|
| **Bridge（后端）** | Node.js + Fastify 5 | FastAPI / Flask |
| **Web（前端）** | React 19 + Vite 6 | Streamlit / Jinja2 模板 |
| **Desktop（桌面壳）** | Tauri v2 (Rust + TypeScript) | PyInstaller / Electron |
| **共享类型** | TypeScript 类型包 | Pydantic models |
| **包管理器** | pnpm 10 (monorepo) | Poetry + workspace / uv |
| **测试框架** | Vitest + tsx --test | pytest |
| **构建工具** | Vite（前端打包）+ tsc（类型检查） | setuptools / wheel |
| **CI** | GitHub Actions | GitHub Actions |

### 前端核心概念快速理解

如果你完全不了解前端，以下概念需要先知道：

| 前端概念 | 说明 | Python 等价 |
|---|---|---|
| **npm/pnpm** | JavaScript 包管理器 | pip / Poetry |
| **node_modules/** | 依赖安装目录（类似 .venv/lib/） | site-packages |
| **package.json** | 项目元数据 + 依赖声明 + 脚本命令 | pyproject.toml |
| **TypeScript (.ts/.tsx)** | 带类型注解的 JavaScript，需要编译 | 类似 mypy 强制模式的 Python |
| **Vite** | 前端开发服务器 + 打包工具 | 无直接等价，类似 webpack |
| **React** | UI 组件框架，用函数返回 HTML-like 结构 | Jinja2 模板但可交互 |
| **Hook (useState/useEffect)** | React 管理状态和副作用的函数 | 类似类的 __init__ + property |
| **JSX/TSX** | 在 JS/TS 中写 HTML-like 语法的扩展 | f-string 里嵌 HTML |
| **组件 (Component)** | 一个返回 UI 的函数，可复用 | 模板宏 / Widget |
| **dist/** | 构建输出目录 | build/ / dist/ |

---

## 仓库结构

```
joudo/
├── package.json              # 根 monorepo 配置，定义全局脚本
├── pnpm-workspace.yaml       # monorepo 包声明 (apps/* + packages/*)
├── tsconfig.base.json        # 共享 TypeScript 编译选项
│
├── apps/
│   ├── bridge/               # 🔴 核心后端 —— HTTP + WebSocket 服务
│   │   ├── src/
│   │   │   ├── index.ts          # Fastify 服务入口（路由注册）
│   │   │   ├── mvp-state.ts      # 全局状态管理器（类似 Django 的 views + models 合体）
│   │   │   ├── copilot-sdk.ts    # Copilot SDK 封装
│   │   │   ├── errors.ts         # 错误分类与序列化
│   │   │   ├── auth/             # TOTP 认证模块
│   │   │   ├── policy/           # 权限策略引擎
│   │   │   └── state/            # 状态管理子模块（18 个文件）
│   │   └── package.json
│   │
│   ├── web/                  # 🟢 移动端 Web 界面
│   │   ├── src/
│   │   │   ├── App.tsx           # 主组件（类似 main view）
│   │   │   ├── components/       # UI 组件库（25+ 个组件）
│   │   │   └── hooks/            # 状态管理 hooks
│   │   └── package.json
│   │
│   └── desktop/              # 🔵 macOS 桌面应用（Tauri 壳）
│       ├── src/main.ts           # 桌面控制面板 UI
│       ├── src-tauri/
│       │   ├── src/main.rs       # Rust 原生入口
│       │   └── tauri.conf.json   # Tauri 配置
│       └── scripts/              # 打包脚本
│
├── packages/
│   └── shared/               # 🟡 共享 TypeScript 类型定义
│       └── src/index.ts          # 所有接口/枚举/类型
│
├── docs/                     # 文档
├── scripts/                  # 运维脚本
└── .github/workflows/        # CI/CD 配置
```

---

## 核心架构

```
┌───────────────────────────────────────────────────────┐
│                     用户设备 (手机/浏览器)                │
│                                                       │
│  ┌─────────────────────────────────────┐              │
│  │  Web App (React)                    │              │
│  │  - 4 个标签页: 控制台/摘要/策略/历史    │              │
│  │  - 通过 HTTP + WebSocket 连 Bridge   │              │
│  └──────────────┬──────────────────────┘              │
└─────────────────┼─────────────────────────────────────┘
                  │ HTTP REST + WebSocket (LAN)
                  │ Bearer Token 认证
┌─────────────────┼─────────────────────────────────────┐
│  Mac (本地)     │                                     │
│                 ▼                                      │
│  ┌─────────────────────────────────────┐              │
│  │  Bridge (Fastify HTTP Server)       │              │
│  │  端口 8787                           │              │
│  │                                     │              │
│  │  ┌──────────┐  ┌────────────────┐   │              │
│  │  │ MvpState │  │ Policy Engine  │   │              │
│  │  │ (状态机)  │  │ (权限引擎)     │   │              │
│  │  └────┬─────┘  └────────────────┘   │              │
│  │       │                              │              │
│  │       ▼                              │              │
│  │  ┌──────────────────────┐           │              │
│  │  │ @github/copilot-sdk  │           │              │
│  │  │ (Copilot CLI 引擎)   │           │              │
│  │  └──────────────────────┘           │              │
│  └─────────────────────────────────────┘              │
│                                                       │
│  ┌─────────────────────────────────────┐              │
│  │  Desktop App (Tauri)                │              │
│  │  - Bridge 进程管理                    │              │
│  │  - 系统托盘                          │              │
│  │  - 打包运行时 (Node + Bridge + Web)   │              │
│  └─────────────────────────────────────┘              │
│                                                       │
│  磁盘存储:                                             │
│  ~/.joudo/totp-secret          TOTP 密钥               │
│  ~/.copilot/repo-registry.json  仓库注册表              │
│  <repo>/.joudo/sessions-index.json  会话索引            │
│  <repo>/.joudo/sessions/<id>/snapshot.json  会话快照    │
│  <repo>/.github/joudo-policy.yml  权限策略文件           │
│  <repo>/.joudo/repo-instructions.md  仓库指令           │
└───────────────────────────────────────────────────────┘
```

### 组件关系

- **Bridge** 是整个系统的核心，类比 Python 中的 Django/FastAPI 应用
- **Web** 是一个纯前端 SPA（单页应用），类比一个连接 API 的 React 客户端
- **Desktop** 是一个壳程序，主要负责：启动/停止 Bridge 进程、提供系统托盘、把 Bridge + Web + Node.js 打包成 .app
- **Shared** 是类型定义包，类比 Pydantic models，没有运行时代码

---

## 数据流

### 提交 Prompt 的完整流程

```
用户输入 "修复 bug"  →  POST /api/prompt  →  Bridge
                                              │
  1. 验证 Bearer Token（中间件）                │
  2. state.submitPrompt("修复 bug")           │
  3. createSessionOrchestration.runPrompt()   │
     │                                        │
     ├─ 确保 Copilot Session 存在（首次时创建） │
     ├─ 捕获文件写入基线（用于回滚）            │
     ├─ 调用 copilot-sdk 发送 prompt          │
     │   │                                    │
     │   ├─ Copilot 想执行 shell 命令          │
     │   │   → handlePermissionRequest()      │
     │   │   → evaluatePermissionRequest()    │
     │   │   → 自动允许 / 拒绝 / 等待用户确认   │
     │   │                                    │
     │   ├─ Copilot 想写入文件                  │
     │   │   → 同上                            │
     │   │                                    │
     │   └─ Copilot 完成                       │
     │                                        │
     ├─ 记录文件变更                            │
     ├─ 生成摘要（中文）                        │
     ├─ 更新审计日志                            │
     └─ 持久化会话快照到磁盘                     │
                                              │
  4. 广播 session.snapshot 到 WebSocket        │
  5. Web 收到更新，刷新界面                      │
```

### 权限审批流程

```
Copilot 请求执行 "rm -rf /tmp/test"
  │
  ▼
evaluateShellRequest()
  │
  ├─ 是否在 denyShell 黑名单中？ → 直接拒绝
  ├─ 是否是安全只读命令 (cat/ls/git)？ → 在仓库内自动允许
  ├─ 是否是高危解释器 (bash/python)？ → 除非明确允许，否则拒绝
  ├─ 是否在 allowShell 白名单中？ → 自动允许
  ├─ 是否在 confirmShell 中？ → 需要用户确认
  └─ 都不匹配 → 默认需要用户确认
        │
        ▼
  WebSocket 推送 approval 请求到 Web
  用户在手机上 "允许" / "允许并记住" / "拒绝"
        │
        ▼
  POST /api/approval { decision: "allow-and-persist" }
        │
        ▼
  如果是 "allow-and-persist":
    → 写入 .github/joudo-policy.yml 的 allowShell
    → 下次同类命令自动允许
```

---

## 认证流程

Joudo 使用 **TOTP（基于时间的一次性密码）** 认证，和你手机上的 Google Authenticator / 1Password 一样的标准协议（RFC 6238）。

```
首次启动:
  Bridge 生成 TOTP 密钥 → 存到 ~/.joudo/totp-secret (权限 0600)
  终端打印 QR 码 → 用手机验证器扫描

每次连接:
  Web 打开 → 显示 6 位验证码输入框
  输入验证码 → POST /api/auth/totp → 验证通过 → 返回 Session Token
  Session Token 有效期 8 小时，存在浏览器 localStorage
  后续所有 API 调用携带 Bearer Token
  WebSocket 连接也通过 query param 传 token

安全设计:
  - TOTP setup 端点只允许 localhost 访问（手机不能查看密钥）
  - Token 用 crypto.randomBytes(32) 生成（256 位随机）
  - Desktop 本地请求跳过认证（Tauri IPC 走 localhost）
  - WebSocket 失败返回 4001 状态码，前端自动清除 token
```

---

## 策略系统（Policy）

### 策略文件结构

位于 `<repo>/.github/joudo-policy.yml`，格式：

```yaml
version: 1
trusted: false

allowTools:
  - "mcp:filesystem/*"
denyTools:
  - "custom-tool:dangerous"
confirmTools:
  - "mcp:*"

allowShell:
  - "git status"
  - "pnpm test"
denyShell:
  - "rm -rf"
  - "sudo *"
confirmShell:
  - "git push"

allowedPaths:
  - "."                    # 仓库根目录
allowedWritePaths:
  - "src/"
  - "tests/"
allowedUrls:
  - "https://registry.npmjs.org"
```

### 权限类型

| 类型 | 说明 | 默认行为 |
|---|---|---|
| Shell（只读） | cat, ls, git log 等 | 仓库内自动允许 |
| Shell（执行） | 任意命令 | 需要确认 |
| 文件写入 | 写入/创建文件 | 仓库内允许路径自动允许 |
| 文件读取 | 读取文件 | 仓库内自动允许 |
| URL 访问 | 网络请求 | 默认拒绝 |
| MCP 工具 | Model Context Protocol 工具调用 | 需要确认 |

### 评估流程（三阶段）

```
请求进入
  │
  ▼
阶段 1: 结构化匹配
  - 检查 deny/allow/confirm 列表
  - 精确匹配或通配符匹配
  │
  ▼
阶段 2: 正则分析
  - 高危解释器检测 (bash, python, node...)
  - 危险命令模式匹配 (rm, sudo, git push...)
  - 复杂命令检测 (管道|, 分号;)
  │
  ▼
阶段 3: 回退
  - 默认 confirm（需要用户确认）
  - URL 默认 deny（拒绝）
```

### 策略持久化

当用户选择 "允许并记住" 时：
1. `selectPersistedShellPattern()` 提取最可复用的命令模式（如 `git push` 而非 `git push origin main`）
2. `persistApprovalToPolicy()` 将模式追加到 YAML 文件的对应列表中
3. 同时记录 `note` 和 `source: approval-persisted` 供审计

---

## 会话生命周期（Session）

### 状态流转

```
disconnected ──→ idle ──→ running ──→ idle
                   │         │          │
                   │         ├──→ awaiting-approval ──→ running
                   │         │
                   │         ├──→ timed-out
                   │         │
                   │         └──→ recovering
                   │
                   └──→ recovering ──→ idle
```

| 状态 | 说明 |
|---|---|
| disconnected | Bridge 未连接到仓库 |
| idle | 空闲，等待输入 |
| running | Copilot 正在执行 |
| awaiting-approval | 等待用户审批权限请求 |
| timed-out | 执行超时（15 分钟） |
| recovering | 正在恢复历史会话 |

### 会话恢复

会话快照存储在 `<repo>/.joudo/sessions/<id>/snapshot.json`。恢复时：

1. 读取快照文件
2. 将历史数据（timeline、audit 等）应用到当前 RepoContext
3. 尝试 attach 到 Copilot 的已有 session（如果还存活）
4. 如果 attach 失败，降级为 "history-only"（只恢复上下文，不恢复执行状态）

重要规则：
- 已完成的 idle/disconnected 会话：尽力 attach
- 中断的 running/awaiting-approval 会话：只恢复为历史上下文
- 从不把旧的审批请求当作仍然有效的

---

## 持久化与恢复

### 存储位置

| 文件 | 位置 | 内容 |
|---|---|---|
| TOTP 密钥 | `~/.joudo/totp-secret` | Base32 编码的 20 字节密钥 |
| 仓库注册表 | `~/.copilot/repo-registry.json` | 已注册仓库列表 |
| 会话索引 | `<repo>/.joudo/sessions-index.json` | 该仓库所有会话的摘要列表 |
| 会话快照 | `<repo>/.joudo/sessions/<id>/snapshot.json` | 完整会话状态 |
| 策略文件 | `<repo>/.github/joudo-policy.yml` | 权限规则 |
| 仓库指令 | `<repo>/.joudo/repo-instructions.md` | 仓库特定的 AI 指令 |

### 持久化策略

- **原子写入**：先写临时文件，再 rename（类似 Python 的 `tempfile` + `os.rename`）
- **修剪（Pruning）**：快照保留最近 5 个，会话索引保留最近 50 条
- **排队写入**：高频写入场景下，请求排队串行执行，避免竞态
- **写入日志（Journal）**：每次 turn 开始前捕获文件基线（SHA256 哈希），回滚时用此恢复

---

## 打包与分发

### 构建流程

```
pnpm build:desktop
  │
  ├─ 1. pnpm build (根目录)
  │     ├─ typecheck (tsc --noEmit)
  │     ├─ pnpm --filter @joudo/web build   → apps/web/dist/
  │     └─ pnpm --filter @joudo/bridge build → apps/bridge/dist/
  │
  ├─ 2. pnpm build (desktop)
  │     └─ vite build → apps/desktop/dist/
  │
  ├─ 3. prepare:bundle-runtime
  │     ├─ 复制 bridge/dist + node_modules → bundle-resources/workspace/
  │     ├─ 复制 web/dist → bundle-resources/workspace/
  │     ├─ 复制 Node.js 二进制 → bundle-resources/runtime/node/
  │     └─ 修剪: 删除 .pnpm, src/, 非当前平台的预构建二进制
  │
  └─ 4. tauri build --bundles app
        └─ Rust 编译 + 打包 → Joudo.app
```

### 生成 DMG 安装包

```
pnpm build:desktop:dmg
  │
  ├─ 执行上述 build:desktop
  └─ node scripts/build-dmg.mjs
       └─ hdiutil create -volname Joudo -srcfolder Joudo.app -format UDZO
       → Joudo_0.1.0_{arch}.dmg
```

### Tauri 是什么？

Tauri 类比 PyInstaller 但更强大：
- **PyInstaller** 把 Python 脚本 + 解释器打包成可执行文件
- **Tauri** 把 Web 前端 + Rust 后端打包成原生桌面应用
- Rust 部分 (`main.rs`) 负责：进程管理、系统托盘、窗口管理、检测运行时
- TypeScript 部分 (`main.ts`) 负责：桌面控制面板 UI（启停 Bridge、显示状态）
- 打包后的 `.app` 内含：Rust 二进制 + Web 界面 + Bridge 代码 + Node.js 运行时

### 签名状态

当前版本 **未签名**（没有 Apple Developer 证书）。macOS 用户需要：
```bash
xattr -cr /Applications/Joudo.app     # 清除隔离标记
# 或者在系统设置 → 隐私与安全性 中点击 "仍要打开"
```

---

## CI/CD 管线

### 三条工作流

#### 1. `ci.yml` — 基础检查

| 触发 | 事件 |
|---|---|
| push to main | 自动 |
| PR | 自动 |

```
Job 1: typecheck-and-tests (ubuntu-latest)
  → pnpm typecheck（全部包）
  → bridge tests（tsx --test）
  → web tests（vitest run）

Job 2: build-web-and-bridge (ubuntu-latest)
  → pnpm build（类型检查 + 构建 web + bridge）
```

#### 2. `desktop-macos.yml` — 桌面应用构建验证

| 触发 | 事件 |
|---|---|
| push to main (apps/ 路径变更) | 自动 |
| PR (apps/ 路径变更) | 自动 |
| workflow_dispatch | 手动 |

```
Job: build-packaged-desktop (macos-15-intel)
  → pnpm build:desktop
  → validate:packaged-runtime（启动 Bridge → 健康检查 → TOTP 验证）
  → 上传 Joudo.app artifact
```

#### 3. `release-desktop.yml` — 正式发布

| 触发 | 事件 |
|---|---|
| workflow_dispatch | 手动（可选参数：build_dmg, prepare_signing） |

```
Job 1: build-app (矩阵策略)
  ├─ x64: macos-15-intel
  └─ arm64: macos-14
  → build + validate + ditto 归档 + 上传

Job 2: build-dmg (依赖 Job 1)
  → 下载 .app 归档 → 解压 → hdiutil 生成 DMG → 上传

Job 3: signing-readiness（占位，待证书就绪后实现）
```

### CI 关键细节

- **pnpm 安装**：必须先 `pnpm/action-setup@v4` 再 `actions/setup-node@v4`（因为 corepack 依赖关系）
- **双架构矩阵**：x64 用 `macos-15-intel` runner，arm64 用 `macos-14` runner
- **Artifact 传递**：用 `ditto -c -k` 归档 .app（保留 macOS 扩展属性），不能直接 `upload-artifact`
- **验证脚本**：在 CI 中直接 spawn Bridge 二进制（不能用 `open -n`）

---

## 依赖管理与清理

### 当前依赖一览

#### Bridge (`@joudo/bridge`)
| 依赖 | 用途 | 是否必需 |
|---|---|---|
| fastify ^5.2.1 | HTTP 框架 | ✅ 核心 |
| @fastify/cors | 跨域支持 | ✅ LAN 访问必需 |
| @fastify/static | 静态文件服务 | ✅ 生产模式服务 Web UI |
| @fastify/websocket | WebSocket 支持 | ✅ 实时推送 |
| @github/copilot 1.0.10 | Copilot 底层库 | ✅ 核心 |
| @github/copilot-sdk 0.2.0 | Copilot SDK | ✅ 核心 |
| qrcode-terminal | 终端 QR 码 | ⚠️ 只在首次 TOTP 绑定时用 |
| yaml ^2.8.2 | YAML 解析 | ✅ 策略文件读写 |
| tsx (dev) | TypeScript 执行器 | ✅ 开发 + 测试 |

#### Web (`@joudo/web`)
| 依赖 | 用途 | 是否必需 |
|---|---|---|
| react ^19.0.0 | UI 框架 | ✅ 核心 |
| react-dom ^19.0.0 | React DOM 渲染 | ✅ 核心 |
| vite (dev) | 打包工具 | ✅ 构建 |
| vitest (dev) | 测试框架 | ✅ 测试 |
| @testing-library/* (dev) | 组件测试工具 | ✅ 测试 |
| jsdom (dev) | 虚拟 DOM 环境 | ✅ 测试 |

#### Desktop (`@joudo/desktop`)
| 依赖 | 用途 | 是否必需 |
|---|---|---|
| @tauri-apps/api ^2.10.1 | Tauri JS API | ✅ 桌面功能 |
| qrcode ^1.5.4 | 生成 QR 码（移动端访问链接） | ✅ |
| @tauri-apps/cli (dev) | Tauri CLI 工具 | ✅ 构建 |

### 清理建议

1. **qrcode-terminal**（Bridge）：仅在首次绑定 TOTP 时使用，可以考虑用 `qrcode` 替代统一为一个库
2. **dev dependencies**：都是正常的开发工具链依赖，无需清理
3. **@github/copilot vs @github/copilot-sdk**：两个包都需要，sdk 依赖 copilot 底层包
4. **打包时的修剪**：`prepare-bundle-runtime.mjs` 已经在打包时删除 `.pnpm`、`src/`、非当前平台预构建二进制

### 依赖更新建议

```bash
# 检查过期依赖
corepack pnpm --recursive outdated

# 更新单个包
corepack pnpm --filter @joudo/bridge update fastify

# 全局更新（谨慎）
corepack pnpm --recursive update
```

---

## 关键术语对照表

| Joudo 术语 | 含义 | Python 等价 |
|---|---|---|
| **RepoContext** | 单个仓库的完整运行时状态 | SQLAlchemy Session + model 实例集合 |
| **MvpState** | 全局状态管理器，管理所有 RepoContext | Application 单例 |
| **SessionSnapshot** | 会话的完整序列化快照 | model.to_dict() |
| **Turn** | 一次 prompt + response 的完整交互 | 一次请求-响应周期 |
| **Approval** | 权限审批请求 | 类似 Django admin 审批 |
| **Timeline** | 事件时间线列表 | 审计日志 |
| **Listener** | 状态变更回调 | Signal / Event handler |
| **Policy** | 仓库级权限配置文件 | Settings / Config |
| **Checkpoint** | Copilot 工作区的保存点 | 数据库 Savepoint |
| **Journal** | 文件写入前的基线记录 | WAL (Write-Ahead Log) |
| **Rollback** | 撤销最后一次 turn 的所有文件变更 | Transaction rollback |
| **Persistence** | 将内存状态写入磁盘 | ORM flush / commit |

---

## 下一步阅读

| 文档 | 内容 |
|---|---|
| [01-bridge-core.md](01-bridge-core.md) | Bridge 核心文件详解（index.ts、mvp-state.ts、errors.ts） |
| [02-bridge-state.md](02-bridge-state.md) | State 子模块详解（18 个文件） |
| [03-bridge-policy.md](03-bridge-policy.md) | 策略引擎详解（8 个文件） |
| [04-bridge-auth.md](04-bridge-auth.md) | 认证模块详解（3 个文件） |
| [05-web.md](05-web.md) | Web 前端详解（App、Hooks、组件） |
| [06-desktop.md](06-desktop.md) | Desktop 桌面应用详解（Rust + Tauri + 打包脚本） |
| [07-shared-and-scripts.md](07-shared-and-scripts.md) | 共享类型包 + 运维脚本 |
