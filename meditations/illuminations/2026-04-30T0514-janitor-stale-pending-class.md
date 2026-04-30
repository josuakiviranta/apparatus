---
date: 2026-04-30
status: open
description: Stale-pending plans (correct frontmatter, engine-incompatible steps) are invisible to all lifecycle filters — no signal distinguishes them from ready-to-implement plans, and specs/pipeline.md has near-zero documentation of the v0.2.0 inputs: convention that makes pre-v0.2.0 plans silently wrong.
---

## Findings

### 1. Stale-pending plans are indistinguishable from ready-pending plans — no lifecycle signal exists

**What:** `status: pending` is the only pre-implementation plan state. A plan whose steps are incompatible with the current engine version looks identical to a healthy pending plan to every tool filter, every pipeline, and the janitor reconciliation loop. `2026-04-18-implement-retry-tmux-context.md` (the dispatched plan for T1000) carries correct `status: pending` frontmatter and is returned by `list_plans status=pending` alongside five other plans — no staleness signal distinguishes it.

**Evidence:** T0305 finding 1 (verbatim): "T1000 plan Step 1 prescribes adding `default_test_result=""` / `default_summary=""` as DOT node attributes plus expanding `$test_result` / `$summary` into the `implement` node's `prompt=` string. Post-v0.2.0, `implement.md` declares `inputs: [plan_writer.plan_path]` — only one structured input; `test_result` and `test_summary` are absent from the Inputs declaration. Implementing the plan as-written makes these values available in the 'Key context values' preamble (legacy global dump) but not in the structured XML Inputs block the agent now reads." Additionally, T0305 notes a dependency hazard: if T0129 (STRING_ATTRS cleanup) ships before T1000, Step 2 of the current plan silently becomes a literal string, not a substitution — no validator or test would catch it.

**Why it matters:** The janitor's plan-path failure taxonomy now has three named classes: (A) missing plan, (B) orphan plan (no frontmatter), (C) plan already implemented. Stale plans — correct frontmatter, engine-incompatible steps — pass all three checks. No workflow prompts authors to audit pending plans after engine upgrades. As the v0.2.0 context-flow redesign ages, every pre-v0.2.0 plan referencing DOT `prompt=` expansions or legacy Key-context-values preamble is a silent failure waiting to ship. T1000 is the first confirmed instance; pre-v0.2.0 plans `2026-04-12-headless-governance-gates.md` and `2026-04-12-meditate-backpressure-guard.md` (both `status: pending`, authored 17 days before the engine redesign) have not been audited.

**Suggested action:** Two-part fix: (1) Add a per-plan `engine_compat:` field or a `needs_review: true` sentinel that `list_plans` can filter on — or, simpler, document a convention that any plan predating a named engine version tag must be manually reviewed before implementation. (2) Concretely: amend `2026-04-18-implement-retry-tmux-context.md` with T0305's two prepend steps (new Step 0a: add `inputs:` entries; new Step 0b: add rubric body paragraph) before any implementing agent runs it. Do NOT implement the plan as-written.

---

### 2. `inputs:` frontmatter convention is undocumented in `specs/pipeline.md`

**What:** `grep -c "inputs:" specs/pipeline.md` returns 1 — almost certainly a code-example occurrence, not a documented API. The v0.2.0 redesign added agent-frontmatter `inputs:` as the primary structured context channel. All seven bundled pipeline agents (`implement.md`, `janitor.md`, `verifier.md`, etc.) now carry `inputs:` frontmatter. The authoritative pipeline authoring spec has one mention.

**Evidence:** `specs/pipeline.md` — 1 match for `inputs:`. `src/attractor/transforms/inputs-resolver.ts` implements the bare-key vs qualified-key rendering rules; `tool.ts:66-79` defines `produces_from_stdout` flat-key semantics. Neither file is referenced in `specs/pipeline.md`. T0149's finding 2 notes a misleading inline comment in `tool.ts:67` that says `produces_from_stdout` "matches agent-handler" — the opposite of the truth — compounding the spec gap.

**Why it matters:** Pipeline authors reading `specs/pipeline.md` find no guidance on `inputs:` declarations, bare vs qualified keys, `default_<var>` fallbacks, or how `produces_from_stdout` interacts with the inputs channel. This single gap generates the entire class of mismatch T0149, T0129, and T0305 document: authors copy existing patterns without understanding rendering rules, body text silently references the wrong tag form, and pre-v0.2.0 plans prescribe the wrong context channel. The spec gap is upstream of all three.

**Suggested action:** Add an "`inputs:` frontmatter" section to `specs/pipeline.md` covering: bare key vs `nodeId.key` qualified syntax, how `produces_from_stdout` stores flat keys, `default_<var>` fallback semantics, and rendered XML tag form. Cross-reference `src/attractor/transforms/inputs-resolver.ts`. Fix `tool.ts:67` comment to read "flat, no node-ID prefix — **unlike** agent-handler which qualifies keys as `nodeId.key`."

---

## Lifecycle changes this run

- (none) — five dispatched illuminations checked; T0600/T1000/T1100 plans are `status: pending` (not yet implemented); T0900/T2000 plans are orphans (no frontmatter, per T0421); zero `mark_implemented` calls made.

## Reading thread

- `2026-04-30T0305-janitor-t1000-plan-stale-v02.md` — identified T1000's plan as v0.2.0-incompatible; this finding generalizes from one instance to a class (stale-pending) and names the lifecycle signal gap.
- `2026-04-30T0421-janitor-plan-writer-open-gap.md` — documented the orphan-plan class (12 plans with no frontmatter); this finding adds a complementary failure mode — correct frontmatter, stale steps — completing the plan-health taxonomy to four classes.
- `2026-04-30T0149-janitor-vision-tag-mismatch.md` — established that body text referencing the wrong tag form is the direct consequence of undocumented inputs: rendering rules; finding 2 above names the upstream spec gap that generates this class of error.
- `2026-04-25T1100-janitor-lifecycle-orphan-plans.md` — started the plan-staleness taxonomy with Classes A and B; this run adds Class D (stale-pending) and names the spec gap that will produce future instances.
