---
date: 2026-05-06
description: stream-formatter.ts houses two distinct parsers of the same stream-json format but for different consumers — TUI display events and raw protocol events — joined only by a === banner comment.
---

## Findings

1. **What:** `stream-formatter.ts` contains two independent parsers that share only their input format (Claude CLI `stream-json` NDJSON), but serve completely different consumers with different output contracts.

   **Evidence:**

   `src/cli/lib/stream-formatter.ts:327-330` — the file draws its own module boundary with a banner:
   ```typescript
   // =============================================================================
   // Raw stream-json event iterator for interactive chat (Path 1.5)
   // =============================================================================
   //
   // Lower-level parser than streamEvents() above. Yields a typed union that
   // preserves the raw shape of Claude CLI's stream-json output so ChatUI can
   // display text deltas and inspect stop_reason/usage directly.
   ```

   **Parser 1 — TUI formatter** (lines 1–326): `FormatterState`, `StreamEvent`, `initialState`, `processLine`, `flushState`, `streamEvents`, `serializeEvent`, plus the main-entry CLI stub. Stateful: buffers subagent events, defers headers, tracks context-token growth.

   **Parser 2 — Protocol parser** (lines 327–440): `StreamJsonEvent`, `parseStreamJsonEvents`, `coerceSessionUsage`. Stateless: maps raw protocol messages to a typed union preserving `stop_reason`, `usage`, tool calls.

   Import evidence — callers split cleanly between the two APIs:
   - `src/cli/lib/agent.ts:8`: `import { parseStreamJsonEvents, type StreamJsonEvent } from "./stream-formatter.js"` — interactive chat path only
   - `src/cli/components/PipelineApp.tsx:9`, `src/cli/lib/output.ts:7`, `src/cli/lib/pipelineEvents.ts:3`, `src/cli/components/ui.tsx:4`: import only `StreamEvent` — TUI path only
   - `src/cli/commands/pipeline.ts:21`: imports both — the one file spanning both paths

   Test evidence: `src/cli/tests/stream-json-events.test.ts` already names the right extraction target (`stream-json-events` ≈ `parseStreamJsonEvents`), while `src/cli/tests/stream-formatter.test.ts` tests only the TUI path.

   **Why it matters (KISS lens):** A reader of `stream-formatter.ts` must hold both APIs simultaneously: stateful subagent buffering, TUI event taxonomy, *and* raw protocol event mapping. The module name `stream-formatter` describes only the first half — `agent.ts` imports a "formatter" to get a protocol parser, which is a conceptual mismatch. The `===` banner comment is a code smell: it marks a seam that should be a file boundary.

   **Suggested action:**
   - Extract `StreamJsonEvent`, `parseStreamJsonEvents`, and `coerceSessionUsage` from `stream-formatter.ts` into a new `src/cli/lib/stream-json-parser.ts`.
   - Update `agent.ts` and `pipeline.ts` (and `stream-json-events.test.ts`) to import from the new module.
   - `stream-formatter.ts` shrinks from 444 to ~300 lines; `stream-json-parser.ts` is ~115 lines.
   - No logic change — pure module boundary enforcement.

## Reading thread

- `2026-05-06T1538-janitor-tracer-test-array-leak.md` — different module, same root cause family: two concerns cohabiting in one file. That illumination targets production code kept alive by test-fixture leakage; this one targets module co-location that misleads callers about responsibility boundaries.
- `2026-05-06T1548-janitor-eval-output-array-norm.md` — also about `stream-json` output format assumptions leaking across module boundaries, but in `evaluate-agent-output.ts` not the formatter/parser pair.
