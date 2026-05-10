# Design: `APPARAT_HOME` override for test isolation

**Date:** 2026-05-10
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-10T2006-apparat-home-override-for-test-isolation.md`

## 1. Motivation

Today the only knob that redirects `~/.apparat/` away from the operator's real home is `process.env.HOME` — `getApparatHome()` reads it at call time:

```ts
// src/daemon/state.ts:31-34
export function getApparatHome(): string {
  const home = process.env.HOME || homedir();
  return join(home, ".apparat");
}
```

Every test that touches a CLI command which can reach `recordProject(project)` at `src/cli/commands/pipeline/run.ts:59` has to swap the operator's whole `HOME` for the duration of the test or the temp-dir entry leaks into the operator's real `~/.apparat/projects.json`. The 2026-05-09 cleanup pass found **213 stale entries** before the leak was caught.

The HOME-swap pattern is fragile in three concrete ways. First, `process.env.HOME = undefined` coerces to the literal string `"undefined"` and silently writes the registry into a directory called `undefined/.apparat/`; the workaround at `src/cli/tests/pipeline.test.ts:80-82` —

```ts
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  …
});
```

— is a quirk every new test author has to discover. Second, the default vitest `threads` pool shares `process.env` across worker threads; the 2026-05-09 fix had to flip `vitest.config.ts:5` to `pool: "forks"` (a perf regression accepted only to make the env-isolation pattern hold across workers). Third, the closure session memo `.apparat/sessions/2026-05-10-projects-registry-stale-temp-dir-noise.md:59-62` warns *"Future tests passing `project:` need the same isolation"* — pure tax on every new test author.

A dedicated `APPARAT_HOME` env-var collapses all three problems at the source: tests pin a one-purpose knob; the operator's `HOME` is never touched; the `pool: forks` workaround can revert.

## 2. Decision summary

Add `APPARAT_HOME` as the highest-precedence input to `getApparatHome()` in `src/daemon/state.ts:31-34`, fall back to `process.env.HOME ?? homedir()` for backward compatibility. Audit the two known inline `homedir()+".apparat"` joiners (`src/daemon/index.ts:12`, `src/lib/daemon-client.ts:11`) and route them through `getApparatHome()` so the override is universal across daemon entry, daemon-client socket path, and CLI. Migrate the 8 named test files under `src/cli/tests/` from per-describe `process.env.HOME` swaps to `process.env.APPARAT_HOME` swaps. Add `withFakeApparatHome()` test helper at `src/cli/tests/_apparatHome.ts`. Revisit `pool: "forks"` in `vitest.config.ts:5` — once HOME is no longer the lever, the threads pool no longer leaks registry state. Add a doc note (CONTEXT.md operator-global tier section + ADR-0010 env-var table).

In scope:

1. `getApparatHome()` resolution change — `APPARAT_HOME` first, `HOME` second.
2. Inline-bypass audit — `src/daemon/index.ts:12` and `src/lib/daemon-client.ts:11` route through `getApparatHome()`.
3. Test migration — 8 files under `src/cli/tests/` swap to `APPARAT_HOME`.
4. New helper — `src/cli/tests/_apparatHome.ts` exporting `withFakeApparatHome()`.
5. Vitest pool revisit — benchmark `pool: "threads"` vs. `forks` post-migration; revert the 0464c12 flip if `threads` is faster.
6. Doc updates — CONTEXT.md operator-global tier section + ADR-0010 env-var table; no README change needed.
7. Precedence unit test in `src/daemon/tests/state.test.ts`.

Out of scope:

- Removing the `HOME` fallback. Kept for backward compat — third-party scripts that already set `HOME` continue to work.
- Changing the on-disk layout of `~/.apparat/` itself. The override only changes how the path is *resolved*, not what lives inside it.
- Changing or pruning `projects.json`. The registry contract from `2026-05-10-projects-registry-stale-temp-dir-noise-design.md` stands.
- New CLI flag. The override is environment-only; no `--apparat-home`.

## 3. Architecture

### 3.1 Resolution graph (current)

```
caller
  └── getApparatHome()       src/daemon/state.ts:31-34
        └── process.env.HOME || homedir()
              └── join(home, ".apparat")
                    ↪ ~/.apparat                       ← single knob: HOME

bypasses (route around the helper, also keyed on HOME):
  src/daemon/index.ts:12       const apparatHome = join(process.env.HOME || homedir(), ".apparat");
  src/lib/daemon-client.ts:11  const SOCK_PATH   = join(process.env.HOME || homedir(), ".apparat", "daemon.sock");
```

### 3.2 Resolution graph (after fix)

```
caller
  └── getApparatHome()       src/daemon/state.ts:31-34
        └── process.env.APPARAT_HOME
              ?? join(process.env.HOME ?? homedir(), ".apparat")
                    ↪ <APPARAT_HOME>                    ← test/embed knob (highest precedence)
                    ↪ ~/.apparat                        ← operator default (unchanged)

bypasses removed:
  src/daemon/index.ts:12       → getApparatHome()
  src/lib/daemon-client.ts:11  → join(getApparatHome(), "daemon.sock")
```

The bypass audit is load-bearing. If either inline joiner stays keyed on `HOME` while `getApparatHome()` honours `APPARAT_HOME`, daemon and CLI can land on different homes — daemon writes its socket to `~/.apparat/daemon.sock` while CLI looks for it at `<APPARAT_HOME>/daemon.sock`. The socket bridge breaks silently. Routing both bypasses through `getApparatHome()` is what keeps the override safe under daemon usage.

### 3.3 Test-isolation pattern (before / after)

Before — `src/cli/tests/pipeline.test.ts:71-85`, the second `describe` repeats this for every block:

```ts
let fakeHome: string;
let origHome: string | undefined;
beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "apparat-validate-home-"));
  origHome = process.env.HOME;
  process.env.HOME = fakeHome;
  dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(dir, { recursive: true });
});
```

After — same describe scope, `APPARAT_HOME` only:

```ts
import { withFakeApparatHome } from "./_apparatHome";

let dir: string;
let scratch: { path: string; cleanup: () => void };
beforeEach(() => {
  scratch = withFakeApparatHome();
  dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
});
afterEach(() => {
  scratch.cleanup();
  rmSync(dir, { recursive: true });
});
```

The `delete process.env.X when origX === undefined` quirk still applies under the hood, but lives once inside the helper instead of being copy-pasted into every describe.

## 4. Components & key edits

### 4.1 `src/daemon/state.ts:31-34` — single-line change

```ts
export function getApparatHome(): string {
  return process.env.APPARAT_HOME
    ?? join(process.env.HOME ?? homedir(), ".apparat");
}
```

`??` is deliberate (vs. `||`): an `APPARAT_HOME` set to the empty string is a configuration mistake we want to surface, not coerce away. `process.env.APPARAT_HOME` is `undefined` when unset and a non-empty string when set — `??` matches that contract.

### 4.2 Inline-bypass routing

`src/daemon/index.ts:12` becomes:

```ts
import { getApparatHome } from "./state";
const apparatHome = getApparatHome();
```

`src/lib/daemon-client.ts:11` becomes:

```ts
import { getApparatHome } from "../daemon/state";
const SOCK_PATH = join(getApparatHome(), "daemon.sock");
```

Both files already import from elsewhere in the daemon tree; the new import is structurally cheap. Caveat: `daemon-client.ts` evaluates the constant at module-load time. If a test changes `APPARAT_HOME` after the module is imported, the cached `SOCK_PATH` is stale. Tests that exercise daemon-client must either set `APPARAT_HOME` before importing the module or call a re-resolved `getDaemonSocketPath()` accessor; the implementation plan picks the right shape.

### 4.3 New helper — `src/cli/tests/_apparatHome.ts`

```ts
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface FakeApparatHome {
  path: string;
  cleanup: () => void;
}

export function withFakeApparatHome(label = "apparat-test-home"): FakeApparatHome {
  const path = mkdtempSync(join(tmpdir(), `${label}-`));
  const orig = process.env.APPARAT_HOME;
  process.env.APPARAT_HOME = path;
  return {
    path,
    cleanup: () => {
      if (orig === undefined) delete process.env.APPARAT_HOME;
      else process.env.APPARAT_HOME = orig;
      rmSync(path, { recursive: true, force: true });
    },
  };
}
```

Naming is symmetric with the design doc filename and the env-var. Underscore prefix mirrors the existing `_helpers.ts` convention in `src/cli/tests/`.

### 4.4 Test migration map (8 files)

Per illumination Step 3 + verifier files-touched audit, these files swap their `HOME` triplet for `withFakeApparatHome()`. Existing line anchors are the verifier's:

| File | Existing isolation site |
|---|---|
| `src/cli/tests/pipeline.test.ts` | `:71-85` and the second describe at `:126-130` |
| `src/cli/tests/pipeline-preflight.test.ts` | `:23-75` describe-scoped |
| `src/cli/tests/pipeline-run-preflight.test.ts` | `:7-71` describe-scoped |
| `src/cli/tests/pipeline-headless.test.ts` | per-describe |
| `src/cli/tests/pipeline-failure-reason.test.ts` | per-describe |
| `src/cli/tests/pipeline-failure-footer-scenario.test.ts` | per-describe |
| `src/cli/tests/runs-gc-per-pipeline.test.ts` | per-describe |
| `src/cli/tests/pipeline-run-runid.test.ts` | inline within `it`, `:13-15` and `:30-31` |

`src/cli/tests/projects-registry.test.ts:9-18` and `src/cli/tests/status.test.ts:17-30` already use the same `HOME`-swap pattern; they migrate as well so the repo speaks one isolation dialect, not two. (Including those raises the file count to 10 if the implementing session prefers; the verifier-named 8 are the load-bearing ones.)

`src/daemon/tests/state.test.ts:7-8` is a separate animal — it sets `process.env.HOME` once at module load (before the import of `state.ts`) rather than per describe. It migrates to `process.env.APPARAT_HOME = ...` at the same scope; one-line edit.

### 4.5 Vitest pool revisit

`vitest.config.ts:5` currently pins `pool: "forks"`. The illumination's Step 4 calls for a benchmark after the migration: if `pool: "threads"` is faster (the default and the historic configuration), revert to `threads`. The decision criterion is empirical — measure once with `time npm test` under each pool, take the faster one. The implementation plan owns the benchmark; this design only authorises the revisit.

### 4.6 Precedence unit test — `src/daemon/tests/state.test.ts`

One new `describe("getApparatHome precedence", …)` covering:

1. `APPARAT_HOME` set → returns it verbatim.
2. `APPARAT_HOME` unset, `HOME` set → returns `join(HOME, ".apparat")`.
3. Both unset → returns `join(homedir(), ".apparat")`.
4. `APPARAT_HOME` set to empty string → still returns the empty string (operator misconfiguration surfaces, not silently coerces).

## 5. Data flow

### 5.1 Operator path (production, unchanged)

`APPARAT_HOME` unset. `getApparatHome()` falls through to `process.env.HOME ?? homedir()`. The operator's real `~/.apparat/` is the resolution. `apparat status`, `apparat watch`, and the daemon all behave exactly as today.

### 5.2 Test path (per-describe scratch home)

`beforeEach` calls `withFakeApparatHome()` → returns `{ path, cleanup }` and side-effect-sets `process.env.APPARAT_HOME = path`. Every subsequent `getApparatHome()` resolution inside the describe lands on `path`. `pipelineRunCommand({ project: dir })` → `recordProject(project)` → `projectsFilePath()` → `join(getApparatHome(), "projects.json")` → `<path>/projects.json`. `afterEach` → `cleanup()` restores the previous value of `APPARAT_HOME` (typically `undefined` → `delete`) and rms `path`. The operator's real `~/.apparat/` is never touched.

### 5.3 Spawned-child path (preflight tests)

`pipeline-preflight.test.ts:23-75`'s `spawnSync("node", [CLI, "pipeline", "run", dot])` calls inherit `process.env` by default. `APPARAT_HOME` propagates to the child process, which re-resolves `getApparatHome()` on its own startup and writes to the same `<path>/projects.json` as the parent. No explicit `env:` option needed in `spawnSync`.

### 5.4 Daemon path (cross-process)

If a test (or embed scenario) exercises the daemon, `APPARAT_HOME` must be set before the daemon is spawned. The daemon's entry (`src/daemon/index.ts:12`, post-fix) and the CLI client (`src/lib/daemon-client.ts:11`, post-fix) both go through `getApparatHome()`, so they agree on the same socket path as long as they share an env. This is the audit step's contract.

## 6. Blast radius / impact surface

- **Size:** **M.** Verifier final pass: M (~17–19 files). Explainer Tier-2 §Blast radius: M (~17–19 files). Same envelope.
  - **Files touched (core, 3):** `src/daemon/state.ts`, `src/daemon/index.ts`, `src/lib/daemon-client.ts`.
  - **Files touched (tests, 10–13):** 8 named test files in `src/cli/tests/` + `src/daemon/tests/state.test.ts` + optional `projects-registry.test.ts`/`status.test.ts` migration for dialect consistency.
  - **New file (1):** `src/cli/tests/_apparatHome.ts`.
  - **Config (1):** `vitest.config.ts:5` (pool revisit, may end up unchanged).
  - **Surfaces crossed:** daemon state + daemon entry + daemon-client socket + test infrastructure + vitest config + docs.

- **Breaking changes:** **none, conditional on the bypass audit.**
  - `getApparatHome()` keeps its `HOME` fallback — third-party tooling and existing tests that set `HOME` continue to work.
  - `recordProject`, `projectsFilePath`, `getApparatHome` keep their current signatures.
  - **Risk if the audit is skipped:** daemon and CLI split homes (daemon writes socket to `~/.apparat/daemon.sock` while CLI looks at `<APPARAT_HOME>/daemon.sock`); the socket bridge breaks silently. Mitigation: the audit step (§4.2) is a hard gate on shipping.

- **Spec / docs ripple checklist:**
  - [ ] `CONTEXT.md` — operator-global tier section (`:226-244`) gains a one-line note: "Tests and embed callers pin `~/.apparat/` via `APPARAT_HOME`; `HOME` should never be touched for this purpose."
  - [ ] `docs/adr/0010-rename-to-apparatus.md:22` — env-var table (`Env vars (6)`) updates to `(7)` with `APPARAT_HOME` listed.
  - [x] **No README change.** The `APPARAT_RUNS_KEEP` section near `:99` is operator-facing; `APPARAT_HOME` is test/embed-facing. Adding it to operator docs would muddy the message.
  - [x] **No design-spec ripple.** The 2026-05-10 `projects-registry-stale-temp-dir-noise-design.md` explicitly defers `APPARAT_HOME` to a follow-up (its §4.2). This design is that follow-up.

- **Test ripple checklist:**
  - [ ] **Edit** 8 named test files in `src/cli/tests/` — replace `HOME` swaps with `withFakeApparatHome()`.
  - [ ] **Edit** `src/daemon/tests/state.test.ts:7-8` — module-level `HOME` set becomes `APPARAT_HOME` set; add the new `getApparatHome precedence` describe.
  - [ ] **Optional edit** `src/cli/tests/projects-registry.test.ts:9-18` and `src/cli/tests/status.test.ts:17-30` for dialect consistency.
  - [ ] **New file** `src/cli/tests/_apparatHome.ts`.
  - [ ] **Verify** post-fix: run `npm test` once, then inspect `~/.apparat/projects.json` — line count unchanged; no entries match `apparat-pipeline-test-*` / `apparat-preflight-*` / `apparat-validate-home-*` / `apparat-test-home-*` patterns.
  - [ ] **Benchmark** `pool: "threads"` vs `forks` post-migration; revert `vitest.config.ts:5` if `threads` is faster.

## 7. Trade-offs

### 7.1 Env-var override vs. constructor argument

**Env-var (`APPARAT_HOME`) chosen.** Reasons:

- ADR-0010 already established the `APPARAT_*` env-var convention during the rename. `APPARAT_HOME` slots cleanly in.
- Spawned children (e.g., `pipeline-preflight.test.ts`'s `spawnSync`) inherit env vars by default. A constructor arg would need an explicit `env:` plumbing path through every child spawn — high friction.
- Embed callers (anyone importing `apparat` programmatically) get the override without touching the public API of `getApparatHome()`.
- Cost: env vars are process-global; tests must remember to clean up. The helper internalises the cleanup.

### 7.2 `??` vs. `||` for the precedence

**`??` chosen.** Reasons:

- `APPARAT_HOME=""` (empty string) is operator misconfiguration; `??` surfaces it (returns `""` → downstream `mkdirSync` fails loudly), `||` would silently fall through to `HOME`.
- `process.env.X` is `string | undefined`; `??` matches the type semantics.
- The current `||` on the inner `HOME ?? homedir()` is unchanged-in-spirit — `HOME=""` falling through to `homedir()` is the same legacy behaviour the repo already has.

### 7.3 Single helper vs. inline pattern at every site

**Helper chosen** (departure from the prior 2026-05-10 design's "no helper" decision). Reasons:

- The prior design had three call sites and explicitly flagged that "seven duplications might cross the threshold." The current scope is 8–10 — well across the threshold.
- Cleanup correctness (the `delete process.env.X when orig === undefined` quirk) lives in one place. Today every test author has to discover and re-implement it.
- The helper is ~20 lines in one file; the call site collapses to 1 line. Net legibility gain.
- Cost: one new module to keep in sync. Mitigation: the helper is self-contained, no transitive dependencies.

### 7.4 Keep `HOME` fallback vs. drop it

**Keep `HOME` fallback chosen.** Reasons:

- Removing it is a breaking change: existing test files that haven't migrated, third-party scripts that set `HOME` to control apparat (yes, this is technically a public contract today), and the existing `src/daemon/tests/state.test.ts:7-8` pattern would all need updating in the same PR.
- The fallback is one extra branch; cost is essentially zero.
- The migration can land in stages — `getApparatHome()` change first, then test files, then the bypass audit — without breaking the build at any intermediate point.

### 7.5 Audit + route inline bypasses vs. leave them

**Audit + route chosen.** Reasons:

- The two known bypasses (`src/daemon/index.ts:12`, `src/lib/daemon-client.ts:11`) sit on the daemon socket path. Splitting daemon vs. CLI homes silently breaks the socket bridge — a debug-tax cliff that would land on the next operator who tries `apparat watch` with `APPARAT_HOME` set.
- The fix is two import lines plus two assignment edits. Cost is negligible.
- This is the verifier's load-bearing caveat; skipping it would invalidate the "no breaking change" guarantee.

### 7.6 Revisit `pool: forks` vs. leave it

**Revisit (and revert if `threads` is faster).** Reasons:

- The 0464c12 flip to `forks` was accepted as a perf regression *because* HOME was the lever. With `APPARAT_HOME` as the lever, threads-pool sharing of `process.env` no longer leaks: each describe's `beforeEach` writes a unique scratch path; the worker thread sees that path; teardown restores. No cross-thread contamination.
- If the benchmark shows no perf delta, leave `forks` alone — net zero change.
- Cost: one benchmark run + one config edit. Benefit: potentially recovering test runtime.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including all 8 migrated test files and the new precedence test.
- `~/.apparat/projects.json` line count is unchanged after a full `npm test` (the contract from `2026-05-10-projects-registry-stale-temp-dir-noise-design.md` remains in force; this design must not regress it).
- The daemon socket bridge keeps working: `apparat watch` against a real project succeeds with no `APPARAT_HOME` set. With `APPARAT_HOME` set, daemon and CLI agree on the same socket path.
- `src/cli/tests/_apparatHome.ts` exports `withFakeApparatHome` that handles the `delete process.env.APPARAT_HOME when orig === undefined` quirk.

Behaviour invariants:

- `recordProject`, `projectsFilePath` bodies unchanged.
- No new CLI flag, no new public API export beyond the test helper.
- `~/.apparat/`'s on-disk layout unchanged.
- `APPARAT_RUNS_KEEP` semantics unchanged.

## 9. Open questions

### 9.1 `daemon-client.ts` module-load caching

`src/lib/daemon-client.ts:11` resolves `SOCK_PATH` at module load. If a test sets `APPARAT_HOME` after the import, the cached value is stale. Two shapes:

1. **Lazy accessor.** Replace the `const SOCK_PATH = ...` with `function getSocketPath() { return join(getApparatHome(), "daemon.sock"); }` and call it at every use site.
2. **Test discipline.** Document: "set `APPARAT_HOME` before importing `daemon-client`."

Recommend **option 1**. The cost is one accessor call per use site (negligible); the benefit is removing a footgun that exactly mirrors the one this design is closing.

### 9.2 Dialect-consistency migration of `projects-registry.test.ts` / `status.test.ts`

These two files already use the `HOME`-swap pattern correctly and don't currently leak. They could be migrated for consistency or left alone. Recommend **migrate** — leaving two dialects in the repo is exactly the maintenance hazard the helper is designed to retire.

### 9.3 Helper naming

`withFakeApparatHome()` mirrors the verifier's wording. Alternatives: `mkApparatHome()`, `useApparatHome()`. The `with*` shape is closest to the standard scope-helper idiom (`withMockedFs`, `withFakeTimers`). Recommend keeping `withFakeApparatHome`.

### 9.4 Vitest pool benchmark methodology

Single `time npm test` run is noisy. Recommend three runs each (`forks`, then `threads`), median wins, all on the same machine with no other load. The decision is binary; the methodology can be lightweight.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` clean.
- `grep -nR "APPARAT_HOME" src/` — at minimum: `src/daemon/state.ts`, `src/cli/tests/_apparatHome.ts`, `src/daemon/tests/state.test.ts`, plus the 8 migrated test files.
- `grep -nR "process\.env\.HOME" src/cli/tests/` — should drop to zero in the migrated files.
- `grep -nRE "join\(.*HOME.*\.apparat\b|join\(.*homedir\(\).*\.apparat\b" src/` — should match only `src/daemon/state.ts:31-34`. No bypasses remain.

### 10.2 Tests

- `npx vitest run src/daemon/tests/state.test.ts` — precedence describe passes (4 cases).
- `npx vitest run src/cli/tests/` — full directory passes.
- `npx vitest run` — full suite passes.

### 10.3 Empirical leak check (the contract that matters)

1. Snapshot: `cp ~/.apparat/projects.json /tmp/before.json`.
2. Run: `npm test`.
3. Compare: `diff /tmp/before.json ~/.apparat/projects.json` shows zero new entries.
4. Pattern grep: `grep -c "apparat-.*-home-\|apparat-pipeline-test-\|apparat-preflight-" ~/.apparat/projects.json` returns `0` (or unchanged from baseline).

### 10.4 Daemon-bridge check

1. With `APPARAT_HOME` unset: `apparat watch` against a project — succeeds (operator default path).
2. With `APPARAT_HOME=/tmp/scratch-apparat`: spawn a daemon (e.g., via heartbeat) and observe that `/tmp/scratch-apparat/daemon.sock` is created (not `~/.apparat/daemon.sock`). Both daemon and CLI agree.

### 10.5 Pool benchmark (decision input)

`time npm test` × 3 with `pool: "forks"`, then × 3 with `pool: "threads"`. Median wins. If `threads` is faster, revert `vitest.config.ts:5`.

## 11. Summary

`~/.apparat/` is currently controlled by exactly one knob — `process.env.HOME` — and `getApparatHome()` at `src/daemon/state.ts:31-34` re-reads that knob on every call. Tests that need the registry pinned have to swap the operator's whole `HOME` for the duration of the describe, fall back to a quirky `delete process.env.HOME when origHome === undefined` cleanup, and accept a `pool: "forks"` perf regression to make the swap hold across vitest workers. New test authors have to discover all of this; the recurring footgun cost the operator a 213-entry registry leak before it was caught.

This design adds `APPARAT_HOME` as a first-class override: `getApparatHome()` becomes `process.env.APPARAT_HOME ?? join(process.env.HOME ?? homedir(), ".apparat")`. The two known inline bypasses (`src/daemon/index.ts:12`, `src/lib/daemon-client.ts:11`) route through `getApparatHome()` so daemon and CLI never split homes. A new `withFakeApparatHome()` helper at `src/cli/tests/_apparatHome.ts` collapses the per-describe ritual to one line and internalises the cleanup quirk. 8 named test files migrate from `HOME` to `APPARAT_HOME`; `pool: "forks"` is revisited (and reverted if `threads` is faster). CONTEXT.md and ADR-0010 gain a one-line note each. Blast radius is **M** — ~17–19 files across daemon state, daemon entry, daemon-client socket, test infrastructure, vitest config, and two doc anchors. Breaking change: **none**, conditional on the bypass audit being completed (otherwise the daemon socket bridge splits silently). The 2026-05-10 stale-temp-dir design (its §4.2 explicitly deferred this work) stands as the upstream contract; this design is the deferred follow-up.
