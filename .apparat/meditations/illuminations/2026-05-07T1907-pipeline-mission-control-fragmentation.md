---
date: 2026-05-07
description: Pipeline creation/management/observability is fragmented across shallow subcommands; the solo human needs a per-pipeline mission-control view fusing validity, runs, schedule, and a single replay seam that reuses the live Ink renderer.
---

## Core Idea

The pipeline graph itself is a deep module — one folder, one `pipeline.dot`, sibling agents (ADR-0001). Everything *around* the graph is shallow and scattered: `pipeline list` answers one question, `heartbeat list` answers another, `pipeline trace <runId>` a third — and the user must already know the runId. No per-pipeline view fuses validity + last runs + schedule + failure into one place. Worse, `pipeline list` actively lies: it prints "Create one with: apparat pipeline create <name>" but no `pipeline create` command is registered in `program.ts`. The creation/edit/replay seams that the *human* (not the LLM) needs are missing.

## Why It Matters

Concrete drift between docs and surface:

- `src/cli/commands/pipeline/list.ts:23,28` prints `apparat pipeline create <name>`. `src/cli/program.ts` registers `run`, `validate`, `list`, `trace`, `show` only. Broken promise to the operator.
- `dist/templates/.gitkeep` is the sole survivor of the chunk-5/chunk-6d "templates infra + pipeline-create shim / pipeline-refine" work mentioned in MEMORY.md. Either the shim was reverted and the hint is now stale, or the shim was never wired through `program.ts`. Investigate before step 1.

Discovery + post-mortem gaps:

- `src/cli/commands/pipeline/trace.ts` requires the user to know the runId. README mentions `--resume` auto-selecting "exactly one prior run" (`src/cli/commands/pipeline/run.ts:130-138`), which proves runId discovery is a real friction point. There is no `pipeline runs` listing.
- The Ink `PipelineApp` (`src/cli/commands/pipeline/run.ts:155-167`) renders the live run rich and structured. The same JSONL is later read only by `trace.ts:58-74` as a text dump. Two consumers, no shared rendering seam — classic shallow split. The agentic-loop-is-a-graph stimulus calls out exactly this: a graph is valuable because it is *observable at every transition, not just the end* — observability that disappears the moment the run finishes.

Management surface is thin:

- `pipeline list` shows `name + goal + requires` only. Not validity (`validate` would tell you), not schedule (`heartbeat list` would tell you), not last-run outcome (`trace <runId>` would tell you, if you knew the id). The human juggling several pipelines is the union of those four commands; the CLI gives them the intersection.
- `pipeline show` writes an SVG but the team has acknowledged "stale SVG drift" risk in `.apparat/sessions/2026-04-27-pipeline-graph-preview-command.md`. No regen hook.

Strategic compass: VISION.md says a working pipeline should "feel like delegating to someone who already understands the shape of the problem." The current management surface inverts that — the *human* must hold cross-command state. The graph is deep; the harness around it is shallow.

## Revised Implementation Steps

1. **Resolve the create-hint discrepancy** in `src/cli/commands/pipeline/list.ts:23,28`. Either restore the chunk-5 `pipeline create` shim (templates infra is already in `dist/templates/`) or replace the hint with the real authoring path: "Run `apparat init`, then add `.apparat/pipelines/<name>/pipeline.dot` (see the apparatus skill)." Don't ship advice for a command that doesn't exist.
2. **Add `apparat pipeline runs [<name>] [--project x]`** that lists each runId under `<project>/.apparat/runs/` with timestamp, outcome (last `pipeline-end` line of `pipeline.jsonl`), and the failing node id when present. Pure read; no new state. Deletes the "ls + cat" dance the user does today.
3. **Deepen `pipeline list` into a status view** — per-pipeline card with validity (✓/✗ from validator), schedule (joined from daemon state if any), last-run outcome, and SVG presence. Keep the current line format under `--brief` for scripts. One command answers the four questions the user actually has.
4. **Reuse `PipelineApp` for replay**: add `apparat pipeline replay <runId>` (or fold into `pipeline trace`) that feeds the JSONL through the same Ink component the live runner uses. One renderer, two feeds (live stream vs. file). This is the deep-modules move — collapse the duplicate of "render a pipeline run" into a single seam.
5. **Auto-render SVG on `pipeline validate` success** when the source is newer than the colocated SVG. Closes the stale-SVG drift acknowledged in the show session-closure file without inventing a pre-commit hook.
6. **Surface heartbeat schedule in the new `pipeline list`** by reading daemon state — one place to answer "what runs unattended."
7. **Demote `pipeline trace --node-receive`** to a `--text` fallback once (4) ships; make the Ink replay the default path so post-mortem looks like the live run.
