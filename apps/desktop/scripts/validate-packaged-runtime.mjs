import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_BUNDLE = resolve("src-tauri/target/release/bundle/macos/Joudo.app");
const APP_BINARY = resolve("src-tauri/target/release/bundle/macos/Joudo.app/Contents/MacOS/joudo-desktop");
const BASE_URL = "http://127.0.0.1:8787";
const HEALTH_PATH = "/health";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function tryExec(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readCommandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch (error) {
    return error?.stdout?.toString()?.trim() || "";
  }
}

function readTextIfExists(path) {
  if (!path || !existsSync(path)) {
    return "";
  }

  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function base32ToBuffer(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = input.toUpperCase().replace(/=+$/g, "");
  let bits = "";

  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new Error(`invalid base32 char: ${char}`);
    }
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secretBase32, now = Date.now()) {
  const counter = BigInt(Math.floor(now / 1000 / 30));
  const key = base32ToBuffer(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

async function readJson(path, init) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${text}`);
  }
  return body;
}

async function waitForHealth(expectUp, timeoutMs = 30_000, processHandle = null) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}${HEALTH_PATH}`);
      if (expectUp && response.ok) {
        return await response.json();
      }
    } catch {
      if (!expectUp) {
        return null;
      }
    }

    if (!expectUp) {
      try {
        const response = await fetch(`${BASE_URL}${HEALTH_PATH}`);
        if (!response.ok) {
          return null;
        }
      } catch {
        return null;
      }
    }

    await wait(500);
  }

  if (expectUp) {
    const listener = readCommandOutput("lsof", ["-nP", "-iTCP:8787", "-sTCP:LISTEN"]);
    const processMatch = readCommandOutput("pgrep", ["-fal", APP_BINARY]);
    const stderrOutput = readTextIfExists(processHandle?.stderrPath);
    const stdoutOutput = readTextIfExists(processHandle?.stdoutPath);

    const diagnostics = [
      listener ? `listener:\n${listener}` : "",
      processMatch ? `process:\n${processMatch}` : "",
      stderrOutput ? `stderr:\n${stderrOutput}` : "",
      stdoutOutput ? `stdout:\n${stdoutOutput}` : "",
    ].filter(Boolean);

    throw new Error(
      diagnostics.length ? `bridge health check timed out\n${diagnostics.join("\n\n")}` : "bridge health check timed out",
    );
  }

  const listener = readCommandOutput("lsof", ["-nP", "-iTCP:8787", "-sTCP:LISTEN"]);
  throw new Error(listener ? `bridge did not stop listening in time\n${listener}` : "bridge did not stop listening in time");
}

function launchPackagedApp() {
  assert(existsSync(APP_BUNDLE), `packaged app bundle not found at ${APP_BUNDLE}`);
  assert(existsSync(APP_BINARY), `packaged app binary not found at ${APP_BINARY}`);

  if (process.env.GITHUB_ACTIONS === "true") {
    const logsRoot = mkdtempSync(join(tmpdir(), "joudo-packaged-launch-"));
    const stdoutPath = join(logsRoot, "stdout.log");
    const stderrPath = join(logsRoot, "stderr.log");
    const stdoutFd = openSync(stdoutPath, "a");
    const stderrFd = openSync(stderrPath, "a");
    const child = spawn(APP_BINARY, [], {
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.unref();
    closeSync(stdoutFd);
    closeSync(stderrFd);
    return { launched: true, pid: child.pid, stdoutPath, stderrPath };
  }

  execFileSync("open", ["-n", APP_BUNDLE], { stdio: "ignore" });
  return { launched: true };
}

async function stopPackagedApp(processHandle) {
  if (!processHandle) {
    return;
  }

  if (tryExec("osascript", ["-e", 'tell application "Joudo" to quit'])) {
    return;
  }

  if (processHandle.pid) {
    tryExec("kill", [String(processHandle.pid)]);
  }

  tryExec("pkill", ["-f", APP_BINARY]);
}

function createTempRepo() {
  const rootPath = mkdtempSync(join(tmpdir(), "joudo-desktop-regression-"));
  execFileSync("git", ["init", "-q", rootPath]);
  mkdirSync(join(rootPath, "src"));
  return rootPath;
}

async function run() {
  let app = null;
  let tempRepoRoot = null;
  let tempRepoId = null;

  try {
    app = launchPackagedApp();
    const healthBefore = await waitForHealth(true, 30_000, app);

    const setupBefore = await readJson("/api/auth/totp/setup");
    const rebind = await readJson("/api/auth/totp/rebind", { method: "POST" });
    assert(rebind.success, `TOTP rebind failed: ${JSON.stringify(rebind)}`);
    assert(setupBefore.secret && rebind.secret && setupBefore.secret !== rebind.secret, "TOTP secret did not rotate during rebind");

    const verify = await readJson("/api/auth/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: generateTotp(rebind.secret) }),
    });
    assert(verify.success && verify.token, `TOTP verification failed: ${JSON.stringify(verify)}`);

    const authHeaders = {
      Authorization: `Bearer ${verify.token}`,
    };

    tempRepoRoot = createTempRepo();
    await readJson("/api/repos/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: tempRepoRoot, initializePolicy: true, trusted: false }),
    });

    const repos = await readJson("/api/repos");
    const tempRepo = repos.repos.find((repo) => repo.rootPath === tempRepoRoot);
    assert(tempRepo, "temporary repo was not added to registry");
    tempRepoId = tempRepo.id;

    await readJson("/api/session/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: tempRepoId }),
    });

    const sessionAfterSelect = await readJson("/api/session");
    assert(sessionAfterSelect.repo?.id === tempRepoId, `selected repo mismatch: ${JSON.stringify(sessionAfterSelect.repo)}`);

    await readJson("/api/repo/init-policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trusted: false }),
    });

    assert(existsSync(join(tempRepoRoot, ".joudo", "repo-instructions.md")), "repo init did not create .joudo/repo-instructions.md");
    assert(existsSync(join(tempRepoRoot, ".github", "joudo-policy.yml")) || existsSync(join(tempRepoRoot, ".joudo", "policy.yml")), "repo init did not create a Joudo policy file");

    await readJson("/api/repo/sessions/clear", {
      method: "POST",
      headers: authHeaders,
    });

    const sessionsIndex = JSON.parse(readFileSync(join(tempRepoRoot, ".joudo", "sessions-index.json"), "utf8"));
    assert(Array.isArray(sessionsIndex.sessions) && sessionsIndex.sessions.length === 0, `sessions-index.json not cleared: ${JSON.stringify(sessionsIndex)}`);

    await readJson("/api/repos/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: tempRepoId }),
    });

    const reposAfterRemove = await readJson("/api/repos");
    assert(!reposAfterRemove.repos.some((repo) => repo.id === tempRepoId), "temporary repo still present after removal");

    await stopPackagedApp(app);
    await waitForHealth(false, 15_000);

    app = launchPackagedApp();
    const healthAfterRestart = await waitForHealth(true, 30_000, app);
    const setupAfterRestart = await readJson("/api/auth/totp/setup");
    assert(setupAfterRestart.secret === rebind.secret, "TOTP secret did not persist across packaged app restart");

    console.log(JSON.stringify({
      healthBefore,
      totp: {
        rotated: true,
        persistedAcrossRestart: true,
      },
      auth: {
        verified: true,
        tokenLength: verify.token.length,
      },
      repo: {
        added: true,
        selected: tempRepoId,
        initialized: true,
        historyCleared: true,
        removed: true,
      },
      restart: {
        bridgeStoppedWithApp: true,
        healthAfterRestart,
      },
    }, null, 2));
  } finally {
    if (tempRepoRoot) {
      rmSync(tempRepoRoot, { recursive: true, force: true });
    }
    await stopPackagedApp(app);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});