import * as readline from "readline";
import { classifyLine, classifyBlock } from "./classify-stream.js";

export type StreamEvent =
  | { type: "main_agent_open" }
  | { type: "main_agent_close" }
  | { type: "subagent_open"; description: string }
  | { type: "subagent_close" }
  | { type: "text"; content: string; indented?: boolean }
  | { type: "tool"; name: string; label: string; indented?: boolean }
  | { type: "ctx"; tokens: number };

export interface FormatterState {
  pendingSubagentIds: Set<string>;
  subagentBuffers: Map<string, StreamEvent[]>;      // parent_tool_use_id → accumulated events
  subagentDescriptions: Map<string, string>; // parent_tool_use_id → description for block header
  mainAgentOpen: boolean;
  lastMainCtxTotal: number;
}

export function initialState(): FormatterState {
  return {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainAgentOpen: false,
    lastMainCtxTotal: 0,
  };
}

// json_schema agents emit their result as a single JSON blob like
// `{"explainer_render":"…markdown…"}`. When the object has exactly one
// string-valued property, unwrap to the inner markdown so renderMarkdown
// in the UI can format it. Multi-field structured outputs fall through
// unchanged (showing the JSON) — we don't pick a field.
function unwrapStructuredText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return text;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;
    const keys = Object.keys(parsed);
    if (keys.length === 1 && typeof parsed[keys[0]] === "string") {
      return parsed[keys[0]] as string;
    }
  } catch { /* not valid JSON — emit raw */ }
  return text;
}

function formatToolUse(name: string, input: Record<string, unknown>): Extract<StreamEvent, { type: "tool" }> {
  switch (name) {
    case "Read":
      return { type: "tool", name: "read", label: String(input.file_path) };
    case "Write":
      return { type: "tool", name: "write", label: String(input.file_path) };
    case "Edit":
      return { type: "tool", name: "edit", label: String(input.file_path) };
    case "Grep": {
      const path = input.path ? `  ${input.path}` : "";
      return { type: "tool", name: "grep", label: `${input.pattern}${path}` };
    }
    case "Glob":
      return { type: "tool", name: "glob", label: String(input.pattern) };
    case "Bash": {
      const cmd = String(input.command ?? "");
      const truncated = cmd.length > 80 ? cmd.slice(0, 80) + "\u2026" : cmd;
      return { type: "tool", name: "bash", label: truncated };
    }
    default:
      return { type: "tool", name: "tool", label: name };
  }
}

export function flushState(state: FormatterState): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const id of state.pendingSubagentIds) {
    const desc = state.subagentDescriptions.get(id) ?? "";
    const buf = state.subagentBuffers.get(id) ?? [];
    events.push({ type: "subagent_open", description: desc });
    events.push(...buf);
    events.push({ type: "subagent_close" });
  }
  if (state.mainAgentOpen) {
    events.push({ type: "main_agent_close" });
  }
  return events;
}

export async function* streamEvents(
  readable: NodeJS.ReadableStream,
  opts?: { onSessionId?: (id: string) => void }
): AsyncGenerator<StreamEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let state = initialState();
  let sessionIdEmitted = false;

  for await (const line of rl) {
    if (!sessionIdEmitted && opts?.onSessionId) {
      const sniff = classifyLine(line);
      if (sniff.kind === "system" && typeof sniff.sessionId === "string") {
        opts.onSessionId(sniff.sessionId);
        sessionIdEmitted = true;
      }
    }
    const { events, nextState } = processLine(line, state);
    state = nextState;
    for (const e of events) yield e;
  }

  for (const e of flushState(state)) yield e;
}

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function processLine(
  line: string,
  state: FormatterState
): { events: StreamEvent[]; nextState: FormatterState } {
  const ev = classifyLine(line);

  // Non-actionable line kinds: parse_error, system, result, unknown.
  // Today's TUI swallows JSON parse failures (returns empty events) and
  // does not render system/result/unknown — preserve that.
  if (
    ev.kind === "parse_error" ||
    ev.kind === "system" ||
    ev.kind === "result" ||
    ev.kind === "unknown"
  ) {
    return { events: [], nextState: state };
  }

  // user-wrapped tool_result events (subagent close)
  if (ev.kind === "user") {
    const events: StreamEvent[] = [];
    const nextPending = new Set(state.pendingSubagentIds);
    const nextBuffers = new Map(state.subagentBuffers);
    const nextDescriptions = new Map(state.subagentDescriptions);
    const nextMainAgentOpen = state.mainAgentOpen;

    for (const item of ev.content) {
      const block = classifyBlock(item);
      if (block.kind === "tool_result") {
        const id = block.toolUseId;
        if (nextPending.has(id)) {
          const desc = nextDescriptions.get(id) ?? "";
          const buf = nextBuffers.get(id) ?? [];
          events.push({ type: "subagent_open", description: desc });
          events.push(...buf);
          events.push({ type: "subagent_close" });
          nextPending.delete(id);
          nextBuffers.delete(id);
          nextDescriptions.delete(id);
        }
      }
    }

    return {
      events,
      nextState: {
        ...state,
        pendingSubagentIds: nextPending,
        subagentBuffers: nextBuffers,
        subagentDescriptions: nextDescriptions,
        mainAgentOpen: nextMainAgentOpen,
      },
    };
  }

  // assistant
  const content = ev.content;
  const usage = ev.usage as Usage | undefined;
  const parentToolUseId = ev.parentToolUseId;

  // Subagent assistant events: buffer instead of emitting
  if (parentToolUseId) {
    const hasContent = content.some((b) => {
      const block = classifyBlock(b);
      return (
        block.kind === "tool_use" ||
        (block.kind === "text" && block.text.trim().length > 0)
      );
    });
    if (!hasContent) return { events: [], nextState: state };

    const nextBuffers = new Map(state.subagentBuffers);
    let buf = nextBuffers.get(parentToolUseId) ?? [];
    buf = [...buf]; // clone
    for (const raw of content) {
      const block = classifyBlock(raw);
      if (block.kind === "text") {
        buf.push({ type: "text", content: unwrapStructuredText(block.text), indented: true });
      } else if (block.kind === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const toolEvent = formatToolUse(block.name, input);
        buf.push({ ...toolEvent, indented: true });
      }
    }
    nextBuffers.set(parentToolUseId, buf);
    return {
      events: [],
      nextState: { ...state, subagentBuffers: nextBuffers },
    };
  }

  // Main agent assistant events
  const events: StreamEvent[] = [];
  const nextPending = new Set(state.pendingSubagentIds);
  const nextBuffers = new Map(state.subagentBuffers);
  const nextDescriptions = new Map(state.subagentDescriptions);
  let nextMainAgentOpen = state.mainAgentOpen;
  let nextLastMainCtxTotal = state.lastMainCtxTotal;

  // Skip events with no substantive content (no visible text or tool calls)
  const hasContent = content.some((b) => {
    const block = classifyBlock(b);
    return (
      block.kind === "tool_use" ||
      (block.kind === "text" && block.text.trim().length > 0)
    );
  });

  if (!hasContent) {
    return {
      events,
      nextState: {
        pendingSubagentIds: nextPending,
        subagentBuffers: nextBuffers,
        subagentDescriptions: nextDescriptions,
        mainAgentOpen: nextMainAgentOpen,
        lastMainCtxTotal: nextLastMainCtxTotal,
      },
    };
  }

  // Open main agent block when any content is non-Agent
  const hasNonAgentContent = content.some((b) => {
    const block = classifyBlock(b);
    return block.kind !== "tool_use" || block.name !== "Agent";
  });
  if (hasNonAgentContent && !nextMainAgentOpen) {
    events.push({ type: "main_agent_open" });
    nextMainAgentOpen = true;
  }

  for (const raw of content) {
    const block = classifyBlock(raw);
    if (block.kind === "text") {
      events.push({ type: "text", content: unwrapStructuredText(block.text) });
    } else if (block.kind === "tool_use") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (block.name === "Agent") {
        const desc = String(input.description ?? input.prompt ?? "");
        if (nextMainAgentOpen) {
          events.push({ type: "main_agent_close" });
          nextMainAgentOpen = false;
        }
        // Subagent header is deferred to close time
        nextPending.add(block.id);
        nextDescriptions.set(block.id, desc);
        nextBuffers.set(block.id, []);
      } else {
        events.push(formatToolUse(block.name, input));
      }
    }
  }

  // Gate ctx line on growth — only emit when total increases and main agent is open
  if (nextMainAgentOpen && typeof usage?.input_tokens === "number") {
    const total =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (total > state.lastMainCtxTotal) {
      events.push({ type: "ctx", tokens: total });
      nextLastMainCtxTotal = total;
    }
  }

  return {
    events,
    nextState: {
      pendingSubagentIds: nextPending,
      subagentBuffers: nextBuffers,
      subagentDescriptions: nextDescriptions,
      mainAgentOpen: nextMainAgentOpen,
      lastMainCtxTotal: nextLastMainCtxTotal,
    },
  };
}

export function serializeEvent(ev: StreamEvent): string {
  switch (ev.type) {
    case "main_agent_open":
      return "\u25b6\u25b6\u25b6 MAIN AGENT\n";
    case "main_agent_close":
      return "\u25c0\u25c0\u25c0 MAIN AGENT\n\n";
    case "subagent_open":
      return `\u25b6 SUBAGENT: ${ev.description}\n`;
    case "subagent_close":
      return "\u25c0 SUBAGENT\n";
    case "text":
      return (ev.indented ? "  " : "") + ev.content + "\n";
    case "tool":
      return (ev.indented ? "  " : "") + `\u2192 [${ev.name}] ${ev.label}\n`;
    case "ctx":
      return `\u25c8 ctx: ${ev.tokens.toLocaleString("en-US")} tokens\n`;
  }
}

// =============================================================================
// Raw stream-json event iterator for interactive chat (Path 1.5)
// =============================================================================
//
// Lower-level parser than streamEvents() above. Yields a typed union that
// preserves the raw shape of Claude CLI's stream-json output so ChatUI can
// display text deltas and inspect stop_reason/usage directly.

import type { ToolCall, Usage as SessionUsage } from "./session.js";

export type StreamJsonEvent =
  | { type: "system"; sessionId?: string; raw: unknown }
  | { type: "assistant_delta"; textDelta: string; messageId?: string }
  | { type: "tool_use"; toolCall: ToolCall; messageId?: string }
  | { type: "tool_result"; toolCallId: string; content: string; isError: boolean }
  | {
      type: "result";
      stopReason: "end_turn" | "turn_limit" | "abort" | "error" | string;
      text: string;
      usage: SessionUsage;
      raw: unknown;
    }
  | { type: "parse_error"; rawLine: string; error: string };

function coerceSessionUsage(u: unknown): SessionUsage {
  const obj = (u ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    inputTokens: n(obj.input_tokens),
    outputTokens: n(obj.output_tokens),
    cacheReadTokens: typeof obj.cache_read_input_tokens === "number" ? obj.cache_read_input_tokens : undefined,
    cacheWriteTokens: typeof obj.cache_creation_input_tokens === "number" ? obj.cache_creation_input_tokens : undefined,
  };
}

export async function* parseStreamJsonEvents(
  readable: NodeJS.ReadableStream,
): AsyncGenerator<StreamJsonEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;

    const ev = classifyLine(line);

    if (ev.kind === "parse_error") {
      yield { type: "parse_error", rawLine: ev.rawLine, error: ev.error };
      continue;
    }

    if (ev.kind === "system") {
      yield { type: "system", sessionId: ev.sessionId, raw: ev.raw };
      continue;
    }

    if (ev.kind === "assistant") {
      for (const raw of ev.content) {
        const block = classifyBlock(raw);
        if (block.kind === "text") {
          yield { type: "assistant_delta", textDelta: block.text, messageId: ev.messageId };
        } else if (block.kind === "tool_use") {
          yield {
            type: "tool_use",
            toolCall: { id: block.id, name: block.name, input: block.input },
            messageId: ev.messageId,
          };
        }
      }
      continue;
    }

    if (ev.kind === "user") {
      for (const raw of ev.content) {
        const block = classifyBlock(raw);
        if (block.kind === "tool_result") {
          yield {
            type: "tool_result",
            toolCallId: block.toolUseId,
            content:
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? ""),
            isError: block.isError,
          };
        }
      }
      continue;
    }

    if (ev.kind === "result") {
      yield {
        type: "result",
        stopReason: ev.stopReason || "end_turn",
        text: ev.text,
        usage: coerceSessionUsage(ev.usage),
        raw: ev.raw,
      };
      continue;
    }

    // ev.kind === "unknown" — forward-compat with CLI updates (matches the
    // pre-rewire silent fall-through at the old :417).
  }
}

// Only run as main entry point when executed directly.
// Note: cannot use import.meta.url comparison because tsup moves this code
// into a shared chunk whose URL differs from process.argv[1].
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  /stream-formatter\.(js|ts)$/.test(process.argv[1])
) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let state = initialState();
  rl.on("line", (line) => {
    const { events, nextState } = processLine(line, state);
    state = nextState;
    for (const ev of events) {
      process.stdout.write(serializeEvent(ev));
    }
  });
  rl.on("close", () => {
    const events = flushState(state);
    for (const ev of events) {
      process.stdout.write(serializeEvent(ev));
    }
  });
}
