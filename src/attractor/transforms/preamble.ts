import type { CheckpointState } from "../types.js";

export function buildPreamble(checkpoint: CheckpointState, fidelity: string): string {
  if (fidelity === "full") return "";

  const lines: string[] = [
    "## Pipeline Context (auto-generated)",
    `Completed stages: ${checkpoint.completedNodes.join(", ") || "(none)"}`,
  ];

  if (Object.keys(checkpoint.context).length > 0) {
    lines.push("Key context values:");
    for (const [k, v] of Object.entries(checkpoint.context)) {
      const rendered =
        typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null
          ? String(v)
          : JSON.stringify(v);
      lines.push(`  ${k}: ${rendered}`);
    }
  }

  return lines.join("\n") + "\n\n";
}
