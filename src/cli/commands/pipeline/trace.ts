import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { runDir } from "../../lib/apparat-paths.js";
import * as output from "../../lib/output.js";
import { renderNodeReceive } from "../../lib/node-receive-inspector.js";
import { cleanJsonlEvents, type JsonlLine } from "../../lib/trace-cleaner.js";
import { renderContextDelta } from "../../lib/trace-delta.js";
import { buildTimeline, type TimelineRow } from "../../lib/trace-timeline.js";
import type { RawAttemptBundle } from "../../lib/trace-timeline.js";

function renderTimeline(
  runId: string,
  outcome: string | undefined,
  rows: TimelineRow[],
): void {
  console.log(`\nrun:     ${runId}`);
  console.log(`outcome: ${outcome ?? "in-progress"}`);
  if (rows.length === 0) {
    console.log("(no tool-use events found)\n");
    return;
  }

  const col1W = Math.max(...rows.map((r) => `t=${r.tOffsetSec.toFixed(1)}s`.length));
  const col2W = Math.max(
    ...rows.map((r) =>
      r.iteration !== null ? `${r.nodeId}[${r.iteration}]`.length : r.nodeId.length,
    ),
  );
  const col3W = Math.max(...rows.map((r) => r.toolName.length));
  const col4W = Math.max(...rows.map((r) => r.inputSummary.length));

  console.log();
  for (const r of rows) {
    const t = `t=${r.tOffsetSec.toFixed(1)}s`.padEnd(col1W);
    const node = (r.iteration !== null ? `${r.nodeId}[${r.iteration}]` : r.nodeId).padEnd(col2W);
    const tool = r.toolName.padEnd(col3W);
    const inp = r.inputSummary.padEnd(col4W);
    const reread = r.rereadOf !== undefined ? "  ← re-read" : "";
    console.log(`${t}   ${node}   ${tool}   ${inp}${reread}`);
  }
  console.log();
}

export async function pipelineTraceCommand(
  runId: string,
  opts: { nodeReceive?: string; full?: boolean; timeline?: boolean; project?: string } = {}
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

  // Mutual exclusion: --timeline, --node-receive, --full are mutually exclusive modes.
  const modeCount = [opts.timeline, opts.nodeReceive, opts.full].filter(Boolean).length;
  if (modeCount > 1) {
    await output.error("--timeline, --node-receive, and --full are mutually exclusive");
    process.exit(1);
    return;
  }

  const parsedLines = raw.trim().split("\n").map(l => JSON.parse(l) as JsonlLine);
  const lines = (opts.full ? parsedLines : cleanJsonlEvents(parsedLines)) as Array<Record<string, unknown>>;

  if (opts.timeline) {
    const dir = runDir(project, runId);
    const rawAttempts: RawAttemptBundle[] = [];
    const nodeMetas = parsedLines.filter(
      (l) => (l as unknown as Record<string, unknown>).kind === "node-start",
    ) as Array<Record<string, unknown>>;

    for (const meta of nodeMetas) {
      const nodeId = String(meta.nodeId ?? "");
      const nodeReceiveId = String(meta.nodeReceiveId ?? "");
      const nodeDir = join(dir, nodeId);
      if (!existsSync(nodeDir)) continue;
      let n = 1;
      while (true) {
        const p = join(nodeDir, `raw-attempt-${n}.txt`);
        if (!existsSync(p)) break;
        const attemptRaw = readFileSync(p, "utf-8").trim();
        const attemptLines: JsonlLine[] = attemptRaw
          ? cleanJsonlEvents(attemptRaw.split("\n").map((l) => JSON.parse(l) as JsonlLine))
          : [];
        rawAttempts.push({ nodeReceiveId, iteration: n, lines: attemptLines });
        n++;
      }
    }

    const pipelineEnd = parsedLines.find(
      (l) => (l as unknown as Record<string, unknown>).kind === "pipeline-end",
    ) as Record<string, unknown> | undefined;
    const rows = buildTimeline(parsedLines, rawAttempts);
    renderTimeline(runId, pipelineEnd ? String(pipelineEnd.outcome ?? "") : undefined, rows);
    return;
  }

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
    const status = ne ? (ne.success ? "✓" : "✗") : "…";
    let ctxDisplay: string;
    if (!ne) {
      ctxDisplay = "(no contextUpdates — node did not complete)";
    } else {
      const updates = (ne.contextUpdates as Record<string, unknown>) ?? {};
      ctxDisplay = renderContextDelta(updates) || "—";
    }
    console.log(`  ${String(ns.nodeReceiveId).padEnd(20)} ${String(ns.nodeId).padEnd(12)} ${String(ns.nodeKind).padEnd(18)} ${status}  ${ctxDisplay}`);
  }
  console.log();
}
