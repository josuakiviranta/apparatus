// src/cli/lib/ralph-paths.ts
import { join } from "node:path";

export function ralphDir(projectRoot: string): string {
  return join(projectRoot, ".ralph");
}

export function meditationsDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "meditations");
}

export function illuminationsDir(projectRoot: string): string {
  return join(meditationsDir(projectRoot), "illuminations");
}

export function stimuliDir(projectRoot: string): string {
  return join(meditationsDir(projectRoot), "stimuli");
}

export function sessionsDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "sessions");
}

export function pipelinesDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "pipelines");
}

export function runsDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "runs");
}

export function runDir(projectRoot: string, runId: string): string {
  return join(runsDir(projectRoot), runId);
}
