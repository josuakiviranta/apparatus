---
date: 2026-04-19
status: implemented
description: Approved design spec specs/2026-04-19-mark-archived-reason-split-design.md prescribes a two-node mark_archived split (decline vs invalid) + an explain_removal sidecar writer, but the current illumination-to-implementation.dot collapsed explain_removal into the verifier's $explanation and uses one mark_archived node with $choice as the reason — spec and pipeline now disagree.
dispatched_at: 2026-04-20
plan_path: docs/superpowers/plans/2026-04-20-mark-archived-spec-drift.md
implemented_at: 2026-04-25
---

## Core Idea

The `mark-archived-reason-split` spec (2026-04-19) was written against a pipeline shape that had `explain_removal` as a free-standing agent node. During this refactor pass `explain_removal` was collapsed (its output was redundant with verifier's structured `$explanation`, and the `remove_gate` label already interpolated `$explanation` directly). The spec's invalid-path design relied on `explain_removal` writing `$meditations_dir/.triage/$run_id/invalid-reason.txt` as a sidecar for multi-word verifier rationale, and on having two nodes `mark_archived_invalid` and `mark_archived_decline` to distinguish dispositions.

Current state (one mark_archived node, reason = `$choice`, which is `"Archive"` or `"Decline"`):
- Pro: one node, one concept, both dispositions captured as shell-safe single tokens, no validator warning beyond the known gate-choice-producer gap.
- Con: loses the verifier's rich rationale as the archive reason. Frontmatter gets `reason: Archive` instead of `reason: fn X is already implemented at src/bar.ts:42`.

The spec and pipeline now disagree. One of three resolutions:

1. **Update pipeline to match spec.** Restore a thin tool node that writes `invalid-reason.txt` from `$explanation` (verifier write is out — agent is read-only). Split `mark_archived` into `_invalid` and `_decline`. More nodes, richer reason frontmatter.
2. **Update spec to match pipeline.** Rewrite the design doc to reflect the single-node form. Accept that `reason:` frontmatter is a disposition label, not a prose rationale — readers of archived illuminations consult git log + the illumination body for the full why.
3. **Add a structured `archive_reason_short: string` field to verifier schema.** Verifier emits a shell-safe one-liner alongside the multi-line `explanation`. `mark_archived` passes `$archive_reason_short` instead of `$choice`. Single node, shell-safe, more informative than `Archive`.

## Why It Matters

The archive frontmatter `reason:` is the only audit trail future pipeline runs, `list_illuminations`, and meditate sessions use to understand why something was closed. If every archived illumination's reason is literally the word `Archive` or `Decline`, that audit trail collapses to a two-state flag — useless for triaging recurring topics or spotting patterns like "verifier keeps killing 'add telemetry' illuminations for project-fit".

The spec already identified this risk (see "Primary: wrong-reason bug in prescribed script conversion"). The current pipeline re-introduces a weaker form of the same risk.

## Revised Implementation Steps

Choose resolution path first. Recommended path (3): minimal pipeline change, preserves spec intent.

1. **Extend `pipelines/schemas/verifier.json`.** Add `archive_reason_short: string` — required when `preferred_label=false`, optional otherwise. Description: "Shell-safe one-line reason suitable for archived frontmatter. Must be a single sentence, no newlines, no shell metacharacters. Used verbatim as the `reason:` value if the illumination is archived."

2. **Update `src/cli/agents/verifier.md`.** Add a rule to the rubric: "When emitting `preferred_label=false`, also emit `archive_reason_short` — one sentence, ≤100 chars, no newlines. Example: `Feature already implemented at src/bar.ts:42` not `This illumination is stale because...`. The archive audit trail reads this field verbatim."

3. **Update `pipelines/illumination-to-implementation.dot`.** Change `mark_archived` script_args from `$illumination_path $choice` to `$illumination_path $archive_reason_short`. Validator may still warn (producer-tracking), but runtime resolves correctly. Add a `default_archive_reason_short="Declined at approval gate"` on the node for the decline path (see separate illumination on default-var whitelist — this needs that fix first, OR a thin intermediate node that sets the default for the decline branch).

4. **Update the approved design spec.** Either mark it superseded, or revise in place to reflect the single-node + archive_reason_short shape. Include a note explaining why `explain_removal` was collapsed (redundant with verifier's structured `$explanation`).

5. **Regression test.** Run both paths end-to-end against a test illumination; assert frontmatter `reason:` contains the verifier's short rationale (invalid path) or the default decline string (decline path). Not the literal word `Archive`.
