---
date: 2026-05-01
description: parseStructuredOutput in src/cli/lib/parse-structured-output.ts has no production callers — only its own unit test imports it; agent-handler uses evaluateAgentOutput exclusively.
---

## Findings

1. **What:** `parseStructuredOutput` is a dead export — it exists, has 8 unit tests, but has zero production callers.

   **Evidence:**
   - `src/cli/lib/parse-structured-output.ts:5` — `export function parseStructuredOutput(rawText: string): unknown[]`
   - Only importer: `src/cli/lib/parse-structured-output.test.ts:2` — `import { parseStructuredOutput } from "./parse-structured-output.js";`
   - The production path that extracts JSON from agent output is `evaluateAgentOutput` in `src/attractor/handlers/evaluate-agent-output.ts`, called by `src/attractor/handlers/agent-handler.ts`. `parseStructuredOutput` is never referenced there or anywhere else in `src/`.

   **Why it matters (KISS lens):** A function with tests but no callers forces the next reader to ask: "is this called at runtime through some dynamic path I'm missing?" The answer is no, but finding that out requires tracing every import. The test file title-matches the module, making it look like authoritative coverage of a live feature rather than a test of a dead one. The cognitive overhead is a pure tax.

   **Suggested action:** Delete `src/cli/lib/parse-structured-output.ts` and `src/cli/lib/parse-structured-output.test.ts`. If JSON extraction from raw agent output is ever needed outside `evaluate-agent-output.ts`, extract `extractResultPayload` from there rather than resurrecting this orphan.

## Reading thread

- `2026-05-01T0120-janitor-graph-validator-bloat.md` — also a duplication/dead-code finding in the validator layer; no overlap with the lib layer here.
- `2026-05-01T0212-janitor-dead-two-phase-fn.md` — same pattern (dead export with no callers); that one is in `session.ts`, this is in `parse-structured-output.ts`.
- `2026-05-01T0657-janitor-dead-tests-written-input.md` — dead _input_ variable; this is a dead _module_.
