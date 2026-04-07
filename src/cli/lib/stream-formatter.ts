import * as readline from "readline";

export interface FormatterState {
  pendingSubagentIds: Set<string>;
  subagentBuffers: Map<string, string>;      // parent_tool_use_id → accumulated indented lines
  subagentDescriptions: Map<string, string>; // parent_tool_use_id → description for block header
  mainHeaderPrinted: boolean;
  lastMainCtxTotal: number;
}

export function initialState(): FormatterState {
  return {
    pendingSubagentIds: new Set(),
    subagentBuffers: new Map(),
    subagentDescriptions: new Map(),
    mainHeaderPrinted: false,
    lastMainCtxTotal: 0,
  };
}

const HEADER = "┌─ MAIN AGENT ──────────────────────────────────────────\n";

function formatToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return `→ [read] ${input.file_path}\n`;
    case "Write":
      return `→ [write] ${input.file_path}\n`;
    case "Edit":
      return `→ [edit] ${input.file_path}\n`;
    case "Grep": {
      const path = input.path ? `  ${input.path}` : "";
      return `→ [grep] ${input.pattern}${path}\n`;
    }
    case "Glob":
      return `→ [glob] ${input.pattern}\n`;
    case "Bash": {
      const cmd = String(input.command ?? "");
      const truncated = cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
      return `→ [bash] ${truncated}\n`;
    }
    default:
      return `→ [tool] ${name}\n`;
  }
}

function formatSubagentBlock(desc: string, buf: string): string {
  const label = `┌─ SUBAGENT: ${desc} `;
  const totalWidth = 56;
  const dashes = "─".repeat(Math.max(0, totalWidth - label.length));
  return `\n${label}${dashes}\n${buf}◀ ${"─".repeat(totalWidth - 2)}\n\n`;
}

export function flushState(state: FormatterState): string {
  let output = "";
  for (const id of state.pendingSubagentIds) {
    const desc = state.subagentDescriptions.get(id) ?? "";
    const buf = state.subagentBuffers.get(id) ?? "";
    output += formatSubagentBlock(desc, buf);
  }
  return output;
}

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function processLine(
  line: string,
  state: FormatterState
): { output: string; nextState: FormatterState } {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { output: "", nextState: state };
  }

  // Handle user-wrapped tool_result events (subagent close)
  if (event.type === "user") {
    const msg = event.message as { content?: unknown[] } | undefined;
    const userContent = msg?.content ?? [];
    let output = "";
    const nextPending = new Set(state.pendingSubagentIds);
    const nextBuffers = new Map(state.subagentBuffers);
    const nextDescriptions = new Map(state.subagentDescriptions);
    let nextHeaderPrinted = state.mainHeaderPrinted;

    for (const item of userContent) {
      const block = item as Record<string, unknown>;
      if (block.type === "tool_result") {
        const id = String(block.tool_use_id ?? "");
        if (nextPending.has(id)) {
          const desc = nextDescriptions.get(id) ?? "";
          const buf = nextBuffers.get(id) ?? "";
          output += formatSubagentBlock(desc, buf);
          nextPending.delete(id);
          nextBuffers.delete(id);
          nextDescriptions.delete(id);
        }
      }
    }

    if (nextPending.size === 0 && state.pendingSubagentIds.size > 0) {
      nextHeaderPrinted = false;
    }

    return {
      output,
      nextState: {
        ...state,
        pendingSubagentIds: nextPending,
        subagentBuffers: nextBuffers,
        subagentDescriptions: nextDescriptions,
        mainHeaderPrinted: nextHeaderPrinted,
      },
    };
  }

  if (event.type !== "assistant") {
    return { output: "", nextState: state };
  }

  const msg = event.message as { content?: unknown[]; usage?: Usage } | undefined;
  const content = msg?.content ?? [];
  const usage = msg?.usage;
  const parentToolUseId = event.parent_tool_use_id as string | undefined;

  // Subagent assistant events: buffer instead of printing
  if (parentToolUseId) {
    const hasContent = content.some((b) => {
      const block = b as Record<string, unknown>;
      return (
        block.type === "tool_use" ||
        (block.type === "text" && String(block.text ?? "").trim().length > 0)
      );
    });
    if (!hasContent) return { output: "", nextState: state };

    const nextBuffers = new Map(state.subagentBuffers);
    let buf = nextBuffers.get(parentToolUseId) ?? "";
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type === "text") {
        buf += "  " + String(b.text) + "\n";
      } else if (b.type === "tool_use") {
        const name = String(b.name);
        const input = (b.input ?? {}) as Record<string, unknown>;
        buf += "  " + formatToolUse(name, input);
      }
    }
    nextBuffers.set(parentToolUseId, buf);
    return {
      output: "",
      nextState: { ...state, subagentBuffers: nextBuffers },
    };
  }

  // Main agent assistant events
  let output = "";
  const nextPending = new Set(state.pendingSubagentIds);
  const nextBuffers = new Map(state.subagentBuffers);
  const nextDescriptions = new Map(state.subagentDescriptions);
  let nextHeaderPrinted = state.mainHeaderPrinted;
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
      output,
      nextState: {
        pendingSubagentIds: nextPending,
        subagentBuffers: nextBuffers,
        subagentDescriptions: nextDescriptions,
        mainHeaderPrinted: nextHeaderPrinted,
        lastMainCtxTotal: nextLastMainCtxTotal,
      },
    };
  }

  // Print header only once per logical turn (reset after subagent or at start)
  if (!nextHeaderPrinted) {
    output += HEADER;
    nextHeaderPrinted = true;
  }

  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text") {
      output += String(b.text) + "\n";
    } else if (b.type === "tool_use") {
      const name = String(b.name);
      const input = (b.input ?? {}) as Record<string, unknown>;
      if (name === "Agent") {
        const desc = String(input.description ?? input.prompt ?? "");
        output += `▶ SUBAGENT: ${desc}\n`;
        nextPending.add(String(b.id));
        nextDescriptions.set(String(b.id), desc);
        nextBuffers.set(String(b.id), "");
      } else {
        output += formatToolUse(name, input);
      }
    }
  }

  // Gate ctx line on growth — only print when total increases
  if (typeof usage?.input_tokens === "number") {
    const total =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (total > state.lastMainCtxTotal) {
      output += `◈ ctx: ${total.toLocaleString("en-US")} tokens\n`;
      nextLastMainCtxTotal = total;
    }
  }

  return {
    output,
    nextState: {
      pendingSubagentIds: nextPending,
      subagentBuffers: nextBuffers,
      subagentDescriptions: nextDescriptions,
      mainHeaderPrinted: nextHeaderPrinted,
      lastMainCtxTotal: nextLastMainCtxTotal,
    },
  };
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
    const { output, nextState } = processLine(line, state);
    state = nextState;
    if (output) process.stdout.write(output);
  });
  rl.on("close", () => {
    const flush = flushState(state);
    if (flush) process.stdout.write(flush);
  });
}
