# illumination-to-implementation Pipeline Design

**Date:** 2026-04-16
**Status:** Approved

## Overview

A pipeline that extends `illumination-to-plan.dot` by continuing past plan creation into implementation, human review, commit/push, and memory capture. The full lifecycle from illumination triage to committed code in one run.

## Inputs

```
inputs="project, meditations_dir, specs_dir, plans_dir"
```

- `project` — absolute path to the target repo (new, sets engine `cwd` for all agent nodes via `--project` flag)
- `meditations_dir`, `specs_dir`, `plans_dir` — inherited from `illumination-to-plan`

**Invocation:**
```bash
ralph pipeline run pipelines/illumination-to-implementation.dot \
  --project /path/to/repo \
  --var meditations_dir=/path/to/repo/meditations \
  --var specs_dir=/path/to/repo/docs/specs \
  --var plans_dir=/path/to/repo/docs/superpowers/plans
```

The `--project` flag flows through `pipelineRunCommand → runPipeline({ cwd: project })` and sets `cwd` for all agent node executions. `$project` is also injected as a pipeline variable for use in `tool_command` nodes.

## Node Graph

### Phase 1: Illumination Triage (unchanged from illumination-to-plan)

All nodes from `illumination-to-plan.dot` are copied verbatim:

```
start → verifier
verifier → explain_removal  [condition="preferred_label=false"]
verifier → explainer         [condition="preferred_label=true"]
verifier → done              [condition="preferred_label=empty"]
explain_removal → remove_gate
remove_gate → done           [label="No"]
remove_gate → delete_file    [label="Yes"]
delete_file → done
explainer → approval_gate
approval_gate → mark_archived  [label="Decline"]
approval_gate → design_writer  [label="Approve"]
approval_gate → chat_session   [label="Chat"]
chat_session → chat_summarizer → approval_gate
design_writer → mark_dispatched → plan_writer
```

### Phase 2: Implementation (new)

Continues from `plan_writer` instead of going to `done`:

```
plan_writer → implement
implement → review_gate
review_gate → commit_push        [label="Approve"]
review_gate → launch_tmux        [label="Tmux"]
review_gate → implement          [label="Retry"]
launch_tmux → tmux_confirm_gate
tmux_confirm_gate → commit_push  [label="Commit"]
tmux_confirm_gate → implement    [label="Retry"]
commit_push → memory_writer → done
```

### New Node Definitions

| Node | Type | Detail |
|---|---|---|
| `implement` | `agent="implement"` | Single-shot. Reads `$plan_path`, implements with TDD, commits. Runs in `$project` via engine `cwd`. |
| `review_gate` | hexagon | "Review implementation in $project" — labels: Approve / Tmux / Retry |
| `launch_tmux` | `tool_command` | `tmux new-window -c "$project" -n "test-$run_id"` — opens shell in project dir |
| `tmux_confirm_gate` | hexagon | "Test window open in $project. Return when done." — labels: Commit / Retry |
| `commit_push` | `tool_command` | `cd $project && git push origin $(git branch --show-current) \|\| git push -u origin $(git branch --show-current)` |
| `memory_writer` | `agent="implement"` | Writes `$project/memory/YYYY-MM-DD-<topic>.md` summarizing what was implemented, files changed, key decisions. |

## Design Decisions

- **Single-shot implement**: The agent runs once, commits, and surfaces for human review. Retry is available via the gate if the result is unsatisfactory. This avoids runaway loops while still allowing human-directed iteration.
- **Tmux window for testing**: The pipeline TUI is running in the current terminal. A new tmux window gives the human a separate shell to test interactively without interrupting the pipeline.
- **Memory in target repo**: `memory_writer` writes to `$project/memory/` so the knowledge lives with the project, not with ralph-cli. This makes the pipeline reusable across any repo.
- **`commit_push` as belt-and-suspenders**: The implement agent commits during its run. The tool_command ensures a push happens regardless of whether the agent remembered to push.
- **`--project` flag vs `--var`**: Engine `cwd` is set via `--project`, not `--var`. This is the existing mechanism (same as `ralph implement <folder>`). The `$project` variable is also injected automatically for use in shell commands.
