import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { CheckpointState } from "./types.js";

const FILENAME = "checkpoint.json";

export async function saveCheckpoint(logsRoot: string, state: CheckpointState): Promise<void> {
  const path = join(logsRoot, FILENAME);
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

export async function loadCheckpoint(logsRoot: string): Promise<CheckpointState | null> {
  const path = join(logsRoot, FILENAME);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as CheckpointState;
  } catch {
    return null;
  }
}
