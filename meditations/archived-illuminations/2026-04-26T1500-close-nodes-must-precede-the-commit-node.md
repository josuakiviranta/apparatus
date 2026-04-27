---
date: 2026-04-26
status: archived
description: T1400's proposed ordering (memory_writer → close_plan → close_illumination) inverts the write-then-commit pattern the pipeline already uses — close scripts are write-only like mark-dispatched, so they must run before memory_writer's git add -A, not after it.
archived_at: 2026-04-27
reason: Closure already wired via memory-writer rubric step 7 using MCP tools that auto-commit
---

## Core Idea

`mark-dispatched.mjs` and `mark-archived.mjs` are write-only scripts — they update frontmatter and exit with JSON, no `git commit`. `memory_writer`'s `git add -A; commit; push` is the sweep that makes those writes durable. The pattern works because `mark_dispatched` runs before `memory_writer`.

T1400 proposes `memory_writer → close_plan → close_illumination → done`. The close scripts T1400 prescribes (mirroring `mark-dispatched.mjs`) would also be write-only. Running them after `memory_writer` means their frontmatter writes happen after the commit — and nothing sweeps them. The illumination and plan frontmatter would be updated on disk but never committed. The janitor reads those files to confirm closure; it would never see `status: implemented`.

The correct ordering is `close_plan → close_illumination → memory_writer → done`. Memory_writer's existing `git add -A; commit; push` then sweeps all three writes (plan frontmatter, illumination frontmatter, memory file) atomically — three files, one commit, one push.

## Why It Matters

The write-then-commit ordering is already the load-bearing convention of this pipeline. `mark_dispatched` writes but doesn't commit; `memory_writer` sweeps. Inverting this for the close pair silently breaks durability. The failure mode is invisible: the pipeline exits cleanly, structured JSON emits correctly, but the lifecycle states never land in git. The janitor reads stale dispatched status and the loop stays broken forever — same symptom as T0900, different cause.

The evidence is in `pipelines/scripts/mark-dispatched.mjs` (lines 1–35): no `execSync`, no `git`. Closure scripts will be authored the same way. `memory_writer`'s rubric (step 5–6) does the `git add -A; commit; push`. Swap the order and the sweep covers all writes; keep T1400's order and the sweep runs too early.

There is a second benefit to the corrected ordering: `memory_writer` can read the frontmatter it just wrote as evidence. If `close_plan` and `close_illumination` have already updated both files, the memory file can record `lifecycle: closed` as a verified fact, not a hopeful claim.

## Revised Implementation Steps

1. **Write `pipelines/scripts/mark-implemented.mjs`** — mirrors `mark-dispatched.mjs`. Args: `$illumination_path`. Reads frontmatter, asserts `status: dispatched`, writes `status: implemented` + `implemented_at: <today>`. No `git commit`. Idempotent: already-`implemented` is a no-op.

2. **Write `pipelines/scripts/mark-plan-implemented.mjs`** — mirrors `mark-implemented.mjs` but reads from `docs/superpowers/plans/<basename>`. Transitions `pending → implemented`. No `git commit`. Idempotent.

3. **Insert two tool nodes BEFORE `memory_writer` in `illumination-to-implementation.dot`:**

   ```dot
   close_plan [type="tool", cwd="$project",
               script_file="scripts/mark-plan-implemented.mjs",
               script_args="$plan_path"]

   close_illumination [type="tool", cwd="$project",
                       script_file="scripts/mark-implemented.mjs",
                       script_args="$illumination_path"]

   tmux_confirm_gate -> memory_writer [label="Commit"]
   review_gate -> memory_writer       [label="Approve"]
   ```

   Becomes:

   ```dot
   tmux_confirm_gate -> close_plan [label="Commit"]
   review_gate -> close_plan       [label="Approve"]
   close_plan -> close_illumination -> memory_writer -> done
   ```

4. **Remove `mark_plan_implemented` from `memory-writer.md` rubric** (step 7 and from the `mcp:` tools list). The rubric should write the memory file — graph nodes handle lifecycle. Keeping it in both layers invites the shadow-procedure bug T1300 and T1200 diagnosed at the illumination layer.

5. **Apply T1300 in the same diff** (remove the numbered 1–6 list from the `memory_writer` node prompt). These are the same node — ship both changes atomically.

6. **Assert in `illumination-to-implementation.artifacts.test.ts`** that after a run, `$illumination_path` frontmatter contains `status: implemented` and `$plan_path` frontmatter contains `status: implemented`. This is the first proof-of-usage test for the full lifecycle close.
