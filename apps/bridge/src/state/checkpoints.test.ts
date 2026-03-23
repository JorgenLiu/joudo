import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadWorkspaceCheckpoints, summarizeCompactionContent } from "./checkpoints.js";

test("loadWorkspaceCheckpoints prefers checkpoint index metadata when present", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "joudo-checkpoints-"));

  try {
    await mkdir(join(workspaceRoot, "checkpoints"), { recursive: true });
    await writeFile(
      join(workspaceRoot, "checkpoints", "index.md"),
      "# Checkpoint History\n\n| # | Title | File |\n|---|-------|------|\n| 1 | Create first turn | 001-create-first-turn.md |\n| 2 | Refine validation flow | 002-refine-validation-flow.md |\n",
      "utf8",
    );

    const checkpoints = await loadWorkspaceCheckpoints(workspaceRoot);

    assert.deepEqual(checkpoints, [
      {
        number: 2,
        title: "Refine validation flow",
        fileName: "002-refine-validation-flow.md",
        path: "checkpoints/002-refine-validation-flow.md",
      },
      {
        number: 1,
        title: "Create first turn",
        fileName: "001-create-first-turn.md",
        path: "checkpoints/001-create-first-turn.md",
      },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadWorkspaceCheckpoints falls back to directory scanning when the index is missing", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "joudo-checkpoints-"));

  try {
    await mkdir(join(workspaceRoot, "checkpoints"), { recursive: true });
    await writeFile(join(workspaceRoot, "checkpoints", "001-first-pass.md"), "checkpoint 1", "utf8");
    await writeFile(join(workspaceRoot, "checkpoints", "002-second-pass.md"), "checkpoint 2", "utf8");

    const checkpoints = await loadWorkspaceCheckpoints(workspaceRoot);

    assert.deepEqual(checkpoints, [
      {
        number: 2,
        title: "second pass",
        fileName: "002-second-pass.md",
        path: "checkpoints/002-second-pass.md",
      },
      {
        number: 1,
        title: "first pass",
        fileName: "001-first-pass.md",
        path: "checkpoints/001-first-pass.md",
      },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("summarizeCompactionContent extracts a short human-readable preview", () => {
  const preview = summarizeCompactionContent(`
<overview>
The user's goal was to validate the latest repo changes.
</overview>

<history>
1. Ran validation.
</history>
`);

  assert.equal(preview, "The user's goal was to validate the latest repo changes.");
});