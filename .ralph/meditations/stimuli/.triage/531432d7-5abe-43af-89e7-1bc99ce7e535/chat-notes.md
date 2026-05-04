# Triage Chat Notes

## Illumination
`meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md`

## Decision
**Approved.** Proceed to design doc + implementation plan.

## Scope
All four proposals in scope:

1. **Extract `runTwoPhaseClaudeSession()` into `src/cli/lib/session.ts`**
   - Pure refactor. DRY the two-phase pattern triplicated across `plan.ts`, `pipelineCreateCommand`, `pipelineRefineCommand`.
   - `src/cli/lib/session.ts` already exists (holds `buildSessionDigest()` + types) — add helper there.

2. **Inject recent run traces into refine trigger**
   - Feeds pipeline execution output back into authoring session.
   - Refine agent gets context on *why* user is refining (last failure, node, stderr) instead of only the `.dot`.
   - Source: existing run trace storage.

3. **Graph-diff edge-label check after refine**
   - Validation guardrail. After refine writes new `.dot`, diff old vs new.
   - Warn when edge label changed without explicit user request — downstream routing depends on labels.
   - Fits alongside `pipelineValidateCommand` / `validateGraph()`.

4. **Surface refine as post-failure tip in `pipelineRunCommand`**
   - UX nudge. When `pipeline run` fails, print suggestion: `Tip: ralph pipeline refine <name>`.

## Philosophy Alignment
Aligned with "everything is a pipeline." These targets are **authoring tools** (meta-layer above pipeline execution), not competing execution model. Create / refine / plan scaffold pipelines; these improvements strengthen that authoring loop.

## Audience
- **#1, #3** — internal (developer/maintainer quality).
- **#2** — agent-facing (better context for Claude session inside refine).
- **#4** — user-facing (human nudge after failure).

## Notes for Design Doc
- `src/cli/lib/session.ts` already exists — extend, do not create fresh.
- Preserve existing prompt text: "Preserve node IDs and edge labels that the user does not explicitly want changed — downstream tooling routes on edge labels." (`pipeline.ts:602-603`). The label-diff check enforces what the prompt already asks.
- Run trace injection should be digested (not raw) — reuse `buildSessionDigest()` if applicable.
- Keep proposals independent — can ship as four separate PRs if desired.

## Open Items
None. Ready for design.
