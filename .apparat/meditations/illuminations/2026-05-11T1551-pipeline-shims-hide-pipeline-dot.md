---
date: 2026-05-11
description: Three top-level commands (implement, meditate, pipeline run) all wrap pipelineRunCommand, but each carries its own positional shape, flag→var translation, and bootstrap (tmux preflight, PID lock, gitignore append) — so pipeline.dot can't tell its own story and adding a 4th pipeline means a 4th bespoke shim.
---

## Core Idea

`apparat implement <project>`, `apparat meditate <project>`, and `apparat pipeline run <name> --project <project>` all end up calling `pipelineRunCommand` — but each carries a different positional shape, a different flag→var translation, and its own pre-run bootstrap (tmux preflight, PID lock, `.gitignore` mutation, dir-ensure) that lives in TypeScript instead of in `pipeline.dot`. The pipeline file is the supposed source of truth for "what this pipeline is", yet half of what it *needs* to run lives outside it. End users pay the cognitive tax (three invocation shapes for the same operation) and the next bundled pipeline pays the development tax (a fourth bespoke shim).

## Why It Matters

Three concrete sightings in the current tree:

- `src/cli/commands/implement.ts` — translates `--scenarios <path>` → `--var scenarios_dir=...`, `--max N` → `--var max_iterations=...`, and runs a tmux-env preflight. None of that translation or preconditioning is visible in `src/cli/pipelines/implement/pipeline.dot`. The DOT file consumes `$scenarios_dir` and `$max_iterations` but never declares "I require tmux" or "my caller-friendly flag is `--scenarios`".
- `src/cli/commands/meditate.ts` — 50+ lines of PID-lock (`writePid`/`readPid`/`isPidAlive`), `appendMeditateGitignore` (writes `.meditate.pid`, `.meditate.log`, etc. to `.gitignore`), and `ensureMeditationDirs`. All before delegating to `pipelineRunCommand("meditate", ...)`. `src/cli/pipelines/meditate/pipeline.dot` has no idea any of this happens.
- `src/cli/program.ts` registers three Commander entries (`implement`, `meditate`, `pipeline run`) plus `apparat <project>` as a hidden shorthand for `implement`. Every entry has its own `--var` story: implement has none (translates flags by hand), meditate has `--var steer=...`, pipeline run has generic `--var`.

The asymmetry is already drifting in the bundled direction the project wants. `apparat heartbeat meditate` was deleted on 2026-05-06 ("the bespoke heartbeat subcommand existed only because the bundled meditate pipeline could not run unattended" — `CONTEXT.md`) and replaced by `apparat heartbeat pipeline meditate`. The top-level shims weren't taken with it. So heartbeat now speaks one language ("everything is a pipeline") while the top-level surface still speaks three. A user running `apparat heartbeat pipeline meditate --project foo --every 30 --var steer=X` and `apparat meditate foo --var steer=X` for the same pipeline rightly asks why the project flag changes position.

This is a shallow-module symptom in the sense the deep-modules stimulus names: the *interface* (three CLI shapes + three bespoke bootstraps) is wide; the *implementation* (`pipelineRunCommand`) is one engine. The leverage and locality both leak. A pipeline maintainer can't read `pipeline.dot` and know what running the pipeline does to their working tree.

Per the spider/web mental model: pipelines are the web — the graph that catches/prepares. The web file should be self-describing for everything an honest runner needs to set up before the spider eats. Today the web file is partially drawn and the missing strands live in `meditate.ts` and `implement.ts`.

## Revised Implementation Steps

1. **Pick one pipeline as the deep-module pilot — meditate.** It has the messiest bootstrap (PID lock + gitignore + dirs) and the smallest user-facing flag surface (just `--var steer=...`). Move every line currently in `meditateCommand`'s bootstrap into a declarative form readable from the pipeline folder.

2. **Add a `pipeline.toml` (or extend `pipeline.dot` with apparat-namespaced attributes) sibling to `pipeline.dot`** that declares: `pidLock = true`, `pidLockPath = ".meditate.pid"`, `gitignoreAdd = [".meditate.pid", ".meditate.json", ".meditate.log", ".mcp-meditate-*.json"]`, `ensureDirs = [".apparat/meditations/illuminations"]`, `flagAliases = { steer = "--steer <text>" }`. Keep the schema narrow — only the four levers `meditate.ts` and `implement.ts` actually need today. YAGNI everything else.

3. **Teach `loadPipeline` to read the sibling declaration** and return a `preflight` block alongside `graph`. `pipelineRunCommand` runs the preflight steps (lock, gitignore, dirs, tmux check) in a fixed order before `runPipeline`, and releases the PID lock in the same `finally` that today's `meditateCommand` uses. One implementation, one place, one ordering.

4. **Collapse `apparat meditate <project>` to a Commander alias** that calls `pipelineRunCommand("meditate", { project, variables: ... })`. Migrate `--var steer=...` directly through the generic `--var` collector via the `flagAliases` map (so `--steer "..."` works too if declared). Delete `src/cli/commands/meditate.ts`'s bootstrap functions.

5. **Repeat for implement.** Move `--scenarios` → `scenarios_dir` and `--max` → `max_iterations` into `flagAliases`. Move the tmux preflight into the sibling declaration (`requiresTmux = true` when `scenarios_dir != ""` — single conditional). Delete `src/cli/commands/implement.ts` down to a thin alias.

6. **Unify the positional shape.** With both shims thin, the canonical surface becomes `apparat <pipeline-name> <project> [--var k=v ...] [--flag-alias ...]`. `apparat pipeline run <dotfile>` stays for ad-hoc `.dot` files outside the bundled/local namespaces. `apparat <project>` shorthand keeps routing to `implement` for muscle memory. Document the one shape in `README.md`'s "Commands" section and let the three subsections collapse into one.

7. **Lock the convergence with a test.** Add `pipeline-bootstrap-declarative.test.ts` that asserts: (a) the bundled `implement` and `meditate` pipelines have their preflight declared in the sibling file, (b) `pipelineRunCommand` invocation produces identical filesystem effects as the legacy `meditateCommand` / `implementCommand` paths (PID file written, `.gitignore` mutated, dirs ensured). This is the seam the deep-modules stimulus calls for — one mock at one boundary.
