---
date: 2026-05-11
description: The failure footer's `resume:` recipe is built from `dotFile + runId` only — it drops the original `--project <folder>` and any `--var key=value` flags. Copy-pasting the printed command fails the project_binding_missing preflight on any pipeline that references `$project`. The README promises a "copy-pasteable recipe"; the recipe is currently incomplete.
---

## Core Idea

`src/cli/lib/failure-handoff.ts:86` constructs the resume command with exactly two interpolations:

```ts
const resumeCommand = `apparat pipeline run ${args.dotFile} --resume ${args.runId}`;
```

The caller at `src/cli/commands/pipeline/run.ts:391-399` passes `tracePath`, `failedNodeId`, `failureReason`, `dotFile`, `dotDir`, `runId`, `graph` — but never `opts.project` or `opts.variables`, even though both are present in scope. Result: the printed recipe is missing every flag the user actually invoked the pipeline with.

Concrete incident, run `parallel-illumination-to-implementation-df1d9cf6`, 2026-05-11. The pipeline was invoked as `apparat pipeline run .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot --project .` and failed at `tmux_confirm_gate`. The printed footer:

```
resume: apparat pipeline run .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot --resume parallel-illumination-to-implementation-df1d9cf6
```

Copy-paste verbatim → engine rejects: `✗ [project_binding_missing] Pipeline references $project but --project flag not passed.` The user's second attempt — `--var project .` — failed at Commander's flag parser: `Error: --var "project" expected key=value`. The correct command (`--project .` appended) is *technically* derivable from the README, but the whole point of the printed recipe is to not require the user to mentally diff what they typed vs. what came back.

## Why It Matters

The README (lines 84-85) explicitly markets this recipe as the failure-recovery seam:

> the stderr footer prints a copy-pasteable recipe instead of just a trace path … `resume:` (the exact `pipeline run … --resume <runId>` command for after you fix it).

"Exact" is the failure mode here. A recipe that drops mandatory flags is worse than no recipe — it teaches the user that the printed line is wrong, eroding trust in every other line in the footer (which *are* correct: `trace:`, `inspect:`, `raw output:` all reflect real invocations). Every successful resume of a `$project`-bearing pipeline today requires the user to remember they originally passed `--project`, manually append it, and possibly recall every `--var` they passed too. For interactive runs that's annoying; for daemon/cron resumes it's load-bearing — the cron entry already has the flags, but a tired operator paste from terminal scrollback won't.

Composes badly with two adjacent surfaces:
- **`apparat heartbeat`** schedules pipelines with `--project` and `--var` baked in. The whole point of heartbeat is that scheduled invocations don't require human flag-typing. A failure that prints an incomplete resume command breaks that contract.
- **`apparat pipeline run --resume <runId>`** preflight rejects `--var project=...` (per `run.ts:67-77` with message *"Pass --project <folder>, not --var project=..."*) which means the recipe can't even silently lie via `--var` — the engine itself has the strict-binding signal that the recipe builder is ignoring. Two parts of the same module disagree about whether `--project` is a first-class concept.

Same shape as `deep-modules-hide-complexity.md`: the *interface promise* (the printed recipe is copy-pasteable and exact) is stronger than the *implementation delivers* (string template missing two of the four invocation parameters). Three- to ten-line fix; no new concept.

## Revised Implementation Steps

1. **Thread `project?: string` and `variables?: Record<string, string>` into `LoadFailureHandoffArgs`** (`src/cli/lib/failure-handoff.ts:56`). Optional so existing tests that don't pass them stay green; `run.ts:391` passes `opts.project` and `opts.variables` through.

2. **Replace the line-86 template with a `buildResumeCommand()` helper** that appends `--project <folder>` when `args.project !== undefined` and `--var k=v` for every entry in `args.variables`. Shell-quote any value containing whitespace or shell metacharacters (`'<value with spaces>'`) so the recipe paste-survives a multi-word `--var steer="focus on auth"`. Pure, no I/O — easy to snapshot-test inline next to the existing `renderFailureFooter` tests.

3. **Add regression tests in `src/cli/tests/failure-handoff.test.ts`** that mirror the parallel-impl incident: (a) `project: "."` produces `... --resume <runId> --project .` (b) `variables: { steer: "focus on auth", lens: "tests" }` produces correctly-quoted `--var 'steer=focus on auth' --var lens=tests` (c) absent `project`/`variables` round-trips the current behaviour byte-for-byte (backwards compat).

4. **Audit the `inspect:` line for the same blind spot.** `renderFailureFooter` at line 48 builds `apparat pipeline trace <runId> --node-receive <id> --full` — this one is genuinely complete (`pipeline trace` doesn't require `--project`), but worth confirming as part of the same change so the recipe surface is uniformly trustworthy.

5. **(Once shipped) Cross-link from the README** at the line documenting the recipe surface — call out that the resume line includes any caller flags so users know they can paste-and-go even from scrollback. Currently the README implicitly promises this; making it explicit prevents future drift.

## Note: incident already shipped a partial fix

Run `df1d9cf6` originally crashed at `tmux_confirm_gate` because of a stale `$implement.done` reference (fixed in commit `8631fda` — `tmux_confirm_gate.md` now references `$batch_orchestrator.done`). When the user copy-pasted the printed `resume:` line, the *second* bug surfaced: even with the gate fixed, the resume couldn't start because `--project .` was missing from the recipe. That second bug is what this illumination addresses.
