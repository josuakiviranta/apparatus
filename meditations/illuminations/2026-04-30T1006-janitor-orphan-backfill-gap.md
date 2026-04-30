---
date: 2026-04-30
status: open
description: The plan-writer and memory-writer lifecycle fixes are in the working tree, but 12 pre-fix orphan plans and T0900's dispatched illumination are permanently trapped because mark_plan_implemented requires status: pending as a precondition the orphan plans lack.
---

## Findings

### 1. Lifecycle fixes landed in the working tree — but 12 orphan plans predate the fix and T0900 is permanently trapped

**What:** Both lifecycle gaps documented earlier today have been addressed in the uncommitted working-tree pipeline agents — but the 12 plans generated *before* the fix landed are stuck in a permanently-irreconcilable state. `mark_plan_implemented` requires `status: pending` as a precondition; orphan plans have no frontmatter at all, so neither the janitor nor memory-writer can ever close them via the MCP tool.

**Evidence:**

- `pipelines/illumination-to-implementation/plan-writer.md:47` (M, uncommitted): step 4 now explicitly requires `status: pending` + `illumination_source:` frontmatter — the T0421 gap is closed on disk, not committed.
- `pipelines/illumination-to-implementation/memory-writer.md:12–13` (M, uncommitted): both `mcp__illumination__mark_plan_implemented` and `mcp__illumination__mark_implemented` whitelisted; step 7a+7b close both lifecycle halves — the T0900/T1800 gap is closed on disk, not committed.
- `2026-04-26T0900-mark-plan-implemented-will-have-no-caller.md` (dispatched): `plan_path: docs/superpowers/plans/2026-04-26-mark-plan-implemented-will-have-no-caller.md` — confirmed orphan (absent from `list_plans status=pending`; first line of plan is `# Mark Plan Implemented…` with no preceding `---` block).
- `src/cli/mcp/illumination-server.ts:400–413` (authoritative): `markPlanImplemented` reads frontmatter and returns `success: false` if the `status` field is absent or not `pending`. No frontmatter → no transition possible via the tool.
- T0421 corpus: 12 orphan plans dated 2026-04-26–04-29 confirmed missing from both `list_plans status=pending` and `list_plans status=implemented`.

**Why it matters:** T0900 is a dispatched illumination whose prescribed fix (adding `mark_plan_implemented` + `mark_implemented` to memory-writer) has now shipped in the working tree. The work is done. But T0900 cannot be closed: the janitor's step-2 trigger requires `plan.status === "implemented"`; the upstream `mark_plan_implemented` requires `plan.status === "pending"` first. The orphan plan has *neither* status field — it is invisible to both filters and both tools. T0900 will stay dispatched indefinitely unless the plan is manually backfilled with `status: pending`, then explicitly marked implemented.

The same trap applies to all 12 orphan plans from T0421. Ten of them may or may not have shipped features; without frontmatter they are invisible to every lifecycle query. Two (`mark-plan-implemented-will-have-no-caller.md` and `runs-and-checkpoints-share-a-flat-namespace.md`) are the plan_path targets for dispatched illuminations T0900 and T2000.

**Suggested action:** One-off backfill: for each of the 12 orphan plans, prepend `---\nstatus: pending\nillumination_source: <slug>\n---\n` as a standalone commit. For plans whose feature has verifiably shipped (e.g. `2026-04-26-mark-plan-implemented-will-have-no-caller.md` — memory-writer now has both tools wired), call `mark_plan_implemented` immediately after the frontmatter PR merges. After the two blocking orphans (`T0900`, `T2000` plan targets) are backfilled and marked implemented, the next janitor run will close both dispatched illuminations automatically.

---

## Lifecycle changes this run

- (none) — all 5 dispatched illuminations checked; T0600/T1000/T1100 plans are `status: pending` (not implemented); T0900/T2000 plans are no-frontmatter orphans. Zero `mark_implemented` calls made.

## Reading thread

- `2026-04-30T0421-janitor-plan-writer-open-gap.md` — documented the 12 orphan plans and confirmed T0900/T2000 plan_paths are orphans; this finding is its direct successor, noting the root-cause gap is now fixed in the working tree but the orphans predate the fix and require a manual one-off backfill.
- `2026-04-26T0900-mark-plan-implemented-will-have-no-caller.md` (dispatched illumination) — the concrete permanently-trapped illumination; its plan's orphan status makes it the clearest example of the backfill gap, and the fact that its prescribed fix has now shipped makes the urgency of backfilling explicit.
- `2026-04-30T0824-janitor-mark-plan-no-trigger.md` — confirmed the janitor whitelist has no trigger step for `mark_plan_implemented`; this finding shows the trigger gap persists even after the pipeline agents are fixed, because orphan plans are invisible to all lifecycle filters and the janitor cannot infer their status from source alone.
