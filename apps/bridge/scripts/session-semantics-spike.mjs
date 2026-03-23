import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync as writeFileSyncFs,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { CopilotClient, approveAll } from "@github/copilot-sdk";

function logStep(...args) {
  console.error("[session-semantics-spike]", ...args);
}

async function withTimeout(promise, label, timeoutMs = 60000) {
  let timeoutId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function createGitRepo(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(repo, "README.md"), "# session semantics spike\n");
  run("git", ["init"], repo);
  run("git", ["config", "user.name", "Joudo Spike"], repo);
  run("git", ["config", "user.email", "spike@example.com"], repo);
  run("git", ["add", "README.md"], repo);
  run("git", ["commit", "-m", "init"], repo);
  return repo;
}

function gitStatus(repo) {
  return run("git", ["status", "--short"], repo);
}

function fileState(repo, relativePath) {
  const absolutePath = join(repo, relativePath);
  return {
    exists: existsSync(absolutePath),
    content: existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : null,
  };
}

function countEventMentions(events, needle) {
  return events.filter((event) => JSON.stringify(event.data).includes(needle)).length;
}

function listTree(rootPath) {
  if (!rootPath || !existsSync(rootPath)) {
    return [];
  }

  const result = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const entries = readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      const relativePath = relative(rootPath, entryPath);
      result.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }

  return result.sort();
}

function readTextIfPresent(path, maxChars = 3000) {
  if (!path || !existsSync(path)) {
    return null;
  }

  if (!statSync(path).isFile()) {
    return null;
  }

  const content = readFileSync(path, "utf8");
  return content.length <= maxChars ? content : `${content.slice(0, maxChars)}\n...[truncated]`;
}

function summarizeEvents(events) {
  return {
    rewindEvents: events
      .filter((event) => event.type === "session.snapshot_rewind")
      .map((event) => event.data),
    compactionStartCount: events.filter((event) => event.type === "session.compaction_start").length,
    compactionCompleteEvents: events
      .filter((event) => event.type === "session.compaction_complete")
      .map((event) => event.data),
    commandEvents: events
      .filter((event) => event.type.startsWith("command."))
      .map((event) => ({ type: event.type, data: event.data })),
    sessionWorkspaceFileChanged: events
      .filter((event) => event.type === "session.workspace_file_changed")
      .map((event) => event.data),
    elicitationEvents: events
      .filter((event) => event.type === "elicitation.requested")
      .map((event) => event.data),
    userInputEvents: events
      .filter((event) => event.type === "user_input.requested")
      .map((event) => event.data),
  };
}

async function createSessionHarness(repo) {
  logStep("starting client", repo);
  const client = new CopilotClient({ cwd: repo, logLevel: "error" });
  await withTimeout(client.start(), "client.start");

  logStep("creating session");
  const session = await withTimeout(client.createSession({
    model: "gpt-5",
    onPermissionRequest: approveAll,
    streaming: false,
  }), "client.createSession");

  const observedEvents = [];
  const unsubscribe = session.on((event) => {
    observedEvents.push({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      data: event.data,
    });
  });

  return {
    session,
    observedEvents,
    workspacePath: session.workspacePath ?? null,
    async dispose() {
      unsubscribe();
      await withTimeout(session.disconnect(), "session.disconnect", 15000).catch(() => {});
      await withTimeout(client.stop(), "client.stop", 15000).catch(() => {});
    },
  };
}

async function seedTwoTurns(session) {
  logStep("seed turn 1");
  await withTimeout(session.sendAndWait(
    {
      prompt:
        "Create a new file named first_turn.txt in the repository root containing exactly one line: first turn. Do not modify any other file. Stop after the file is written.",
    },
    300000,
  ), "seed turn 1", 90000);

  logStep("seed turn 2");
  await withTimeout(session.sendAndWait(
    {
      prompt:
        "Create a new file named second_turn.txt in the repository root containing exactly one line: second turn. Do not modify any other file. Stop after the file is written.",
    },
    300000,
  ), "seed turn 2", 90000);
}

async function runRewindScenario() {
  const repo = createGitRepo("joudo-session-rewind-");
  const harness = await createSessionHarness(repo);

  try {
    logStep("runRewindScenario:start");
    await seedTwoTurns(harness.session);

    logStep("runRewindScenario:getMessages before");
    const historyBefore = await withTimeout(harness.session.getMessages(), "getMessages before");

    let rewindResponse = null;
    let rewindError = null;

    try {
      logStep("runRewindScenario:send /rewind");
      rewindResponse = await withTimeout(
        harness.session.sendAndWait({ prompt: "/rewind" }, 300000),
        "send /rewind",
        90000,
      );
    } catch (error) {
      rewindError = error instanceof Error ? error.message : String(error);
    }

    logStep("runRewindScenario:getMessages after");
    const historyAfter = await withTimeout(harness.session.getMessages(), "getMessages after");

    return {
      scenario: "rewind-alias",
      repo,
      workspacePath: harness.workspacePath,
      rewindMessage: rewindResponse?.data.content ?? null,
      rewindError,
      afterRewind: {
        gitStatus: gitStatus(repo),
        firstTurn: fileState(repo, "first_turn.txt"),
        secondTurn: fileState(repo, "second_turn.txt"),
      },
      history: {
        beforeLength: historyBefore.length,
        afterLength: historyAfter.length,
        beforeMentions: {
          firstTurn: countEventMentions(historyBefore, "first_turn.txt"),
          secondTurn: countEventMentions(historyBefore, "second_turn.txt"),
        },
        afterMentions: {
          firstTurn: countEventMentions(historyAfter, "first_turn.txt"),
          secondTurn: countEventMentions(historyAfter, "second_turn.txt"),
        },
      },
      events: summarizeEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

async function runCompactionScenario() {
  const repo = createGitRepo("joudo-session-compact-");
  const harness = await createSessionHarness(repo);

  try {
    logStep("runCompactionScenario:start");
    await seedTwoTurns(harness.session);

    logStep("runCompactionScenario:/session checkpoints before");
    const beforeCheckpointsResponse = await withTimeout(harness.session.sendAndWait(
      { prompt: "/session checkpoints" },
      300000,
    ), "/session checkpoints before", 90000);

    let compactionResult = null;
    let compactionError = null;

    try {
      logStep("runCompactionScenario:rpc compaction");
      compactionResult = await withTimeout(
        harness.session.rpc.compaction.compact(),
        "rpc compaction",
        90000,
      );
    } catch (error) {
      compactionError = error instanceof Error ? error.message : String(error);
    }

    logStep("runCompactionScenario:/session checkpoints after");
    const afterCheckpointsResponse = await withTimeout(harness.session.sendAndWait(
      { prompt: "/session checkpoints" },
      300000,
    ), "/session checkpoints after", 90000);

    const workspaceTree = listTree(harness.workspacePath);
    const checkpointsDir = harness.workspacePath ? join(harness.workspacePath, "checkpoints") : null;
    const checkpointFiles = checkpointsDir && existsSync(checkpointsDir)
      ? readdirSync(checkpointsDir)
          .filter((name) => name !== "index.md")
          .sort()
      : [];
    const firstCheckpointFile = checkpointFiles.length > 0
      ? join(checkpointsDir, checkpointFiles[0])
      : null;

    let checkpointInspectResponse = null;
    let checkpointInspectError = null;

    if (checkpointFiles.length > 0) {
      try {
        logStep("runCompactionScenario:/session checkpoints 1");
        checkpointInspectResponse = await withTimeout(harness.session.sendAndWait(
          { prompt: "/session checkpoints 1" },
          300000,
        ), "/session checkpoints 1", 90000);
      } catch (error) {
        checkpointInspectError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      scenario: "compaction-checkpoints",
      repo,
      workspacePath: harness.workspacePath,
      beforeCheckpointsMessage: beforeCheckpointsResponse?.data.content ?? null,
      compactionResult,
      compactionError,
      afterCheckpointsMessage: afterCheckpointsResponse?.data.content ?? null,
      checkpointInspectMessage: checkpointInspectResponse?.data.content ?? null,
      checkpointInspectError,
      workspaceArtifacts: {
        tree: workspaceTree,
        indexMd: checkpointsDir ? readTextIfPresent(join(checkpointsDir, "index.md")) : null,
        firstCheckpointFile: firstCheckpointFile ? relative(harness.workspacePath, firstCheckpointFile) : null,
        firstCheckpointContent: readTextIfPresent(firstCheckpointFile),
      },
      events: summarizeEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

const results = [];

const requestedScenario = process.argv[2] ?? "all";
const outputPath = process.argv[3] ?? null;

const runners = [
  ["rewind", runRewindScenario],
  ["compaction", runCompactionScenario],
];

for (const [name, runner] of runners) {
  if (requestedScenario !== "all" && requestedScenario !== name) {
    continue;
  }

  try {
    logStep("runner start", name);
    results.push(await runner());
  } catch (error) {
    results.push({
      scenario: name,
      fatalError: error instanceof Error ? error.message : String(error),
    });
  }
}

const rendered = JSON.stringify({ results }, null, 2);

if (outputPath) {
  writeFileSyncFs(outputPath, rendered);
}

console.log(rendered);