## Design: tmux-tester forms a focused test plan before the cycle

**Date:** 2026-05-16
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-16T1359-tmux-tester-runs-context-blind-test-battery.md`

## 1. Motivation

`tmux-tester` is the agent that drives observable verification for an implementation cycle (`CONTEXT.md:140-141`). Today it enters Phase 1 without ever asking *what changed*:

```
## Phase 1 — Automated verification
1. Send into the window:
   cd $project && npm run build && npm test
```
(`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:195-204`)

The diff is only consulted in Phase 1c *after* the full test cycle settles, and even then only to count plan coverage:

```bash
git diff --name-only $capture_pre_sha.pre_sha HEAD
```
(`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:207-214`)

The Phase 3a relevance selector inherits the same diff but its cross-cutting fallback nullifies almost every prune:

> If the diff touches engine internals (`src/attractor/`, `src/cli/lib/dot/`, the validator, handler dispatch, the deep-loop runner, the streaming formatter) → INCLUDE all.

(`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:249`)

In practice almost every implementation change touches at least one of those paths, so the INCLUDE set is the full scenario battery on every run. Combined with the unconditional `npm test`, the operator at `tmux_confirm_gate` sees a `test_render` that took 3–5 minutes to produce and never tells them what hypothesis the agent was testing — only what passed and failed.

Phase 3a was added by `1921f08 feat(tmux-tester): live scenario discovery + execution in Phase 2` and `plan_files_touched` followed in `75ee0c8 feat(tmux-tester): add plan_files_touched signal`. Both read the diff after the full test run. The missing piece is reading it *first*.

### What this design closes

- The operator-observed gap that motivated the illumination: *"tmus_tester should not always run the same smoke tests instead it should think which tests to run, and which aspects to focus its attention based on what was actually implemented."* (`.apparat/meditations/illuminations/2026-05-16T1359-tmux-tester-runs-context-blind-test-battery.md:8`)
- The "5-second audit" gap at `tmux_confirm_gate`: today the human reads `### Cycles run`, `### Scenarios run`, `### Fixes applied`, `### Remaining issues` (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:344-368`) before they understand what the agent even tried to test. After this change the verdict opens with a `### Test focus` prelude that names the changed paths, the targeted test files, and the scenario inclusion rationale.
- The inert cross-cutting fallback: the single `engine internals → INCLUDE all` rule is replaced by a tiered rule so an edit to `src/cli/components/TextInput.tsx` no longer drags every scenario into the run.
- The redundant `git log -1 --stat` read in Phase 3 manual exercise (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:308`) — Phase 0b already holds the same data as `impl_summary` and Phase 3 reuses it.

### What this design explicitly does **not** close

- No change to the `test_render` JSON schema. The schema keeps its four current sections; `### Test focus` is a new markdown prelude inside the same `test_render` string.
- No change to pipeline frontmatter, no new node attribute, no new `outputs:` key.
- No TypeScript code change. The agent is `.md` prose and the change lives entirely in that prose.
- No change to Phase 1c (`plan_files_touched`), Phase 2 self-skip / agent-as-human / aggregation contracts, the Fix step, or the Phase 4 `test_result` decision logic. Those phases are unchanged so existing downstream gates (`tmux_confirm_gate`) keep working.
- No new ADR. ADR-0003 (`docs/adr/0003-scenario-tests-in-implement-pipeline.md`) is the governing decision for scenario tests in the implement pipeline; it does not forbid per-diff scoping and may receive an addendum paragraph noting the tiered fallback (see §5).

## 2. Decision summary

A single agent-prose change applied to two files (canonical + parallel-pipeline sibling). Five edits, all inside `tmux-tester.md`:

1. **Insert Phase 0b — Implementation understanding.** After Phase 0a (candidate extraction at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:185-194`), read `git diff --stat $capture_pre_sha.pre_sha HEAD` and `git diff --name-only $capture_pre_sha.pre_sha HEAD`. Record the result as `impl_summary`: a short human-readable structure naming the changed source modules and tagging each by category (handlers, validator, TUI components, CLI commands, scenarios, pipeline agents). Hold `impl_summary` in working memory for the cycle.

2. **Targeted test sub-suite ahead of the full run.** At the top of Phase 1 (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:195-204`), before sending `npm test`, identify 1–3 most relevant test files by grepping for tests that `import` or reference the changed modules from `impl_summary`. Send `cd $project && npm run build && npm test -- <files>` first, `wait_for_string "Test Files"` on the narrow run, capture, then proceed to the full `npm test` as today. If the targeted run is red, skip directly to the Fix step without waiting for the full suite.

3. **Tiered cross-cutting rule replaces the engine-internals INCLUDE-all.** At `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:249`, replace the single fallback bullet with a four-tier ladder driven by which subtree the diff touches: handlers, core, lib, components. Each tier names its own INCLUDE set (see §3.3). The "Bias toward INCLUDE", "Floor", and "Record the call" rules at `:250-254` are unchanged.

4. **Prepend `### Test focus` to `test_render`.** Add a new section as the *first* `###` heading inside the `test_render` template at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:340-368`, ahead of `### Cycles run`. The section names the changed paths, the targeted test files run first, and the scenario INCLUDE/SKIP reasoning rolled up from Phase 3a. The existing four sections (`Cycles run`, `Scenarios run`, `Fixes applied`, `Remaining issues`) stay verbatim in order.

5. **Pass `impl_summary` into Phase 3 manual exercise.** Replace the runtime `git log -1 --stat` and `git diff HEAD~1 HEAD --stat` reads at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:308` with a reuse of `impl_summary` already computed in Phase 0b. The Phase 3 budget ("max 2 commands, 60s each per cycle" at `:313`) is unchanged.

The same five edits are mirrored verbatim into `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md` (whose line numbers shift by ~1 because of whitespace; the structural anchors — Phase 0a, Phase 1, Phase 3a cross-cutting fallback, Phase 3, Phase 4 `test_render` template — are at `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md:186-194`, `:196-206`, `:251`, `:312-319`, `:339-` respectively).

## 3. Architecture

### 3.1 `impl_summary` shape

A compact in-memory record the agent builds once at Phase 0b and reuses throughout the cycle:

```
changed_paths: [list of relative paths from `git diff --name-only`]
size:          string from `git diff --stat` final line (e.g. "3 files changed, 47 insertions(+), 12 deletions(-)")
categories:    map<category, list-of-paths> classifying each path by subtree
```

The category buckets are derived strictly from path prefixes — no per-file inspection — so the step is deterministic and cheap:

- `handlers`        → `src/attractor/handlers/`
- `core`            → `src/attractor/core/` (validator, graph-ast, engine, deep-loop runner, streaming formatter)
- `cli-lib`         → `src/cli/lib/` excluding `dot/` (which falls under `core`)
- `cli-commands`    → `src/cli/commands/`
- `components`      → `src/cli/components/`
- `scenarios`       → `.apparat/scenarios/`
- `pipeline-agents` → `.apparat/pipelines/`
- `tests`           → any path matching `**/tests/**` or `*.test.ts(x)`
- `other`           → anything that doesn't match the above

`impl_summary` is not a pipeline output (`outputs:` is unchanged in the agent frontmatter), not persisted to disk, and not surfaced through the JSON envelope. It is a working-memory artifact owned by this one agent for the duration of one cycle.

### 3.2 Targeted test selection

Phase 1 currently runs `cd $project && npm run build && npm test` (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:197-200`). The new Phase 1 introduces a pre-step:

```
1a. From impl_summary.changed_paths, identify 1–3 most relevant test files:
    - For each `src/**/*.{ts,tsx}` path in changed_paths, find its co-located test
      via the project's test convention (typically `src/cli/tests/<basename>.test.ts`
      or sibling `*.test.tsx` files).
    - If a changed path IS itself a test file, that file IS the targeted test.
    - Cap the set at 3 files. If reasoning produces more, pick the 3 most directly
      tied to the changed modules (smallest enclosing scope wins).
    - If reasoning produces zero (e.g. only `.md` or `.dot` files changed),
      skip the targeted run and go directly to the full `npm test`.

1b. Send into the window:
       cd $project && npm run build && npm test -- <targeted-files>
    wait_for_string "Test Files" with budget 60000ms (fallback "Tests").
    capture, read current.txt.

1c. If targeted run is RED → skip to Fix step. Do NOT run the full suite.
    If targeted run is GREEN → proceed to the existing full-suite step.

1d. (formerly step 1) Send into the window:
       npm test
    The build is already warm from step 1b so this is the test re-run only.
    wait_for_string "Test Files" with budget 300000ms.
```

The existing Phase 1c (diff cross-reference) follows after step 1d, unchanged in behavior. The renumbering is local to Phase 1 prose; no downstream output key shifts.

The narrow budget (60s vs 300s) is the explainer-promised "≤30s for the common case" with headroom. If the targeted suite blows past 60s the wait still resolves — `wait_for_string` returns the captured output regardless — and the cycle continues to step 1d.

### 3.3 Tiered cross-cutting rule

Today the cross-cutting fallback at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:249` reads:

> **Cross-cutting fallback.** If the diff touches engine internals (`src/attractor/`, `src/cli/lib/dot/`, the validator, handler dispatch, the deep-loop runner, the streaming formatter) → INCLUDE all. Engine changes hit every scenario; do not try to be clever.

The replacement is a tiered ladder evaluated against `impl_summary.categories`:

> **Cross-cutting fallback (tiered).** Walk the ladder top to bottom; the first matching tier defines the INCLUDE floor (other relevance reasoning may add more scenarios on top):
> - `core` touched → INCLUDE all. Engine, validator, or streaming-formatter changes hit every scenario.
> - `handlers` touched → INCLUDE every scenario whose `.dot` declares a node with one of the touched handler kinds (read each candidate's `pipeline.dot` to check the `handler=…` attribute), PLUS one cross-cutting sanity scenario (`static-multi-node` or `conditional`, whichever is present).
> - `cli-lib` touched (but not `core`) → INCLUDE only scenarios whose `pipeline.dot` invokes the specific command whose lib code changed (read each candidate's `.dot` for `apparat <command>` invocations in agent prose or `script_file`).
> - `components` touched (but not `core`/`handlers`/`cli-lib`) → INCLUDE only scenarios that drive TUI interactively (the ones containing `gate`, `chat-end-to-end`, or any node with `interactive=true`).
> - None of the above touched (only `scenarios`, `pipeline-agents`, `tests`, `other`) → no cross-cutting floor; per-scenario relevance reasoning decides INCLUDE/SKIP.

The "Bias toward INCLUDE" and "Floor" rules at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:252-253` remain in force: if relevance reasoning is uncertain it still INCLUDEs; if it produces zero INCLUDEs it still INCLUDEs one sanity scenario.

The ladder is intentionally first-match-wins rather than additive. A change that touches both `handlers` and `core` is dominated by `core` (INCLUDE all), so the tier-1 hit short-circuits. A change that touches both `handlers` and `components` walks down to `handlers` because that's the higher tier — handlers are exercised by more scenarios than TUI-only components, so the broader floor wins.

### 3.4 `### Test focus` prelude

The current `test_render` template at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:340-368` opens:

```markdown
## Verification: **PASS** | **FAIL**

<one-line summary sentence matching test_summary>

### Cycles run
1. <Cycle 1 headline — what was observed, what broke, what was fixed>
...
```

After this change the template gains one section between the verdict line and `### Cycles run`:

```markdown
## Verification: **PASS** | **FAIL**

<one-line summary sentence matching test_summary>

### Test focus
Changed: <comma-separated changed_paths, truncated to first 5 + "…N more" if longer>
Targeted: <comma-separated test files run in Phase 1b, or "none — no source files changed">
Scenarios: <one-line roll-up — "I included, S skipped (reason: <dominant tier or per-scenario>)">

### Cycles run
...
```

The prelude is a single short block (≤6 lines in the common case). It re-states facts already in `### Cycles run` and `### Scenarios run` but in a form scannable in five seconds. The `Scenarios:` line names the dominant tier of the cross-cutting rule when one fired (e.g. "Scenarios: 8 included, 3 skipped (reason: tier `handlers` floor + 1 cross-cutting sanity)"); otherwise it falls back to "per-scenario reasoning".

The output-schema impact is zero. `test_render` is a freeform markdown string in the JSON envelope; adding a new section adds bytes inside that string and does not touch the schema. `tmux_confirm_gate` renders the string verbatim today (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:371`), so the gate picks up the new section automatically.

### 3.5 Phase 3 reuse of `impl_summary`

Phase 3 currently begins (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:306-313`):

```markdown
## Phase 3 — Targeted manual exercise

If the implementation node's diff touched a specific command (check `git log -1 --stat` and `git diff HEAD~1 HEAD --stat`), exercise that command interactively when practical:
...
Keep Phase 3 tight — max 2 commands, 60s each per cycle.
```

After the change:

```markdown
## Phase 3 — Targeted manual exercise

Using `impl_summary` (built in Phase 0b), check whether the diff touched a specific command — i.e. any path under `src/cli/commands/` or any TUI component reachable from one. If yes, exercise that command interactively when practical:
...
Keep Phase 3 tight — max 2 commands, 60s each per cycle.
```

No new git read. The agent already has the data. If `impl_summary.categories.cli-commands` or `impl_summary.categories.components` is non-empty, that's the trigger; the named paths drive which command to exercise.

### 3.6 What the cycle looks like end-to-end

```
Phase 0  — Bootstrap tmux window (unchanged)
Phase 0a — Plan-coverage candidate extraction (unchanged)
Phase 0b — NEW: build impl_summary from git diff --stat / --name-only
Phase 1  — Targeted run (1b/1c) then full run (1d); falls through to Fix on red
Phase 1c — Diff cross-reference (unchanged; reuses the same diff already read in 0b)
Phase 2  — Live scenario discovery + execution (3a uses tiered rule from §3.3)
Phase 3  — Targeted manual exercise (uses impl_summary from 0b, no new git read)
Fix step — unchanged
Phase 4  — Report (test_render gains ### Test focus prelude per §3.4)
```

Pipeline-level contracts (`test_result`, `test_summary`, `test_render`, `plan_files_touched` JSON outputs) are unchanged. The four outputs continue to feed `tmux_confirm_gate` exactly as today.

## 4. Code anchors

- `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:185-194` — Phase 0a (candidate extraction). New Phase 0b inserted immediately after this section.
- `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:195-204` — Phase 1 (blind `npm test`). Replaced with the 1a/1b/1c/1d structure from §3.2.
- `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:207-222` — Phase 1c (post-test diff cross-reference). Unchanged. Phase 0b will have already read the same diff; the read is cheap enough that we do not pass it through.
- `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:244-254` — Phase 3a (relevance selection). Bullet at `:249` (cross-cutting fallback) replaced with the tiered ladder from §3.3.
- `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:306-313` — Phase 3 (manual exercise). Opening sentence reworked to reuse `impl_summary` per §3.5.
- `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:338-369` — `test_render` template. Gains `### Test focus` prelude between the verdict line and `### Cycles run` per §3.4.
- `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md` — mirror edit. Same five changes applied to the sibling. Structural anchors at `:186-194` (Phase 0a), `:196-206` (Phase 1), `:251` (cross-cutting fallback), `:312-319` (Phase 3), `:339-` (`test_render`).
- `docs/adr/0003-scenario-tests-in-implement-pipeline.md` — referenced as the governing decision for scenario tests; optional one-paragraph addendum noting the tiered fallback (see §5 checklist).

## 5. Blast radius / impact surface

- **Size:** S.
- **Surfaces crossed:**
  - One agent rubric, in two co-edited copies (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md` and `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`).
  - No TypeScript files. No engine, validator, handler, or CLI code is touched.
  - No `.dot` pipeline graph file. No node attributes change. No `outputs:` keys change.
  - No `.apparat/scenarios/` fixture. No new scenario added; existing scenarios continue to be discovered at Phase 2.
- **Breaking changes:** none. `test_render` is a freeform markdown string in the JSON envelope and gains one new section inside that string; the JSON schema validating the envelope checks that the field is a string, not its internal structure. `tmux_confirm_gate` renders `test_render` verbatim today and continues to do so; the new `### Test focus` section appears at the top of the rendered block without code change. `plan_files_touched`, `test_result`, `test_summary` are computed identically. Phase 0b is internal sequencing with no observable side effect outside the cycle.
- **Update checklist:**
  - [ ] `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` — five edits per §4.
  - [ ] `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md` — same five edits, line offsets adjusted.
  - [ ] `docs/adr/0003-scenario-tests-in-implement-pipeline.md` — **optional** addendum paragraph under "Decision" noting that the tester (in the `illumination-to-implementation` family) now tiers its cross-cutting fallback by subtree. ADR-0003 itself governs the bundled `implement` pipeline, not `tmux-tester` directly, so the addendum is documentation polish, not a required edit.
  - [ ] `README.md` — no change. README does not describe Phase 3a internals.
  - [ ] `CONTEXT.md` — no change. `impl_summary` is agent-local working memory, not domain vocabulary.
  - [ ] No `.ts` / `.tsx` source. No `.test.ts(x)` file. No fixture under `.apparat/scenarios/`.

## 6. Open questions

- **Should `impl_summary` graduate to a pipeline output?** Argument for: downstream nodes (notably `commit_push` and any future report node) could reuse it without re-reading the diff. Argument against: `commit_push` does not need a structured summary today and adding an `outputs:` key changes the agent frontmatter contract, which the illumination explicitly scopes out. **Default: keep `impl_summary` as agent-local working memory; promote only when a second consumer needs it.**
- **Does the targeted-test step double the test runtime in the worst case?** The 1b run uses the warmed build from `npm run build && npm test -- <files>`, and the 1d full run skips the build (it is identical to today's single `npm test`). In the common case the narrow run takes 10–30s; the full run is unchanged. Worst case (the targeted set is large and slow) adds the targeted-run duration to the cycle. **Default: accept the worst-case cost; the common-case feedback win dominates. If the worst case becomes a problem, narrow the targeted set to 1 file or gate the step behind `impl_summary.changed_paths.length >= 1`.**
- **Is the tier-1 `core` floor still too broad?** Practical concern: `src/attractor/streaming-formatter.ts` changes affect every scenario, but `src/attractor/core/graph-ast.ts` changes might only affect scenarios that exercise nested clusters. Subdividing `core` could prune further. **Default: keep tier 1 as INCLUDE-all. The illumination explicitly endorses this (`src/attractor/core/` → "include all"). Refinement is a future iteration once the tiered rule has cycle data behind it.**
- **What if Phase 0b's `git diff` reads return empty?** Possible if the implementer node committed nothing (a true no-op pass). `impl_summary` becomes empty, the targeted step skips (per §3.2's "produces zero → skip"), and Phase 3a falls through the entire ladder to per-scenario reasoning with no floor. This is the correct behavior — there is genuinely nothing to scope to — but it also means Phase 1d's full suite still runs. **Default: accepted. An empty diff plus a full-suite green is a meaningful signal (the loop is idling), not a bug to engineer around.**

## 7. Verification targets

- **Validation:** `apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` and the sibling parallel pipeline must continue to pass. `tmux-tester.md` is referenced by the `tmux_tester` node's `agent="…"` attribute; the validator reads the file for frontmatter (`outputs:`, `inputs:`) which this change does not modify. Prose edits do not gate validation.
- **Smoke:** no `.apparat/scenarios/*` covers agent prose. Manual smoke is the verification: run one end-to-end cycle of `illumination-to-implementation` against a small, contained implementation (a 1-file edit) and confirm:
  - `### Test focus` appears as the first `###` heading in the rendered `test_render` at `tmux_confirm_gate`.
  - The targeted `npm test -- <files>` runs before the full `npm test` in the tmux window log.
  - The tiered fallback fires with a category name in the `### Scenarios run` reason rows.
  - `impl_summary` is not surfaced as a JSON output (it is internal to the cycle).
- **No unit-test changes.** `tmux-tester` is `.md` prose; no `.test.ts(x)` file exists for it. The `scenario-inventory` subagent confirmed in the verifier rubric that no test covers this agent's prose.
- **No README or ADR enforcement test.** The optional ADR-0003 addendum, if added, is human-readable polish, not test-enforced.
