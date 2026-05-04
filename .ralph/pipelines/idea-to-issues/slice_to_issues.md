---
name: slice_to_issues
description: Break the PRD into vertical-slice tracer-bullet issues, write them as JSON for review, and present the breakdown to the user
model: opus
permissionMode: dangerouslySkipPermissions
tools:
  - Read
  - Write
  - Bash
mcp: []
inputs:
  - write_prd.prd_url
  - write_prd.prd_number
outputs:
  issues_path: string
  issue_count: number
---

# Slice to issues

Goal: split the PRD into independently-grabbable vertical slices that an autonomous agent can pick up one at a time.

## Inputs

- `$prd_number` — GitHub issue number for the PRD
- `$prd_url` — URL of the PRD issue

## Procedure

1. Fetch the PRD body:

```bash
gh issue view $prd_number --json body --jq .body
```

2. Break it into **tracer-bullet** vertical slices:
   - Each slice cuts through ALL layers (schema, API, UI, tests) end-to-end
   - Each slice is demoable on its own
   - Prefer many thin slices over few thick ones
   - Aim for 4–8 slices

3. For each slice, decide:
   - **Title** (short, descriptive, glossary-aligned)
   - **Type**: `AFK` (no human needed) or `HITL` (architectural decision required)
   - **Blocked by**: list of slice indices in THIS list that must complete first (use 0-based indices — the publish step resolves them to real GitHub numbers)
   - **Body** (do NOT include a "Blocked by" section — the script appends it)

4. Write the breakdown to `.ralph/runs/$run_id/proposed-issues.json` (create the dir with `mkdir -p` if missing) as:

```json
[
  {
    "title": "<short title>",
    "type": "AFK",
    "blocked_by": [],
    "body": "## Parent\n#$prd_number\n\n## What to build\n<end-to-end behaviour>\n\n## Acceptance criteria\n- [ ] ...\n\n## Notes\n..."
  }
]
```

5. Print a numbered summary of the slices in your final response so the user can review them at the next gate. Format:

```
1. <title> [AFK] — blocked by: none
2. <title> [HITL] — blocked by: 1
...
```

## Hard rules

- Vertical slices only. NEVER one-issue-per-layer.
- `blocked_by` references list indices, not GitHub numbers.
- Do not include a "Blocked by" section in the body — the publish script appends it once real numbers are known.
- Use the project glossary for titles and bodies.

## Final output

A single JSON object on its own line as the LAST text response:

```json
{ "issues_path": ".ralph/runs/<run_id>/proposed-issues.json", "issue_count": 6 }
```
