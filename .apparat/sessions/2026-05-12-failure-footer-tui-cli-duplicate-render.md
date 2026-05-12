---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-8a7fcaf4
plan: docs/superpowers/plans/2026-05-12-failure-footer-tui-cli-duplicate-render.md
design: docs/superpowers/specs/2026-05-12-failure-footer-tui-cli-duplicate-render-design.md
illumination: .apparat/meditations/illuminations/2026-05-12T1548-failure-footer-tui-cli-duplicate-render.md
test_result: pass
---

# failure-footer-tui-cli-duplicate-render

## What was implemented

Collapsed the duplicate failure-footer rendering between CLI stderr and TUI by extracting a new `renderFailureFooterLines(h: FailureHandoff): string[]` in `src/cli/lib/failure-handoff.ts` as the single owner of the on-screen shape. `renderFailureFooter` becomes a thin `lines.join("\n") + "\n"` wrapper (public contract preserved); `PipelineRunView.tsx` `failure-handoff` JSX branch now maps the helper output to `<Text>` elements. A new TUI parity snapshot test pins byte-equivalence between TUI render and `renderFailureFooter(handoff)`.

## Key files

- M `src/cli/lib/failure-handoff.ts` — added `renderFailureFooterLines` export; `renderFailureFooter` now thin wrapper.
- M `src/cli/components/PipelineRunView.tsx` — `failure-handoff` branch maps shared helper lines to `<Text>` (no `marginBottom` on outer Box; blanks expressed in lines array).
- M `src/cli/tests/failure-handoff.test.ts` — extended to cover new helper.
- A `src/cli/tests/pipeline-run-view-failure-handoff.test.tsx` — new TUI parity snapshot pinning byte-parity with `renderFailureFooter(handoff)`.

## Decisions and patterns

- Option (a) chosen over (b): `renderFailureFooterLines` owns the **complete** on-screen shape including blank lines; TUI is a dumb mapper. Rationale: `deep-modules-hide-complexity` stimulus — locality of every shape decision in one module, single seam forced to agree via byte-parity snapshot.
- Outer `<Box>` keeps `flexDirection="column"` with **no** `marginBottom`; any trailing visual space must be expressed as a trailing `""` in the lines array, not JSX-side margin. Ink empty-`<Text>` collapses, so empty string rendered as single space.
- Public contract of `renderFailureFooter` (string ending in `\n`) preserved — pinned by `failure-handoff.test.ts:80` `endsWith("\n")`.
- Out of scope (explicitly): `src/cli/commands/pipeline/run.ts:418` stderr path, schema/ADR/spec edits.

## Gotchas and constraints

- Pre-existing micro-drift between CLI string and TUI block (TUI's `<Text> </Text>` blank-line workaround + `marginBottom={1}`) was collapsed by this refactor — anyone reverting must re-resolve the byte-parity snapshot.
- Adding a footer line means editing **only** `renderFailureFooterLines`; the TUI map and `renderFailureFooter` wrapper require no change. The parity snapshot will catch any seam violation on next run.
- Existing pins at `failure-handoff.test.ts:39/71/80`, `pipeline-failure-reason.test.ts:69`, `pipeline-failure-footer-scenario.test.ts:58` stayed green throughout — they are the load-bearing guarantees of the wrapper's external contract.

## Final verification

- test_result: pass
- test_summary: One cycle. Phase 1 build+test green (176 files, 1560 tests passed). Phase 2 ran 2 INCLUDED scenarios (tool, pipeline-failure-footer) — both PASS; failure footer rendered with correct shape (✗ failed → trace → inspect → blank → resume), no agent clause for the tool node as expected. No fixes needed.
