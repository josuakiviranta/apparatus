export interface NodeReceiveSnapshot {
  nodeId: string;
  nodeKind: string;
  timestamp: string;
  contextSnapshot: Record<string, unknown>;
}

export interface RenderNodeReceiveOptions {
  full?: boolean;
  promptPath?: string | null;
  validationFailures?: Array<{
    attempt: number;
    errors: Array<{ path: string; message: string }>;
    rawOutputPath: string;
  }>;
  completedStages?: string[];
}

/**
 * Pure formatter for `apparat pipeline trace … --node-receive <id>`.
 * Returns one line per output row. Caller prints them.
 * Body byte-identical to src/cli/commands/pipeline/trace.ts:31-86 (pre-refactor).
 */
export function renderNodeReceive(
  snap: NodeReceiveSnapshot,
  opts: RenderNodeReceiveOptions = {},
): string[] {
  const out: string[] = [];
  const keys = Object.keys(snap.contextSnapshot);

  out.push("");
  out.push(`node:     ${snap.nodeId}`);
  out.push(`kind:     ${snap.nodeKind}`);
  out.push(`received: ${snap.timestamp}`);
  if (opts.promptPath) {
    out.push(`prompt:   ${opts.promptPath}`);
  }
  out.push("");
  out.push(`context snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);
  if (keys.length === 0) {
    out.push("  (empty — first node)");
  } else {
    const maxLen = Math.max(...keys.map(k => k.length));
    for (const key of keys) {
      const val = JSON.stringify(snap.contextSnapshot[key]);
      if (opts.full || val.length <= 80) {
        out.push(`  ${key.padEnd(maxLen + 2)}${val}`);
      } else {
        out.push(`  ${key}`);
        out.push(`    ${val}`);
      }
    }
  }
  const failures = opts.validationFailures ?? [];
  if (failures.length > 0) {
    out.push("");
    out.push("validation attempts:");
    for (const f of failures) {
      const errs = f.errors.map(e => `${e.path}: ${e.message}`).join(", ");
      out.push(`  [${f.attempt}] ✗ failed — ${errs}`);
      out.push(`      raw: ${f.rawOutputPath}`);
    }
  }
  const stages = opts.completedStages ?? [];
  out.push("");
  out.push(`completed stages: ${stages.length > 0 ? stages.join(" · ") : "(none)"}`);

  return out;
}

/**
 * Single source of truth for the `apparat pipeline trace … --node-receive …`
 * recipe string. Pure — three arguments, one string out.
 *
 *   inspectCommand(runId, id)                  // bare
 *   inspectCommand(runId, id, { full: true })  // appends --full
 */
export function inspectCommand(
  runId: string,
  nodeReceiveId: string,
  opts: { full?: boolean } = {},
): string {
  const base = `apparat pipeline trace ${runId} --node-receive ${nodeReceiveId}`;
  return opts.full ? `${base} --full` : base;
}
