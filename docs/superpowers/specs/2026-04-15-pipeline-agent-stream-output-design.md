# Pipeline Agent Stream Output Design

**Date:** 2026-04-15
**Status:** Approved

## Goal

Combine `ralph implement` stream output markers into pipeline TUI agent nodes, giving visibility into main agent vs subagent activity and per-tool context window size — without affecting interactive agent node behavior or worsening the existing input flicker constraint.

## Background

`ralph implement` already renders these markers via `streamEvents()` + `StreamLine`:
- `▶▶▶ MAIN AGENT` / `◀◀◀ MAIN AGENT` — agent open/close
- `▶ SUBAGENT: name` / `◀ SUBAGENT` — subagent open/close
- `→ [tool_name] arg` — tool calls
- `◈ ctx: N tokens` — context window size after each tool group

The pipeline TUI currently renders agent node body as raw `BodyLine` objects (tool_use, text) extracted directly from stdout in the `onStdout` callback.

## Design

### Visual Change (agent nodes only)

Before:
```
━━ [1] run · agent ━━
  tool_use: Read
  tool_use: Write
```

After:
```
━━ [1] run · agent ━━
▶▶▶ MAIN AGENT
→ [Read] src/foo.ts
→ [Write] src/foo.ts
◈ ctx: 12450 tokens
▶ SUBAGENT: implement-task
→ [Bash] npm test
◈ ctx: 8200 tokens
◀ SUBAGENT
◀◀◀ MAIN AGENT
```

Non-agent nodes (tool, parallel, store, interactive) are unchanged.

### Implementation Approach (2 files)

**Constraint**: Interactive agent nodes use `runInteractive()` — `onStdout` is never called for them. The ChatUI overlay and flicker mitigations are untouched by this change.

**File 1: `src/cli/commands/pipeline.ts`**

Change the `onStdout` handler for agent nodes to pipe through `streamEvents()` instead of extracting raw body lines:

```typescript
// Before
onStdout: (line) => {
  const event = parseBodyLine(line);
  if (event) appendBodyLine(nodeId, event);
}

// After
onStdout: async (stdout) => {
  for await (const event of streamEvents(stdout, { onSessionId: () => {} })) {
    appendStreamEvent(nodeId, event);
  }
}
```

The `onStdout` signature may need to change from `(line: string) => void` to `(stdout: Readable) => void` if not already streaming. Check current signature in `agent-handler.ts` before implementing.

**File 2: `src/cli/components/PipelineApp.tsx`**

Accept and render `StreamEvent` items for agent nodes alongside existing Static items. Use the existing `StreamLine` component from `ui.tsx`:

```tsx
// Existing StreamLine import
import { StreamLine } from './ui';

// In Static items render
{item.type === 'stream_event' && <StreamLine event={item.event} />}
```

### Files NOT changed

- `src/attractor/handlers/registry.ts`
- `src/attractor/handlers/agent-handler.ts`
- `src/cli/lib/stream-formatter.ts`
- `src/cli/components/ui.tsx`
- `src/cli/commands/implement.ts`
- `src/cli/components/BlockView.tsx`

### Why body lines disappear naturally

Body lines for agent nodes are produced by the same `onStdout` handler being replaced. Switching the handler stops body line production automatically — no suppression logic needed.

## Flicker Safety

- Static items are append-only (no rerenders of prior content)
- `frozenCountRef` + `staticCloseSeen` in PipelineApp.tsx already prevent redraw cycles during interactive sessions
- Interactive nodes never call `onStdout` — zero stream events emitted during ChatUI sessions
- Net result: same or better flicker behavior vs current

## Testing

1. Run poc-implement pipeline with parallel subagents (CHUNK-4 task) — verify `▶ SUBAGENT:` markers appear per node
2. Verify interactive node still works (ChatUI appears, no flicker regression)
3. Verify non-agent nodes (tool/parallel/store) unchanged visually
4. Existing test suite passes (no behavior change in non-agent paths)
