# Chat round notes — 2026-04-25T11:00:00Z

## What the user raised
- Guard premise rejected: "I think we should not have hidden 'guard rules' if mail box fills then it fills. In my mind that's quite normal isn't it?"
- Speculative origin confirmed: when asked whether the parent spec was driven by a real incident or speculation, user answered "It was probably speculative so let's kill spec and decline illumination."
- Cleanup scope requested: "Check also are there other features, commands, specs, README.md lines related to this 'guard rule'."

## Conclusions reached

- **Decline this illumination at the approval gate.**
  - Came from: guard premise rejected.
  - Rationale: the illumination's only contribution is fixing how the guard counts files. With no guard, the fix has no target. User stated mailbox fill is normal user-side hygiene, not tool-enforced behavior.

- **Kill the parent spec `docs/superpowers/specs/2026-04-12-meditate-backpressure-guard-design.md`.**
  - Came from: speculative origin confirmed + guard premise rejected.
  - Rationale: user confirmed the spec was speculative ("probably speculative"), not driven by a real incident. With the user explicitly rejecting the premise of an automatic backlog brake on `ralph meditate`, the spec has no remaining justification.

- **Kill the derived plan `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md`.**
  - Came from: kill parent spec decision.
  - Rationale: the plan's only purpose is implementing the killed spec. It has never been implemented (verified: no `countIlluminations` or `--force` in `src/cli/commands/meditate.ts` or `src/cli/program.ts`).

- **Also decline/archive the originating illumination `meditations/illuminations/2026-04-14T0300-meditate-has-no-backpressure.md`.**
  - Came from: guard premise rejected (user's rejection applies to the root illumination, not just T1100).
  - Rationale: T0300 is the source observation that produced the killed spec. Leaving it `status: open` would re-spawn the same spec next triage cycle.

- **Codebase scan results to inform user before final commit:**
  - Came from: cleanup scope requested.
  - Rationale: user wants full picture of touched surface before deciding cleanup actions.
  - Findings:
    - **Direct artifacts to remove:** parent spec, derived plan, T1100 illumination, T0300 illumination.
    - **Cascading illuminations that reference the guard as dependency/example** (need revisit at next triage, no action this round): `T0900-implementation-plan-is-the-missing-node.md`, `T1500-heartbeat-schedules-producer-not-consumer.md`, `T1300-steer-cannot-override-the-workflow.md`, `T1000-mark-implemented-has-no-caller.md`, `T1900-tool-configuration-inverts-agent-roles.md`, `T0800-plans-have-no-lifecycle.md`.
    - **Cosmetic/historical references** (leave alone): `scripts/backfill-plan-frontmatter.sh:23` (entry becomes dead if plan deleted), `src/cli/tests/illumination-server.test.ts:1103-1115` (uses guard plan filename as synthetic fixture, no real coupling), `specs/2026-04-25-plans-have-no-lifecycle-design.md` and `memory/2026-04-25-plans-have-no-lifecycle.md` (use guard plan as historical orphan example).
    - **README.md:** clean — no mentions of the guard.
    - **Not in scope (different feature, do NOT touch):** `docs/superpowers/specs/2026-04-13-undefined-variable-backpressure-guard-design.md` — this is the runtime undefined-variable guard, unrelated to the meditate backlog guard.

## Open questions
- None remaining for this round. See chat round 2 below for the redefined deliverable.

---

# Chat round notes — 2026-04-25T11:30:00Z (round 2)

## What the user raised
- Bundled-cleanup proposal: "let's just add all those to triage notes with this decline and kill decision and then let the pipeline run and fix all the files at one go."
- Refined to analyst-not-executor pattern: "Can't we just write to triage to investigate all these files and how those relate to declined illumination? Then we can investigate the illuminations with illumination-to-implementation.dot but so that it won't make code changes but instead output a file to instruct how illuminations should be updated when this illumination is declined? After getting this file I could execute it as separate implementation plan with implement agent."
- TDD pushback: "Why TDD? It downstream agents can read it as code execution?? These are just test files we are playing." Confirmed format choices: 1A (output lives in `docs/superpowers/plans/`) + 3A (concrete per-file edit proposals, not just flagging).

## Conclusions reached

- **Redefine the pipeline's deliverable for this run.** The pipeline (illumination-to-implementation) shall NOT make any code changes, NOT delete any files, NOT edit any cascading illuminations, NOT touch the parent spec or derived plan. Its sole output is **one markdown file** at the path specified below.
  - Came from: analyst-not-executor proposal.
  - Rationale: user wants a reviewable artifact between research and action so they retain agency over the actual cleanup. Pipeline acts as analyst; user runs `implement` against the artifact in a separate session.

- **Output file path:** `docs/superpowers/plans/2026-04-25-cleanup-declined-backpressure-guard.md`
  - Came from: option 1A confirmed.
  - Rationale: lives with regular plans, drop-in for `ralph implement` in the next session.

- **Output file format:** procedural step-list, NOT TDD red/green.
  - Came from: TDD pushback.
  - Rationale: cleanup is markdown housekeeping (deletes, archives, single-line edits), no behavioral code involved. TDD ceremony is wrong tool — there is nothing to test. Format = numbered steps with exact file paths, exact content snippets to match, exact replacement content, and exit conditions for each step.

- **Output file content scope (option 3A confirmed — concrete per-file proposals):** the file must include all of the following sections:

  1. **Context** — one paragraph: declined illumination = `meditations/illuminations/2026-04-14T1100-guard-counts-files-not-open.md`; reason = parent spec premise rejected as speculative ("if mailbox fills then it fills").

  2. **Section A: Direct deletes** — exact `rm` paths (or `mark_archived` invocations for illuminations):
     - `docs/superpowers/specs/2026-04-12-meditate-backpressure-guard-design.md` → delete
     - `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` → delete
     - `meditations/illuminations/2026-04-14T1100-guard-counts-files-not-open.md` → archive with `archive_reason_short: declined-guard-premise-rejected`
     - `meditations/illuminations/2026-04-14T0300-meditate-has-no-backpressure.md` → archive with same reason

  3. **Section B: Cascading illuminations — per-file edit proposal.** For each of T0900, T1500, T1300, T1000, T1900, the report must:
     - Quote the exact lines that reference the killed guard (with line numbers).
     - Classify each illumination as either (i) **guard-primary** (illumination loses its core thesis without guard → propose archive), or (ii) **guard-incidental** (other content stands → propose surgical edit removing guard sentences).
     - For surgical edits: provide the exact before/after text per quoted block.
     - Skip T0800 (already implemented, references are historical only — explicitly note "do not touch").

  4. **Section C: Cosmetic cleanup** — exact one-line edits:
     - `scripts/backfill-plan-frontmatter.sh` — remove the line `[2026-04-12-meditate-backpressure-guard.md]=pending` (currently line 23, but match by content not line number).
     - `src/cli/tests/illumination-server.test.ts:1103-1115` — replace fixture filename `2026-04-12-meditate-backpressure-guard.md` with neutral `2026-01-01-test-plan.md` (3 occurrences in this block). Verify test still passes after rename.

  5. **Section D: Explicitly out of scope** — list:
     - `docs/superpowers/specs/2026-04-13-undefined-variable-backpressure-guard-design.md` (different feature — runtime undefined-variable guard).
     - `specs/2026-04-25-plans-have-no-lifecycle-design.md` and `memory/2026-04-25-plans-have-no-lifecycle.md` (historical orphan-plan example, leave intact).
     - `meditations/illuminations/2026-04-14T0800-plans-have-no-lifecycle.md` (already shipped, references are historical).
     - README.md (no guard mentions, no edit needed).

  6. **Section E: Verification steps** — after running this plan, the implementer should:
     - Confirm `grep -r "RALPH_MEDITATE_MAX_OPEN" .` returns no matches outside the deleted files.
     - Confirm `grep -r "countOpenIlluminations\|countIlluminations" .` returns no matches outside the deleted files and Section D excluded files.
     - Confirm `npm test` passes after the test fixture rename.

- **Constraints on downstream pipeline agents:**
  - Spec writer: produce a one-page spec describing the cleanup-report deliverable. The spec is itself just a wrapper around "create the file at the path above with the content described in Sections 1–6."
  - Plan writer: produce a plan whose sole step is "write the markdown file at `docs/superpowers/plans/2026-04-25-cleanup-declined-backpressure-guard.md` containing the sections enumerated above."
  - Executor (implement agent): create the markdown file. Do NOT execute any of the cleanup steps inside the file. Do NOT delete any other file. Do NOT archive any illumination. Do NOT edit any code or test file. The file's existence is the deliverable.
  - Came from: analyst-not-executor proposal.
  - Rationale: separation of concerns. Pipeline writes the analysis. User reviews. User runs `ralph implement` against the file as a second session.

## Open questions
- None. User has confirmed format (procedural, no TDD), location (1A: plans dir), and per-file proposal granularity (3A: concrete edits).
