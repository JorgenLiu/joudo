# Joudo 当前状态

## 一句话结论

Joudo 当前已经是一个可运行的本地 bridge + Web UI MVP，具备真实 Copilot 会话、repo-scoped policy、网页审批、结构化摘要、历史恢复和上一轮回退判断能力。

## 已完成的主能力

### 真实会话闭环

当前网页可以：

- 选择仓库
- 发送 prompt
- 驱动 bridge 发起真实 Copilot 会话
- 接收结构化 session snapshot

### 结构化 UI

当前 Web UI 已包含：

- 本机 TOTP 验证与本机可见的手动绑定信息
- 仓库列表
- Repo Context 面板
- Repo Policy 面板
- Prompt 输入
- 审批队列
- 摘要
- 活动视图
- 历史会话列表
- policy live 回归结果
- 时间线
- 错误面板

### 运行时策略决策

Bridge 当前已经把 repo policy 真正用于权限判定，而不是只探测文件是否存在。

当前支持：

- tool allow / confirm / deny
- shell allow / confirm / deny
- shell pipe/chain 检测：含 `|` `&&` `||` `;` 的命令即使命中 allow 规则也强制 confirm
- read path allow / confirm
- write path allow / confirm / deny
- URL allow / deny

### 三态审批

网页审批当前支持：

- 拒绝
- 允许本次
- 允许并加入 policy

持久化批准当前覆盖：

- shell -> `allow_shell`
- read -> `allowed_paths`
- 受控 write -> `allowed_write_paths`

### Policy 可视化

网页当前可以直接展示当前 repo policy 的结构化摘要，尤其是：

- `allowed_write_paths`
- `allow_shell`
- `allowed_paths`
- policy 文件路径和状态

### Repo 初始化入口

当前 bridge 已支持 `POST /api/repo/init-policy`，可以为当前选中的仓库补齐：

- 推荐的 `.github/joudo-policy.yml`
- `.joudo/repo-instructions.md`
- `.joudo/sessions-index.json`

Web UI 也已经在未初始化仓库上显示最小 onboarding 卡片，引导用户先初始化当前 repo 再开始第一轮任务。

### 历史与恢复

当前 bridge 已支持：

- repo-scoped 历史 session index
- 历史 snapshot 持久化
- history-only 恢复
- 对符合条件的旧会话做 best-effort attach

### 回退与工作区证据

当前 bridge 已支持：

- turn-scoped changeset 生成
- write journal
- tracked scope + watcher 的混合证据模型
- 上一轮整体回退 eligibility 判断
- 调用 `/undo` 后再做 Joudo 自己的结果验证

## 当前明确边界

### 不是远程 shell

Joudo 不是终端转发器，也不做 TUI 抓取。

### 不是强一致会话恢复器

历史恢复当前优先保证事实可解释，不保证任何旧会话都能安全继续执行。

### rollback 仍然只支持上一轮整体回退

当前没有 checkpoint restore，也没有任意历史 turn rewind。

### write 持久化是窄权限模型

当前不会把一次 write 审批升级为全局 `allow_tools: write`。

### 交付形态仍然是开发态组合

当前主交付仍是：

- `apps/bridge` 本地运行
- `apps/web` Web UI

同时已经补上：

- bridge 生产构建与静态托管 Web 产物
- 一个 Tauri 菜单栏壳的最小 monorepo 骨架（尚未在当前机器上编译验证）

还不是单一可安装的最终产品。

## 当前最重要的事实来源

如果要理解当前实现，应优先以这些为准：

- `apps/bridge/src/`
- `apps/web/src/`
- `packages/shared/src/index.ts`
- `docs/architecture.md`
- `docs/implementation-notes.md`
- `docs/next-step-plan.md`

## 当前风险

### `/undo` 仍然不是强事务回滚

即使当前实验结果可用，也不能把它当成数据库式 rewind。

### 底层 CLI / SDK 行为仍可能影响恢复边界

恢复、事件流和底层命令语义仍受上游版本影响。

### policy 治理刚进入可回收阶段，但还不够成熟

当前已经支持结构化展示、单条删除和复制规则文本，但还没有批量治理、来源审计回溯和更细粒度的风险管理。

## 当前推荐阅读顺序

1. `README.md`
2. `docs/architecture.md`
3. `docs/implementation-notes.md`
4. `docs/policy.md`
5. `docs/next-step-plan.md`