---
date: 2026-04-30
status: open
description: plans-have-no-lifecycle shipped only the CLOSE half — plan-writer still emits no status: pending frontmatter, so every plan generated since April 26 is an orphan invisible to both lifecycle filters and blocking janitor reconciliation permanently.
---

## Findings

### 1. plan-writer produces no opening frontmatter — every new plan is born an orphan

**What:** The `plans-have-no-lifecycle` implementation plan (`status: implemented`, `2026-04-25-plans-have-no-lifecycle.md`) wired `mark_plan_implemented` as the CLOSE call in `memory-writer`. It did not add a corresponding OPEN signal: plan-writer never emits `status: pending` YAML frontmatter. Every plan the pipeline generates starts as an orphan — no `status:` field, invisible to both `list_plans status=pending` and `list_plans status=implemented`.

**Evidence:** Comparing `list_plans` (no filter, ~64 files) against `list_plans status=pending` (6 files) and `list_plans status=implemented` (44 files) reveals 14 plans unaccounted for. All 14 are dated 2026-04-26 or later — i.e. generated after the `plans-have-no-lifecycle` work shipped. Spot-checked two:
- `docs/superpowers/plans/2026-04-26-mark-plan-implemented-will-have-no-caller.md`: grep for `status: implemented` matches only a reference inside a task step (line 335), not frontmatter. Full-list present; pending-list absent; implemented-list absent. Orphan confirmed.
- `docs/superpowers/plans/2026-04-26-runs-and-checkpoints-share-a-flat-namespace.md`: zero matches for `status: implemented`. Orphan confirmed. (File too large to read in full; first visible line is `# Runs and Checkpoints...` — no YAML block.)

The 12 confirmed orphan plan filenames (all missing from both status-filtered lists):
`2026-04-26-mark-plan-implemented-will-have-no-caller.md`, `2026-04-26-meditations-to-stimuli.md`, `2026-04-26-runs-and-checkpoints-share-a-flat-namespace.md`, `2026-04-27-illuminations-status-dirs.md`, `2026-04-27-memory-reflector.md`, `2026-04-27-pipeline-folder-architecture-redesign.md`, `2026-04-27-pipeline-graph-preview-command.md`, `2026-04-27-pipeline-show-two-open-seams.md`, `2026-04-27-scenario-tests-removal.md`, `2026-04-29-agent-output-validation-and-retry.md`, `2026-04-29-deep-loop-nodes.md`, `2026-04-29-pipeline-context-flow-redesign.md`.

**Why it matters:** The janitor's reconciliation loop at step 2 reads `plan_path`, checks for `status: implemented` in frontmatter, and calls `mark_implemented`. Without `status: pending` as the opening signal, no plan can ever transition to `implemented` via `mark_plan_implemented` (which requires existing `pending` frontmatter per `illumination-server.ts:400-413`). The entire observe→illuminate→plan→implement→close cycle is permanently open at the plan-open boundary. The `plans-have-no-lifecycle` fix shipped half a door frame.

**Suggested action:** Add a `status: pending` YAML frontmatter block to plan-writer's output template. The plan-writer agent at `pipelines/illumination-to-implementation/plan-writer.md` should prepend every plan file it creates with:
```yaml
---
status: pending
illumination_source: <basename of the illumination file>
---
```
This is the OPEN half of the lifecycle pair — it mirrors exactly what `mark_plan_implemented` writes on the CLOSE half. One rubric step addition + one schema field. No engine changes required. After landing, backfill the 12 existing orphan plans by hand-prepending frontmatter (or via a one-off script).

---

### 2. Two dispatched illuminations blocked by orphan plans — reconciliation permanently deferred

**What:** `2026-04-26T0900-mark-plan-implemented-will-have-no-caller.md` and `2026-04-26T2000-runs-and-checkpoints-share-a-flat-namespace.md` are both `status: dispatched` with `plan_path` fields pointing to two of the 12 orphan plans above. The janitor cannot call `mark_implemented` on either — the plan files have no `status: implemented` to match against.

**Evidence:**
- `meditations/illuminations/2026-04-26T0900-mark-plan-implemented-will-have-no-caller.md` frontmatter: `plan_path: docs/superpowers/plans/2026-04-26-mark-plan-implemented-will-have-no-caller.md` — orphan confirmed above.
- `meditations/illuminations/2026-04-26T2000-runs-and-checkpoints-share-a-flat-namespace.md` frontmatter: `plan_path: docs/superpowers/plans/2026-04-26-runs-and-checkpoints-share-a-flat-namespace.md` — orphan confirmed above.

**Why it matters:** Per janitor procedure, no mark is made when a plan has no frontmatter. These illuminations will remain dispatched on every future run until the orphan plans are manually backfilled with frontmatter AND the underlying work ships. Dispatched illuminations that the janitor cannot close accumulate silently; the corpus grows while the cycle stays broken. This is the T1100 pattern repeating at the next generation.

**Suggested action:** Once Finding 1's plan-writer fix lands, backfill these two plan files with `status: pending` frontmatter as part of the same PR. After the underlying work ships and `mark_plan_implemented` fires, the next janitor run will close T0900 and T2000 automatically.

---

## Lifecycle changes this run

- (none) — all five dispatched illuminations have plans with no `status: implemented` frontmatter; no `mark_implemented` calls were made.

## Reading thread

- `2026-04-25T1100-janitor-lifecycle-orphan-plans.md` — documented the same orphan-plan pattern for three earlier dispatched illuminations; this finding is its direct successor: the root cause T1100 diagnosed (missing lifecycle infrastructure) was only half-fixed, and the same break is now accumulating at scale.
- `2026-04-26T0900-mark-plan-implemented-will-have-no-caller.md` — diagnosed the CLOSE-side gap (memory-writer had no MCP access). The shipped fix added the close caller but left the open signal unimplemented. This finding names the symmetry.
- `2026-04-14T0800-plans-have-no-lifecycle.md` — original diagnosis; proposed `status: pending` as the opening frontmatter signal. The plan that shipped from this illumination added the close tool but missed the open instruction to plan-writer. The T0800 suggestion was correct; it was only half-acted on.
- `2026-04-26T1400-lifecycle-close-must-be-a-graph-node-not-a-rubric-step.md` — argued for structural enforcement of lifecycle calls; the open/close asymmetry this finding identifies is the same structural gap: open is a rubric step (fragile), not a graph node, and no rubric step was even added.
