---
date: 2026-05-03
run_id: c33f60a2-c956-435f-bfc1-751418003e0a
plan: docs/superpowers/plans/2026-05-03-janitor-dead-scripts.md
design: docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md
illumination: meditations/illuminations/2026-05-01T0255-janitor-dead-scripts.md
test_result: pass
---

# janitor-dead-scripts

## What was implemented
Deleted the dead `scripts/` folder: `backfill-plan-frontmatter.sh` (one-shot migration whose hardcoded STATUS table targets plan files that no longer exist) and `audit-tool-nodes.mjs` (dev-only audit helper with zero callers). Folder removed too.

## Key files
- D `scripts/backfill-plan-frontmatter.sh`
- D `scripts/audit-tool-nodes.mjs`
- A `docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md`
- A `docs/superpowers/plans/2026-05-03-janitor-dead-scripts.md`

## Decisions and patterns
- Single deletion commit (`cce1d12`) for both files + folder — no intermediate junk-drawer state.
- Pure subtraction: nothing in `src/`, `dist/`, `package.json`, or npm `files` was touched. Surfaces crossed: zero (no imports, no script bindings, no callers).
- Followed the existing janitor lens (recent bundled-janitor illuminations 2026-05-01T0212 and T0255-bundled).

## Learnings from the run
- Plan lifecycle flip failed: "Cannot mark as implemented: current status is complete" — plan was already flipped earlier in the session by a prior commit (`4663907 docs(plan): mark janitor-dead-scripts complete`), so `mark_plan_implemented` rejected the second flip. Same not-idempotent pattern logged in illumination 2026-05-01T1537-mark-plan-implemented-not-idempotent.md.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build + 1251 tests pass (134 files, includes all 14 pipeline-smoke-*-folder.test.ts wrappers); tool smoke pipeline runs ✓ success in tmux. Diff was pure deletion of two unreferenced dev scripts (scripts/backfill-plan-frontmatter.sh, scripts/audit-tool-nodes.mjs) plus the empty scripts/ folder — no source/dist surface touched. No fixes were needed.
