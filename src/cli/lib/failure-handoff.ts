import { readFileSync } from "fs";
import type { Graph } from "../../attractor/types.js";
import { resolveAgentFileForNode } from "./agent-paths.js";
import { shellQuote } from "./shell-quote.js";

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

export interface LoadFailureHandoffArgs {
  tracePath: string;
  failedNodeId: string;
  /** Whatever the engine surfaced as the per-node failureReason. */
  failureReason: string;
  /** User-facing path passed to `pipeline run` — used to build the resume command. */
  dotFile: string;
  /** Directory of the .dot file — used by the agent-path resolver. */
  dotDir: string;
  runId: string;
  graph: Graph;
  /** Optional: forwards `--project <folder>` into the printed resume command. */
  project?: string;
  /** Optional: forwards `--var k=v` pairs (insertion-order) into the printed resume command. */
  variables?: Record<string, string>;
}

/**
 * Read the JSONL trace we just authored and assemble a `FailureHandoff`.
 *
 * - Picks the most recent `node-start` for `failedNodeId` (a node may run many
 *   times in retry loops) to get `nodeReceiveId`.
 * - Picks the highest-attempt `validation-failure` event for that receive id
 *   to get `rawOutputPath` (refinement: latest attempt only — earlier attempts
 *   are reachable via the `inspect:` line's `pipeline trace --node-receive --full`).
 * - Resolves the agent file path via `resolveAgentFileForNode`.
 *
 * Never throws — degrades gracefully on unreadable trace, missing receive id,
 * or absent validation-failure events. The footer always prints something.
 */
export function loadFailureHandoff(args: LoadFailureHandoffArgs): FailureHandoff {
  const reason = normaliseReason(args.failureReason);
  const node = args.graph.nodes.get(args.failedNodeId);
  const agentRelPath = node ? resolveAgentFileForNode(node, args.dotDir) : null;
  const resumeCommand = buildResumeCommand({
    dotFile: args.dotFile,
    runId: args.runId,
    project: args.project,
    variables: args.variables,
  });

  let lines: Record<string, unknown>[] = [];
  try {
    const raw = readFileSync(args.tracePath, "utf-8").trim();
    if (raw.length > 0) {
      lines = raw.split("\n").map(l => {
        try { return JSON.parse(l) as Record<string, unknown>; }
        catch { return {}; }
      });
    }
  } catch {
    // Unreadable trace — degraded handoff.
    return {
      nodeId: args.failedNodeId,
      nodeReceiveId: null,
      agentRelPath,
      reason,
      tracePath: args.tracePath,
      runId: args.runId,
      rawOutputPath: null,
      resumeCommand,
    };
  }

  const nodeStarts = lines.filter(l =>
    l.kind === "node-start" && l.nodeId === args.failedNodeId
  );
  const last = nodeStarts[nodeStarts.length - 1];
  const nodeReceiveId = nodeStarts.length > 0 && typeof last?.nodeReceiveId === "string"
    ? last.nodeReceiveId
    : null;

  let rawOutputPath: string | null = null;
  if (nodeReceiveId) {
    const failures = lines.filter(l =>
      l.kind === "validation-failure" && l.nodeReceiveId === nodeReceiveId
    );
    if (failures.length > 0) {
      const sorted = [...failures].sort((a, b) =>
        Number(b.attempt ?? 0) - Number(a.attempt ?? 0)
      );
      const top = sorted[0];
      if (typeof top.rawOutputPath === "string") {
        rawOutputPath = top.rawOutputPath;
      }
    }
  }

  return {
    nodeId: args.failedNodeId,
    nodeReceiveId,
    agentRelPath,
    reason,
    tracePath: args.tracePath,
    runId: args.runId,
    rawOutputPath,
    resumeCommand,
  };
}

function normaliseReason(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return "pipeline failed";
  return trimmed.split("\n")[0].slice(0, 500);
}

export interface BuildResumeCommandArgs {
  dotFile: string;
  runId: string;
  /** Optional: appends `--project <folder>` when set. Quoted in case the
   *  folder path contains shell metacharacters. */
  project?: string;
  /** Optional: appends `--var k=v` per entry, in `Object.entries()` order.
   *  Values are shell-quoted so spaces, single quotes, $, and backticks
   *  round-trip through bash/zsh/sh. */
  variables?: Record<string, string>;
}

/**
 * Build the `resume:` recipe line. Pure — no I/O. Output shape:
 *
 *   apparat pipeline run <dotFile> --resume <runId>
 *     [--project '<folder>']
 *     [--var 'k=v'] ...
 *
 * Argument order is stable: `--resume` first (paired with the bare positional),
 * then `--project`, then `--var` pairs in insertion order. Test fixtures pin
 * this order.
 */
export function buildResumeCommand(args: BuildResumeCommandArgs): string {
  const parts = [`apparat pipeline run ${args.dotFile} --resume ${args.runId}`];
  if (args.project !== undefined) {
    parts.push(`--project ${shellQuote(args.project)}`);
  }
  if (args.variables) {
    for (const [k, v] of Object.entries(args.variables)) {
      parts.push(`--var ${shellQuote(`${k}=${v}`)}`);
    }
  }
  return parts.join(" ");
}
