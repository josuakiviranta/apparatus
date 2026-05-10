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

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Canonical runId shape used by interactive runs (src/cli/commands/pipeline/run.ts)
 * and the daemon (src/daemon/runner.ts).
 *
 *   newRunId("meditate") → "meditate-<8hex>"   ← slug-prefixed (preferred)
 *   newRunId()           → "<8hex>"            ← bare back-compat (daemon path)
 *
 * Slug rule: lower-case, runs of non-alphanumeric chars collapse to "-",
 * leading/trailing dashes trimmed, capped at 40 chars. Empty slug (e.g. all
 * special chars) falls back to the bare uuid8 shape.
 */
export function newRunId(pipelineName?: string): string {
  const uuid8 = randomUUID().slice(0, 8);
  if (!pipelineName) return uuid8;
  const slug = slugify(pipelineName);
  if (slug.length === 0) return uuid8;
  return `${slug}-${uuid8}`;
}
