import { existsSync } from "fs";
import { resolve } from "path";
import * as output from "../lib/output.js";
import * as self from "./pipeline.js";
import {
  writePid,
  readPid,
  removePid,
  isPidAlive,
  ensureMeditationDirs,
  appendMeditateGitignore,
  assertApparatShape,
  ApparatShapeError,
} from "../lib/pipeline-bootstrap.js";

// ─── Command entry point ──────────────────────────────────────────────────────

export async function meditateCommand(
  projectFolder: string,
  opts: { steer?: string; variables?: Record<string, string> } = {},
): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  try {
    assertApparatShape(absPath);
  } catch (err) {
    if (err instanceof ApparatShapeError) {
      await output.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const runningPid = readPid(absPath);
  if (runningPid !== null && isPidAlive(runningPid)) {
    await output.info(`Meditation session already running (PID ${runningPid}). Skipping.`);
    process.exit(0);
  }
  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);
  writePid(absPath, process.pid);
  try {
    const steer = opts.steer ?? opts.variables?.steer ?? "";
    return await self.pipelineRunCommand("meditate", {
      project: absPath,
      variables: { steer },
    });
  } finally {
    removePid(absPath);
  }
}
