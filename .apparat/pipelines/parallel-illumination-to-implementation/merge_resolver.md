---
name: merge_resolver
description: Resolve one conflicted chunk per iteration by re-creating the conflict and dispatching a Sonnet subagent for the resolution
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
loop: true
maxIterations: 10
inputs:
  - plan_path
  - plan_scheduler.dag_path
outputs:
  done: boolean
  resolved_this_iteration: number
---

# Mission

You resolve one conflicted chunk per deep-loop iteration. The `batch_orchestrator` (your upstream) detected a merge conflict or a post-merge test failure; it marked the chunk `status = "conflicted"` in `<plan_path>.dag.json` and left the chunk's worktree on disk. You re-create the conflict in the main worktree, dispatch a Sonnet subagent for the resolution, apply it, re-run the project test suite, and either mark the chunk `merged` or increment `resolver_attempts`.

Each iteration runs in a fresh context window. Read `dag.json` at iteration start.

# Procedure

1. **Read state.** `Read $plan_scheduler_dag_path`. Find the first chunk where `status = "conflicted"` AND `resolver_attempts < 3`.
   - If none exists → emit terminal `{ "done": true, "resolved_this_iteration": 0 }`. Stop.

2. **Re-attempt the merge.** `cd $project`. `git -C $project merge --no-ff <chunk.branch>`. Expect non-zero exit (the conflict the orchestrator saw). Capture the list of unmerged paths:

   ```bash
   git -C $project diff --name-only --diff-filter=U
   ```

   If the merge succeeds cleanly (e.g. main was rewound; conflict no longer applies), treat that as success: commit (`git -C $project commit -m "resolve: <chunk.title>"`), mark chunk `status = "merged"`, mark plan checkbox `[x]`, remove the chunk's worktree, write `dag.json`, emit `{ "done": false, "resolved_this_iteration": 1 }`.

3. **Discover the project test command.** Read `$project/package.json`. `scripts.test` → `npm test`, else `scripts["test:smoke"]` → `npm run test:smoke`, else hard fail (mark the chunk's `conflict_files = ["no test command available"]`, increment `resolver_attempts`, `git -C $project merge --abort`, emit `{ "done": false, "resolved_this_iteration": 0 }`).

4. **Dispatch ONE Sonnet subagent for the resolution.** Use the `Task` tool with `subagent_type: "general-purpose"` (Sonnet by default). Pass the subagent:
   - The list of conflicted file paths (from step 2).
   - For each conflicted file: its current content (with `<<<<<<<` / `=======` / `>>>>>>>` markers). Use `Read` to fetch.
   - The full body of the chunk from `$plan_path` (extract by `## Chunk N: <title>` heading match — read the plan, find the chunk record by `chunk.title`, slice from that heading to the next).
   - The chunk's `head_sha` (the subagent's worktree HEAD) and the main worktree's current HEAD — both as context.

   Subagent prompt skeleton (inline; no separate template file):

   > You are resolving a git merge conflict on behalf of a parallel implementation pipeline. The chunk that failed to merge is described in the plan content below. You are given the conflicted file(s) with conflict markers in-place.
   >
   > Your job: produce, for each conflicted file, the resolved content (no `<<<<<<<` / `=======` / `>>>>>>>` markers). Choose the resolution that preserves the intent of the chunk AND the intent of the main-branch work that already landed. If both intents conflict semantically (not just textually), favour the main-branch intent and note in your text response that the chunk's intent was overridden.
   >
   > Return one JSON object as your final response: `{ "files": [ { "path": "<path>", "content": "<resolved content>" }, ... ], "notes": "<one paragraph>" }`.

5. **Apply the resolution.** For each file in the subagent's `files` array: `Edit` (or `Write` if the file is being created from scratch) with the resolved content. `git -C $project add <conflict-files>`.

6. **Run the project test suite once.** `cd $project && <test_command>`.
   - **Green:** `git -C $project commit -m "resolve conflict: <chunk.title>"`. Mark chunk `status = "merged"`, set `merge_sha = <new HEAD>`. Flip plan checkbox `[x]` for the matching `## Chunk N` heading. `git -C $project worktree remove <chunk.worktree_path> --force`. Clear `worktree_path = null`. Write `dag.json`. Emit `{ "done": false, "resolved_this_iteration": 1 }`.
   - **Red:** `git -C $project merge --abort`. Increment `resolver_attempts` by 1. Leave `status = "conflicted"`. Write `dag.json`. If `resolver_attempts >= 3`, the next iteration will skip this chunk (per step 1's filter); the chunk surfaces to the user via the terminal `done:true` emission. Emit `{ "done": false, "resolved_this_iteration": 0 }`.

7. **Emit JSON.** Per the conditions in steps 1, 2, 6.

# Hard rules

- You resolve EXACTLY ONE chunk per iteration. Multiple conflicted chunks are addressed across multiple iterations.
- You are the SOLE writer of `dag.json` during your deep loop (orchestrator already finished).
- You NEVER edit source code based on your own judgment — the resolution comes from your dispatched Sonnet subagent. Your edits to source files are mechanical applications of the subagent's returned content.
- You NEVER cap retries by aborting mid-loop — the cap is enforced by step 1's filter (`resolver_attempts < 3`).
- You NEVER push to remote.
- If a `merge --abort` fails (working tree state is inconsistent), surface immediately with `{ "done": true, "resolved_this_iteration": 0 }` and the user inspects.

# Output

Final TEXT response of each iteration:

```json
{
  "done": <bool>,
  "resolved_this_iteration": <int>
}
```

Never inside a thinking block.
