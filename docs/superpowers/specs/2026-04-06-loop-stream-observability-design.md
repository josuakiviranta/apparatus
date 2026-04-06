# Loop Stream Observability Design

**Date:** 2026-04-06
**Status:** Approved

## Problem

`loop.sh` currently pipes claude's `--output-format=stream-json` through a minimal jq filter that shows assistant text and bare tool names. Three things are invisible:

1. Which files are being read/written/edited
2. Whether the active agent is the main agent or a subagent, and what task the subagent was given
3. How many tokens are in the main agent's context window at each turn

## Solution

A TypeScript module `src/cli/lib/stream-formatter.ts` compiled to `dist/cli/lib/stream-formatter.js` by tsup. `loop.sh` pipes claude's stdout through it instead of jq.

## Architecture & Integration

`stream-formatter.ts` is a Node.js script that reads stream-json line-by-line from stdin and writes formatted lines to stdout. It maintains state within a single stream invocation to track pending subagent `tool_use_id`s.

`assets.ts` gets a new `resolveStreamFormatter()` export that resolves the bundled path using the same prod/dev detection pattern as existing asset resolvers. The `implement` command passes this path to `loop.sh` as the environment variable `RALPH_STREAM_FORMATTER`, consistent with how `loop.sh` already receives context via environment. `loop.sh` replaces the jq pipe with:

```bash
| node "$RALPH_STREAM_FORMATTER" 2>/dev/null
```

If `RALPH_STREAM_FORMATTER` is unset, `loop.sh` falls back to the existing jq filter so the script remains usable standalone.

## Event Handling

The formatter processes `--output-format=stream-json` events as follows:

**`assistant` message** — for each item in `content[]`:
- `type == "text"` → print text as-is
- `type == "tool_use"`, name `Read` → `→ [read] <input.file_path>`
- `type == "tool_use"`, name `Write` → `→ [write] <input.file_path>`
- `type == "tool_use"`, name `Edit` → `→ [edit] <input.file_path>`
- `type == "tool_use"`, name `Grep` → `→ [grep] <input.pattern>  <input.path ?? ''>`
- `type == "tool_use"`, name `Glob` → `→ [glob] <input.pattern>`
- `type == "tool_use"`, name `Bash` → `→ [bash] <input.command>` (truncated to 80 chars with `…` suffix if longer)
- `type == "tool_use"`, name `Agent` → `▶ SUBAGENT: <input.description>` + store `id` in pending set
- `type == "tool_use"`, any other name → `→ [tool] <name>`
- after all content items: emit `◈ ctx: <usage.input_tokens> tokens` — if `usage` is absent or null, omit this line silently

**`tool_result`** — if `tool_use_id` is in pending subagent set → emit `◀ SUBAGENT DONE`, remove from set. Otherwise discard silently.

**All other types** (`system`, `result`, etc.) — silently ignored.

## Output Format

Each assistant turn:

```
┌─ MAIN AGENT ──────────────────────────────────────────
I'll start by reading the implementation plan and then...

→ [read] docs/superpowers/plans/2026-04-03-ralph-cli.md
→ [read] src/cli/commands/implement.ts
→ [bash] npm test -- --run smoke

▶ SUBAGENT: Explore authentication patterns in src/lib
◀ SUBAGENT DONE

→ [tool] TodoWrite
◈ ctx: 12,847 tokens
```

Key decisions:
- `┌─ MAIN AGENT ──` header clearly marks every main-agent turn
- `◈ ctx: N tokens` always appears at end of turn, after all tool calls
- `▶`/`◀` are visually distinct from `→` so subagent boundaries stand out at a glance
- No color codes — clean in log files and non-TTY contexts

## Files Changed

| File | Change |
|------|--------|
| `src/cli/lib/stream-formatter.ts` | New — the formatter module |
| `src/cli/lib/assets.ts` | Add `resolveStreamFormatter()` |
| `loop.sh` | Replace jq pipe with `node "$STREAM_FORMATTER"` |
| `src/cli/commands/implement.ts` | Pass stream formatter path to loop.sh |
| `src/cli/tests/stream-formatter.test.ts` | New — unit tests for event handling |

## Out of Scope

- Subagent intermediate steps (file reads, tool calls inside subagents) — not visible in the parent stream
- Color/TTY detection
- Log file output
