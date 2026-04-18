# Joudo

> **⚠️ 已存档** — 2026 年 4 月 13 日 GitHub 发布了 `copilot --remote`（CLI 会话远程控制），覆盖了 Joudo 的核心场景。本项目不再活跃开发。详见[存档决策](.ai/decisions/001-project-archive.md)。

Joudo 是 GitHub Copilot CLI 的本地优先、移动优先 Web 前端。它在同一局域网内提供一个 repo-scoped、可审批、可恢复、可解释的 Copilot 操控界面。

**项目周期**：2026-03-14 → 2026-03-25（11 天，solo）
**最终版本**：v0.1.0（unsigned test build）

---

## 它做了什么

从零到一个完整打包、有 CI/CD 的 macOS 应用：

- **Bridge**：Fastify 5 后端，26 条 API 路由，18 个状态模块，驱动 `@github/copilot-sdk` 会话
- **Web UI**：React 19 移动优先界面，4 个 tab（Console / Summary / Policy / History）
- **Desktop**：Tauri 2 macOS 壳，菜单栏托盘应用，内置受控 Node runtime
- **Policy Engine**：per-repo YAML 策略，shell 命令规范化，三态审批（拒绝 / 允许本次 / 允许并持久化）
- **Auth**：TOTP (RFC 6238) 本地认证，session token 自动续期
- **CI/CD**：3 个 GitHub Actions workflow，双架构 DMG (x64 + arm64)

### 数字

| 指标 | 数值 |
|------|------|
| Bridge 源码 | 33 文件，~8,000 行 |
| Web 源码 | 30 文件，~4,000 行 |
| 测试 | 26 文件，~4,500 行 |
| 共享类型 | 528 行 |
| API 路由 | 26（17 POST / 8 GET / 1 WS） |
| Web 组件 | 28 |

---

## 架构

```
┌──────────────────────────────────────────────┐
│  macOS Desktop (Tauri 2)                     │
│  ┌─────────────┐  ┌───────────────────────┐  │
│  │ Control Panel│  │ Bundled Node Runtime  │  │
│  └─────────────┘  └───────────────────────┘  │
│         │                    │                │
│         ▼                    ▼                │
│  ┌────────────────────────────────────────┐  │
│  │  Bridge (Fastify 5, port 8787)        │  │
│  │  ┌──────────┐ ┌────────┐ ┌─────────┐  │  │
│  │  │ Session  │ │ Policy │ │  Auth   │  │  │
│  │  │ State    │ │ Engine │ │ (TOTP)  │  │  │
│  │  └──────────┘ └────────┘ └─────────┘  │  │
│  │         │                              │  │
│  │         ▼                              │  │
│  │  ┌──────────────────┐                  │  │
│  │  │ @github/copilot  │                  │  │
│  │  │    SDK 0.2.0     │                  │  │
│  │  └──────────────────┘                  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
         ▲ HTTP + WebSocket (LAN)
         │
┌────────┴────────┐
│  Mobile Web UI  │
│  (React 19)     │
│  Any browser    │
└─────────────────┘
```

**关键设计决策**：

- Transport / Policy / Session 三层分离
- 会话状态 repo-scoped，不用用户 home 目录
- Bridge 状态拆分为 18 个聚焦模块，而非单一大文件
- 移动优先 Web 而非原生 App — 任何手机浏览器通过 LAN 访问
- 纯 LAN 直连，不经云端中转

---

## 仓库结构

```
joudo/
├── apps/
│   ├── bridge/      # Fastify 后端 — 会话、策略、审批、持久化
│   ├── web/         # React 移动优先 Web UI
│   └── desktop/     # Tauri v2 macOS 桌面壳
├── packages/
│   └── shared/      # 零运行时共享 TypeScript 类型
├── scripts/         # 开发/运维脚本
├── docs/            # 项目文档
└── .github/         # CI/CD + Copilot 指令文件
```

**代码阅读推荐顺序**：

1. `apps/bridge/src/index.ts` — 入口与路由注册
2. `apps/bridge/src/mvp-state.ts` — 核心状态机
3. `apps/bridge/src/state/session-orchestration.ts` — 会话编排
4. `apps/web/src/hooks/useBridgeApp.ts` — 前端状态管理
5. `packages/shared/src/index.ts` — 类型定义

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | TypeScript, Fastify 5, NodeNext |
| 前端 | TypeScript, React 19, Vite |
| 桌面 | Rust + TypeScript, Tauri 2 |
| 类型 | TypeScript 5.8+ strict mode |
| 测试 | node:test + node:assert (Bridge), Vitest + Testing Library (Web) |
| CI | GitHub Actions, pnpm 10.6 via corepack |
| SDK | @github/copilot-sdk 0.2.0, @github/copilot 1.0.10 |

---

## 快速开始

```bash
# 安装依赖
corepack pnpm install

# 启动开发环境（bridge + web）
corepack pnpm dev

# 类型检查
corepack pnpm typecheck

# 运行测试
corepack pnpm --filter @joudo/bridge test
corepack pnpm --filter @joudo/web test

# 构建 desktop app
corepack pnpm build:desktop
```

默认地址：Web `http://localhost:5173`，Bridge `http://localhost:8787`

详见 [docs/quickstart.md](docs/quickstart.md)。

---

## 为什么存档

2026 年 4 月 13 日，GitHub 发布了 `copilot --remote`：

- CLI 会话实时流式传输到 GitHub 服务器
- Web 和 Mobile 远程发送 prompt、审批权限、切换模式
- QR 码扫描连接、session resume、keep-alive
- 原生 GitHub Mobile app 支持

这覆盖了 Joudo 的核心价值主张（手机远程操控 CLI 会话）。

### Joudo 仍有但官方没有的

| 能力 | 说明 | 实际意义 |
|------|------|----------|
| 不要求 GitHub 仓库 | 任何本地 git repo 可用 | GitHub 已表示"正在扩展" |
| 纯 LAN、无需互联网 | 不经 GitHub 服务器中转 | LLM 本身需要联网，场景极窄 |
| Policy 持久化 | YAML allowlist 写回 | 作者自己都用 bypass 模式 |
| Audit trail + rollback | 审计日志 + 上一轮回退 | 无实际用户验证 |

差异点要么是临时的、要么是伪需求。详见 [.ai/decisions/001-project-archive.md](.ai/decisions/001-project-archive.md)。

### 验证了什么

- ✅ 产品直觉正确 — 独立走到了和 GitHub 官方相同的产品形态
- ✅ 架构判断正确 — transport/policy/session 分离、repo-scoped state、mobile-first web
- ✅ 工程可行性 — solo 11 天从零到打包分发的 macOS app + 完整 CI/CD

### 教训

- 在构建治理层之前先验证是否有人需要治理
- 平台 wrapper 的生命周期以月计，不以年计
- 自己的使用模式是最早的需求信号 — bypass 模式应该是个警告

---

## 文档

- [docs/current-status.md](docs/current-status.md) — 最终产品状态
- [docs/iteration-plan.md](docs/iteration-plan.md) — 迭代计划（冻结）
- [docs/policy-guide.md](docs/policy-guide.md) — Policy 使用指南
- [docs/quickstart.md](docs/quickstart.md) — 快速上手
- [docs/code_guide/](docs/code_guide/) — 代码导读（7 篇）
- [.ai/decisions/001-project-archive.md](.ai/decisions/001-project-archive.md) — 存档决策记录

## License

MIT
