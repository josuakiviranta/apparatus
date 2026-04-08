import * as readline from "readline";

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
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (typeof parsed.session_id === "string") {
          opts.onSessionId(parsed.session_id);
          sessionIdEmitted = true;
        }
      } catch {}
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
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { events: [], nextState: state };
  }

  // Handle user-wrapped tool_result events (subagent close)
  if (event.type === "user") {
    const msg = event.message as { content?: unknown[] } | undefined;
    const userContent = msg?.content ?? [];
    const events: StreamEvent[] = [];
    const nextPending = new Set(state.pendingSubagentIds);
    const nextBuffers = new Map(state.subagentBuffers);
    const nextDescriptions = new Map(state.subagentDescriptions);
    const nextMainAgentOpen = state.mainAgentOpen;

    for (const item of userContent) {
      const block = item as Record<string, unknown>;
      if (block.type === "tool_result") {
        const id = String(block.tool_use_id ?? "");
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

  if (event.type !== "assistant") {
    return { events: [], nextState: state };
  }

  const msg = event.message as { content?: unknown[]; usage?: Usage } | undefined;
  const content = msg?.content ?? [];
  const usage = msg?.usage;
  const parentToolUseId = event.parent_tool_use_id as string | undefined;

  // Subagent assistant events: buffer instead of emitting
  if (parentToolUseId) {
    const hasContent = content.some((b) => {
      const block = b as Record<string, unknown>;
      return (
        block.type === "tool_use" ||
        (block.type === "text" && String(block.text ?? "").trim().length > 0)
      );
    });
    if (!hasContent) return { events: [], nextState: state };

    const nextBuffers = new Map(state.subagentBuffers);
    let buf = nextBuffers.get(parentToolUseId) ?? [];
    buf = [...buf]; // clone
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === "text") {
        buf.push({ type: "text", content: String(b.text), indented: true });
      } else if (b.type === "tool_use") {
        const name = String(b.name);
        const input = (b.input ?? {}) as Record<string, unknown>;
        const toolEvent = formatToolUse(name, input);
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
    const block = b as Record<string, unknown>;
    return (
      block.type === "tool_use" ||
      (block.type === "text" && String(block.text ?? "").trim().length > 0)
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

  // Check if any content blocks are non-Agent (text or non-Agent tool_use)
  const hasNonAgentContent = content.some((b) => {
    const block = b as Record<string, unknown>;
    return block.type !== "tool_use" || String((block as any).name) !== "Agent";
  });
  if (hasNonAgentContent && !nextMainAgentOpen) {
    events.push({ type: "main_agent_open" });
    nextMainAgentOpen = true;
  }

  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text") {
      events.push({ type: "text", content: String(b.text) });
    } else if (b.type === "tool_use") {
      const name = String(b.name);
      const input = (b.input ?? {}) as Record<string, unknown>;
      if (name === "Agent") {
        const desc = String(input.description ?? input.prompt ?? "");
        if (nextMainAgentOpen) {
          events.push({ type: "main_agent_close" });
          nextMainAgentOpen = false;
        }
        // Subagent header is deferred to close time
        nextPending.add(String(b.id));
        nextDescriptions.set(String(b.id), desc);
        nextBuffers.set(String(b.id), []);
      } else {
        events.push(formatToolUse(name, input));
      }
    }
  }

  // Gate ctx line on growth -- only emit when total increases and main agent is open
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
