---
date: 2026-05-10
run_id: illumination-to-implementation-780bdf51
plan: docs/superpowers/plans/2026-05-10-apparat-home-override-for-test-isolation.md
design: docs/superpowers/specs/2026-05-10-apparat-home-override-for-test-isolation-design.md
illumination: .apparat/meditations/illuminations/2026-05-10T2006-apparat-home-override-for-test-isolation.md
test_result: pass
---

# APPARAT_HOME override for test isolation

## What was implemented
Added `APPARAT_HOME` env-var as the highest-precedence input to `getApparatHome()`, routed inline `~/.apparat` joiners in daemon + daemon-client through the helper, introduced `withFakeApparatHome()` for tests, migrated 13 test files off the per-describe HOME-swap pattern, and reverted vitest pool from `forks` back to `threads` (~24.5% faster).

## Key files
- `src/daemon/state.ts` — `APPARAT_HOME ?? join(HOME ?? homedir(), ".apparat")`
- `src/daemon/index.ts`, `src/lib/daemon-client.ts` — inline joiners routed through `getApparatHome()`; daemon-client now exposes lazy `getDaemonSocketPath()`
- `src/cli/tests/_apparatHome.ts` (+ `_apparatHome.test.ts`) — `withFakeApparatHome()` helper
- Migrated tests: `pipeline.test.ts` (6 describes), `pipeline-preflight.test.ts`, `pipeline-run-preflight.test.ts`, `pipeline-headless.test.ts`, `pipeline-failure-reason.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `runs-gc-per-pipeline.test.ts`, `pipeline-run-runid.test.ts`, `projects-registry.test.ts`, `status.test.ts`, `runner.test.ts`, `runner-augmentation.test.ts`, `daemon-client-socket-path.test.ts`
- `src/cli/tests/status.test.ts` — `basename(project)` assertion to survive Ink path-wrap on long mkdtemp paths
- `vitest.config.ts` — pool reverted `forks` → `threads`
- `CONTEXT.md` (operator-global tier note), `docs/adr/0010-rename-to-apparatus.md` (env-var table updated to 7 vars)

## Decisions and patterns
- **HOME fallback retained** — non-breaking. APPARAT_HOME wins only when set; HOME path remains contractual (covered by `daemon-client-socket-path.test.ts`).
- **Daemon entry captures `getApparatHome()` once at startup**; daemon-client uses lazy accessor so post-import `APPARAT_HOME` mutations take effect (tests need this).
- **One isolation dialect across the repo** — module-scope HOME swaps in `projects-registry.test.ts`, `runner.test.ts`, `runner-augmentation.test.ts` migrated even though they predate the helper, per design §9.2.
- **Pool flip back to threads** justified empirically: medians 26.42s → 19.93s. With APPARAT_HOME as the env lever, thread-shared `process.env` no longer leaks because each describe writes a unique scratch path.

## Gotchas and constraints
- `mkdirSync(..., { recursive: true })` returns `string | undefined` — collides with vitest's `HookCleanupCallback`. Wrap in block to discard (see `af23e63`).
- Long `mkdtempSync` scratch paths (75+ chars) get wrapped/truncated by Ink when `stdout.columns < width` — assert on `basename(project)` instead of full path in TUI tests.
- `daemon-client` exporting a module-load `const` for the socket path silently bypassed APPARAT_HOME mutation; must be a lazy accessor.

## Learnings from the run
- `implement` node ran 8 iterations (trace ctx: `implement.iterations: 8`). Maps cleanly onto the 22-task plan executed across 18 commits — not a retry storm, but a long single-node session. Consider whether a coarser checkpoint (e.g. per-chunk) would aid resume after pre-emption.
- `tmux_tester` passed cycle 1 with zero fix commits — clean implementation handoff. Good signal that design §10 grep-contract gates (zero `process.env.HOME` in `src/cli/tests/`) caught drift before tmux phase.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, 1453/1453 tests passed (~18s under threads pool), tool scenario reached its done node successfully, and a manual `APPARAT_HOME=/tmp/...` pipeline run wrote projects.json into the scratch dir while operator's ~/.apparat/projects.json showed 0 leaked test-scratch entries. No fixes needed.
