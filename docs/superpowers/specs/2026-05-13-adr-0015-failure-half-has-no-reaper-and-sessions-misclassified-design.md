# Design: Kill sessions, ship `apparat sweep`, patch stimuli/.triage/ leak

**Date:** 2026-05-13
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-13T1106-adr-0015-failure-half-has-no-reaper-and-sessions-misclassified.md`
**Related ADR:** ADR-0015 (`docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`) — extended in-place by PR1 and PR3 with one clarifying paragraph reclassifying `.apparat/sessions/`; no new ADR.

## 1. Motivation

Two `.apparat/` write paths leak under the current GC contract, and one substrate sits on disk under a label its own producer contradicts:

- **Sessions producer with zero consumers.** `.apparat/pipelines/illumination-to-implementation/memory-writer.md:49` writes `$project/.apparat/sessions/YYYY-MM-DD-<slug>.md`, then unconditionally `git add -A` + `git commit` at lines 122-131 and `git push -u origin` at line 138. The same write happens in `.apparat/pipelines/parallel-illumination-to-implementation/memory-writer.md:49` with the identical procedure. The only consumer is `memory-reflector.md:38` (in both pipelines) reading `$memory_writer.memory_path` — no external reader exists, and the operator's own note in `.apparat/notes.md` calls it dead:

  > "No one reads .apparat/sessions folder so that is just burning tokens with memory_reflector node" — operator, 2026-05-13.

  ADR-0015 (`docs/adr/0015-asymmetric-gc-pipeline-tail-success.md:71-73`) classifies sessions alongside specs/illuminations/stimuli as "institutional memory that survives context resets" — a rationale contradicted by the operator within 24 hours of merge. Cost: every run pays token + commit + push overhead for memory that no future session reads.

- **stimuli/.triage/ never swept.** `src/cli/commands/pipeline/runs-gc.ts:105-110` exposes `gcRunScopedArtefactsOnSuccess(project, runId)` — wired in from the runner's `finally` at `src/cli/commands/pipeline/run.ts:438` — and it sweeps exactly two paths:

  ```ts
  export function gcRunScopedArtefactsOnSuccess(project: string, runId: string): void {
    const runDir = join(project, ".apparat", "runs", runId);
    const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
    rmSync(runDir, { recursive: true, force: true });
    rmSync(triageDir, { recursive: true, force: true });
  }
  ```

  There is no branch for `.apparat/meditations/stimuli/.triage/<runId>/`. The verifier confirms 14 directories have sedimented there (Apr 13 → May 4). Same mid-flight-scratch shape as the illumination triage path, no reaper.

- **No operator surface to triage the rest.** `apparat sweep`, `apparat janitor`, and `apparat gc` are all absent from `src/cli/program.ts` registrations (the full `program.command(...)` list runs from `:99-:259`, with no such command). The `janitor` name is already taken by the read-only scanner pipeline at `src/cli/pipelines/janitor/janitor.md:2-3` — that pipeline declares only `Grep` + `mcp__illumination__*` in its `tools:` block (per ADR-0015 §Context). Reusing the name on a mutating CLI would be a collision.

The strategic compass (per `$chat_summarizer.refinements`): curated `.apparat/` substrates are durable, frontmattered, human-meaningful knowledge — they survive. Scratch substrates are run-id-keyed, opaque, machine-only — they get a sweep button. ADR-0015's automatic green-tail reaper stays unchanged; this design adds the manual operator surface for everything else and stops the one producer-without-consumer that is purely waste.

Out of the original illumination's seven-step plan, the chat refinement explicitly dropped three concerns: (a) automatic failure-bucket reaper with `APPARAT_FAILED_KEEP=5` — failed-run scratch keeps forensic value (per the operator's reference to verba-extension `runs/` + `reasoning-memory/`), so silent auto-eviction is wrong; (b) universal `pipeline validate` rule forcing every new `.apparat/<thing>/` to declare a reaper — not every substrate is reapable; (c) new ADR-0016 — the refined scope is small enough that ADR-0015 stands with one paragraph edit.

## 2. Decision summary

Three independently revertable PRs, each at a different surface:

1. **PR1 — kill sessions producer + consumer in both pipelines.** Delete `memory-writer.md` and `memory-reflector.md` from `.apparat/pipelines/illumination-to-implementation/` and `.apparat/pipelines/parallel-illumination-to-implementation/` (4 files total). Rewire each `pipeline.dot` to bypass the deleted nodes (2 files): in `illumination-to-implementation/pipeline.dot:91, 96, 99-100`, route `review_gate -> done [label="Approve"]` and `tmux_confirm_gate -> done [label="Commit"]`; in `parallel-illumination-to-implementation/pipeline.dot:106, 109-110`, route `tmux_confirm_gate -> done [label="Commit"]`. Remove the `memory_writer` and `memory_reflector` node declarations from both files (lines 47-49 in illum-to-impl, lines 55-57 in parallel). One paragraph edit to ADR-0015 reclassifying sessions from "memory" to "trash" — no ADR-0016. Update the test file `src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts` (deletion, or replacement with a no-op-edges assertion).

2. **PR2 — ship top-level `apparat sweep` command.** New file `src/cli/commands/sweep.ts`; register in `src/cli/program.ts` next to the existing top-level commands (`implement` at `:99`, `init` at `:107`, `meditate` at `:115`, `status` at `:250`). **Not** under `pipeline.command(...)` — top-level by chat refinement bullet. Interactive listing of `.apparat/` substrates with sizes, tagged curated vs scratch (taxonomy in §3.2). Operator picks targets to wipe; nothing destroyed without operator selection.

3. **PR3 — one-liner: add stimuli/.triage/ to green-tail reaper.** Edit `src/cli/commands/pipeline/runs-gc.ts:105-110` to add `rmSync(stimuliTriageDir, { recursive: true, force: true })` for `.apparat/meditations/stimuli/.triage/<runId>/`. Update assertions in `src/cli/tests/post-tail-gc.test.ts` so the existing test cases (lines 23, 34, 60, 74, 93) cover the new sweep target.

Each PR is independently revertable: PR1 stops writes immediately and is a pure file-delete + edge-rewire; PR2 is pure addition with no behavioural change to running pipelines; PR3 is a literal one-line `rmSync` plus test updates.

**Locked OUT of scope** (per refinement bullets):

- Automatic failure-bucket reaper with `APPARAT_FAILED_KEEP=5`. Rationale: preserved scratch can seed distilled lessons (verba-extension reference); silent auto-eviction of failures destroys forensic value before operator can triage. The operator gets visibility via `apparat sweep` instead.
- Universal `pipeline validate` rule forcing every new `.apparat/<thing>/` to declare a reaper in an ADR. Rationale: not every substrate is reapable; with no uniform reaper-per-substrate policy, the invariant has nothing to enforce.
- New ADR-0016. Rationale: the refined scope is small enough that ADR-0015 stands with one paragraph edit (sessions reclassification).
- Touching ADR-0015's green-tail reaper logic itself (`gcRunScopedArtefactsOnSuccess`). Rationale: it works correctly; manual `apparat sweep` is added alongside, not as a replacement.
- Nesting `sweep` under `pipeline.command(...)` (blast-radius subagent suggestion). Rationale: chat refinement explicitly locks `apparat sweep` as top-level.
- Pre-rule cleanup of already-sedimented `.triage/` and `sessions/` content. Rationale: `apparat sweep` is the operator surface for that work; pre-rule sediment is exactly the use case sweep solves on day one.

## 3. Architecture

### 3.1 Three-PR layering

```
PR1   Sessions kill          → stop producer; remove dead consumer; rewire 2 pipeline.dot graphs
PR2   apparat sweep          → operator-driven manual GC across all .apparat/ substrates
PR3   Stimuli triage sweep   → one-line patch to existing green-tail reaper
```

PR1 closes the producer-without-consumer leak at source: no more sessions write, no more sessions commit, no more sessions push. PR2 gives the operator a visible, manual surface for everything else (pre-rule sediment, failed-run scratch they choose to wipe, any future trash type). PR3 closes the one bug in the existing green-tail reaper. The three are independent — any subset can ship without the others.

### 3.2 Curated vs scratch taxonomy (drives `apparat sweep` UI)

| Tag      | Substrate                                            | Reapable by sweep? |
|----------|------------------------------------------------------|--------------------|
| curated  | `.apparat/meditations/illuminations/*.md` (top-level files only, not `.triage/`) | No (warn before delete) |
| curated  | `.apparat/meditations/stimuli/*.md` (top-level files only, not `.triage/`)      | No (warn before delete) |
| curated  | `.apparat/pipelines/<name>/`                         | No (warn before delete) |
| curated  | `.apparat/scenarios/`                                | No (warn before delete) |
| curated  | `.apparat/notes.md`                                  | No (warn before delete) |
| curated  | `.apparat/lessons/`                                  | No (warn before delete) |
| curated  | `.apparat/reasoning-memory/`                         | No (warn before delete) |
| scratch  | `.apparat/runs/<runId>/`                             | Yes (default selectable) |
| scratch  | `.apparat/meditations/illuminations/.triage/<runId>/` | Yes (default selectable) |
| scratch  | `.apparat/meditations/stimuli/.triage/<runId>/`      | Yes (default selectable) |
| scratch  | `.apparat/sessions/` (post-PR1: write side is dead; existing sediment lingers) | Yes (default selectable) |

Curated entries are named, frontmattered, human-authored knowledge — they receive a confirmation prompt before delete. Scratch entries are run-id-keyed, opaque, machine-only — they are the default selection. The taxonomy is encoded in `sweep.ts` as a hardcoded list; not a discoverable rule, not a validator gate (chat refinement explicitly drops the universal-validator option).

The operator's verba-extension layout — `.apparat/runs/` and `.apparat/reasoning-memory/` as valuable project files — is the reference case the curated tag protects. `sweep` must never default-delete `reasoning-memory/` in any project, even though it is technically a non-standard substrate; the curated list is conservative by design.

### 3.3 Sessions kill — PR1 wiring

Both pipelines currently follow this tail shape (anchors below from `.apparat/pipelines/illumination-to-implementation/pipeline.dot:91-100`):

```
review_gate -> memory_writer     [label="Approve"]
tmux_confirm_gate -> memory_writer [label="Commit"]
memory_writer -> memory_reflector
memory_reflector -> done
```

After PR1:

```
review_gate -> done              [label="Approve"]
tmux_confirm_gate -> done        [label="Commit"]
```

The `memory_writer` declaration at line 47 and `memory_reflector` declaration at line 49 are deleted. Parallel pipeline (`.apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot:55-57` declarations, `:106, :109-110` edges) follows the same shape — no `review_gate` (orchestrator/resolver feed tmux_tester directly per its comment at `:104`), so only the `tmux_confirm_gate -> memory_writer [label="Commit"]` edge and the two `memory_*` edges need rerouting to `done`.

The `memory-writer.md` agent contract's step 5 commit (lines 122-131) and step 6 push (lines 135-139) — which previously absorbed any stragglers from upstream nodes — disappear with the file. **Risk:** prior runs depended on memory-writer's `git add -A` + push at the tail to surface any uncommitted work that earlier nodes left behind (design-writer, plan-writer, tmux-tester all commit their own diffs in-flight, so the residue is usually empty, but the safety-net behaviour is real). Mitigation: confirm by code grep that each in-flight committer (`tmux-tester.md`, `implement.md`, `plan-writer.md`, `design-writer.md`) commits its own diff atomically before exit — if confirmed, the tail commit is redundant for the post-PR1 happy path. Open question §9.1 below tracks this.

`memory_writer`'s `default_test_result`, `default_test_summary`, `default_illumination_path` declarations on `pipeline.dot:47` and `:55` are deleted along with the node; no other node references those defaults (grepped at agent-contract level).

The lifecycle `consume_plan` (step 7a) and `consume` (step 7b) calls inside `memory-writer.md:144-156` — which mark the plan and illumination as `implemented` — **move out** with the memory-writer file. After PR1, plan files in `docs/superpowers/plans/` and illumination files in `.apparat/meditations/illuminations/` are no longer auto-consumed by the pipeline at the tail. Open question §9.2 below: does this consume responsibility need to shift to another node (e.g., a thin tool node at the tail), or is the operator's `apparat sweep` plus the existing `pipeline consume` MCP tool sufficient? Default position: defer to the operator's manual workflow until the gap is observed in practice. (Lifecycle consume is orthogonal to sessions kill; the only reason it co-located with sessions write is incidental.)

### 3.4 `apparat sweep` — PR2 wiring

New file `src/cli/commands/sweep.ts`. Registration in `src/cli/program.ts` next to the existing top-level commands. Picking a register-after anchor: insert between `meditate` (`:115`) and the `pipeline` subcommand (`:127`) so sweep groups with the project-level verbs:

```ts
// src/cli/program.ts (insert after meditate block at :125, before pipeline at :127)
program
  .command("sweep [project-folder]")
  .description("Interactively review and delete .apparat/ scratch substrates (curated entries warn before delete)")
  .addHelpText("after", `
Examples:
  apparat sweep                  # in cwd
  apparat sweep my-app           # in ./my-app

Lists every entry under <project>/.apparat/ with on-disk size and a curated/scratch
tag. Scratch entries (runs/<runId>/, both .triage/<runId>/, sessions/) are
default-selectable. Curated entries (illuminations, stimuli, pipelines, scenarios,
notes.md, lessons, reasoning-memory) prompt for confirmation before delete.

--dry-run prints the would-delete list and exits 0 with no side effects.
`)
  .option("--dry-run", "List sizes and exit without prompting")
  .action(async (projectFolder: string | undefined, opts: { dryRun?: boolean }) => {
    await sweepCommand(projectFolder ?? process.cwd(), opts);
  });
```

The `sweep.ts` module exports one `sweepCommand(projectFolder: string, opts: { dryRun?: boolean })` function with the following responsibilities:

1. **Refuse non-apparat-shaped folders.** Call the same shape-signal predicate other commands use (`init`, `meditate` after `2026-05-13-meditate-no-project-orientation-and-mcp-orphans-design.md` lands, etc.). If the predicate has not yet shipped at the time PR2 lands, sweep imports `existsSync(join(projectFolder, ".apparat"))` directly — if the `.apparat/` folder is absent, sweep exits 1 with "no `.apparat/` found at <path>". This is a temporary inline check that the shape-signal helper supersedes when it lands.
2. **Walk `.apparat/` one level deep.** `readdirSync(join(projectFolder, ".apparat"))` returns the top-level entries. For each, classify as curated or scratch per the §3.2 taxonomy. For directories that branch into `<runId>/` or `.triage/<runId>/`, descend one more level so each `runs/<runId>/` and `.triage/<runId>/` is shown as a separate selectable row.
3. **Compute size.** `du -s` equivalent in Node: recursive `statSync` walking sum of `size` per file. Cache: the operator's project may have hundreds of run dirs; a sub-second total budget is fine — `du`-equivalent on `.apparat/` even at 100 entries is well under 100ms.
4. **Interactive selection UI.** Same Ink primitive surface other interactive nodes use (`approval_gate`, `chat_session`); the operator sees a checkbox list with scratch entries pre-checked and curated entries unchecked. Confirmation prompt before delete: "About to delete N entries totalling X MB. Continue? [y/N]". On Y, `rmSync({ recursive: true, force: true })` each.
5. **`--dry-run`.** Print the same list with sizes + tags; exit 0 without prompting.

The taxonomy lookup is a hardcoded constant in `sweep.ts`:

```ts
const CURATED_PATHS = [
  "meditations/illuminations",  // top-level files only — .triage/ is scratch
  "meditations/stimuli",        // top-level files only — .triage/ is scratch
  "pipelines",
  "scenarios",
  "notes.md",
  "lessons",
  "reasoning-memory",
];

const SCRATCH_PATHS = [
  "runs",                                // each .apparat/runs/<runId>/ is a row
  "meditations/illuminations/.triage",   // each .triage/<runId>/ is a row
  "meditations/stimuli/.triage",         // each .triage/<runId>/ is a row
  "sessions",                            // whole folder, or per-file rows
];
```

Entries not in either list (unknown substrate) appear as **untagged** — they are listed for visibility but neither default-selected nor warn-before-delete; the operator decides. This matches the operator-visibility-and-manual-selection refinement: nothing destroyed without operator selection, but nothing hidden either.

The command runs from cwd by default, like `apparat init`. It does not invoke the pipeline engine — it is a pure CLI side-effect on the filesystem, no run-folder, no checkpoint, no tracer.

### 3.5 Stimuli triage sweep — PR3 wiring

The literal patch at `src/cli/commands/pipeline/runs-gc.ts:105-110`:

Before:
```ts
export function gcRunScopedArtefactsOnSuccess(project: string, runId: string): void {
  const runDir = join(project, ".apparat", "runs", runId);
  const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(triageDir, { recursive: true, force: true });
}
```

After:
```ts
export function gcRunScopedArtefactsOnSuccess(project: string, runId: string): void {
  const runDir = join(project, ".apparat", "runs", runId);
  const illumTriageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
  const stimuliTriageDir = join(project, ".apparat", "meditations", "stimuli", ".triage", runId);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(illumTriageDir, { recursive: true, force: true });
  rmSync(stimuliTriageDir, { recursive: true, force: true });
}
```

Test ripple: `src/cli/tests/post-tail-gc.test.ts` has six existing cases that invoke `gcRunScopedArtefactsOnSuccess` (at lines 23, 34, 60, 74, 93 plus a no-throw case at 40 and 49). Each case that seeds a triage fixture needs a parallel `meditations/stimuli/.triage/<runId>/` fixture, and the assertion arm needs an extra `expect(existsSync(stimuliTriagePath)).toBe(false)` after the sweep.

JSDoc at `runs-gc.ts:96-103` updates to enumerate three swept paths instead of two; the comment-as-documentation surface is the only "spec" output of this PR beyond the code change.

### 3.6 Files-touched buckets

| Bucket               | File                                                                                        | Treatment | PR |
|----------------------|---------------------------------------------------------------------------------------------|-----------|----|
| Pipeline contract    | `.apparat/pipelines/illumination-to-implementation/memory-writer.md`                        | Delete    | 1  |
| Pipeline contract    | `.apparat/pipelines/illumination-to-implementation/memory-reflector.md`                     | Delete    | 1  |
| Pipeline contract    | `.apparat/pipelines/parallel-illumination-to-implementation/memory-writer.md`               | Delete    | 1  |
| Pipeline contract    | `.apparat/pipelines/parallel-illumination-to-implementation/memory-reflector.md`            | Delete    | 1  |
| Pipeline graph       | `.apparat/pipelines/illumination-to-implementation/pipeline.dot`                            | Edit — drop nodes :47, :49; reroute edges :91, :96, :99-100 to `done` | 1 |
| Pipeline graph       | `.apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot`                   | Edit — drop nodes :55, :57; reroute edges :106, :109-110 to `done` | 1 |
| Docs — ADR           | `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`                                      | Edit — one-paragraph clarification reclassifying `.apparat/sessions/` from "institutional memory" (lines 71-73) to "trash"; update §Consequences with sessions-producer-removed line | 1 |
| Tests                | `src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts`                         | Delete or replace with rerouted-edge assertion | 1 |
| CLI command          | `src/cli/commands/sweep.ts`                                                                 | New       | 2  |
| CLI registration     | `src/cli/program.ts`                                                                        | Edit — insert sweep `command(...)` block between `:125` (meditate) and `:127` (pipeline) | 2 |
| Tests                | `src/cli/tests/sweep.test.ts`                                                               | New — fixture project, dry-run assertion, selection-and-delete assertion | 2 |
| Library              | `src/cli/commands/pipeline/runs-gc.ts`                                                      | Edit — add `stimuliTriageDir` + third `rmSync` at `:105-110`; update JSDoc at `:96-103` | 3 |
| Tests                | `src/cli/tests/post-tail-gc.test.ts`                                                        | Edit — seed stimuli/.triage/ fixtures alongside illuminations/.triage/ in existing 6 cases; add stimuli-only sweep assertion | 3 |
| Docs ripple          | `docs/superpowers/plans/2026-04-30-specs-to-docs-portability.md`                            | Edit — drop or update any memory-writer mention | 1 |
| Docs ripple          | `docs/superpowers/plans/2026-05-08-implement-node-no-op-passes-verification.md`             | Edit — drop or update any memory-writer mention | 1 |
| Docs ripple          | `README.md` GC section                                                                      | Edit — note sweep command exists; note sessions no longer written | 2 |

Per-PR file counts:

- **PR1:** 4 deletes + 2 graph edits + 1 ADR edit + 2 doc edits + 1 test edit = **10 files**.
- **PR2:** 1 new command + 1 program.ts edit + 1 new test + 1 README edit = **4 files**.
- **PR3:** 1 library edit + 1 test edit = **2 files**.

Total ~16 files across three PRs, consistent with verifier blast paragraph (~10 paths) once docs ripple is added in.

## 4. Components & key edits

### 4.1 PR1 — `pipeline.dot` rewires

Both DOT files: drop two node declarations, rewire three (illum-to-impl) or two (parallel) edges. The validator's edge-target check (loaded from `src/cli/lib/dot/*` per architecture; not exhaustively grepped here — `pipeline validate` is the canonical check) must pass after deletion: every edge target must be a declared node. By construction, after the rewire all surviving edges terminate at `done` or other surviving nodes; no orphan targets.

The `default_*` attribute removal (e.g., `default_test_result=""` at `pipeline.dot:47`) is incidental — those defaults exist on the `memory_writer` node declaration line and disappear with the node. Other nodes' `default_*` attributes (e.g., `verifier`'s `default_refinements=""` at `:10`) are untouched.

The `memory_writer -> memory_reflector` edge (`pipeline.dot:99`, parallel `:109`) and `memory_reflector -> done` edge (`:100`, parallel `:110`) are deleted as part of removing the nodes.

For the `illumination-to-implementation/pipeline.dot` specifically, the existing tail at `:91-100`:

```dot
review_gate -> memory_writer     [label="Approve"]
review_gate -> tmux_tester       [label="Tmux"]
review_gate -> implement         [label="Retry"]

tmux_tester -> tmux_confirm_gate
tmux_confirm_gate -> memory_writer [label="Commit"]
tmux_confirm_gate -> tmux_tester [label="Retry"]

memory_writer -> memory_reflector
memory_reflector -> done
```

becomes:

```dot
review_gate -> done              [label="Approve"]
review_gate -> tmux_tester       [label="Tmux"]
review_gate -> implement         [label="Retry"]

tmux_tester -> tmux_confirm_gate
tmux_confirm_gate -> done        [label="Commit"]
tmux_confirm_gate -> tmux_tester [label="Retry"]
```

Eight lines net; two nodes removed; the gate-to-done label semantics (`Approve` and `Commit`) survive intact.

### 4.2 PR1 — ADR-0015 paragraph edit

`docs/adr/0015-asymmetric-gc-pipeline-tail-success.md:71-73` currently says:

> "**Universal `lifecycle:` frontmatter system across all agents + validator artefact-flow rule + `consume_design` MCP tool.** Rejected: only `runs/` and `.triage/` are unambiguously trash; specs, sessions, illuminations, and stimuli function as institutional memory that survives context resets."

After edit:

> "**Universal `lifecycle:` frontmatter system across all agents + validator artefact-flow rule + `consume_design` MCP tool.** Rejected: only `runs/` and `.triage/` are unambiguously trash; specs, illuminations, and stimuli function as institutional memory that survives context resets. (Reclassified 2026-05-13: `.apparat/sessions/` previously listed here as memory was found to have zero downstream consumers — see `docs/superpowers/specs/2026-05-13-adr-0015-failure-half-has-no-reaper-and-sessions-misclassified-design.md`. The producer was removed from both `illumination-to-implementation/` and `parallel-illumination-to-implementation/` pipelines; existing sediment is reapable via `apparat sweep`.)"

A small one-paragraph addition to §Consequences names sessions as no-longer-written so the next reader of ADR-0015 does not draw a stale conclusion.

### 4.3 PR2 — `sweep.ts` size walk

Recursive size computation in Node:

```ts
function dirSize(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    try {
      if (entry.isDirectory()) total += dirSize(child);
      else if (entry.isFile()) total += statSync(child).size;
    } catch { /* ENOENT tolerated */ }
  }
  return total;
}
```

For `.apparat/` at typical project scale (tens to low-hundreds of run dirs, illuminations and stimuli as flat markdown), the full walk is sub-100ms. No `du` shell-out; pure Node.

### 4.4 PR2 — Ink TUI for selection

Use the same Ink/`ink-select-input` primitive that `approval_gate` and `chat_session` use. Sketch:

```
.apparat/ contents at /path/to/proj/.apparat (total 47 MB)

  [x] runs/parallel-illumination-to-implementation-f5121594/    12.4 MB  [scratch]
  [x] runs/meditate-4ab00e87/                                    8.1 MB  [scratch]
  [x] meditations/illuminations/.triage/foo/                     1.2 MB  [scratch]
  [x] meditations/stimuli/.triage/bar/                           0.4 MB  [scratch]
  [x] sessions/                                                  3.7 MB  [scratch]
  [ ] meditations/illuminations/                                 0.8 MB  [curated]
  [ ] meditations/stimuli/                                       0.5 MB  [curated]
  [ ] pipelines/                                                 2.1 MB  [curated]
  [ ] notes.md                                                   0.0 MB  [curated]

[Space] toggle    [Enter] delete selected    [q] quit
```

Curated entries are unchecked by default and prompt for explicit confirmation if the operator checks them. Scratch entries are checked by default. The screen does not auto-recompute sizes mid-session — a single snapshot at startup is sufficient (operator can re-run sweep to refresh).

### 4.5 PR3 — `runs-gc.ts` edit footprint

The function is 6 lines today; the edit adds 2 lines (one `const`, one `rmSync`) and renames `triageDir` to `illumTriageDir` for clarity. JSDoc enumeration of swept paths updates from two to three. No new exports, no new constants, no signature change. Callers untouched — `src/cli/commands/pipeline/run.ts:438` invokes the function with the same `(project, runId)` arguments.

### 4.6 Test updates

**PR1: `src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts`** — the test exists today to lock down memory-writer's session-folder write behavior. After PR1 it is obsolete. Two options: (a) delete the file outright, (b) replace its content with a regression assertion that the rewired pipeline.dot no longer contains the `memory_writer` or `memory_reflector` node, plus that `review_gate -> done` and `tmux_confirm_gate -> done` edges are present. (b) is cheap and forwards a useful invariant; default to (b).

**PR2: `src/cli/tests/sweep.test.ts`** (new) — fixture project with `.apparat/runs/<id>/`, `.apparat/meditations/illuminations/.triage/<id>/`, `.apparat/sessions/<file>`, and a curated entry. Three cases:
- `--dry-run` exits 0; prints all entries with sizes; deletes nothing.
- Interactive selection of scratch defaults + confirmation → those entries removed; curated entries untouched.
- Refuses on a folder without `.apparat/` (exit 1).

**PR3: `src/cli/tests/post-tail-gc.test.ts`** — existing 6 cases (lines 23, 34, 60, 74, 93 + the no-throw case) extended: each test that seeds an illuminations triage fixture must also seed a stimuli triage fixture; each assertion arm must add `expect(existsSync(stimuliTriagePath)).toBe(false)`. One new case asserts that a project with only stimuli triage (no illuminations triage) still sweeps cleanly.

## 5. Data flow

### 5.1 PR1 — illumination-to-implementation pipeline tail (after)

```
review_gate decision
  ├─ Approve → done                       (was: → memory_writer → memory_reflector → done)
  ├─ Tmux    → tmux_tester
  └─ Retry   → implement

tmux_confirm_gate decision (after tmux_tester)
  ├─ Commit → done                        (was: → memory_writer → memory_reflector → done)
  └─ Retry  → tmux_tester
```

No session file is written. No `.apparat/sessions/` commit. No `.apparat/sessions/` push. The pipeline's final on-disk artifact is the design + plan + implementation diff committed by upstream nodes (`design-writer`, `plan-writer`, `implement`, `tmux-tester`); each of those already commits its own work atomically before exit. Lifecycle `consume`/`consume_plan` calls (previously in memory-writer step 7) are lost — see §9.2 open question.

### 5.2 PR2 — `apparat sweep` happy path

```
apparat sweep my-app
  → sweepCommand("my-app", {})
    → existsSync("my-app/.apparat") === true
    → walk top-level of .apparat/, classify each entry per §3.2 taxonomy
    → compute size per entry via dirSize() recursion
    → render Ink list: scratch entries pre-checked, curated entries unchecked
    → operator toggles selections, confirms
    → for each selected entry, rmSync(path, { recursive: true, force: true })
    → print summary: "Removed N entries totalling X MB"
```

`--dry-run` exits after the render step.

### 5.3 PR3 — green pipeline tail (after)

```
pipeline run terminates with result.status === "success"
  → finally block (run.ts:438) → gcRunScopedArtefactsOnSuccess(project, runId)
    → rmSync(.apparat/runs/<runId>/)
    → rmSync(.apparat/meditations/illuminations/.triage/<runId>/)
    → rmSync(.apparat/meditations/stimuli/.triage/<runId>/)    ← NEW
```

On non-success, all three paths preserve (ADR-0015 asymmetry unchanged).

## 6. Blast radius / impact surface

- **Size: S/M.** Verifier final pass + explainer Tier-2 §Blast radius both agree. ~16 files across three PRs (10 for PR1, 4 for PR2, 2 for PR3) with most file counts driven by docs + tests, not source.
- **Surfaces crossed:** CLI (commander + Ink TUI in PR2), pipeline runtime (PR3 one-liner at `runs-gc.ts`), agent contracts (PR1 deletes two contracts from each of two pipelines; rewires two `pipeline.dot` graphs), tests (3 files across PRs), docs (ADR-0015 edit, README GC section, two superpowers/plans/ ripple edits). No `.dot` schema change. No tracer schema change. No agent rubric change. No engine handler-surface change. No new env var. No new MCP tool.
- **Breaking changes: none for external consumers.** `memory_path` is internal to the memory-writer→memory-reflector pair with zero external readers (verified by sessions subagent per verifier blast paragraph). `gcRunScopedArtefactsOnSuccess` signature unchanged. The `apparat sweep` command is pure addition. `pipeline.dot` rewires are within agent-contract layer — no downstream tool reads the pipeline file's intermediate node list.
- **Spec / docs ripple checklist:**
  - [ ] `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md` — one paragraph reclassifying sessions; §Consequences line on sessions producer removed (PR1).
  - [ ] `docs/superpowers/plans/2026-04-30-specs-to-docs-portability.md` — drop or update any `memory-writer` mention (PR1).
  - [ ] `docs/superpowers/plans/2026-05-08-implement-node-no-op-passes-verification.md` — drop or update any `memory-writer` mention (PR1).
  - [ ] `README.md` — note `apparat sweep` exists (PR2); separately note sessions no longer written (PR1).
- **Test ripple checklist:**
  - [ ] **Edit or delete** `src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts` — obsolete after PR1; recommend replace with rewired-pipeline assertion (PR1).
  - [ ] **New** `src/cli/tests/sweep.test.ts` — dry-run, selection-and-delete, no-`.apparat/` refusal (PR2).
  - [ ] **Edit** `src/cli/tests/post-tail-gc.test.ts` — seed stimuli/.triage/ alongside illuminations/.triage/ in 6 cases; add stimuli-only case (PR3).
- **Operator ripple** (post-merge, optional one-shot via the new `apparat sweep`):
  - [ ] Existing `.apparat/sessions/` sediment (56 files) — `apparat sweep` exposes the folder as scratch; operator removes at their discretion.
  - [ ] Existing `.apparat/meditations/stimuli/.triage/` sediment (14 dirs) — same path.
  - [ ] Existing `.apparat/meditations/illuminations/.triage/` sediment (18 dirs) — same path.

## 7. Trade-offs

### 7.1 Drop sessions vs preserve for future use

**Drop chosen.** Operator's own `.apparat/notes.md` confirms zero current readers; ADR-0015's "institutional memory" claim was rationale-only (no consumer ever materialised). Cost of dropping: lifecycle `consume` calls previously inside memory-writer step 7 disappear (open question §9.2). Cost of preserving: every run continues to pay token + commit + push overhead for a file no one reads, and ADR-0015 stays internally inconsistent with the operator's stated workflow.

### 7.2 Top-level `apparat sweep` vs `apparat pipeline sweep` or `apparat janitor sweep`

**Top-level chosen.** Chat refinement bullet locks this: `apparat sweep good`; `janitor is pipeline command so this command should not be janitor something`. Architectural reasons: (a) `janitor` already names the read-only scanner pipeline at `src/cli/pipelines/janitor/janitor.md:2-3` — reusing the name for a mutating CLI is a collision; (b) `pipeline.command(...)` namespacing implies the operation is pipeline-scoped, but `sweep` operates across all `.apparat/` substrates regardless of pipeline; (c) top-level matches the existing operator-facing verb pattern (`apparat implement`, `apparat init`, `apparat meditate`, `apparat status`).

Blast-radius subagent suggested nesting under `pipeline.command(...)` — that suggestion contradicts the chat refinement and is rejected.

### 7.3 Curated entries warn-before-delete vs hard-refuse

**Warn-before-delete chosen.** Hard-refusing curated entries would force the operator to use `rm` outside the tool when they legitimately want to wipe (e.g., archiving a stale `lessons/` folder before starting over). Warn-then-confirm preserves operator control while making accidents harder.

### 7.4 Interactive UI vs flags-only

**Interactive chosen** (chat refinement: "selection happens with operator visibility"). A flags-only `apparat sweep --runs --triage --sessions` would be more scriptable but loses the size-visibility-and-pick affordance that the operator explicitly asked for. A `--dry-run` flag covers the scripting case for status-only output.

### 7.5 Per-PR isolation vs single landing commit

**Per-PR isolation chosen.** Three independently revertable PRs reduce blast on any one rollback: PR1 stops sessions waste immediately (highest token+disk gain); PR2 is pure-addition with no behaviour change to running pipelines; PR3 is a literal one-liner. A bundled landing commit would couple them — if PR2's Ink integration hits a regression, PR1's sessions kill is held up unnecessarily.

### 7.6 Stimuli triage extension vs separate function

**Extend `gcRunScopedArtefactsOnSuccess` chosen.** The function's contract is already "tail GC for run-scoped scratch paths" (its JSDoc at `runs-gc.ts:96-103`); adding a third path inside is two lines and keeps the call-site at `run.ts:438` unchanged. A separate `gcStimuliTriage()` would split the responsibility across functions with no caller benefit.

## 8. Constraints

After all three PRs land:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including edited `post-tail-gc.test.ts`, new `sweep.test.ts`, and the obsoleted `pipeline-illum-to-impl-memory-writer-folder.test.ts` (deleted or rewritten).
- `apparat pipeline validate illumination-to-implementation --project <proj>` passes against the rewired pipeline.
- `apparat pipeline validate parallel-illumination-to-implementation --project <proj>` passes against the rewired pipeline.
- A green run of `illumination-to-implementation` writes nothing to `.apparat/sessions/`; produces no `chore(memory):` commit; the pipeline terminates from `review_gate` (Approve) or `tmux_confirm_gate` (Commit) directly into `done`.
- A green run sweeps `.apparat/runs/<runId>/`, `.apparat/meditations/illuminations/.triage/<runId>/`, **and** `.apparat/meditations/stimuli/.triage/<runId>/` on success.
- `apparat sweep <project>` lists every top-level `.apparat/` entry with size and tag.
- `apparat sweep --dry-run <project>` exits 0 and deletes nothing.
- `apparat sweep <non-apparat-folder>` exits 1 with "no `.apparat/` found".

Repo-wide grep invariants (post-merge):

- `grep -nR "apparat/sessions" src .apparat docs` — zero hits in agent contracts (`.apparat/pipelines/**/memory-*.md` gone). Hits in `docs/adr/0015-*.md` (clarifying paragraph) and possibly `README.md` (historical note) are expected.
- `grep -nR "memory_writer\|memory_reflector" .apparat/pipelines` — zero hits.
- `grep -nR "memory-writer\|memory-reflector" .apparat/pipelines` — zero hits.
- `grep -nR "gcRunScopedArtefactsOnSuccess" src` — two hits: `src/cli/commands/pipeline/run.ts:438` and `src/cli/commands/pipeline/runs-gc.ts:105`. Plus test references.
- `grep -nR "stimuli/.triage" src` — at least one hit at `src/cli/commands/pipeline/runs-gc.ts` (the new sweep path).
- `grep -nR "sweepCommand\|apparat sweep" src` — at least three hits: `src/cli/commands/sweep.ts`, `src/cli/program.ts`, `src/cli/tests/sweep.test.ts`.

Behaviour invariants:

- No new tracer fields. `pipeline-start` / `pipeline-end` JSONL events byte-identical to today.
- No new pipeline-level CLI flag. No new env var. The new top-level `apparat sweep` command and its `--dry-run` flag are the only command-surface additions.
- ADR-0015's green-tail reaper invariant unchanged for run-folder and illuminations-triage paths; stimuli-triage path added under the same gate (success-only).
- Lifecycle `consume`/`consume_plan` MCP tools still exist; just no longer invoked from the deleted memory-writer (see §9.2).

## 9. Open questions

### 9.1 Tail-commit safety net (PR1)

`memory-writer.md` step 5 (`git add -A` + commit) absorbed any uncommitted residue from upstream nodes. Each upstream committer (`design-writer`, `plan-writer`, `implement`, `tmux-tester`) commits its own work in-flight, so the residue is usually empty — but the safety net is real. **Open:** does PR1's landing session need to verify each upstream contract's in-flight commit discipline by grep before merging, or is the safety net redundant in practice?

Default position: grep each upstream agent contract for `git commit` before the PR lands; if every node commits before exit, the safety net is provably redundant. If any node defers commit to memory-writer, that node's contract needs a one-line `git add -A && git commit` step inserted before PR1 lands. The implementer's first task in PR1 is this grep + (if needed) per-node patch.

### 9.2 Lifecycle consume relocation (PR1)

`memory-writer.md:144-156` calls `consume_plan` and `consume` to mark the plan + illumination as `implemented` on success. Deleting memory-writer removes this auto-consumption. **Open:** where does the responsibility move?

Three options:
- **A.** A new thin tool node at the tail (e.g., `consume_plan_and_illumination`) that runs only the lifecycle calls. Adds one node to each pipeline.
- **B.** Inline the consume calls into a different existing node (e.g., `tmux-tester`'s success path). Couples the lifecycle to verification, which is roughly what memory-writer's pre-check at step 7 already enforced via `$tmux_tester_test_result`.
- **C.** Drop auto-consume entirely. The operator runs `apparat sweep` to clean up sessions, and runs the existing `consume` MCP tool (or `apparat pipeline run consume` if such a shim exists) explicitly when they want to retire a plan or illumination.

The operator's `.apparat/notes.md` did not address this directly. Default position: **C** — defer to manual operator workflow until the gap is observed in practice. If lifecycle artifacts pile up post-merge, ship a thin tail node (option A) as a follow-up.

### 9.3 Sessions sediment cleanup (post-merge operator action)

PR1 stops the producer but does not retroactively delete the existing 56 files in `.apparat/sessions/`. **Open:** should the PR1 landing commit also include the `rm -rf .apparat/sessions/` for this repo specifically?

Default position: **no** — `apparat sweep` is exactly the tool for this; the operator runs it once post-merge and the sediment goes. PR1 stays minimal (code + contracts only).

### 9.4 README GC section update

`README.md` mentions GC behaviour (per ADR-0015 §Consequences). After PR1+PR2+PR3, the README needs to reflect: (a) sessions no longer written; (b) `apparat sweep` is available for operator-driven cleanup; (c) `APPARAT_RUNS_KEEP` semantics unchanged from ADR-0015. **Open:** does the README edit ride with PR1, PR2, or its own commit? Default: edit-with-PR2 since `apparat sweep` is the new operator-visible surface; PR1's pipeline.dot rewires are not user-facing.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `memory_writer\|memory_reflector` in `.apparat/pipelines/` — zero hits (PR1 verification).
- Grep `apparat/sessions` in `.apparat/pipelines/` — zero hits (PR1 verification).
- Grep `stimuliTriageDir\|stimuli/.triage` in `src/cli/commands/pipeline/runs-gc.ts` — present (PR3 verification).
- Grep `sweepCommand` in `src/cli/commands/sweep.ts` — present; in `src/cli/program.ts` — at least one import + one call (PR2 verification).

### 10.2 Tests

- `npx vitest run src/cli/tests/post-tail-gc.test.ts` — all cases pass with stimuli/.triage/ assertions added.
- `npx vitest run src/cli/tests/sweep.test.ts` — passes (new file).
- `npx vitest run src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts` — either deleted (expected: file not found) or rewritten and passing.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline validate illumination-to-implementation --project .` — exits 0 (post-PR1 rewire).
- `apparat pipeline validate parallel-illumination-to-implementation --project .` — exits 0 (post-PR1 rewire).
- `apparat pipeline run illumination-to-implementation .` against a fixture project; on green completion: confirm `.apparat/sessions/` has zero new files; confirm `.apparat/runs/<runId>/`, `.apparat/meditations/illuminations/.triage/<runId>/`, and `.apparat/meditations/stimuli/.triage/<runId>/` are all swept.
- `apparat sweep --dry-run .` — prints the size+tag list and exits 0.
- `apparat sweep .` — interactive; selecting scratch defaults and confirming removes them; curated entries untouched.
- `apparat sweep /tmp/nothing-here` — exits 1 with "no `.apparat/` found".

### 10.4 Negative cases

- `apparat pipeline run illumination-to-implementation` on a pipeline file that still references `memory_writer` (pre-PR1 backup file) — validator catches the dangling edge and exits 1.
- `apparat sweep` against a folder whose `.apparat/sessions/` is empty — sessions row shows 0 MB and is still selectable; no error.
- `apparat sweep` against a folder with no `.apparat/runs/` — runs row is absent from the list, not shown as 0-entries; sweep proceeds normally for other entries.
- Two parallel `apparat sweep` invocations on the same project — second sweep ENOENT-tolerates anything the first already deleted (via `force: true` on `rmSync`).
- `gcRunScopedArtefactsOnSuccess` with a runId that has only stimuli/.triage/ on disk (no runs/, no illuminations/.triage/) — all three `rmSync` calls run; missing paths are silent no-ops per `force: true`.

## 11. Summary

ADR-0015 shipped a clean green-tail reaper but left two failure-mode artifacts on disk and miscategorised one substrate: `.apparat/sessions/` is written by both `illumination-to-implementation/memory-writer.md:49` and `parallel-illumination-to-implementation/memory-writer.md:49` then committed + pushed every run (steps 5-6 of both contracts), and is consumed only by their sibling `memory-reflector.md:38` — zero external readers. The operator's own `.apparat/notes.md` contradicted ADR-0015's "institutional memory" claim for sessions within 24h. Separately, `gcRunScopedArtefactsOnSuccess` at `src/cli/commands/pipeline/runs-gc.ts:105-110` sweeps `.apparat/runs/<runId>/` and `.apparat/meditations/illuminations/.triage/<runId>/` on green but never `.apparat/meditations/stimuli/.triage/<runId>/` — 14 dirs sediment there as a result. No operator surface exists for any of this: `apparat sweep`, `apparat janitor`, and `apparat gc` are all absent from `src/cli/program.ts` registrations (the `janitor` name is taken by the read-only scanner pipeline at `src/cli/pipelines/janitor/janitor.md:2-3` — reusing it on a mutating CLI would be a collision).

This design ships three independently revertable PRs: **(PR1)** delete `memory-writer.md` and `memory-reflector.md` from both pipelines, rewire `pipeline.dot` to route `review_gate -> done [label="Approve"]` and `tmux_confirm_gate -> done [label="Commit"]` past the deleted nodes, and edit ADR-0015 with one paragraph reclassifying sessions from "institutional memory" to "trash"; **(PR2)** ship a new top-level `apparat sweep [project-folder]` CLI command in `src/cli/commands/sweep.ts` registered between `meditate` (`program.ts:115`) and `pipeline` (`:127`), with an Ink interactive list of `.apparat/` substrates tagged curated (`illuminations/*.md`, `stimuli/*.md`, `pipelines/`, `scenarios/`, `notes.md`, `lessons/`, `reasoning-memory/` — warn before delete) vs scratch (`runs/<runId>/`, both `.triage/<runId>/`, `sessions/` — default selectable) and a `--dry-run` flag; **(PR3)** one-line patch to `gcRunScopedArtefactsOnSuccess` at `runs-gc.ts:105-110` adding `rmSync` for the stimuli triage path on green, plus test updates at `src/cli/tests/post-tail-gc.test.ts`.

ADR-0015 stands without a successor — no ADR-0016. The refined scope explicitly dropped from the original illumination's seven-step plan: the automatic failure-bucket reaper with `APPARAT_FAILED_KEEP=5` (failed-run scratch keeps forensic value, per the operator's verba-extension `runs/` + `reasoning-memory/` reference); the universal `pipeline validate` rule forcing every new `.apparat/<thing>/` to declare a reaper (not every substrate is reapable); and pre-rule retroactive cleanup of sedimented `.apparat/` content (the new `apparat sweep` is exactly the operator surface for that). Each PR is a different surface — pipeline contract layer (PR1), CLI command layer (PR2), library layer (PR3) — and revertable independently with no shared mid-train state.

Blast radius is **S/M** — ~16 files across three PRs: 10 in PR1 (4 contract deletes + 2 `pipeline.dot` edits + 1 ADR edit + 2 docs/superpowers/plans/ ripple edits + 1 test edit) + 4 in PR2 (1 new command + 1 program.ts edit + 1 new test + 1 README edit) + 2 in PR3 (1 library edit + 1 test edit). No breaking changes for external consumers — `memory_path` is internal to the deleted memory-writer→memory-reflector pair with zero external readers; `gcRunScopedArtefactsOnSuccess`'s signature is unchanged; `apparat sweep` is pure addition. No new tracer fields, no new env var, no `.dot` schema change, no engine handler-surface change, no agent rubric change. Lifecycle `consume`/`consume_plan` calls previously embedded in memory-writer step 7 (`memory-writer.md:144-156`) are lost with the file deletion; open question §9.2 defers their relocation to a follow-up cycle on the manual-operator-workflow default.
