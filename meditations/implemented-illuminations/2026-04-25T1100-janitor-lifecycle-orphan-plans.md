---
date: 2026-04-25
status: implemented
description: Three dispatched illuminations cannot auto-reconcile because their plan_path fields point to files with missing or wrong lifecycle frontmatter — blocking the janitor loop permanently without manual correction.
dispatched_at: 2026-04-25
plan_path: docs/superpowers/plans/2026-04-25-janitor-lifecycle-orphan-plans.md
implemented_at: 2026-04-30
---

## Findings

1. **T1400's plan_path points to a design spec, not an implementation plan**
   - **What:** `2026-04-14T1400-gitignore-pattern-doesnt-match-mcp-filename.md` (dispatched) has `plan_path: docs/superpowers/specs/2026-04-14-mcp-gitignore-pattern-fix-design.md` — a design spec whose frontmatter reads `Status: Approved`, not `status: implemented`. The actual implementation plan `docs/superpowers/plans/2026-04-14-mcp-gitignore-pattern-fix.md` is implemented and sits alongside every other completed plan, but the illumination's plan_path bypasses it entirely.
   - **Evidence:** `meditations/illuminations/2026-04-14T1400-gitignore-pattern-doesnt-match-mcp-filename.md` frontmatter: `plan_path: docs/superpowers/specs/2026-04-14-mcp-gitignore-pattern-fix-design.md`. Design spec first line: `# MCP Config Gitignore Pattern Fix Design` with `**Status:** Approved`. The linked spec has no `status: implemented` field and never will — `list_plans` only surfaces files under `docs/superpowers/plans/`.
   - **Why it matters:** The janitor reconciliation loop reads `plan_path`, calls `read_file`, and checks for `status: implemented` in the frontmatter. This illumination will fail that check on every future run. The gitignore fix shipped; the illumination will remain `dispatched` forever unless plan_path is corrected.
   - **Suggested action:** Edit the illumination frontmatter to point `plan_path` at `docs/superpowers/plans/2026-04-14-mcp-gitignore-pattern-fix.md`, which carries `status: implemented`. One-line fix unblocks the next janitor run.

2. **T1200's plan has no lifecycle frontmatter**
   - **What:** `docs/superpowers/plans/2026-04-25-meditate-prompt-is-write-only.md` — the plan that `2026-04-14T1200-meditate-prompt-is-write-only.md` dispatches to — has no YAML frontmatter block at all. The file begins directly with `# Meditate Prompt Is Write-Only...`. Neither `list_plans(status=pending)` nor `list_plans(status=implemented)` returns it.
   - **Evidence:** Reading `docs/superpowers/plans/2026-04-25-meditate-prompt-is-write-only.md` returns a file whose first line is `# Meditate Prompt Is Write-Only — SOLID Split Implementation Plan` with no preceding `---` block. `list_plans(status=pending)` returns 6 files and this plan is absent; `list_plans(status=implemented)` (from session start, 44 files) also omits it.
   - **Why it matters:** A plan invisible to `list_plans` is invisible to every workflow that queries lifecycle state — the janitor, the illumination-to-implementation pipeline, meditate sessions, and any future tooling. The dispatched illumination T1200 cannot be reconciled: the plan has no `status: implemented` to match against.
   - **Suggested action:** Prepend a frontmatter block to the plan. If the plan's feature is not yet implemented, add `status: pending`. If it shipped (the three-chunk meditate tool-strip), add `status: implemented` and T1200 closes on the next janitor run.

3. **Three 2026-04-12 pending plans have no illumination_source and no dispatching illumination**
   - **What:** `headless-governance-gates.md`, `meditate-backpressure-guard.md`, and `top-level-directory-map.md` are all dated 2026-04-12, all `status: pending`, and none carries an `illumination_source` field. No dispatched illumination in the corpus links to any of them via `plan_path`. They are invisible to the reconciliation loop from both ends.
   - **Evidence:** `list_plans(status=pending)` returns these three files at the top of the list. All three plan frontmatter blocks contain only `status: pending` — no `illumination_source` key. Scanning all dispatched illuminations, none has a `plan_path` pointing to `docs/superpowers/plans/2026-04-12-headless-governance-gates.md`, `…meditate-backpressure-guard.md`, or `…top-level-directory-map.md`.
   - **Why it matters:** These plans were manually authored before the pipeline existed. They will remain `pending` forever — no agent or pipeline will ever call `mark_plan_implemented` on them because nothing knows which feature closes them. `top-level-directory-map.md` is almost certainly stale (the inventory has changed repeatedly). `meditate-backpressure-guard.md` is the oldest unimplemented feature in the corpus and is mentioned by T0300 (`meditate-has-no-backpressure`), which is itself still open.
   - **Suggested action:** For `top-level-directory-map.md` and `top-level-directory-inventory.md` (which IS implemented): mark `top-level-directory-map` superseded / archived via the Findings route. For `meditate-backpressure-guard` and `headless-governance-gates`: add `illumination_source:` fields pointing to their respective open illuminations (T0300 and T0900) so the next reconciliation pass can close the loop.

## Lifecycle changes this run

- `2026-04-14T0800-plans-have-no-lifecycle.md` → `implemented` — plan `2026-04-25-plans-have-no-lifecycle.md` carries `status: implemented`
- `2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md` → `implemented` — plan `2026-04-17-refine-run-history-and-failure-tip.md` carries `status: implemented`
- `2026-04-19T0600-specs-commands-missing-three-pipeline-subcommands.md` → `implemented` — plan `2026-04-18-pipeline-commands-spec-backfill.md` carries `status: implemented`
- `2026-04-19T0800-mark-archived-script-will-write-the-wrong-reason.md` → `implemented` — plan `2026-04-19-mark-archived-reason-split.md` carries `status: implemented`
- `2026-04-19T1300-mark-archived-spec-drift.md` → `implemented` — plan `2026-04-20-mark-archived-spec-drift.md` carries `status: implemented`
- `2026-04-20T1800-validator-and-runtime-disagree-on-defaults.md` → `implemented` — plan `2026-04-20-validator-and-runtime-disagree-on-defaults.md` carries `status: implemented`
- `2026-04-20T2700-schema-description-overrides-agent-rubric.md` → `implemented` — plan `2026-04-20-schema-description-overrides-agent-rubric.md` carries `status: implemented`

## Reading thread

- `2026-04-14T0800-plans-have-no-lifecycle.md` — diagnosed the missing lifecycle layer in plans; T1200's no-frontmatter plan is the precise failure mode this illumination predicted ("a plan that sat in docs/superpowers/plans/ through multiple sessions")
- `2026-04-14T0600-state-machine-exists-verifier-ignores-it.md` — described how the plan_path mechanism gates reconciliation; T1400's plan_path pointing to a spec is a variant of the same bypass — the state machine is correctly implemented but the pointer defeats it
- `2026-04-20T2700-schema-description-overrides-agent-rubric.md` — established the class of bug where two sources of truth in the same chain drift silently; T1400 (illumination plan_path → wrong file) and T1200 (plan has no frontmatter) are the same class at the lifecycle layer
- `2026-04-14T0100-dispatched-is-a-dead-end-state.md` (archived) — originally named the risk of dispatched accumulation; today's 7 reconciliations prove the fix is working at scale, but T1400 and T1200 are the two that survive the closing sweep because their plan_path chain is broken, not their plan status
