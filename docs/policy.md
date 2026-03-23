# Joudo 策略模型

## 目标

Joudo 需要一套比“默认放开 Copilot CLI”更严格的 repo-scoped 策略系统。

当前策略模型的目标是：

- 把权限边界收紧到仓库级别
- 让 bridge 能对真实权限请求做运行时判定
- 让用户能在网页端审批策略外请求
- 允许把一部分人工批准结果反向写回 repo policy

## 当前支持的 policy 字段

当前 bridge 支持从以下文件位置加载 policy：

- `.github/joudo-policy.yml`
- `.github/joudo-policy.yaml`
- `.github/policy.yml`
- `.github/policy.yaml`

当前支持的字段：

- `allow_tools`
- `deny_tools`
- `confirm_tools`
- `allow_shell`
- `deny_shell`
- `confirm_shell`
- `allowed_paths`
- `allowed_write_paths`
- `allowed_urls`

## 运行时决策模型

bridge 在收到权限请求后，会返回三类结果之一：

- `allow`
- `confirm`
- `deny`

这不是静态检查，而是当前真实会话中的运行时决策。

## 当前默认行为

### shell

- 仓库内只读 shell 探索可以自动允许
- 高风险解释器和明显危险命令默认拒绝，除非被显式 allow
- 命中 `confirm_shell` 或策略未覆盖但仍可人工判断的 shell，会进入网页审批

### read

- repo 内命中 `allowed_paths` 的读取可自动允许
- repo 外读取或超出 allowlist 的读取会进入确认

### write

- 超出 repo 边界的写入直接拒绝
- 命中 `allowed_write_paths` 的 write 可自动允许
- repo 内但不在 write allowlist 的写入通常进入确认
- 当前不会因为持久化一次 write 审批就放开全局 `allow_tools: write`

### URL

- 默认拒绝未命中 allowlist 的 URL
- 当前没有继续扩展 URL 持久化审批能力

## 网页审批动作

当前网页审批支持：

- 拒绝
- 允许本次
- 允许并加入 policy

持久化批准当前覆盖：

- shell -> `allow_shell`
- read -> `allowed_paths`
- 受控 write -> `allowed_write_paths`

## `allowed_write_paths` 的语义

这是当前策略模型里最重要的新收敛点。

它的目的不是“允许写很多地方”，而是避免把一次受控写入审批错误升级成全局 `allow_tools: write`。

当前持久化 write 只接受两类结果：

- 明确单文件路径，例如 `./src/index.ts`
- `generated` / `__generated__` 目录，例如 `./src/generated`

不建议把以下路径写入 `allowed_write_paths`：

- `.`
- `./src`
- 任何覆盖整片业务源码的宽路径

## 为什么要把 `allowed_paths` 和 `allowed_write_paths` 分开

因为“允许读”不等于“允许写”。

当前模型明确区分：

- `allowed_paths` 用于读取边界
- `allowed_write_paths` 用于 write tool 自动允许边界

这样才能避免把读取型 allowlist 误解释成写入权限。

## 已知限制：路径验证的 TOCTOU 竞态

Joudo 的路径验证使用 `realpathSync()` 解析符号链接后再做包含性检查。但在"检查路径"和"Copilot CLI 实际执行读写"之间存在一个时间窗口（TOCTOU, Time-of-Check to Time-of-Use）。

在这个窗口内，如果文件系统被外部修改（例如符号链接被替换成指向 repo 外的目标），Joudo 的路径判定可能不再准确。

对于 Joudo 的目标场景（本地单用户、repo-scoped 操作），这一风险可控：

- 攻击者需要在本机有文件系统写权限才能竞态替换符号链接
- 如果攻击者已有本机写权限，他可以直接操作文件而无需绕过 Joudo
- Joudo 本身不是 sandbox，它是策略辅助层

当前处理：
- `resolvePathForContainment()` 在检查时刻使用 `realpathSync()` 解析到最终物理路径
- 如果候选路径的某段不存在，回退到最近可解析的父路径加相对后缀
- 不做后续的二次验证或 inode lock

如果后续引入远程访问场景或多用户环境，应当重新评估此限制。

## Policy 写回约束

当用户选择“允许并加入 policy”时，bridge 会：

- 归一化当前请求
- 将规则写入 repo policy
- 重新加载 policy
- 更新当前 session snapshot 中的结构化 policy 摘要

同时，这个写回动作不会被算成当前 Copilot turn 的工作区漂移。

## 当前推荐起始模板

推荐起始模板见：

- `docs/examples/joudo-policy.recommended.yml`

这份模板的重点不是“放开一切”，而是：

- 自动允许高频只读命令
- 把高风险 shell 留在 confirm 或 deny
- 给 write 留出单独的窄 allowlist

## 当前推荐实践

### 适合自动 allow 的项

- Git 只读查询
- 文件查看与搜索
- 稳定的测试、lint、typecheck 命令
- 受控 generated 目录写入
- 明确的单文件写入

### 适合 confirm 的项

- 安装依赖
- 启动长期运行服务
- repo 内但未命中 write allowlist 的写入
- 访问已允许域名但当前仍需要人工判断的请求

### 适合 deny 的项

- `sudo`
- `rm`
- `ssh` / `scp` / `rsync`
- `git push`
- repo 外写入

## 当前限制

- 还没有 allowlist 删除或回收入口
- 还没有 URL 持久化审批
- 还没有更细粒度的“写入原因”治理面板