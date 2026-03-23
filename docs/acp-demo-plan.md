# Joudo ACP Demo

## 目的

这份文档只说明当前 demo 在验证什么，以及它还没有覆盖什么。

它不是未来演示脚本草案，而是当前真实能力的演示边界说明。

## 当前 demo 已验证的内容

### Web 到 bridge 的真实闭环

当前 demo 可以展示：

- 选择仓库
- 发送 prompt
- bridge 发起真实 Copilot 会话
- 前端收到结构化 snapshot 更新

### 运行时 policy 决策

当前 demo 可以展示：

- auto-allow
- auto-deny
- awaiting-user
- 审批结果进入 timeline、summary 和 audit

### 三态审批

当前 demo 可以展示：

- 拒绝
- 允许本次
- 允许并加入 policy

并且能够直接展示：

- 最近一次写入 policy 的成功卡片
- Repo Policy 面板中的 `allowed_write_paths`

### 历史与恢复

当前 demo 可以展示：

- 历史 session 列表
- history-only 恢复
- 对可附着旧会话的 best-effort attach

### rollback 解释能力

当前 demo 可以展示：

- activity 中的 rollback 状态
- tracked scope
- watcher 越界写入导致的降级
- `/undo` 后仍需 Joudo 自己验证的原则

## 当前 demo 不承诺的内容

- 任意旧会话都能恢复并继续执行
- checkpoint restore
- 任意历史 turn rewind
- 最终形态的单应用安装包
- URL 持久化审批

## 当前 demo 推荐演示顺序

1. 打开 Web UI 并选择仓库
2. 展示 Repo Context 与 Repo Policy 面板
3. 发送一条会触发真实权限请求的 prompt
4. 在网页端演示三态审批
5. 展示 timeline、summary、activity 中的结构化结果
6. 展示历史 session 列表和恢复入口
7. 如有合适场景，展示上一轮 rollback eligibility

## 当前 demo 的价值

当前 demo 主要证明两件事：

- Joudo 已经不是概念图，而是能驱动真实 Copilot 会话的控制平面
- policy、审批、恢复、摘要和 rollback 已经开始收敛成统一产品面

## 当前最值得继续补强的 demo 点

- allowlist 管理动作
- write allowlist 的来源解释
- recovery 与 rollback 的更短文案