---
date: 2026-05-01
description: docs/specs/pipeline.md and commands.md advertise two phantom commands, the wrong --project shape on list, a non-existent --max on pipeline run, a contradictory trace path, an excised agent-registry step, dead parallel/parallel.fan_in types, and a manager_loop row that disagrees with its own handler file — the canonical spec is now the worst orientation source for any doc-reading agent.
---

## Core Idea

The two canonical spec files for the pipeline subsystem — `docs/specs/pipeline.md` and `docs/specs/commands.md` — advertise commands, flag shapes, on-disk paths, and node types that contradict `src/cli/program.ts` and `src/attractor/handlers/`. The drift is dense enough that a doc-fed agent (the meditate pipeline reads `$specs_dir/*.md`) inherits multiple wrong facts before touching source. Per the `comprehensive-docs-are-agent-fuel` lens, accurate-looking-but-wrong docs are worse than no docs.

## Why It Matters

Each item is one read to verify:

1. **Phantom commands.** `pipeline.md` Commands table lists `pipeline create <project>` and `pipeline refine <name>`. Neither is registered in `program.ts`. `pipelineListCommand` even prints `Create one with: ralph pipeline create <name>` as a hint to a command that does not exist (`src/cli/commands/pipeline.ts:413,417`).
2. **Wrong `list` shape.** Spec writes `pipeline list <project>` (positional). Code uses `--project <folder>` flag (`program.ts` ~`pipeline.command("list")`).
3. **Phantom `--max` on run.** `pipeline.md`'s commands paragraph says "Execute a pipeline to completion (or until `--max` or failure)". `pipeline run` has no `--max` flag — only `implement` exposes it, mapping internally to `--var max_iterations=…`.
4. **Internally contradictory trace path.** `commands.md` `pipeline trace` section says traces live at `~/.ralph/runs/<runId>/pipeline.jsonl`. `pipeline.md` Run-identity section and `pipelineRunCommand` use `~/.ralph/<projectKey>/runs/<runId>/`. `commands.md` contradicts itself in the same file (run section is correct, trace section is wrong).
5. **Stale implement narrative.** `commands.md` implement step 2 is "Resolves the `implement` agent definition via the agent registry". The agent registry was excised on 2026-04-30 (CONTEXT.md, ADR 0001) and `implementCommand` now just calls `pipelineRunCommand("implement", …)`.
6. **Dead node types still in table.** `pipeline.md` Node Types table lists `parallel` and `parallel.fan_in`; illumination `2026-05-01T0423-janitor-parallel-handler-yagni` confirms no `.dot` file uses them.
7. **`stack.manager_loop` row contradicts its own file.** Same table marks the type "Not yet implemented" while `src/attractor/handlers/manager-loop.ts` already ships a working `ManagerLoopHandler`. Spec lags reality in the opposite direction.

Vision says "running a pipeline feels like delegating to someone who already understands the shape of the problem". That shape is supposed to live here. Right now the shape it teaches is wrong by seven items.

## Revised Implementation Steps

1. **Delete phantom rows in one diff.** Remove `pipeline create` and `pipeline refine` from `pipeline.md` Commands table; remove `parallel`, `parallel.fan_in` rows from Node Types (couple this with implementing `2026-05-01T0423-janitor-parallel-handler-yagni`); remove the dead "Create one with: ralph pipeline create" hints in `pipelineListCommand`.
2. **Fix the four hard contradictions:** `pipeline list <project>` → `pipeline list --project <folder>`; drop `--max` from the run-command summary; replace every `~/.ralph/runs/<runId>` in `commands.md` with `~/.ralph/<projectKey>/runs/<runId>`; replace the implement "agent registry" sentence with "delegates to `pipelineRunCommand('implement', …)`".
3. **Reconcile `manager_loop`.** Either delete the handler file (if speculative — confirm by grepping `.dot` files for `type="stack.manager_loop"`) or drop the "Not yet implemented" qualifier and document the actual node attributes the handler expects.
4. **Add a CI guard for command drift.** New vitest `pipeline-spec-vs-program.test.ts` parses the `### \`ralph …\`` headings out of `docs/specs/commands.md` and asserts each maps to a registered command in `createProgram()`. Fails fast on the next drift.
5. **Split spec-of-record from roadmap.** `pipeline.md`'s `manager_loop` row exposes the conflict: the file is doing reference-manual and roadmap jobs simultaneously. Either move every aspirational item to one `docs/roadmap.md` and keep `specs/` truth-only, or tag aspirational rows `[planned]` and have the validator confirm the planned tag matches an absence in `buildHandlerMap`.
6. **Audit the other four spec files** (`architecture.md`, `loop.md`, `meditate.md`, `heartbeat.md`) for the same drift pattern — at minimum the run-state path appears in three places, and only one currently uses the project-keyed layout.
