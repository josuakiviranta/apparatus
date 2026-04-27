---
date: 2026-04-27
status: implemented
implemented_in: a39d046
description: pipeline show shipped correctly as a zero-flag, validate-first SVG renderer, but left two open seams: formatDiag is a verbatim copy inside pipelineShowCommand (the design spec warned against this), and committed SVGs have no staleness guard — both compound with the next pipeline command that needs diagnostic output.
dispatched_at: 2026-04-27
plan_path: docs/superpowers/plans/2026-04-27-pipeline-show-two-open-seams.md
---

## Core Idea

`pipeline show` shipped exactly as designed — pure DOT passthrough, WASM renderer, validate-gate, zero flags. But the implementation introduced a verbatim copy of `pipelineValidateCommand`'s inner `formatDiag` closure into `pipelineShowCommand` (`src/cli/commands/pipeline.ts`, both functions ~line 199 and ~line 601). The design spec said explicitly: "Reuse the function or a tiny shared helper; do not re-implement the formatter." What shipped was a copy. Additionally, committed SVGs (`pipelines/illumination-to-implementation.svg`, `pipelines/smoke/conditional.svg`) have no enforcement to stay in sync with their `.dot` sources — the spec acknowledged this but deferred it entirely.

## Why It Matters

The `formatDiag` copy is the first symptom of a shared formatting surface that will grow. `pipelineValidateCommand` uses it, `pipelineShowCommand` uses it. The next pipeline command that emits validation diagnostics — a `pipeline lint` (per T2400), a `pipeline test`, a validate-on-create — will face the same fork: copy it again, or extract it. Three copies is a refactor; two is still a 10-line extraction. The window is now.

The SVG staleness problem is subtler but related. The canary SVG in `pipelines/smoke/conditional.svg` was committed as rollout proof-of-life. It looks authoritative. But `conditional.dot` is a smoke fixture that changes. The repo now has a visual artifact that will silently lag every time that file is touched. No CI check, no pre-commit hook, no `pipeline lint` warning exists to catch the drift. This is the "proof of work vs proof of usage" problem: a rendered SVG signals care without guaranteeing freshness.

Both seams cost almost nothing to seal now and compound with every subsequent DOT edit.

## Revised Implementation Steps

1. **Extract `formatDiag` to a shared helper.** Create `src/cli/lib/pipeline-diag-format.ts` exporting `formatPipelineDiag(d: Diagnostic, src: string, relPath: string): string`. Body is identical to both existing inner functions — one pure function, no side effects. Update `pipelineValidateCommand` and `pipelineShowCommand` to import and call it. Delete the two inner closures.

2. **Add an SVG-staleness lint warning to `pipeline lint` (T2400's proposed advisory lane).** For each `.dot` file in the target directory, if a sibling `.svg` exists and its `mtime` is older than the `.dot`'s `mtime`, emit a `[stale_svg]` warning: `pipelines/foo.svg is older than foo.dot — re-run: ralph pipeline show foo`. This is a pure I/O check, no parse required.

3. **Add a test for the shared helper.** One unit test: `formatPipelineDiag` with a diagnostic that has a location produces a `file:line:col [rule] message` string. Keeps the formatter honest as the shape of `Diagnostic` evolves.

4. **Mark `2026-04-20T2500-pipeline-graph-preview-command.md` as implemented** once steps 1–3 land, since the command shipped and the remaining seams will be addressed.

5. **Do not add flags to `pipeline show`.** The original T2500 illumination proposed `--focus`, `--flow`, and `--mermaid`. These were deliberately deferred, not rejected. If they prove necessary, open a fresh illumination — retrofitting flags onto an established zero-flag command requires a UX justification, not just a capability want.
