---
date: 2026-05-11
run_id: parallel-illumination-to-implementation-5f3cf0d9
plan: docs/superpowers/plans/2026-05-11-failure-resume-recipe-drops-project-and-vars.md
design: docs/superpowers/specs/2026-05-11-failure-resume-recipe-drops-project-and-vars-design.md
illumination: .apparat/meditations/illuminations/2026-05-11T2330-failure-resume-recipe-drops-project-and-vars.md
test_result: pass
---

# Failure-resume recipe drops --project and --var

## What was implemented

The printed `resume:` line on pipeline failure now includes `--project <folder>` and `--var k=v` (shell-quoted) from the original invocation, so copy-pasting the recipe actually resumes the run instead of hitting `[project_binding_missing]`.

## Key files

- `src/cli/lib/shell-quote.ts` (new) — extracted pure quoting helper.
- `src/cli/tests/shell-quote.test.ts` (new) — pins quoting rules.
- `src/attractor/handlers/tool.ts` — now imports the shared `shellQuote`.
- `src/cli/lib/failure-handoff.ts` — added `buildResumeCommand`, threaded optional `project` + `variables` through `LoadFailureHandoffArgs`.
- `src/cli/tests/failure-handoff.test.ts` — unit + integration coverage for the wired path.
- `src/cli/commands/pipeline/run.ts` — caller now forwards `opts.project` + `opts.variables` instead of dropping them.
- `src/cli/tests/pipeline-failure-footer-scenario.test.ts` — scenario regression pinning `--project '.'` end-to-end.
- `README.md` — recipe-section cross-link noting the resume line preserves `--project` / `--var`.

## Decisions and patterns

- Shell-quoting helper was extracted from `src/attractor/handlers/tool.ts` rather than duplicated. Single source of truth for bash/zsh/sh quoting across resume recipes and script-file interpreter.
- New fields on `LoadFailureHandoffArgs` are optional and additive — zero external importers, so byte-for-byte backwards compatible with every caller that doesn't pass them.
- `inspect:` line audited and left alone: `apparat pipeline trace` does not bind `$project` or consume `--var`, so its single-flag shape stands. Documented in the `docs(readme)` commit body so future readers don't re-open the question.
- Commits are split by purpose (refactor → helper → wire-through → caller fix → docs) to keep the merge history bisectable.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build OK, 1491 tests passed (3 skipped). Live scenario pipeline-failure-footer printed resume line including `--project '.'` end-to-end; tool scenario green confirming shellQuote refactor introduced no regression. No fixes needed.
