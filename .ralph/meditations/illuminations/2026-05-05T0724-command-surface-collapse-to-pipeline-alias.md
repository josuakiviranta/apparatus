---
date: 2026-05-05
description: Per-pipeline CLI command files are shallow wrappers that double as input-prep traps preventing `pipeline run <name>` parity; collapsing them into a single name-aliased dispatcher plus pipeline-internal tool nodes removes the duplication and makes every pipeline callable through one entrypoint.
---

## Core Idea

Every bundled pipeline today comes with a hand-coded sibling command file (`src/cli/commands/implement.ts`, `meditate.ts`, plus mirror entries in `heartbeat.ts`). Each is a 10–80 line wrapper that maps positional args to `pipelineRunCommand("<name>", { project, variables })`, sometimes adding pipeline-specific input prep (VISION read, PID lock, `.gitignore` append) that the pipeline itself cannot reproduce. The wrappers are a shallow module — interface as wide as the implementation — and the input-prep silently breaks `ralph pipeline run <name>` parity. The deepening move is a single name-aliased dispatcher (`ralph <pipeline-name> <folder>` ≡ `ralph pipeline run <name> --project <folder>`) plus pulling all pipeline-specific prep into pipeline-internal tool nodes. Janitor already proves the latter half of the recipe.

## Why It Matters

Three currently-alive illuminations describe pieces of this same shape and the file evidence reinforces the synthesis:

- `2026-05-01T0512-command-surface-duplicates-pipeline-engine.md` calls out the wrappers without naming the elimination route.
- `2026-05-04T2342-meditate-pipeline-not-pipeline-run-callable.md` shows meditate fails preflight under generic `pipeline run` because `meditate.ts:80–84` injects `vision: readVisionIfPresent(absPath)` from command code, while `inputs="steer,vision"` declares the requirement only in the pipeline.
- `2026-05-01T0819-janitor-dual-pid-guards.md` records the daemon already owns single-instance guarding, yet `meditate.ts:14–37` reimplements it inline.

Compare:

- `src/cli/pipelines/janitor/pipeline.dot` declares `read_vision [type="tool", script_file="read-vision.mjs", produces_from_stdout=true]` and the agent declares `inputs: [project, read_vision.vision]`. Result: `ralph pipeline run janitor --project foo` works directly. The pipeline is **self-sufficient**.
- `src/cli/pipelines/meditate/pipeline.dot` is two lines of routing and inherits `inputs="steer,vision"`. The vision read lives outside the pipeline in `meditate.ts:67`. Result: only callable through the bespoke command. The pipeline is **command-coupled**.
- `src/cli/pipelines/implement/pipeline.dot` similarly relies on `implement.ts:34–38` to populate `scenarios_dir` and `max_iterations` — defaults that could live as `default_scenarios_dir=""` / `default_max_iterations="0"` on the pipeline's start-side nodes (the latter already does, see `implementer [agent="implement", max_iterations="$max_iterations", default_max_iterations="0"]`). The wrapper exists mostly for tmux preflight, which is a single string check.

`heartbeat.ts:96–149` then mirrors the duplication: a bespoke `heartbeat meditate <folder>` and `heartbeat implement <folder>` that re-encode the same arg shape next to the already-generic `heartbeat pipeline <dotfile>`. Every new bundled pipeline today asks for two new top-level commands plus a heartbeat sibling — that pressure contradicts the vision (`VISION.md`: "the engine that executes the graph") and forces ralph to grow at the command surface as it grows at the pipeline tier. Collapsing here costs nothing the operator notices and reclaims the seam.

## Revised Implementation Steps

1. **Move VISION-read into the meditate pipeline.** Copy `src/cli/pipelines/janitor/read-vision.mjs` into `src/cli/pipelines/meditate/`, add a `read_vision` tool node to `meditate/pipeline.dot` (mirroring janitor's wiring), and rename the agent's `vision` input to `read_vision.vision`. Delete `readVisionIfPresent` from `meditate.ts`.
2. **Drop the meditate-side PID lock.** PID guarding belongs to the daemon (`src/daemon/scheduler.ts`); the manual `meditate.ts` lock is the duplicate already flagged. Delete `pidPath`/`writePid`/`readPid`/`isPidAlive` and the `.meditate.pid` lifecycle from `meditate.ts`. `appendMeditateGitignore` is also redundant with `ralph init`'s `.gitignore` work — delete it; the `MCP_CONFIG_GLOB` clause moves to `init.ts` if still needed.
3. **Add tmux-preflight as a tool node in implement/pipeline.dot.** The single-line `process.env.TMUX` check in `implement.ts:21–26` becomes `tool_command="test -n \"$TMUX\" || (echo 'requires tmux' >&2; exit 1)"` gated on `scenarios_dir!=''`. Now `implement.ts` is empty.
4. **Introduce a name-aliased dispatcher in `program.ts`.** After registering pipeline subcommands, scan bundled + project-local pipelines (reuse `resolvePipelineArg`) and register each as `program.command("<name> <folder>").action(...)` that delegates to `pipelineRunCommand(name, { project, variables: opts.var })`. Remove the bespoke `implement` and `meditate` commands. Keep `pipeline run` as the explicit verb for path-form invocations.
5. **Collapse heartbeat's bespoke schedulers.** Drop `hb.command("meditate <folder>")` and `hb.command("implement <folder>")`; the existing `heartbeat pipeline <name> <folder>` already covers them once name-shorthand resolves bundled pipelines. Update README examples accordingly.
6. **Verify parity.** Run all `pipeline-smoke-*-folder.test.ts` plus the bundled pipelines (`janitor`, `meditate`, `implement`) twice — once via name alias, once via `ralph pipeline run <name> --project ...` — and confirm identical traces. Both invocations should write the same `<project>/.ralph/runs/<runId>/pipeline.jsonl` shape.
7. **Document the rule.** Add a one-paragraph note to `CONTEXT.md` under "Pipeline Self-Sufficiency": every bundled pipeline must be runnable through `pipeline run` without any command-side input prep. Mark this as the test future bundled pipelines must pass — closing the seam against re-introducing wrappers.

### Things to keep in mind

- This is the deep-modules move applied to the CLI surface: tiny interface (one alias rule), large hidden capability (every pipeline auto-callable). Locality goes up — pipeline-specific glue lives next to the pipeline. Leverage goes up — adding a bundled pipeline no longer requires touching `program.ts` or `heartbeat.ts`.
- The user-memory mental model already states "everything is a pipeline." This step turns that from intent into a structural invariant rather than a convention agents can drift on.
- Be cautious about `--max` / `--scenarios` short flags: dispatchers can re-expose them as standardized `--var max_iterations=...` / `--var scenarios_dir=...` for muscle memory; or accept the migration cost since power users already use `--var`.
- The remaining `init` and `pipeline` verbs are real seams (init sets up the project shell; pipeline list/validate/show/run/trace are operations on pipeline files, not invocations). They stay.
