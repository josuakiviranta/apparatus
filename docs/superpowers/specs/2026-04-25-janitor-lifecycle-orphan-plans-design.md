# Janitor Lifecycle Orphan Plans — Design

**Status:** Approved
**Date:** 2026-04-25
**Related:** `meditations/illuminations/2026-04-25T1100-janitor-lifecycle-orphan-plans.md`, `src/cli/agents/janitor.md`, `src/cli/mcp/illumination-server.ts`, `docs/superpowers/specs/2026-04-25-janitor-agent-design.md`, `docs/superpowers/specs/2026-04-12-mark-implemented-lifecycle-design.md`

## Overview

Three completed pieces of work cannot leave the `dispatched` state because the lifecycle pointers between illumination and plan are broken:

1. **T1400** points its `plan_path` at a *design spec*, not the implementation plan. Specs never carry `status: implemented`, so the janitor's reconciliation rule fails on every future run.
2. **T1200's plan file has no YAML frontmatter at all**, so `list_plans` cannot surface it under any status filter — it is invisible to every lifecycle workflow.
3. **Three 2026-04-12 plans** (`headless-governance-gates`, `meditate-backpressure-guard`, `top-level-directory-map`) were authored before the pipeline existed. They carry only `status: pending` — no `illumination_source` field — and no dispatched illumination links to them via `plan_path`. They are invisible to the reconciliation loop from both ends.

This design narrows on a one-shot data fix: five frontmatter edits that re-thread the broken pointers so the standing janitor (`src/cli/agents/janitor.md`) can close the loop on its next run. **No code changes. No janitor logic changes. No new tools.**

## Why now

The janitor agent (`docs/superpowers/specs/2026-04-25-janitor-agent-design.md`) and lifecycle reconciliation (`docs/superpowers/specs/2026-04-12-mark-implemented-lifecycle-design.md`) just shipped. This run reconciled 7 illuminations cleanly. These three are the survivors of the closing sweep — and they survive every future sweep too, because the broken pointers are data, not logic. Without this fix:

- `list_illuminations status=dispatched` stays permanently noisy with three items whose work shipped weeks ago.
- T1200's plan stays invisible to `list_plans` indefinitely — every future agent that lists plans is blind to it.
- Three pending plans with no source illumination accumulate as silent zombies; nothing closes them.

One-line edits today buy us a clean lifecycle ledger going forward.

## Architecture

The janitor's reconciliation rule is already correct (`docs/superpowers/specs/2026-04-25-janitor-agent-design.md:38-47`):

> For each illumination with `status: dispatched`:
> 1. Read its frontmatter `plan_path`.
> 2. Read the plan file's frontmatter `status`.
> 3. If plan `status == "implemented"` → call `mark_implemented` on the illumination.

The rule fails on T1400 and T1200 not because the rule is wrong but because the data violates the rule's preconditions:

| Illumination | Failure mode | Janitor sees |
|---|---|---|
| T1400 | `plan_path` resolves to a spec (no `status` field, only `**Status:** Approved` prose) | reads file, finds no frontmatter `status` → cannot reconcile |
| T1200 | `plan_path` resolves to a plan with no frontmatter block | reads file, finds no frontmatter at all → cannot reconcile |

The three orphan 2026-04-12 plans fail a different rule: the janitor walks the illumination → plan direction. With no dispatched illumination pointing at these plans (and no `illumination_source` on the plan side either), there is no path through the graph to discover them.

### Data flow (T1400 specifically)

Anchor: `meditations/illuminations/2026-04-14T1400-gitignore-pattern-doesnt-match-mcp-filename.md:6`.

**Before**
```yaml
plan_path: docs/superpowers/specs/2026-04-14-mcp-gitignore-pattern-fix-design.md
```
Target file's first line: `# MCP Config Gitignore Pattern Fix Design` with header `**Status:** Approved` (prose, not YAML). No `status: implemented` in frontmatter.

**After**
```yaml
plan_path: docs/superpowers/plans/2026-04-14-mcp-gitignore-pattern-fix.md
```
Target file's frontmatter (`docs/superpowers/plans/2026-04-14-mcp-gitignore-pattern-fix.md:1-3`):
```yaml
---
status: implemented
---
```
Janitor matches → calls `mark_implemented` on T1400 on next run.

### Data flow (T1200)

Anchor: `docs/superpowers/plans/2026-04-25-meditate-prompt-is-write-only.md:1`.

**Before** (verbatim first line):
```
# Meditate Prompt Is Write-Only — SOLID Split Implementation Plan
```
No `---` block precedes it. `list_plans` ignores the file.

**After** (prepend three lines):
```
---
status: implemented
---

# Meditate Prompt Is Write-Only — SOLID Split Implementation Plan
```
The plan's three-chunk meditate tool-strip work has shipped (T1200's illumination was `dispatched_at` 2026-04-14 and the meditate tool whitelist was tightened in subsequent commits). Adding `status: implemented` lets the janitor reconcile T1200 on next run.

### Data flow (orphan 2026-04-12 plans)

Anchors:
- `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md:1-3`
- `docs/superpowers/plans/2026-04-12-headless-governance-gates.md:1-3`
- `docs/superpowers/plans/2026-04-12-top-level-directory-map.md:1-3`

All three currently read:
```yaml
---
status: pending
---
```

**After** — add `illumination_source:` per plan, pointing to the open illumination that motivated it:

| Plan | `illumination_source` value |
|---|---|
| `2026-04-12-meditate-backpressure-guard.md` | `meditations/illuminations/2026-04-14T0300-meditate-has-no-backpressure.md` |
| `2026-04-12-headless-governance-gates.md` | *(no matching open illumination — see Open Questions; T0900 grep confirmed unrelated: `2026-04-14T0900-implementation-plan-is-the-missing-node.md` is archived and addresses a different topic)* |
| `2026-04-12-top-level-directory-map.md` | *(superseded by `top-level-directory-inventory.md`, which IS implemented — see Open Questions)* |

The `illumination_source` field is the back-pointer convention used elsewhere in the corpus (`docs/superpowers/specs/2026-04-25-janitor-agent-design.md:73` references `list_plans status=pending` flagging plans whose source illumination has gone missing — adding the field where one exists closes that gap).

## Components

### File edits (exactly 5)

| # | File | Change |
|---|---|---|
| 1 | `meditations/illuminations/2026-04-14T1400-gitignore-pattern-doesnt-match-mcp-filename.md` | Edit line 6: `plan_path: docs/superpowers/specs/2026-04-14-mcp-gitignore-pattern-fix-design.md` → `plan_path: docs/superpowers/plans/2026-04-14-mcp-gitignore-pattern-fix.md` |
| 2 | `docs/superpowers/plans/2026-04-25-meditate-prompt-is-write-only.md` | Prepend frontmatter block (`---`, `status: implemented`, `illumination_source: meditations/illuminations/2026-04-14T1200-meditate-prompt-is-write-only.md`, `---`, blank) before line 1 |
| 3 | `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` | Insert `illumination_source: meditations/illuminations/2026-04-14T0300-meditate-has-no-backpressure.md` between existing `status: pending` and closing `---` |
| 4 | `docs/superpowers/plans/2026-04-12-headless-governance-gates.md` | Insert `illumination_source:` (value resolved at implementation — see Open Questions) |
| 5 | `docs/superpowers/plans/2026-04-12-top-level-directory-map.md` | Insert `illumination_source:` line OR defer to a separate human-driven archival ticket (see Open Questions) |

No source code changes. No new tests (the janitor's reconciliation logic is already covered; this is a data fix, not a behavior change).

### Verification

After the edits, run the janitor pipeline once:

```bash
ralph pipeline run pipelines/janitor.dot --project .
```

Expected outcome on next run:
- `mark_implemented` fires on T1400 and T1200.
- `list_plans status=pending` no longer surfaces T1200's plan.
- The three 2026-04-12 orphan plans either gain `illumination_source` back-pointers (and stay `pending`) or are surfaced for archival via a janitor finding.

No automated test is needed — the janitor's run output (auto-committed via MCP) is the audit trail (`docs/superpowers/specs/2026-04-25-janitor-agent-design.md:131-136`).

## Constraints

- **Frontmatter-only mutations.** No file body content is modified. (Mirrors `docs/superpowers/specs/2026-04-12-mark-implemented-lifecycle-design.md:93-94`.)
- **No new MCP tool, no janitor logic change.** The janitor's existing rule (`status == "implemented"` match) already handles this once the data is correct.
- **Idempotent.** Re-running the edits is a no-op (the new values match the desired state).
- **Stays apples-to-apples with the approved explainer.** The explainer named the T1400 anchor as the canonical case; the design elaborates the same anchor and adds the analogous fixes for T1200 and the three orphans without expanding scope.

## Out of scope (YAGNI)

- **Janitor self-repair.** The janitor could in principle detect "plan_path resolves to a file under `specs/`" and surface a finding, but adding that heuristic now is premature: T1400 is the only known case and the data fix is cheaper than the heuristic.
- **`list_plans` defensive parsing.** Treating frontmatter-less files as `status: pending` would mask T1200-class bugs, not fix them. The convention is "every plan has frontmatter"; T1200's plan was the violation, not the parser.
- **Auto-archive of stale orphan plans.** Time-based archival is a policy call (already out of scope per `docs/superpowers/specs/2026-04-25-janitor-agent-design.md:148-149`); deciding whether `top-level-directory-map.md` ships or gets archived is separate triage.
- **Renaming T1200's plan to a 2026-04-14 prefix to match its illumination date.** The filename is already on disk and referenced by `plan_path`; renaming would require updating the back-pointer too, with no benefit beyond cosmetic alignment.

## Open questions

These are surfaced rather than decided here — implementation should resolve them in-line with the user, not in this spec.

1. **`headless-governance-gates` has no obvious source illumination.** Grep across `meditations/illuminations/` for "governance"/"headless governance" returns only this T1100 illumination and `2026-04-14T0800-plans-have-no-lifecycle.md`. Three options at implementation time:
   - (a) Leave the plan without `illumination_source` and let the janitor flag it as an orphan finding next run.
   - (b) Backfill with a synthetic note (`illumination_source: # manually authored 2026-04-12, no originating illumination`).
   - (c) If a related illumination exists that was missed by the grep, point at it.
2. **`top-level-directory-map.md` is likely superseded by `top-level-directory-inventory.md`** (which carries `status: implemented`). The illumination's suggested action is "mark superseded / archived via the Findings route" — but `mark_archived` requires a destructive file move and the janitor whitelist deliberately excludes it (`docs/superpowers/specs/2026-04-25-janitor-agent-design.md:32-33`). The cleanest resolution may be a human-driven `mark_archived` call after this fix lands, separate from this spec.
3. ~~Should T1200's plan also get an `illumination_source` back-pointer?~~ **Decided: yes.** Implementation should add `illumination_source: meditations/illuminations/2026-04-14T1200-meditate-prompt-is-write-only.md` as part of edit #2's frontmatter prepend. Not strictly required for reconciliation (the forward `plan_path` is enough), but adding it is consistent with the back-pointer convention used in edits 3-5 and future-proofs against the same orphan class.

## Files modified at implementation

| File | Lines touched |
|---|---|
| `meditations/illuminations/2026-04-14T1400-gitignore-pattern-doesnt-match-mcp-filename.md` | 1 (frontmatter `plan_path`) |
| `docs/superpowers/plans/2026-04-25-meditate-prompt-is-write-only.md` | +3 (prepend frontmatter) |
| `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` | +1 (insert `illumination_source`) |
| `docs/superpowers/plans/2026-04-12-headless-governance-gates.md` | +1 (insert `illumination_source`, value pending Open Question 1) |
| `docs/superpowers/plans/2026-04-12-top-level-directory-map.md` | +1 OR `mark_archived` flow (pending Open Question 2) |

Total: ≤7 lines across 5 files. No code, no tests, no docs.
