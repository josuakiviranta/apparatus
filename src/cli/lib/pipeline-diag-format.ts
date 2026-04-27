import { renderCodeFrame } from "./code-frame.js";
import type { Diagnostic } from "../../attractor/types.js";

export function indentHint(s: string): string {
  return s.split("\n").map(line => `  ${line}`).join("\n");
}

export function formatPipelineDiag(
  d: Diagnostic,
  src: string,
  relPath: string,
): string {
  const loc = d.location ? `${relPath}:${d.location.line}:${d.location.column} ` : "";
  const hint = d.hint ? `\n${indentHint(d.hint)}` : "";
  const frame = d.location
    ? `\n${indentHint(renderCodeFrame(src, d.location, { context: 2, color: false }))}`
    : "";
  return `${loc}[${d.rule}] ${d.message}${hint}${frame}`;
}
