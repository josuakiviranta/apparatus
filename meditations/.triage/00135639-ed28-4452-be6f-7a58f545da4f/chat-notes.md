# Chat round notes — 2026-04-27T15:30

## What the user raised
- "So what does this formatDiag do? I still don't quite understand what is the problem even though there seems to be some problem." — user did not have a concrete picture of the duplicated code or why two copies matter.
- "Does outputs changes anyway if this is implemented?" — user wanted to know whether the refactor was user-visible (behavioral change) or internal-only.
- "Ok" / "Ok yep" — user confirmed the 5-step scope as proposed in the illumination after the explanation and the no-output-change confirmation.

## Conclusions reached
- The 5 steps from the illumination are approved as-is, no scope changes.
  - Came from: user's "Ok" after the 5-step recap.
  - Rationale: user understood the problem (copy-paste twin formatter, spec violated, third copy incoming with `pipeline lint`/`pipeline test`) and the fact that no user-visible output changes — so the refactor is low-risk and matches their stated DRY/KISS principles.
- The refactor is a pure internal extraction with zero user-facing output change.
  - Came from: "Does outputs changes anyway if this is implemented?"
  - Rationale: user explicitly wanted to confirm this is invisible to end users before approving. Both inner `formatDiag` closures are byte-identical today, so extracting to one helper produces identical strings. The unit test pins the format so future edits cannot silently drift.
- The unit test (step 3) is load-bearing for the no-output-change guarantee.
  - Came from: same exchange about output changes.
  - Rationale: if the helper is ever edited, the test prevents silent format drift between the two callers — this is what makes the extraction safe long-term.
- Step 2 (SVG-staleness check) remains conditional on `pipeline lint` (T2400) shipping; do not invent a new home for it.
  - Came from: implicitly carried from illumination + verifier note that user did not contest.
  - Rationale: user did not push back on the conditional nature when reviewing the 5-step scope. The illumination already acknowledged this dependency.
- Step 5 (no flags on `pipeline show`) remains a hard scope lock.
  - Came from: implicitly carried; user did not push back when scope was recapped.
  - Rationale: prevents retrofitting `--focus`/`--flow`/`--mermaid` from the original T2500 deferral. New flags require a fresh illumination with UX justification.

## Verifier-flagged corrections to carry downstream
- Second `formatDiag` is at `src/cli/commands/pipeline.ts:1068`, not ~601 as the illumination wrote.
- Illumination cited `pipelines/smoke/conditional.svg` as a committed SVG, but that file does not exist (only `pipelines/smoke/conditional.dot`). The actual second committed SVG is `pipelines/janitor.svg`. Spec writer should reference `pipelines/illumination-to-implementation.svg` and `pipelines/janitor.svg` as the two committed SVGs without staleness guard.

## Open questions (if any)
- None. Scope approved.
