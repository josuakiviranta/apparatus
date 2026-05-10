import { existsSync, readdirSync, rmSync, lstatSync } from "fs";
import { listAllRuns } from "../../lib/runs-index.js";
import { join } from "path";

/**
 * Resolve the target logsRoot for a `--resume` invocation.
 *  - resume === string: that exact runId. Error if dir is missing.
 *  - resume === true:
 *      0 runs → return null and let the engine warn-and-start-fresh path run.
 *      1 run  → auto-select.
 *      N>1    → print list + exit 1.
 */
export function resolveResumeLogsRoot(
  runsRoot: string,
  resume: true | string,
): string | null {
  if (typeof resume === "string") {
    const dir = join(runsRoot, resume);
    if (!existsSync(dir)) {
      process.stderr.write(`[apparat] --resume ${resume}: run dir not found: ${dir}\n`);
      process.exit(1);
    }
    return dir;
  }
  if (!existsSync(runsRoot)) return null;
  const entries: { name: string; path: string; mtime: number }[] = [];
  for (const name of readdirSync(runsRoot)) {
    const path = join(runsRoot, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory()) continue;
      entries.push({ name, path, mtime: st.mtimeMs });
    } catch { continue; }
  }
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].path;
  entries.sort((a, b) => b.mtime - a.mtime);
  const list = entries
    .map(e => `  ${e.name}  (${new Date(e.mtime).toISOString()})`)
    .join("\n");
  process.stderr.write(
    "[apparat] multiple runs exist for this project; pass --resume <runId> to disambiguate:\n" + list + "\n",
  );
  process.exit(1);
  return null;
}

export interface GcRetention {
  /** Keep the newest K runs per known pipelineName. Default 10. */
  perPipelineKeep: number;
  /** Keep the newest K crash-at-start dirs (no pipeline.jsonl or no pipeline-start). Default 5. */
  crashAtStartKeep: number;
}

const CRASH_BUCKET_KEY = "__crash_at_start__";

/**
 * Garbage-collect a project's runs directory by bucketing entries on
 * pipelineName (read from each run's pipeline.jsonl) and keeping the newest
 * `perPipelineKeep` per known pipeline plus the newest `crashAtStartKeep`
 * for crash-at-start dirs (no JSONL or no pipeline-start line).
 *
 * Replaces the previous flat-by-mtime `gcOldRuns(runsRoot, keep)`. The crash
 * bucket exists so a noisy crash loop cannot evict last week's only useful
 * named-pipeline run.
 */
export function gcOldRunsPerPipeline(runsRoot: string, retention: GcRetention): void {
  if (!existsSync(runsRoot)) return;
  const summaries = listAllRuns(runsRoot);

  const buckets = new Map<string, typeof summaries>();
  for (const s of summaries) {
    const key = s.pipelineName ?? CRASH_BUCKET_KEY;
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }

  for (const [key, arr] of buckets) {
    let ordered = arr;
    if (key === CRASH_BUCKET_KEY) {
      ordered = [...arr].sort((a, b) => {
        const ma = safeMtime(join(runsRoot, a.runId));
        const mb = safeMtime(join(runsRoot, b.runId));
        return mb - ma;
      });
    }
    const keep = key === CRASH_BUCKET_KEY ? retention.crashAtStartKeep : retention.perPipelineKeep;
    for (const e of ordered.slice(keep)) {
      rmSync(join(runsRoot, e.runId), { recursive: true, force: true });
    }
  }
}

function safeMtime(path: string): number {
  try { return lstatSync(path).mtimeMs; } catch { return 0; }
}
