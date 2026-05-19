/**
 * Stub for cross-chunk dependency. Chunk c1 will overwrite this file with the
 * real implementation. Keep the signature stable so c2 type-checks and tests
 * pass in isolation.
 *
 * Real semantics (per design doc): produce a short human-readable summary of
 * a tool's input, distilling the most informative field (e.g. file_path,
 * command, pattern) and falling back to a JSON snippet for unknown tools.
 */
export function summarizeToolInput(toolName: string, input: unknown): string {
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
      return JSON.stringify(input ?? null).slice(0, 60);
  }
}
