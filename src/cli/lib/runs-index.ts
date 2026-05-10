import { existsSync, readdirSync, readFileSync, lstatSync } from "fs";
import { join } from "path";

export interface RunSummary {
  runId: string;
  pipelineName: string | null;
  startedAt: string | null;
  outcome: "success" | "failure" | "in-progress" | "crashed";
  durationMs: number | null;
  failedNodeId: string | null;
}

interface ParsedEvents {
  start: { pipelineName?: string; timestamp?: string } | null;
  end: { outcome?: string; timestamp?: string } | null;
  lastFailedNodeId: string | null;
}

function parseJsonl(tracePath: string): ParsedEvents {
  let text: string;
  try { text = readFileSync(tracePath, "utf8"); }
  catch { return { start: null, end: null, lastFailedNodeId: null }; }
  let start: ParsedEvents["start"] = null;
  let end: ParsedEvents["end"] = null;
  let lastFailedNodeId: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line) as Record<string, unknown>; }
    catch { continue; }
    if (ev.kind === "pipeline-start" && start === null) {
      start = {
        pipelineName: typeof ev.pipelineName === "string" ? ev.pipelineName : undefined,
        timestamp: typeof ev.timestamp === "string" ? ev.timestamp : undefined,
      };
    } else if (ev.kind === "pipeline-end") {
      end = {
        outcome: typeof ev.outcome === "string" ? ev.outcome : undefined,
        timestamp: typeof ev.timestamp === "string" ? ev.timestamp : undefined,
      };
    } else if (ev.kind === "node-end" && ev.success === false && typeof ev.nodeId === "string") {
      lastFailedNodeId = ev.nodeId;
    }
  }
  return { start, end, lastFailedNodeId };
}

function summarize(runId: string, runDir: string): RunSummary {
  const tracePath = join(runDir, "pipeline.jsonl");
  if (!existsSync(tracePath)) {
    return { runId, pipelineName: null, startedAt: null, outcome: "crashed", durationMs: null, failedNodeId: null };
  }
  const { start, end, lastFailedNodeId } = parseJsonl(tracePath);
  if (!start) {
    return { runId, pipelineName: null, startedAt: null, outcome: "crashed", durationMs: null, failedNodeId: null };
  }
  const startedAt = start.timestamp ?? null;
  const pipelineName = start.pipelineName ?? null;
  if (!end) {
    return { runId, pipelineName, startedAt, outcome: "in-progress", durationMs: null, failedNodeId: null };
  }
  const outcome: RunSummary["outcome"] = end.outcome === "failure" ? "failure" : "success";
  const durationMs = startedAt && end.timestamp
    ? Math.max(0, Date.parse(end.timestamp) - Date.parse(startedAt))
    : null;
  return {
    runId,
    pipelineName,
    startedAt,
    outcome,
    durationMs,
    failedNodeId: outcome === "failure" ? lastFailedNodeId : null,
  };
}

export function listAllRuns(runsRoot: string): RunSummary[] {
  if (!existsSync(runsRoot)) return [];
  const out: RunSummary[] = [];
  for (const name of readdirSync(runsRoot)) {
    const dir = join(runsRoot, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
    } catch { continue; }
    out.push(summarize(name, dir));
  }
  // Newest first by startedAt; nulls (crashed-at-start) sort last.
  out.sort((a, b) => {
    if (a.startedAt === b.startedAt) return 0;
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });
  return out;
}

export function listRunsForPipeline(runsRoot: string, pipelineName: string): RunSummary[] {
  return listAllRuns(runsRoot).filter(r => r.pipelineName === pipelineName);
}
