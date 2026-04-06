import * as readline from "readline";

export interface FormatterState {
  pendingSubagentIds: Set<string>;
}

export function initialState(): FormatterState {
  return { pendingSubagentIds: new Set() };
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
      const next: FormatterState = { pendingSubagentIds: new Set(state.pendingSubagentIds) };
      next.pendingSubagentIds.delete(id);
      return { output: "◀ SUBAGENT DONE\n", nextState: next };
    }
    return { output: "", nextState: state };
  }

  if (event.type !== "assistant") {
    return { output: "", nextState: state };
  }

  const msg = event.message as { content?: unknown[]; usage?: { input_tokens?: number } } | undefined;
  const content = msg?.content ?? [];
  const usage = msg?.usage;

  let output = "";
  const nextPending = new Set(state.pendingSubagentIds);

  // If there were pending subagents from last turn and no tool_result closed them,
  // close them now (CLI may not emit tool_result events)
  if (nextPending.size > 0) {
    for (const _id of nextPending) {
      output += "◀ SUBAGENT DONE\n";
    }
    nextPending.clear();
  }

  output += HEADER;

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
    output += `◈ ctx: ${usage.input_tokens.toLocaleString("en-US")} tokens\n`;
  }

  return { output, nextState: { pendingSubagentIds: nextPending } };
}

// Only run as main entry point when executed directly
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`
) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let state = initialState();
  rl.on("line", (line) => {
    const { output, nextState } = processLine(line, state);
    state = nextState;
    if (output) process.stdout.write(output);
  });
}
