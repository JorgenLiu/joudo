# Bridge 认证模块详解

> 本文档覆盖 `apps/bridge/src/auth/` 下的 3 个文件。
> 认证是 Joudo 的安全入口，防止局域网内其他设备未经授权控制你的 Copilot。

---

## 模块总览

```
auth/
├── index.ts          # 公共 API（重导出）
├── totp.ts           # TOTP 生成/验证（RFC 6238 标准）
└── session-token.ts  # Session Token 管理
```

### 认证架构

```
首次使用:
  Bridge 启动 → 生成 TOTP 密钥 → 保存到 ~/.joudo/totp-secret
  终端打印 QR 码 → 用手机验证器 App 扫描

每次访问:
  手机浏览器打开 Joudo Web → 输入 6 位验证码
  POST /api/auth/totp → 验证成功 → 返回 Session Token
  后续所有请求用 Bearer Token 认证
```

类比 Python：Django REST Framework 的 TokenAuthentication + django-otp。

---

## 各文件详解

### index.ts — 公共 API

纯重导出文件：

```typescript
export {
  getTotpUri,
  loadOrCreateSecret,
  printTotpQrCode,
  resetSecret,
  verifyTotp,
} from "./totp.js";

export {
  createSessionToken,
  renewSessionToken,
  revokeAllTokens,
  validateSessionToken,
} from "./session-token.js";
```

---

### totp.ts — TOTP 实现

#### 什么是 TOTP？

TOTP（Time-based One-Time Password）就是你手机上 Google Authenticator / 1Password / Authy 生成的 6 位数字验证码。

工作原理（和 Python 的 `pyotp` 库完全相同）：
```
当前时间戳（每 30 秒一个时间窗口）
  + 共享密钥（20 字节随机数）
  → HMAC-SHA1 哈希
  → 截取 6 位数字
```

#### 密钥管理

```typescript
export function loadOrCreateSecret(): { secret: string; isNew: boolean } {
  const secretPath = path.join(os.homedir(), ".joudo", "totp-secret");
  
  if (existsSync(secretPath)) {
    // 已有密钥，读取并返回
    return { secret: readFileSync(secretPath, "utf8").trim(), isNew: false };
  }
  
  // 首次启动，生成新密钥
  const secret = generateSecret();
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, secret, { mode: 0o600 });  // 仅文件所有者可读写
  return { secret, isNew: true };
}
```

`mode: 0o600` 相当于 Python 中 `os.chmod(path, 0o600)`，确保只有当前用户能读取密钥文件。

#### 密钥生成

```typescript
export function generateSecret(): string {
  // 20 字节 (160 位) 随机数
  const bytes = crypto.randomBytes(20);
  // 转为 Base32 编码（TOTP 标准要求）
  return base32Encode(bytes);
}
```

类比 Python：`pyotp.random_base32()`

#### Base32 编码

```typescript
// 自定义实现，不依赖外部库
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  // 将二进制数据按 5 位分组，映射到 A-Z2-7 字符集
  // 这是 RFC 4648 标准
}

function base32Decode(encoded: string): Buffer {
  // 逆操作
}
```

为什么自己实现？避免引入额外的加密库依赖，Base32 编码逻辑简单且不涉及安全关键路径。

#### TOTP 验证

```typescript
export function verifyTotp(secret: string, code: string): boolean {
  // 接受 ±1 个时间步长（±30 秒）
  // 即同时检查：前 30 秒、当前 30 秒、后 30 秒
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  
  for (const offset of [-1, 0, 1]) {
    const expected = generateCode(secret, timeStep + offset);
    if (timingSafeEqual(expected, code)) {
      return true;
    }
  }
  
  return false;
}
```

**时序安全比较**（`timingSafeEqual`）：防止旁路时序攻击。即使只有一个字符匹配差异，比较也消耗相同时间，攻击者不能通过测量响应时间来逐位猜测验证码。

类比 Python：`hmac.compare_digest(a, b)` 或 `secrets.compare_digest()`

**±1 时间窗口**：因为手机和服务器的时钟可能有小偏差（几秒），±1 步长（±30 秒）提供了容错空间。

#### TOTP URI 生成

```typescript
export function getTotpUri(secret: string, issuer: string): string {
  // 返回标准 otpauth:// URI
  // 手机验证器 App 通过扫描这个 URI 来添加账户
  return `otpauth://totp/${encodeURIComponent(issuer)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
```

#### QR 码打印

```typescript
export function printTotpQrCode(secret: string): void {
  const uri = getTotpUri(secret, "Joudo Bridge");
  // 使用 qrcode-terminal 库在终端打印 ASCII QR 码
  qrcode.generate(uri, { small: true });
  console.log("[Auth] Scan the QR code above with your authenticator app.");
  console.log(`[Auth] Manual entry key: ${secret}`);
}
```

首次启动时终端会显示一个 ASCII 艺术的 QR 码，用手机验证器扫描即可。

#### 重置密钥

```typescript
export function resetSecret(): { secret: string; isNew: boolean } {
  // 生成新密钥 → 覆盖写入 → 返回
  // 调用此函数后，旧的验证器绑定失效
  // 需要重新扫描 QR 码
}
```

---

### session-token.ts — Session Token 管理

#### 为什么需要 Session Token？

TOTP 验证码每 30 秒变一次，不适合做持续认证。验证 TOTP 成功后，发放一个有效期更长的 Session Token。

类比 Python：
```python
# TOTP 验证成功后
token = secrets.token_hex(32)  # 生成随机 token
redis.set(f"session:{token}", user_id, ex=8*3600)  # 存储，8 小时过期
```

#### Token 生成

```typescript
export function createSessionToken(): string {
  // 32 字节 (256 位) 随机数
  const token = crypto.randomBytes(32).toString("hex");
  
  // 存储到内存 Map，记录过期时间
  tokens.set(token, { expiresAt: Date.now() + TTL });
  
  return token;
}

const TTL = 8 * 60 * 60 * 1000;  // 8 小时
```

#### Token 验证

```typescript
export function validateSessionToken(token: string): boolean {
  const entry = tokens.get(token);
  if (!entry) return false;
  
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);  // 过期清理
    return false;
  }
  
  return true;
}
```

#### Token 续期

```typescript
export function renewSessionToken(token: string): void {
  const entry = tokens.get(token);
  if (entry) {
    entry.expiresAt = Date.now() + TTL;  // 每次有效请求都续期
  }
}
```

WebSocket 连接成功时也会续期 token，保证长时间保持连接的用户不会突然掉线。

#### 全部注销

```typescript
export function revokeAllTokens(): void {
  tokens.clear();  // 清空所有 token
}
```

用于 TOTP 重绑定场景——重新生成密钥后，所有已登录的设备都需要重新认证。

---

## 完整认证流程

```
                                    Mac (localhost)
                                    ┌─────────────────┐
                                    │ Bridge 启动      │
                                    │ 加载/生成 TOTP   │
                                    │ 打印 QR 码       │
  手机                               └────────┬────────┘
  ┌──────────────┐                            │
  │ 验证器 App   │◄──── 扫描 QR 码 ──────────┘
  │ (Google Auth │
  │  / 1Password)│
  └──────┬───────┘
         │ 显示 6 位码
         │
  ┌──────┼──────────────────────────────────────────────┐
  │ 手机浏览器                                           │
  │      │                                               │
  │      ▼                                               │
  │  输入 6 位码                                          │
  │      │                                               │
  │      ├─→ POST /api/auth/totp { code: "123456" }     │
  │      │         ▼                                     │
  │      │   verifyTotp(secret, "123456")                │
  │      │         ▼                                     │
  │      │   ✅ 成功 → createSessionToken()              │
  │      │         ▼                                     │
  │      │   返回 { token: "a1b2c3..." }                 │
  │      │                                               │
  │      ├─→ localStorage.set("joudo_auth_token", token) │
  │      │                                               │
  │      ├─→ WebSocket /ws?token=a1b2c3...               │
  │      │   (实时接收 session.snapshot 推送)              │
  │      │                                               │
  │      ├─→ GET /api/session                            │
  │      │   Header: Authorization: Bearer a1b2c3...     │
  │      │                                               │
  │      └─→ ... 后续所有 API 调用携带 Bearer Token      │
  └──────────────────────────────────────────────────────┘
```

### 安全边界

| 场景 | 行为 |
|---|---|
| 手机在同一 LAN | 需要 TOTP → Token 认证 |
| Mac 本机 localhost | 管理路由免认证（Desktop 用） |
| TOTP setup/rebind | 仅 localhost 可访问（防止手机获取密钥） |
| Token 过期 | WebSocket 返回 4001，前端清除 token，重新认证 |
| 错误的验证码 | 返回错误消息，无锁定机制（TOTP 30 秒自动换码） |
