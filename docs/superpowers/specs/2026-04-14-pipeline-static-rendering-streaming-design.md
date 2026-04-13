# Pipeline Static Rendering + Streaming Text Design

**Date:** 2026-04-14
**Status:** Approved

## Overview

Two targeted improvements to the pipeline TUI:

1. **Flicker fix** — Wrap completed (frozen) pipeline blocks in Ink's `<Static>` so they are committed permanently to the terminal and never repainted.
2. **Streaming text for json_schema nodes** — Switch `json_schema_file` agent nodes from `--output-format json` (buffered) to `stream-json` so text deltas flow to the TUI in real-time. JSON is extracted from the accumulated text at completion.

Both changes are self-contained. They touch two files in production code (`PipelineApp.tsx`, `agent.ts`) and add two smoke pipelines.

## Architecture

### Current rendering model

```
PipelineApp (useState)
  ├── state.frozen[]  → re-renders on every event (flicker source)
  └── state.live      → dynamic, correct
```

### New rendering model

```
PipelineApp
  ├── <Static> items={state.frozen}  → renders once, permanently committed
  │     └── BlockView per frozen block
  └── <LiveFooter> block={liveForRender}  → dynamic, unchanged
```

The pipeline header (name · PID · goal · nodes banner) also moves into `<Static>` since it never changes after mount.

## Components

### `src/cli/components/PipelineApp.tsx`

- Wrap the pipeline header `<Box>` in `<Static items={[header]}>` (renders once)
- Wrap `state.frozen.map(...)` in `<Static items={state.frozen}>`. Ink's `<Static>` children function receives `(item, index)` — use the built-in `index` parameter directly for `BlockView`'s `index` prop; do not use `findIndex`.
- `LiveFooter` below remains unchanged — interactive gates, chat input, timer all work as today

No changes to `pipelineReducer`, `BlockView`, `LiveFooter`, or event types.

**Freeze transition invariant:** When the reducer fires the `end` event, it copies `live.stats` into the frozen block (filling any missing values from the accumulated live stats). The frozen block always has complete data before it enters `state.frozen[]`, so `<Static>` will never permanently render an incomplete block.

### `src/cli/lib/agent.ts` — `run()` method, `jsonSchema` branch

**Before:** when `jsonSchema` is set:
- Spawns claude with `--output-format json --json-schema <schema>`
- Buffers entire stdout
- Synthesizes tool_use + stats events after completion
- No text events during execution

**After:** when `jsonSchema` is set:
- Spawns claude with `--output-format stream-json` (no `--json-schema` flag)
- Schema is already embedded in the prompt by `agent-handler.ts`
- Events flow normally: `assistant_delta` → `text` NodeEvent → `live.body` → rendered
- Accumulates all `assistant_delta` text into a string
- At `result` event: extracts the last `{...}` JSON object from accumulated text
- Validates structure (key presence) against the expected schema shape
- Returns extracted JSON as `output`; fails with clear error if extraction fails

The prompt already contains `IMPORTANT: Your FINAL response MUST be valid JSON matching this schema` (injected by `agent-handler.ts` at line 68), so Claude reliably emits JSON as its final text block.

## Data Flow

### Streaming text (json_schema node, after)

```
claude (stream-json stdout)
  → parseStreamJsonEvents()
  → assistant_delta → parseClaudeEvent() → {kind:"text", role:"claude", text}
  → emit() → pipelineReducer → live.body.push(line)
  → LiveFooter renders body lines in real-time

  result event arrives →
  → accumulate all text → extractJson(text) → validate → return as output
```

### JSON extraction

Extract by finding the outermost `{...}` span using the first `{` and last `}` in the text. This is robust against Claude emitting preamble prose or trailing newlines, and avoids regex greediness issues with nested `}` in trailing text:

```typescript
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in agent output");
  }
  return JSON.parse(text.slice(start, end + 1));
}
```

Claude always emits a single top-level JSON object as its final block (enforced by the prompt preamble in `agent-handler.ts`), so `indexOf` / `lastIndexOf` reliably brackets it.

## Error Handling

- **No JSON found in output**: node fails with `failureReason: "json_schema node produced no extractable JSON"` — same failure surface as before
- **JSON parse error**: node fails with parse error message
- **Schema mismatch** (missing required keys): node fails with descriptive error

## Testing

### Existing tests (unchanged)

- `PipelineApp.test.tsx` — frozen/live block rendering tests pass; `<Static>` renders the same content, Ink's test renderer handles it
- `pipeline-app-integration.test.tsx` — event dispatch tests unaffected

### New smoke pipelines

**`pipelines/smoke/static-multi-node.dot`**
Three sequential `implement` agent nodes, each outputting one line. Lets you observe via tmux that frozen blocks (nodes 1, 2) never repaint while node 3 is live. Run with:
```
ralph pipeline run pipelines/smoke/static-multi-node.dot
```

**`pipelines/smoke/json-schema-stream.dot`**
Single `implement` node with `json_schema_file`. Prompt asks Claude to list 3 files in `src/cli/lib/`, describe each in one sentence, then return structured JSON. Confirms that streaming text (the descriptions) appears in the live block before the final JSON result arrives. Run with:
```
ralph pipeline run pipelines/smoke/json-schema-stream.dot
```

Both pipelines are observable with the tmux harness from `docs/harness/tmux-drive.md`.

### Schema for json-schema-stream smoke

`pipelines/smoke/schemas/file-list.json` — minimal schema:
```json
{
  "type": "object",
  "properties": {
    "files": { "type": "array", "items": { "type": "string" } },
    "summary": { "type": "string" }
  },
  "required": ["files", "summary"]
}
```

## Constraints

- No changes to `pipelineReducer.ts`, `BlockView.tsx`, `LiveFooter.tsx`, `parseClaudeEvent.ts`
- No changes to pipeline `.dot` file format or node attributes
- Interactive gates (`wait-human`, `chat_session`) are unaffected — they only appear in the live block
- The `--json-schema` CLI flag for Claude is dropped; schema enforcement is prompt-based (already the case via `agent-handler.ts`)
- Existing unit tests in `agent.test.ts` that assert `--json-schema` is present in `buildArgs` must be updated to reflect the new `stream-json` path
