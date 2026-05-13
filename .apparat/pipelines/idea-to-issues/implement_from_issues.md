---
name: implement_from_issues
description: Pull open ready-for-agent issues from GitHub one at a time, implement, commit, push, close the issue, repeat until none remain
model: sonnet
thinking: off
permissionMode: dangerouslySkipPermissions
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
mcp: []
loop: true
maxIterations: 20
inputs: []
outputs:
  done: boolean
---

# Implement from GitHub issues

Goal: empty the queue of open issues by implementing them one per iteration.

## Per-iteration procedure

1. **List eligible issues**:

```bash
gh issue list --state open --label needs-triage --json number,title,body,labels --limit 50
```

2. **Filter blocked**: parse each issue body. If a `## Blocked by` section references a still-open issue, skip it.

3. **Pick the lowest-numbered eligible issue.** If none, this iteration is done — emit:

```json
{ "done": true, "issue_number": 0, "note": "queue empty" }
```

4. **Implement the issue end-to-end**:
   - Read body and acceptance criteria
   - TDD: write a failing test for one acceptance bullet, implement, repeat
   - Use the project glossary terms (`CONTEXT.md`) in code, tests, and commit messages
   - Run the project's test command at the seams the issue touches
   - Commit per acceptance bullet, not per file

5. **Push and close**:

```bash
git push origin $(git branch --show-current)
gh issue close <num> --comment "Implemented in $(git rev-parse HEAD)"
```

6. **Emit the iteration result** (final text response, single JSON object on its own line):

```json
{ "done": false, "issue_number": <num>, "note": "<short handoff for next iter>" }
```

## Hard rules

- One issue per iteration. Do not batch.
- Never close an issue you did not push commits for.
- Never skip tests because the iteration is "small".
- If implementation gets stuck, leave a comment on the issue with what you tried, then emit `done: true` so a human can pick it up.

## Final output (every iteration)

A single JSON object on its own line as the LAST text response (never inside a thinking block):

```json
{ "done": false, "issue_number": 42, "note": "added auth middleware; next iter picks up #43" }
```
