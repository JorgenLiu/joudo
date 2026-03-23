import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ActivityCheckpointRecord, SessionCheckpointDocument } from "@joudo/shared";

const CHECKPOINT_INDEX_ROW = /^\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/;

function checkpointTitleFromFileName(fileName: string): string {
  return fileName
    .replace(/^\d+-/, "")
    .replace(/\.md$/i, "")
    .replace(/-/g, " ")
    .trim();
}

function compareCheckpointNumbers(left: ActivityCheckpointRecord, right: ActivityCheckpointRecord) {
  return right.number - left.number;
}

async function loadCheckpointsFromIndex(workspacePath: string): Promise<ActivityCheckpointRecord[]> {
  const indexPath = join(workspacePath, "checkpoints", "index.md");
  const content = await readFile(indexPath, "utf8");
  const checkpoints: ActivityCheckpointRecord[] = [];

  for (const line of content.split(/\r?\n/)) {
    const match = CHECKPOINT_INDEX_ROW.exec(line.trim());
    if (!match) {
      continue;
    }

    const checkpointNumber = Number.parseInt(match[1] ?? "", 10);
    const title = (match[2] ?? "").trim();
    const fileName = (match[3] ?? "").trim();
    if (!Number.isFinite(checkpointNumber) || !fileName || title === "Title") {
      continue;
    }

    checkpoints.push({
      number: checkpointNumber,
      title,
      fileName,
      path: `checkpoints/${fileName}`,
    });
  }

  return checkpoints.sort(compareCheckpointNumbers);
}

async function loadCheckpointsFromDirectory(workspacePath: string): Promise<ActivityCheckpointRecord[]> {
  const checkpointsDir = join(workspacePath, "checkpoints");
  const entries = await readdir(checkpointsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => {
      const match = /^(\d+)-/.exec(entry.name);
      const checkpointNumber = Number.parseInt(match?.[1] ?? "0", 10);
      return {
        number: checkpointNumber,
        title: checkpointTitleFromFileName(entry.name),
        fileName: entry.name,
        path: `checkpoints/${entry.name}`,
      } satisfies ActivityCheckpointRecord;
    })
    .filter((entry) => Number.isFinite(entry.number) && entry.number > 0)
    .sort(compareCheckpointNumbers);
}

export async function loadWorkspaceCheckpoints(workspacePath: string | null): Promise<ActivityCheckpointRecord[]> {
  if (!workspacePath) {
    return [];
  }

  try {
    const checkpoints = await loadCheckpointsFromIndex(workspacePath);
    if (checkpoints.length > 0) {
      return checkpoints;
    }
  } catch {
    // Fall back to scanning the checkpoints directory directly.
  }

  try {
    return await loadCheckpointsFromDirectory(workspacePath);
  } catch {
    return [];
  }
}

export async function readWorkspaceCheckpoint(
  workspacePath: string | null,
  checkpoint: ActivityCheckpointRecord | null,
): Promise<SessionCheckpointDocument | null> {
  if (!workspacePath || !checkpoint) {
    return null;
  }

  const content = await readFile(join(workspacePath, checkpoint.path), "utf8");
  return {
    number: checkpoint.number,
    title: checkpoint.title,
    fileName: checkpoint.fileName,
    path: checkpoint.path,
    workspacePath,
    content,
  };
}

export function summarizeCompactionContent(summaryContent: string | undefined): string | undefined {
  if (!summaryContent) {
    return undefined;
  }

  const normalized = summaryContent
    .replace(/<[^>]+>/g, " ")
    .replace(/`/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!normalized) {
    return undefined;
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}