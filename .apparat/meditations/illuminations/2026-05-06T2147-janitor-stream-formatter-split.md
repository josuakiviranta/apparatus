---
date: 2026-05-06
description: stream-formatter.ts holds two unrelated parsers — TUI event formatter and raw Claude CLI stream parser — already split in tests but not in source.
---

## Findings

1. **What:** `src/cli/lib/stream-formatter.ts` bundles two structurally unrelated parsers in one module.
   - **Evidence:**
     - Lines 1–316: `StreamEvent`, `FormatterState`, `initialState`, `processLine`, `flushState`, `streamEvents`, `serializeEvent` — stateful TUI event formatter that buffers subagent blocks and emits structured display events.
     - Line 317 comment: `// Raw stream-json event iterator for interactive chat (Path 1.5)` — explicit in-file boundary marker.
     - Lines 318–end: `StreamJsonEvent`, `coerceSessionUsage`, `parseStreamJsonEvents` — low-level raw Claude CLI NDJSON parser used by `agent.ts` and `pipeline/run.ts` stats path.
   - **Why it matters (KISS lens):** A reader of `stream-formatter.ts` must hold two unrelated mental models simultaneously: (a) the subagent-buffering state machine with `pendingSubagentIds`/`subagentBuffers`/`FormatterState`, and (b) the raw Claude CLI event protocol (`assistant_delta`, `tool_result`, `result` with `stop_reason`). These share nothing — no types, no logic, no state. The in-file separator comment is the code admitting this itself.
   - **Suggested action:** Extract `StreamJsonEvent`, `coerceSessionUsage`, `parseStreamJsonEvents` into `src/cli/lib/stream-json-parser.ts`. Update three importers: `src/cli/lib/agent.ts` (line 8), `src/cli/commands/pipeline/run.ts` (line 23), `src/cli/tests/stream-json-events.test.ts` (line 3). The two test files are already split — the source just needs to catch up.

## Reading thread

- No prior illuminations exist (list was empty). This is a fresh scan.
