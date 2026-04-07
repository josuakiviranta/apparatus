import * as readline from "readline";

export interface FormatterState {
  pendingSubagentIds: Set<string>;
  mainHeaderPrinted: boolean;
}

export function initialState(): FormatterState {
  return { pendingSubagentIds: new Set(), mainHeaderPrinted: false };
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

  // Close pending subagents when their tool_result arrives
  if (event.type === "tool_result") {
    const id = event.tool_use_id as string | undefined;
    if (id && state.pendingSubagentIds.has(id)) {
      const next: FormatterState = {
        pendingSubagentIds: new Set(state.pendingSubagentIds),
        mainHeaderPrinted: false,
      };
      next.pendingSubagentIds.delete(id);
      return { output: "◀ SUBAGENT DONE\n", nextState: next };
    }
    return { output: "", nextState: state };
  }

  if (event.type !== "assistant") {
    return { output: "", nextState: state };
  }

  type Usage = {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const msg = event.message as { content?: unknown[]; usage?: Usage } | undefined;
  const content = msg?.content ?? [];
  const usage = msg?.usage;

  let output = "";
  const nextPending = new Set(state.pendingSubagentIds);
  let nextHeaderPrinted = state.mainHeaderPrinted;

  // If there were pending subagents from last turn and no tool_result closed them,
  // close them now (CLI may not emit tool_result events)
  if (nextPending.size > 0) {
    for (const _id of nextPending) {
      output += "◀ SUBAGENT DONE\n";
    }
    nextPending.clear();
    nextHeaderPrinted = false;
  }

  // Skip events with no substantive content (no visible text or tool calls)
  const hasContent = content.some((b) => {
    const block = b as Record<string, unknown>;
    return (
      block.type === "tool_use" ||
      (block.type === "text" && String(block.text ?? "").trim().length > 0)
    );
  });

  if (!hasContent) {
    return { output, nextState: { pendingSubagentIds: nextPending, mainHeaderPrinted: nextHeaderPrinted } };
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
      } else {
        output += formatToolUse(name, input);
      }
    }
  }

  if (typeof usage?.input_tokens === "number") {
    const total =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    output += `◈ ctx: ${total.toLocaleString("en-US")} tokens\n`;
  }

  return { output, nextState: { pendingSubagentIds: nextPending, mainHeaderPrinted: nextHeaderPrinted } };
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
}
