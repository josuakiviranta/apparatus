import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDot } from "../../../attractor/core/graph.js";
import { listAllPipelines, type PipelineEntry } from "../../lib/pipeline-resolver.js";
import { runsDir } from "../../lib/apparat-paths.js";
import { listRunsForPipeline, type RunSummary } from "../../lib/runs-index.js";
import * as output from "../../lib/output.js";

export interface PipelineListOptions {
  project?: string;
  /** Layer-2 zoom: when supplied, render the named pipeline's recent-runs table. */
  name?: string;
}

const NAME_COL = 34;

export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const entries = listAllPipelines(project);

  if (opts.name !== undefined) {
    const matched = entries.find(e => e.name === opts.name);
    if (!matched) {
      process.stderr.write(`pipeline not found: ${opts.name} (apparat pipeline list to see roster)\n`);
      process.exit(1);
    }
    await renderLayer2(entries, matched, runsDir(project), opts.name);
    return;
  }

  const local = entries.filter(e => e.origin !== "bundled");
  const bundled = entries.filter(e => e.origin === "bundled");

  await output.info("Local pipelines:");
  if (local.length === 0) {
    await output.info("  (none)");
  } else {
    for (const e of local) await renderEntry(e);
  }
  await output.info("");
  await output.info("Bundled pipelines:");
  if (bundled.length === 0) {
    await output.info("  (none)");
  } else {
    for (const e of bundled) await renderEntry(e);
  }
}

async function renderLayer2(
  _all: PipelineEntry[],
  matched: PipelineEntry,
  runsRoot: string,
  name: string,
): Promise<void> {
  const matchedIsLocal = matched.origin !== "bundled";
  const ghostLine = "  (none for this name — see `apparat pipeline list` for the full roster)";

  await output.info("Local pipelines:");
  if (matchedIsLocal) {
    await renderEntry(matched);
    await renderRunsTable(listRunsForPipeline(runsRoot, name));
  } else {
    await output.info(ghostLine);
  }
  await output.info("");
  await output.info("Bundled pipelines:");
  if (!matchedIsLocal) {
    await renderEntry(matched);
    await renderRunsTable(listRunsForPipeline(runsRoot, name));
  } else {
    await output.info(ghostLine);
  }
}

async function renderRunsTable(runs: RunSummary[]): Promise<void> {
  await output.info("");
  await output.info("  recent runs:");
  if (runs.length === 0) {
    await output.info("    (none)");
    return;
  }
  for (const r of runs) {
    const glyph = r.outcome === "success" ? "✓"
      : r.outcome === "failure" ? "✗"
      : r.outcome === "in-progress" ? "…"
      : "·"; // crashed
    const ts = r.startedAt ?? "(unknown start)";
    const dur = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
    const tail = r.outcome === "failure" && r.failedNodeId ? `   failed at: ${r.failedNodeId}` : "";
    await output.info(`    ${glyph}  ${r.runId.padEnd(28)} ${ts}   ${dur}${tail}`);
    await output.info(`       → apparat pipeline trace ${r.runId}`);
  }
}

async function renderEntry(e: PipelineEntry): Promise<void> {
  let goal = "(no goal defined)";
  let requires: string[] | undefined;
  try {
    const graph = parseDot(readFileSync(e.absPath, "utf8"));
    if (graph.goal) goal = `"${graph.goal}"`;
    if (graph.inputs && graph.inputs.length > 0) requires = graph.inputs;
  } catch {
    goal = "(unreadable)";
  }
  const tag =
      e.shadowedBundled ? " (forked → local)"
    : e.hasFork         ? " (shadowed by local)"
    : "";
  await output.info(`  ${(e.name + tag).padEnd(NAME_COL)} ${goal}`);
  if (requires) {
    await output.info(`  ${"".padEnd(NAME_COL)} requires: ${requires.join(", ")}`);
  }
}
