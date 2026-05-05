---
name: write_prd
description: Synthesise the grilling session into a PRD and publish it as a GitHub issue with the needs-triage label
model: opus
permissionMode: dangerouslySkipPermissions
tools:
  - Read
  - Write
  - Bash
  - Task
mcp: []
inputs: []
outputs:
  prd_url: string
  prd_number: number
---

# Write PRD and publish

Goal: turn the grilling-session decisions into a concise PRD and post it as a GitHub issue.

## Procedure

1. Read `CONTEXT.md` so you can speak in the project's language. Respect any ADRs in `docs/adr/` for the area you are touching.

2. Sketch the major modules to build or modify. Look for opportunities to extract **deep modules** (small interface, deep implementation) that can be tested in isolation. Do not include file paths — they rot.

3. Write the PRD using this template:

```markdown
## Problem Statement
<from the user's perspective>

## Solution
<from the user's perspective>

## User Stories
1. As a <actor>, I want <feature>, so that <benefit>
...

## Implementation Decisions
- Modules to build/modify (and their interfaces)
- Architectural decisions
- Schema changes
- API contracts

## Testing Decisions
- What makes a good test (external behaviour, not implementation)
- Which modules will be tested
- Prior art in the codebase

## Out of Scope
<what this PRD explicitly does not cover>
```

4. Save the rendered PRD to `.apparat/runs/$run_id/prd.md` (create the dir with `mkdir -p` if missing).

5. Publish via `gh`:

```bash
gh issue create \
  --title "PRD: <short feature name>" \
  --label needs-triage \
  --body-file .apparat/runs/$run_id/prd.md
```

Capture the issue number and URL from the `gh` output (the URL is on stdout).

## Final output

A single JSON object on its own line as the LAST text response (never inside a thinking block):

```json
{ "prd_url": "https://github.com/<org>/<repo>/issues/123", "prd_number": 123 }
```
