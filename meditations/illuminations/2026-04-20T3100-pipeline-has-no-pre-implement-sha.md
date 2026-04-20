---
date: 2026-04-20
status: open
description: Three consecutive illuminations (T2800–T3000) address tmux_tester's context blindness through rubric edits, plan-writer changes, and validator extensions — but the actual root cause is one missing variable: no node captures HEAD before implement runs, so every downstream node re-derives what changed via error-prone git-log heuristics.
---

## Core Idea

T2800, T2900, and T3000 each propose a different layer to fix — modify the implement agent's output, change plan-writer to emit verification targets, extend the validator to scan rubric markdown. All three are responding to the same symptom: `tmux_tester` doesn't know what `implement` changed. But the root cause is not in those layers. It is in the pipeline graph itself: no node captures `HEAD` before `implement` runs, so there is no ground-truth diff anchor. Every downstream node (`review_gate`, `tmux_tester`, `memory_writer`) independently re-derives "what changed" by guessing `HEAD~3` or `HEAD~5` — a heuristic that breaks silently when implement makes fewer or more commits than expected.

## Why It Matters

The tmux-tester rubric was already edited (the `M` in git status) to prefer `$changed_files` and `$touched_surfaces` from context over git-log inference. But neither variable is produced by any pipeline node, making the rubric upgrade a dead letter. T3000 named this gap correctly but attributed it to the validator's inability to scan rubrics — that is a real gap but it is a detection symptom, not the root cause. T2800's prescription (implement emits structured output) would require adding `json_schema_file` to the implement node, which would force the entire implement session to produce a JSON result — a significant behavioral change. T2900's prescription (plan-writer emits `verification_targets`) is orthogonal and valuable but adds another coordinated change across another agent. Meanwhile, `illumination-to-implementation.dot` has no node between `mark_dispatched` and `implement` that says: "remember where HEAD is right now."

## Revised Implementation Steps

1. **Add a `capture_sha` tool node** between `mark_dispatched` and `implement` in `pipelines/illumination-to-implementation.dot`:
   ```dot
   capture_sha [type="tool", cwd="$project",
                tool_command="git rev-parse HEAD",
                produces="pre_implement_sha"]
   ```
   Route `mark_dispatched -> capture_sha -> implement`.

2. **Add a `surface_classifier` tool node** between `implement` and `review_gate`:
   ```dot
   surface_classifier [type="tool", cwd="$project",
                       tool_command="git diff --name-only $pre_implement_sha HEAD | paste -sd ',' -",
                       produces="changed_files"]
   ```
   Route `implement -> surface_classifier -> review_gate`. Move the existing `implement -> review_gate` edge to `surface_classifier -> review_gate`.

3. **Thread `changed_files` into the `tmux_tester` node prompt** — append one line: `Changed files (from implement): $changed_files`. No schema change needed; `tmux_tester` already has fallback logic for when the var is absent.

4. **Skip T2800's proposal** (implement emits structured output) — `changed_files` is now available from the git diff anchor without touching the implement rubric or schema.

5. **Treat T2900 (`verification_targets` in plan-writer) as a separate, optional enhancement** — not a prerequisite to fixing the context blindness. It can ship independently once the sha anchor is in place.

6. **Add a smoke test** (`pipelines/smoke/`) that runs `capture_sha -> implement (mocked) -> surface_classifier` and asserts `changed_files` is non-empty after a commit — so this node pair has a regression guard from the start.
