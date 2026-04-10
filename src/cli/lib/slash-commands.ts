export type SlashCommand =
  | { kind: "end" }
  | { kind: "abort" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string }
  | { kind: "message"; text: string };

export function parseSlashCommand(input: string): SlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "message", text: input };
  const cmd = trimmed.slice(1).toLowerCase();
  if (cmd === "end") return { kind: "end" };
  if (cmd === "abort") return { kind: "abort" };
  if (cmd === "help") return { kind: "help" };
  return { kind: "unknown", raw: trimmed };
}

export const HELP_TEXT = `Available commands:
  /end    Finish the chat gracefully. The full conversation will be
          summarized and passed to the next pipeline node.
  /abort  Abort the chat immediately. The pipeline will fail.
  /help   Show this message.

Type a regular message (no leading slash) to send it to Claude.`;
