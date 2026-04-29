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
outputs:
  done: boolean
---

0. **Skill invocation (mandatory, first action).** Before any reading, planning, or coding, invoke the `superpowers:subagent-driven-development` skill via the Skill tool. Invoke `superpowers:test-driven-development` before each chunk's implementation phase. These skills are the operating contract — not aspirational guidance. Skipping them is a procedure violation.
0a. Study `specs/*` with up to 500 parallel Sonnet subagents to learn the application specifications.
0b. Study @IMPLEMENTATION_PLAN.md.
0d. For reference, the application source code is in `src/*`.

1. Your task is to manage the implement functionality per the specifications using parallel subagents instructed with red/green TDD. Follow @IMPLEMENTATION_PLAN.md and choose the most important item to address.  Before making changes, search the codebase (don't assume not implemented) using Sonnet subagents. You may use up to 500 parallel Sonnet subagents for searches/reads and only 1 Sonnet subagent for build/tests. Use Opus subagents when complex reasoning is needed (debugging, architectural decisions). **Your role is orchestration, not authorship.** Every code edit must come from a dispatched subagent. Solo edits by the main agent (Edit/Write directly without dispatching) are forbidden.
2. After implementing functionality or resolving problems, run the tests for that unit of code that was improved. If functionality is missing then it's your job to add it as per the application specifications. Ultrathink.
3. When you discover issues, immediately update @IMPLEMENTATION_PLAN.md with your findings using a subagent. When resolved, update and remove the item.
4. When the tests pass, update @IMPLEMENTATION_PLAN.md, then `git add -A` then `git commit` with a message describing the changes. After the commit, `git push`.


9. IMPORTANT: Always use subagent-driven development with red/green TDD. The main agent orchestrates; subagents write code. If you find yourself about to call Edit or Write directly on a source file, STOP and dispatch a subagent instead. Reread step 0 if unsure.
99. If implementation plan contains multiple chunks, implement those in future sessions99. If implementation plan contains multiple chunks, implement those in future sessions..
9999. Important: When authoring documentation, capture the why — tests and implementation importance.
99999. Important: Single sources of truth, no migrations/adapters. If tests unrelated to your work fail, resolve them as part of the increment.
999999. As soon as there are no build or test errors create a git tag. If there are no git tags start at 0.0.0 and increment patch by 1 for example 0.0.1 if 0.0.0 does not exist.
9999999. You may add extra logging if required to debug issues.
99999999. Keep @IMPLEMENTATION_PLAN.md current with learnings using a subagent — future work depends on this to avoid duplicating efforts. Update especially after finishing your turn.
999999999. When you learn something new about how to run the application, update @AGENTS.md using a subagent but keep it brief. For example if you run commands multiple times before learning the correct command then that file should be updated.
9999999999. For any bugs you notice, resolve them or document them in @IMPLEMENTATION_PLAN.md using a subagent even if it is unrelated to the current piece of work.
99999999999. Implement functionality completely. Placeholders and stubs waste efforts and time redoing the same work.
999999999999. When @IMPLEMENTATION_PLAN.md becomes large periodically clean out the items that are completed from the file using a subagent.
9999999999999. If you find inconsistencies in the specs/\* then use an Opus 4.5 subagent with 'ultrathink' requested to update the specs.
99999999999999. IMPORTANT: Keep @AGENTS.md operational only — status updates and progress notes belong in `IMPLEMENTATION_PLAN.md`. A bloated AGENTS.md pollutes every future loop's context.
9999999999999999. Use tmux harnessing tools to verify output for terminal outputs and other terminal UI related implementations.

Take your time. I know you got this. I love you.

## Output contract

This agent runs in a deep loop: each iteration is a fresh process; you do work via Bash/git/subagent tools during the iteration; the LAST text response of each iteration MUST be a single JSON object describing whether the implementation plan is complete.

Use Bash, git, and subagents freely during the iteration to read, write, commit, and push.

After committing your chunk (or determining no chunks remain), emit JSON as your FINAL TEXT response. Never inside a thinking block.

JSON shape:
- `done: true` — when **every** chunk in the implementation plan is marked complete (`[x]`) AND no `[ ]` items remain.
- `done: false` — when at least one `[ ]` item remains in the plan.

Be honest. False positives leave incomplete work committed and visible in git history. False negatives waste iterations. Re-read the plan after committing to verify your judgment.

Example final response:

```json
{ "done": false }
```
