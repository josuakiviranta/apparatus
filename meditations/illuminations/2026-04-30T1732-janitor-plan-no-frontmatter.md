---
date: 2026-04-30
status: open
description: Two 2026-04-30 plan files have no YAML frontmatter, causing mark_plan_implemented to fail and leaving the bundle-pipelines plan invisible to the lifecycle tracker despite being fully shipped.
---

## Findings

1. **What:** `2026-04-30-bundle-pipelines-under-src-cli.md` and `2026-04-30-specs-to-docs-portability.md` both lack YAML frontmatter — `mark_plan_implemented` returns `{ "success": false, "error": "No frontmatter found in plan file" }`.

   **Evidence:** MCP call this run: `mark_plan_implemented("2026-04-30-bundle-pipelines-under-src-cli.md")` → `{ success: false, error: "No frontmatter found in plan file" }`. Both plan files open with `# ...` (H1 heading), no `---` block. Confirmed by `mcp__illumination__read_file` on both files.

   **Why it matters:** The bundle-pipelines plan IS implemented — git commit `5ce9330 plan: tick all Chunks 1-3 checkboxes — bundle pipelines complete` confirms Chunks 1–3 fully shipped. But the MCP server cannot confirm or transition it. Every run of any agent that calls `list_plans status=pending` will see this plan as outstanding work, potentially re-dispatching or blocking on something already done. The lifecycle tracker's single source of truth is the frontmatter; without it, the lifecycle is fiction.

   **Suggested action:** Prepend frontmatter to both plans:
   - `2026-04-30-bundle-pipelines-under-src-cli.md` → `status: implemented` (work shipped per commit above)
   - `2026-04-30-specs-to-docs-portability.md` → `status: pending` (specs/ still at repo root; plan not started)

   Then call `mark_plan_implemented("2026-04-30-bundle-pipelines-under-src-cli.md")` to let the MCP server auto-commit the transition.

   Root cause: the plan-writer pipeline was expected to emit `status: pending` frontmatter (`memory/2026-04-25-plans-have-no-lifecycle.md`: "plan-writer.md — required `status: pending` + `illumination_source` frontmatter on emitted plans"), but these plans were hand-written or created via an older plan-writer path that skipped frontmatter. `scripts/backfill-plan-frontmatter.sh` only covers plans in its hardcoded lookup table (last entry: 2026-04-25). The table needs two new rows added before the script can help here.

## Lifecycle changes this run

- (none) — `mark_plan_implemented` failed due to missing frontmatter; no dispatched illuminations to reconcile.

## Reading thread

- `meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md` — the only illumination in inventory; already archived with proper `status: archived` frontmatter and `archive_reason`. Confirms the illumination side of lifecycle is healthy; gap is on the plan side only.
