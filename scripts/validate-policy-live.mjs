#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_BRIDGE_URL = process.env.JOUDO_BRIDGE_URL ?? "http://127.0.0.1:8787";
const DEFAULT_REPO_ROOT = process.env.JOUDO_VALIDATE_REPO ?? resolve(homedir(), "dev", "demo");
const DEFAULT_TIMEOUT_MS = Number(process.env.JOUDO_VALIDATE_TIMEOUT_MS ?? 60000);
const DEFAULT_INTERVAL_MS = Number(process.env.JOUDO_VALIDATE_INTERVAL_MS ?? 2000);
const WORKSPACE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_REPORT_PATH = process.env.JOUDO_VALIDATION_REPORT_PATH ?? resolve(WORKSPACE_ROOT, ".joudo", "live-policy-validation.json");
const TEMP_BRIDGE_PORT = Number(process.env.JOUDO_P0_TEMP_BRIDGE_PORT ?? 8791);

const { values } = parseArgs({
  options: {
    bridge: { type: "string" },
    repo: { type: "string" },
    repoId: { type: "string" },
    timeoutMs: { type: "string" },
    intervalMs: { type: "string" },
    reportPath: { type: "string" },
  },
});

const bridgeUrl = (values.bridge ?? DEFAULT_BRIDGE_URL).replace(/\/$/, "");
const repoRoot = resolve(values.repo ?? DEFAULT_REPO_ROOT);
const explicitRepoId = values.repoId ?? null;
const timeoutMs = Number(values.timeoutMs ?? DEFAULT_TIMEOUT_MS);
const intervalMs = Number(values.intervalMs ?? DEFAULT_INTERVAL_MS);
const reportPath = resolve(values.reportPath ?? DEFAULT_REPORT_PATH);

const scenarios = [
  {
    kind: "allow",
    label: "git diff canonicalization",
    command: "git --no-pager diff --stat",
    expectedResolution: "auto-allowed",
    expectedMatchedRule: "allow_shell: git diff",
    notes: "验证 git 子命令 canonicalization。",
    p0: ["P0-04"],
  },
  {
    kind: "allow",
    label: "python version canonicalization",
    command: "python3 -V",
    expectedResolution: "auto-allowed",
    expectedMatchedRule: "allow_shell: python3 --version",
    notes: "验证 python 版本查询的 -V 归一化。",
    p0: ["P0-04"],
  },
  {
    kind: "confirm-deny",
    label: "service startup requires approval",
    command: "uvicorn app.main:app --reload",
    expectedResolution: "user-denied",
    expectedMatchedRule: "confirm_shell: uvicorn app.main:app --reload",
    notes: "验证服务启动请求会进入网页审批，并能被用户拒绝。",
    p0: ["P0-01", "P0-04"],
    expectedApproval: {
      riskLevel: "high",
      requireFields: ["target", "scope", "impact", "denyImpact", "matchedRule"],
    },
  },
  {
    kind: "deny",
    label: "git push is auto denied",
    command: "git push origin main",
    expectedResolution: "auto-denied",
    expectedMatchedRule: "deny_shell: git push",
    notes: "验证危险 git 写操作会被直接拒绝。",
    p0: ["P0-04"],
  },
  {
    kind: "allow",
    label: "pip version canonicalization",
    command: "pip3 -V",
    expectedResolution: "auto-allowed",
    expectedMatchedRule: "allow_shell: pip3 --version",
    notes: "验证 pip 版本查询的 -V 归一化。",
    p0: ["P0-04"],
  },
  {
    kind: "read-confirm-deny",
    label: "symlink path escape requires approval",
    auditTarget: "app/joudo-live-policy-symlink/secret.txt",
    expectedResolution: "user-denied",
    expectedMatchedRule: "allowed_paths",
    notes: "验证通过 repo 内允许路径下的符号链接访问 repo 外路径时，不会被错误放行。",
    p0: ["P0-05"],
    expectedApproval: {
      riskLevel: "medium",
      requireFields: ["target", "scope", "impact", "denyImpact", "matchedRule"],
    },
    setup({ repoRoot: scenarioRepoRoot }) {
      const outsideRoot = mkdtempSync(join(tmpdir(), "joudo-live-policy-outside-"));
      const linkPath = join(scenarioRepoRoot, "app", "joudo-live-policy-symlink");
      writeFileSync(join(outsideRoot, "secret.txt"), "symlink escape probe\n", "utf8");
      rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(outsideRoot, linkPath);

      return () => {
        rmSync(linkPath, { recursive: true, force: true });
        rmSync(outsideRoot, { recursive: true, force: true });
      };
    },
    prompt: "Read exactly one file from the current repo: app/joudo-live-policy-symlink/secret.txt. Do not use shell commands. Do not read any other file. If access is denied, stop immediately.",
  },
];

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function createReport() {
  return {
    generatedAt: new Date().toISOString(),
    bridgeOrigin: bridgeUrl,
    reportPath,
    success: false,
    repo: null,
    scenarios: [],
    checks: [],
    p0Coverage: {
      "P0-01": [],
      "P0-02": [],
      "P0-03": [],
      "P0-04": [],
      "P0-05": [],
    },
  };
}

function recordCheck(report, input) {
  report.checks.push({
    label: input.label,
    p0: input.p0,
    success: input.success,
    details: input.details,
  });

  for (const p0Item of input.p0) {
    report.p0Coverage[p0Item].push({ label: input.label, success: input.success });
  }
}

function getFirstApproval(snapshot) {
  return Array.isArray(snapshot.approvals) ? snapshot.approvals[0] ?? null : null;
}

function isStaleSessionState(snapshot) {
  return typeof snapshot.summary?.body === "string" && snapshot.summary.body.includes("Session not found");
}

function normalizeTarget(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

function targetMatches(actual, expected) {
  const actualValue = normalizeTarget(actual);
  const expectedValue = normalizeTarget(expected);

  if (!actualValue || !expectedValue) {
    return false;
  }

  return actualValue === expectedValue || actualValue.endsWith(`/${expectedValue}`) || expectedValue.endsWith(`/${actualValue}`);
}

function findMatchingAudit(snapshot, startedAtMs, command) {
  const auditLog = Array.isArray(snapshot.auditLog)
    ? snapshot.auditLog.filter((entry) => Date.parse(entry.requestedAt ?? "") >= startedAtMs)
    : [];

  return [...auditLog].reverse().find((entry) => targetMatches(entry.target, command)) ?? null;
}

function formatRecentState(snapshot) {
  const recentTimeline = Array.isArray(snapshot.timeline) ? snapshot.timeline.slice(-4) : [];
  return JSON.stringify(
    {
      status: snapshot.status,
      lastPrompt: snapshot.lastPrompt,
      approvals: Array.isArray(snapshot.approvals) ? snapshot.approvals : [],
      recentTimeline,
      summary: snapshot.summary,
    },
    null,
    2,
  );
}

function getScenarioTarget(scenario) {
  return scenario.auditTarget ?? scenario.command;
}

function getScenarioPrompt(scenario) {
  return scenario.prompt ?? createPrompt(scenario.command);
}

async function denyPendingApprovals(client, reason) {
  const snapshot = await client.getSnapshot();
  const approvals = Array.isArray(snapshot.approvals) ? snapshot.approvals : [];

  if (approvals.length === 0) {
    return;
  }

  for (const approval of approvals) {
    await client.resolveApproval(approval.id, "deny");
  }

  await waitForIdleState(client, reason);
}

function createBridgeClient(baseUrl) {
  const origin = baseUrl.replace(/\/$/, "");

  async function request(path, init) {
    return fetch(`${origin}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  }

  async function requestJson(path, init) {
    const response = await request(path, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${init?.method ?? "GET"} ${path} failed with ${response.status}: ${body}`);
    }

    return response.json();
  }

  return {
    origin,
    request,
    requestJson,
    ensureHealth: async () => {
      const health = await requestJson("/health");
      if (health.status !== "ok") {
        throw new Error(`Bridge health is not ok: ${JSON.stringify(health)}`);
      }
      return health;
    },
    getRepos: async () => requestJson("/api/repos"),
    getSnapshot: async () => requestJson("/api/session"),
    getSessionIndex: async () => requestJson("/api/repo/sessions"),
    selectRepo: async (repoId) =>
      requestJson("/api/session/select", {
        method: "POST",
        body: JSON.stringify({ repoId }),
      }),
    submitPrompt: async (prompt) =>
      requestJson("/api/prompt", {
        method: "POST",
        body: JSON.stringify({ sessionId: "validate-policy-live", prompt }),
      }),
    resolveApproval: async (approvalId, decision) =>
      requestJson("/api/approval", {
        method: "POST",
        body: JSON.stringify({ approvalId, decision }),
      }),
    recoverSession: async (joudoSessionId) =>
      requestJson("/api/session/recover", {
        method: "POST",
        body: JSON.stringify({ joudoSessionId }),
      }),
  };
}

async function waitForHealth(client, label, customTimeoutMs = 30000) {
  const deadline = Date.now() + customTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await client.ensureHealth();
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(`Timed out waiting for ${label} health: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForIdleState(client, label, expectedPrompt) {
  const deadline = Date.now() + timeoutMs;
  let latestSnapshot = null;

  while (Date.now() < deadline) {
    const snapshot = await client.getSnapshot();
    latestSnapshot = snapshot;

    if (
      snapshot.status === "idle" &&
      getFirstApproval(snapshot) === null &&
      (expectedPrompt === undefined || snapshot.lastPrompt === expectedPrompt)
    ) {
      return snapshot;
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}. Latest state:\n${formatRecentState(latestSnapshot ?? {})}`);
}

function assertApprovalShape(approval, scenario) {
  const expectedApproval = scenario.expectedApproval;
  if (!expectedApproval) {
    return;
  }

  if (expectedApproval.riskLevel) {
    ensure(approval.riskLevel === expectedApproval.riskLevel, `${scenario.label} expected approval risk ${expectedApproval.riskLevel} but received ${approval.riskLevel}.`);
  }

  for (const field of expectedApproval.requireFields ?? []) {
    ensure(typeof approval[field] === "string" && approval[field].trim().length > 0, `${scenario.label} approval field ${field} is missing.`);
  }
}

async function waitForScenario(client, prompt, startedAtMs, scenario, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let latestSnapshot = null;
  const target = getScenarioTarget(scenario);

  while (Date.now() < deadline) {
    const snapshot = await client.getSnapshot();
    latestSnapshot = snapshot;
    const match = findMatchingAudit(snapshot, startedAtMs, target);
    const approval = getFirstApproval(snapshot);

    if (approval && options.ignoreApproval !== true) {
      throw new Error(`Unexpected approval requested for ${target}: ${approval.commandPreview}`);
    }

    if (match) {
      if (match.resolution !== scenario.expectedResolution) {
        throw new Error(`Scenario ${scenario.label} resolved as ${match.resolution} instead of ${scenario.expectedResolution}.`);
      }

      if (match.decision?.matchedRule !== scenario.expectedMatchedRule) {
        throw new Error(
          `Scenario ${scenario.label} matched ${match.decision?.matchedRule ?? "<none>"} instead of ${scenario.expectedMatchedRule}.`,
        );
      }

      const idleSnapshot = await waitForIdleState(client, `completion of ${scenario.label}`, prompt);
      return { snapshot: idleSnapshot, match };
    }

    if (snapshot.status === "idle" && snapshot.lastPrompt === prompt) {
      if (isStaleSessionState(snapshot)) {
        const error = new Error(
          `Scenario ${scenario.label} hit a stale ACP session and can be retried after bridge recovery. Recent state:\n${formatRecentState(snapshot)}`,
        );
        error.retryable = true;
        throw error;
      }

      throw new Error(`Scenario ${scenario.label} finished without a matching audit entry. Recent state:\n${formatRecentState(snapshot)}`);
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for ${scenario.label}. Latest state:\n${formatRecentState(latestSnapshot ?? {})}`);
}

async function waitForApprovalScenario(client, prompt, startedAtMs, scenario) {
  const deadline = Date.now() + timeoutMs;
  let latestSnapshot = null;
  const target = getScenarioTarget(scenario);

  while (Date.now() < deadline) {
    const snapshot = await client.getSnapshot();
    latestSnapshot = snapshot;
    const match = findMatchingAudit(snapshot, startedAtMs, target);
    const approval = getFirstApproval(snapshot);

    if (approval && targetMatches(approval.commandPreview, target)) {
      if (!match) {
        await delay(intervalMs);
        continue;
      }

      if (match.resolution !== "awaiting-user") {
        throw new Error(`Scenario ${scenario.label} reached approval with ${match.resolution} instead of awaiting-user.`);
      }

      if (match.decision?.matchedRule !== scenario.expectedMatchedRule) {
        throw new Error(
          `Scenario ${scenario.label} matched ${match.decision?.matchedRule ?? "<none>"} instead of ${scenario.expectedMatchedRule}.`,
        );
      }

      ensure(snapshot.status === "awaiting-approval", `${scenario.label} should place the snapshot into awaiting-approval.`);
      assertApprovalShape(approval, scenario);
      return { approval, match, snapshot };
    }

    if (match && match.resolution !== "awaiting-user") {
      throw new Error(`Scenario ${scenario.label} resolved as ${match.resolution} before entering approval.`);
    }

    if (snapshot.status === "idle" && snapshot.lastPrompt === prompt) {
      if (isStaleSessionState(snapshot)) {
        const error = new Error(
          `Scenario ${scenario.label} hit a stale ACP session and can be retried after bridge recovery. Recent state:\n${formatRecentState(snapshot)}`,
        );
        error.retryable = true;
        throw error;
      }

      throw new Error(`Scenario ${scenario.label} finished without entering approval. Recent state:\n${formatRecentState(snapshot)}`);
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for approval in ${scenario.label}. Latest state:\n${formatRecentState(latestSnapshot ?? {})}`);
}

function createPrompt(command) {
  return `Run exactly one command in the current repo: ${command}. Do not run any other shell commands. Do not modify files.`;
}

async function expectStructuredError(client, input) {
  const response = await client.request(input.path, input.init);
  const payload = await response.json();

  ensure(!response.ok, `${input.label} unexpectedly succeeded.`);
  ensure(payload?.error?.code === input.expectedCode, `${input.label} returned ${payload?.error?.code ?? "<none>"} instead of ${input.expectedCode}.`);
  ensure(typeof payload?.error?.message === "string" && payload.error.message.length > 0, `${input.label} returned an empty error message.`);
  ensure(typeof payload?.error?.nextAction === "string" && payload.error.nextAction.length > 0, `${input.label} returned an empty nextAction.`);
  ensure(typeof payload?.error?.retryable === "boolean", `${input.label} returned a malformed retryable field.`);

  return payload.error;
}

async function runLiveScenarios(client, repo, report) {
  await client.selectRepo(repo.id);
  await denyPendingApprovals(client, "clearing stale approvals before live regression");
  await waitForIdleState(client, "the selected repo session to be idle");

  for (const scenario of scenarios) {
    const cleanup = scenario.setup ? scenario.setup({ repoRoot: repo.rootPath }) : null;

    try {
      await denyPendingApprovals(client, `clearing stale approvals before ${scenario.label}`);
      await waitForIdleState(client, `the bridge to be idle before ${scenario.label}`);
      let completed = false;
      let attempts = 0;

      for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
        attempts = attempt;
        const prompt = getScenarioPrompt(scenario);
        const startedAtMs = Date.now();
        const target = getScenarioTarget(scenario);

        console.log(`\n[run] ${scenario.label}`);
        console.log(`target: ${target}`);
        if (attempt > 1) {
          console.log(`retry: attempt ${attempt} after stale session recovery`);
        }

        await client.submitPrompt(prompt);

        try {
          let snapshot;
          let match;

          if (scenario.kind === "confirm-deny" || scenario.kind === "read-confirm-deny") {
            const pending = await waitForApprovalScenario(client, prompt, startedAtMs, scenario);
            recordCheck(report, {
              label: `${scenario.label}: approval metadata is present`,
              p0: scenario.p0,
              success: true,
              details: {
                riskLevel: pending.approval.riskLevel,
                matchedRule: pending.approval.matchedRule ?? null,
                approvalsCount: Array.isArray(pending.snapshot.approvals) ? pending.snapshot.approvals.length : 0,
                status: pending.snapshot.status,
              },
            });
            await client.resolveApproval(pending.approval.id, "deny");
            const resolved = await waitForScenario(client, prompt, startedAtMs, scenario, { ignoreApproval: true });
            snapshot = resolved.snapshot;
            match = resolved.match;
          } else {
            const resolved = await waitForScenario(client, prompt, startedAtMs, scenario);
            snapshot = resolved.snapshot;
            match = resolved.match;
          }

          console.log(`result: ${match.resolution}`);
          console.log(`rule: ${match.decision.matchedRule}`);
          console.log(`summary: ${snapshot.summary?.title ?? "<none>"}`);
          report.scenarios.push({
            label: scenario.label,
            command: target,
            expectedResolution: scenario.expectedResolution,
            expectedMatchedRule: scenario.expectedMatchedRule,
            success: true,
            actualResolution: match.resolution,
            actualMatchedRule: match.decision?.matchedRule,
            attempts,
            notes: scenario.notes,
          });
          completed = true;
        } catch (error) {
          if (attempt < 2 && error?.retryable === true) {
            await waitForIdleState(client, `bridge recovery after stale session in ${scenario.label}`);
            continue;
          }

          report.scenarios.push({
            label: scenario.label,
            command: target,
            expectedResolution: scenario.expectedResolution,
            expectedMatchedRule: scenario.expectedMatchedRule,
            success: false,
            attempts,
            notes: `${scenario.notes} ${error instanceof Error ? error.message : String(error)}`,
          });
          throw error;
        }
      }
    } finally {
      cleanup?.();
    }
  }
}

async function runStructuredErrorChecks(client, report) {
  const invalidRepoError = await expectStructuredError(client, {
    label: "invalid repo selection returns a structured validation error",
    path: "/api/session/select",
    init: {
      method: "POST",
      body: JSON.stringify({ repoId: "missing-repo" }),
    },
    expectedCode: "validation",
  });
  recordCheck(report, {
    label: "structured validation error from invalid repo selection",
    p0: ["P0-03"],
    success: true,
    details: invalidRepoError,
  });

  const emptyPromptError = await expectStructuredError(client, {
    label: "empty prompt returns a structured validation error",
    path: "/api/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({ sessionId: "validate-policy-live", prompt: "   " }),
    },
    expectedCode: "validation",
  });
  recordCheck(report, {
    label: "structured validation error from empty prompt",
    p0: ["P0-03"],
    success: true,
    details: emptyPromptError,
  });

  const recoveryError = await expectStructuredError(client, {
    label: "missing history record returns a structured recovery error",
    path: "/api/session/recover",
    init: {
      method: "POST",
      body: JSON.stringify({ joudoSessionId: "missing-history-session" }),
    },
    expectedCode: "recovery",
  });
  recordCheck(report, {
    label: "structured recovery error from missing historical session",
    p0: ["P0-03"],
    success: true,
    details: recoveryError,
  });

  const approvalError = await expectStructuredError(client, {
    label: "invalid approval id returns a structured approval error",
    path: "/api/approval",
    init: {
      method: "POST",
      body: JSON.stringify({ approvalId: "missing-approval", decision: "deny" }),
    },
    expectedCode: "approval",
  });
  recordCheck(report, {
    label: "structured approval error from stale approval id",
    p0: ["P0-03"],
    success: true,
    details: approvalError,
  });
}

async function runAttachRecoveryCheck(client, report) {
  const sessionIndex = await client.getSessionIndex();
  ensure(sessionIndex && Array.isArray(sessionIndex.sessions), "Session index is unavailable after live scenarios.");
  const attachEntry = sessionIndex.sessions.find((entry) => entry.recoveryMode === "attach" && entry.canAttemptResume);
  ensure(attachEntry, "No attach-capable historical session was found for recovery validation.");

  const recoveredSnapshot = await client.recoverSession(attachEntry.id);
  ensure(recoveredSnapshot.status === "idle", `Attach recovery should end in idle, received ${recoveredSnapshot.status}.`);
  ensure(
    Array.isArray(recoveredSnapshot.timeline) && recoveredSnapshot.timeline.some((entry) => /已接管历史会话/.test(entry.title)),
    "Attach recovery did not write the expected timeline note.",
  );

  recordCheck(report, {
    label: "attach recovery reattaches a completed historical session",
    p0: ["P0-02"],
    success: true,
    details: {
      recoveredSessionId: attachEntry.id,
      recoveryMode: attachEntry.recoveryMode,
      status: recoveredSnapshot.status,
    },
  });
}

function createTimedOutSnapshotDocument(repoDescriptor, sessionId, createdAt) {
  const updatedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    sessionId,
    createdAt,
    lastKnownCopilotSessionId: null,
    snapshot: {
      sessionId: "persisted-session",
      status: "timed-out",
      repo: repoDescriptor,
      model: "gpt-5-mini",
      auth: {
        status: "authenticated",
        message: "authenticated",
      },
      lastPrompt: "继续检查超时前的摘要",
      approvals: [],
      timeline: [
        {
          id: `status-${updatedAt}`,
          kind: "status",
          title: "本轮任务已超时",
          body: "上一轮任务在等待窗口内没有完成。",
          timestamp: updatedAt,
        },
      ],
      auditLog: [],
      summary: {
        title: "本轮任务已超时",
        body: "上一轮任务在等待窗口内没有完成。",
        executedCommands: [],
        changedFiles: [],
        checks: [],
        risks: [],
        nextAction: "检查当前摘要与时间线后重试。",
      },
      updatedAt,
    },
  };
}

function seedTimedOutRepo() {
  const repoRootPath = mkdtempSync(join(tmpdir(), "joudo-p0-seeded-"));
  const repoName = repoRootPath.split("/").at(-1) ?? "seeded";
  const repoDescriptor = {
    id: `${repoName}-1`,
    name: repoName,
    rootPath: repoRootPath,
    trusted: true,
    policyState: "missing",
  };
  const createdAt = new Date().toISOString();
  const sessionId = "timed-out-session";
  const snapshotDocument = createTimedOutSnapshotDocument(repoDescriptor, sessionId, createdAt);
  const sessionIndex = {
    schemaVersion: 1,
    repoId: repoDescriptor.id,
    repoPath: repoRootPath,
    currentSessionId: null,
    updatedAt: snapshotDocument.snapshot.updatedAt,
    sessions: [
      {
        id: sessionId,
        title: "本轮任务已超时",
        createdAt,
        updatedAt: snapshotDocument.snapshot.updatedAt,
        status: "timed-out",
        canAttemptResume: false,
        recoveryMode: "history-only",
        turnCount: 1,
        lastPromptPreview: snapshotDocument.snapshot.lastPrompt,
        summaryTitle: snapshotDocument.snapshot.summary.title,
        summaryPreview: snapshotDocument.snapshot.summary.body,
        hasPendingApprovals: false,
        lastKnownCopilotSessionId: null,
      },
    ],
  };

  mkdirSync(join(repoRootPath, "src"), { recursive: true });
  mkdirSync(join(repoRootPath, ".joudo", "sessions", sessionId), { recursive: true });
  writeFileSync(join(repoRootPath, ".joudo", "sessions-index.json"), `${JSON.stringify(sessionIndex, null, 2)}\n`, "utf8");
  writeFileSync(join(repoRootPath, ".joudo", "sessions", sessionId, "snapshot.json"), `${JSON.stringify(snapshotDocument, null, 2)}\n`, "utf8");

  return { repoRootPath, sessionId };
}

async function spawnTempBridge(repoRootPath) {
  const child = spawn("corepack", ["pnpm", "--filter", "@joudo/bridge", "dev"], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(TEMP_BRIDGE_PORT),
      JOUDO_REPO_ROOT: repoRootPath,
      JOUDO_EXTRA_REPOS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  const appendLog = (chunk) => {
    logs += chunk.toString();
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  const client = createBridgeClient(`http://127.0.0.1:${TEMP_BRIDGE_PORT}`);

  try {
    await waitForHealth(client, "seeded regression bridge");
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nBridge logs:\n${logs}`);
  }

  return {
    client,
    async dispose() {
      child.kill("SIGTERM");
      await delay(500);
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    },
  };
}

async function runSeededHistoryChecks(report) {
  const seeded = seedTimedOutRepo();
  const tempBridge = await spawnTempBridge(seeded.repoRootPath);

  try {
    const snapshot = await tempBridge.client.getSnapshot();
    ensure(snapshot.status === "timed-out", `Expected startup-restored snapshot to be timed-out, received ${snapshot.status}.`);
    ensure(snapshot.lastPrompt === "继续检查超时前的摘要", "Timed-out startup restore lost the last prompt.");
    ensure(
      typeof snapshot.summary?.body === "string" && snapshot.summary.body.includes("自动载入最近一次因超时结束的历史上下文"),
      "Timed-out startup restore did not append the expected summary note.",
    );

    recordCheck(report, {
      label: "startup restore preserves timed-out state and context",
      p0: ["P0-01", "P0-02"],
      success: true,
      details: {
        status: snapshot.status,
        lastPrompt: snapshot.lastPrompt,
      },
    });

    const sessionIndex = await tempBridge.client.getSessionIndex();
    const historyOnlyEntry = sessionIndex.sessions.find((entry) => entry.id === seeded.sessionId);
    ensure(historyOnlyEntry?.recoveryMode === "history-only", "Seeded timed-out session should be history-only.");

    const recoveredSnapshot = await tempBridge.client.recoverSession(seeded.sessionId);
    ensure(recoveredSnapshot.status === "idle", `History-only recovery should end in idle, received ${recoveredSnapshot.status}.`);
    ensure(
      Array.isArray(recoveredSnapshot.timeline) && recoveredSnapshot.timeline.some((entry) => /已恢复历史上下文/.test(entry.title)),
      "History-only recovery did not write the expected timeline note.",
    );

    recordCheck(report, {
      label: "history-only recovery restores historical context with explicit messaging",
      p0: ["P0-02"],
      success: true,
      details: {
        recoveryMode: historyOnlyEntry.recoveryMode,
        status: recoveredSnapshot.status,
      },
    });
  } finally {
    await tempBridge.dispose();
    rmSync(seeded.repoRootPath, { recursive: true, force: true });
  }
}

async function findRepo(client) {
  const result = await client.getRepos();
  const repos = Array.isArray(result.repos) ? result.repos : [];

  if (explicitRepoId) {
    const repo = repos.find((candidate) => candidate.id === explicitRepoId);
    if (!repo) {
      throw new Error(`Repo id not found: ${explicitRepoId}`);
    }
    return repo;
  }

  const repo = repos.find((candidate) => candidate.rootPath === repoRoot);
  if (!repo) {
    throw new Error(`Repo root not found in bridge repo list: ${repoRoot}`);
  }

  return repo;
}

async function main() {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeoutMs: ${timeoutMs}`);
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`Invalid intervalMs: ${intervalMs}`);
  }

  const report = createReport();
  const liveClient = createBridgeClient(bridgeUrl);

  try {
    await liveClient.ensureHealth();
    const repo = await findRepo(liveClient);
    report.repo = {
      id: repo.id,
      name: repo.name,
      rootPath: repo.rootPath,
      policyState: repo.policyState,
    };

    console.log(`Bridge: ${bridgeUrl}`);
    console.log(`Repo: ${repo.name} (${repo.id})`);
    console.log(`Repo root: ${repo.rootPath}`);
    console.log(`Policy state: ${repo.policyState}`);

    await runLiveScenarios(liveClient, repo, report);
    await runAttachRecoveryCheck(liveClient, report);
    await runStructuredErrorChecks(liveClient, report);
    await runSeededHistoryChecks(report);

    for (const p0Item of Object.keys(report.p0Coverage)) {
      const coveredChecks = report.p0Coverage[p0Item];
      ensure(coveredChecks.length > 0, `${p0Item} is not covered by the regression script.`);
      ensure(coveredChecks.every((entry) => entry.success), `${p0Item} contains failing coverage checks.`);
    }

    report.success = report.scenarios.every((scenario) => scenario.success) && report.checks.every((check) => check.success);
    report.generatedAt = new Date().toISOString();
    writeReport(report);
    console.log("\nAll live policy validation scenarios passed.");
    console.log("P0 coverage: P0-01 to P0-05 all exercised by regression checks.");
  } catch (error) {
    report.generatedAt = new Date().toISOString();
    report.success = false;
    report.failureMessage = error instanceof Error ? error.message : String(error);
    writeReport(report);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});