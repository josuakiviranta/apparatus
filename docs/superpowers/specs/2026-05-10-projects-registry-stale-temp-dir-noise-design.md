# Design: Stop vitest from polluting `~/.apparat/projects.json`

**Date:** 2026-05-10
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-09T1930-projects-registry-stale-temp-dir-noise.md`

## 1. Motivation

The operator-global registry `~/.apparat/projects.json` is the data source behind `apparat status` and `apparat watch`. On the dev machine that produced the originating illumination it had grown to **223 entries**, of which **213 were stale** — `apparat-pipeline-test-*` and `apparat-preflight-*` paths from prior `npm test` runs whose temp dirs no longer exist. The cross-project legibility surface VISION asks for ("one human, many projects" → status answers "what is apparat doing on my machine?") becomes unreadable through that haze.

Two independent voices in the upstream `two-run-homes-no-cross-project-view` run flagged the same gap — the tester's Phase-3 verification of `apparat status` and the memory-writer's gotchas list. The chat refinement round (`$chat_summarizer.refinements`) then narrowed the diagnosis: this is a **test-isolation bug, not a registry-design gap**. The leak fires every time vitest invokes `pipelineRunCommand({ project: <tmpdir> })` without overriding `process.env.HOME` first.

The registry's own `recordProject` (`src/cli/lib/projects-registry.ts:30`) is doing exactly what its docstring says — "Idempotent: insert when absent, refresh `lastSeen` when present" — and is correct production code. The fix belongs in the tests that call it without isolating `HOME`.

## 2. Decision summary

Add `process.env.HOME` overrides to **three vitest files** so they redirect `recordProject` writes to a per-test temp home, mirroring the reference pattern already in three sibling test files. Zero production code changes. Zero documentation changes.

In scope:

1. `src/cli/tests/pipeline.test.ts` — both `describe` blocks (`pipelineValidateCommand` at `:69-122`, `pipelineRunCommand` at `:124+`) write to the operator's real registry through the `pipelineRunCommand(dotFile, { logsRoot: dir, project: dir })` calls inside the second block (call site at `:135`, plus the two further call sites flagged by the verifier at lines ~296 and ~341 in the not-yet-read tail of the file).
2. `src/cli/tests/pipeline-preflight.test.ts` — `writeTempDot()` at `:16-21` creates the leak source; the three `spawnSync("node", [CLI, "pipeline", "run", dot])` calls at `:33`, `:51`, `:68` each spawn a child CLI that inherits the operator's `HOME` and writes to the real registry.
3. `src/cli/tests/pipeline-run-preflight.test.ts` — three `mkdtempSync(join(tmpdir(), "apparat-preflight-"))` sites at `:9`, `:37`, `:55`; the second test (`:36-52`) is the one that actually triggers the leak (it passes `project: dir` to `pipelineRunCommand` at `:48`); the other two intentionally omit `project` and so do not call `recordProject`.

Out of scope (locked by the chat round):

- No `prune(entries, fsExists)` helper. No `apparat status --prune` flag. No `apparat projects forget <path>` command. The illumination's steps 1–4 are dropped — they are defensive registry-side cleanup whose cost (public surface, `WatchApp.tsx` `selectedIdx` clamp logic, doc ripple across `README.md`, `CONTEXT.md`, ADR-0008, and the two-run-homes design spec) is unjustified once the source leak is closed.
- No CI / git-hook backstop. Repo has no `.github/workflows/` and no `.husky/` (verifier blast-radius subagent confirmed). The leak is operator-driven (`npm test` / `vitest run`); fixing the three test files stops the bleed at its source.
- No migration script. The operator's `~/.apparat/projects.json` was already cleaned during the chat round (backed up to `~/.apparat/projects.json.bak-<timestamp>`; resulting file holds the two real projects: `apparatus`, `verba-extension`). Pre-cleanup state was 223 entries (213 stale + 8 transient `apparat-preflight-*` dirs from an in-flight test run).
- No production code edit, no Ink component touch, no schema change to `projects.json`, no public-API or CLI-flag change.

## 3. Architecture

### 3.1 Trigger graph (current — leaky)

```
vitest test runner
  process.env.HOME = <operator's real $HOME>          ← never overridden
    │
    ├── beforeEach: dir = mkdtempSync("apparat-pipeline-test-*")
    │
    └── pipelineRunCommand(dotFile, { project: dir })
          → src/cli/commands/pipeline/run.ts:59
              if (project) recordProject(project);
                → src/cli/lib/projects-registry.ts:30
                    projectsFilePath()
                      → src/cli/lib/projects-registry.ts:12-14
                          join(getApparatHome(), "projects.json")
                            → src/daemon/state.ts:31-34
                                join(process.env.HOME, ".apparat")
                            ↪ ~/.apparat/projects.json   ← LEAK
```

### 3.2 Trigger graph (after fix — isolated)

```
vitest test runner
  beforeEach:
    fakeHome = mkdtempSync("apparat-{block}-home-")
    origHome = process.env.HOME
    process.env.HOME = fakeHome                       ← isolation
    dir = mkdtempSync("apparat-pipeline-test-*")
  afterEach:
    process.env.HOME = origHome                       ← restore
    rmSync(fakeHome, { recursive: true, force: true })
    rmSync(dir, ...)
    │
    └── pipelineRunCommand(dotFile, { project: dir })
          → ... (same call chain)
            ↪ <fakeHome>/.apparat/projects.json       ← contained, then deleted
```

`recordProject` resolves `getApparatHome()` on every call (no module-level caching — `src/daemon/state.ts:31-34` re-reads `process.env.HOME` at invocation time), so swapping `HOME` inside `beforeEach` redirects the write deterministically.

### 3.3 Reference pattern (already in repo, copy verbatim)

The three reference test files already implement this pattern. The fix mirrors them.

`src/cli/tests/pipeline-run-runid.test.ts:13-15` — inline within the single `it`:

```ts
const fakeHome = mkdtempSync(join(tmpdir(), "apparat-rec-home-"));
const origHome = process.env.HOME;
process.env.HOME = fakeHome;
```

…with teardown at `:30-31`:

```ts
process.env.HOME = origHome;
rmSync(fakeHome, { recursive: true, force: true });
```

`src/cli/tests/projects-registry.test.ts:9-18` — `beforeEach`/`afterEach` shape (preferred when multiple `it` blocks share the home):

```ts
let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "apparat-registry-"));
  process.env.HOME = testHome;
  mkdirSync(join(testHome, ".apparat"), { recursive: true });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.HOME;
});
```

`src/cli/tests/status.test.ts:17-30` — same `beforeEach`/`afterEach` shape with stdout-capture sibling. The `delete process.env.HOME` in teardown (vs. restore-original) is acceptable in vitest because each test file gets a fresh environment; the design picks **restore-original** below for safety against parallel-test interference.

### 3.4 Per-file fix recipe

#### 3.4.1 `src/cli/tests/pipeline.test.ts`

Two `describe` blocks each have their own `beforeEach`/`afterEach` pair:

- `describe("pipelineValidateCommand", …)` at `:69-122` — `beforeEach` at `:71-74`, `afterEach` at `:75`. **Does not call `pipelineRunCommand`** so does not leak today; isolating `HOME` here is defensive (a future test added inside this block could leak). Recommend isolating both blocks for symmetry; the implementing session may scope-reduce to only the second block if it prefers.
- `describe("pipelineRunCommand", …)` at `:124+` — `beforeEach` at `:126-129` (cited as `:128` by the verifier), `afterEach` at `:130`. **This is the leak source** — every `it` here calls `pipelineRunCommand(dotFile, { logsRoot: dir, project: dir })` (call site at `:135` plus two further sites at `~:296` and `~:341` per the verifier's read of the not-yet-loaded tail of the file).

For each `beforeEach`, prepend the `fakeHome = mkdtempSync(...); origHome = process.env.HOME; process.env.HOME = fakeHome` triplet. For each `afterEach`, prepend `process.env.HOME = origHome; rmSync(fakeHome, { recursive: true, force: true })`. Use a `let fakeHome: string; let origHome: string | undefined` declaration at the same scope as the existing `let dir: string`.

#### 3.4.2 `src/cli/tests/pipeline-preflight.test.ts`

The leak is one level removed from `mkdtempSync`. The file currently has:

- `beforeAll` at `:9-14` — only checks the dist artifact exists; does not isolate HOME.
- `writeTempDot(contents)` at `:16-21` — creates `apparat-preflight-*` dirs but does not write to the registry directly.
- Three `it` blocks at `:24-40`, `:42-58`, `:60-74` — each calls `spawnSync("node", [CLI, "pipeline", "run", dot])` which **inherits the parent's `process.env.HOME`** and runs the full CLI in a child process. The child writes to the parent's real `~/.apparat/projects.json`.

Isolation must therefore happen at the **describe scope** so that the spawned children see the fake HOME via inheritance. Add a `beforeEach`/`afterEach` to the existing `describe("pipeline run pre-flight check", …)` block at `:23-75`:

```ts
let fakeHome: string;
let origHome: string | undefined;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "apparat-preflight-home-"));
  origHome = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  rmSync(fakeHome, { recursive: true, force: true });
});
```

The `spawnSync` calls at `:33`, `:51`, `:68` automatically inherit the patched `HOME` because vitest does not pass an explicit `env:` option there — Node's `child_process.spawnSync` defaults to `process.env`. (Verified by inspecting the call shape at `:33`: `spawnSync("node", [CLI, "pipeline", "run", dot], { encoding: "utf-8" })` — no `env` option.)

The second `describe("pipeline list shows requires:", …)` block at `:77-128` does **not** invoke `pipeline run` — it only spawns `pipeline list`, which does not call `recordProject`. Isolating HOME there is defensive only; recommend doing it for symmetry.

#### 3.4.3 `src/cli/tests/pipeline-run-preflight.test.ts`

Three `mkdtempSync(join(tmpdir(), "apparat-preflight-"))` sites at `:9`, `:37`, `:55`. Of these:

- The first test (`:8-34`) calls `pipelineRunCommand(dot, {})` at `:25` — **does not pass `project`**, so `if (project) recordProject(project)` at `run.ts:59` does not fire. No leak.
- The second test (`:36-52`) calls `pipelineRunCommand(dot, { project: dir })` at `:48` — **leaks**.
- The third test (`:54-70`) calls `pipelineRunCommand(dot, {})` at `:66` — **does not pass `project`**. No leak.

The minimal fix isolates HOME inside the second `it` only. The defensive (preferred) fix adds a `describe`-scoped `beforeEach`/`afterEach` so future tests added to this file inherit isolation by default. Recommend the defensive shape — same `let fakeHome / let origHome / beforeEach / afterEach` triplet as in §3.4.2.

### 3.5 Files-touched buckets

| Bucket | File | Treatment |
|---|---|---|
| Test isolation | `src/cli/tests/pipeline.test.ts` | Edit two `beforeEach`/`afterEach` pairs (`:71-75`, `:126-130`). Add HOME swap. |
| Test isolation | `src/cli/tests/pipeline-preflight.test.ts` | Edit — add describe-scoped `beforeEach`/`afterEach` to the `pipeline run pre-flight check` block (`:23-75`); recommend symmetric add to the `pipeline list shows requires:` block (`:77-128`). |
| Test isolation | `src/cli/tests/pipeline-run-preflight.test.ts` | Edit — add describe-scoped `beforeEach`/`afterEach` to the `pipelineRunCommand — $project preflight` block (`:7-71`). |

Total files: **3 test files** (in scope). No production code, no docs, no Ink components, no `program.ts`, no schema changes, no agent rubric changes.

## 4. Components & key edits

### 4.1 No new helper

The reference pattern is short enough (3 lines setup + 2 lines teardown) that extracting a shared `withFakeApparatHome()` helper is **not** justified. Three test files duplicating five lines apiece is below the abstraction threshold; the helper would create a new shared module that all three files import, and the abstraction would obscure the pattern at exactly the call sites where future contributors most need to see it spelled out.

The implementing session may revisit this if it discovers that the 6 sibling test files in §6's "residual leak surface" caveat also need the same fix — at that point seven duplications might cross the threshold. Out of scope for this design.

### 4.2 No `APPARAT_HOME` env var

The chat refinement bullet allowed "`process.env.HOME` (and/or `APPARAT_HOME`)" as the isolation knob. `getApparatHome()` at `src/daemon/state.ts:31-34` only consults `process.env.HOME` (not an `APPARAT_HOME` env var). Adding `APPARAT_HOME` would be a production-code change (out of scope). The fix uses `process.env.HOME` exclusively, matching the three reference patterns in the repo.

## 5. Data flow

### 5.1 Today (leak)

Each `pipelineRunCommand` call inside an unisolated test mutates the operator's real `~/.apparat/projects.json`. Over the lifetime of one full `npm test` run, ~10 entries are appended (one per `pipelineRunCommand` call site that passes `project: dir`). Across hundreds of test runs, the registry accumulates hundreds of paths to temp dirs that no longer exist.

### 5.2 After fix

`process.env.HOME = fakeHome` in `beforeEach` redirects every `getApparatHome()` resolution inside the test to `<fakeHome>/.apparat/`. `recordProject` writes there. `afterEach` deletes `<fakeHome>` along with its contents. The operator's real registry is untouched.

Spawned child processes (`pipeline-preflight.test.ts`'s `spawnSync` calls) inherit the patched `HOME` automatically because `child_process.spawnSync` defaults to `process.env` when no `env:` option is supplied. The CLI binary they invoke (`dist/cli/index.js`) re-reads `process.env.HOME` on its own startup, lands on the patched value, and writes to `<fakeHome>/.apparat/projects.json` rather than the operator's real one.

## 6. Blast radius / impact surface

- **Size:** **XS.** Verifier final pass: XS. Explainer Tier-2 §Blast radius: XS. Same envelope.
  - **Files touched:** **3** — `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-preflight.test.ts`, `src/cli/tests/pipeline-run-preflight.test.ts`.
  - **Surfaces crossed:** vitest setup only. **No** registry lib, **no** `pipelineRunCommand` body, **no** Ink components, **no** `program.ts`, **no** daemon code, **no** agent files, **no** `.dot` schema.

- **Breaking changes:** **none.**
  - No public API change.
  - No CLI flag change.
  - No `projects.json` schema change.
  - No env-var semantic change (`APPARAT_RUNS_KEEP` / `APPARAT_HOME` etc. untouched).
  - The `recordProject` export, `projectsFilePath` export, and `getApparatHome` export keep their current signatures.

- **Spec / docs ripple checklist:**
  - [x] **No `README.md` change.** Verifier blast-radius subagent grep found no test-isolation language in `README.md`.
  - [x] **No `CONTEXT.md` change.** Same grep — no relevant references.
  - [x] **No ADR change.** `docs/adr/0008-partial-revert-of-ralph-folder.md:95` mentions `projects.json` but does not cover test-environment setup; no ripple.
  - [x] **No design-spec ripple.** `docs/superpowers/specs/2026-05-09-two-run-homes-no-cross-project-view-design.md:20,40,44` reference `projects.json` but only in the production-code architecture sections — none cover test isolation.

- **Test ripple checklist:**
  - [ ] **Edit** `src/cli/tests/pipeline.test.ts` — two `beforeEach`/`afterEach` pairs at `:71-75` and `:126-130` gain the HOME-swap triplet.
  - [ ] **Edit** `src/cli/tests/pipeline-preflight.test.ts` — describe-scoped `beforeEach`/`afterEach` added to the `pipeline run pre-flight check` block at `:23-75`; recommended symmetric add to the `pipeline list shows requires:` block at `:77-128`.
  - [ ] **Edit** `src/cli/tests/pipeline-run-preflight.test.ts` — describe-scoped `beforeEach`/`afterEach` added to the `pipelineRunCommand — $project preflight` block at `:7-71`.
  - [ ] **Verify** post-fix: run `npm test` once on a clean machine, then inspect `~/.apparat/projects.json` — line count must be unchanged from the pre-test baseline (i.e. zero new `apparat-pipeline-test-*` or `apparat-preflight-*` entries).

- **Residual leak surface (caveat from upstream verifier):**
  The verifier's blast-radius subagent flagged 6 additional test files that also call `pipelineRunCommand` without isolating HOME — `src/cli/tests/implement.test.ts`, `meditate.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `pipeline-failure-reason.test.ts`, `pipeline-headless.test.ts`, `runs-gc-per-pipeline.test.ts`. The subagent did **not** exhaustively re-verify whether each one passes `project` (and thus actually triggers `recordProject` at `run.ts:59`). Two paths forward, both consistent with this design's contract:

  1. **Scope-defer.** Land this design's three-file fix; let the verification step (above) measure residual leak; open a follow-up if any of the 6 sibling files prove to be active leak sources.
  2. **Scope-expand.** The implementation plan author audits the 6 sibling files (one `grep -n "project:" <file>` per file, then read the surrounding `pipelineRunCommand` call) and adds them to the fix list if they leak. Net cost: at most 6 more `beforeEach`/`afterEach` edits, no new architectural change.

  Recommend **option 1** — the in-scope fix already closes the dominant leak surface (the 213 stale entries observed on the operator's machine were from `apparat-pipeline-test-*` and `apparat-preflight-*` patterns, both of which are produced exclusively by the three in-scope files). Option 2 is a defensible widening if the verification step shows residual growth.

## 7. Trade-offs

### 7.1 Test isolation vs. registry-side `prune()` helper

**Test isolation** chosen. Reasons (refinement-locked):

- The observed problem is a **test bug**, not an "operator deletes a real project and the registry doesn't notice" hypothetical. The 213 stale entries on the operator's machine all matched the two test patterns (`apparat-pipeline-test-*`, `apparat-preflight-*`) — none were ever real projects.
- Closing the source leak eliminates the bleed permanently. A `prune(entries, fsExists)` helper would only paper over reads — every test run would still write garbage that gets cleaned up later.
- Cost: three test files edited. Benefit: zero new public surface, zero `WatchApp.tsx` `selectedIdx` clamp logic, zero doc ripple, blast radius drops from S–M (~10 files) to XS (3 files).

### 7.2 `process.env.HOME` swap vs. new `APPARAT_HOME` env var

**HOME swap** chosen. Reasons:

- Three reference test files in the repo already use this pattern. New tests added later will copy the closest pattern they see; consistency wins.
- An `APPARAT_HOME` env var would require a production-code change in `src/daemon/state.ts` (`getApparatHome()` would need to consult both vars). Out of scope.
- Cost: tests must remember to restore `process.env.HOME` in teardown. Benefit: zero production code change.

### 7.3 `describe`-scoped vs. `it`-scoped isolation

**`describe`-scoped** chosen. Reasons:

- Future `it` blocks added inside the same `describe` automatically inherit isolation. The leak's recurrence cost is therefore zero — adding a new test to one of these blocks cannot reintroduce the bug.
- The defensive symmetry also means the fix doesn't depend on a contributor reading the design doc to understand which `it` blocks need isolation.
- Cost: minor — `describe` blocks that don't strictly leak (e.g. `pipelineValidateCommand` in `pipeline.test.ts`) still get the isolation. Benefit: a single visual rule ("every `describe` that touches CLI commands isolates HOME") instead of a per-`it` audit.

### 7.4 No shared helper

**No `withFakeApparatHome()` helper** chosen. Reasons:

- Three call sites at five lines apiece is below the abstraction threshold.
- Inline pattern is more legible at the leak surface — future contributors see the swap right where it matters, not buried in a helper module.
- Cost: ~15 lines duplicated across three files. Benefit: zero new module, zero import drift, zero risk of the helper diverging from the three reference patterns already in the repo.

### 7.5 Scope-defer vs. scope-expand on the 6 sibling files

**Scope-defer** chosen. Reasons (per §6's caveat handling):

- The dominant leak surface (213/213 stale entries match the in-scope patterns) is fully closed by this design.
- Auditing 6 more files inflates the design's "files touched" count without evidence that any of them actually leak. The verification step (rerun `npm test`, inspect registry growth) is the cheap empirical check.
- Cost: a follow-up may be needed if residual growth shows up. Benefit: this design ships standalone; the follow-up is at most another XS-blast PR with the same pattern.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes (no source-code edits, so this is automatic).
- `npx vitest run` passes — including the three edited test files.
- `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-preflight.test.ts src/cli/tests/pipeline-run-preflight.test.ts` passes.
- After a full `npm test` invocation on the operator's machine, `wc -l ~/.apparat/projects.json` is unchanged from the pre-test baseline (modulo any real `apparat pipeline run` invocations the operator did manually during the run).
- `~/.apparat/projects.json` after the verification step contains zero entries matching `/var/folders/.*/apparat-pipeline-test-/` or `/var/folders/.*/apparat-preflight-/`.
- The three edited `describe` blocks remain green individually and as part of the full suite.

Behaviour invariants:

- `recordProject` body unchanged.
- `getApparatHome` body unchanged.
- `pipelineRunCommand` body unchanged.
- No new env var. No new CLI flag. No new module. No new export.
- `pipeline-run-runid.test.ts`, `projects-registry.test.ts`, `status.test.ts` unchanged (their existing isolation pattern is the reference).

## 9. Open questions

### 9.1 Symmetric isolation in non-leaking `describe` blocks

`pipeline.test.ts`'s `pipelineValidateCommand` block (`:69-122`) and `pipeline-preflight.test.ts`'s `pipeline list shows requires:` block (`:77-128`) do not currently leak — the calls inside them either do not invoke `pipelineRunCommand` or do not pass `project`. Two options:

1. **Isolate symmetrically** — every `describe` that touches CLI commands gets the HOME swap, defensive against future tests added inside that block leaking.
2. **Isolate only the leak sources** — minimal change, three blocks instead of four/five.

Recommend **option 1**. The cost is one `beforeEach`/`afterEach` per extra block; the benefit is a single uniform rule that is easier to enforce in code review than "isolate this block but not that one."

### 9.2 Scope of the residual-leak audit

§6 leaves the 6 sibling test files (`implement.test.ts`, `meditate.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `pipeline-failure-reason.test.ts`, `pipeline-headless.test.ts`, `runs-gc-per-pipeline.test.ts`) for the implementation plan author to triage. The recommended path is "fix three, measure, follow up if needed." The implementation plan may instead pre-emptively audit and fix all 9 in one PR. Either path is consistent with the contract here. The recommendation tilts toward "fix three, measure" because the verification step is cheap (`npm test` + `wc -l`) and the dominant leak is fully addressed by the in-scope fix.

### 9.3 `delete process.env.HOME` vs. restore-original on teardown

The reference patterns in the repo are split:

- `projects-registry.test.ts:17` and `status.test.ts:29` use `delete process.env.HOME` in teardown.
- `pipeline-run-runid.test.ts:30` uses `process.env.HOME = origHome` (restore).

The two are functionally equivalent inside a single vitest file (each file gets a fresh environment), but **restore-original** is safer if vitest later parallelises within-file describes (the `delete` form would lose the original value). Design picks **restore-original** for all three new edits; the implementing session may use `delete` if it judges the parallel-safety hypothetical to be remote.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean (no source edits, so automatic).
- `grep -nR "process\.env\.HOME" src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-preflight.test.ts src/cli/tests/pipeline-run-preflight.test.ts` — at least one match per file, scoped to a `beforeEach`/`afterEach` block.

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline.test.ts` — all `it` blocks pass after the edits.
- `npx vitest run src/cli/tests/pipeline-preflight.test.ts` — all `it` blocks pass after the edits.
- `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts` — all `it` blocks pass after the edits.
- `npx vitest run` — full suite passes.

### 10.3 Empirical leak check (the contract that matters)

1. Snapshot the registry: `cp ~/.apparat/projects.json /tmp/before.json`; `wc -l /tmp/before.json`.
2. Run the full test suite: `npm test`.
3. Compare: `wc -l ~/.apparat/projects.json` matches the baseline; `diff /tmp/before.json ~/.apparat/projects.json` shows zero new entries.
4. Grep for the leak patterns: `grep -c "apparat-pipeline-test-\|apparat-preflight-" ~/.apparat/projects.json` returns `0` (or unchanged from baseline).

### 10.4 Negative cases

- An `it` block that intentionally does not pass `project: dir` (e.g. `pipeline-run-preflight.test.ts:8-34` first test) still passes — the HOME isolation is harmless for tests that never call `recordProject`.
- A spawned child CLI (e.g. `pipeline-preflight.test.ts:33`'s `spawnSync`) inherits the patched HOME — confirmed by the absence of new entries in the operator's real registry after the verification run.
- Concurrent vitest workers do not cross-contaminate — each worker process gets its own `process.env` copy, and within a worker each `beforeEach` sets up a unique `mkdtempSync` home.

## 11. Summary

`~/.apparat/projects.json` was 223 entries on the operator's dev machine, 213 of them stale `apparat-pipeline-test-*` and `apparat-preflight-*` paths from prior `npm test` runs. The leak source is three vitest files — `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-preflight.test.ts`, `src/cli/tests/pipeline-run-preflight.test.ts` — that call `pipelineRunCommand({ project: <tmpdir> })` (or spawn a CLI child that does the same) without first overriding `process.env.HOME`. Every such call lands at `src/cli/commands/pipeline/run.ts:59` (`if (project) recordProject(project);`), which writes the temp path to the operator's real registry through `getApparatHome()` at `src/daemon/state.ts:31-34`. The fix is three test-file edits: each `describe` that touches a CLI command gains a `beforeEach`/`afterEach` pair that swaps `process.env.HOME` to a `mkdtempSync("apparat-{block}-home-")` and restores it in teardown — the same pattern already used by `pipeline-run-runid.test.ts:13-15`, `projects-registry.test.ts:9-18`, and `status.test.ts:17-30`. **Zero production code changes.** **Zero documentation changes.** Blast radius is **XS** — three files in scope, no public-API change, no schema change, no breaking change. The illumination's steps 1–4 (a `prune(entries, fsExists)` helper, `apparat status --prune`, `apparat projects forget <path>`) are dropped per the chat refinement: defensive registry-side cleanup is unjustified once the source leak is closed. The illumination's step 6 (one-time backfill) was already executed during the chat round (registry backed up to `~/.apparat/projects.json.bak-<timestamp>`, cleaned to two real entries). The verification contract is empirical: after the fix, a full `npm test` invocation must not increase the registry's line count or introduce any entries matching the two leak patterns. One open caveat: 6 sibling test files (`implement.test.ts`, `meditate.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `pipeline-failure-reason.test.ts`, `pipeline-headless.test.ts`, `runs-gc-per-pipeline.test.ts`) also call `pipelineRunCommand` without HOME isolation — whether each passes `project` (and thus triggers `recordProject`) was not exhaustively re-verified upstream; design recommends "fix three, measure, follow up if needed" rather than pre-emptively expanding scope.
