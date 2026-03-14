# Joudo 当前实现说明

## 实现目标

当前代码的核心目标，不是做一个功能完备的最终产品，而是先建立一条最小但真实的运行链路：

- 网页端负责输入提示词和展示状态
- bridge 负责持有真实 Copilot 会话与审批流
- 共享类型负责约束前后端协议
- demo 仓库负责承载真实开发任务

整个实现围绕一句话展开：

让网页可以安全地观察和驱动一个按仓库隔离的真实 Copilot ACP 会话。

## 当前代码的分层思路

### 1. `packages/shared`

这一层负责定义前后端共享的数据契约。

当前最重要的类型包括：

- `SessionSnapshot`
- `SessionSummary`
- `ApprovalRequest`
- `CopilotAuthState`
- `SessionTimelineEntry`
- `ServerEvent`

设计原则是：

- 网页不直接理解 Copilot SDK 的内部事件模型
- bridge 先把复杂事件归一化成 Joudo 自己的快照和事件
- 网页只消费共享协议，不直接绑定 SDK 细节

这样做的好处是，后续如果我们替换 bridge 内部实现或扩展审计字段，网页层不需要跟着一起大改。

### 2. `apps/bridge/src/mvp-state.ts`

这是当前 bridge 的核心状态机。

它承担了几类职责：

- 发现和维护受信任仓库列表
- 维护当前选中的 repo 上下文
- 创建和复用真实 Copilot 会话
- 维护网页可消费的快照状态
- 把真实权限请求映射为网页审批对象
- 维护一条简化的会话时间线

这份实现的思路可以拆成几个点。

#### 仓库维度隔离

bridge 不是只维护一个全局会话，而是以 repo 为单位创建 `RepoContext`。

每个 repo context 持有：

- 当前 repo
- 当前 session
- 会话状态
- 最近 prompt
- 待审批列表
- 时间线
- 当前摘要
- 已批准命令记录

这一步是后续实现“按仓库恢复会话”和“repo-scoped policy”的前提。

#### 认证状态与会话创建解耦

bridge 会先调用 CopilotClient 查询 auth 状态。

只有当状态是 authenticated 时，才会真正创建 session。这样网页上能把“未登录”和“会话执行失败”区分开，而不是全部混成一类错误。

#### 真实权限请求映射为 Joudo 审批

Copilot ACP 发出的 permission request 不直接暴露到网页。

bridge 会把它转换成 `ApprovalRequest`，放入当前 snapshot，同时把对应的 `resolve` 回调保存到 `pendingApprovals` 里。网页点击批准或拒绝之后，bridge 再把决策回写给真实 Copilot 会话。

这就是 Joudo 当前审批流的核心闭环。

#### 结构化摘要与时间线并行维护

当前实现没有把所有细粒度原始事件直接扔给网页，而是维护两种视图：

- 一张结构化摘要卡
- 一条更接近“过程记录”的时间线

摘要适合手机快速浏览；时间线适合判断这一轮到底发生了什么。

这是后续做“移动端默认看摘要，展开看细节”的基础。

### 3. `apps/bridge/src/index.ts`

这一层尽量保持轻量。

它主要负责：

- 暴露 HTTP 接口
- 暴露 WebSocket 快照推送
- 在进程退出时清理 session

当前端点包括：

- `/health`
- `/api/repos`
- `/api/session`
- `/api/auth/refresh`
- `/api/session/select`
- `/api/prompt`
- `/api/approval`
- `/ws`

这种分法的目的，是让 `mvp-state.ts` 保持“状态和行为核心”，而让 `index.ts` 只承担协议入口。

### 4. `apps/web/src/App.tsx`

网页目前是一个单页式的操作面板。

它承担的职责包括：

- 拉取 repo 列表
- 拉取和订阅 session snapshot
- 提交 prompt
- 展示审批卡片
- 展示 auth 状态
- 展示模型名
- 展示摘要和时间线

这里的设计重点不是前端状态管理技巧，而是让网页尽量像一个 bridge 控制面板：

- 未登录时明确展示登录引导
- 运行中时避免重复提交 prompt
- 有待审批时把交互焦点转到审批卡片
- 用快照驱动 UI，而不是让多个局部状态各自推测 bridge 当前状态

### 5. demo 仓库本身

`~/dev/demo` 的目的不是做一个完整产品，而是作为 Joudo 的真实任务靶场。

当前它包含：

- 一个最小 FastAPI 应用
- 一个 SQLite 数据库文件
- 一份 repo policy 示例
- 一个最小 README

这使得后续验证不再只是“能不能回一句话”，而是可以转向：

- 安装依赖
- 启动服务
- 读数据库
- 浏览器检查
- 权限审批

## 当前实现的关键取舍

### 1. 先跑通真实链路，再做完整策略执行

当前 bridge 已经能识别 policy 文件是否存在，但还没有把 policy 编译成完整的 allow, confirm, deny 运行时判定器。

这个取舍是有意的：

- 先证明真实会话和网页审批可用
- 再把策略执行从“存在文件”升级为“真正影响决策”

### 2. 先用共享快照驱动页面，再考虑更细粒度事件模型

当前网页主要依赖 `session.snapshot`。

这让状态同步和调试更直接，但代价是桥接层需要承担更多归一化工作。对 MVP 来说，这个取舍是合理的，因为它更容易验证。

### 3. 先固定模型为 `gpt-5-mini`

当前默认模型是 `gpt-5-mini`，原因很直接：

- 成本可控
- 便于持续验证真实流程
- 避免在功能验证阶段把预算问题混进来

后续如果要做模型切换，应该把它纳入 repo 或 session 级配置，而不是散落在 prompt 层。

## 当前代码最需要继续补强的地方

从实现角度看，接下来最值得补强的是：

- 真正的 policy evaluator
- 会话恢复与服务重启后的状态恢复
- 对长时间运行任务的更稳定观察方式
- 审计字段的系统化记录
- 浏览器工具路径的正式接入与验证

## 总结

当前添加的代码，本质上是在构建 Joudo 的第一版控制平面：

- 用真实 Copilot 会话取代模拟
- 用 repo context 管理隔离边界
- 用快照和时间线把复杂运行态转成网页可消费的信息
- 用 demo 仓库把“聊天工具”推进成“本地开发工作流入口”

这套设计还不是终态，但已经具备继续往策略、浏览器验证和失败恢复演进的基础。