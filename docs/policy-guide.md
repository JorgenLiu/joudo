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
