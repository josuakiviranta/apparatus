// src/cli/lib/trace-delta.ts
//
// Pure delta formatter for `apparat pipeline trace` and the Ink trace view.
// Design: docs/superpowers/specs/2026-05-18-trace-emits-context-deltas-not-snapshots-design.md
//
// renderContextDelta is IO-free, allocation-only-on-need, single-pass.
// Both CLI (src/cli/commands/pipeline/trace.ts) and Ink
// (src/cli/lib/replayTraceIntoApp.ts) route through this function. One
// formatter, two callers — pinned by smoke fixture trace-delta-renderer.

const STRING_TRUNCATE = 80;

function renderValue(v: unknown): string {
  if (typeof v === "string") {
    const escaped = JSON.stringify(v).slice(1, -1); // strip surrounding quotes; keep escapes
    if (escaped.length > STRING_TRUNCATE) {
      return `"${escaped.slice(0, STRING_TRUNCATE)}…"`;
    }
    return `"${escaped}"`;
  }
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `<array len=${v.length}>`;
  if (typeof v === "object") return "<object>";
  return String(v);
}

/**
 * Format a node-end `contextUpdates` dict (optionally diffed against `prev`)
 * as one-line delta markers.
 *
 *   { "verifier.ok": true } → `+ verifier.ok=true`
 *   { k: "new" } with prev { k: "old" } → `~ k="old"→"new"`
 *   {} with prev { k: "v" } → `- k`
 *
 * v1 callers pass only `updates` (effective adds). The `prev` parameter
 * reserves the slot for a future cross-node mutation pass.
 *
 * Pure: never mutates inputs. Safe on frozen objects. Returns the empty
 * string when there is nothing to render; callers substitute their own
 * sentinel ("—" for the CLI, omitted body-line for Ink).
 */
export function renderContextDelta(
  contextUpdates: Record<string, unknown>,
  prev?: Record<string, unknown>,
): string {
  const parts: string[] = [];

  // Adds + changes — iterate updates in insertion order.
  for (const k of Object.keys(contextUpdates)) {
    const next = contextUpdates[k];
    if (prev && Object.prototype.hasOwnProperty.call(prev, k)) {
      parts.push(`~ ${k}=${renderValue(prev[k])}→${renderValue(next)}`);
    } else {
      parts.push(`+ ${k}=${renderValue(next)}`);
    }
  }

  // Removals — keys in prev that updates omits.
  if (prev) {
    for (const k of Object.keys(prev)) {
      if (!Object.prototype.hasOwnProperty.call(contextUpdates, k)) {
        parts.push(`- ${k}`);
      }
    }
  }

  return parts.join("  ");
}
