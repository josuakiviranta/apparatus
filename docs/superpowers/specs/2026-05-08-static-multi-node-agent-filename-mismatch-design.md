# Design: fix `static-multi-node` slug mismatch + replace bundled smoke shells with a live scenario-discovery phase in `tmux-tester`

**Date:** 2026-05-08
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-08T2301-static-multi-node-agent-filename-mismatch.md`

## 1. Motivation

The bundled `static-multi-node` scenario ships broken. `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot --project .` aborts during agent resolution because `pipeline.dot` declares `agent="node_a"` (DOT identifier syntax forbids bare hyphens) while the sibling agent files on disk are hyphenated:

- `.apparat/scenarios/static-multi-node/pipeline.dot:6` — `node_a [agent="node_a"]`
- `.apparat/scenarios/static-multi-node/pipeline.dot:8` — `node_b [agent="node_b"]`
- `.apparat/scenarios/static-multi-node/pipeline.dot:10` — `node_c [agent="node_c"]`
- siblings on disk: `node-a.md`, `node-b.md`, `node-c.md`

`loadAgent` resolves an `agent="X"` attribute to `<pipelineDir>/<X>.md` verbatim:

```ts
// src/cli/lib/agent-loader.ts:29-39
export function loadAgent(name, pipelineDir) {
  const path = join(pipelineDir, `${name}.md`);
  if (!existsSync(path)) {
    throw new Error(`Agent file not found: ${path}`);
  }
  …
}
```

There is no hyphen↔underscore tolerance. The scenario was authored hyphenated, the DOT parser forced underscores in the ids, and the two surfaces silently desynced.

The breakage went unnoticed because the existing smoke test for this scenario — `src/cli/tests/pipeline-smoke-static-multi-node-folder.test.ts` — does **structural file-existence + `validateGraph()` only**. It never invokes `apparat pipeline run`. Fifteen sibling tests at `src/cli/tests/pipeline-smoke-*-folder.test.ts` follow the same shape:

```
agent-implement, agent-json-vars, chat-end-to-end, chat-only, conditional,
gate, implement-noop, json-schema-stream, meditate-steer, missing-caller-var,
static-multi-node, store, tmux-tester, tool, tool-runtime-vars
```

(Verifier's smoke-tests subagent counted 15; the chat refinement said 14. The design pins the count at 15 — `ls src/cli/tests/pipeline-smoke-*-folder.test.ts | wc -l` is the source of truth at write time.)

These structural checks pass on `static-multi-node` today even though the scenario is unrunnable. They are coverage theatre: each one confirms the scenario folder has the expected file shape and that the graph validates, neither of which catches an agent-attribute drift caught only at runtime.

`src/cli/tests/bundled-pipelines-self-sufficient.test.ts` is the lone existing test that drives `apparat pipeline run` end-to-end (53 LOC; aimed at the bundled tier under `src/cli/pipelines/`, not `.apparat/scenarios/`). It is the precedent for live execution as a verification surface.

The fix is two-pronged:

1. **Rename the three siblings in `static-multi-node/`** (verifier's option A) so the scenario becomes runnable. No resolver/validator changes — the bug is a slug, not a contract gap.
2. **Replace the 15 structural smoke tests with a live scenario-discovery phase inside the `tmux-tester` node** of the `illumination-to-implementation` pipeline. Every implementation cycle drives `apparat pipeline run` against every `.apparat/scenarios/*/pipeline.dot`, with the agent impersonating the human via the existing `send_input` harness for interactive scenarios. Failures feed the existing red/green TDD loop; passes feed `test_summary` / `test_render`.

The chat refinement deliberately dropped verifier's options B (resolver hyphen↔underscore normalization) and C (validator diagnostic for missing sibling agent file). Live runtime verification is the only signal that catches this class of drift; preflight tolerance would mask similar bugs the next time around.

## 2. Decision summary

1. **Rename the three sibling files in `.apparat/scenarios/static-multi-node/`**: `node-a.md` → `node_a.md`, `node-b.md` → `node_b.md`, `node-c.md` → `node_c.md`. No `.dot` change; no other file change. One commit.

2. **Delete the 15 `src/cli/tests/pipeline-smoke-*-folder.test.ts` files** in their entirety. The structural+`validateGraph()` shape they share is superseded by live execution.

3. **Extend `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` with a Phase 2 contract** that discovers `.apparat/scenarios/*/pipeline.dot` at runtime and drives each through `apparat pipeline run` in the existing `test-$run_id` tmux window. Re-uses the existing `send_input` / `wait_stable` / `wait_for_string` / `capture` harness primitives — no new infra. The agent plays the human for any prompt that appears (chat, gate, meditate-steer). No skiplist, no interactive-vs-non-interactive split.

4. **Reconcile `.apparat/scenarios/tmux-tester/`**: today the folder ships a `pipeline.dot` whose only meaningful node is `tmux_meditate_observer [agent="meditate-observer"]` — it is a *meditate observer smoke*, not a copy of the `tmux-tester` agent inside `illumination-to-implementation/`. The folder is misnamed. Decision: rename the scenario folder to `meditate-observer/` and rename the agent file `tmux-tester.md` inside it to match the node id (`tmux_meditate_observer.md`) so the new live discovery loop a) does not recurse into a duplicate of itself and b) does not stop at a name-collision red herring. Keep `meditate-observer.md` (the agent) inside the renamed folder.

5. **Hard-skip rule in `tmux-tester` Phase 2**: the live discovery loop never runs scenarios whose folder contains `tmux-tester.md` or whose folder name resolves to `tmux-tester` — defensive guard for future folders, not for today's tree. Today, after step 4, no scenario folder owns either name.

6. **Convention recommendation surfaced at `review_gate`**: the design **recommends** authors keep DOT node ids and sibling agent file slugs identical, both underscored. Rationale: DOT parsers reject bare hyphens, so any hyphenated id forces an underscore-id-with-hyphenated-file split that desyncs silently. The recommendation is a pointer surfaced to the reviewer; it is **not** pinned in `CONTEXT.md` / `src/cli/skills/apparatus/pipelines.md` in this design (the user explicitly deferred that decision in chat round 1). The reviewer at `review_gate` may ask the implementing session to add the pin or to leave the recommendation oral; the design preserves the option without committing to it.

7. **Atomic landing.** One commit (or one PR) lands all six items. Splitting would create an intermediate state where either the renamed scenario is unreachable from the new tmux-tester loop (steps 1+3 without step 4) or the loop discovers but cannot execute scenarios (step 3 without step 1).

## 3. Architecture

### 3.1 Before / after

```
Before (today)                                  After
──────                                          ─────
.apparat/scenarios/static-multi-node/           .apparat/scenarios/static-multi-node/
  pipeline.dot     agent="node_a" …               pipeline.dot     agent="node_a" …    (unchanged)
  node-a.md                                       node_a.md        ← renamed
  node-b.md                                       node_b.md        ← renamed
  node-c.md                                       node_c.md        ← renamed

  apparat pipeline run …/static-multi-node       apparat pipeline run …/static-multi-node
    → loadAgent("node_a", scenarioDir)             → loadAgent("node_a", scenarioDir)
    → existsSync(node_a.md) === false              → existsSync(node_a.md) === true
    → throw "Agent file not found"                 → run completes

.apparat/scenarios/tmux-tester/                 .apparat/scenarios/meditate-observer/   ← renamed folder
  tmux-tester.md   (= meditate-observer)          meditate-observer.md (unchanged content)
  meditate-observer.md                            tmux_meditate_observer.md           ← renamed file
  pipeline.dot                                    pipeline.dot                          (unchanged)

src/cli/tests/pipeline-smoke-*-folder.test.ts   src/cli/tests/pipeline-smoke-*-folder.test.ts
  15 files, structural file-existence +           (deleted — all 15)
  validateGraph() only; no live run

.apparat/pipelines/illumination-to-              .apparat/pipelines/illumination-to-
  implementation/tmux-tester.md Phase 2:           implementation/tmux-tester.md Phase 2:
  generic "additional verification per node        Discovery + live execution of every
  prompt" — no scenarios discovery loop            .apparat/scenarios/*/pipeline.dot
                                                   in the tmux window, agent plays human
                                                   for interactive prompts
```

### 3.2 Rename: `.apparat/scenarios/static-multi-node/`

Three `git mv` operations:

| Before | After |
|---|---|
| `.apparat/scenarios/static-multi-node/node-a.md` | `.apparat/scenarios/static-multi-node/node_a.md` |
| `.apparat/scenarios/static-multi-node/node-b.md` | `.apparat/scenarios/static-multi-node/node_b.md` |
| `.apparat/scenarios/static-multi-node/node-c.md` | `.apparat/scenarios/static-multi-node/node_c.md` |

No content change in any of the three files. `pipeline.dot:6,8,10` already reference `node_a`, `node_b`, `node_c` by id-and-agent-attribute so the rename brings the file slugs into agreement with the DOT ids.

`loadAgent`'s join (`agent-loader.ts:33`) becomes a hit on the first try.

### 3.3 Rename + reconcile: `.apparat/scenarios/tmux-tester/` → `.apparat/scenarios/meditate-observer/`

Today the folder ships:

- `pipeline.dot` — single agent node `tmux_meditate_observer [agent="meditate-observer"]` (`.apparat/scenarios/tmux-tester/pipeline.dot:9`); window name pattern is `pipe-tmux-tester-inner-$run_id`.
- `meditate-observer.md` — outputs `topic`, `illumination_path`, `kid_summary`, `observation_notes` (`.apparat/scenarios/tmux-tester/meditate-observer.md:15-19`); drives `apparat meditate` inside the window and summarises the resulting illumination.
- `tmux-tester.md` — same outputs as `meditate-observer.md` (`.apparat/scenarios/tmux-tester/tmux-tester.md:18-23`: `topic`, `illumination_path`, `kid_summary`, `observation_notes`), unrelated to the actual `tmux-tester` agent at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` whose outputs are `test_result`, `test_summary`, `test_render`, `plan_files_touched` (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:15-19`). The two are not the same node — they share a name and nothing else.

The folder is a **meditate-observer scenario** misnamed for historical reasons. The fix is structural:

| Before | After |
|---|---|
| folder `.apparat/scenarios/tmux-tester/` | folder `.apparat/scenarios/meditate-observer/` |
| `pipeline.dot` (unchanged) | `pipeline.dot` (unchanged) |
| `meditate-observer.md` | `meditate-observer.md` (unchanged content; needed by `agent="meditate-observer"`) |
| `tmux-tester.md` | `tmux_meditate_observer.md` (renamed to match the node id at `pipeline.dot:9`) |

Rationale per chat round 1 ("Well remove tmux-tester from scenarios if that really is the same thing as tmux tester node"): the user asked for verification before action, conditional on actual equivalence. They are *not* equivalent — but the scenario folder *is* misnamed and the duplicate `tmux-tester.md` agent file inside it is dead code (the `pipeline.dot` references `meditate-observer`, not `tmux-tester`). Renaming the folder + dropping the dead duplicate clears the recursion ambiguity without losing any live behaviour.

Window name `pipe-tmux-tester-inner-$run_id` (`.apparat/scenarios/tmux-tester/pipeline.dot:7,9`) stays as-is. It is internal to the scenario; renaming it would force a coordinated change in `meditate-observer.md` for no observable gain.

### 3.4 Extended Phase 2 contract in `tmux-tester` (illumination-to-implementation)

Today's Phase 2 in `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:223-246` reads:

> "After Phase 1 (build + test) is GREEN, drive every scenario pipeline through `apparat pipeline run` in the tmux window — unconditionally, no diff filtering, no skipping, cost is acceptable."

It instructs the agent to `ls $project/.apparat/scenarios/*/pipeline.dot`, validate-then-run each, and `wait_stable` / `capture` between runs. **The scaffolding is already there.** What is missing — and what this design adds — is the explicit contract for:

1. **Self-skip rule**: the discovery loop must skip any scenario folder named `tmux-tester` or any folder containing a `tmux-tester.md` file. Defensive against future drift; today the rename in section 3.3 means no folder triggers the skip.
2. **Agent-as-human for interactive scenarios**: when a scenario opens an interactive surface (chat, gate, meditate-steer, approval prompt), the agent uses `send_input` (`docs/harness/tmux-drive.md:201-212` — `tmux send-keys -l` + `Enter` + `wait_stable` guards) to feed plausible answers. No skiplist; full coverage by impersonation.
3. **Aggregation contract for existing outputs**: the existing `test_result` / `test_summary` / `test_render` outputs absorb scenario-level pass/fail without contract change. Specifically:
   - `test_result` flips to `"fail"` if any scenario crashes, exits ≠ 0, hangs past the `wait_stable 180000` budget, surfaces a `TypeError` / `ReferenceError` / unhandled rejection, or shows a TUI glitch (per the existing observation criteria at `tmux-tester.md:238-244`).
   - `test_summary` includes a one-line scenario-coverage roll-up: `"N scenarios discovered, N passed, K failed"`.
   - `test_render` gains a `### Scenarios run` section under `### Cycles run`, listing each scenario with verdict and a one-line headline. The existing `### Remaining issues` section absorbs scenario failures that the agent could not fix in-cycle.
4. **No deletion of the existing Plan-coverage / Phase 1c logic.** Scenario discovery is purely additive; `plan_files_touched` continues to count diffs against `$plan_writer.plan_path`.

The contract change is in the prose of `tmux-tester.md`. No frontmatter change to `inputs:` / `outputs:` / `tools:` — `Bash` is already present, `apparat` is invoked via `send_input`, and the existing four outputs absorb the new aggregation per item 3.

### 3.5 Explicit Phase 2 procedure (added to the contract)

The Phase 2 prose in `tmux-tester.md` gets replaced with:

```
## Phase 2 — Live scenario discovery + execution

After Phase 1 (build + test) is GREEN, discover every bundled scenario and drive
each through `apparat pipeline run` in the tmux window.

1. In your shell (not the tmux window), run:
     ls -d $project/.apparat/scenarios/*/

2. For each folder:
   a. Skip if folder basename === "tmux-tester" OR folder contains
      `tmux-tester.md` (self-skip; prevents recursion).
   b. Validate first: `apparat pipeline validate <folder>/pipeline.dot`. If
      validate fails, that IS the issue — capture the output, treat as a
      Phase 2 failure, do NOT attempt to run.
   c. If validate passes, read the `.dot` header for required `--var` keys,
      then send into the window:
        apparat pipeline run <folder>/pipeline.dot --var <required-vars>
   d. Use `wait_stable 180000` between drives. After every `wait_stable`,
      `capture` the pane and read `current.txt` to apply the observation
      criteria (crashes, exit ≠ 0, hangs, TUI glitches, copy regressions).
   e. If the scenario opens an interactive surface (gate, chat, steer
      prompt), feed plausible answers via `send_input "<answer>"`. No
      skiplist; every interactive scenario is exercised. Plausible means:
      gate choices → first non-Decline option; chat/steer → "looks good"
      style continuation; meditate-steer → a one-line topic.

3. After every scenario completes (success or fail), append one row to the
   in-progress test_render `### Scenarios run` section:
     - <scenario-name>: PASS  (run took Ns)
     - <scenario-name>: FAIL  (symptom — first error line from current.txt)

4. test_result flips to "fail" the moment any scenario surfaces a crash,
   exit ≠ 0, hang, or TUI glitch. Failed scenarios feed the Fix step like
   any other Phase issue.
```

This is the only Phase-2-shaped block in the agent contract; today's "Phase 2 — Scenario pipelines" block (`tmux-tester.md:223-246`) collapses into the structure above without losing any behavior.

### 3.6 Why the structural smokes can be deleted (not migrated)

Each of the 15 `pipeline-smoke-*-folder.test.ts` files asserts:

- the scenario folder exists (`existsSync`),
- the expected agent `.md` files are present,
- `parseDot` parses the `.dot`,
- `validateGraph` passes.

Live execution under `apparat pipeline run` exercises every assertion above plus the entire runtime stack (CLI parsing, daemon plumbing, agent invocation, TUI render, exit handling, agent rubric). The structural shape adds zero coverage on top of the live shape — it only adds two failure modes the live shape lacks: (a) a scenario can pass the structural shape while being unrunnable (the `static-multi-node` bug), and (b) the structural shape locks in a file layout that scenario-authors may want to evolve.

Deleting them — rather than migrating each to drive `apparat pipeline run` directly inside vitest — keeps the unit-test suite fast and concentrates live execution in one orchestrator (the `tmux-tester` node) where the tmux harness already lives. `bundled-pipelines-self-sufficient.test.ts` (53 LOC at `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`) remains as the live-run complement covering the bundled tier under `src/cli/pipelines/`; the deletion does not touch it.

### 3.7 Surfaces unchanged

- `agent-loader.ts:29-39` `loadAgent`. Byte-identical.
- `pipeline-resolver.ts` — no slug-normalization shim.
- `pipeline-validator*` — no new diagnostic rule. The `graph-validator-byte-identical` snapshot remains undisturbed.
- DOT schema. Unchanged.
- `inputs:` / `outputs:` / `tools:` of `tmux-tester.md`. Unchanged.
- `tmux_confirm_gate.md` consumers (`tmux_tester.test_result`, `tmux_tester.test_render`, `tmux_tester.plan_files_touched`). Unchanged contract — the fields absorb scenario aggregation without shape change.
- `bundled-pipelines-self-sufficient.test.ts`. Untouched by this design.

## 4. Components & files

### 4.1 Renames

| From | To |
|---|---|
| `.apparat/scenarios/static-multi-node/node-a.md` | `.apparat/scenarios/static-multi-node/node_a.md` |
| `.apparat/scenarios/static-multi-node/node-b.md` | `.apparat/scenarios/static-multi-node/node_b.md` |
| `.apparat/scenarios/static-multi-node/node-c.md` | `.apparat/scenarios/static-multi-node/node_c.md` |
| `.apparat/scenarios/tmux-tester/` (folder) | `.apparat/scenarios/meditate-observer/` |
| `.apparat/scenarios/tmux-tester/tmux-tester.md` | (deleted; dead duplicate — see 4.2) |
| `.apparat/scenarios/tmux-tester/meditate-observer.md` | `.apparat/scenarios/meditate-observer/meditate-observer.md` (just the folder rename moves it) |
| `.apparat/scenarios/tmux-tester/pipeline.dot` | `.apparat/scenarios/meditate-observer/pipeline.dot` (folder rename) |
| `.apparat/scenarios/meditate-observer/tmux-tester.md` | (intermediate of the folder rename — does not appear in the final tree; see 4.2 deletion) |

### 4.2 Deletions

| File | Reason |
|---|---|
| `.apparat/scenarios/meditate-observer/tmux-tester.md` (post-folder-rename path) | Dead duplicate of `meditate-observer.md` agent; never referenced by any `pipeline.dot` after the rename. |
| `src/cli/tests/pipeline-smoke-agent-implement-folder.test.ts` | Structural shape superseded by live execution. |
| `src/cli/tests/pipeline-smoke-agent-json-vars-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-chat-end-to-end-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-chat-only-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-conditional-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-gate-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-json-schema-stream-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-missing-caller-var-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-static-multi-node-folder.test.ts` | (same — the file that passed while the scenario was unrunnable) |
| `src/cli/tests/pipeline-smoke-store-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-tool-folder.test.ts` | (same) |
| `src/cli/tests/pipeline-smoke-tool-runtime-vars-folder.test.ts` | (same) |

15 smoke deletions. The chat refinement said "14"; verifier's smoke-tests subagent counted 15. The 15-file list above is the source-of-truth derived from `ls src/cli/tests/pipeline-smoke-*-folder.test.ts`.

### 4.3 Inline edit

| File | Edit |
|---|---|
| `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` | Replace the existing Phase 2 block (`:223-246`) with the explicit procedure in §3.5; add `### Scenarios run` to the `test_render` template under `### Cycles run` (the markdown template at `:286-303`); leave frontmatter, harness, Phase 0 / 0a / 1 / 1c / 3 / Fix step / Phase 4 untouched. |

### 4.4 New code

None.

### 4.5 Test ripples

| Surface | Treatment |
|---|---|
| `bundled-pipelines-self-sufficient.test.ts` | No change. Already drives live execution against `src/cli/pipelines/` (different tier from `.apparat/scenarios/`). |
| `agent-loader.test.ts` (if present) | No change — `loadAgent` semantics unchanged. |
| Any test that grep-asserts on `.apparat/scenarios/tmux-tester/` | Audit for the folder rename (`tmux-tester` → `meditate-observer`). Likely zero hits because the smoke tests are deleted; the implementing session should `grep -r "scenarios/tmux-tester"` post-rename to confirm. |

## 5. Data flow

### 5.1 `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot`

```
parseDot(pipeline.dot)
  → graph with nodes node_a/node_b/node_c, agent="node_a"/"node_b"/"node_c"
agent invocation for node_a
  → loadAgent("node_a", ".apparat/scenarios/static-multi-node/")
    → existsSync(".apparat/scenarios/static-multi-node/node_a.md") === true   (post-rename)
    → parseAgentFile + extractAgentMetadata
    → return AgentConfig
runtime executes node_a with the resolved agent
(repeat for node_b, node_c)
exit 0
```

Today the resolver step throws at the `existsSync` check and aborts.

### 5.2 `tmux-tester` Phase 2 — live scenario discovery + execution

```
$tmux-tester (illumination-to-implementation)
  Phase 1: cd $project && npm run build && npm test → GREEN
  Phase 1c: count plan_files_touched against $plan_writer.plan_path
  Phase 2:
    folders = ls -d $project/.apparat/scenarios/*/
    for folder in folders:
      basename = $(basename folder)
      if basename == "tmux-tester" or test -f folder/tmux-tester.md:
        continue                                    ← self-skip
      apparat pipeline validate folder/pipeline.dot
      if validate failed:
        record FAIL into test_render, continue
      vars = parse-required-vars(folder/pipeline.dot)
      send_input "apparat pipeline run folder/pipeline.dot --var $vars"
      loop:
        wait_stable 180000
        capture
        observe current.txt
        if interactive prompt detected:
          send_input "<plausible answer>"
          continue loop
        if exit detected (clean or crash) or hang:
          break
      record verdict into test_render
  Phase 3: targeted manual exercise (unchanged)
  Fix step: red/green TDD on every surfaced issue (unchanged)
  Phase 4: emit test_result + test_summary + test_render + plan_files_touched
```

`tmux_confirm_gate` reads the four-field output exactly as today (`.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md:6-21`).

### 5.3 Self-skip safety

Self-skip is a defensive guard. After §3.3's rename, the discovery loop's `ls -d $project/.apparat/scenarios/*/` enumerates `meditate-observer/` and not `tmux-tester/`. The skip rule fires only if some future scenario authoring re-introduces a `tmux-tester` folder name or drops a `tmux-tester.md` file into a scenario folder. Either case would otherwise cause the agent to `apparat pipeline run` itself (recursion).

## 6. Blast radius / impact surface

- **Size:** **M** by file count (≈22), **S** by surface count.
- **Files touched (enumerated):**
  - **Renames:** 3 files in `.apparat/scenarios/static-multi-node/` (node-a/b/c.md → node_a/b/c.md); 1 folder rename in `.apparat/scenarios/` (`tmux-tester/` → `meditate-observer/`, carrying 3 files).
  - **Deletions:** 1 dead duplicate (`tmux-tester.md` inside the renamed folder); 15 `src/cli/tests/pipeline-smoke-*-folder.test.ts` files.
  - **Edits:** 1 — `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` (Phase 2 prose + `test_render` template).
  - **Total:** 3 renames + 1 folder rename (covering 3 files) + 16 deletions + 1 edit ≈ 22 files touched.
- **Surfaces crossed:**
  - **Scenarios folder** — three slug renames + one folder rename + one dead-file deletion.
  - **Bundled smoke-test suite** — 15 file deletions; coverage shifts from structural-at-build to live-at-run.
  - **`illumination-to-implementation` agent contract** — Phase 2 prose + `test_render` template gain a scenario-discovery section; `inputs:` / `outputs:` / `tools:` frontmatter unchanged.
- **Breaking changes (named):**
  - **No public-contract break.** `agent-loader.ts:29-39` `loadAgent` unchanged. `pipeline-resolver.ts` unchanged. `pipeline-validator*` unchanged. `graph-validator-byte-identical` snapshot undisturbed. CLI surfaces unchanged.
  - **Test-suite shape break (internal).** 15 smoke files removed. Anything that imports from the deleted files breaks; expected hit count is zero (each smoke is self-contained), but the implementing session must run `grep -r "pipeline-smoke-.*-folder" src/` post-deletion to confirm.
  - **Scenario folder rename.** Anything that hard-codes `.apparat/scenarios/tmux-tester/` as a path breaks. Expected hit count is zero outside the smoke tests being deleted; the implementing session must grep to confirm.
- **Spec / docs ripple checklist:**
  - [ ] `CONTEXT.md` — convention pin (`agent="X"` slug ≡ sibling `X.md` slug, both underscored). **Deferred** per chat round 1; the design surfaces this as a recommendation at `review_gate` for the reviewer to accept or punt.
  - [ ] `src/cli/skills/apparatus/pipelines.md` — same deferred pin; same `review_gate` choice.
  - [ ] `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` — Phase 2 prose + `test_render` template (the inline edit in 4.3).
  - [ ] No ADR required. The bundled-tier two-tier resolver model (ADR-0007/0008) is untouched; this design is a slug fix + a verification-strategy migration.
  - [ ] No README edit required. README does not enumerate scenarios.
- **Test ripple checklist:**
  - [ ] Delete the 15 `pipeline-smoke-*-folder.test.ts` files (full list in 4.2).
  - [ ] Post-deletion, `grep -r "pipeline-smoke-.*-folder" src/` returns zero hits (no orphan imports).
  - [ ] Post-rename, `grep -r "scenarios/tmux-tester" src/ docs/ .apparat/` returns zero hits (no path drift). If hits remain, edit them in the same PR.
  - [ ] `npx vitest run` passes — the suite shrinks; nothing red.
  - [ ] `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot --project .` exits 0.
  - [ ] `apparat pipeline run .apparat/scenarios/meditate-observer/pipeline.dot --project .` exits 0 (sanity check on the rename).

## 7. Trade-offs

### 7.1 Rename now vs. let `tmux-tester` catch and fix

Rename now (chat round 1, "(a)"). Reasons:

- The new `tmux-tester` Phase 2 needs *runnable* scenarios on first iteration; relying on the loop to self-heal at first run is fragile (a failure surface in the loop itself would block discovery).
- The rename is one commit, no code change. Lower risk than a wait-and-see.
- Symmetry: the design ships the rename, the contract change, and the smoke deletions atomically; staging the rename behind the loop's first run leaves an interim state where `static-multi-node` is still red.

### 7.2 Drop verifier's options B (resolver normalization) and C (validator diagnostic)

Drop both (chat round 1, combination of "(a)" + "tmux-tester node should... run those"). Reasons:

- Live runtime execution catches every drift the resolver/validator would catch, plus drift those two surfaces would miss (e.g. correct slug, wrong agent body, broken tool wiring, runtime crash on first execution).
- A normalizing resolver makes the same class of bug *quieter* the next time around: authors get away with hyphen/underscore desync because the resolver hides it. The user explicitly framed this as a foot-gun; preflight tolerance perpetuates it.
- A validator diagnostic adds noise without a runtime guarantee. The actual signal that matters is "does it run?" — the only honest test is to run it.
- Keeping `agent-loader.ts:29-39` and the validator byte-identical preserves the `graph-validator-byte-identical` snapshot test and avoids a rebaseline.

### 7.3 Delete structural smokes vs. migrate them to live runs in vitest

Delete (chat round 1, "there should not be bundled scenario tests"). Reasons:

- Migrating to vitest would force vitest to spawn `apparat pipeline run` per scenario per test run — the harness already exists in the `tmux-tester` node and is built for live execution; reimplementing it inside vitest duplicates infrastructure.
- Vitest is the unit/integration tier; the `tmux-tester` node is the live-orchestration tier. Live execution belongs at the orchestration tier where the tmux harness, agent-as-human, and red/green fix loop already live.
- Coverage actually improves: the orchestrator runs every scenario every cycle (per the existing Phase 2 instruction `unconditionally, no diff filtering, no skipping`), whereas the deleted smokes ran only when their specific file changed.

### 7.4 Agent-as-human via `send_input` vs. a non-interactive carve-out

Agent plays human (chat round 1, "Agent should be able to play human in these scenario tests. Shouldn't it?"). Reasons:

- Carving out interactive scenarios from coverage leaves the gate/chat/steer surfaces silently untested.
- `send_input` already exists (`docs/harness/tmux-drive.md:201-212` — `tmux send-keys -l` + `Enter` + `wait_stable` guards). The infra is built; the contract change is "use it on every scenario, including interactive ones."
- "Plausible" answers (gate → first non-Decline option; chat/steer → continuation; meditate-steer → one-line topic) are deterministic enough to be reproducible across runs without the agent needing a per-scenario script.

### 7.5 Reconcile `.apparat/scenarios/tmux-tester/` by rename vs. by deletion

Rename (verify-then-act per chat round 1's conditional). Reasons:

- The folder ships a real, working `meditate-observer` smoke (`pipeline.dot:9` is the only reachable agent node). Deleting the folder destroys live behavior.
- The dead duplicate `tmux-tester.md` inside the folder *can* be deleted because no `pipeline.dot` references it. Renaming the folder + deleting the dead file removes the recursion ambiguity without losing coverage.
- The user's chat phrasing ("if that really is the same thing") explicitly invited verification before action. They are not the same thing.

### 7.6 Pin convention in `CONTEXT.md` / `pipelines.md` vs. defer to `review_gate`

Defer (chat round 1, "Don't know"). Reasons:

- The user neither pinned nor declined; they wanted a recommendation rather than silence. The design recommends underscored slugs and surfaces it at `review_gate` for the reviewer to accept or defer.
- Pinning a convention is a doc edit that may be appropriate for this PR or a follow-up; the design preserves the option without committing to it.

### 7.7 Atomic vs. staged

Atomic. Reasons:

- The rename, the contract change, and the smoke deletions are correlated: rename without contract change leaves coverage gaps; contract change without rename leaves the loop running into a known-red scenario; smoke deletion without contract change drops coverage with no replacement.
- Single commit, single test-suite shape change, single PR. No rollout cohort.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — the suite shrinks by 15 files; nothing red.
  - `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot --project .` exits 0 (the broken scenario becomes runnable).
  - `apparat pipeline run .apparat/scenarios/meditate-observer/pipeline.dot --project .` exits 0 (post-rename sanity).
  - A live drive of `illumination-to-implementation` reaches `tmux_tester` Phase 2, runs every `.apparat/scenarios/*/pipeline.dot`, and emits a `### Scenarios run` block in `test_render`.
  - `tmux_confirm_gate` shows the new `### Scenarios run` block verbatim under `### Cycles run`.
- Repo-wide grep invariants post-merge:
  - `grep -r "scenarios/tmux-tester" src/ docs/ .apparat/` returns zero hits.
  - `grep -r "pipeline-smoke-.*-folder" src/ docs/` returns zero hits.
  - `find .apparat/scenarios/static-multi-node -name 'node-*.md'` returns zero hits.
  - `find .apparat/scenarios/static-multi-node -name 'node_*.md'` returns three hits.
  - `find .apparat/scenarios/meditate-observer -name 'tmux-tester.md'` returns zero hits.
- Behaviour invariants:
  - `loadAgent` (`agent-loader.ts:29-39`) byte-identical.
  - `validateGraph` byte-identical (`graph-validator-byte-identical` snapshot undisturbed).
  - `tmux-tester` agent frontmatter (`inputs:` / `outputs:` / `tools:` / `permissionMode:` / `model:`) byte-identical.
  - `tmux_confirm_gate` consumer fields (`tmux_tester.test_result`, `tmux_tester.test_render`, `tmux_tester.plan_files_touched`) byte-identical contract.

## 9. Open questions

- **Convention pin in `CONTEXT.md` / `src/cli/skills/apparatus/pipelines.md`.** The design recommends underscored slugs (DOT-id ≡ sibling-md-slug) and surfaces the recommendation at `review_gate`. The reviewer may ask the implementing session to pin it inline (an ADR-style snippet next to the existing two-tier resolver discussion) or to leave it as oral guidance for now. **Default if reviewer is silent:** leave unpinned for a follow-up PR; surface the recommendation in the PR description.
- **What "plausible answer" means per interactive surface.** The design specifies "gate → first non-Decline option; chat/steer → continuation; meditate-steer → one-line topic." Edge cases (e.g. a chat that explicitly asks the agent to choose between two named directions) need a fallback rule. **Proposed default:** the agent chooses the *first* affirmative option presented and logs the choice in `test_render` so the human can audit. Concrete fallback rule belongs in the implementation plan.
- **Aggregated `test_summary` shape.** The design specifies `"N scenarios discovered, N passed, K failed"` as the roll-up line. Bikeshed-able; the implementing session may prefer a richer template (e.g. naming the failed scenarios inline). Either is fine; the design's contract is "the four outputs absorb scenario aggregation without contract change."
- **Should the scenario-discovery loop continue past a failed scenario, or short-circuit?** Today's Phase 2 prose says "Run all scenarios every cycle. Do not skip." (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:236`). The design preserves that — failure is recorded, the loop continues. If the implementing session finds a scenario that crashes the tmux window itself (not just the run inside it), short-circuit may be necessary; flag for the implementing session.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- `grep -r "scenarios/tmux-tester" src/ docs/ .apparat/` — zero hits.
- `grep -r "pipeline-smoke-.*-folder" src/ docs/` — zero hits.
- `find .apparat/scenarios/static-multi-node -name 'node-*.md'` — zero hits.
- `find .apparat/scenarios/meditate-observer -name 'tmux-tester.md'` — zero hits.
- `apparat pipeline validate .apparat/scenarios/static-multi-node/pipeline.dot` — passes.
- `apparat pipeline validate .apparat/scenarios/meditate-observer/pipeline.dot` — passes.

### 10.2 Tests

- `npx vitest run` — passes; file count 15 lower than before; no red.
- `bundled-pipelines-self-sufficient.test.ts` — passes (untouched).

### 10.3 Smoke

- `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot --project .` — exits 0; three nodes execute in sequence (`node_a` → `node_b` → `node_c`).
- `apparat pipeline run .apparat/scenarios/meditate-observer/pipeline.dot --project .` — exits 0 (folder rename does not break the meditate-observer scenario).
- Drive the full `illumination-to-implementation` pipeline against any approved illumination — Phase 2 of `tmux_tester` runs every scenario in `.apparat/scenarios/`, emits the `### Scenarios run` block, and `tmux_confirm_gate` displays it.

### 10.4 Negative cases

- Add a deliberately broken scenario (`.apparat/scenarios/probe-broken/pipeline.dot` with a typo in an `agent="…"` attribute) and drive `tmux_tester` Phase 2 — the loop catches the failure, marks the scenario `FAIL` in `test_render`, and `test_result` flips to `"fail"`.
- Drop a `tmux-tester.md` file into a scenario folder — Phase 2's self-skip rule kicks in; the loop skips that folder; no recursion.
- Run `tmux_tester` without `$SESSION` (no tmux) — the existing Phase 0 fallback (`tmux-tester.md:182`) emits `test_result="fail"` with the no-tmux message; behavior unchanged from today.
- A scenario interactive prompt the agent does not recognize — agent records the unrecognized prompt in `test_render`'s `### Remaining issues`; loop continues to next scenario; `test_result` is `"fail"`.

## 11. Summary

`.apparat/scenarios/static-multi-node/pipeline.dot` declares `agent="node_a"` / `node_b` / `node_c` while the sibling files on disk are `node-a.md` / `node-b.md` / `node-c.md`; `loadAgent` (`src/cli/lib/agent-loader.ts:29-39`) joins literally and aborts with "Agent file not found." The bundled scenario has been live but unrunnable. The 15 `src/cli/tests/pipeline-smoke-*-folder.test.ts` files are structural-only (file existence + `validateGraph()`) and missed the bug because they never invoked `apparat pipeline run`. This design renames the three siblings to `node_a.md` / `node_b.md` / `node_c.md` (DOT-id ≡ sibling-md-slug, both underscored), deletes the 15 structural smokes, replaces them with a live scenario-discovery phase inside `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` Phase 2 (drives `apparat pipeline run` against every `.apparat/scenarios/*/pipeline.dot` in the existing tmux window via the existing `send_input` harness, agent plays human for interactive prompts), reconciles the misnamed `.apparat/scenarios/tmux-tester/` folder by renaming it to `meditate-observer/` and deleting the dead duplicate `tmux-tester.md` agent file inside it, and surfaces an underscored-slug convention recommendation at `review_gate` (the `CONTEXT.md` / `pipelines.md` pin is deferred per user direction in chat round 1). `agent-loader.ts`, the validator, the resolver, and the `tmux-tester` frontmatter all stay byte-identical. Blast radius is M-by-files (≈22), S-by-surfaces (scenarios folder, bundled smoke-test suite, one agent contract). Atomic landing.
