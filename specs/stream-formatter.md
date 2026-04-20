# Stream Formatter

`src/cli/lib/stream-formatter.ts` processes Claude's `--output-format=stream-json` output into human-readable terminal output. It is a pure functional module — no side effects, no I/O.

## Interface

```typescript
processLine(line: string, state: FormatterState): { output: string; nextState: FormatterState }
initialState(): FormatterState
flushState(state: FormatterState): string
```

Used by `loop.ts` via readline: each line from claude's stdout is passed to `processLine()`. After the stream closes, `flushState()` is called to flush any buffered subagent output.

## State

```typescript
export interface FormatterState {
  pendingSubagentIds: Set<string>;          // IDs of active subagents awaiting close
  subagentBuffers: Map<string, string>;     // parent_tool_use_id → accumulated indented lines
  subagentDescriptions: Map<string, string>; // parent_tool_use_id → description for block header
  mainAgentOpen: boolean;                   // whether ▶▶▶ MAIN AGENT header printed for current turn
  lastMainCtxTotal: number;                 // last observed ctx total; gates growth printing
}
```

`initialState()` returns all fields empty/false/0.

## Event Handling

| Event type | Condition | Action |
|------------|-----------|--------|
| `user` | `message.content[]` contains `type: "tool_result"` with known ID | Flush subagent buffer as labeled block; remove from pending; reset `mainAgentOpen` when pending empties |
| `assistant` | `parent_tool_use_id` present | Buffer content (text + tool calls) under that ID; no output |
| `assistant` | No `parent_tool_use_id` | Print `▶▶▶ MAIN AGENT` header (once), render content, emit ctx line if grown |
| Any other type | — | Silently ignored |

Events with no substantive content (no `tool_use` and no non-empty `text`) are silently skipped.

## Output Format

Main agent turn:
```
▶▶▶ MAIN AGENT
<text content>
→ [read] <file_path>
→ [write] <file_path>
→ [edit] <file_path>
→ [grep] <pattern>  [path]
→ [glob] <pattern>
→ [bash] <command>          (truncated at 80 chars with …)
→ [tool] <name>             (all other tools)
▶ SUBAGENT: <description>
◈ ctx: N,NNN tokens         (only when total > lastMainCtxTotal)
◀◀◀ MAIN AGENT
```

Subagent block (flushed on close):
```
▶ SUBAGENT: <description>
  → [glob] **/*.ts
  <indented buffered content>
◀ SUBAGENT
```

## Subagent Buffering

When the main agent dispatches an `Agent` tool call, `▶ SUBAGENT: <description>` is printed immediately; the ID is added to `pendingSubagentIds`, the description stored in `subagentDescriptions`, an empty buffer initialized in `subagentBuffers`.

Subsequent `assistant` events with a matching `parent_tool_use_id` have their content accumulated into that buffer (indented 2 spaces) — no immediate output.

On `user`/`tool_result` close, the buffer is flushed as a labeled block. When all pending IDs close, `mainAgentOpen` resets to `false`.

`flushState(state)` flushes any still-pending buffers at end-of-stream (safety net for dropped close events).

## Standalone Usage

The file also includes a stdin/stdout main-entry-point block (bottom of file) that runs when invoked directly as a script, allowing it to be used as a standalone pipe filter.
