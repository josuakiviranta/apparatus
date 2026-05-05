// src/cli/lib/apparat-paths.ts
import { join } from "node:path";

export function apparatDir(projectRoot: string): string {
  return join(projectRoot, ".apparat");
}

export function meditationsDir(projectRoot: string): string {
  return join(apparatDir(projectRoot), "meditations");
}

export function illuminationsDir(projectRoot: string): string {
  return join(meditationsDir(projectRoot), "illuminations");
}

export function stimuliDir(projectRoot: string): string {
  return join(meditationsDir(projectRoot), "stimuli");
}

export function sessionsDir(projectRoot: string): string {
  return join(apparatDir(projectRoot), "sessions");
}

export function pipelinesDir(projectRoot: string): string {
  return join(apparatDir(projectRoot), "pipelines");
}

export function runsDir(projectRoot: string): string {
  return join(apparatDir(projectRoot), "runs");
}

export function runDir(projectRoot: string, runId: string): string {
  return join(runsDir(projectRoot), runId);
}
