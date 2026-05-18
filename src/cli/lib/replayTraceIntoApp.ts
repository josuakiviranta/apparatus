// src/cli/lib/replayTraceIntoApp.ts
import { readFileSync, existsSync } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";
import { cleanJsonlEvents, type JsonlLine } from "./trace-cleaner.js";

/**
 * Map one tracer JSONL line (already a string) to a NodeEvent that
 * PipelineApp's emit() callback expects, or null when the line should be
 * skipped (pipeline-start/end markers, validation-failure, malformed JSON,
 * unknown kinds).
 *
 * Shared by replayTraceIntoApp (static replay) and pipeline-jsonl-tail
 * (live tail). One parser, two callers.
 */
export function mapTraceLineToEvent(line: string): NodeEvent | null {
  let trace: Record<string, unknown>;
  try {
    trace = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (trace.kind) {
    case "node-start": {
      const nodeId = String(trace.nodeId ?? "");
      const nodeReceiveId = trace.nodeReceiveId != null ? String(trace.nodeReceiveId) : undefined;
      const contextSnapshot = trace.contextSnapshot as Record<string, unknown> | undefined;
      const hasContext = contextSnapshot != null && Object.keys(contextSnapshot).length > 0;
      return {
        kind: "start",
        nodeId,
        label: nodeId,
        blockKind: "agent",
        nodeReceiveId,
        hasContext,
      };
    }
    case "node-end": {
      const success = Boolean(trace.success);
      const failureReason = trace.failureReason != null ? String(trace.failureReason) : undefined;
      return {
        kind: "end",
        outcome: {
          status: success ? "success" : "fail",
          reason: failureReason,
        },
      };
    }
    case "pipeline-start":
    case "pipeline-end":
    case "validation-failure":
      return null;
    default:
      return null;
  }
}

export function replayTraceIntoApp(
  tracePath: string,
  emit: (ev: NodeEvent) => void,
  opts: { full?: boolean } = {},
): void {
  if (!existsSync(tracePath)) return;
  let content: string;
  try {
    content = readFileSync(tracePath, "utf8");
  } catch {
    return;
  }
  const rawLines = content.split("\n").filter(l => l.length > 0);
  const parsed: JsonlLine[] = [];
  for (const line of rawLines) {
    try { parsed.push(JSON.parse(line) as JsonlLine); }
    catch { parsed.push({ __unparseable: line } as JsonlLine); }
  }
  const visible = opts.full ? parsed : cleanJsonlEvents(parsed);
  for (const obj of visible) {
    if ((obj as { __unparseable?: string }).__unparseable !== undefined) {
      const ev = mapTraceLineToEvent((obj as { __unparseable: string }).__unparseable);
      if (ev) emit(ev);
      continue;
    }
    const ev = mapTraceLineToEvent(JSON.stringify(obj));
    if (ev) emit(ev);
  }
}
