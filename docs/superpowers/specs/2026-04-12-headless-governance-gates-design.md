---
id: spec-2026-04-12-headless-governance-gates
type: spec
created: 2026-04-12
status: draft
tags: [pipeline, headless, governance, safety, auto-approve, heartbeat]
---

# Headless Scheduling Bypasses Governance Gates

## Problem

The `ralph heartbeat pipeline` subcommand lets any DOT pipeline run on a timer via the daemon. When the daemon spawns a ralph process headlessly, `process.stdin.isTTY` is false, so `pipelineRunCommand` (in `src/cli/commands/pipeline.ts`) routes to `AutoApproveInterviewer`. `AutoApproveInterviewer.ask()` returns `q.options?.[0]` for MULTIPLE_CHOICE questions — the first outgoing label in edge-declaration order.

In `illumination-to-plan.dot`, this means:

1. **`remove_gate`**: AutoApproveInterviewer returns `"Yes"` (first of `["Yes","No"]`). The illumination is **deleted without human review**.
2. **`approval_gate`**: AutoApproveInterviewer returns `"Approve"` (first of `["Approve","Decline","Chat"]`). A design doc and implementation plan are **written without a human ever seeing the illumination**.

The damage chain is deterministic: a user who runs `ralph heartbeat pipeline illumination-to-plan.dot --every 60` gets exactly this behavior. The TTY detection that protects the interactive `pipeline run` path does not refuse execution — it only selects between human and auto interviewer.

### Verified Facts

- `AutoApproveInterviewer.ask()` returns `q.options?.[0]` for MULTIPLE_CHOICE — `src/attractor/interviewer/auto-approve.ts:5`
- `AutoApproveInterviewer` is selected when `!process.stdin.isTTY` — `src/cli/commands/pipeline.ts:119`
- `illumination-to-plan.dot` declares `"Yes"` before `"No"` at `remove_gate` and `"Approve"` before `"Decline"` at `approval_gate` — `pipelines/illumination-to-plan.dot`
- No `headless_safe` attribute exists on any graph, no enforcement exists in `pipelineRunCommand`, and no warning is emitted in the heartbeat pipeline subcommand — `src/cli/commands/heartbeat.ts`, `src/cli/commands/pipeline.ts`

## Goals

1. **Safe defaults first.** Reorder gate labels in `illumination-to-plan.dot` so `AutoApproveInterviewer`'s first-option behavior is harmless (decline/no-op).
2. **Declarative headless safety.** Add a `headless_safe` graph attribute to the DOT spec and parser so pipeline authors can mark pipelines that require human review.
3. **Hard enforcement at runtime.** `pipelineRunCommand` refuses to run `headless_safe=false` pipelines in non-TTY contexts.
4. **Early warning at registration.** The heartbeat `pipeline` subcommand warns when registering a headless-unsafe pipeline.

## Non-goals

- No changes to `AutoApproveInterviewer` itself — its first-option behavior is correct when safe defaults are first.
- No changes to the pipeline engine, checkpoint system, or renderer.
- No changes to interactive (TTY) pipeline execution.
- No new interviewer types.

## Architecture

### Components Modified

| Component | File | Change |
|-----------|------|--------|
| DOT parser | `src/attractor/core/parser.ts` | Parse `headless_safe` graph attribute into `PipelineGraph.headlessSafe: boolean` (default `true`) |
| Pipeline graph type | `src/attractor/core/types.ts` | Add `headlessSafe?: boolean` to `PipelineGraph` |
| Pipeline run command | `src/cli/commands/pipeline.ts` | Check `graph.headlessSafe` + TTY before running; exit 1 if unsafe + headless |
| Heartbeat pipeline subcommand | `src/cli/commands/heartbeat.ts` | Warn after dotfile validation if `headlessSafe === false` |
| illumination-to-plan.dot | `pipelines/illumination-to-plan.dot` | Reorder gate labels; add `headless_safe=false` attribute |

### Data Flow

```
┌──────────────────────────────┐
│  ralph heartbeat pipeline    │
│  illumination-to-plan.dot    │
│  --every 60                  │
└──────────┬───────────────────┘
           │ parse dotfile
           ▼
┌──────────────────────────────┐
│  DOT parser                  │
│  → headlessSafe = false      │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  heartbeat registration      │
│  ⚠ "Warning: this pipeline   │
│  requires a human and will   │
│  fail when run by the daemon"│
└──────────┬───────────────────┘
           │ user proceeds anyway
           ▼
┌──────────────────────────────┐
│  daemon spawns ralph         │
│  process.stdin.isTTY = false │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  pipelineRunCommand          │
│  headlessSafe=false + !TTY   │
│  → exit 1 with clear error   │
└──────────────────────────────┘
```

### Gate Label Reordering

**Before (unsafe):**
```dot
remove_gate -> done [label="Yes"]
remove_gate -> keep [label="No"]

approval_gate -> design_writer [label="Approve"]
approval_gate -> decline [label="Decline"]
approval_gate -> chat_session [label="Chat"]
```

**After (safe defaults first):**
```dot
remove_gate -> keep [label="No"]
remove_gate -> done [label="Yes"]

approval_gate -> decline [label="Decline"]
approval_gate -> design_writer [label="Approve"]
approval_gate -> chat_session [label="Chat"]
```

The safe option (No / Decline) becomes `options[0]` — the value `AutoApproveInterviewer` returns.

### DOT Graph Attribute

```dot
digraph illumination_to_plan {
  goal="Triage an illumination into an approved design doc and implementation plan"
  headless_safe=false

  // ... nodes and edges
}
```

The parser extracts `headless_safe` alongside the existing `goal` attribute. The value is a boolean string (`"true"` or `"false"`). Absent means `true` (backward compatible — existing pipelines without the attribute remain headless-safe).

## Constraints

1. **Backward compatible.** Pipelines without `headless_safe` default to `true` and behave exactly as before.
2. **Defense in depth.** Label reordering (step 1) makes headless execution safe even without the attribute check. The attribute check (steps 2-4) makes headless execution impossible for marked pipelines. Both layers are required.
3. **Error message must include the fix.** The exit-1 message tells the user how to run the pipeline interactively.
4. **No silent failures.** The heartbeat warning is printed before registration, not swallowed.

## Implementation Steps

1. **Reorder gate labels in `illumination-to-plan.dot`** so safe defaults come first at `remove_gate` and `approval_gate`.
2. **Add `headless_safe` to DOT spec and parser.** Parse the graph attribute into `PipelineGraph.headlessSafe: boolean`. Default `true`.
3. **Enforce in `pipelineRunCommand`.** Before `runPipeline`, if `graph.headlessSafe === false && !process.stdin.isTTY`, print error and exit 1.
4. **Mark `illumination-to-plan.dot` as `headless_safe=false`.** Add the attribute to the graph declaration.
5. **Warn in heartbeat `pipeline` subcommand.** After parsing the dotfile, if `headlessSafe === false`, print a warning before registering the daemon task.
