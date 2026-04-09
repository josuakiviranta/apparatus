# Structured Output & Pipeline Display Fixes

**Date:** 2026-04-13
**Status:** Draft

## Problem

Three bugs chain together to make `ralph pipeline run` with structured-output nodes (json_schema_file) appear to silently exit with no output:

1. **Structured output parsing is broken** — `agent-handler.ts` naively iterates `Object.entries(parsed)` on Claude CLI's `--output-format json` response. That response is a wrapper (or array of message objects), not the schema-shaped object directly. The result: context gets polluted with `{"0": "[object Object]", "1": "[object Object]", ...}` instead of `{preferred_label, summary, ...}`.

2. **Readline/close race condition** — In `agent.ts`, the `closePromise` (child process close) can resolve before `readline` finishes processing buffered stdout lines. `capturedOutput` may be incomplete when returned.

3. **Ink render race on exit** — `pipeline.ts` calls `push()` (React state update) for the final success/fail message, then immediately calls `done()` which triggers `exit()`. Ink unmounts before the queued render flushes to the terminal.

## Evidence

From `~/.ralph/runs/illumination_to_plan/verifier/status.json`:

```json
{
  "status": "success",
  "contextUpdates": {
    "0": "[object Object]",
    "1": "[object Object]",
    ...
    "52": "[object Object]",
    "agent.iterations": "1",
    "agent.success": "true"
  }
}
```

The engine then fails to route because all edges from `verifier` have conditions on `preferred_label` which doesn't exist in context. Returns `"No outgoing edge from verifier"` — but the Ink race swallows this message.

## Fix 1: Unwrap Claude CLI JSON Response

**File:** `src/attractor/handlers/agent-handler.ts` (lines 114-129)

**Current code:**
```typescript
const parsed = JSON.parse(lastResult.output.trim());
for (const [key, value] of Object.entries(parsed)) {
  structuredUpdates[key] = String(value);
}
```

**Problem:** `parsed` is Claude CLI's response wrapper, not the schema object. `--output-format json` returns a JSON array of event objects:

```json
[
  {"type":"system", "subtype":"init", "session_id":"...", ...},
  {"type":"assistant", "message":{"content":[...]}, ...},
  {"type":"result", "subtype":"success", "result":"<schema JSON string>", "session_id":"...", ...}
]
```

The code calls `Object.entries()` on this array, producing numeric keys `0..N` with `[object Object]` values.

**Fix:** Extract the `result` field from the wrapper, then parse that as the schema JSON. Handle both object wrapper and array formats:

```typescript
const raw = JSON.parse(lastResult.output.trim());
// Claude CLI --output-format json wraps the response.
// Handle both object wrapper ({type:"result", result:"..."}) and array format.
const wrapper = Array.isArray(raw)
  ? raw.find((item: any) => item.type === "result") ?? raw[raw.length - 1]
  : raw;
const resultText = typeof wrapper === "object" && wrapper !== null && "result" in wrapper
  ? wrapper.result
  : lastResult.output.trim();
const parsed = typeof resultText === "string" ? JSON.parse(resultText) : resultText;
```

**Edge cases:**
- Array of message objects: finds the `type: "result"` entry, falls back to last element
- Single wrapper object: extracts `result` field directly
- Direct schema object (e.g., in tests): fallback re-parses the original output

## Fix 2: Await Readline Close

**File:** `src/cli/lib/agent.ts` (lines 195-210)

**Current code:**
```typescript
const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  capturedOutput += line + "\n";
  // ...
});
// ... then awaits closePromise (child.close), which can fire before readline finishes
```

**Fix:** Create a promise for readline's `close` event and await it alongside the child close:

```typescript
const rl = readline.createInterface({ input: child.stdout });
const rlDone = new Promise<void>((resolve) => rl.on("close", resolve));
rl.on("line", (line) => {
  capturedOutput += line + "\n";
  // ...
});
// ... later, after closePromise:
await rlDone;
```

This ensures all buffered lines are processed before returning `capturedOutput`.

## Fix 3: Ink Render Flush Before Unmount

**File:** `src/cli/commands/pipeline.ts` (lines 144-149)

**Current code:**
```typescript
finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  done();
  await waitUntilExit();
}
```

**Fix:** Add a macrotask yield (`setTimeout(0)`) before `done()` to let Ink flush the pending render cycle:

```typescript
finally {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  await new Promise(resolve => setTimeout(resolve, 0));
  done();
  await waitUntilExit();
}
```

This matches the existing pattern in `src/cli/lib/output.ts` (`renderOnce`) which uses the same `setTimeout(0)` technique.

## Out of Scope

- **Streaming output for structured nodes** — `--output-format json` is inherently non-streaming. Adding a tee/spool to show progress AND capture output would be feature creep. The node runs silently but correctly.
- **Changing to `--output-format stream-json`** — stream-json doesn't include a final structured result event. Would require Claude CLI changes we don't control.

## Test Changes

- `agent-handler.test.ts`: Add test for wrapper unwrapping (mock `output` as `'{"type":"result","result":"{...}"}'`)
- `agent-handler.test.ts`: Update existing structured output tests to use wrapper format
- `agent.test.ts`: Add test verifying readline close is awaited before returning output
- `pipeline.test.ts` or `PipelineDisplay.test.tsx`: Verify final message renders before unmount (may already be covered by existing 50ms delays in tests)
