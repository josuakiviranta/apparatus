// src/cli/lib/replayTraceIntoApp.ts
import { readFileSync, existsSync } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";

/**
 * Reads a completed pipeline JSONL trace and maps each tracer event to the
 * NodeEvent shape that PipelineApp's emit() callback expects.
 *
 * Mapping is lossy-but-faithful: only structural events (node-start / node-end)
 * are replayed.  Text/stream-line events are not present in the tracer log —
 * the user sees the finished state, not the live streaming.
 */
export function replayTraceIntoApp(
  tracePath: string,
  emit: (ev: NodeEvent) => void,
): void {
  if (!existsSync(tracePath)) return;

  let content: string;
  try {
    content = readFileSync(tracePath, "utf8");
  } catch {
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  for (const line of lines) {
    let trace: Record<string, unknown>;
    try {
      trace = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // skip malformed lines
    }

    switch (trace.kind) {
      case "node-start": {
        const nodeId = String(trace.nodeId ?? "");
        const nodeReceiveId = trace.nodeReceiveId != null ? String(trace.nodeReceiveId) : undefined;
        const contextSnapshot = trace.contextSnapshot as Record<string, unknown> | undefined;
        const hasContext =
          contextSnapshot != null && Object.keys(contextSnapshot).length > 0;
        emit({
          kind: "start",
          nodeId,
          label: nodeId, // tracer does not carry a label; use nodeId as fallback
          blockKind: "agent", // default: most nodes are agents; marker-shaped nodes rarely appear in traces
          nodeReceiveId,
          hasContext,
        });
        break;
      }

      case "node-end": {
        const success = Boolean(trace.success);
        const failureReason = trace.failureReason != null ? String(trace.failureReason) : undefined;
        emit({
          kind: "end",
          outcome: {
            status: success ? "success" : "fail",
            reason: failureReason,
          },
        });
        break;
      }

      case "pipeline-start":
      case "pipeline-end":
      case "validation-failure":
        // No-op: PipelineApp draws its own header/footer and error handling.
        break;

      default:
        // Forward-compat: silently skip unknown event kinds.
        break;
    }
  }
}
