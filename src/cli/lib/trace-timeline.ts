/**
 * Cross-node tool-use chronology builder for `apparat pipeline trace --timeline`.
 * Pure: takes parsed JSONL arrays, returns sorted+annotated TimelineRow[].
 * See design doc 2026-05-19-trace-timeline-cross-node-tool-chronology §3.
 */

import type { JsonlLine } from "./trace-cleaner.js";
import { summarizeToolInput } from "./trace-timeline-formatters.js";

export interface TimelineRow {
  timestamp: string;
  tOffsetSec: number;
  nodeReceiveId: string;
  nodeId: string;
  iteration: number | null;
  toolName: string;
  inputSummary: string;
  resultSummary: string;
  rereadOf?: number;
}

export interface RawAttemptBundle {
  nodeReceiveId: string;
  iteration: number;
  lines: JsonlLine[];
}

export interface BuildTimelineOpts {
  annotateRereads?: boolean;
}

interface NodeStartMeta {
  nodeId: string;
  nodeReceiveId: string;
  nodeKind: string;
  timestamp: string;
}

const INTERACTIVE_KINDS = new Set(["chat-session"]);
const GATE_KINDS = new Set(["gate", "approval-gate"]);

function getToolUses(line: JsonlLine): Array<{ name: string; input: unknown }> {
  const l = line as unknown as {
    type?: string;
    message?: { content?: unknown };
  };
  if (l.type !== "assistant") return [];
  const content = l.message?.content;
  if (!Array.isArray(content)) return [];
  const out: Array<{ name: string; input: unknown }> = [];
  for (const c of content) {
    const cc = c as { type?: string; name?: string; input?: unknown };
    if (cc?.type === "tool_use" && typeof cc.name === "string") {
      out.push({ name: cc.name, input: cc.input });
    }
  }
  return out;
}

function nodeStartMetas(pipelineLines: JsonlLine[]): NodeStartMeta[] {
  const out: NodeStartMeta[] = [];
  for (const l of pipelineLines) {
    const rec = l as unknown as Record<string, unknown>;
    if (rec.kind !== "node-start") continue;
    out.push({
      nodeId: String(rec.nodeId ?? ""),
      nodeReceiveId: String(rec.nodeReceiveId ?? ""),
      nodeKind: String(rec.nodeKind ?? ""),
      timestamp: String(rec.timestamp ?? ""),
    });
  }
  return out;
}

function countAttemptsByReceiveId(
  attempts: RawAttemptBundle[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of attempts) {
    map.set(a.nodeReceiveId, (map.get(a.nodeReceiveId) ?? 0) + 1);
  }
  return map;
}

function syntheticToolName(nodeKind: string): string | null {
  if (INTERACTIVE_KINDS.has(nodeKind)) return "(interactive)";
  if (GATE_KINDS.has(nodeKind)) return "(gate)";
  return null;
}

function resultSummary(): string {
  // Result-side enrichment (resultSize, exit codes) is deferred — see design
  // §3.2 "matching user-side tool_result". Today we emit a stable empty
  // sentinel so the column survives empty cases without misaligning.
  return "";
}

function normalizeForReread(toolName: string, input: unknown): string {
  const inp =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return String(inp.file_path ?? "");
    case "Bash":
      return String(inp.command ?? "").trim();
    case "Grep":
      return `${String(inp.pattern ?? "")}::${String(inp.path ?? ".")}`;
    case "Agent":
      return String(inp.description ?? "");
    default:
      return JSON.stringify(input ?? null);
  }
}

/**
 * Mutates `rows` in place, annotating duplicates with `rereadOf`.
 *
 * INVARIANT: Each row must have been produced by `buildTimeline` so that the
 * raw input is attached via the module-private `RAW_INPUT` symbol. Do NOT
 * clone rows (spread, structuredClone, JSON round-trip) before passing them
 * here — those operations drop the symbol and the function falls back to a
 * no-op (no rows would key together). For the same reason, do not call this
 * function on rows constructed externally; build them via `buildTimeline`.
 */
export function detectRereads(rows: TimelineRow[]): void {
  const firstIdx = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = `${r.toolName}|${normalizeForReread(r.toolName, rawInputFor(r))}`;
    if (firstIdx.has(key)) {
      r.rereadOf = firstIdx.get(key)!;
    } else {
      firstIdx.set(key, i);
    }
  }
}

// Raw input lives on a module-private symbol so it survives within the same
// process but never leaks via JSON / Object.keys / structured-clone. See the
// invariant on `detectRereads` above.
const RAW_INPUT = Symbol("rawInput");

function rawInputFor(row: TimelineRow): unknown {
  return (row as unknown as Record<symbol, unknown>)[RAW_INPUT] ?? null;
}

function attachRaw(row: TimelineRow, input: unknown): void {
  Object.defineProperty(row, RAW_INPUT, { value: input, enumerable: false });
}

export function buildTimeline(
  pipelineLines: JsonlLine[],
  rawAttempts: RawAttemptBundle[],
  opts: BuildTimelineOpts = {},
): TimelineRow[] {
  const annotateRereads = opts.annotateRereads !== false;

  // Stable sort uses original index as tiebreaker; collect with `seq`.
  const seeded: Array<{ row: TimelineRow; seq: number; rawInput: unknown }> = [];
  let seq = 0;

  const attemptCount = countAttemptsByReceiveId(rawAttempts);
  // If any node in this pipeline ran more than once, surface every row's
  // iteration so renderers can disambiguate. Otherwise leave iteration null
  // (test 9: "bare nodeId" case) — the renderer omits the [N] suffix.
  const anyMulti = Array.from(attemptCount.values()).some((n) => n > 1);
  const metas = nodeStartMetas(pipelineLines);
  const attemptIndex = new Map<string, RawAttemptBundle[]>();
  for (const a of rawAttempts) {
    const arr = attemptIndex.get(a.nodeReceiveId) ?? [];
    arr.push(a);
    attemptIndex.set(a.nodeReceiveId, arr);
  }

  for (const meta of metas) {
    const synthetic = syntheticToolName(meta.nodeKind);
    const attempts = attemptIndex.get(meta.nodeReceiveId) ?? [];

    if (synthetic && attempts.length === 0) {
      const row: TimelineRow = {
        timestamp: meta.timestamp,
        tOffsetSec: 0,
        nodeReceiveId: meta.nodeReceiveId,
        nodeId: meta.nodeId,
        iteration: null,
        toolName: synthetic,
        inputSummary: "",
        resultSummary: resultSummary(),
      };
      attachRaw(row, null);
      seeded.push({ row, seq: seq++, rawInput: null });
      continue;
    }

    for (const attempt of attempts) {
      for (const line of attempt.lines) {
        const ts = String(
          (line as unknown as Record<string, unknown>).timestamp ?? "",
        );
        for (const { name, input } of getToolUses(line)) {
          const row: TimelineRow = {
            timestamp: ts,
            tOffsetSec: 0,
            nodeReceiveId: meta.nodeReceiveId,
            nodeId: meta.nodeId,
            iteration: anyMulti ? attempt.iteration : null,
            toolName: name,
            inputSummary: summarizeToolInput(name, input),
            resultSummary: resultSummary(),
          };
          attachRaw(row, input);
          seeded.push({ row, seq: seq++, rawInput: input });
        }
      }
    }
  }

  // Stable sort by timestamp asc, seq asc.
  seeded.sort((a, b) => {
    if (a.row.timestamp < b.row.timestamp) return -1;
    if (a.row.timestamp > b.row.timestamp) return 1;
    return a.seq - b.seq;
  });

  const rows = seeded.map((s) => s.row);
  if (rows.length === 0) return rows;

  const t0 = Date.parse(rows[0].timestamp);
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    r.tOffsetSec =
      Number.isFinite(t) && Number.isFinite(t0) ? (t - t0) / 1000 : 0;
  }

  if (annotateRereads) detectRereads(rows);
  return rows;
}
