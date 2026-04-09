# Fix: Empty JSON Output in Long Agentic Pipeline Sessions

## Problem

Pipeline nodes with `json_schema_file` fail with `Structured output parsing failed: Unexpected end of JSON input` in long agentic sessions (50+ subagent calls). The JSON constraint prepend/append fix (0.0.49) eliminated markdown returns but exposed a deeper issue: the Claude process exits before emitting the final `{type:"result"}` event line.

## Root Cause

`agent.ts:195-213` correctly buffers all stdout lines via readline and awaits `rlDone`. The issue is a **format mismatch** in the parsing layer:

1. Claude CLI streams **newline-delimited JSON** (NDJSON) — one JSON object per line (tool_use events, text events, subagent events, and finally a `{type:"result"}` envelope)
2. All lines are concatenated into `capturedOutput` (agent.ts:201)
3. `agent-handler.ts:119` calls `JSON.parse(lastResult.output.trim())` on the entire concatenated string. The existing code then checks `Array.isArray(raw)` and searches for `{type:"result"}` — but this never executes because **NDJSON is not valid JSON**. The initial `JSON.parse()` throws before the array-searching logic can run.
4. In short sessions, the output may happen to be a single line (valid JSON). In long sessions (50+ subagent calls), it's always multi-line NDJSON, which always fails at the `JSON.parse()` call.
5. When the Claude process also hits token limits, it may exit before emitting the `{type:"result"}` line at all — a secondary failure mode.

## Fix

### 1. Write raw output to disk before parsing (instrumentation)

**File:** `src/attractor/handlers/agent-handler.ts`

Before the `JSON.parse` at line 119, write `lastResult.output` to `nodeDir/raw-output.txt`. This enables post-mortem debugging and distinguishes empty vs truncated vs missing-result failures.

```typescript
if (jsonSchema && lastResult?.output) {
  writeFileSync(join(nodeDir, "raw-output.txt"), lastResult.output);
  // ... existing parse logic
}
```

### 2. Parse NDJSON events line-by-line (replaces array-based parser)

**File:** `src/attractor/handlers/agent-handler.ts`

The current code (lines 117-141) assumes the output is either a JSON array or a single JSON object, then searches for `{type:"result"}`. This fails because the output is NDJSON (one JSON object per line), not a JSON array. The fix parses each line independently and extracts the last `{type:"result"}` event.

This is safe for both formats: if Claude CLI ever returns a single-line JSON array, each line is still individually parseable. No regression for short sessions.

Replace lines 117-141:

```typescript
if (jsonSchema && lastResult?.output) {
  writeFileSync(join(nodeDir, "raw-output.txt"), lastResult.output);
  try {
    // Claude CLI emits newline-delimited JSON events.
    // Find the last {type:"result"} line.
    const lines = lastResult.output.trim().split("\n");
    let resultPayload: string | undefined;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event?.type === "result" && event.result != null) {
          resultPayload = typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result);
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    if (!resultPayload) {
      return {
        status: "fail",
        failureReason: `Structured output: no {type:"result"} event found in ${lines.length} output lines`,
      };
    }

    const parsed = JSON.parse(resultPayload);
    for (const [key, value] of Object.entries(parsed)) {
      structuredUpdates[key] = String(value);
    }
    if (parsed.preferred_label != null) {
      preferredLabel = String(parsed.preferred_label);
    }
  } catch (err) {
    return {
      status: "fail",
      failureReason: `Structured output parsing failed: ${(err as Error).message}`,
    };
  }
}
```

### 3. Handle missing output explicitly

**File:** `src/attractor/handlers/agent-handler.ts`

When `jsonSchema` is set but `lastResult?.output` is falsy, return a descriptive failure instead of falling through to the success path.

```typescript
if (jsonSchema && !lastResult?.output) {
  return {
    status: "fail",
    failureReason: "Structured output: agent produced no output (possible timeout or token limit)",
  };
}
```

## What This Does NOT Do

- **No parse-repair fallback** — rejected per prior decision; failures surface explicitly
- **No timeout extension** — the process exits when Claude decides to exit; we handle the consequence
- **No retry logic** — that's the pipeline engine's job via edge conditions
- **No changes to readline/process lifecycle** — the existing `rlDone` await is correct

## Files Changed

| File | Change |
|------|--------|
| `src/attractor/handlers/agent-handler.ts` | Line-by-line NDJSON parsing, raw output dump, missing output guard |
| `src/attractor/tests/agent-handler-json-constraint.test.ts` | Update tests for NDJSON parsing, add missing-result and no-output tests |

## Testing

1. Existing test 1-3 (prepend/append/absent): unaffected (test prompt construction, not parsing)
2. Existing test 4 (markdown fail): update mock to return NDJSON-formatted `output` string in the `RunResult` object (tests mock `agent.run()` return values, not raw stdout)
3. New test: multi-line NDJSON with `{type:"result"}` containing valid structured data → parses correctly, extracts context updates
4. New test: NDJSON stream without any `{type:"result"}` line → returns `status:"fail"` with descriptive message
5. New test: `lastResult.output` is empty/undefined → returns `status:"fail"` with timeout message

Note: `writeFileSync` and `join` are already imported in agent-handler.ts — no new imports needed.
