import type { StreamJsonEvent } from "./stream-formatter.js";
import type { NodeEvent } from "./pipelineEvents.js";

/**
 * Translates one raw Claude Code stream-json event into zero or more NodeEvents.
 *
 * Pure: no side effects, no Ink, no subprocess. Safe to unit-test in isolation.
 *
 * Mapping:
 *  - assistant_delta  → one text event (role="claude")
 *  - tool_use         → one tool_use event with a short summary of inputs
 *  - system+sessionId → one trace-path event (adapter emits early; idempotent)
 *  - result           → [] (caller tracks turn closure via the absence of deltas)
 *  - tool_result      → [] (not currently rendered inline)
 *  - parse_error      → [] (logged by caller if needed)
 */
export function parseClaudeEvent(raw: StreamJsonEvent): NodeEvent[] {
  switch (raw.type) {
    case "assistant_delta":
      return [{ kind: "text", role: "claude", text: raw.textDelta }];
    case "tool_use":
      return [
        {
          kind: "tool_use",
          name: raw.toolCall.name,
          summary: summarizeToolInput(raw.toolCall.input),
        },
      ];
    case "system":
      return raw.sessionId
        ? [{ kind: "trace-path", sessionId: raw.sessionId }]
        : [];
    case "result":
    case "tool_result":
    case "parse_error":
      return [];
  }
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, 80);
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  } catch {
    return "";
  }
}
