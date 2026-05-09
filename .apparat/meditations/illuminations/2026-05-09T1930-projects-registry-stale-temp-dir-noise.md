---
date: 2026-05-09
description: apparat status surfaces stale vitest temp-dir entries in ~/.apparat/projects.json because the registry has no GC and tests register temp projects that never get unregistered.
---

## Core Idea

`~/.apparat/projects.json` is append-only. Every `apparat pipeline run --project <dir>` invocation upserts an entry, including the vitest scratch dirs under `/var/folders/.../apparat-pipeline-test-*` that the test suite spins up and tears down. After the temp dir is removed, its registry entry persists forever, and `apparat status` faithfully renders it. The very status command that shipped this run to answer "what is apparat doing on my machine?" instead answers it through a haze of dead test paths.

## Why It Matters

The operator-global tier exists to make cross-project state legible (VISION.md: "managing many projects with many agents exceeds working memory"). Noise defeats legibility. The tester's own Phase 3 verification of `apparat status` (`tmux_tester.test_summary`) flagged this as a real but out-of-scope follow-up:

> `apparat status` output includes several leftover `/var/folders/...apparat-pipeline-test-*` entries from prior vitest runs polluting `~/.apparat/projects.json`.

The session memory (`Gotchas and constraints`) restates it: registry accumulates from every `--project` invocation, including vitest temp dirs; `apparat status` does no GC. Two independent surfaces (tester, memory-writer) named the same gap, which is the strongest signal the run produced for follow-up work.

Left unpatched, two things rot:
1. Status output becomes unscannable on any machine that runs the test suite frequently — exactly the developer machines that need it most.
2. Tests that touch `projectsRegistry` will silently inherit prior-run pollution unless they explicitly clean, leading to flaky cross-test contamination as the registry grows.

## Revised Implementation Steps

1. **Decide the GC policy.** The simplest viable rule: an entry is stale if its `path` no longer exists on disk. Walk the registry on read in `apparat status` and `apparat watch`; drop missing-path entries from the in-memory list before render. Optionally (behind `--prune` or on every write) persist the pruned list back to disk.
2. **Add `projectsRegistry.prune()`** in `src/cli/lib/projects-registry.ts` — pure function over `(entries, fsExists)` returning the live subset. Unit-test with both real `fs.existsSync` and an injected predicate so deterministic tests don't depend on filesystem state.
3. **Wire prune into the status read path.** `src/cli/commands/status.ts` and `src/cli/components/WatchApp.tsx` both call `loadRegistry()`; pipe through `prune()` before rendering. Keep the on-disk write opt-in to avoid surprise mutations from a read command.
4. **Add an explicit `apparat status --prune` flag** (and/or `apparat projects forget <path>`) that persists the pruned registry. This gives operators an escape hatch without making every read mutate disk.
5. **Vitest hygiene.** Update `src/cli/tests/projects-registry.test.ts` and any test that spins up `apparat pipeline run --project <tmpdir>` to either:
   - point `APPARAT_HOME` (or whatever resolves `~/.apparat/`) at a per-test temp dir so tests never write to the operator's real registry, **or**
   - register a teardown that removes the test's path entry from the real registry.
   Option (a) is cleaner; option (b) is a stop-gap. Pick one and apply consistently.
6. **One-time backfill is unnecessary.** Once `prune()` runs on read, existing pollution self-clears the next time `apparat status` is invoked (the dead `/var/folders/...` paths no longer exist). Do not write a migration script.
7. **Verify on a polluted machine.** Run `apparat status` on the dev machine that produced this run's tester output (which observed the noise), confirm the dead entries disappear, then run the full test suite and confirm the registry doesn't refill with new vitest paths.

## Provenance

- Source memory: `.apparat/sessions/2026-05-09-two-run-homes-no-cross-project-view.md`
- Pipeline run id: `cf417898`
- Surfaced by: memory-reflector
