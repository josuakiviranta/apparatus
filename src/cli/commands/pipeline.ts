import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { runLoop } from "../lib/loop.js";
import { variableExpansionTransform } from "../../attractor/transforms/variable-expansion.js";
import { ConsoleInterviewer } from "../../attractor/interviewer/console.js";
import * as output from "../lib/output.js";

export interface PipelineRunOptions {
  project?: string;
  resume?: boolean;
  logsRoot?: string;
}

export async function pipelineValidateCommand(dotFile: string): Promise<number> {
  const absPath = resolve(dotFile);
  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    return 1;
  }
  let src: string;
  try { src = readFileSync(absPath, "utf8"); }
  catch { await output.error(`Cannot read file: ${absPath}`); return 1; }

  const graph = parseDot(src);
  const diags = validateGraph(graph);
  const errors   = diags.filter(d => d.severity === "error");
  const warnings = diags.filter(d => d.severity === "warning");

  for (const w of warnings) await output.warn(`[${w.rule}] ${w.message}`);
  for (const e of errors)   await output.error(`[${e.rule}] ${e.message}`);

  if (errors.length === 0) {
    await output.success(`Pipeline valid (${graph.nodes.size} nodes, ${graph.edges.length} edges)`);
    return 0;
  }
  return 1;
}

export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  const absPath = resolve(dotFile);
  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    process.exit(1);
  }

  const src = readFileSync(absPath, "utf8");
  let graph = parseDot(src);

  try { validateOrRaise(graph); }
  catch (err) { await output.error((err as Error).message); process.exit(1); }

  graph = variableExpansionTransform(graph, { project: opts.project });

  const slug = graph.name.replace(/\s+/g, "-").toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logsRoot = opts.logsRoot ?? join(homedir(), ".ralph", "runs", `${slug}-${timestamp}`);

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const result = await runPipeline(graph, {
      logsRoot,
      cwd: opts.project ? resolve(opts.project) : process.cwd(),
      runLoop,
      interviewer: new ConsoleInterviewer(),
      signal: ac.signal,
      project: opts.project,
      resume: opts.resume,
    });

    if (result.status === "success") {
      await output.success(`Pipeline completed (${result.completedNodes.length} nodes)`);
    } else {
      await output.error(`Pipeline failed: ${result.failureReason}`);
      process.exit(1);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
