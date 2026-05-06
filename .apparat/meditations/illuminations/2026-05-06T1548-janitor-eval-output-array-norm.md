---
date: 2026-05-06
description: evaluateAgentOutput carries a normaliseRaw branch that converts JSON arrays to NDJSON — a format production code never emits, kept alive solely by test mocks using the old --output-format json shape.
---

## Findings

1. **What:** `normaliseRaw` in `evaluate-agent-output.ts` converts a `JSON.stringify([...])` array into NDJSON lines — a format that the production agent never emits, making this branch dead code in all real runs.

   **Evidence:**

   `src/attractor/handlers/evaluate-agent-output.ts:62-75`:
   ```typescript
   // Normalise: if the raw output is a JSON array (e.g. from test mocks), convert
   // each element to an NDJSON line so extractResultPayload can process it.
   const normalised = normaliseRaw(raw);
   ```
   ```typescript
   function normaliseRaw(raw: string): string {
     const trimmed = raw.trim();
     if (!trimmed.startsWith("[")) return raw;
     try {
       const arr = JSON.parse(trimmed);
       if (Array.isArray(arr)) {
         return arr.map((item: unknown) => JSON.stringify(item)).join("\n");
       }
     } catch { /* not a JSON array — fall through */ }
     return raw;
   }
   ```

   The comment names the reason explicitly: "e.g. from test mocks". Production output is always NDJSON because `buildArgs()` unconditionally passes `--output-format stream-json`:

   `src/cli/lib/agent.ts` (inside `buildArgs`):
   ```typescript
   if (!options.interactive) {
     args.push("--output-format", "stream-json", "--verbose");
   }
   ```

   Tests across at least 5 files mock the `output` field as `JSON.stringify([...])`:

   `src/attractor/tests/agent-handler.test.ts:468`:
   ```typescript
   it("unwraps Claude CLI --output-format json array wrapper before parsing", async () => {
   ```
   `src/attractor/tests/agent-handler.test.ts:474`:
   ```typescript
   // Real Claude CLI --output-format json: single-line JSON array of events
   const jsonArrayOutput = JSON.stringify([
   ```

   Same pattern in `agent-handler-json-constraint.test.ts:60`, `agent-handler-retry.test.ts:16`, `agent-handler-deep-loop.test.ts:11`, `agent-handler-frontmatter-jsonschema.test.ts:10`.

   **Why it matters (KISS lens):** A reader of `evaluate-agent-output.ts` must reason about two output formats: NDJSON (stream-json, the only real format) and JSON array (the old format, kept alive by tests). The function header's comment admits the array path is for mocks — but production readers cannot safely ignore a branch just because a comment says it's for tests. `normaliseRaw` is called unconditionally on every real agent output: every call pays the `.trim()` + `startsWith("[")` check, and any string coincidentally starting with `[` would silently enter the array path. The defensive branch is not just noise; it actively misleads about what shapes `raw` can take at runtime.

   **Suggested action:**
   - Migrate all mock `output` values in the 5+ test files from `JSON.stringify([...])` to proper NDJSON strings (one event per line, no surrounding array brackets) — matching the format `--output-format stream-json` actually emits.
   - Drop `normaliseRaw` and its call site from `evaluate-agent-output.ts`.
   - Remove the "unwraps Claude CLI --output-format json array wrapper" test case in `agent-handler.test.ts:468` — it tests a path that cannot occur in production.

## Reading thread

- `2026-05-06T1538-janitor-tracer-test-array-leak.md` — same root pattern (test fixture violates type contract → dead defensive branch in production code). That illumination targets `JsonlPipelineTracer.onPipelineStart` / `Graph.nodes` Map vs. array confusion; this one targets `evaluateAgentOutput` / agent output format NDJSON vs. JSON-array confusion. Different modules, same KISS violation family.
