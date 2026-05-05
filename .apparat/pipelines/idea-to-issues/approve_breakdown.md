---
type: gate
choices:
  - approve
  - reslice
  - cancel
inputs:
  - issues_path
  - issue_count
---

# Review proposed issue breakdown

`$issue_count` issues have been drafted at `$issues_path`.

The previous node printed each slice with title, type (AFK/HITL), and blocked-by relationships. Review them now.

## Choices

- **approve** — publish all slices to GitHub, then start the implementation loop
- **reslice** — return to slice_to_issues and propose a new breakdown
- **cancel** — stop the pipeline; nothing is published
