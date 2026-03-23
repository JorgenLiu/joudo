import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyTurnWriteJournal,
  canRollbackWithTurnWriteJournal,
  captureTurnWriteBaseline,
  captureTurnWriteBaselinesForPaths,
  createTurnWriteJournal,
  deserializeTurnWriteJournal,
  serializeTurnWriteJournal,
} from "./turn-write-journal.js";

test("captureTurnWriteBaseline stores file content before a write and restore replays it", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-write-journal-"));
  const filePath = join(repoRoot, "src", "feature.ts");
  const journal = createTurnWriteJournal();

  try {
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(filePath, "export const value = 'before';\n", "utf8");

    await captureTurnWriteBaseline(journal, repoRoot, "src/feature.ts");
    await writeFile(filePath, "export const value = 'after';\n", "utf8");

    const restoredCount = await applyTurnWriteJournal(journal, repoRoot);

    assert.equal(restoredCount, 1);
    assert.equal(await readFile(filePath, "utf8"), "export const value = 'before';\n");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("captureTurnWriteBaseline records missing files so rollback can remove them", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-write-journal-"));
  const filePath = join(repoRoot, "src", "created.ts");
  const journal = createTurnWriteJournal();

  try {
    await mkdir(join(repoRoot, "src"), { recursive: true });

    await captureTurnWriteBaseline(journal, repoRoot, "src/created.ts");
    await writeFile(filePath, "export const created = true;\n", "utf8");

    await applyTurnWriteJournal(journal, repoRoot);

    await assert.rejects(() => readFile(filePath, "utf8"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("canRollbackWithTurnWriteJournal requires every changed file to be covered by the journal", () => {
  const journal = createTurnWriteJournal();
  journal.set("src/a.ts", {
    path: "src/a.ts",
    existedBefore: true,
    contentBase64: Buffer.from("before\n", "utf8").toString("base64"),
  });

  assert.equal(
    canRollbackWithTurnWriteJournal(
      [
        {
          path: "src/a.ts",
          changeKind: "updated",
          source: "observed",
        },
      ],
      journal,
    ),
    true,
  );

  assert.equal(
    canRollbackWithTurnWriteJournal(
      [
        {
          path: "src/a.ts",
          changeKind: "updated",
          source: "observed",
        },
        {
          path: "src/b.ts",
          changeKind: "updated",
          source: "observed",
        },
      ],
      journal,
    ),
    false,
  );
});

test("captureTurnWriteBaselinesForPaths records nested files under shell candidate directories", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "joudo-write-journal-"));
  const nestedFile = join(repoRoot, "src", "nested", "feature.ts");
  const journal = createTurnWriteJournal();

  try {
    await mkdir(join(repoRoot, "src", "nested"), { recursive: true });
    await writeFile(nestedFile, "export const value = 'before';\n", "utf8");

    await captureTurnWriteBaselinesForPaths(journal, repoRoot, ["src"]);
    await writeFile(nestedFile, "export const value = 'after';\n", "utf8");

    const restoredCount = await applyTurnWriteJournal(journal, repoRoot);

    assert.equal(restoredCount, 1);
    assert.equal(await readFile(nestedFile, "utf8"), "export const value = 'before';\n");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("serializeTurnWriteJournal round-trips journal entries", () => {
  const journal = createTurnWriteJournal();
  journal.set("src/b.ts", {
    path: "src/b.ts",
    existedBefore: false,
    contentBase64: null,
  });
  journal.set("src/a.ts", {
    path: "src/a.ts",
    existedBefore: true,
    contentBase64: Buffer.from("before\n", "utf8").toString("base64"),
  });

  const serialized = serializeTurnWriteJournal(journal);
  const restored = deserializeTurnWriteJournal(serialized);

  assert.deepEqual(serialized.map((entry) => entry.path), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(serializeTurnWriteJournal(restored), serialized);
});