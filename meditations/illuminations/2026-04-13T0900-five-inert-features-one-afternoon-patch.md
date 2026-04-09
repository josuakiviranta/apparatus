---
date: 2026-04-09
description: Five inert pipeline features catalogued across one session each have their own repair steps, but they collapse into one afternoon patch: three easy wiring fixes and two validator disablements — the architectural work is future work, not today's, and the reason all five slipped through is that none had a scenario test that ran the real engine with real meta inputs.
---

## Core Idea

The 0100–0700 illuminations (plus 2300 from the prior session) catalogued five inert pipeline features: `buildPreamble` never called, `loopRestart` wiping context, `wait.human` hanging on non-TTY, `parallel` succeeding with zero branch execution, and `stack.manager_loop` registered in `KNOWN_TYPES` but unregistered in `buildHandlerMap`. Each illumination listed 3–5 repair steps. Read in sequence they look like twenty separate tasks. They are not. Three are 5–15 line wiring fixes. Two are one-line disablements. The architectural work — parallel fan-out and manager-loop parent-child wiring — is future work. It is not this afternoon's task.

## Why It Matters

The illumination series performed its job: it located the gaps. But it weighted all five gaps equally. The effort to fix them is not equal:

**Easy fixes (hours, not days):**
- Wire `buildPreamble` into `CodergenHandler.execute` — prepend the preamble before writing `prompt.md`. One `await loadCheckpoint(logsRoot)` call and a string concatenation. `RalphImplementHandler` is aliased to the same instance, so the fix covers both. (0300, step 1)
- Preserve context across `loopRestart` in `engine.ts` — remove the line `context = { "$goal": graph.goal ?? "" }` from the restart block. Replace with in-place reassignment of only the static keys. Add `context["loop.iteration"] = String(Number(context["loop.iteration"] ?? "0") + 1)`. (0500, step 1)
- Add TTY detection and abort signal race to `ConsoleInterviewer` and `WaitHumanHandler` — check `process.stdin.isTTY` at the top of `ask()` and reject immediately with a diagnostic if false. Add `Promise.race([interviewer.ask(...), abortPromise])` in the handler. (0100, steps 1–2)

**Disablements (minutes):**
- Add `severity: "error"` diagnostics in `validateGraph` for `parallel` and `parallel.fan_in` node types: "Parallel execution is not yet implemented." Remove these types from `PROMPT_pipeline_create.md`. (0700, steps 1–2)
- Remove `stack.manager_loop` from `KNOWN_TYPES` and add a comment: `// handler exists but not registered — requires pollChild wiring`. (2300, step 1)

These five operations can ship in a single commit. After the commit, the pipeline engine is meaningfully functional for all patterns that actually work: linear sequences, conditional routing, retry loops with context-aware agents, and human gates that fail fast in non-interactive contexts. The two disabled types become tracked future features, not silent defects.

The reason all five accumulated without being caught is the same across all of them: **they passed at the unit-test level but had no scenario test that ran the real engine with real meta inputs and checked the observed effect.** `ParallelHandler` was tested by passing `branchOutcomes` directly in `meta` — which the engine never does. `buildPreamble` was tested in isolation — but never called from production code. `WaitHumanHandler` was tested with `QueueInterviewer` — which never touches stdin. The `scenario-tests-catch-what-unit-tests-miss` meditation names this exactly: "neither unit tests nor integration tests verify that the feature works from the perspective of someone actually using it." None of these features had a test that ran `runPipeline` end-to-end with a real graph and asserted on the output.

## Revised Implementation Steps

1. **Wire `buildPreamble` in `CodergenHandler.execute`.** Load checkpoint from `logsRoot`, call `buildPreamble(cp, fidelity)`, prepend to node prompt before writing to disk. Remove the `_` prefix from the `ctx` parameter. This is the highest-value fix: every subsequent pipeline run becomes context-aware.

2. **Preserve context across `loopRestart` in `engine.ts`.** Replace the full context reset with in-place key reassignment. Increment `loop.iteration`. Extend `variableExpansionTransform` to substitute all context keys, not just `$goal` and `$project`. (These two changes are paired — context persists but is only useful to agents if variable substitution surfaces it in prompts.)

3. **Fix `ConsoleInterviewer` and `WaitHumanHandler` for non-TTY and abort.** Two files, both small. After this fix, `wait.human` nodes in CI or scripted pipelines fail with a clear diagnostic instead of hanging indefinitely.

4. **Disable `parallel`, `parallel.fan_in`, and `stack.manager_loop` in `validateGraph` and remove them from `PROMPT_pipeline_create.md`.** These are four lines total in two files. Users can no longer author pipelines against these types and be surprised at runtime.

5. **Add one scenario test that catches this class of bug.** Write a shell scenario or an `engine.test.ts` case: a two-node pipeline where `start → codergen → exit`, the codergen node deposits `"codergen.result": "done"` into context, `loopRestart` fires once, and after the second iteration, assert `result.context["codergen.result"] === "done"` and `result.context["loop.iteration"] === "1"`. This test exercises context persistence through a restart and would have caught the wipeout bug. More importantly, it establishes the pattern: for each new feature, write a test that exercises the engine's real call path, not just the handler in isolation.
