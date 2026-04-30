---
date: 2026-04-30
status: open
description: src/cli/agents/verifier.md is a stale bundled copy that diverged from the active per-folder verifier after Chunk 4 — its inputs: use pre-v0.2.0 bare keys, and the CI migration test validates only this dead copy, creating false confidence about the active agent's output contract.
---

## Findings

### 1. Bundled `src/cli/agents/verifier.md` has diverged from the active per-folder agent

**What:** `src/cli/agents/verifier.md` is the sole surviving bundled agent after Chunk 4's deletion pass, but it now disagrees with the active per-folder file in `pipelines/illumination-to-implementation/verifier.md` on `inputs:` declarations — the former uses pre-v0.2.0 bare keys, the latter uses v0.2.0 qualified keys.

**Evidence:**

- `src/cli/agents/verifier.md:18-22` (bundled):
  ```yaml
  inputs:
    - illuminations_dir
    - illumination_path
    - refinements
    - run_id
  ```
- `pipelines/illumination-to-implementation/verifier.md:20-24` (active, v0.2.0):
  ```yaml
  inputs:
    - illuminations_dir
    - verifier.illumination_path
    - chat_summarizer.refinements
    - run_id
  ```
  The active file also carries the MCP-discovery hard rules absent from the bundled copy.

- `src/attractor/handlers/agent-handler.ts:61`: `allowBundledFallback: false` — pipeline execution never uses the bundled copy.

- `src/cli/tests/agent-outputs-frontmatter.test.ts` (last describe block, "verifier migration"): reads `join(__dirname, "..", "agents", "verifier.md")` — the bundled stale copy — and validates its `outputs:` schema. The active per-folder file is never read by CI.

**Why it matters:** The "verifier migration" test exists precisely to catch output-contract regressions introduced to the verifier's JSON schema. But it reads the wrong file. A change to `pipelines/illumination-to-implementation/verifier.md` outputs will not fail CI; only the stale, never-executed bundled copy is guarded. This is the same false-confidence pattern `2026-04-20T2700-schema-description-overrides-agent-rubric.md` documented at the schema/rubric level — an authoring decision in one location is silently overridden by another.

**Suggested action:** Redirect the migration test's `bundledPath` from `src/cli/agents/verifier.md` to `pipelines/illumination-to-implementation/verifier.md`. Then decide whether `src/cli/agents/verifier.md` serves any production purpose: if it is only a test fixture, document that in a comment at the top of the file; if it serves no purpose at all, delete it and update `agent-registry-bundled.test.ts` and `agent-registry-inputs.test.ts` fixtures accordingly.

## Lifecycle changes this run

- (none) — five dispatched illuminations checked; T0600 and T1000 and T1100 plans are `status: pending` (not yet implemented); T0900 and T2000 plans are orphans (no frontmatter, confirmed by 0421); zero `mark_implemented` calls made.

## Reading thread

- `2026-04-30T0421-janitor-plan-writer-open-gap.md` — established the orphan-plan class and confirmed T0900/T2000 plan_paths point to files with no frontmatter; explains why those two dispatched illuminations cannot be reconciled.
- `2026-04-30T0514-janitor-stale-pending-class.md` — named the stale-pending plan taxonomy and confirmed T1000's plan is v0.2.0-incompatible; provides the lifecycle context used when confirming no mark_implemented calls are possible this run.
- `2026-04-20T2700-schema-description-overrides-agent-rubric.md` — same structural pattern: a file the engine reads silently overrides the file the author edits; finding 1 is its test-infrastructure analogue.
