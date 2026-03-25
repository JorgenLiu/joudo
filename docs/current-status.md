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
