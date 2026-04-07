# Stream Formatter Redesign

**Date:** 2026-04-07
**Status:** Approved

## Problem

The current `stream-formatter.ts` has three readability issues:

1. **Inverted subagent framing.** The implicit-close logic fires when the *next* `assistant` event arrives — but that event is the subagent's own work. This places subagent tool calls outside the `▶/◀` markers, under the MAIN AGENT header, with a telltale lower token count.

2. **Broken explicit close.** The formatter checks `event.type === "tool_result"` to close subagents, but the actual stream shape wraps tool_result inside a `user` event: `{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "..." }] } }`. The explicit close has never fired.

3. **Noisy ctx line.** `◈ ctx: N tokens` appears after every assistant message, including subagent messages, making it hard to track the main agent's context growth.

## Investigated Findings

Live stream-json capture confirms:

- Subagent `assistant` events carry `parent_tool_use_id` linking them to the originating `Agent` tool_use ID. Main agent events have no such field. This is reliable per-event identification — no heuristics needed.
- Parallel subagents are **interleaved** in the stream (events from concurrent subagents mix). Per-subagent attribution is not possible without `parent_tool_use_id` tagging, which is present but not sufficient to visually separate concurrent streams.
- Close events are `{ type: "user", message: { content: [{ type: "tool_result", ... }] } }`.

## Design

### State

```ts
export interface FormatterState {
  pendingSubagentIds: Set<string>;
  subagentBuffers: Map<string, string>;      // parent_tool_use_id → accumulated indented lines
  subagentDescriptions: Map<string, string>; // parent_tool_use_id → description for block header
  mainHeaderPrinted: boolean;
  lastMainCtxTotal: number;
}
```

`inSubagent` is removed — `parent_tool_use_id` on each event makes it redundant.

`initialState()` initializes both maps as empty.

### Event Flow

**`assistant` event, no `parent_tool_use_id` → main agent turn**

- Print `┌─ MAIN AGENT ───` header if `!mainHeaderPrinted`, set `mainHeaderPrinted = true`
- Render text blocks and tool calls as before
- For `Agent` tool_use blocks:
  - Print `▶ SUBAGENT: <description>` immediately
  - Store description: `subagentDescriptions.set(id, description)`
  - Initialize empty buffer: `subagentBuffers.set(id, "")`
  - Add `id` to `pendingSubagentIds`
- Compute `total = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
- If `total > lastMainCtxTotal`: print `◈ ctx: N tokens`, update `lastMainCtxTotal = total`

**`assistant` event, `parent_tool_use_id` present → subagent turn**

- Instead of printing indented lines to output, APPEND them to `subagentBuffers.get(parent_tool_use_id)`
- No header, no ctx, no immediate output
- State is updated with the new buffer content

**`user` event with `tool_result` content → subagent close**

- Walk `message.content` (top level only — close events always have `tool_result` at the top level of `message.content`), find blocks where `type === "tool_result"`
- When a matching ID is found: flush its buffer as a labeled block:
  ```
  \n┌─ SUBAGENT: <description> ─────────────────────────────\n
  <buffered lines>
  ◀ ──────────────────────────────────────────────────────\n\n
  ```
  Where `<description>` comes from `subagentDescriptions.get(id)` and the dashes fill to 56 chars total line width.
- Remove from `pendingSubagentIds`, `subagentBuffers`, and `subagentDescriptions`
- When set becomes empty: reset `mainHeaderPrinted = false`

**All other events** → ignored (no change from current behavior)

**Implicit close: removed entirely.** `parent_tool_use_id` replaces it.

**End-of-stream flush:** Export `flushState(state): string`. For each remaining pending ID, output its labeled block (same format as close — using `subagentDescriptions.get(id)` for the header). Called by `loop.ts` after readline closes, as a safety net for edge cases where the CLI drops close events. Returns `""` when no IDs are pending.

**State construction:** Export `initialState(): FormatterState` (already exists). Callers always construct state via this factory — no direct object construction.

### Example Output

```
┌─ MAIN AGENT ──────────────────────────────────────────
I'll study the specs and implementation in parallel.
▶ SUBAGENT: Study all specs files
▶ SUBAGENT: Study existing new.ts code
◈ ctx: 26,255 tokens

┌─ SUBAGENT: Study all specs files ─────────────────────
  → [glob] specs/**/*.md
  → [read] specs/architecture.md
◀ ──────────────────────────────────────────────────────

┌─ SUBAGENT: Study existing new.ts code ────────────────
  → [read] src/cli/commands/new.ts
◀ ──────────────────────────────────────────────────────

┌─ MAIN AGENT ──────────────────────────────────────────
Based on my research...
◈ ctx: 31,400 tokens
```

(ctx only appears when total grows; subagent content is buffered and flushed as labeled blocks on close; header resets after last subagent closes)

## Testing

### Fix existing tests

All test fixtures using `{ type: "tool_result", tool_use_id: "..." }` must be updated to the actual stream shape:
```ts
{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "..." }] } }
```

### New unit tests

- **Subagent detection via `parent_tool_use_id`:** assistant event with `parent_tool_use_id` set produces no immediate output; content is accumulated in buffer only.
- **Buffer accumulation:** multiple subagent events for the same `parent_tool_use_id` accumulate in the buffer with no immediate output.
- **On close, buffer flushed as labeled block:** when `user`/`tool_result` close event arrives, the buffer is flushed with the correct `┌─ SUBAGENT: <description>` header and `◀ ──────────` footer.
- **ctx growth gating:** ctx line appears when `total > lastMainCtxTotal`; suppressed when equal or lower; never appears for subagent events.
- **Parallel subagents each get their own labeled block in close order:** two Agent tool_uses dispatched in one message; events interleave with matching `parent_tool_use_id`; both close via `user`/`tool_result`; verify each gets a separate labeled block with its own description, in close order.
- **flushState:** flushes remaining buffers as labeled blocks with their descriptions; returns empty string when no pending IDs.

### Update scenario test

`scenario-tests/test-stream-formatter.sh` exercises the formatter end-to-end. Update expected output to match new block format (buffered subagent content flushed as labeled `┌─ SUBAGENT: <description>` / `◀ ──────` blocks, ctx only on growth, corrected `▶/◀` placement).

### Note for implementation plan

Review and update any other tests that reference stream-formatter behavior, tool_result event shapes, or subagent output markers — the `user`-wrapped close event and `parent_tool_use_id` detection are breaking changes to the existing mock structures.
