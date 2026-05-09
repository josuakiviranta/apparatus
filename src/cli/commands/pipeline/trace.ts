import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { runDir } from "../../lib/apparat-paths.js";
import * as output from "../../lib/output.js";

export async function pipelineTraceCommand(
  runId: string,
  opts: { nodeReceive?: string; full?: boolean; project?: string } = {}
): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const tracePath = join(runDir(project, runId), "pipeline.jsonl");
  if (!existsSync(tracePath)) {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(tracePath, "utf-8");
  } catch {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return;
  }

  const lines = raw.trim().split("\n").map(l => JSON.parse(l) as Record<string, unknown>);

  if (opts.nodeReceive) {
    const event = lines.find(
      l => l.kind === "node-start" && l.nodeReceiveId === opts.nodeReceive
    );
    if (!event) {
      await output.error(`No node-start event found for: ${opts.nodeReceive}`);
      process.exit(1);
      return;
    }
    const snapshot = (event.contextSnapshot as Record<string, unknown>) ?? {};
    const keys = Object.keys(snapshot);

    const thisIdx = lines.indexOf(event);
    const completedStages = lines
      .slice(0, thisIdx)
      .filter(l => l.kind === "node-end" && l.success === true)
      .map(l => String(l.nodeId));

    console.log(`\nnode:     ${event.nodeId}`);
    console.log(`kind:     ${event.nodeKind}`);
    console.log(`received: ${event.timestamp}`);
    const promptPath = join(runDir(project, runId), String(event.nodeId), "prompt.md");
    if (existsSync(promptPath)) {
      console.log(`prompt:   ${promptPath}`);
    }
    console.log(`\ncontext snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);
    if (keys.length === 0) {
      console.log("  (empty — first node)");
    } else {
      const maxLen = Math.max(...keys.map(k => k.length));
      for (const key of keys) {
        const val = JSON.stringify(snapshot[key]);
        if (opts.full || val.length <= 80) {
          console.log(`  ${key.padEnd(maxLen + 2)}${val}`);
        } else {
          console.log(`  ${key}`);
          console.log(`    ${val}`);
        }
      }
    }
    const failures = lines.filter(l =>
      l.kind === "validation-failure" && l.nodeReceiveId === opts.nodeReceive,
    );
    if (failures.length > 0) {
      console.log(`\nvalidation attempts:`);
      for (const f of failures as Array<Record<string, unknown>>) {
        const errs = (f.errors as Array<{ path: string; message: string }>)
          .map(e => `${e.path}: ${e.message}`)
          .join(", ");
        console.log(`  [${f.attempt}] ✗ failed — ${errs}`);
        console.log(`      raw: ${f.rawOutputPath}`);
      }
    }
    console.log(`\ncompleted stages: ${completedStages.length > 0 ? completedStages.join(" · ") : "(none)"}`);
    console.log();
    return;
  }

  // List all node invocations
  const pipelineEnd = lines.find(l => l.kind === "pipeline-end");
  const nodeStarts = lines.filter(l => l.kind === "node-start");
  const nodeEnds = lines.filter(l => l.kind === "node-end") as Array<Record<string, unknown>>;

  console.log(`\nrun:     ${runId}`);
  console.log(`outcome: ${pipelineEnd?.outcome ?? "in-progress"}`);
  console.log("nodes:");

  for (const ns of nodeStarts) {
    const ne = nodeEnds.find(e => e.nodeReceiveId === ns.nodeReceiveId);
    const snapshot = (ns.contextSnapshot as Record<string, unknown>) ?? {};
    const ctxKeys = Object.keys(snapshot);
    const ctxDisplay = ctxKeys.length === 0
      ? "{}"
      : `{${ctxKeys.slice(0, 3).join(", ")}${ctxKeys.length > 3 ? ", ..." : ""}}`;
    const status = ne ? (ne.success ? "✓" : "✗") : "…";
    console.log(`  ${String(ns.nodeReceiveId).padEnd(20)} ${String(ns.nodeId).padEnd(12)} ${String(ns.nodeKind).padEnd(18)} ${status}  ctx: ${ctxDisplay}`);
  }
  console.log();
}
