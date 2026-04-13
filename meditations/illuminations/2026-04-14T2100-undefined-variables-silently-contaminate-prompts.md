---
date: 2026-04-13
status: open
description: On any pipeline path that skips a branch node, variables set by that node are never defined — expandVariables leaves them as literal `$name` strings in downstream agent prompts, with no warning, no default, and no error.
---

## Core Idea

`expandVariables` in `src/attractor/transforms/variable-expansion.ts` has a single fallback for undefined variables: `if (v === undefined) return match`. "Return match" means return the original `$variableName` string. In a pipeline with conditional branching, any node that only runs on one path sets variables that are undefined on all other paths. Every downstream node that references those variables receives the literal text `$variableName` in its prompt — silently, with no log entry, no warning, and no error thrown.

In `illumination-to-plan.dot`, `design_writer` always runs on the Approve path and always references `$refinements`. `$refinements` is only produced by `chat_summarizer`, which only runs on the Chat path. Every Approve-without-Chat execution injects `Refinements: $refinements` literally into the design agent's prompt. The agent reads `$refinements` as a token of unknown meaning — not as junk it should reject, but as text it must interpret.

## Why It Matters

The agentic-loop-is-a-graph lens promises that explicit graph structure makes pipelines observable, resumable, and reliable. But variable scoping is not expressed in the graph — the graph only defines nodes and edges, not which variables each node sets or which paths each variable requires. The mismatch between graph structure and variable scope is invisible at authoring time, invisible at runtime, and invisible in test output.

This is not a one-off bug in `illumination-to-plan.dot`. It is a systemic property of the pipeline architecture. Any pipeline with a branch node that sets a variable, followed by a merge point where a downstream node reads that variable, has the same latent defect. As pipelines grow in complexity — more branches, more structured outputs — the number of undeclared path dependencies grows. Each one is a silent prompt contamination waiting to fire.

The `illumination-to-plan.dot` case is immediately actionable: `$refinements` is the only cross-path variable right now and the contamination is predictable. The first time a user takes the direct Approve path (skipping chat), `design_writer` receives `Refinements: $refinements` in its prompt. Large language models do not reject unfamiliar tokens in prompts — they assign them meaning. The agent will either (a) treat `$refinements` as an empty placeholder and proceed correctly, (b) interpret it as an instruction fragment and hallucinate a refinement list, or (c) produce a design doc that includes the literal string "$refinements" in its output. All three outcomes are wrong; none produce an error the developer can act on.

A secondary, related issue: `meditations/.triage/chat-notes.md` is written by `chat_session` and read by `chat_summarizer` without a cleanup step. Across multiple pipeline runs, this file accumulates notes from previous illumination chat sessions. A future run's `chat_summarizer` will read stale notes alongside the current illumination's path and explanation — producing `$refinements` that blends two different illuminations' scopes.

## Revised Implementation Steps

1. **Change the undefined-variable fallback in `expandVariables` from `return match` to `return ""`** (file: `src/attractor/transforms/variable-expansion.ts`, line where `v === undefined`). Empty string is the correct sentinel for "this branch did not run." Agents handle empty fields in prompts gracefully — `Refinements: ` with nothing after it is interpretable; `Refinements: $refinements` is not. This is a one-line change. Write the unit test first: assert that `expandVariables("Hello $undefined_var", {})` returns `"Hello "`, not `"Hello $undefined_var"`. The test currently passes the wrong assertion.

2. **Add a path-coverage lint pass to the graph loader** (file: `src/attractor/core/graph.ts` or a new `src/attractor/core/lint.ts`). After parsing a `.dot` file into a `Graph`, compute: for each node, the set of variables referenced in its `prompt`; for each such variable, the set of nodes that produce it (via `json_schema_file` output fields); whether there exists any path to the consuming node that bypasses all producers. Flag unguarded cross-path dependencies as warnings at pipeline load time, before any agent runs. This converts a runtime silent failure into an authoring-time named error.

3. **Fix `illumination-to-plan.dot` to guard `$refinements`** by adding `refinements=""` as a default in the `start` node context, or by restructuring so `design_writer` checks `$refinements` with a conditional prefix in its prompt: `"Refinements (if any): $refinements\n"`. Once step 1 is done, this becomes `"Refinements (if any): \n"` on the non-chat path — harmless. Without step 1, any fix to the dot file is fragile and must be re-applied every time a new cross-path variable is added.

4. **Fix `chat-notes.md` cross-run contamination** by changing `chat_session`'s prompt to write to a run-scoped path: `meditations/.triage/chat-notes-<basename-of-$illumination_path>.md`. Update `chat_summarizer` to read from the same path. This makes the triage scratchpad per-illumination rather than global. After the pipeline completes (at the `done` node), the file can be left in place or cleaned up — either is correct because it no longer contaminates future runs.

5. **Add a regression test for the Approve-without-Chat path** in `src/cli/tests/pipeline-headless.test.ts`. The test should run `illumination-to-plan.dot` against a fixture illumination, simulate the verifier returning `preferred_label=true` and the approval gate returning "Approve" (not "Chat"), and assert that `design_writer`'s captured prompt does not contain the literal string `"$refinements"`. This test will fail before step 1 is applied and pass after — making the fix verifiable and preventing regression.
