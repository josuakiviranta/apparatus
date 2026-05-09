---
date: 2026-05-09
run_id: c67aeeed
plan: docs/superpowers/plans/2026-05-09-prompt-assembly-invisible-until-runtime.md
design: docs/superpowers/specs/2026-05-09-prompt-assembly-invisible-until-runtime-design.md
illumination: .apparat/meditations/illuminations/2026-05-07T2008-prompt-assembly-invisible-until-runtime.md
test_result: pass
---

# Prompt Assembly Invisible Until Runtime

## What was implemented

Added `apparat pipeline explain <pipeline> [nodeId]` for design-time prompt visibility (topology view + node-zoom prompt skeleton with placeholders), surfaced rendered `prompt.md` path in `pipeline trace --node-receive`, split `assembleAgentPrompt()` into pure `buildAgentPrompt()` core plus thin wrapper, and documented the `<renderedTag>value</renderedTag>` rule in `src/cli/skills/apparatus/pipelines.md`.

## Key files

- `src/attractor/handlers/agent-prep.ts` — split into pure `buildAgentPrompt` + wrapper retaining `writeFileSync`
- `src/attractor/tests/agent-prep.test.ts` — pure-builder seam coverage
- `src/cli/commands/pipeline/explain.ts` — new (topology + node-zoom)
- `src/cli/commands/pipeline.ts` — register `explain` subcommand
- `src/cli/commands/pipeline/trace.ts` — emit `prompt: <runDir>/<nodeId>/prompt.md` line
- `src/cli/program.ts` — wire `explain` into pipeline command tree
- `src/cli/tests/pipeline-explain.test.ts` — new
- `src/cli/tests/pipeline-trace-command-validation.test.ts` — trace prompt-path assertion
- `src/cli/skills/apparatus/SKILL.md`, `src/cli/skills/apparatus/pipelines.md` — `<renderedTag>` docs + `pipeline explain` reference
- `README.md` — `pipeline explain` listed under subcommands
- `docs/superpowers/plans/2026-05-09-prompt-assembly-invisible-until-runtime.md` — plan + chunk markers

## Decisions and patterns

- Kept `assembleAgentPrompt()` exported signature stable behind the new pure inner — no caller updates needed in `looping-agent-handler.ts` / `interactive-agent-handler.ts`.
- Node-zoom renders **placeholders** (e.g. `<illumination_path>./meditations/illumination</illumination_path>`) drawn from the node's declared `inputs:` frontmatter — independent of any project state, no `--var` flag needed.
- Collapsed two proposed commands (`preview` + `explain`) into a single `explain` with optional `nodeId` arg per chat_summarizer round 1 refinement.
- Dropped `<pipeline-dir>/.last-rendered/<nodeId>.md` mirror — node-zoom `explain` covers the design-time use case; can revisit if run-dir prune ever bites.

## Gotchas and constraints

- Placeholder-rendering path **must not** depend on caller-supplied `ctx.values`; placeholders come from frontmatter, not consumer-graph derivation.
- The trace `prompt: <runDir>/<nodeId>/prompt.md` line is purely additive — keeps the existing `received:` / `context snapshot` / `validation attempts` / `completed stages` order intact.
- `pipeline explain` is design-time only — no AI call, no side effects, no engine state writes.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build + 1345 tests passed (143 files), 4 of 14 scenarios INCLUDED (store, tool, tool-runtime-vars, missing-caller-var) all PASS, 10 SKIPPED as they spawn real Claude sessions. Diff is byte-identical agent-prep refactor + new explain command + 1-line trace add — no runtime behavior change to verify via scenario runs.
