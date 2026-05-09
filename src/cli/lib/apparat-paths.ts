// src/cli/lib/apparat-paths.ts
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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

/**
 * Canonical 8-char runId shape used by both interactive runs
 * (src/cli/commands/pipeline/run.ts) and the daemon (src/daemon/runner.ts).
 * One source of truth for the truncation rule.
 */
export function newRunId(): string {
  return randomUUID().slice(0, 8);
}
