import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CopilotClient, approveAll } from "@github/copilot-sdk";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function createGitRepo(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(repo, "README.md"), "# undo spike\n");
  run("git", ["init"], repo);
  run("git", ["config", "user.name", "Joudo Spike"], repo);
  run("git", ["config", "user.email", "spike@example.com"], repo);
  run("git", ["add", "README.md"], repo);
  run("git", ["commit", "-m", "init"], repo);
  return repo;
}

function createPlainDir(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(repo, "README.md"), "plain undo spike\n");
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

async function createSessionHarness(repo) {
  const client = new CopilotClient({ cwd: repo, logLevel: "error" });
  await client.start();

  const session = await client.createSession({
    model: "gpt-5",
    onPermissionRequest: approveAll,
    streaming: false,
  });

  const observedEvents = [];
  const unsubscribe = session.on((event) => {
    observedEvents.push({
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
      await session.disconnect().catch(() => {});
      await client.stop().catch(() => {});
    },
  };
}

function summarizeUndoEvents(events) {
  return {
    rewindEvents: events
      .filter((event) => event.type === "session.snapshot_rewind")
      .map((event) => event.data),
    elicitationEvents: events
      .filter((event) => event.type === "elicitation.requested")
      .map((event) => event.data),
    userInputEvents: events
      .filter((event) => event.type === "user_input.requested")
      .map((event) => event.data),
  };
}

async function runBasicUndoScenario() {
  const repo = createGitRepo("joudo-undo-basic-");
  const harness = await createSessionHarness(repo);

  try {
    const createResponse = await harness.session.sendAndWait(
      {
        prompt:
          "Create a new file named undo_probe.txt in the repository root containing exactly one line: alpha undo probe. Do not modify any other file. Stop after the file is written.",
      },
      300000,
    );

    const afterCreate = {
      gitStatus: gitStatus(repo),
      file: fileState(repo, "undo_probe.txt"),
    };

    let undoResponse = null;
    let undoError = null;

    try {
      undoResponse = await harness.session.sendAndWait({ prompt: "/undo" }, 300000);
    } catch (error) {
      undoError = error instanceof Error ? error.message : String(error);
    }

    return {
      scenario: "basic-undo",
      repo,
      workspacePath: harness.workspacePath,
      createMessage: createResponse?.data.content ?? null,
      afterCreate,
      undoMessage: undoResponse?.data.content ?? null,
      undoError,
      afterUndo: {
        gitStatus: gitStatus(repo),
        file: fileState(repo, "undo_probe.txt"),
      },
      events: summarizeUndoEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

async function runDirtyWorktreeScenario() {
  const repo = createGitRepo("joudo-undo-dirty-");
  writeFileSync(join(repo, "README.md"), "# undo spike\n\nlocal dirty change\n");
  const harness = await createSessionHarness(repo);

  try {
    const createResponse = await harness.session.sendAndWait(
      {
        prompt:
          "Create a new file named agent_change.txt in the repository root containing exactly one line: beta agent change. Do not modify any existing file. Stop after the file is written.",
      },
      300000,
    );

    let undoResponse = null;
    let undoError = null;

    try {
      undoResponse = await harness.session.sendAndWait({ prompt: "/undo" }, 300000);
    } catch (error) {
      undoError = error instanceof Error ? error.message : String(error);
    }

    return {
      scenario: "dirty-worktree",
      repo,
      workspacePath: harness.workspacePath,
      createMessage: createResponse?.data.content ?? null,
      beforeUndoStatus: gitStatus(repo),
      undoMessage: undoResponse?.data.content ?? null,
      undoError,
      afterUndo: {
        gitStatus: gitStatus(repo),
        readme: fileState(repo, "README.md"),
        agentFile: fileState(repo, "agent_change.txt"),
      },
      events: summarizeUndoEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

async function runMultiTurnScenario() {
  const repo = createGitRepo("joudo-undo-multiturn-");
  const harness = await createSessionHarness(repo);

  try {
    await harness.session.sendAndWait(
      {
        prompt:
          "Create a new file named first_turn.txt in the repository root containing exactly one line: first turn. Do not modify any other file. Stop after the file is written.",
      },
      300000,
    );

    await harness.session.sendAndWait(
      {
        prompt:
          "Create a new file named second_turn.txt in the repository root containing exactly one line: second turn. Do not modify any other file. Stop after the file is written.",
      },
      300000,
    );

    let firstUndoError = null;
    let secondUndoError = null;

    try {
      await harness.session.sendAndWait({ prompt: "/undo" }, 300000);
    } catch (error) {
      firstUndoError = error instanceof Error ? error.message : String(error);
    }

    const afterFirstUndo = {
      gitStatus: gitStatus(repo),
      firstTurn: fileState(repo, "first_turn.txt"),
      secondTurn: fileState(repo, "second_turn.txt"),
    };

    try {
      await harness.session.sendAndWait({ prompt: "/undo" }, 300000);
    } catch (error) {
      secondUndoError = error instanceof Error ? error.message : String(error);
    }

    return {
      scenario: "multi-turn",
      repo,
      workspacePath: harness.workspacePath,
      firstUndoError,
      secondUndoError,
      afterFirstUndo,
      afterSecondUndo: {
        gitStatus: gitStatus(repo),
        firstTurn: fileState(repo, "first_turn.txt"),
        secondTurn: fileState(repo, "second_turn.txt"),
      },
      historyMentions: {
        firstTurn: countEventMentions(harness.observedEvents, "first_turn.txt"),
        secondTurn: countEventMentions(harness.observedEvents, "second_turn.txt"),
      },
      events: summarizeUndoEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

async function runTrackedFileEditScenario() {
  const repo = createGitRepo("joudo-undo-edit-");
  const originalReadme = readFileSync(join(repo, "README.md"), "utf8");
  const harness = await createSessionHarness(repo);

  try {
    const editResponse = await harness.session.sendAndWait(
      {
        prompt:
          "Append exactly one line `agent appended line` to README.md. Do not modify any other file. Stop after the edit is complete.",
      },
      300000,
    );

    let undoResponse = null;
    let undoError = null;

    try {
      undoResponse = await harness.session.sendAndWait({ prompt: "/undo" }, 300000);
    } catch (error) {
      undoError = error instanceof Error ? error.message : String(error);
    }

    return {
      scenario: "tracked-file-edit",
      repo,
      workspacePath: harness.workspacePath,
      editMessage: editResponse?.data.content ?? null,
      undoMessage: undoResponse?.data.content ?? null,
      undoError,
      afterUndo: {
        gitStatus: gitStatus(repo),
        readme: fileState(repo, "README.md"),
        restoredToOriginal: readFileSync(join(repo, "README.md"), "utf8") === originalReadme,
      },
      events: summarizeUndoEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

async function runPlainDirScenario() {
  const repo = createPlainDir("joudo-undo-plain-");
  const harness = await createSessionHarness(repo);

  try {
    const createResponse = await harness.session.sendAndWait(
      {
        prompt:
          "Create a new file named plain_probe.txt in the current directory containing exactly one line: plain undo probe. Do not modify any other file. Stop after the file is written.",
      },
      300000,
    );

    let undoResponse = null;
    let undoError = null;

    try {
      undoResponse = await harness.session.sendAndWait({ prompt: "/undo" }, 300000);
    } catch (error) {
      undoError = error instanceof Error ? error.message : String(error);
    }

    return {
      scenario: "plain-dir",
      repo,
      workspacePath: harness.workspacePath,
      createMessage: createResponse?.data.content ?? null,
      undoMessage: undoResponse?.data.content ?? null,
      undoError,
      afterUndo: {
        file: fileState(repo, "plain_probe.txt"),
      },
      events: summarizeUndoEvents(harness.observedEvents),
    };
  } finally {
    await harness.dispose();
  }
}

const results = [];

for (const runner of [runBasicUndoScenario, runDirtyWorktreeScenario, runTrackedFileEditScenario, runMultiTurnScenario, runPlainDirScenario]) {
  try {
    results.push(await runner());
  } catch (error) {
    results.push({
      scenario: runner.name,
      fatalError: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ results }, null, 2));