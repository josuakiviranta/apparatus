---
date: 2026-05-10
description: Make recordProject's registry path overridable via APPARAT_HOME so tests pin the registry without per-describe HOME swaps, closing the recurring leak footgun at its source.
---

## Core Idea

Add a first-class `APPARAT_HOME` env-var override (or equivalent constructor arg) that `getApparatHome()` honours ahead of `process.env.HOME`. Tests, fixtures, and any embedding caller can then pin the registry to a scratch dir without swapping the operator's `HOME`. Today the only knob is `process.env.HOME`, which is a blunt, side-effect-laden lever every new test author has to remember to pull.

## Why It Matters

This run's fix landed across 8 test files plus a `pool: "forks"` change to `vitest.config.ts` — all to close one source leak: `recordProject(project)` at `src/cli/commands/pipeline/run.ts:59` resolves through `getApparatHome()` (`src/daemon/state.ts:31-34` — `process.env.HOME || homedir()`) and writes to the operator's real `~/.apparat/projects.json`. The memory file's Gotchas section captures the recurring footgun explicitly: *"Future tests passing `project:` need the same isolation."* That is a pure tax on every new test author.

The HOME-swap pattern itself is fragile:
- `process.env.HOME = origHome` coerces `undefined` to the literal string `"undefined"` and silently writes registry entries to a directory named `undefined/.apparat/`. Commit `2d71404` had to special-case `delete process.env.HOME` for the `origHome === undefined` path. Every future caller has to know this.
- The default vitest `threads` pool shares `process.env` across worker threads, so per-describe HOME swaps still bled cross-file until `vitest.config.ts` flipped to `pool: "forks"` — a perf regression accepted to make the env-isolation pattern actually hold. A registry-level override would not need this trade.
- 8 files now carry duplicated isolation boilerplate. New tests that forget it reintroduce the leak with no failing assertion — operator only sees it when their `~/.apparat/projects.json` blows past 200 entries (this run cleaned 213 stale entries).

A dedicated `APPARAT_HOME` (mirrors the `XDG_*` / `npm_config_*` convention) makes pinning the registry an explicit, lexically-scoped operation: zero blast on `HOME`, zero process-level mutation, zero coupling to vitest pool config.

## Revised Implementation Steps

1. **Extend `getApparatHome()` to honour `APPARAT_HOME` first.** In `src/daemon/state.ts:31-34`, change the resolution order to `process.env.APPARAT_HOME ?? join(process.env.HOME ?? homedir(), ".apparat")`. Keep `HOME` fallback for backward compat. Add a unit test asserting precedence.

2. **Audit all `getApparatHome()` callers and confirm they go through this helper.** Grep `getApparatHome\\(` plus any direct `~/.apparat` joins. Any code paths that bypass the helper (constructing the path manually) need to route through it so the override is universal.

3. **Migrate the 8 isolated test files to `APPARAT_HOME`.** Replace per-describe `process.env.HOME` swaps with `process.env.APPARAT_HOME = <fakeApparatDir>` (still per-describe, still cleaned up in `afterAll`). Files: `pipeline.test.ts`, `pipeline-preflight.test.ts`, `pipeline-run-preflight.test.ts`, `pipeline-headless.test.ts`, `pipeline-failure-reason.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `runs-gc-per-pipeline.test.ts`, `pipeline-run-runid.test.ts`. The `delete process.env.X when origX === undefined` quirk still applies but now lives on a variable that nothing else touches.

4. **Reconsider `pool: "forks"`.** Once HOME is no longer the lever, the threads pool no longer leaks registry state. Benchmark `pool: "threads"` vs `forks` after the migration; if test runtime improves, revert `vitest.config.ts` (commit `0464c12`).

5. **Add a single test helper to enforce the pattern.** `src/cli/tests/_apparatHome.ts` exporting `withFakeApparatHome(): { home: string; cleanup: () => void }`. New tests that need registry isolation call this once instead of hand-rolling `mkdtempSync` + env swap + cleanup. Footgun → one-liner.

6. **Document the override in `CONTEXT.md` and / or `docs/adr/`.** A short note: "tests and embedding callers pin `~/.apparat` via `APPARAT_HOME`; `HOME` should never be touched for this purpose." This caps the documentation ripple the chat-round cleanup deferred.

## Provenance

- Source memory: `.apparat/sessions/2026-05-10-projects-registry-stale-temp-dir-noise.md`
- Pipeline run id: `illumination-to-implementation-e781cc30`
- Surfaced by: memory-reflector
