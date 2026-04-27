---
date: 2026-04-27
run_id: d8533e1b-c6ff-4814-90e2-0d52bddd5cb9
plan: docs/superpowers/plans/2026-04-27-pipeline-graph-preview-command.md
design: docs/superpowers/specs/2026-04-27-pipeline-graph-preview-command-design.md
illumination: meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md
test_result: pass
---

# Pipeline Graph Preview Command (`ralph pipeline show`)

## What was implemented

New `ralph pipeline show <file.dot>` subcommand: validates the DOT via the existing `parseDot` + `validateGraph` pair, then renders to `<basename>.svg` next to the source through `@hpcc-js/wasm-graphviz`. Single shape, zero flags, fail-fast on diagnostics (no SVG written).

## Key files

- `package.json`, `package-lock.json` — added `@hpcc-js/wasm-graphviz@1.21.2` (Apache-2.0).
- `src/cli/commands/pipeline.ts` — appended `pipelineShowCommand`, `PipelineShowOptions`, and `renderDotToSvg` helper (dynamic import to keep WASM off the cold path of unrelated subcommands).
- `src/cli/program.ts` — imported `pipelineShowCommand`, registered `pipeline show <dotfile>` next to `validate`/`list`/`trace`, added one-line entry to the Pipeline-engine help block.
- `src/cli/tests/pipeline-show.test.ts` — created. Behavior tests: file-not-found, syntax error, validation failure, happy-path SVG write, silent overwrite. No golden snapshots.
- `pipelines/illumination-to-implementation.svg` — canary SVG committed alongside its source DOT.

## Decisions and patterns

- **Single output format = SVG.** Mermaid, PNG, ASCII all dropped as YAGNI. SVG is sharp at any zoom, text-based, git-diffable, GitHub renders it in PR file diffs.
- **Renderer = `@hpcc-js/wasm-graphviz`.** WASM-bundled graphviz; no `brew install graphviz` step gating contributors. Trust verified: Apache-2.0, LexisNexis Risk Solutions / RELX, v1.21.2.
- **Zero flags.** No `--svg/--png/--mermaid/--focus/--flow/--out/--force/--ascii`. If filters prove painful later, add via fresh illumination.
- **Validate-first, fail-fast.** Reuses existing `formatDiag`-style output from `pipelineValidateCommand`. Exit 1 + `file:line:col` frame + caret. No SVG written on error.
- **No walker / no IR layer.** Pure DOT passthrough — graphviz reads source bytes directly, no parse-mutate-emit machinery.
- **Pure DOT passthrough.** No ralph-injected styling/colors. Source-of-truth: maintainer edits DOT for cosmetics. Existing `shape=hexagon`/`Mdiamond`/`Msquare` already render correctly.
- **Output colocated, silent overwrite, committed to repo.** `<basename>.svg` next to source enables relative-link embedding in markdown specs; commit makes diagram drift visible in PRs.
- **Tests assert wiring, not graphviz output.** No golden byte snapshots — those would test graphviz's renderer (wrong layer) and break on version bumps.

## Gotchas and constraints

- `renderDotToSvg` uses **dynamic import** of `@hpcc-js/wasm-graphviz` so the WASM payload is loaded only when `pipeline show` actually runs. Static import would tax cold start of every other subcommand.
- SVG drift risk: if someone edits the `.dot` and forgets to re-run `pipeline show`, the committed SVG goes stale. No pre-commit hook exists yet — accepted as known cost; add a future illumination if the drift bites.
- Validator hint integration deferred — `pipeline validate` does NOT suggest `pipeline show` on errors. With no `--focus` flag and `show` fail-fasting on validate errors anyway, the hint would be tautological.
- `pipeline trace` integration deferred — no traversed-edge highlighting. Would require a coloring walker; gets its own future illumination.

## Learnings from the run

- Pipeline trace at `~/.ralph/runs/d8533e1b-c6ff-4814-90e2-0d52bddd5cb9/pipeline.jsonl` was **not present at memory-writer time** (the `~/.ralph/runs/` directory itself does not exist on this machine). Execution evidence is therefore reconstructed from `git log` only. If trace persistence is expected to support memory mining, the producer needs verification — possible regression in pipeline JSONL emission, or the directory was cleaned between nodes.
- Implementation landed in 5 commits across one session (ef1d927 → 70a3ee4) with no visible retry chain in git history: deps → scaffold → validate gate → render → help+canary. Plan's chunk boundaries map 1:1 to commits, suggesting the plan was sized correctly.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean. Build green, 1127/1127 tests passed. All 9 non-interactive smokes exit 0 (agent-implement, agent-json-vars, conditional, json-schema-stream, meditate-steer, static-multi-node, store, tool-runtime-vars, tool). gate smoke exit 0. missing-caller-var works both ways (preflight error without var, success with var). New 'pipeline show' command verified across happy path, missing file, and broken DOT — all return correct exit codes (0 success, 1 error) and no SVG is written on validation failure. No fixes required.
