---
date: 2026-04-20
status: open
description: T3100's pre-implement SHA fix needs two nodes in two specific locations — capture_pre_sha before implement (naturally frozen by graph topology) and compute_changed_surfaces after implement (naturally re-runs on human retry) — and the existing pipeline graph delivers both behaviors without any special engine support.
---

## Core Idea

T3100 identified the root cause of tmux_tester's context blindness: no node captures HEAD before `implement` runs. The implied fix is "add a SHA capture node," but this undersells the complexity. The complete fix requires two nodes in two different locations, and the existing pipeline topology — with its retry cycles — dictates exactly where each must live. The good news: the topology delivers correct behavior automatically, with zero special-casing needed.

The two nodes are:
1. `capture_pre_sha` — a `tool_command` node: `git -C $project rev-parse HEAD`. Produces `pre_implement_sha`. Lives immediately after `mark_dispatched`, before `implement`.
2. `compute_changed_surfaces` — a `tool_command` (or `script_file`) node that diffs `$pre_implement_sha..HEAD`. Produces `changed_files` and `touched_surfaces`. Lives immediately after `implement`, before `review_gate`.

## Why It Matters

The two nodes need opposite idempotency behavior, and the graph provides it for free:

**`capture_pre_sha` must freeze on first reach.** The Retry path (`review_gate → implement [label="Retry"]`) bypasses this node entirely — it routes directly back to `implement`. So `$pre_implement_sha` stays at the original HEAD, giving a stable baseline for every subsequent diff no matter how many human retries occur.

**`compute_changed_surfaces` must refresh on every implement completion.** The forward path is always `implement → compute_changed_surfaces → review_gate`, including on human retries. So every time `implement` finishes, the diff is recomputed against the original baseline — accumulating all changes from all retry attempts into one growing delta. This is exactly the right behavior: by the time the human approves at `review_gate`, `$changed_files` shows the complete work.

**Both `review_gate` and `tmux_tester` gain the context**, not just `tmux_tester`. Placing `compute_changed_surfaces` before `review_gate` means the human reviewer sees what changed, and so does tmux_tester. If the node lived between `review_gate` and `tmux_tester`, the human at the gate would be reviewing blind.

The ToolHandler in `src/attractor/handlers/tool.ts` always re-executes — no skip-on-existing logic. The "frozen once / refresh every completion" split comes purely from graph topology, not from engine behavior.

## Revised Implementation Steps

1. **Add `capture_pre_sha` node** to `pipelines/illumination-to-implementation.dot` immediately after `mark_dispatched`:
   ```dot
   capture_pre_sha [type="tool", cwd="$project",
                    tool_command="git -C $project rev-parse HEAD",
                    produces_from_stdout=true,
                    produces="pre_implement_sha"]
   mark_dispatched -> capture_pre_sha -> implement
   ```

2. **Add `compute_changed_surfaces` node** immediately after `implement` (on the success path), before `review_gate`. Use a `script_file` if surface classification logic grows beyond one line, or a chained `tool_command` for now:
   ```dot
   compute_changed_surfaces [type="tool", cwd="$project",
                              tool_command="git -C $project diff --name-only $pre_implement_sha..HEAD | tr '\\n' ','",
                              produces_from_stdout=true,
                              produces="changed_files"]
   implement -> compute_changed_surfaces
   compute_changed_surfaces -> review_gate
   ```
   (Remove the direct `implement -> review_gate` edge.)

3. **Update `tmux_tester` node prompt** in the pipeline to reference `$changed_files` and `$pre_implement_sha` explicitly — not as inference hints, but as ground truth the agent should prefer over `git log` re-derivation. The rubric in `src/cli/agents/tmux-tester.md` already refers to these vars (per T3000); now they will actually be present.

4. **Update `plan-writer` schema and rubric** to emit `verification_targets` per T2900 — now that `$changed_files` will be in context, plan_writer can reference it when generating the verification block, giving tmux_tester a machine-readable checklist derived from the actual changed surfaces.

5. **Add a smoke test** in `pipelines/smoke/` that exercises the two new nodes with a mock implement output. Verify `$pre_implement_sha` and `$changed_files` appear in context at `review_gate`. This is the CI-visible guard that T0700 said lifecycle-correctness tests need.
