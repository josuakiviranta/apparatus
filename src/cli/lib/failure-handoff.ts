export interface FailureHandoff {
  /** id of the node whose Outcome.status was non-success. */
  nodeId: string;
  /** Per-invocation receive id (UUID-ish) — argument to `pipeline trace --node-receive`. */
  nodeReceiveId: string | null;
  /** Path to the failed node's `.md` sibling, relative to cwd. Null for tool nodes / missing files. */
  agentRelPath: string | null;
  /** First 500 chars of failureReason, single-line. */
  reason: string;
  /** Trace JSONL path, e.g. `<runsRoot>/<runId>/pipeline.jsonl`. */
  tracePath: string;
  /** Short run id used in the inspect command. */
  runId: string;
  /** Latest validation-failure attempt's rawOutputPath, or null if none was recorded. */
  rawOutputPath: string | null;
  /** Pre-formatted: `apparat pipeline run <dotFile> --resume <runId>`. */
  resumeCommand: string;
}

/**
 * Format a `FailureHandoff` into the two-block footer string.
 * Pure — no I/O, no globals — easy to snapshot-test.
 *
 * Shape:
 *   ✗ failed at <nodeId>[ (agent: <relPath>)]: <reason>
 *   trace: <tracePath>
 *   [raw output: <rawOutputPath>]
 *   [inspect: apparat pipeline trace <runId> --node-receive <receiveId> --full]
 *
 *   resume: <resumeCommand>
 *
 * Bracketed lines drop when the field is null. Blank line before `resume:`
 * is unconditional — chat-refinement rule round 1, bullet 3 (separation of
 * investigation from retry).
 */
export function renderFailureFooter(h: FailureHandoff): string {
  const lines: string[] = [];

  const agentClause = h.agentRelPath ? ` (agent: ${h.agentRelPath})` : "";
  lines.push(`✗ failed at ${h.nodeId}${agentClause}: ${h.reason}`);
  lines.push(`trace: ${h.tracePath}`);
  if (h.rawOutputPath) lines.push(`raw output: ${h.rawOutputPath}`);
  if (h.nodeReceiveId) {
    lines.push(`inspect: apparat pipeline trace ${h.runId} --node-receive ${h.nodeReceiveId} --full`);
  }
  lines.push("");
  lines.push(`resume: ${h.resumeCommand}`);

  return lines.join("\n") + "\n";
}
