---
date: 2026-05-07
description: implement node can return done=true with zero source diff, and tmux_tester then reports pass because unchanged code still builds — two success signals collude to mask a planning-only run as shipped.
---

## Core Idea

The `implement` node and `tmux_tester` both reported success this run, yet zero source files changed. `implement.done=true` is a self-attestation with no diff-presence check, and `tmux_tester` is a pure project-health gate — green build + green tests on an unchanged tree trivially passes. The two success signals are independent of "did the planned work land," so they can both be true while the answer is "no." A planning-only session walks straight through `review_gate` and `tmux_confirm_gate` to `commit_push` looking identical to a real ship.

## Why It Matters

Run `d9859ff1` is a clean reproduction. Memory file `.apparat/sessions/2026-05-07-pipeline-mission-control-fragmentation.md` records:
- `implement.done=true`, `implement.iterations=1`, `implement.success=true`
- `tmux_tester.test_result=pass`, with `test_summary` containing the literal string *"no in-scope diff was produced for the mission-control plan, so nothing required fixing"*
- The plan called for edits to `src/cli/commands/pipeline/list.ts`, `validate.ts`, `program.ts`, and a new `src/cli/lib/pipeline-status.ts` — all absent on disk post-run.
- The only post-plan commit in the session, `a24b0e3`, is an unrelated illumination drop from a parallel meditate session.

The pipeline's verification chain currently has no node whose job is "the diff matches the plan." `tmux_tester`'s prose detected the gap correctly, but its structured `test_result: pass` overrode the prose — and only the structured field gates downstream nodes. Future runs will hit the same trap whenever an implement agent decides the work is already done, fails to write, or commits to the wrong path.

This compounds with `2026-05-07T2141-pipeline-failure-handoff-is-shallow.md`: when implement silently no-ops, the operator only learns post-merge that nothing shipped. Mission-control fragmentation makes the post-mortem harder still.

## Revised Implementation Steps

1. **Capture pre-implement HEAD sha** in the `implement` node's pipeline-context output (e.g. `implement.pre_sha`, set on entry). Reuse `git rev-parse HEAD` from the existing tool plumbing — no new dependency.
2. **Diff guard inside `implement`**: at exit, if `git diff --stat $implement.pre_sha HEAD` and `git status --porcelain` are both empty AND the agent's claimed action was non-trivial, set `implement.done=false` with a structured reason `no_diff_produced`. Refuse to mask a no-op as success.
3. **Plan-coverage signal in `tmux_tester`**: when entering tmux_tester, read `plan_writer.plan_path` and extract the file-paths called out by the plan (already a documented convention). Compare against the diff range. Surface a `tmux_tester.plan_files_touched: 0|N|all` field. Keep `test_result` orthogonal — this is a *separate* signal, not a downgrade of build/test health.
4. **`tmux_confirm_gate` displays both signals**: render `implement.done`, `tmux_tester.test_result`, AND `tmux_tester.plan_files_touched` in the gate prompt. Operator decides; the pipeline stops asserting "all green" when one signal is "0 plan files touched."
5. **Memory-writer cross-check**: when `tmux_tester.test_summary` contains substrings like "no in-scope diff" / "nothing to verify" / "implement node committed only", emit a `## Warnings` section in the memory file so memory-reflector sees the gap pre-distilled. Currently this surfaces only as prose buried inside `test_summary`.
6. **Backfill test**: add a smoke pipeline `pipeline-smoke-implement-noop-folder.test.ts` that drives an implement node configured to no-op and asserts the run terminates at `review_gate` with `implement.done=false`, not at `commit_push` with `done=true`.

## Provenance

- Source memory: `.apparat/sessions/2026-05-07-pipeline-mission-control-fragmentation.md`
- Pipeline run id: `d9859ff1`
- Surfaced by: memory-reflector
