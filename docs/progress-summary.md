# Joudo 进度摘要

## 当前判断

Joudo 现在已经越过“是否可行”的阶段，进入“如何把现有能力收紧成稳定产品面”的阶段。

当前最重要的事实不是又完成了哪些零散事项，而是：

- 主链路已经可运行
- 安全边界已经基本成型
- 当前主要工作转向治理、解释和产品收口

## 当前可用能力

- 本地 bridge + Web UI 的真实 Copilot 会话闭环
- repo-scoped policy 判定与网页三态审批
- 审批结果写回 allowlist
- 结构化 Summary、Timeline、Activity、History
- repo-scoped 历史快照与 history-only / best-effort attach 恢复
- 基于 write journal 与工作区观测的上一轮回退判断
- 运行时 custom agent 发现、切换和失效自动回退

## 当前最值得关注的缺口

- policy 治理仍然不够完整，尤其是规则回收、来源追踪和范围解释
- recovery / rollback 的产品语言仍然偏工程化，理解成本偏高
- 当前仍以开发态交付为主，还没有收敛到最终安装与发布形态
- 手机 Web UI 的 agent 区域此前在“未发现 agent”时会直接消失，已经收敛为显式空状态；下一步重点应切到打包和正式安装路径

## 当前阶段结论

后续工作的重点不应再是继续堆新的执行实验，而应优先提升这三件事：

1. policy 治理闭环
2. 恢复与回退解释质量
3. 交付形态收口

## Packaging 下一步

当前已经具备推进 app 打包的前置条件：

- desktop 托盘壳可运行
- bridge 可由 desktop 管理或识别外部 bridge
- TOTP / repo / LAN 控制面已经落到 desktop

接下来更合理的主线是把“开发态能跑”收敛成“可以交付安装”的流程，优先级建议如下：

1. 已完成：把默认 desktop 打包路径固定为 `.app`，`corepack pnpm build:desktop` 直接产出 `Joudo.app`
2. 已完成：`.app` 形态下 bridge 已验证由 bundle 内受控 Node 自动拉起，并正常监听 `8787`
3. 已完成：packaged desktop 回归脚本已落地，可自动验证 TOTP、本机 repo 管理、历史清空和重启链路
4. 当前进行中：继续补齐托盘驻留、Dock 图标等仍偏人工的无终端回归验证
5. 后续再补版本升级和首次启动说明

当前 packaging 结论：`.app` 默认产物已稳定，且已验证 packaged desktop 只使用 app bundle 内受控 Node/runtime；`.dmg` 也已改走简化 `hdiutil` 路径并绕过原先 create-dmg 的卸载失败点。