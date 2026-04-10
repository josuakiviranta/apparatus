---
date: 2026-04-10
description: The heartbeat pipeline subcommand can schedule illumination-to-plan headlessly, but AutoApproveInterviewer picks the first outgoing label at every human gate — "Yes" for deletion and "Approve" for plan writing — silently converting deliberate human review into autonomous action.
---

## Core Idea

The new `ralph heartbeat pipeline` subcommand lets any DOT pipeline run on a timer. When the daemon spawns a ralph process headlessly, `process.stdin.isTTY` is false, so `pipelineRunCommand` routes to `AutoApproveInterviewer`. `AutoApproveInterviewer.ask()` returns `q.options?.[0]` for MULTIPLE_CHOICE — the first outgoing label in edge-declaration order. In `illumination-to-plan.dot`, that is "Yes" at `remove_gate` and "Approve" at `approval_gate`. The pipeline was designed with those gates as hard human checkpoints; headless scheduling erases them silently.

## Why It Matters

The damage chain is deterministic, not hypothetical:

1. `verifier` selects an illumination and evaluates it (non-interactive, works fine).
2. If verdict is `false`: `explain_removal → remove_gate`. AutoApproveInterviewer returns `"Yes"` (first of `["Yes","No"]`). The illumination is **deleted without human review**.
3. If verdict is `true`: `explainer → approval_gate`. AutoApproveInterviewer returns `"Approve"` (first of `["Approve","Decline","Chat"]`). The pipeline proceeds directly to `design_writer` and `plan_writer`, **writing a design doc and implementation plan without a human ever seeing the illumination**.

The chat_session node (`interactive=true`) is never reached in either path above, but if it were, the spawned `claude` process would inherit stdin=ignore from the daemon and behave unpredictably.

This is not a hypothetical misuse. The feature shipped: `src/cli/commands/heartbeat.ts` now has a `pipeline` subcommand that validates the dotfile and registers a daemon task. A user who runs `ralph heartbeat pipeline illumination-to-plan.dot --every 60` gets exactly this behavior. The TTY detection that protects the interactive `pipeline run` path does not protect against this: its job is to choose between human and auto interviewer, not to refuse execution.

## Revised Implementation Steps

1. **Audit `illumination-to-plan.dot` gate label order.** Reorder `remove_gate` edges so "No" precedes "Yes". Reorder `approval_gate` edges so "Decline" precedes "Approve". AutoApproveInterviewer's first-option behavior is a safety property when the safe default is first.

2. **Add a `headless_safe` graph attribute to the DOT spec and parser.** Parse `headless_safe=false` (or `headless_safe="false"`) on the graph declaration. Default is true (most pipelines are safe to run headlessly).

3. **Enforce the attribute in `pipelineRunCommand`.** Before `runPipeline`, if `graph.headlessSafe === false` and `!process.stdin.isTTY`, print a clear error and exit 1: `"This pipeline contains human-review gates and cannot run headlessly. Run it interactively: ralph pipeline run <dotfile>"`.

4. **Mark `illumination-to-plan.dot` as `headless_safe=false`.** Add the attribute to the graph declaration alongside `goal=`. This is the only pipeline currently requiring human review — future pipelines with hexagon gates should also carry it.

5. **Update the heartbeat `pipeline` subcommand to warn when registering a headless-unsafe pipeline.** After validating the dotfile, parse the graph and check `headlessSafe`. If false, print a warning before calling `register_task`: `"Warning: this pipeline requires a human and will fail when run by the daemon."` Let the user decide, but do not silently register something that cannot work.
