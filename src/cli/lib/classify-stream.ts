// Two-layer classifier for Claude CLI's stream-json NDJSON output.
//
// Layer 1: classifyLine — turns one NDJSON line into a typed event union.
// Layer 2: classifyBlock — narrows a `message.content[]` element to a typed
// payload. Both consumers (TUI formatter `processLine`, raw iterator
// `parseStreamJsonEvents`) call these instead of inlining JSON.parse and
// per-block walks. State machine policy and wire-format projection stay
// with their respective owners in stream-formatter.ts.

export type ClassifiedEvent =
  | { kind: "system"; sessionId?: string; raw: Record<string, unknown> }
  | {
      kind: "assistant";
      messageId?: string;
      parentToolUseId?: string;
      content: unknown[];
      usage?: Record<string, unknown>;
    }
  | { kind: "user"; content: unknown[] }
  | {
      kind: "result";
      stopReason: string;
      text: string;
      usage: Record<string, unknown>;
      raw: Record<string, unknown>;
    }
  | { kind: "parse_error"; rawLine: string; error: string }
  | { kind: "unknown"; raw: Record<string, unknown> };

export type ClassifiedBlock =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; content: unknown; isError: boolean }
  | { kind: "unknown"; raw: Record<string, unknown> };

export function classifyLine(line: string): ClassifiedEvent {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    return { kind: "parse_error", rawLine: line, error: (err as Error).message };
  }

  const t = event.type;

  if (t === "system") {
    return {
      kind: "system",
      sessionId: typeof event.session_id === "string" ? event.session_id : undefined,
      raw: event,
    };
  }

  if (t === "assistant") {
    const msg = (event.message ?? {}) as Record<string, unknown>;
    return {
      kind: "assistant",
      messageId: typeof msg.id === "string" ? msg.id : undefined,
      parentToolUseId:
        typeof event.parent_tool_use_id === "string" ? event.parent_tool_use_id : undefined,
      content: Array.isArray(msg.content) ? (msg.content as unknown[]) : [],
      usage: (msg.usage ?? undefined) as Record<string, unknown> | undefined,
    };
  }

  if (t === "user") {
    const msg = (event.message ?? {}) as Record<string, unknown>;
    return {
      kind: "user",
      content: Array.isArray(msg.content) ? (msg.content as unknown[]) : [],
    };
  }

  if (t === "result") {
    return {
      kind: "result",
      stopReason: typeof event.stop_reason === "string" ? event.stop_reason : "",
      text: typeof event.result === "string" ? event.result : "",
      usage: (event.usage ?? {}) as Record<string, unknown>,
      raw: event,
    };
  }

  return { kind: "unknown", raw: event };
}

export function classifyBlock(block: unknown): ClassifiedBlock {
  if (!block || typeof block !== "object") {
    return { kind: "unknown", raw: {} };
  }
  const b = block as Record<string, unknown>;

  if (b.type === "text") {
    if (typeof b.text === "string") return { kind: "text", text: b.text };
    return { kind: "unknown", raw: b };
  }

  if (b.type === "tool_use") {
    return {
      kind: "tool_use",
      id: typeof b.id === "string" ? b.id : "",
      name: typeof b.name === "string" ? b.name : "",
      input: b.input,
    };
  }

  if (b.type === "tool_result") {
    return {
      kind: "tool_result",
      toolUseId: typeof b.tool_use_id === "string" ? b.tool_use_id : "",
      content: b.content,
      isError: b.is_error === true,
    };
  }

  return { kind: "unknown", raw: b };
}
