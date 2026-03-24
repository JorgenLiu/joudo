import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";

// ---------------------------------------------------------------------------
// Joudo Desktop Control Panel
// ---------------------------------------------------------------------------

const POLL_MS = 2000;
const BRIDGE_STARTUP_GRACE_MS = 10000;

interface BridgeStatus {
  running: boolean;
  managed: boolean;
  port: number;
  pid: number | null;
  error: string | null;
}

interface RepoDescriptor {
  id: string;
  name: string;
  rootPath: string;
}

interface SessionSnapshot {
  repo?: { id: string } | null;
  policy?: { state?: string | null } | null;
  status?: string;
  agent?: string | null;
  availableAgents?: string[];
  agentCatalog?: {
    globalCount?: number;
    repoCount?: number;
    totalCount?: number;
  };
}

const brandSealMarkup = `
  <svg class="brand-seal" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" rx="160" fill="#13211E"/>
    <path d="M112 154C112 128 128 118 152 116L360 116C384 118 400 128 400 154L396 160C394 164 390 166 384 166L128 166C122 166 118 164 116 160Z" fill="#F3F0E8"/>
    <rect x="164" y="198" width="184" height="16" rx="4" fill="#F3F0E8"/>
    <rect x="180" y="150" width="22" height="226" rx="4" fill="#F3F0E8"/>
    <rect x="310" y="150" width="22" height="226" rx="4" fill="#F3F0E8"/>
    <path d="M148 392Q256 308 364 392" stroke="#B88A4A" stroke-width="20" stroke-linecap="round"/>
  </svg>
`;

const root = document.getElementById("app")!;
document.body.classList.add("app-booting");
requestAnimationFrame(() => {
  document.body.classList.add("app-ready");
});

root.innerHTML = `
  <main class="panel">
    <header class="shell-hero">
      <div class="brand-lockup">
        <div class="logo-mark" aria-hidden="true">
          ${brandSealMarkup}
        </div>
        <div class="brand-copy">
          <p class="eyebrow">Local Control Center</p>
          <h1>Joudo</h1>
        </div>
      </div>
    </header>

    <section id="bridge-card" class="card bridge-hero-card" data-state="idle">
      <div class="card-header bridge-hero-header">
        <div>
          <span class="card-title">Bridge</span>
          <h2 class="bridge-hero-title">本机执行面状态</h2>
        </div>
        <span id="bridge-badge" class="badge badge-off">已停止</span>
      </div>
      <div id="bridge-signal" class="bridge-signal bridge-signal-idle">待机，尚未连接本地 bridge。</div>
      <p id="bridge-detail" class="card-detail bridge-detail"></p>
      <div class="bridge-stat-row">
        <div class="bridge-stat">
          <span>模式</span>
          <strong id="bridge-mode">待机</strong>
        </div>
        <div class="bridge-stat">
          <span>端口</span>
          <strong id="bridge-port">8787</strong>
        </div>
        <div class="bridge-stat">
          <span>来源</span>
          <strong id="bridge-origin">本机托管</strong>
        </div>
      </div>
      <div class="card-actions">
        <button id="btn-bridge" class="btn btn-primary">启动</button>
      </div>
    </section>

    <section class="card access-card">
      <div class="card-header">
        <div>
          <span class="card-title">Access</span>
          <h2 class="section-title">手机接入与绑定</h2>
        </div>
      </div>
      <div class="access-grid">
        <section class="access-block">
          <div class="access-block-header">
            <span class="access-label">LAN 入口</span>
          </div>
          <p id="lan-url" class="card-mono">检测中…</p>
          <div class="card-actions">
            <button id="btn-copy-lan" class="btn btn-secondary">复制链接</button>
          </div>
        </section>
        <section class="access-block">
          <div class="access-block-header">
            <span class="access-label">TOTP 认证</span>
            <span id="totp-badge" class="badge badge-off">未加载</span>
          </div>
          <div id="totp-content" class="card-body">
            <p class="card-hint">等待 bridge 启动</p>
          </div>
        </section>
      </div>
    </section>

    <section class="card governance-card">
      <div class="card-header">
        <div>
          <span class="card-title">Governance</span>
          <h2 class="section-title">仓库与策略治理</h2>
        </div>
      </div>
      <div id="repo-content" class="card-body">
        <p class="card-hint">等待 bridge 启动</p>
      </div>
    </section>
  </main>
`;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const bridgeBadge = document.getElementById("bridge-badge")!;
const bridgeCard = document.getElementById("bridge-card")!;
const bridgeSignal = document.getElementById("bridge-signal")!;
const bridgeDetail = document.getElementById("bridge-detail")!;
const bridgeMode = document.getElementById("bridge-mode")!;
const bridgePort = document.getElementById("bridge-port")!;
const bridgeOrigin = document.getElementById("bridge-origin")!;
const btnBridge = document.getElementById("btn-bridge") as HTMLButtonElement;
const lanUrlEl = document.getElementById("lan-url")!;
const btnCopyLan = document.getElementById("btn-copy-lan") as HTMLButtonElement;
const totpBadge = document.getElementById("totp-badge")!;
const totpContent = document.getElementById("totp-content")!;
const repoContent = document.getElementById("repo-content")!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let bridgeRunning = false;
let totpLoaded = false;
let reposLoaded = false;
let currentLanUrl = "";
let bridgeActionInFlight = false;
let totpLoadInFlight = false;
let reposLoadInFlight = false;
let bridgeStartupGraceUntil = Date.now() + BRIDGE_STARTUP_GRACE_MS;
let pendingRepoRemovalId: string | null = null;

function setBridgeVisualState(
  state: "idle" | "starting" | "running" | "external" | "error",
  message: string,
): void {
  bridgeCard.setAttribute("data-state", state);
  btnBridge.setAttribute("data-bridge-state", state);
  bridgeSignal.className = `bridge-signal bridge-signal-${state}`;
  bridgeSignal.textContent = message;
}

// ---------------------------------------------------------------------------
// Bridge control
// ---------------------------------------------------------------------------

async function refreshBridgeStatus(force = false): Promise<void> {
  if (bridgeActionInFlight && !force) {
    return;
  }

  try {
    const s = await invoke<BridgeStatus>("get_bridge_status");
    bridgeRunning = s.running;

    if (s.running) {
      bridgeBadge.textContent = "运行中";
      bridgeBadge.className = "badge badge-on";
      bridgeMode.textContent = s.managed ? "托管中" : "外部运行";
      bridgePort.textContent = String(s.port);
      bridgeOrigin.textContent = s.managed ? "Joudo" : "外部 bridge";
      setBridgeVisualState(
        s.managed ? "running" : "external",
        s.managed ? "Joudo 正在托管本地 bridge。" : "检测到外部 bridge，当前控制面板切到只读观察模式。"
      );
      bridgeDetail.textContent = s.managed
        ? (s.pid ? `PID ${s.pid}  ·  端口 ${s.port}` : `端口 ${s.port}`)
        : `外部 bridge 正在运行  ·  端口 ${s.port}`;
      btnBridge.textContent = s.managed ? "停止" : "外部运行";
      btnBridge.className = s.managed ? "btn btn-danger" : "btn btn-secondary";
      btnBridge.disabled = !s.managed;
      // Load TOTP & repos once bridge is up
      if (!totpLoaded && !totpLoadInFlight) {
        void loadTotp();
      }
      if (!reposLoaded && !reposLoadInFlight) {
        void loadRepos();
      }
    } else {
      bridgeBadge.textContent = "已停止";
      bridgeBadge.className = "badge badge-off";
      bridgeMode.textContent = "待机";
      bridgePort.textContent = String(s.port);
      bridgeOrigin.textContent = "本机托管";
      setBridgeVisualState(
        s.error ? "error" : "idle",
        s.error ? "bridge 当前不可用，请先处理启动错误。" : "待机，点击启动后将由 Joudo 托管 bridge。"
      );
      bridgeDetail.textContent = s.error || "";
      btnBridge.textContent = "启动";
      btnBridge.className = "btn btn-primary";
      btnBridge.disabled = false;
      totpLoaded = false;
      reposLoaded = false;
      totpLoadInFlight = false;
      reposLoadInFlight = false;
      bridgeStartupGraceUntil = 0;
      totpBadge.textContent = "未加载";
      totpBadge.className = "badge badge-off";
      totpContent.innerHTML = `<p class="card-hint">等待 bridge 启动</p>`;
      repoContent.innerHTML = `<p class="card-hint">等待 bridge 启动</p>`;
    }
  } catch (e) {
    setBridgeVisualState("error", "状态读取失败，当前视图可能不是最新状态。");
    bridgeDetail.textContent = `状态获取失败: ${e}`;
  }
}

btnBridge.addEventListener("click", async () => {
  bridgeActionInFlight = true;
  btnBridge.disabled = true;
  btnBridge.textContent = bridgeRunning ? "正在停止…" : "正在启动…";
  setBridgeVisualState(
    bridgeRunning ? "starting" : "starting",
    bridgeRunning ? "正在停止本地 bridge，并回收当前执行面。" : "正在准备 bridge 运行时与本机入口，请稍候。"
  );
  bridgeDetail.textContent = bridgeRunning ? "正在停止 bridge…" : "正在准备并启动 bridge…";
  try {
    if (bridgeRunning) {
      const next = await invoke<BridgeStatus>("stop_bridge");
      if (next.error) {
        bridgeDetail.textContent = next.error;
      }
    } else {
      totpLoaded = false;
      reposLoaded = false;
      bridgeStartupGraceUntil = Date.now() + BRIDGE_STARTUP_GRACE_MS;
      totpBadge.textContent = "加载中";
      totpBadge.className = "badge badge-warn";
      totpContent.innerHTML = `<p class="card-hint">正在加载 TOTP 信息…</p>`;
      repoContent.innerHTML = `<p class="card-hint">正在加载仓库列表…</p>`;
      const next = await invoke<BridgeStatus>("start_bridge");
      if (!next.running && next.error) {
        setBridgeVisualState("error", "bridge 启动失败，请检查下方错误。" );
        bridgeDetail.textContent = next.error;
      }
    }
  } catch (e) {
    setBridgeVisualState("error", "bridge 操作失败，请检查当前运行时配置。"
    );
    bridgeDetail.textContent = `操作失败: ${e}`;
  }
  bridgeActionInFlight = false;
  btnBridge.disabled = false;
  await refreshBridgeStatus(true);
});

// ---------------------------------------------------------------------------
// LAN URL
// ---------------------------------------------------------------------------

async function refreshLanUrl(): Promise<void> {
  try {
    const url = await invoke<string>("get_lan_url");
    currentLanUrl = url;
    lanUrlEl.textContent = url;
  } catch {
    lanUrlEl.textContent = "获取失败";
  }
}

btnCopyLan.addEventListener("click", () => {
  if (currentLanUrl) {
    navigator.clipboard.writeText(currentLanUrl);
    btnCopyLan.textContent = "已复制 ✓";
    setTimeout(() => { btnCopyLan.textContent = "复制链接"; }, 1500);
  }
});

// ---------------------------------------------------------------------------
// TOTP setup (via Tauri IPC → bridge API proxy)
// ---------------------------------------------------------------------------

interface TotpSetupResponse {
  available: boolean;
  localOnly: boolean;
  alreadyPaired: boolean;
  secret?: string;
  uri?: string;
  message: string;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBridgeStartupError(error: unknown): boolean {
  const message = formatErrorMessage(error);
  return /ECONNREFUSED|Connection refused|failed to connect|请求失败|transport|os error 61|连接被拒绝/i.test(message);
}

function inBridgeStartupGracePeriod(): boolean {
  return bridgeRunning && Date.now() < bridgeStartupGraceUntil;
}

async function loadTotp(): Promise<void> {
  if (totpLoadInFlight) {
    return;
  }

  totpLoadInFlight = true;
  try {
    const raw = await invoke<string>("proxy_get_totp_setup");
    const data: TotpSetupResponse = JSON.parse(raw);
    if (!data.available || !data.secret) {
      totpBadge.textContent = "未配置";
      totpBadge.className = "badge badge-off";
      totpContent.innerHTML = `<p class="card-hint">${escapeHtml(data.message)}</p>`;
      return;
    }

    let qrMarkup = "";
    if (data.uri) {
      try {
        const qrSvg = await QRCode.toString(data.uri, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 1,
          width: 176,
          color: {
            dark: "#dff7ee",
            light: "#0000",
          },
        });
        qrMarkup = `
          <div class="totp-qr-block">
            <div class="totp-qr-frame" aria-label="TOTP QR code">${qrSvg}</div>
            <p class="card-hint">扫码或复制密钥</p>
          </div>
        `;
      } catch {
        qrMarkup = `<p class="card-hint">QR 生成失败</p>`;
      }
    }

    totpLoaded = true;
  bridgeStartupGraceUntil = 0;
    totpBadge.textContent = data.alreadyPaired ? "已配置" : "新密钥";
    totpBadge.className = "badge badge-on";
    totpContent.innerHTML = `
      <div class="totp-layout">
        ${qrMarkup}
        <div class="totp-meta">
          <div class="totp-field">
            <label>密钥</label>
            <code id="totp-secret">${escapeHtml(data.secret)}</code>
            <button id="btn-copy-secret" class="btn btn-small">复制</button>
          </div>
          <div class="totp-field totp-field-stack">
            <label>URI</label>
            <code class="totp-uri">${escapeHtml(data.uri || "")}</code>
          </div>
          <div class="card-actions">
            <button id="btn-rebind-totp" class="btn btn-secondary">重新绑定设备</button>
          </div>
          <p class="card-hint">${escapeHtml(data.message)}</p>
        </div>
      </div>
    `;
    document.getElementById("btn-copy-secret")?.addEventListener("click", () => {
      navigator.clipboard.writeText(data.secret!);
      const btn = document.getElementById("btn-copy-secret")!;
      btn.textContent = "已复制 ✓";
      setTimeout(() => { btn.textContent = "复制"; }, 1500);
    });
    document.getElementById("btn-rebind-totp")?.addEventListener("click", async () => {
      const confirmed = window.confirm("重新绑定后，现有已登录设备都需要重新输入新的 TOTP 验证码。确认继续吗？");
      if (!confirmed) {
        return;
      }

      const btn = document.getElementById("btn-rebind-totp") as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "正在生成新密钥…";
      }

      try {
        await invoke<string>("proxy_rebind_totp");
        await loadTotp();
      } catch (error) {
        totpContent.innerHTML = `<p class="card-hint">重绑失败: ${escapeHtml(String(error))}</p>`;
      }
    });
  } catch (e) {
    if (inBridgeStartupGracePeriod() && isBridgeStartupError(e)) {
      totpBadge.textContent = "加载中";
      totpBadge.className = "badge badge-warn";
      totpContent.innerHTML = `<p class="card-hint">正在加载 TOTP 信息…</p>`;
      return;
    }

    totpBadge.textContent = "加载失败";
    totpBadge.className = "badge badge-warn";
    totpContent.innerHTML = `<p class="card-hint">无法获取 TOTP 信息: ${escapeHtml(formatErrorMessage(e))}</p>`;
  } finally {
    totpLoadInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Repo & Policy (via Tauri IPC → bridge API proxy)
// ---------------------------------------------------------------------------

async function loadRepos(): Promise<void> {
  if (reposLoadInFlight) {
    return;
  }

  reposLoadInFlight = true;
  try {
    const raw = await invoke<string>("proxy_get_repos");
    const data: { repos: RepoDescriptor[] } = JSON.parse(raw);
    reposLoaded = true;

    // Get current session to know selected repo & policy state
    let currentRepoId: string | null = null;
    let policyState: string | null = null;
    let currentAgent: string | null = null;
    let availableAgents: string[] = [];
    let agentCatalog = { globalCount: 0, repoCount: 0, totalCount: 0 };
    let sessionStatus = "idle";
    try {
      const sessionRaw = await invoke<string>("proxy_get_session");
      const session = JSON.parse(sessionRaw) as SessionSnapshot;
      currentRepoId = session.repo?.id || null;
      policyState = session.policy?.state || null;
      currentAgent = typeof session.agent === "string" && session.agent.length > 0 ? session.agent : null;
      availableAgents = Array.isArray(session.availableAgents)
        ? session.availableAgents.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
        : [];
      agentCatalog = {
        globalCount: typeof session.agentCatalog?.globalCount === "number" ? session.agentCatalog.globalCount : 0,
        repoCount: typeof session.agentCatalog?.repoCount === "number" ? session.agentCatalog.repoCount : 0,
        totalCount: typeof session.agentCatalog?.totalCount === "number" ? session.agentCatalog.totalCount : 0,
      };
      sessionStatus = session.status || "idle";
    } catch { /* ignore */ }

    const selectedRepoId = currentRepoId && data.repos.some((repo) => repo.id === currentRepoId)
      ? currentRepoId
      : data.repos[0]?.id ?? null;

    if (pendingRepoRemovalId && !data.repos.some((repo) => repo.id === pendingRepoRemovalId)) {
      pendingRepoRemovalId = null;
    }

    if (!selectedRepoId) {
      repoContent.innerHTML = `
        <div class="repo-action-row">
          <button id="btn-add-repo" class="btn btn-secondary">添加本地目录</button>
        </div>
        <p class="card-hint">当前没有已注册仓库。</p>
        <p id="repo-msg" class="card-hint"></p>
      `;

      document.getElementById("btn-add-repo")?.addEventListener("click", async () => {
        const msgEl = document.getElementById("repo-msg")!;
        msgEl.textContent = "选择目录中…";

        try {
          const rootPath = await invoke<string | null>("pick_directory");
          if (!rootPath) {
            msgEl.textContent = "已取消添加。";
            return;
          }

          msgEl.textContent = "正在添加并初始化…";
          await invoke<string>("proxy_add_repo", {
            rootPath,
            initializePolicy: true,
            trusted: false,
          });
          msgEl.textContent = "目录已添加，Joudo policy 已初始化 ✓";
          setTimeout(() => loadRepos(), 250);
        } catch (error) {
          msgEl.textContent = `添加失败: ${error}`;
        }
      });
      return;
    }

    const options = data.repos
      .map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === selectedRepoId ? "selected" : ""}>${escapeHtml(r.name)}</option>`)
      .join("");
    const removeButtonLabel = pendingRepoRemovalId === selectedRepoId ? "再次点击确认" : "从列表移除";

    const policyBadge = policyState === "loaded"
      ? `<span class="badge badge-on">已加载</span>`
      : policyState === "missing"
        ? `<span class="badge badge-warn">缺失</span>`
        : policyState
          ? `<span class="badge badge-off">${escapeHtml(policyState)}</span>`
          : "";
    const agentLocked = sessionStatus === "running" || sessionStatus === "awaiting-approval" || sessionStatus === "recovering";
    const agentOptions = [
      `<option value="" ${currentAgent ? "" : "selected"}>默认 agent</option>`,
      ...availableAgents.map((agent) => `<option value="${escapeHtml(agent)}" ${agent === currentAgent ? "selected" : ""}>${escapeHtml(agent)}</option>`),
    ].join("");
    const agentField = availableAgents.length > 0 || currentAgent
      ? `
      <div class="repo-field">
        <label>执行 agent</label>
        <select id="agent-select" ${agentLocked ? "disabled" : ""}>${agentOptions}</select>
        <p class="card-hint">repo ${agentCatalog.repoCount} / global ${agentCatalog.globalCount}</p>
      </div>
      `
      : "";

    repoContent.innerHTML = `
      <div class="repo-action-row">
        <button id="btn-add-repo" class="btn btn-secondary">添加本地目录</button>
        <button id="btn-remove-repo" class="btn btn-small btn-danger-secondary">${removeButtonLabel}</button>
      </div>
      <div class="repo-field">
        <label>选择仓库</label>
        <select id="repo-select">${options}</select>
      </div>
      <div class="repo-policy-row">
        <span>策略状态 ${policyBadge}</span>
        <button id="btn-init-policy" class="btn btn-small">初始化策略</button>
      </div>
      ${agentField}
      <p id="repo-msg" class="card-hint"></p>
    `;

    document.getElementById("btn-add-repo")?.addEventListener("click", async () => {
      const msgEl = document.getElementById("repo-msg")!;
      msgEl.textContent = "选择目录中…";

      try {
        const rootPath = await invoke<string | null>("pick_directory");
        if (!rootPath) {
          msgEl.textContent = "已取消添加。";
          return;
        }

        msgEl.textContent = "正在添加并初始化…";
        await invoke<string>("proxy_add_repo", {
          rootPath,
          initializePolicy: true,
          trusted: false,
        });
        msgEl.textContent = "目录已添加，Joudo policy 已初始化 ✓";
        setTimeout(() => loadRepos(), 250);
      } catch (error) {
        msgEl.textContent = `添加失败: ${error}`;
      }
    });

    document.getElementById("btn-remove-repo")?.addEventListener("click", async () => {
      const selectEl = document.getElementById("repo-select") as HTMLSelectElement | null;
      const msgEl = document.getElementById("repo-msg")!;
      if (!selectEl?.value) {
        msgEl.textContent = "当前没有可移除的仓库。";
        return;
      }

      const selectedLabel = selectEl.selectedOptions[0]?.textContent ?? selectEl.value;
      if (pendingRepoRemovalId !== selectEl.value) {
        pendingRepoRemovalId = selectEl.value;
        msgEl.textContent = `将从 Joudo 当前列表移除 ${selectedLabel}。该目录中的 .joudo 和 policy 文件不会被删除。再次点击“再次点击确认”继续。`;
        void loadRepos();
        return;
      }

      pendingRepoRemovalId = null;
      msgEl.textContent = "正在移除…";
      try {
        await invoke<string>("proxy_remove_repo", { repoId: selectEl.value });
        msgEl.textContent = "已从当前列表移除 ✓";
        setTimeout(() => loadRepos(), 250);
      } catch (error) {
        msgEl.textContent = `移除失败: ${formatErrorMessage(error)}`;
      }
    });

    document.getElementById("repo-select")?.addEventListener("change", async (e) => {
      const repoId = (e.target as HTMLSelectElement).value;
      const msgEl = document.getElementById("repo-msg")!;
      pendingRepoRemovalId = null;
      msgEl.textContent = "切换仓库中…";
      try {
        await invoke<string>("proxy_select_repo", { repoId });
        msgEl.textContent = "已切换";
        setTimeout(() => loadRepos(), 500);
      } catch (err) {
        msgEl.textContent = `切换失败: ${err}`;
      }
    });

    document.getElementById("agent-select")?.addEventListener("change", async (e) => {
      const msgEl = document.getElementById("repo-msg")!;
      const agent = (e.target as HTMLSelectElement).value || null;
      msgEl.textContent = "切换 agent 中…";
      try {
        await invoke<string>("proxy_set_agent", { agent });
        msgEl.textContent = agent ? `已切换到 ${agent} ✓` : "已切回默认 agent ✓";
        setTimeout(() => loadRepos(), 250);
      } catch (err) {
        msgEl.textContent = `切换 agent 失败: ${err}`;
      }
    });

    document.getElementById("btn-init-policy")?.addEventListener("click", async () => {
      const msgEl = document.getElementById("repo-msg")!;
      msgEl.textContent = "正在初始化…";
      try {
        await invoke<string>("proxy_init_policy", { trusted: false });
        msgEl.textContent = "策略初始化完成 ✓";
        setTimeout(() => loadRepos(), 500);
      } catch (err) {
        msgEl.textContent = `初始化失败: ${err}`;
      }
    });
  } catch (e) {
    if (inBridgeStartupGracePeriod() && isBridgeStartupError(e)) {
      repoContent.innerHTML = `<p class="card-hint">正在加载仓库列表…</p>`;
      return;
    }

    repoContent.innerHTML = `<p class="card-hint">无法获取仓库列表: ${escapeHtml(formatErrorMessage(e))}</p>`;
  } finally {
    reposLoadInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Init & polling
// ---------------------------------------------------------------------------

refreshBridgeStatus(true);
refreshLanUrl();
setInterval(() => {
  void refreshBridgeStatus();
}, POLL_MS);
