# tmux-tester forms a focused test plan before the cycle — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tmux-tester` read the diff before testing, run a targeted 1–3-file test sub-suite first, tier the cross-cutting scenario fallback by subtree, prepend a `### Test focus` prelude to its `test_render`, and reuse the diff-derived `impl_summary` in Phase 3 instead of recomputing it.

**Architecture:** Five sequenced prose edits applied to the agent rubric `tmux-tester.md`, mirrored verbatim across two pipeline folders. No TypeScript change; no schema change; no pipeline frontmatter change. `impl_summary` is agent-local working memory, not a pipeline output.

**Tech Stack:** Markdown agent prose only. Validation via `apparat pipeline validate` on both pipeline.dot files (frontmatter unchanged → must keep passing).

**Source of truth:** `docs/superpowers/specs/2026-05-16-tmux-tester-runs-context-blind-test-battery-design.md`

---

## Files touched by this plan

Both files receive the same five edits. The exact `old_string` / `new_string` differs slightly between them because canonical and parallel sibling have minor whitespace divergence (Phase 3a bullets in parallel have no 3-space indent; `### Plan coverage` and `### Cycles run` in parallel have a blank line before content; `space before "(out of"` differs).

- Canonical: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`
- Parallel sibling: `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`

No exported TypeScript symbols are touched. The two `pipeline.dot` files reference the agent via path string only — no `depends_on` propagation is required across chunks of *this* plan, but **all five chunks edit the same two files**, so `plan_scheduler`'s literal `files_touched` overlap will fire `depends_on` edges between every chunk pair, forcing strict sequential execution. That is the intended behavior — each later edit references `impl_summary` built in Chunk 1, so the order is load-bearing.

---

## Chunk 1: Insert Phase 0b — Implementation understanding

**Files:**
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`
- Modify: `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`

**Goal:** Insert a new `## Phase 0b — Implementation understanding` section between Phase 0a and Phase 1. Establishes the `impl_summary` working-memory artifact that downstream chunks consume.

**Why first:** Chunks 2, 3, and 5 all read `impl_summary`. This chunk creates it. Shipping out-of-order would leave the agent referencing an artifact that doesn't exist.

- [x] **Step 1: Read the canonical file to confirm the anchor is current**

Open `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` with Read and confirm Phase 0a ends with the sentence `Phase 1c will emit \`plan_files_touched=0\`, which the gate disambiguates).` immediately followed by a blank line and `## Phase 1 — Automated verification`.

Expected: anchor present verbatim. If absent, stop and surface the drift — the design's line anchors no longer apply.

- [x] **Step 2: Apply Edit to canonical**

Use the Edit tool on `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`:

`old_string`:

````
Store the matches as the **candidate set** — a list of relative paths the plan claims to touch. Hold this set in working memory; you will diff against it in Phase 1c. If `$plan_writer.plan_path` is empty or unreadable, set the candidate set to `[]` and continue (Phase 1c will emit `plan_files_touched=0`, which the gate disambiguates).

## Phase 1 — Automated verification
````

`new_string`:

````
Store the matches as the **candidate set** — a list of relative paths the plan claims to touch. Hold this set in working memory; you will diff against it in Phase 1c. If `$plan_writer.plan_path` is empty or unreadable, set the candidate set to `[]` and continue (Phase 1c will emit `plan_files_touched=0`, which the gate disambiguates).

## Phase 0b — Implementation understanding

Before any cycle starts, build a compact in-memory record of what the implementer node changed. Run in `$project`:

```bash
git diff --stat $capture_pre_sha.pre_sha HEAD
git diff --name-only $capture_pre_sha.pre_sha HEAD
```

Record an `impl_summary` working-memory artifact with three fields:

- `changed_paths`: the relative paths from `git diff --name-only`.
- `size`: the final summary line from `git diff --stat` (e.g. `3 files changed, 47 insertions(+), 12 deletions(-)`).
- `categories`: a map from category to list-of-paths, derived strictly from path prefixes:
  - `handlers` → `src/attractor/handlers/`
  - `core` → `src/attractor/core/` (validator, graph-ast, engine, deep-loop runner, streaming formatter)
  - `cli-lib` → `src/cli/lib/` excluding `dot/` (which falls under `core`)
  - `cli-commands` → `src/cli/commands/`
  - `components` → `src/cli/components/`
  - `scenarios` → `.apparat/scenarios/`
  - `pipeline-agents` → `.apparat/pipelines/`
  - `tests` → any path matching `**/tests/**` or `*.test.ts(x)`
  - `other` → anything that doesn't match the above

`impl_summary` is agent-local working memory: not a pipeline output (`outputs:` frontmatter is unchanged), not persisted, not surfaced in the JSON envelope. It drives the Phase 1 targeted-test selection, the Phase 3a tiered cross-cutting rule, and the Phase 3 manual-exercise trigger.

If both git diff reads return empty (a true no-op implementation), `impl_summary.changed_paths` is `[]` and `impl_summary.categories` is empty; downstream phases handle this case explicitly (the targeted step skips, the cross-cutting ladder falls through to per-scenario reasoning).

## Phase 1 — Automated verification
````

- [x] **Step 3: Apply the mirrored Edit to the parallel sibling**

Use the Edit tool on `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`. The anchor text is identical to canonical (Phase 0a → Phase 1 transition), so `old_string` and `new_string` are byte-identical to Step 2. Apply the same Edit verbatim.

- [x] **Step 4: Validate both pipelines still parse**

Run from `$project`:

```bash
apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot
apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
```

Expected: both report success. The agent's `outputs:` frontmatter is unchanged, so validation must keep passing. If either fails, the new Phase 0b prose accidentally broke YAML frontmatter parsing — revert and inspect.

- [x] **Step 5: Commit**

```bash
git add .apparat/pipelines/illumination-to-implementation/tmux-tester.md \
        .apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md
git commit -m "feat(tmux-tester): add Phase 0b — build impl_summary from git diff before testing"
```

## Verification targets

- Smokes: None — agent prose has no scenario coverage; `scenario-inventory` subagent confirmed no `.ts` test files cover this agent.
- Manual exercises: `apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` and the parallel sibling pipeline.dot.
- Lint: `npx tsc --noEmit` (sanity — no TS change is expected to affect type checking).
- Surfaces touched: None matching `pipelines/surfaces.json` (agent rubric prose is not a labelled surface).

---

## Chunk 2: Targeted test sub-suite before the full run (Phase 1 restructure)

**Files:**
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`
- Modify: `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`

**Goal:** Replace the blind `npm test` opening of Phase 1 with a four-step structure: 1a derives 1–3 targeted test files from `impl_summary`, 1b runs `npm test -- <files>` with a 60s budget, 1c short-circuits to Fix on red, 1d runs the full `npm test`. Phase 1c (diff cross-reference, existing) stays after the new 1d, unchanged.

**Why second:** Reads `impl_summary` built in Chunk 1.

- [ ] **Step 1: Read and confirm the canonical Phase 1 block is current**

Open canonical with Read and confirm Phase 1 reads:

````
## Phase 1 — Automated verification

1. Send into the window:
   ```
   cd $project && npm run build && npm test
   ```
2. `wait_for_string "Test Files"` with budget `300000ms` (fallback `wait_for_string "Tests"`).
3. `capture`, read `current.txt`.
4. Record pass/fail and the raw counts ("X passed, Y failed, Z total").
````

Expected: anchor present. If absent, stop.

- [ ] **Step 2: Apply Edit to canonical**

Use the Edit tool on `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`:

`old_string`:

````
## Phase 1 — Automated verification

1. Send into the window:
   ```
   cd $project && npm run build && npm test
   ```
2. `wait_for_string "Test Files"` with budget `300000ms` (fallback `wait_for_string "Tests"`).
3. `capture`, read `current.txt`.
4. Record pass/fail and the raw counts ("X passed, Y failed, Z total").

If Phase 1 fails, you MAY skip Phases 2–3 for this cycle and go straight to the **Fix step** — a broken build or red suite means smoke runs are unreliable.
````

`new_string`:

````
## Phase 1 — Automated verification

1a. **Pick the targeted set.** From `impl_summary.changed_paths` (built in Phase 0b), identify 1–3 most relevant test files:
   - For each `src/**/*.{ts,tsx}` path in `changed_paths`, find its co-located test via the project's convention — typically `src/cli/tests/<basename>.test.ts` or a sibling `*.test.tsx`. Use `Glob` to confirm the test file exists; if no test exists for a changed source file, skip that file (do not invent a path).
   - If a changed path IS itself a test file (`**/*.test.ts(x)`), that file IS targeted.
   - Cap the set at 3 files. If reasoning produces more, pick the 3 most directly tied to the changed modules (smallest enclosing scope wins).
   - If reasoning produces zero (e.g. only `.md` or `.dot` files changed), skip 1b/1c and go directly to 1d.

1b. **Run targeted sub-suite.** Send into the window:
   ```
   cd $project && npm run build && npm test -- <targeted-files>
   ```
   `wait_for_string "Test Files"` with budget `60000ms` (fallback `wait_for_string "Tests"`). `capture`, read `current.txt`. Record pass/fail counts for the narrow run.

1c. **Red short-circuit.** If the targeted run is RED → skip to the **Fix step** without waiting for the full suite. The narrow signal is enough — fix the most-specific failure first. Do NOT proceed to 1d in this cycle.

1d. **Full suite.** Send into the window:
   ```
   npm test
   ```
   The build is already warm from 1b, so this is the test re-run only. `wait_for_string "Test Files"` with budget `300000ms` (fallback `wait_for_string "Tests"`). `capture`, read `current.txt`. Record pass/fail and the raw counts ("X passed, Y failed, Z total").

If Phase 1 (any of 1b or 1d) fails, you MAY skip Phases 2–3 for this cycle and go straight to the **Fix step** — a broken build or red suite means smoke runs are unreliable.
````

- [ ] **Step 3: Apply the mirrored Edit to the parallel sibling**

The Phase 1 block in the parallel sibling has identical content. Apply the same `old_string` / `new_string` from Step 2 verbatim to `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`. If Edit fails on `old_string not unique` or `not found`, Read the parallel file at the Phase 1 region and adjust whitespace differences inline before retrying.

- [ ] **Step 4: Validate both pipelines still parse**

```bash
apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot
apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add .apparat/pipelines/illumination-to-implementation/tmux-tester.md \
        .apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md
git commit -m "feat(tmux-tester): run targeted 1–3-file test sub-suite ahead of full npm test"
```

## Verification targets

- Smokes: None.
- Manual exercises: `apparat pipeline validate` on both pipeline.dot files.
- Lint: `npx tsc --noEmit`.
- Surfaces touched: None.

---

## Chunk 3: Tiered cross-cutting fallback in Phase 3a

**Files:**
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`
- Modify: `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`

**Goal:** Replace the single `engine internals → INCLUDE all` cross-cutting fallback bullet in Phase 3a with a tiered first-match-wins ladder driven by `impl_summary.categories`.

**Why third:** Reads `impl_summary.categories` built in Chunk 1. Independent of Chunks 2/4/5.

- [x] **Step 1: Read and confirm the canonical Phase 3a cross-cutting bullet is current**

Open canonical and confirm the bullet at the cross-cutting fallback reads (with 3-space indent — it is a nested bullet inside the Phase 3a numbered item):

```
   - **Cross-cutting fallback.** If the diff touches engine internals (`src/attractor/`, `src/cli/lib/dot/`, the validator, handler dispatch, the deep-loop runner, the streaming formatter) → INCLUDE all. Engine changes hit every scenario; do not try to be clever.
```

Expected: present verbatim. The 3-space indent must match (canonical nests Phase 3a bullets one extra level).

- [x] **Step 2: Apply Edit to canonical**

Use the Edit tool on `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`:

`old_string`:

```
   - **Cross-cutting fallback.** If the diff touches engine internals (`src/attractor/`, `src/cli/lib/dot/`, the validator, handler dispatch, the deep-loop runner, the streaming formatter) → INCLUDE all. Engine changes hit every scenario; do not try to be clever.
```

`new_string`:

```
   - **Cross-cutting fallback (tiered).** Walk the ladder top to bottom against `impl_summary.categories` (built in Phase 0b); the first matching tier defines the INCLUDE floor (other relevance reasoning may add more scenarios on top):
     - `core` touched → INCLUDE all. Engine, validator, graph-ast, deep-loop runner, or streaming-formatter changes hit every scenario.
     - `handlers` touched (and `core` not) → INCLUDE every scenario whose `.dot` declares a node with one of the touched handler kinds (read each candidate's `pipeline.dot` for the `handler="…"` attribute), PLUS one cross-cutting sanity scenario (`static-multi-node` or `conditional`, whichever is present).
     - `cli-lib` touched (and `core`/`handlers` not) → INCLUDE only scenarios whose `pipeline.dot` invokes the specific command whose lib code changed (read each candidate's `.dot` for `apparat <command>` invocations in agent prose or `script_file`).
     - `components` touched (and `core`/`handlers`/`cli-lib` not) → INCLUDE only scenarios that drive TUI interactively (folders containing `gate`, `chat-end-to-end`, or any node with `interactive=true`).
     - None of `core`/`handlers`/`cli-lib`/`components` touched (only `scenarios`/`pipeline-agents`/`tests`/`other`) → no cross-cutting floor; per-scenario relevance reasoning decides INCLUDE/SKIP for each folder.
```

- [x] **Step 3: Apply the mirrored Edit to the parallel sibling**

The parallel sibling indents Phase 3a bullets at **no leading indent** (top-level dash `- `, not `   - `). Use this `old_string` and `new_string` on `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`:

`old_string`:

```
- **Cross-cutting fallback.** If the diff touches engine internals (`src/attractor/`, `src/cli/lib/dot/`, the validator, handler dispatch, the deep-loop runner, the streaming formatter) → INCLUDE all. Engine changes hit every scenario; do not try to be clever.
```

`new_string`:

```
- **Cross-cutting fallback (tiered).** Walk the ladder top to bottom against `impl_summary.categories` (built in Phase 0b); the first matching tier defines the INCLUDE floor (other relevance reasoning may add more scenarios on top):
  - `core` touched → INCLUDE all. Engine, validator, graph-ast, deep-loop runner, or streaming-formatter changes hit every scenario.
  - `handlers` touched (and `core` not) → INCLUDE every scenario whose `.dot` declares a node with one of the touched handler kinds (read each candidate's `pipeline.dot` for the `handler="…"` attribute), PLUS one cross-cutting sanity scenario (`static-multi-node` or `conditional`, whichever is present).
  - `cli-lib` touched (and `core`/`handlers` not) → INCLUDE only scenarios whose `pipeline.dot` invokes the specific command whose lib code changed (read each candidate's `.dot` for `apparat <command>` invocations in agent prose or `script_file`).
  - `components` touched (and `core`/`handlers`/`cli-lib` not) → INCLUDE only scenarios that drive TUI interactively (folders containing `gate`, `chat-end-to-end`, or any node with `interactive=true`).
  - None of `core`/`handlers`/`cli-lib`/`components` touched (only `scenarios`/`pipeline-agents`/`tests`/`other`) → no cross-cutting floor; per-scenario relevance reasoning decides INCLUDE/SKIP for each folder.
```

- [x] **Step 4: Validate both pipelines**

```bash
apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot
apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
```

Expected: both pass.

- [x] **Step 5: Commit**

```bash
git add .apparat/pipelines/illumination-to-implementation/tmux-tester.md \
        .apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md
git commit -m "feat(tmux-tester): tier Phase 3a cross-cutting fallback by impl_summary category"
```

## Verification targets

- Smokes: None.
- Manual exercises: `apparat pipeline validate` on both pipeline.dot files.
- Lint: `npx tsc --noEmit`.
- Surfaces touched: None.

---

## Chunk 4: `### Test focus` prelude in `test_render`

**Files:**
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`
- Modify: `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`

**Goal:** Insert a `### Test focus` section as the first `###` heading inside the `test_render` template, between the `<one-line summary sentence matching test_summary>` line and `### Cycles run`. The template lives inside the Phase 4 bullet under `test_render`, so the content is indented with 2 leading spaces.

**Why fourth:** The prelude content depends on `impl_summary` (Chunk 1) and on the tiered fallback's "dominant tier" label (Chunk 3). Independent of Chunks 2/5.

- [x] **Step 1: Read and confirm the canonical test_render anchor**

Open canonical and confirm the test_render template includes this exact transition (note the 2-space indent — the template is nested inside the `- \`test_render\`:` bullet):

```
  <one-line summary sentence matching test_summary>

  ### Cycles run
```

Expected: present verbatim. Confirm the 2-space leading indent.

- [x] **Step 2: Apply Edit to canonical**

Use the Edit tool on `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`:

`old_string`:

```
  <one-line summary sentence matching test_summary>

  ### Cycles run
```

`new_string`:

```
  <one-line summary sentence matching test_summary>

  ### Test focus
  Changed: <comma-separated impl_summary.changed_paths, truncated to first 5 + "…N more" if longer>
  Targeted: <comma-separated test files run in Phase 1b, or "none — no source files changed">
  Scenarios: <one-line roll-up — "I included, S skipped (reason: <dominant tier name from Phase 3a ladder, or "per-scenario">)">

  ### Cycles run
```

- [x] **Step 3: Apply mirrored Edit to parallel sibling**

The parallel sibling has the **same** 2-space indent on the test_render template AND has a blank line between `### Cycles run` and the following `1. <...>` numbered item. The `<one-line summary sentence matching test_summary>` → `### Cycles run` transition is byte-identical to canonical. Apply the same `old_string` and `new_string` from Step 2 verbatim. If Edit reports `old_string not unique` or `not found`, Read the parallel file's test_render block and reconcile whitespace before retrying.

- [x] **Step 4: Validate both pipelines**

```bash
apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot
apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
```

Expected: both pass. The test_render schema is `string` — adding a new `###` section inside the string never affects JSON-envelope validation.

- [x] **Step 5: Commit**

```bash
git add .apparat/pipelines/illumination-to-implementation/tmux-tester.md \
        .apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md
git commit -m "feat(tmux-tester): prepend ### Test focus to test_render for 5-second audit at tmux_confirm_gate"
```

## Verification targets

- Smokes: None.
- Manual exercises: `apparat pipeline validate` on both pipeline.dot files.
- Lint: `npx tsc --noEmit`.
- Surfaces touched: None.

---

## Chunk 5: Phase 3 reuses `impl_summary` instead of re-reading git

**Files:**
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`
- Modify: `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`

**Goal:** Replace the runtime `git log -1 --stat` / `git diff HEAD~1 HEAD --stat` reads in Phase 3 with a reuse of `impl_summary` already built in Phase 0b. Phase 3's budget ("max 2 commands, 60s each per cycle") is unchanged.

**Why fifth:** Reads `impl_summary` (Chunk 1). Independent of Chunks 2/3/4.

- [x] **Step 1: Read and confirm the canonical Phase 3 opener**

Open canonical and confirm Phase 3 opens with the sentence:

```
If the implementation node's diff touched a specific command (check `git log -1 --stat` and `git diff HEAD~1 HEAD --stat`), exercise that command interactively when practical:
```

Expected: present verbatim.

- [x] **Step 2: Apply Edit to canonical**

Use the Edit tool on `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`:

`old_string`:

```
If the implementation node's diff touched a specific command (check `git log -1 --stat` and `git diff HEAD~1 HEAD --stat`), exercise that command interactively when practical:
```

`new_string`:

```
Using `impl_summary` (built in Phase 0b), check whether the diff touched a specific command — i.e. any path under `src/cli/commands/` (`impl_summary.categories.cli-commands` non-empty) or any TUI component reachable from one (`impl_summary.categories.components` non-empty). If yes, exercise that command interactively when practical:
```

- [x] **Step 3: Apply mirrored Edit to parallel sibling**

The parallel sibling has the same Phase 3 opener verbatim. Apply the same `old_string` / `new_string` from Step 2 to `.apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md`.

- [x] **Step 4: Validate both pipelines**

```bash
apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot
apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
```

Expected: both pass.

- [x] **Step 5: End-to-end smoke (optional, recommended)**

Per the design's §7 verification targets, the only meaningful smoke is one cycle of `illumination-to-implementation` against a small contained implementation. If a recent illumination is available locally, drive one end-to-end cycle and confirm:

- `### Test focus` appears as the first `###` heading in the rendered `test_render` at `tmux_confirm_gate`.
- The targeted `npm test -- <files>` runs before the full `npm test` in the tmux window log.
- The tiered fallback fires with a category name in the `### Scenarios run` reason rows.
- `impl_summary` is not surfaced as a JSON output (it remains internal to the cycle).

If no recent illumination is available, skip this step — none of the chunks introduce code paths a unit test can exercise; the agent prose is the contract.

- [x] **Step 6: Commit**

```bash
git add .apparat/pipelines/illumination-to-implementation/tmux-tester.md \
        .apparat/pipelines/parallel-illumination-to-implementation/tmux-tester.md
git commit -m "feat(tmux-tester): reuse impl_summary in Phase 3 instead of re-reading git log"
```

## Verification targets

- Smokes: None.
- Manual exercises: `apparat pipeline validate` on both pipeline.dot files. Optional: one end-to-end cycle of the canonical pipeline against a small recent illumination.
- Lint: `npx tsc --noEmit`.
- Surfaces touched: None.

---

## Open questions

(Carried verbatim from design §6 for the executing session; none block implementation.)

- **Should `impl_summary` graduate to a pipeline output?** Default: keep as agent-local working memory; promote only when a second consumer needs it.
- **Worst-case targeted-test duplicate-runtime cost.** Default: accept the worst case; if it becomes a problem, narrow to 1 file or gate behind `impl_summary.changed_paths.length >= 1`.
- **Is tier-1 `core` floor still too broad?** Default: keep INCLUDE-all; refine once cycle data exists.
- **What if Phase 0b's git diff returns empty?** Default: accepted no-op; the empty `impl_summary` flows through the explicit handling in Chunks 2/3.

## Optional follow-up (not part of this plan)

The design's update checklist (§5) marks ADR-0003 (`docs/adr/0003-scenario-tests-in-implement-pipeline.md`) as an **optional** addendum paragraph noting the tiered fallback. ADR-0003 governs the bundled `implement` pipeline rather than `tmux-tester` directly, so the addendum is documentation polish, not a required edit. It is intentionally **out of scope** for the five chunks above.
