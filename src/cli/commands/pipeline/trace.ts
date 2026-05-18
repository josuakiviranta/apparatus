import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { runDir } from "../../lib/apparat-paths.js";
import * as output from "../../lib/output.js";
import { renderNodeReceive } from "../../lib/node-receive-inspector.js";
import { cleanJsonlEvents, type JsonlLine } from "../../lib/trace-cleaner.js";

export async function pipelineTraceCommand(
  runId: string,
  opts: { nodeReceive?: string; full?: boolean; project?: string } = {}
): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const tracePath = join(runDir(project, runId), "pipeline.jsonl");
  if (!existsSync(tracePath)) {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    await output.error(`(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`);
    process.exit(1);
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(tracePath, "utf-8");
  } catch {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    await output.error(`(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`);
    process.exit(1);
    return;
  }

  const parsedLines = raw.trim().split("\n").map(l => JSON.parse(l) as JsonlLine);
  const lines = (opts.full ? parsedLines : cleanJsonlEvents(parsedLines)) as Array<Record<string, unknown>>;

  if (opts.nodeReceive) {
    const event = lines.find(
      l => l.kind === "node-start" && l.nodeReceiveId === opts.nodeReceive
    );
    if (!event) {
      await output.error(`No node-start event found for: ${opts.nodeReceive}`);
      process.exit(1);
      return;
    }

    const thisIdx = lines.indexOf(event);
    const completedStages = lines
      .slice(0, thisIdx)
      .filter(l => l.kind === "node-end" && l.success === true)
      .map(l => String(l.nodeId));

    const promptPath = join(runDir(project, runId), String(event.nodeId), "prompt.md");
    const validationFailures = (lines
      .filter(l => l.kind === "validation-failure" && l.nodeReceiveId === opts.nodeReceive) as Array<Record<string, unknown>>)
      .map(f => ({
        attempt: Number(f.attempt),
        errors: (f.errors as Array<{ path: string; message: string }>) ?? [],
        rawOutputPath: String(f.rawOutputPath),
      }));

    const out = renderNodeReceive(
      {
        nodeId: String(event.nodeId),
        nodeKind: String(event.nodeKind),
        timestamp: String(event.timestamp),
        contextSnapshot: (event.contextSnapshot as Record<string, unknown>) ?? {},
      },
      {
        full: opts.full,
        promptPath: existsSync(promptPath) ? promptPath : null,
        validationFailures,
        completedStages,
      },
    );

    for (const line of out) console.log(line);
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
