# Desktop 桌面应用详解

> 本文档覆盖 `apps/desktop/` 下的所有文件。
> Desktop 应用是一个 "壳程序"，主要作用是把 Bridge + Web + Node.js 打包成一个可双击运行的 macOS .app。

---

## 模块总览

```
desktop/
├── index.html            # Vite HTML 模板
├── package.json          # 依赖和脚本
├── vite.config.ts        # Vite 构建配置
├── tsconfig.json         # TypeScript 配置
│
├── src/
│   ├── main.ts           # 桌面控制面板 UI（TypeScript）
│   └── style.css         # 控制面板样式
│
├── src-tauri/
│   ├── Cargo.toml        # Rust 依赖声明
│   ├── tauri.conf.json   # Tauri 主配置文件
│   ├── build.rs          # Rust 构建脚本
│   │
│   ├── src/
│   │   └── main.rs       # Rust 原生入口（进程管理、系统托盘）
│   │
│   ├── bundle-resources/ # 打包时填充的运行时文件
│   ├── capabilities/     # Tauri 安全能力声明
│   ├── gen/              # Tauri 自动生成的代码
│   └── icons/            # 应用图标
│
└── scripts/
    ├── prepare-bundle-runtime.mjs   # 打包前准备运行时
    ├── build-dmg.mjs                # 生成 DMG 安装包
    └── validate-packaged-runtime.mjs # 打包后验证
```

---

## Tauri 是什么？

### 对比 Python 打包工具

| 工具 | 作用 | 输出 |
|---|---|---|
| **PyInstaller** | 打包 Python 脚本 + 解释器 | .exe / .app |
| **Electron** | Chromium + Node.js 打包 | .app (很大，200MB+) |
| **Tauri** | 系统 WebView + Rust | .app (小，20MB+) |

Tauri 的核心思想：
- 前端 UI 用 Web 技术（HTML/CSS/JS）→ 渲染在系统自带 WebView 中
- 后端逻辑用 Rust 编写 → 编译为原生二进制
- 不捆绑 Chromium → 应用体积小

### Joudo Desktop 的特殊之处

Joudo 的 Desktop 不只是一个简单的 Tauri 壳。它额外打包了：
- **Node.js 运行时**（因为 Bridge 需要 Node.js 运行）
- **Bridge 编译产物**（dist/ + node_modules/）
- **Web 编译产物**（dist/）

这使得用户双击 Joudo.app 就能启动完整的 Bridge + Web，无需安装 Node.js。

---

## 核心文件详解

### src/main.ts — 桌面控制面板

这是 Tauri 窗口中显示的控制面板 UI（不是手机上的 Web UI）。

```
┌────────────────────────────────┐
│  Joudo 桌面控制面板             │
│                                │
│  Bridge 状态: ● 运行中          │
│  端口: 8787                    │
│  模式: mvp                     │
│                                │
│  [ 停止 Bridge ]  [ 重启 ]     │
│                                │
│  手机访问:                      │
│  ┌─────────┐                   │
│  │  QR Code │  ← 手机扫码访问   │
│  └─────────┘                   │
│  http://192.168.1.x:8787      │
│                                │
│  已注册仓库:                    │
│  ✓ joudo (/Users/.../joudo)    │
│  ✓ myproj (/Users/.../myproj) │
└────────────────────────────────┘
```

关键功能：
- 每 2 秒轮询 Bridge `/health` 端点检查状态
- 启动后 10 秒宽限期（等 Bridge 准备好）
- 显示 LAN IP + 端口的 QR 码（用 `qrcode` 库生成）
- 仓库列表管理

### src-tauri/src/main.rs — Rust 入口 ⭐

这是 Tauri 应用的 Rust 后端，负责系统级操作。

#### State 管理

```rust
// Bridge 进程状态
struct BridgeState {
    child: Option<Child>,          // Node.js 子进程
    port: u16,                     // 8787
    last_error: Option<String>,
}

// 运行时检测结果
struct DesktopRuntime {
    node_binary: PathBuf,          // 打包的 Node.js 二进制
    bridge_entry: PathBuf,         // Bridge 入口文件
    web_dist: PathBuf,             // Web 打包产物
    workspace_root: PathBuf,       // 工作区根目录
}

// 启动行为
struct StartupBehavior {
    show_window_on_startup: bool,  // 是否显示窗口
}
```

#### 关键函数

```rust
fn detect_desktop_runtime() -> Result<DesktopRuntime, String> {
    // 在 .app 包内查找:
    // - bundle-resources/runtime/node/node (Node.js 二进制)
    // - bundle-resources/workspace/apps/bridge/dist/index.js
    // - bundle-resources/workspace/apps/web/dist/index.html
    // 如果找不到，应用无法启动
}

fn find_monorepo_root() -> Option<PathBuf> {
    // 方式 1: 环境变量 JOUDO_WORKSPACE_ROOT
    // 方式 2: 从当前可执行文件位置向上遍历，找到包含 pnpm-workspace.yaml 的目录
}

fn should_show_window_on_startup() -> bool {
    // 检查 ~/Library/Application Support/{bundleId}/ 下是否有 first-launch 标记文件
    // 首次启动: 显示窗口 + 创建标记
    // 后续启动: 隐藏窗口（托盘模式）
}

fn stop_managed_bridge(state: &mut BridgeState) {
    // 发 SIGTERM 给 Node.js 子进程
    // 等待退出
}

fn app_bundle_resources_dir() -> Option<PathBuf> {
    // 从可执行文件路径推导 .app/Contents/Resources/
    // 检测是否在打包环境中运行
}
```

#### macOS 原生特性

```rust
// 使用 Objective-C 桥接 (objc2) 实现 macOS 特有功能
use objc2_app_kit::NSApplication;

fn configure_activation_policy() {
    // 设置 ActivationPolicy 为 Accessory
    // 这让应用在 Dock 中不显示图标，只有系统托盘图标
    // 类比: macOS 菜单栏应用（如 1Password Mini, Alfred）
}
```

### src-tauri/tauri.conf.json — 配置

```json
{
  "productName": "Joudo",
  "identifier": "dev.joudo.desktop",
  "version": "0.1.0",
  
  "build": {
    "beforeDevCommand": "pnpm dev",           // 开发模式启动 Vite
    "beforeBuildCommand": "pnpm build:packaging",  // 构建前执行
    "beforeBundleCommand": "pnpm prepare:bundle-runtime",  // 打包前准备运行时
    "devUrl": "http://127.0.0.1:1421",        // 开发模式 URL
    "frontendDist": "../dist"                  // 生产模式前端目录
  },
  
  "app": {
    "windows": [{
      "width": 440,
      "height": 580,
      "visible": false,      // 初始隐藏
      "resizable": true
    }]
  },
  
  "bundle": {
    "targets": "app",          // 只构建 .app（不构建 .dmg）
    "icon": ["icons/..."],
    "macOS": {
      "minimumSystemVersion": "13.0"  // 最低 macOS Ventura
    }
  }
}
```

#### beforeBuildCommand 执行顺序

```
pnpm build:packaging
  │
  ├─ pnpm --dir ../.. build  (根目录 build)
  │   ├─ typecheck
  │   ├─ web build → apps/web/dist/
  │   └─ bridge build → apps/bridge/dist/
  │
  └─ pnpm build  (desktop build)
      └─ vite build → apps/desktop/dist/
```

---

## 打包脚本详解

### prepare-bundle-runtime.mjs — 运行时准备 ⭐

**这是打包流程最关键的脚本。**

功能：将 Bridge、Web、Node.js 组装到 `bundle-resources/` 目录，Tauri 会把这个目录嵌入 .app 包。

```
执行前:
  apps/bridge/dist/          # Bridge 编译产物
  apps/web/dist/             # Web 编译产物
  node_modules/              # 所有依赖

执行后:
  src-tauri/bundle-resources/
  ├── workspace/
  │   ├── apps/bridge/
  │   │   ├── dist/index.js       # Bridge 启动入口
  │   │   └── node_modules/       # 展平的依赖
  │   │       ├── fastify/
  │   │       ├── @github/copilot/
  │   │       └── ...
  │   └── apps/web/
  │       └── dist/
  │           └── index.html      # Web 前端
  │
  └── runtime/
      └── node/
          └── node              # Node.js 二进制 (~80MB)
```

关键步骤：

```javascript
// 1. 找到 Node.js 二进制
//    优先: JOUDO_BUNDLED_NODE_DIR / JOUDO_BUNDLED_NODE_BINARY 环境变量
//    回退: 当前 process.execPath (开发时)

// 2. 复制 Bridge dist + node_modules
//    使用 pnpm 的虚拟 store(.pnpm/)展平为标准 node_modules
//    这一步很重要: pnpm 用符号链接管理依赖, 但 .app 包内不支持

// 3. 修剪无用文件
//    - 删除 .pnpm/ 目录
//    - 删除 src/ 目录 (只保留 dist/)
//    - 删除非当前平台的预构建二进制
//      (如在 arm64 上删除 x64 的 @github/copilot 原生模块)
//      (删除非当前平台的 ripgrep 二进制)

// 4. 复制 Web dist

// 5. 验证关键文件存在
//    - bundle-resources/workspace/apps/bridge/dist/index.js
//    - bundle-resources/workspace/apps/web/dist/index.html
//    - bundle-resources/workspace/apps/bridge/node_modules/ 非空
```

#### 为什么要 "展平" pnpm 依赖？

pnpm 使用 "内容寻址存储 + 符号链接" 管理依赖（类似 Nix）：
```
node_modules/
├── .pnpm/                    # 实际文件存储
│   ├── fastify@5.2.1/
│   │   └── node_modules/
│   │       └── fastify/
│   └── yaml@2.8.2/
│       └── node_modules/
│           └── yaml/
├── fastify → .pnpm/fastify@5.2.1/.../fastify  # 符号链接
└── yaml → .pnpm/yaml@2.8.2/.../yaml           # 符号链接
```

macOS .app 包不支持这种符号链接结构，所以需要展平为标准目录：
```
node_modules/
├── fastify/     # 实际文件, 不是符号链接
└── yaml/        # 实际文件
```

### build-dmg.mjs — DMG 生成

```javascript
// 输入: Tauri 构建的 Joudo.app
// 输出: Joudo_0.1.0_{arch}.dmg

// 步骤:
// 1. 确认 Joudo.app 存在
// 2. 确定架构 (JOUDO_DMG_ARCH 环境变量或 process.arch)
// 3. 调用 hdiutil:
//    hdiutil create -volname Joudo \
//      -srcfolder Joudo.app \
//      -format UDZO \
//      -o Joudo_0.1.0_arm64.dmg
```

`hdiutil` 是 macOS 自带的磁盘镜像工具。`UDZO` 格式是压缩的只读 DMG。

### validate-packaged-runtime.mjs — 打包验证

CI 中使用，验证打包后的 .app 能正常工作。

```javascript
// 流程:
// 1. 找到 Joudo.app 内的 Bridge 入口
// 2. 直接 spawn Node 进程执行 Bridge (不用 open -n)
//    - CI 中 open -n 可能因为 Gatekeeper 等原因失败
// 3. 等待 Bridge 启动 (最长 30 秒)
// 4. 健康检查: GET /health
// 5. TOTP 验证:
//    - 读取 ~/.joudo/totp-secret
//    - 自己实现 Base32 解码 + TOTP 生成
//    - POST /api/auth/totp → 获取 token
// 6. 会话检查: GET /api/session (带 token)
// 7. 通过 → 退出 0
//    失败 → 退出 1

// 为什么自己实现 TOTP？
// 验证脚本运行在极简环境中,不能依赖 Bridge 的内部模块
// 所以重新实现了 Base32 解码 + HMAC-SHA1 + TOTP 生成
```

---

## 构建流程全景

```
开发模式:
  pnpm dev:desktop
    │
    ├─ Vite dev server (port 1421) → 桌面控制面板
    ├─ tauri dev → 启动 Tauri 窗口 (连接 Vite)
    └─ Bridge + Web 需要单独启动 (pnpm dev)

生产构建:
  pnpm build:desktop
    │
    ├─ Step 1: pnpm build (根目录)
    │   ├─ tsc --noEmit (类型检查)
    │   ├─ vite build → apps/web/dist/
    │   └─ tsc -p tsconfig.build.json → apps/bridge/dist/
    │
    ├─ Step 2: vite build → apps/desktop/dist/
    │
    ├─ Step 3: prepare-bundle-runtime
    │   └─ 组装 bundle-resources/
    │
    └─ Step 4: tauri build --bundles app
        ├─ Rust 编译 (cargo build --release)
        └─ 打包 → src-tauri/target/release/bundle/macos/Joudo.app

DMG 构建:
  pnpm build:desktop:dmg
    │
    ├─ build:desktop (上述全部)
    └─ node scripts/build-dmg.mjs
        └─ hdiutil → Joudo_0.1.0_{arch}.dmg

打包后验证:
  pnpm validate:desktop:packaged
    └─ node scripts/validate-packaged-runtime.mjs
        └─ 启动 → 健康检查 → TOTP → 会话检查
```

---

## .app 内部结构

```
Joudo.app/
└── Contents/
    ├── MacOS/
    │   └── Joudo          # Rust 编译的主二进制（Tauri 入口）
    │
    ├── Resources/
    │   ├── workspace/
    │   │   ├── apps/bridge/dist/   # Bridge 代码
    │   │   │   └── index.js
    │   │   ├── apps/bridge/node_modules/  # 展平的依赖
    │   │   └── apps/web/dist/      # Web 前端
    │   │       └── index.html
    │   │
    │   ├── runtime/node/node       # Node.js 二进制
    │   │
    │   └── icons/                  # 应用图标
    │
    └── Info.plist                  # macOS 应用元数据
```

双击 Joudo.app 时：
1. macOS 启动 `Contents/MacOS/Joudo`（Rust 二进制）
2. Rust 调用 `detect_desktop_runtime()` 找到 Resources 中的运行时
3. 用 `runtime/node/node` 启动 `workspace/apps/bridge/dist/index.js`
4. Bridge 监听 8787 端口，同时服务 Web 前端
5. Tauri 窗口显示桌面控制面板（管理 Bridge 进程）
