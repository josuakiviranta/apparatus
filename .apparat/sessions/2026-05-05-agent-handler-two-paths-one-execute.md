---
date: 2026-05-05
run_id: 5595c462-8d25-4c44-acf6-ed655fa688f0
plan: docs/superpowers/plans/2026-05-05-agent-handler-two-paths-one-execute.md
design: docs/superpowers/specs/2026-05-05-agent-handler-two-paths-one-execute-design.md
illumination: meditations/illuminations/2026-05-05T0913-agent-handler-two-paths-one-execute.md
test_result: pass
---

# AgentHandler: split two-paths-one-execute into Interactive + Looping behind dispatch

## What was implemented

`AgentHandler.execute` (~277 lines of two structurally disjoint code paths
welded together with a self-aware `// --- end interactive branch; legacy
path below is unchanged ---` comment) is now two siblings —
`InteractiveAgentHandler` (chat/interview path) and `LoopingAgentHandler`
(json-validated retry-until-success path) — sharing only the boring
prompt-assembly work in `agent-prep.ts`. `engine.buildHandlerMap()`
dispatches on `node.interactive` via a tiny `agent-dispatch.ts` shim.
Two former runtime guards (`interactive=true` ∧ `outputs:` /
`interactive=true` ∧ `loop_until:`) move to the graph validator as
`interactive_with_outputs_forbidden` + `interactive_with_loop_forbidden`,
so misconfigured pipelines fail at validate-time with file:line:col
rather than mid-run. Dead `ConsoleInterviewer` + `CallbackInterviewer`
adapters deleted (only `InkInterviewer` and `AutoApproveInterviewer`
remain instantiated by `pipeline.ts`).

## Key files

- A `src/attractor/handlers/agent-prep.ts` — extracted `assembleAgentPrompt`
- A `src/attractor/handlers/agent-dispatch.ts` — `node.interactive` switch
- A `src/attractor/handlers/interactive-agent-handler.ts` — chat path
- R `src/attractor/handlers/agent-handler.ts` → `looping-agent-handler.ts`
  (rename with 64 % similarity)
- M `src/attractor/core/engine.ts` — registry uses dispatch shim
- M `src/attractor/core/graph.ts` — two new validator rules, tightened messages
- D `src/attractor/interviewer/callback.ts`
- D `src/attractor/interviewer/console.ts`
- M `src/attractor/tests/interviewer.test.ts` — partial delete + drop unused imports
- A `src/attractor/tests/agent-prep.test.ts`
- A `src/attractor/tests/agent-dispatch.test.ts`
- A `src/attractor/tests/interactive-agent-handler.test.ts`
- A `src/attractor/tests/looping-agent-handler.test.ts`
- A `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts`
- A `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts`
- M 7 retargeted `agent-handler-*.test.ts` (deep-loop, frontmatter-jsonschema,
  inputs, interactive, json-constraint, retry, base)
- M `.ralph/scenarios/chat-end-to-end/chat.md`,
  `.ralph/scenarios/chat-only/chat.md` — drop reliance on now-promoted
  runtime guards
- A `docs/superpowers/specs/2026-05-05-agent-handler-two-paths-one-execute-design.md`
  (committed by memory-writer at finalization)

## Decisions and patterns

- **Two classes, no `BaseAgentHandler<TConfig>` generics.** Design §Scope
  explicitly rejects the generic-base abstraction — two inhabitants is
  the right count today; share by composition (`agent-prep.ts`), not
  inheritance.
- **Guards become validator rules, not runtime checks.** The old `if
  (jsonSchema) return fail(...)` and loop-mode runtime errors at
  `agent-handler.ts:127` would surface mid-run with generic messages;
  promoting them to graph rules surfaces them at `ralph pipeline
  validate` with `file:line:col` carets (the v0.1.31 source-location
  diagnostics infrastructure). The two scenario `chat.md` files needed
  edits because they previously triggered the runtime path; the
  validator catches them earlier now.
- **Spider/web mental model held.** Looping path = spider (autonomous,
  retries until done); interactive path = web (catch/prepare/verify).
  The split makes the metaphor literal at the file boundary.
- **Internal-only — zero `.dot` pipeline edits required.** Pipelines
  reference semantic agent names (`agent='implement'`), never class
  names. `engine.ts` is the sole non-test importer of the handler
  module. Public-contract subagent confirmed no breaking change before
  implement started.
- **Atomic-ish commit cadence (8 commits in this session range).**
  Extract → split → promote → tighten → delete-dead-1 → delete-dead-2.
  No per-test-file churn.

## Gotchas and constraints

- `docs/superpowers/plans/` is gitignored. Commit `8b86a13` ("mark chunk
  2 tasks complete") force-added the plan; commit `68e9842` reverted
  it. Plan file remains on disk as **untracked** — do not assume
  `git ls-files` will surface it. Future memory-writer runs that try
  to grep tracked plans by date will miss it.
- The handler rename (`agent-handler.ts` → `looping-agent-handler.ts`)
  used `git`'s 64 % similarity threshold. Anyone bisecting against the
  pre-split file should follow `--follow`.
- `engine.buildHandlerMap()` no longer registers `AgentHandler` directly
  — any external code (there is none in tree) that imported the old
  class symbol will break; the dispatch shim is the new entry point.
- The interactive scenarios (`.ralph/scenarios/chat-{end-to-end,only}/`)
  needed prompt edits to keep passing under the new validator rules —
  if a third interactive scenario gets added, lint it through
  `ralph pipeline validate` first.
- One side-fix landed in this same session range but outside plan
  scope: `4ef368d fix(heartbeat): refuse $project-bound pipelines
  without --project; derive id from parent folder`. Touches
  `src/cli/commands/heartbeat.ts` only — surfaced while exercising the
  pipeline runner; mention it here so future log readers don't assume
  it was part of the handler split.

## Learnings from the run

- `pipeline.jsonl` for `run_id=5595c462-8d25-4c44-acf6-ed655fa688f0`
  was **not present** under `~/.ralph/*/runs/5595c462-*/` at
  memory-writer time. Most recent traces in `ralph-cli-0c42de/runs/`
  end at `f6b021e5` (run-id `49afc7ab`). Cross-project `find` for
  `5595c462*` returned nothing. Memory built from artifacts + git log
  only; per-node retry counts / durations unavailable. Pipeline
  context reports `implement.iterations=3` and `tmux_tester.iterations=1`
  — captured here from upstream context, not verified against trace.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build green, 140 test files / 1277 tests
  passed (incl. 14 pipeline-smoke-*-folder tests covering all
  .ralph/scenarios pipelines, plus new interactive-agent-handler /
  looping-agent-handler / agent-prep /
  graph-interactive-with-{outputs,loop}-forbidden tests). Live
  `ralph pipeline validate
  .ralph/pipelines/illumination-to-implementation/pipeline.dot`
  succeeded (17 nodes, 27 edges). No fixes needed.
