import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { ActivityFileChangeRecord } from "@joudo/shared";

export type TurnWriteJournalEntry = {
  path: string;
  existedBefore: boolean;
  contentBase64: string | null;
};

export type TurnWriteJournal = Map<string, TurnWriteJournalEntry>;

function normalizeWritePath(repoRoot: string, fileName: string): { absolutePath: string; relativePath: string } | null {
  const absolutePath = resolve(repoRoot, fileName);
  const relativePath = relative(repoRoot, absolutePath).split("\\").join("/");
  if (!relativePath || relativePath === "." || relativePath.startsWith("../") || relativePath === "..") {
    return null;
  }

  return {
    absolutePath,
    relativePath,
  };
}

export function createTurnWriteJournal(): TurnWriteJournal {
  return new Map<string, TurnWriteJournalEntry>();
}

export function serializeTurnWriteJournal(journal: TurnWriteJournal | null): TurnWriteJournalEntry[] {
  return journal ? [...journal.values()].sort((left, right) => left.path.localeCompare(right.path)) : [];
}

export function deserializeTurnWriteJournal(entries: TurnWriteJournalEntry[] | null | undefined): TurnWriteJournal {
  const journal = createTurnWriteJournal();

  for (const entry of entries ?? []) {
    if (!entry?.path) {
      continue;
    }

    journal.set(entry.path, entry);
  }

  return journal;
}

async function captureTurnWriteBaselineForAbsolutePath(
  journal: TurnWriteJournal,
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  if (journal.has(relativePath)) {
    return;
  }

  try {
    const currentStat = await stat(absolutePath);
    if (currentStat.isDirectory()) {
      const entries = await readdir(absolutePath, { withFileTypes: true });
      for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) {
          continue;
        }

        const nextAbsolutePath = resolve(absolutePath, entry.name);
        const nextRelativePath = `${relativePath}/${entry.name}`;
        if (entry.isDirectory()) {
          await captureTurnWriteBaselineForAbsolutePath(journal, nextAbsolutePath, nextRelativePath);
          continue;
        }

        if (entry.isFile()) {
          await captureTurnWriteBaselineForAbsolutePath(journal, nextAbsolutePath, nextRelativePath);
        }
      }
      return;
    }

    if (!currentStat.isFile()) {
      return;
    }

    const fileContent = await readFile(absolutePath);
    journal.set(relativePath, {
      path: relativePath,
      existedBefore: true,
      contentBase64: fileContent.toString("base64"),
    });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    journal.set(relativePath, {
      path: relativePath,
      existedBefore: false,
      contentBase64: null,
    });
  }
}

export async function captureTurnWriteBaseline(journal: TurnWriteJournal, repoRoot: string, fileName: string | undefined): Promise<void> {
  if (!fileName) {
    return;
  }

  const normalized = normalizeWritePath(repoRoot, fileName);
  if (!normalized || journal.has(normalized.relativePath)) {
    return;
  }

  await captureTurnWriteBaselineForAbsolutePath(journal, normalized.absolutePath, normalized.relativePath);
}

export async function captureTurnWriteBaselinesForPaths(
  journal: TurnWriteJournal,
  repoRoot: string,
  candidatePaths: string[] | undefined,
): Promise<void> {
  for (const candidatePath of candidatePaths ?? []) {
    if (!candidatePath || candidatePath === ".") {
      continue;
    }

    await captureTurnWriteBaseline(journal, repoRoot, candidatePath);
  }
}

export function canRollbackWithTurnWriteJournal(
  changedFiles: ActivityFileChangeRecord[],
  journal: TurnWriteJournal | null,
): boolean {
  if (!journal || changedFiles.length === 0) {
    return false;
  }

  return changedFiles.every((changedFile) => changedFile.changeKind !== "renamed" && journal.has(changedFile.path));
}

export async function applyTurnWriteJournal(journal: TurnWriteJournal, repoRoot: string): Promise<number> {
  const entries = [...journal.values()].sort((left, right) => right.path.localeCompare(left.path));

  for (const entry of entries) {
    const absolutePath = resolve(repoRoot, entry.path);

    if (!entry.existedBefore) {
      await rm(absolutePath, { force: true, recursive: true });
      continue;
    }

    const previousStat = await stat(absolutePath).catch(() => null);
    if (previousStat?.isDirectory()) {
      await rm(absolutePath, { force: true, recursive: true });
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(entry.contentBase64 ?? "", "base64"), {
      encoding: undefined,
      flag: "w",
      mode: previousStat?.mode,
      flush: true,
    } as never);
  }

  return entries.length;
}