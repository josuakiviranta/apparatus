# The Exemplar Is Already Written — Point At It

## Core Idea

`meditate-create.ts` is a fully working non-interactive Claude session runner: it buffers stream-json, parses tool-use indicators, pipes stderr, and resolves on close. The run-scenarios implementation plan describes `runScenarioSession` in prose and inline code rather than naming `runMeditateCreateKickoff` as its exemplar. Because the exemplar is not named, the invariant it carries — `RALPH_TEST_CMD ?? "claude"` — is not transfused. The copy is written from scratch and the escape hatch is dropped.

## Why It Matters

The `2600` illumination diagnosed this as a missing override. But the root cause is earlier: the plan never says "read `meditate-create.ts:runMeditateCreateKickoff` before writing `runScenarioSession`." Without that directive, an agent producing Task 7 works from the prose description and its own memory of the pattern — not from the actual code. Memory drifts. The code doesn't.

`meditate-create.ts` already has what `meditate.ts` is getting in Chunk 1 (tool-use indicators, exit code in close handler). After Chunk 1, `meditate.ts` will also have `RALPH_TEST_CMD` and exported test surface. At that point there will be two valid exemplars for `runScenarioSession`. Neither is named in the plan. The plan's Task 7 writes the function from scratch instead, producing a third divergent implementation. The pattern now lives in three places, each with slightly different invariants, none confirmed to be equivalent.

Gene transfusion requires naming the exemplar explicitly — not just describing what the code should do. The exemplar paired with tests defines what equivalence means. "This function is modeled on `runMeditateCreateKickoff` — read it first, then produce an equivalent with these additional tests" is a different instruction than "spawn claude with these args." The first cannot omit what the exemplar contains. The second can omit anything.

The practical consequence: when the plan is executed by an agent under time pressure, Task 7 ships without `RALPH_TEST_CMD`. The plan's own Task 9 then creates a scenario script that invokes `dist/cli/index.js run-scenarios` — real Claude, no stub — rather than running vitest with a stub, because there is no vitest test to run. Untestable code begat an untestable scenario test.

## Revised Implementation Steps

1. **Before writing `runScenarioSession`, read `meditate-create.ts` in full.** Add this as an explicit step in Task 7 of the plan: "Step 0: Read `src/cli/commands/meditate-create.ts` in full. `runScenarioSession` is structurally equivalent to `runMeditateCreateKickoff` — model it on that function."

2. **Add `RALPH_TEST_CMD ?? "claude"` to `runScenarioSession` as a direct transfusion from the exemplar.** This is a single-line change. It is easy to add if the exemplar is named; easy to miss if it is not.

3. **Add a `runScenarioSession` describe block to `run-scenarios.test.ts` that mirrors the three tests Task 2 adds for `runMeditationSession`.** Exit code 1 → stderr warning. Exit code 0 → no warning. `tool_use` stream line → `→ [tool]` output. These are the same three behaviors. If the transfusion is correct, the tests will be structurally identical.

4. **Name exemplars explicitly in any future plan that adds a session runner.** The pattern is now established: every non-interactive session runner in ralph is a variant of `runMeditateCreateKickoff`. Future plans should say "read `src/cli/commands/meditate-create.ts` first" rather than describing the stream-json parser from scratch. The exemplar is the source of truth; prose descriptions are lossy summaries of it.

5. **After all three session runners have passing tests, extract to `src/cli/lib/claude-session.ts`.** The tests from each command define equivalence. The extraction is correct when all three test suites still pass against the shared implementation. Do not extract before the tests exist — the tests are what make the extraction safe.
