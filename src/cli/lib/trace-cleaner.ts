/**
 * Pure read-time filter for the Claude Code raw-attempt JSONL stream
 * (or any JSONL stream sharing the same frame shape). Drops subprocess-boot
 * ceremony that has no diagnostic value in the default render. See design
 * doc `2026-05-18-trace-renderer-strips-hook-ceremony-by-default-design.md`
 * §3.2 for the deny list.
 */

export interface JsonlLine {
  type?: string;
  subtype?: string;
  kind?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string }>;
  };
  output?: string;
  additional_context?: unknown;
  [k: string]: unknown;
}

const DROP_SUBTYPES_FOR_SYSTEM = new Set(["hook_started", "hook_response"]);

function isAssistantToolResultEcho(line: JsonlLine): boolean {
  if (line.type !== "assistant") return false;
  const content = line.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(c => c?.type === "tool_result");
}

function stripAdditionalContext(line: JsonlLine): JsonlLine {
  if (!("additional_context" in line)) return line;
  const { additional_context: _drop, ...rest } = line;
  return rest as JsonlLine;
}

/**
 * Deny-list pass over a parsed JSONL frame array.
 *
 * Rules:
 *   1. {type:"system", subtype:"hook_started"|"hook_response"}  → drop frame
 *   2. {type:"rate_limit_event"}                                 → drop frame
 *   3. {type:"system", subtype:<anything else>}                  → keep, strip `additional_context`
 *   4. {type:"assistant", message.content[*].type:"tool_result"} → drop frame
 *
 * Unknown frames pass through unchanged.
 * Pure: input array is not mutated; new array returned.
 */
export function cleanJsonlEvents(lines: JsonlLine[]): JsonlLine[] {
  const out: JsonlLine[] = [];
  for (const line of lines) {
    if (line.type === "system" && typeof line.subtype === "string" && DROP_SUBTYPES_FOR_SYSTEM.has(line.subtype)) {
      continue;
    }
    if (line.type === "rate_limit_event") continue;
    if (isAssistantToolResultEcho(line)) continue;
    if (line.type === "system") {
      out.push(stripAdditionalContext(line));
      continue;
    }
    out.push(line);
  }
  return out;
}
