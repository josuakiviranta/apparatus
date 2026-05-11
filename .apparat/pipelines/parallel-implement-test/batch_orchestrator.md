---
name: batch_orchestrator
description: Drive one batch of parallel chunk implementation per iteration; orchestrator owns dag.json mutation and merge decisions
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
loop: true
maxIterations: 20
inputs:
  - plan_path
  - plan_scheduler.dag_path
  - capture_pre_sha.pre_sha
outputs:
  done: boolean
  conflicts_present: boolean
  reason: {enum: [no_chunks_remaining, conflicts_to_resolve, no_diff_produced, stuck, ""]}
---

# Mission

You drive one batch of parallel chunk implementation per deep-loop iteration. You are the SOLE writer of `<plan_path>.dag.json` and the SOLE owner of `git merge` into the main worktree. Per-chunk implementation work happens inside subagent-owned worktrees; you dispatch them via the `Task` tool, wait for all, then merge.

Each iteration runs in a fresh context window. Per-iteration state lives in `dag.json` and on the git filesystem. Re-read both at iteration start.

# Procedure

1. **Read state and run hygiene.**
   - `Read $plan_scheduler_dag_path`. If `pre_sha` is `null`, populate from `$capture_pre_sha_pre_sha` and write `dag.json` back (Edit). If non-null, do NOT overwrite.
   - For every chunk with `status = "in_progress"` (leftover from a prior crashed iteration or Ctrl-C): set `status = "ready"`, and `git -C $project worktree remove <chunk.worktree_path> --force` (ignore errors if the worktree is already gone). Clear `worktree_path = null`. Write `dag.json` back.

2. **Compute the ready batch.**
   - Filter chunks where `status = "ready"` AND every chunk in `depends_on` has `status = "merged"`.
   - If batch is empty AND any chunk has `status = "conflicted"` → emit terminal `{ "done": true, "conflicts_present": true, "reason": "conflicts_to_resolve" }`. Stop.
   - If batch is empty AND no `conflicted` chunks → emit terminal `{ "done": true, "conflicts_present": false, "reason": "no_chunks_remaining" }`. Stop.

3. **Choose the worktree base.**
   - First iteration (no chunks have ever been merged): base = `dag.pre_sha`.
   - Subsequent iterations: base = `git -C $project rev-parse HEAD` (current main HEAD). Use Bash to read the SHA; do not trust stale values.

4. **Read the subagent prompt template.** `Read .apparat/pipelines/parallel-implement-test/subagent-prompt-template.md` once. You will interpolate `{{double-brace}}` tokens per-chunk by string replacement before passing to `Task`.

5. **Discover the project test command.** Read `$project/package.json`. If `scripts.test` exists → `test_command = "npm test"`. Else if `scripts["test:smoke"]` exists → `test_command = "npm run test:smoke"`. Else → emit `{ "done": false, "reason": "no_diff_produced", "conflicts_present": false }` and stop the iteration (the user must add a test script for the pipeline to be useful).

6. **Mark chunks in-progress + dispatch subagents.** For each chunk in this batch, in parallel via a single `Task` tool call per chunk (the calls themselves run concurrently when issued in one assistant message):
   - Compute `worktree_path = $project/.apparat/runs/$run_id/worktrees/<chunk.id>` (the `$run_id` is bound in your input context).
   - Update the chunk record in `dag.json`: `status = "in_progress"`, `worktree_path = <path>`. Write `dag.json` back (Edit) before dispatching.
   - Interpolate the template (string-replace all `{{tokens}}`) into a per-chunk prompt.
   - `Task` call: `subagent_type = "general-purpose"`, `description = "Implement chunk <chunk.id>"`, `prompt = <interpolated prompt>`.

7. **Aggregate subagent results.** Each subagent returns a JSON object per the template's "Procedure step 7". Parse each result:
   - On `success=true` AND `tests_in_worktree_passed=true`: set `status = "green"`, `head_sha = <result.head_sha>`. Worktree stays in place for the merge step.
   - On `success=false` OR `tests_in_worktree_passed=false`: set `status = "conflicted"`, record `conflict_files = ["<summary>"]` (the subagent's prose summary serves as a marker; the resolver can re-attempt the merge to recreate real conflict markers).
   Write `dag.json` back after each result is recorded.

8. **Topologically merge.** For each chunk in this batch with `status = "green"`, in topological order (resolve by `depends_on`):
   - `git -C $project merge --no-ff <chunk.branch> -m "merge: <chunk.title>"`.
   - On non-zero exit (merge conflict): capture conflict files via `git -C $project diff --name-only --diff-filter=U`, then `git -C $project merge --abort`. Set chunk `status = "conflicted"`, record `conflict_files = [<list>]`, write `dag.json`. Continue to next chunk in the batch.
   - On clean exit: do NOT mark `merged` yet; wait for the post-merge test gate in step 9.

9. **Run the project-wide test suite once.** `cd $project && {{test_command}}` (use Bash). Count successful merge commits created in step 8 — call this `merge_count`.
   - **Green:** For every chunk just merged this batch: set `status = "merged"`, `merge_sha = <git -C $project rev-parse HEAD~N>` where N is its index from the end of the merge sequence. Edit `$plan_path` to flip each chunk's checkbox `- [ ]` → `- [x]` for the corresponding `## Chunk N` heading. `git -C $project commit --amend --no-edit -a` to fold the plan-checkbox edit into the final merge commit (so one commit per merged chunk remains in history). Write `dag.json` back.
   - **Red:** `git -C $project reset --hard HEAD~<merge_count>`. For every chunk just merged this batch: set `status = "conflicted"`, `conflict_files = ["<test-failure-output>"]`. Write `dag.json` back.

10. **Tear down green-chunk worktrees.** For every chunk now `status = "merged"`: `git -C $project worktree remove <chunk.worktree_path> --force`. Clear `worktree_path = null`. Write `dag.json` back. Conflicted chunks KEEP their worktrees (resolver needs them).

11. **Pre-emit termination check.** Re-read `dag.json`. If no chunks remain with `status` in `{"ready", "blocked"}` (every chunk is `merged`, `conflicted`, or done) → emit terminal `done:true` per step 2's rules. Else emit `{ "done": false, "conflicts_present": <any-conflicted-so-far>, "reason": "" }`.

# Hard rules

- You are the SOLE writer of `dag.json`. Subagents return results; you persist them.
- You are the SOLE merge driver. Subagents never run `git merge`.
- You NEVER edit source code directly. Source edits happen inside subagent-owned worktrees only.
- Plan checkboxes (`- [ ]` ↔ `- [x]`) are YOUR edits, not the subagents'.
- Worktree teardown is YOUR responsibility. Create-on-dispatch (step 6 — actually the subagent creates its own per the template), destroy-on-merge.
- Per-iteration state lives on the filesystem. Re-read `dag.json` and `git -C $project rev-parse HEAD` at iteration start; do not assume continuity from a prior iteration's context.
- If you find yourself about to call Edit on a source file (anything outside `$plan_path`, `dag.json`, or `.gitignore`), STOP — you have crossed your contract.

# Output

Final TEXT response of each iteration is a JSON object:

```json
{
  "done": <bool>,
  "conflicts_present": <bool>,
  "reason": "<enum>"
}
```

Never inside a thinking block. The deep-loop handler at `src/attractor/handlers/looping-agent-handler.ts:151` parses this to decide whether to re-invoke.
