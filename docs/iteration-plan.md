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
