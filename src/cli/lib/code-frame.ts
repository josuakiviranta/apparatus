import type { SourceLocation } from "../../attractor/types.js";

interface Opts { context?: number; color?: boolean }

export function renderCodeFrame(source: string, loc: SourceLocation, opts: Opts = {}): string {
  const lines = source.split("\n");
  const context = opts.context ?? 2;
  const target = Math.min(loc.line, lines.length);
  const first = Math.max(1, target - context);
  const last  = Math.min(lines.length, target + context);
  const width = String(last).length;
  const out: string[] = [];
  for (let n = first; n <= last; n++) {
    const prefix = n === target ? "›" : " ";
    out.push(`${prefix} ${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
    if (n === target) {
      const col = Math.max(1, loc.column);
      const end = loc.endLine === loc.line && loc.endColumn ? loc.endColumn : col + 1;
      const span = Math.max(1, end - col);
      const gutter = `  ${" ".repeat(width)} | `;
      out.push(gutter + " ".repeat(col - 1) + "^".repeat(span));
    }
  }
  return out.join("\n");
}
