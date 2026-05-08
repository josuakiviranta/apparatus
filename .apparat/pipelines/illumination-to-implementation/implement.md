---
name: implement
description: Autonomous code implementation loop
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
loop: true
inputs:
  - plan_writer.plan_path
  - capture_pre_sha.pre_sha
outputs:
  done: boolean
  reason: {enum: [no_diff_produced, ""]}
---

0. **Skill invocation (mandatory, first action).** Before any reading, planning, or coding, invoke the `superpowers:subagent-driven-development` skill via the Skill tool. Invoke `superpowers:test-driven-development` before each chunk's implementation phase. These skills are the operating contract — not aspirational guidance. Skipping them is a procedure violation.
0a. **Orient before acting.** First, discover the project layout:

- Source root: Glob `$project` for `src/`, `lib/`, `app/`, `pkg/`, `cmd/`, `internal/` — pick directories that exist.
- Docs root: Glob `$project` for `docs/`, `documentation/`, `architecture/` — pick what exists.
- ADR location: under the discovered docs root, look for `adr/` or `decisions/`.

Then dispatch parallel Sonnet subagents (up to 100) to read concurrently:

- `$project/CONTEXT.md` if present (domain language)
- All files in the discovered ADR location, if any
- `$project/README.md` (mission + command surface)
- File inventory of each discovered source root — one subagent per top-level subdir, returns file list + one-paragraph role summary
- Output of `git log --since="2 weeks ago" --oneline` from `$project`

Each subagent returns a brief summary of its slice. For code-level facts during work, Grep/Glob the discovered source roots on demand.
0b. **Read the active plan.** The pipeline binds the path of the just-written plan as `$plan_writer_plan_path`. That file — and only that file — is your work list. Read it in full with `Read $plan_writer_plan_path`. Do **not** open `IMPLEMENTATION_PLAN.md` at the project root; that file (when present) is legacy state from older flows and will mislead this loop into reporting `done:true` against unrelated checkboxes.
Step 0c. **Diff-guard reference (already captured).** A prior `capture_pre_sha` tool node recorded HEAD before this node fired. The value is injected as `$capture_pre_sha_pre_sha` (rendered tag in the inputs block above). Do NOT run `git rev-parse HEAD` yourself — every implement iteration shares the same baseline so each iteration's diff-guard compares against the original HEAD, not the prior iteration's commit. You do not need to emit it back; downstream nodes consume `capture_pre_sha.pre_sha` directly.
0d. For reference, the application source code is in `src/*`.

1. Your task is to implement the plan at `$plan_writer_plan_path` using parallel subagents instructed with red/green TDD. Pick the next unchecked (`- [ ]`) chunk in that plan and address it. Before making changes, search the codebase (don't assume not implemented) using Sonnet subagents. You may use up to 500 parallel Sonnet subagents for searches/reads and only 1 Sonnet subagent for build/tests. Use Opus subagents when complex reasoning is needed (debugging, architectural decisions). **Your role is orchestration, not authorship.** Every code edit must come from a dispatched subagent. Solo edits by the main agent (Edit/Write directly without dispatching) are forbidden.
2. After implementing functionality or resolving problems, run the tests for that unit of code that was improved. If functionality is missing then it's your job to add it as per the application specifications. Ultrathink.
3. When you discover issues, immediately update `$plan_writer_plan_path` with your findings using a subagent. When resolved, update and remove the item.
4. When the tests pass, update `$plan_writer_plan_path` (mark the chunk `[x]`), then `git add -A` then `git commit` with a message describing the changes. After the commit, `git push`.

5. **Diff guard before declaring done (mandatory final pre-emit step).** Before emitting your iteration's final JSON, run in `$project`:

    ```bash
    cd $project
    diff_stat=$(git diff --stat $capture_pre_sha_pre_sha HEAD)
    porcelain=$(git status --porcelain)
    ```

    If BOTH `diff_stat` AND `porcelain` are empty AND this iteration's narrative claimed non-trivial implementation work (you attempted a chunk, you intended to touch a file), emit:

    ```json
    { "done": false, "reason": "no_diff_produced" }
    ```

    Refuse to mask a no-op as success — the deep loop will re-invoke you with a fresh context to actually do the work. Otherwise emit:

    ```json
    { "done": <self-attested>, "reason": "" }
    ```

    The handler at `src/attractor/handlers/looping-agent-handler.ts:151` still trusts the `done` field as-is — this guard lives in the agent prompt, not the handler, so policy tweaks (e.g. allow no-op for doc-only plans) stay readable here. The pre_sha itself is owned by the upstream `capture_pre_sha` tool node and consumed directly by downstream nodes (e.g. tmux-tester); do not re-emit it.

9. IMPORTANT: Always use subagent-driven development with red/green TDD. The main agent orchestrates; subagents write code. If you find yourself about to call Edit or Write directly on a source file, STOP and dispatch a subagent instead. Reread step 0 if unsure.
99. If `$plan_writer_plan_path` contains multiple chunks, implement one chunk per iteration. The deep-loop runner will re-invoke you with a fresh context until the plan reports all `[x]`.
9999. Important: When authoring documentation, capture the why — tests and implementation importance.
99999. Important: Single sources of truth, no migrations/adapters. If tests unrelated to your work fail, resolve them as part of the increment.
999999. As soon as there are no build or test errors create a git tag. If there are no git tags start at 0.0.0 and increment patch by 1 for example 0.0.1 if 0.0.0 does not exist.
9999999. You may add extra logging if required to debug issues.
99999999. Keep `$plan_writer_plan_path` current with learnings using a subagent — future iterations depend on this to avoid duplicating efforts. Update especially after finishing your turn.
9999999999. For any bugs you notice, resolve them or document them in `$plan_writer_plan_path` using a subagent even if it is unrelated to the current piece of work.
99999999999. Implement functionality completely. Placeholders and stubs waste efforts and time redoing the same work.
9999999999999999. Use tmux harnessing tools to verify output for terminal outputs and other terminal UI related implementations.

Take your time. I know you got this. I love you.

## Output contract

This agent runs in a deep loop: each iteration is a fresh process; you do work via Bash/git/subagent tools during the iteration; the LAST text response of each iteration MUST be a single JSON object describing whether the implementation plan is complete.

Use Bash, git, and subagents freely during the iteration to read, write, commit, and push.

After committing your chunk (or determining no chunks remain), emit JSON as your FINAL TEXT response. Never inside a thinking block.

JSON shape:
- `done: true` — when **every** chunk in `$plan_writer_plan_path` is marked complete (`[x]`) AND no `[ ]` items remain in that file.
- `done: false` — when at least one `[ ]` item remains in `$plan_writer_plan_path`.

The decision is computed against `$plan_writer_plan_path` only. Do not consult `IMPLEMENTATION_PLAN.md` or any other plan-shaped file at the project root — they belong to other flows and will produce false `done:true` verdicts against work this pipeline never asked for.

Be honest. False positives leave incomplete work committed and visible in git history. False negatives waste iterations. Re-read `$plan_writer_plan_path` after committing to verify your judgment.

Example final response:

```json
{ "done": false }
```
