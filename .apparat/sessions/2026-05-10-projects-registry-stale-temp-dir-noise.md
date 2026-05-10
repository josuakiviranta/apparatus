---
date: 2026-05-10
run_id: illumination-to-implementation-e781cc30
plan: docs/superpowers/plans/2026-05-10-projects-registry-stale-temp-dir-noise.md
design: docs/superpowers/specs/2026-05-10-projects-registry-stale-temp-dir-noise-design.md
illumination: .apparat/meditations/illuminations/2026-05-09T1930-projects-registry-stale-temp-dir-noise.md
test_result: pass
---

# projects-registry stale temp-dir noise

## What was implemented

Stopped vitest tests from leaking `apparat-pipeline-test-*` and
`apparat-preflight-*` paths into the operator's real `~/.apparat/projects.json`.
Eight test files now isolate `HOME` per-describe; `vitest.config.ts` switched
to `pool: "forks"` so `process.env` mutations don't bleed across files. No
production code touched.

## Key files

- `src/cli/tests/pipeline-run-preflight.test.ts` — 7253482
- `src/cli/tests/pipeline-preflight.test.ts` — 3964137, 2d71404
- `src/cli/tests/pipeline.test.ts` — a870037, 2d71404 (six describe blocks)
- `vitest.config.ts` — 0464c12 (`pool: "forks"`)
- `src/cli/tests/pipeline-headless.test.ts` — a5fedf1
- `src/cli/tests/pipeline-failure-reason.test.ts` — ec5f397
- `src/cli/tests/pipeline-failure-footer-scenario.test.ts` — a63fe25
- `src/cli/tests/runs-gc-per-pipeline.test.ts` — db034cb
- `src/cli/tests/pipeline-run-runid.test.ts` — 6668bde (also tightened existing isolation)
- `docs/superpowers/plans/2026-05-10-projects-registry-stale-temp-dir-noise.md` — created 9bc9998, marks at 832dfce, a870037, 635dfb4

## Decisions and patterns

- **Isolation lives at `describe` scope, not file scope.** Per-describe
  `beforeAll`/`afterAll` swaps `process.env.HOME` to a fresh `mkdtempSync`
  fake home; `afterAll` deletes the env var when `origHome === undefined`
  rather than restoring the literal string `"undefined"` (commit 2d71404).
- **`pool: "forks"` was the missing piece.** Default `threads` pool shares
  `process.env` across worker threads, so even isolated describes leaked
  via concurrent files. Switching to `forks` gives each file its own
  process and its own env. Verified by Chunk 4's empirical check.
- **Scope was reduced in chat round before plan.** Verifier originally
  pulled in a `prune()` helper, `apparat status --prune`, and `apparat
  projects forget <path>`. User pushed back: "can the tests just be
  changed?" — kept the fix at test-hygiene only, dropped all public
  surface. Blast radius collapsed S/M → XS.
- **Six "residual leak" sibling files were carried forward.** Verifier
  flagged them in §6 as possibly-affected; plan documented them as
  scope-defer pending Chunk 4 empirical check. Chunk 4 confirmed all six
  needed the same fix, executed the deferred scope inline.

## Gotchas and constraints

- Restoring `HOME` to undefined: never `process.env.HOME = origHome` when
  `origHome === undefined` — node coerces to the literal string
  `"undefined"` and downstream `getApparatHome()` writes to a directory
  named that. Use `delete process.env.HOME`.
- `recordProject` fires from a single production call site
  (`src/cli/commands/pipeline/run.ts:59`), but it triggers any time a
  test passes `project: <tmp>` to `pipelineRunCommand`. Future tests
  passing `project:` need the same isolation.
- `pool: "forks"` is slower than threads. If perf regresses, revisit
  whether per-test (not per-describe) isolation could let us go back to
  threads.

## Learnings from the run

- Verifier's §6 residual-leak caveat resolved correctly: plan deferred
  the six sibling files to Chunk 4 empirical check rather than
  pre-expanding scope. Chunk 4's grep confirmed all six leaked, so the
  deferred-with-empirical-gate pattern saved no work in this case but
  bounded the risk of over-scoping. Pattern still good.
- Scope reduction during the chat round (drop helper / flag / `forget`
  command) collapsed the design from ~10 files to 8 test files +
  1 config. Confirms the chat-summarizer round is load-bearing for
  illuminations that arrive over-scoped.
- `tmux_tester` finished in a single clean cycle — no fix commits,
  1442/1442 pass, registry leak grep returned 0. The `pool: "forks"`
  change in Chunk 4 is what made the empirical check pass; without it,
  inter-file env bleed would have masked or regressed the fix.

## Final verification

- test_result: pass
- test_summary: Single cycle clean: build OK, full vitest suite 1442/1442 pass across 161 files (24.4s). Live `tool` scenario reached exit cleanly (`✓ success · 0 turns`). Registry leak grep returned 0; no production code in diff so no fixes needed.
