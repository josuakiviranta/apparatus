import { existsSync, readdirSync, rmSync, lstatSync } from "fs";
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

/**
 * Garbage-collect a project's runs directory: keep the `keep` newest entries
 * by mtime, recursively remove the rest. Silently ignores non-existent roots
 * and non-directory children. Pure I/O — exported for tests.
 */
export function gcOldRuns(runsRoot: string, keep: number): void {
  if (!existsSync(runsRoot)) return;
  const entries: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(runsRoot)) {
    const path = join(runsRoot, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory()) continue;
      entries.push({ path, mtime: st.mtimeMs });
    } catch { continue; }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  for (const e of entries.slice(keep)) {
    rmSync(e.path, { recursive: true, force: true });
  }
}
