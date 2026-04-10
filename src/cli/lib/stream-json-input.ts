/**
 * Format a user text turn as a single NDJSON line suitable for
 * Claude Code CLI's --input-format stream-json stdin.
 */
export function formatUserTurn(text: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    }) + "\n"
  );
}
