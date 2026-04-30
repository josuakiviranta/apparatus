---
date: 2026-04-30
status: open
description: mark_plan_implemented is whitelisted in janitor.md but the procedure has no step that triggers it — orphan and manually-authored pending plans have no closer in either memory-writer or janitor workflows.
---

## Findings

### 1. `mark_plan_implemented` whitelist has no matching procedure step in janitor.md

**What:** `janitor.md` hard-rules state "Your only mutating calls are to `write_illumination`, `mark_implemented`, and `mark_plan_implemented`" and the tools list includes `mcp__illumination__mark_plan_implemented` — but the 4-step reconciliation procedure names no trigger condition for calling it. Only `mark_implemented` (step 2) and `write_illumination` (step 7) have anchored procedure steps.

**Evidence:**
- `pipelines/janitor/janitor.md:tools` (lines 7–9): `mcp__illumination__mark_plan_implemented` whitelisted.
- `pipelines/janitor/janitor.md:hard-rules`: "Your only mutating calls are to `write_illumination`, `mark_implemented`, and `mark_plan_implemented`."
- Procedure steps 1–7: step 2 calls `mark_implemented`; steps 3–4 read plans and add findings; no step says "call `mark_plan_implemented` when a pending plan's feature has shipped."

**Why it matters:** `memory-writer` step 7a closes plans for pipeline-generated plans via `$plan_writer.plan_path`. But three orphan plans from 2026-04-12 (`headless-governance-gates.md`, `meditate-backpressure-guard.md`, `top-level-directory-map.md`) have no dispatching illumination and no pipeline-generated path — `memory-writer` will never see them. Twelve orphan plans dated 2026-04-26–04-29 (documented by T0421) also lack `status: pending` frontmatter and are invisible to all lifecycle filters until backfilled. Once backfilled, they become reachable by `mark_plan_implemented` — but the only viable caller (the janitor) has no procedure step to call it.

The janitor's reconciliation loop is currently one-directional: it reads plan status to close illuminations (mark_implemented, step 2), but never reads feature-shipped signals to close plans. The symmetric half of reconciliation — verifying via grep/code-scan that a pending plan's prescribed behavior exists in source, then calling `mark_plan_implemented` — is authorized by the whitelist but structurally absent from the procedure.

**Suggested action:** Add a step 2b to the janitor procedure between the current steps 2 and 3:

> **Step 2b.** Call `list_plans status=pending`. For each pending plan that pre-dates the current engine version (plans authored before `v0.2.0`, identifiable by absence of `## Chunk` structure with `inputs:` anchors, or by date ≤ 2026-04-22), use `read_file` + `Grep` to determine whether the plan's prescribed behavior is present in source. If the feature has verifiably shipped, call `mark_plan_implemented` with the plan filename. If status is ambiguous or the feature is absent, add a finding ("stale-pending plan: `<filename>`") and move on.

This closes the symmetric gap: memory-writer closes pipeline-generated plans; the janitor closes manually-authored or pre-pipeline plans whose shipped state can be inferred from the codebase.

### 2. Three 2026-04-12 pending plans have shipped features — janitor has no trigger to close them

**What:** `headless-governance-gates.md`, `meditate-backpressure-guard.md`, and `top-level-directory-map.md` are `status: pending`, have no `illumination_source`, and carry no `dispatched_at` field. Their features may have partially or fully shipped across subsequent pipeline runs over the past 17 days.

**Evidence:**
- `list_plans status=pending` returns these three as the oldest pending plans.
- `top-level-directory-map.md` — multiple "top-level-directory-snapshot" illuminations (`T0500`, `T1200`, `T2200`, `T1200-2026-04-17`, `T1000-2026-04-25`) have since been written, suggesting the original "directory map" goal has been superseded many times.
- `meditate-backpressure-guard.md` — T0300 (`meditate-has-no-backpressure.md`, status open) confirms the feature did NOT ship; but T1200 (`meditate-prompt-is-write-only.md`, status implemented) may have partially addressed the concern via a different mechanism.
- `headless-governance-gates.md` — no illumination cross-references visible in the corpus; likely superseded by the headless_safe= DOT attribute shipped in 2026-04.

**Why it matters:** These plans will remain `pending` indefinitely without a janitor procedure step to close them. As the lifecycle filters stabilize post-T0421 backfill, stale-pending plans will increasingly pollute `list_plans status=pending` with entries that block reconciliation signal.

**Suggested action:** Audit these three plans one at a time via `read_file` + targeted `Grep` against `src/`. For plans where the feature shipped (e.g., `top-level-directory-map`), call `mark_plan_implemented`. For plans where the feature is genuinely absent (`meditate-backpressure-guard`), leave `status: pending` and add `illumination_source:` pointing to the open illumination that owns it.

## Lifecycle changes this run

- (none) — five dispatched illuminations checked; all plans are either `status: pending` (T0600, T1000, T1100) or orphans with no frontmatter (T0900, T2000 confirmed by T0421). Zero `mark_implemented` calls made.

## Reading thread

- `2026-04-30T0421-janitor-plan-writer-open-gap.md` — confirmed T0900/T2000 plan orphan status and documented the 12 orphan plans; finding 1 above names the structural gap that will persist even after T0421's backfill lands: no caller exists for manually-authored pending plans.
- `2026-04-30T0514-janitor-stale-pending-class.md` — identified stale-pending as a fourth plan-health class (correct frontmatter, engine-incompatible steps); finding 2 above adds "superseded-pending" as a fifth class (correct frontmatter, feature already shipped via a different path) that also has no closure trigger.
- `2026-04-30T0638-janitor-stale-verifier-copy.md` — confirmed the test-infrastructure gap where CI validates the wrong agent file; T0638's pattern (capability whitelisted but no enforcement path) is structurally parallel to finding 1 above (tool whitelisted but no procedure trigger).
