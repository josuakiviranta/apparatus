import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDot } from "../../../attractor/core/graph.js";
import { listAllPipelines, type PipelineEntry } from "../../lib/pipeline-resolver.js";
import * as output from "../../lib/output.js";

export interface PipelineListOptions {
  project?: string;
}

const NAME_COL = 34;

export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const entries = listAllPipelines(project);

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
