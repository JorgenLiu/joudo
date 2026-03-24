use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, Wry};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

#[cfg(target_os = "macos")]
use objc2::{AllocAnyThread, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage};
#[cfg(target_os = "macos")]
use objc2_foundation::NSData;

// ---------------------------------------------------------------------------
// Bridge state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStatus {
    running: bool,
    managed: bool,
    port: u16,
    pid: Option<u32>,
    error: Option<String>,
}

struct BridgeState {
    child: Option<Child>,
    port: u16,
    last_error: Option<String>,
}

struct Bridge(Mutex<BridgeState>);

struct StartupBehavior {
    show_window_on_startup: bool,
}

#[derive(Debug, Clone)]
struct PackagedRuntime {
    workspace_root: PathBuf,
    node_binary: PathBuf,
}

#[derive(Debug, Clone, Default)]
struct DesktopRuntime {
    packaged: Option<PackagedRuntime>,
    packaged_error: Option<String>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self(Mutex::new(BridgeState {
            child: None,
            port: 8787,
            last_error: None,
        }))
    }
}

const FIRST_LAUNCH_MARKER_FILE: &str = "first-visible-launch-complete-v3";

fn first_launch_marker_path(app: &AppHandle<Wry>) -> Option<PathBuf> {
    let home = home_dir()?;
    let bundle_id = app.config().identifier.as_str();
    Some(
        home.join("Library")
            .join("Application Support")
            .join(bundle_id)
            .join(FIRST_LAUNCH_MARKER_FILE),
    )
}

fn should_show_window_on_startup(app: &AppHandle<Wry>) -> bool {
    let Some(marker_path) = first_launch_marker_path(app) else {
        return true;
    };

    !marker_path.exists()
}

fn persist_first_launch_marker(app: &AppHandle<Wry>) {
    let Some(marker_path) = first_launch_marker_path(app) else {
        return;
    };

    if let Some(parent) = marker_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            eprintln!("failed to create first-launch marker directory: {}", error);
            return;
        }
    }

    if let Err(error) = fs::write(&marker_path, b"shown\n") {
        eprintln!("failed to persist first-launch marker: {}", error);
    }
}

fn stop_managed_bridge(bridge: &Bridge) {
    let mut state = bridge.0.lock().unwrap();
    if let Some(ref mut child) = state.child {
        let _ = child.kill();
        let _ = child.wait();
    }
    state.child = None;
}

fn app_bundle_resources_dir() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()?.to_str()? != "MacOS" {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()?.to_str()? != "Contents" {
        return None;
    }

    let resources_dir = contents_dir.join("Resources");
    resources_dir.exists().then_some(resources_dir)
}

fn detect_desktop_runtime() -> DesktopRuntime {
    let Some(resources_dir) = app_bundle_resources_dir() else {
        return DesktopRuntime::default();
    };

    let workspace_root = resources_dir.join("workspace");
    let node_binary = resources_dir.join("runtime/node/bin/node");
    let bridge_entry = workspace_root.join("apps/bridge/dist/index.js");
    let bridge_node_modules = workspace_root.join("apps/bridge/node_modules");
    let web_index = workspace_root.join("apps/web/dist/index.html");

    let mut missing = Vec::new();
    if !node_binary.exists() {
        missing.push(node_binary.display().to_string());
    }
    if !bridge_entry.exists() {
        missing.push(bridge_entry.display().to_string());
    }
    if !bridge_node_modules.exists() {
        missing.push(bridge_node_modules.display().to_string());
    }
    if !web_index.exists() {
        missing.push(web_index.display().to_string());
    }

    if !missing.is_empty() {
        return DesktopRuntime {
            packaged: None,
            packaged_error: Some(format!(
                "当前 .app 缺少受控 bridge 运行时资源，不能安全回退到宿主机 Node。请重新执行 desktop 打包，确保先运行 `pnpm prepare:bundle-runtime`。\n缺少资源:\n{}",
                missing.join("\n")
            )),
        };
    }

    DesktopRuntime {
        packaged: Some(PackagedRuntime {
            workspace_root,
            node_binary,
        }),
        packaged_error: None,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve the monorepo root from the current executable's expected location:
///   <root>/apps/desktop/src-tauri/target/…/joudo-desktop  (dev)
///   or fall back to ancestor traversal looking for pnpm-workspace.yaml.
fn find_monorepo_root() -> Option<PathBuf> {
    if let Ok(configured) = env::var("JOUDO_WORKSPACE_ROOT") {
        let configured = PathBuf::from(configured);
        if configured.join("pnpm-workspace.yaml").exists() {
            return Some(configured);
        }
    }

    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?;
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            return Some(dir.to_path_buf());
        }

        if let Some(parent) = dir.parent() {
            dir = parent;
        } else {
            break;
        }
    }

    let cwd = std::env::current_dir().ok()?;
    let mut dir = cwd.as_path();
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            return Some(dir.to_path_buf());
        }

        if let Some(parent) = dir.parent() {
            dir = parent;
        } else {
            break;
        }
    }

    None
}

fn bridge_entry(monorepo: &PathBuf) -> PathBuf {
    monorepo.join("apps/bridge/dist/index.js")
}

fn web_dist_dir(monorepo: &PathBuf) -> PathBuf {
    monorepo.join("apps/web/dist")
}

fn newest_modified(path: &Path) -> Option<SystemTime> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.is_file() {
        return metadata.modified().ok();
    }

    let mut newest = metadata.modified().ok();
    let entries = fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        if let Some(candidate) = newest_modified(&entry.path()) {
            newest = Some(match newest {
                Some(current) if current >= candidate => current,
                _ => candidate,
            });
        }
    }

    newest
}

fn is_bridge_build_stale(monorepo: &PathBuf, entry: &Path) -> bool {
    let built_at = match fs::metadata(entry).and_then(|metadata| metadata.modified()) {
        Ok(modified) => modified,
        Err(_) => return true,
    };

    let watched_paths = [
        monorepo.join("apps/bridge/src"),
        monorepo.join("apps/bridge/tsconfig.build.json"),
        monorepo.join("packages/shared/src"),
    ];

    watched_paths
        .iter()
        .filter_map(|path| newest_modified(path))
        .any(|modified| modified > built_at)
}

fn is_web_build_stale(monorepo: &PathBuf, dist_dir: &Path) -> bool {
    let index_html = dist_dir.join("index.html");
    let built_at = match fs::metadata(&index_html).and_then(|metadata| metadata.modified()) {
        Ok(modified) => modified,
        Err(_) => return true,
    };

    let watched_paths = [monorepo.join("apps/web/src"), monorepo.join("apps/web/index.html")];

    watched_paths
        .iter()
        .filter_map(|path| newest_modified(path))
        .any(|modified| modified > built_at)
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(binary);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn candidate_exists(path: PathBuf) -> Option<PathBuf> {
    path.exists().then_some(path)
}

fn user_managed_binary(binary: &str) -> Option<PathBuf> {
    let home = home_dir()?;

    let direct_candidates = [
        home.join(".local/bin").join(binary),
        home.join(".volta/bin").join(binary),
        home.join(".fnm/current/bin").join(binary),
        home.join(".asdf/shims").join(binary),
        home.join(".mise/shims").join(binary),
    ];

    if let Some(path) = direct_candidates.into_iter().find_map(candidate_exists) {
        return Some(path);
    }

    let versioned_dirs = [home.join(".local"), home.join(".nvm/versions/node")];
    for root in versioned_dirs {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };

        let mut candidates = entries
            .flatten()
            .map(|entry| entry.path().join("bin").join(binary))
            .filter(|candidate| candidate.exists())
            .collect::<Vec<_>>();
        candidates.sort();
        if let Some(path) = candidates.pop() {
            return Some(path);
        }
    }

    None
}

fn resolve_binary(binary: &str, candidates: &[&str]) -> Option<PathBuf> {
    find_in_path(binary)
        .or_else(|| user_managed_binary(binary))
        .or_else(|| {
            candidates
                .iter()
                .map(PathBuf::from)
                .find(|candidate| candidate.exists())
        })
}

fn resolve_node_binary() -> Option<PathBuf> {
    resolve_binary(
        "node",
        &[
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/opt/local/bin/node",
            "/usr/bin/node",
        ],
    )
}

fn resolve_pnpm_binary() -> Option<PathBuf> {
    resolve_binary(
        "pnpm",
        &[
            "/opt/homebrew/bin/pnpm",
            "/usr/local/bin/pnpm",
            "/opt/local/bin/pnpm",
        ],
    )
}

fn resolve_corepack_binary() -> Option<PathBuf> {
    resolve_binary(
        "corepack",
        &[
            "/opt/homebrew/bin/corepack",
            "/usr/local/bin/corepack",
            "/opt/local/bin/corepack",
        ],
    )
}

fn ensure_bridge_build(monorepo: &PathBuf) -> Result<(), String> {
    let entry = bridge_entry(monorepo);
    if !is_bridge_build_stale(monorepo, &entry) {
        return Ok(());
    }

    let output = if let Some(pnpm) = resolve_pnpm_binary() {
        Command::new(pnpm)
            .args(["--filter", "@joudo/bridge", "build"])
            .current_dir(monorepo)
            .output()
            .map_err(|error| format!("自动构建 bridge 失败: {}", error))?
    } else if let Some(corepack) = resolve_corepack_binary() {
        Command::new(corepack)
            .args(["pnpm", "--filter", "@joudo/bridge", "build"])
            .current_dir(monorepo)
            .output()
            .map_err(|error| format!("通过 corepack 自动构建 bridge 失败: {}", error))?
    } else {
        return Err(
            "Bridge 构建产物缺失或已过期，但当前环境未找到 pnpm 或 corepack。请先安装 Node.js/pnpm，或手动运行 `corepack pnpm --filter @joudo/bridge build`。".to_string(),
        );
    };

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let details = [stdout, stderr]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Err(if details.is_empty() {
        format!("自动构建 bridge 失败，退出码: {}", output.status)
    } else {
        format!("自动构建 bridge 失败，退出码: {}\n{}", output.status, details)
    })
}

fn ensure_web_build(monorepo: &PathBuf) -> Result<(), String> {
    let dist_dir = web_dist_dir(monorepo);
    if !is_web_build_stale(monorepo, &dist_dir) {
        return Ok(());
    }

    let output = if let Some(pnpm) = resolve_pnpm_binary() {
        Command::new(pnpm)
            .args(["--filter", "@joudo/web", "build"])
            .current_dir(monorepo)
            .output()
            .map_err(|error| format!("自动构建手机 Web 失败: {}", error))?
    } else if let Some(corepack) = resolve_corepack_binary() {
        Command::new(corepack)
            .args(["pnpm", "--filter", "@joudo/web", "build"])
            .current_dir(monorepo)
            .output()
            .map_err(|error| format!("通过 corepack 自动构建手机 Web 失败: {}", error))?
    } else {
        return Err(
            "手机 Web 产物缺失或已过期，但当前环境未找到 pnpm 或 corepack。请先安装 Node.js/pnpm，或手动运行 `corepack pnpm --filter @joudo/web build`。".to_string(),
        );
    };

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let details = [stdout, stderr]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Err(if details.is_empty() {
        format!("自动构建手机 Web 失败，退出码: {}", output.status)
    } else {
        format!("自动构建手机 Web 失败，退出码: {}\n{}", output.status, details)
    })
}

fn is_bridge_alive(state: &mut BridgeState) -> bool {
    if let Some(ref mut child) = state.child {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process exited
                state.child = None;
                false
            }
            Ok(None) => true,
            Err(_) => {
                state.child = None;
                false
            }
        }
    } else {
        false
    }
}

fn health_check(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    // Simple blocking TCP check — good enough for a menu-bar shell
    match std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    ) {
        Ok(_) => {
            // Try an actual HTTP request via a minimal implementation
            // For now, TCP connect success is sufficient
            drop(url);
            true
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_bridge_status(bridge: State<'_, Bridge>) -> BridgeStatus {
    let mut state = bridge.0.lock().unwrap();
    let managed = is_bridge_alive(&mut state);
    let external = !managed && health_check(state.port);
    BridgeStatus {
        running: managed || external,
        managed,
        port: state.port,
        pid: state.child.as_ref().map(|c| c.id()),
        error: if managed || external {
            None
        } else {
            state.last_error.clone()
        },
    }
}

#[tauri::command]
fn start_bridge(bridge: State<'_, Bridge>) -> BridgeStatus {
    let mut state = bridge.0.lock().unwrap();

    // Already running?
    if is_bridge_alive(&mut state) {
        return BridgeStatus {
            running: true,
            managed: true,
            port: state.port,
            pid: state.child.as_ref().map(|c| c.id()),
            error: None,
        };
    }

    // Already listening on that port? (external bridge)
    if health_check(state.port) {
        state.last_error = None;
        return BridgeStatus {
            running: true,
            managed: false,
            port: state.port,
            pid: None,
            error: None,
        };
    }

    let runtime = detect_desktop_runtime();
    if let Some(message) = runtime.packaged_error {
        state.last_error = Some(message.clone());
        return BridgeStatus {
            running: false,
            managed: false,
            port: state.port,
            pid: None,
            error: Some(message),
        };
    }

    let (workspace_root, node_binary) = if let Some(packaged) = runtime.packaged {
        (packaged.workspace_root, packaged.node_binary)
    } else {
        let monorepo = match find_monorepo_root() {
            Some(root) => root,
            None => {
                let msg = "无法定位 Joudo monorepo 根目录。".to_string();
                state.last_error = Some(msg.clone());
                return BridgeStatus {
                    running: false,
                    managed: false,
                    port: state.port,
                    pid: None,
                    error: Some(msg),
                };
            }
        };

        if let Err(message) = ensure_bridge_build(&monorepo) {
            state.last_error = Some(message.clone());
            return BridgeStatus {
                running: false,
                managed: false,
                port: state.port,
                pid: None,
                error: Some(message),
            };
        }

        if let Err(message) = ensure_web_build(&monorepo) {
            state.last_error = Some(message.clone());
            return BridgeStatus {
                running: false,
                managed: false,
                port: state.port,
                pid: None,
                error: Some(message),
            };
        }

        let node_binary = match resolve_node_binary() {
            Some(path) => path,
            None => {
                let msg = "未找到 node 可执行文件。请确认 Node.js 已安装，或把 node 放入 PATH 中。".to_string();
                state.last_error = Some(msg.clone());
                return BridgeStatus {
                    running: false,
                    managed: false,
                    port: state.port,
                    pid: None,
                    error: Some(msg),
                };
            }
        };

        (monorepo, node_binary)
    };

    let entry = bridge_entry(&workspace_root);
    if !entry.exists() {
        let msg = format!(
            "Bridge 尚未构建。请先运行 pnpm build。\n缺少文件: {}",
            entry.display()
        );
        state.last_error = Some(msg.clone());
        return BridgeStatus {
            running: false,
            managed: false,
            port: state.port,
            pid: None,
            error: Some(msg),
        };
    }

    let result = Command::new(node_binary)
        .arg(&entry)
        .env("PORT", state.port.to_string())
        .env("HOST", "0.0.0.0")
        .current_dir(&workspace_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    match result {
        Ok(mut child) => {
            // Capture stderr in background so it doesn't block
            if let Some(stderr) = child.stderr.take() {
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            eprintln!("[bridge] {}", line);
                        }
                    }
                });
            }
            if let Some(stdout) = child.stdout.take() {
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            println!("[bridge] {}", line);
                        }
                    }
                });
            }

            let pid = child.id();
            state.child = Some(child);
            state.last_error = None;

            BridgeStatus {
                running: true,
                managed: true,
                port: state.port,
                pid: Some(pid),
                error: None,
            }
        }
        Err(e) => {
            let msg = format!("启动 bridge 失败: {}", e);
            state.last_error = Some(msg.clone());
            BridgeStatus {
                running: false,
                managed: false,
                port: state.port,
                pid: None,
                error: Some(msg),
            }
        }
    }
}

#[tauri::command]
fn stop_bridge(bridge: State<'_, Bridge>) -> BridgeStatus {
    let mut state = bridge.0.lock().unwrap();
    if state.child.is_none() && health_check(state.port) {
        let msg = "当前 bridge 由外部进程提供，不能在 Joudo 桌面端直接停止。请停止外部 bridge，或先让桌面端自行启动 bridge。".to_string();
        state.last_error = Some(msg.clone());
        return BridgeStatus {
            running: true,
            managed: false,
            port: state.port,
            pid: None,
            error: Some(msg),
        };
    }

    if let Some(ref mut child) = state.child {
        let _ = child.kill();
        let _ = child.wait();
    }
    state.child = None;
    state.last_error = None;
    BridgeStatus {
        running: false,
        managed: false,
        port: state.port,
        pid: None,
        error: None,
    }
}

#[tauri::command]
fn get_lan_url(bridge: State<'_, Bridge>) -> String {
    let state = bridge.0.lock().unwrap();
    match lan_ip() {
        Some(ip) => format!("http://{}:{}", ip, state.port),
        None => format!("http://127.0.0.1:{}", state.port),
    }
}

// ---------------------------------------------------------------------------
// Bridge API proxy commands (avoids CORS issues from desktop webview)
// ---------------------------------------------------------------------------

/// GET a bridge API endpoint, return JSON body as string.
fn bridge_api_get(port: u16, path: &str) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", port, path);
    let body: String = ureq::get(&url)
        .call()
        .map_err(|e| format!("请求失败: {}", e))?
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("读取响应失败: {}", e))?;
    Ok(body)
}

/// POST a bridge API endpoint with JSON body, return JSON body as string.
fn bridge_api_post(port: u16, path: &str, json_body: &str) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{}{}", port, path);
    let body: String = ureq::post(&url)
        .header("Content-Type", "application/json")
        .send(json_body.as_bytes())
        .map_err(|e| format!("请求失败: {}", e))?
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("读取响应失败: {}", e))?;
    Ok(body)
}

#[tauri::command]
fn proxy_get_totp_setup(bridge: State<'_, Bridge>) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    bridge_api_get(port, "/api/auth/totp/setup")
}

#[tauri::command]
fn proxy_get_repos(bridge: State<'_, Bridge>) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    bridge_api_get(port, "/api/repos")
}

#[tauri::command]
fn proxy_add_repo(
    bridge: State<'_, Bridge>,
    root_path: String,
    initialize_policy: bool,
    trusted: bool,
) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    let body = serde_json::json!({
        "rootPath": root_path,
        "initializePolicy": initialize_policy,
        "trusted": trusted,
    })
    .to_string();
    bridge_api_post(port, "/api/repos/add", &body)
}

#[tauri::command]
fn proxy_remove_repo(bridge: State<'_, Bridge>, repo_id: String) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    let body = serde_json::json!({ "repoId": repo_id }).to_string();
    bridge_api_post(port, "/api/repos/remove", &body)
}

#[tauri::command]
fn proxy_get_session(bridge: State<'_, Bridge>) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    bridge_api_get(port, "/api/session")
}

#[tauri::command]
fn proxy_select_repo(bridge: State<'_, Bridge>, repo_id: String) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    let body = serde_json::json!({ "repoId": repo_id }).to_string();
    bridge_api_post(port, "/api/session/select", &body)
}

#[tauri::command]
fn proxy_set_agent(bridge: State<'_, Bridge>, agent: Option<String>) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    let body = serde_json::json!({ "agent": agent }).to_string();
    bridge_api_post(port, "/api/session/agent", &body)
}

#[tauri::command]
fn proxy_init_policy(bridge: State<'_, Bridge>, trusted: bool) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    let body = serde_json::json!({ "trusted": trusted }).to_string();
    bridge_api_post(port, "/api/repo/init-policy", &body)
}

#[tauri::command]
fn proxy_rebind_totp(bridge: State<'_, Bridge>) -> Result<String, String> {
    let port = bridge.0.lock().unwrap().port;
    bridge_api_post(port, "/api/auth/totp/rebind", "{}")
}

#[tauri::command]
fn pick_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn set_application_icon() {
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    let data = NSData::with_bytes(include_bytes!("../icons/icon.icns"));
    if let Some(app_icon) = NSImage::initWithData(NSImage::alloc(), &data) {
        unsafe { app.setApplicationIconImage(Some(&app_icon)) };
    }
}

fn show_main_window(app: &AppHandle<Wry>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
        set_application_icon();
    }

    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        if let Some(icon) = app.default_window_icon() {
            let _ = window.set_icon(icon.clone());
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

/// Get the primary LAN IP by connecting a UDP socket (no actual traffic sent).
fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .manage(Bridge::default())
        .manage(detect_desktop_runtime())
        .invoke_handler(tauri::generate_handler![
            get_bridge_status,
            start_bridge,
            stop_bridge,
            get_lan_url,
            proxy_get_totp_setup,
            proxy_get_repos,
            proxy_add_repo,
            proxy_remove_repo,
            proxy_get_session,
            proxy_select_repo,
            proxy_set_agent,
            proxy_init_policy,
            proxy_rebind_totp,
            pick_directory,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            set_application_icon();

            let show_window_on_startup = should_show_window_on_startup(&app.app_handle());
            app.manage(StartupBehavior {
                show_window_on_startup,
            });

            // Only tray-only launches should start as background-only.
            #[cfg(target_os = "macos")]
            if !show_window_on_startup {
                let _ = app.set_activation_policy(ActivationPolicy::Accessory);
            }

            // --- Tray menu ---
            let open_item = MenuItemBuilder::with_id("open", "打开 Joudo").build(app)?;
            let lan_label = match lan_ip() {
                Some(ip) => format!("手机访问: http://{}:8787", ip),
                None => "手机访问: 未检测到局域网".to_string(),
            };
            let lan_item = MenuItemBuilder::with_id("lan", &lan_label).build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open_item, &lan_item, &quit_item])
                .build()?;

            let app_handle = app.app_handle().clone();
            let tray_icon = Image::new(include_bytes!("../icons/tray-icon.rgba"), 44, 44);
            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(false)
                .tooltip("Joudo")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        show_main_window(&app_handle);
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "lan" => {
                        // Open LAN URL in the system browser for easy phone pairing
                        if let Some(ip) = lan_ip() {
                            let url = format!("http://{}:8787", ip);
                            let _ = open::that(&url);
                        }
                    }
                    "quit" => {
                        if let Some(bridge) = app.try_state::<Bridge>() {
                            stop_managed_bridge(&bridge);
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Keep non-first launches tray-only. First launch will surface on RunEvent::Ready.
            if let Some(window) = app.get_webview_window("main") {
                if !show_window_on_startup {
                    let _ = window.hide();
                }
            }

            // Auto-start bridge
            {
                let bridge = app.state::<Bridge>();
                let mut state = bridge.0.lock().unwrap();
                if !is_bridge_alive(&mut state) && !health_check(state.port) {
                    drop(state); // Release lock before calling command
                    let _ = start_bridge(app.state::<Bridge>());
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window instead of closing — keeps the tray icon alive
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                hide_main_window(&app);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Joudo desktop shell")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                if let Some(startup_behavior) = app.try_state::<StartupBehavior>() {
                    if startup_behavior.show_window_on_startup {
                        show_main_window(app);
                        persist_first_launch_marker(app);
                    }
                }
            }

            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                if let Some(bridge) = app.try_state::<Bridge>() {
                    stop_managed_bridge(&bridge);
                }
            }
        });
}
