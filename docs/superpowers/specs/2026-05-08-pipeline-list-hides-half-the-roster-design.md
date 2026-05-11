# Design: `pipeline list` lists the whole roster (bundled + local), grouped + fork-aware

> **Superseded** for the cross-verb surface by `docs/superpowers/specs/2026-05-11-mission-control-three-doors-one-room-design.md`. The cluster-deepening insight remains valid; the chosen surface (deepening `pipeline list` alone) was replaced by collapsing three verbs into one `apparat status [project] [pipeline] [runId]`.

**Date:** 2026-05-08
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2210-pipeline-list-hides-half-the-roster.md`

## 1. Motivation

`apparat pipeline list` walks **only** `<project>/.apparat/pipelines/`. The pipeline resolver — the runtime gate that turns a name like `meditate` into a runnable `.dot` path — walks **both** project-local tiers *and* the bundled tier. The two surfaces disagree about what exists.

Direct evidence:

- `src/cli/commands/pipeline/list.ts:11-44` — `pipelineListCommand` calls `getPipelinesDir(project)` once and stops there. The empty branch at `:23` prints:
  ```ts
  await output.info(`No workflows found in ${pipelinesDir}.\nCreate one with: apparat pipeline create <name> --project ${project}`);
  ```
  — and `apparat pipeline create` is not a registered command (`src/cli/program.ts:107-205` registers the `pipeline` group; sub-commands `run` at `:109`, `validate` at `:142`, `list` at `:161`, `trace` at `:176`, `show` at `:186`; no `.command("create")` between them).
- `src/cli/lib/pipeline-resolver.ts:18-38` — `resolvePipelineArg` walks three tiers in order: project-local folder-form (`<project>/.apparat/pipelines/<name>/pipeline.dot`), project-local flat-form (`<project>/.apparat/pipelines/<name>.dot`), then bundled fallback via `resolveBundledPipeline`.
- `src/cli/lib/assets.ts:29-38` — `resolveBundledPipeline` resolves names against `getBundledPipelinesDir()` (i.e. the `pipelines/` folder bundled with the npm package).
- Bundled pipelines on disk today: `src/cli/pipelines/implement/pipeline.dot`, `src/cli/pipelines/janitor/pipeline.dot`, `src/cli/pipelines/meditate/pipeline.dot`.

The user-visible contradiction:

```
apparat init my-app
cd my-app
apparat pipeline list           # → "No workflows found in …/pipelines/.\nCreate one with: apparat pipeline create …"
apparat pipeline run janitor    # → succeeds (resolved via bundled fallback)
```

The "fix" hint points at a non-existent command. The discovery surface lies; the runtime quietly does the right thing. The two-tier discovery model is documented (`docs/adr/0007-ralph-folder-as-project-local-home.md:20`, `CONTEXT.md` two-tier description, `docs/VISION.md`) and implemented in the resolver — but the listing surface contradicts it.

A second drift falls out of the same gap. The bundled inventory (`implement`, `janitor`, `meditate`) is hand-listed in two places that nothing forces to stay in sync with `src/cli/pipelines/`:

- `src/cli/program.ts:21-77` — `addHelpText` block names `meditate`, `implement`, and `pipeline workflow.dot` directly in prose.
- `README.md` — commands section enumerates the same names.

(`src/cli/skills/apparatus/pipelines.md:33` references the bundled fallback concept but does not hand-list names — verifier downgraded the original "three drift channels" claim to two.)

The resolver and the listing are two implementations of the same two-tier walk. There is no shared seam. Adding a fourth bundled pipeline lights up `pipeline run <name>` automatically and lights up `pipeline list` not at all. This is exactly the parallel-implementation drift the `deep-modules-hide-complexity` stimulus warns against.

The fix is small and concentrated: **hoist the resolver's two-tier walk into a shared `listAllPipelines(project)` seam** and have `pipeline list` render its result. Drop the lying `create` hint at the same touch. Replace the hand-listed bundled names in `program.ts` `addHelpText` and `pipelines.md` with a pointer at `apparat pipeline list`. Add a parity vitest so resolver-vs-list drift becomes a red test.

## 2. Decision summary

1. **Add `listAllPipelines(project): PipelineEntry[]` in `src/cli/lib/pipeline-resolver.ts`.** Returns the full roster across both tiers — project-local folder-form, project-local flat-form, bundled — with origin tag, absolute path, and fork detection. Same walk order as `resolvePipelineArg` (`pipeline-resolver.ts:28-37`) so the two surfaces are mechanically identical.

2. **Rewrite `pipelineListCommand` to render `listAllPipelines`** (`src/cli/commands/pipeline/list.ts`). Group by origin under two headers: `Local pipelines:` (folder-form + flat-form) and `Bundled pipelines:`. Mark fork pairs on **both** sides — `<name> (forked → local)` on the local row and `<name> (shadowed by local)` on the bundled row — so an operator can see both why their local copy will win and which bundled name is still reachable by removing the local copy.

3. **Drop the lying `apparat pipeline create` hint** at `list.ts:16` and `:23` while in the file. There is no replacement hint in the empty-state copy — telling the user how to author a pipeline is the job of the authoring docs in `src/cli/skills/apparatus/pipelines.md`, not a CLI nudge.

4. **Replace hand-listed bundled names with a pointer at `pipeline list`** in two places:
   - `src/cli/program.ts:21-77` `addHelpText` — the bundled-name prose collapses to a single line: `Run 'apparat pipeline list' to see runnable pipelines (bundled + local).`
   - `README.md` commands section — same treatment.

5. **Add a parity vitest** at `src/cli/tests/pipeline-list-resolver-parity.test.ts`. For every name returned by `listAllPipelines(project)`, `resolvePipelineArg(name, project)` must return a path that exists on disk. Drift between the two surfaces becomes a red test, not a silent UX bug.

6. **Migrate `pipeline-preflight.test.ts:106-109`** off the brittle `.slice(noInputsIdx, withInputsIdx)` pattern onto per-line parsing so it survives bundled rows being added to the listing. This is the only known breaking ripple in the test suite.

7. **Atomic landing.** One commit (or one PR) lands all six items. Staging would create an intermediate state where the resolver and listing still disagree (e.g. seam landed, command not yet rewritten), or where the help text says "see `pipeline list`" but `pipeline list` still hides the bundled tier.

The `--origin bundled|local|all` flag stays out of scope (stretch only — refinement log, round 1).

## 3. Architecture

### 3.1 Before / after

```
Before (today)                                  After
──────                                          ─────
pipeline list --project x                       pipeline list --project x
  list.ts:13  getPipelinesDir(project)            list.ts (rewritten)
  list.ts:15  exists? else "No pipelines/                1. listAllPipelines(project)
                folder. Create one with:                       (pipeline-resolver.ts seam)
                apparat pipeline create"                  2. group entries by origin
  list.ts:20  read .dot files in dir              3. render "Local pipelines:" group
  list.ts:22  empty? "No workflows found.            (forked rows tagged "(forked → local)")
                Create one with: apparat              4. render "Bundled pipelines:" group
                pipeline create"                        (shadowed rows tagged
  list.ts:28  for each .dot:                            "(shadowed by local)")
                parseDot                          5. dropping both broken create hints
                print "name + goal + reqs"

resolver: walks 3 tiers (folder, flat, bundled)
listing:  walks 1 tier  (project folder)         resolver and listing share one seam:
   ─ silent drift, lying empty-state ─              listAllPipelines(project)

program.ts:21-77 addHelpText                     program.ts:21-77 addHelpText
  hand-lists meditate, implement, pipeline         "Run 'apparat pipeline list' to see
                                                     runnable pipelines (bundled + local)."

README.md commands section                       README.md commands section
  hand-lists meditate, implement, pipeline         points at `apparat pipeline list`
```

### 3.2 The new seam: `listAllPipelines`

```ts
// src/cli/lib/pipeline-resolver.ts (added below resolvePipelineArg)

export type PipelineOrigin = "local-folder" | "local-flat" | "bundled";

export interface PipelineEntry {
  name: string;
  origin: PipelineOrigin;
  absPath: string;            // pipeline.dot file path that resolver would return
  hasFork?: boolean;          // bundled entries: true when a local copy shadows this name
  shadowedBundled?: boolean;  // local entries:   true when a bundled name is being shadowed
}

export function listAllPipelines(project: string): PipelineEntry[];
```

Walk order matches `resolvePipelineArg` exactly (`pipeline-resolver.ts:28-37`):

1. Read `getPipelinesDir(project)` if it exists. For each immediate child:
   - Directory containing `pipeline.dot` → `local-folder` entry, `name = <dirname>`, `absPath = <dir>/pipeline.dot`.
   - File `<name>.dot` → `local-flat` entry, `name = <stem>`, `absPath = <file>`.
2. Read `getBundledPipelinesDir()` (`assets.ts:21-23`). For each immediate child directory containing `pipeline.dot` → `bundled` entry.
3. Cross-mark forks: for each bundled name that also appears as a local entry, set `hasFork=true` on the bundled entry and `shadowedBundled=true` on the local entry.
4. Sort each origin bucket by name.

Failure modes:
- `pipelinesDir(project)` does not exist → skip tier silently (no folder is a valid empty state for project-local).
- `getBundledPipelinesDir()` does not exist (improbable — it ships with the package) → skip tier silently and proceed.
- A child entry is neither a directory-with-`pipeline.dot` nor a `.dot` file → skip it (consistent with how the resolver narrows shapes today).

All file I/O is `existsSync` + `readdirSync` + `lstatSync`. No `parseDot` call inside the seam — discovery is structural, not semantic. Goal/`inputs=` rendering is the renderer's responsibility (it already calls `parseDot` per entry today; that stays).

### 3.3 Rewritten `pipelineListCommand`

```ts
// src/cli/commands/pipeline/list.ts (sketch)

import { resolve } from "path";
import { readFileSync } from "fs";
import { parseDot } from "../../../attractor/core/graph.js";
import { listAllPipelines, PipelineEntry } from "../../lib/pipeline-resolver.js";
import * as output from "../../lib/output.js";

export interface PipelineListOptions { project?: string; }

export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const entries = listAllPipelines(project);

  const local = entries.filter(e => e.origin !== "bundled");
  const bundled = entries.filter(e => e.origin === "bundled");

  await output.info("Local pipelines:");
  if (local.length === 0) {
    await output.info("  (none)");
  } else {
    for (const e of local) await renderEntry(e);
  }
  await output.info("");
  await output.info("Bundled pipelines:");
  if (bundled.length === 0) {
    await output.info("  (none)");
  } else {
    for (const e of bundled) await renderEntry(e);
  }
}

async function renderEntry(e: PipelineEntry): Promise<void> {
  let goal = "(no goal defined)";
  let requires: string[] | undefined;
  try {
    const graph = parseDot(readFileSync(e.absPath, "utf8"));
    if (graph.goal) goal = `"${graph.goal}"`;
    if (graph.inputs && graph.inputs.length > 0) requires = graph.inputs;
  } catch {
    goal = "(unreadable)";
  }
  const tag =
      e.shadowedBundled ? " (forked → local)"
    : e.hasFork         ? " (shadowed by local)"
    : "";
  await output.info(`  ${(e.name + tag).padEnd(34)} ${goal}`);
  if (requires) await output.info(`  ${"".padEnd(34)} requires: ${requires.join(", ")}`);
}
```

Renderer notes:

- The padding column widens from today's 20 to 34 to fit the longest realistic shadow/fork suffix (e.g. `illumination-to-implementation (forked → local)`). Exact width is a tuning concern the implementation can revisit; per-row is fine, the seam doesn't care.
- A bundled entry whose `pipeline.dot` is missing a `goal=` (e.g. `meditate` today, `src/cli/pipelines/meditate/pipeline.dot:1`) renders as `(no goal defined)`. The renderer never lies about goals it cannot read.
- The renderer does **not** call `loadPipeline`/`validateGraph`. Discovery is structural. (A separate spec — `2026-05-07-pipeline-mission-control-fragmentation-design.md` — proposes deepening `list` into a status card. This design intentionally does *not* take that step. The two designs compose: when mission-control lands, the deepened renderer iterates the same `listAllPipelines` output.)

### 3.4 Sample output

Fresh `apparat init`-ed project:

```
Local pipelines:
  (none)

Bundled pipelines:
  implement                          "Autonomous implementation loop"
                                     requires: scenarios_dir
  janitor                            "Reconcile illumination/plan lifecycle and surface doc drift / dead code"
                                     requires: project
  meditate                           (no goal defined)
                                     requires: steer
```

Project with one local pipeline plus a forked `janitor`:

```
Local pipelines:
  illumination-to-implementation     "Triage an illumination into an approved design doc, implementation plan, and committed code"
                                     requires: project, illumination_path
  janitor (forked → local)           "Reconcile illumination/plan lifecycle and surface doc drift / dead code"
                                     requires: project

Bundled pipelines:
  implement                          "Autonomous implementation loop"
                                     requires: scenarios_dir
  janitor (shadowed by local)        "Reconcile illumination/plan lifecycle and surface doc drift / dead code"
                                     requires: project
  meditate                           (no goal defined)
                                     requires: steer
```

These match the chat refinement's accepted shape verbatim (`chat_session.output`, refinement round 1).

**Scope contraction vs. illumination step 3.** The originating illumination's step 3 ("Surface caller-var contracts inline … pull descriptions from `inputs:` / `outputs:` blocks") proposed pulling caller-var **descriptions** from each pipeline's agent frontmatter so each `requires:` name carries a one-line hint. The explainer's "Scope" block (which the user approved at the gate) does not include that step — it lists only the seam, the rewrite, the dropped create-hint, the addHelpText/skill-doc simplifications, and the parity vitest. In `chat_session.output` the chat node re-surfaced step 3 as an explicit refinement question ("Want me to fold that into the example, or keep it minimal (names only) like above?"); the user's recorded reply was the unchanged "sounds good" / `Approve` from the explainer gate, not an affirmative pull-in. Per the refinement-log discipline ("every bullet honored unless a later bullet explicitly overrides it"), step 3 stays out. The design preserves the seam shape so a later, additive change to `renderEntry` can pull descriptions from agent frontmatter without re-shaping `listAllPipelines`.

### 3.5 Help-text + skill-doc simplifications

`src/cli/program.ts:21-77` — the `addHelpText` block currently hand-lists `meditate`, `implement`, and `pipeline workflow.dot` in prose. Two specific edits:

- Lines `:30-31` (`apparat implement my-app …`) — keep. `implement` is the canonical first-run UX; the `addHelpText` block is itself the discovery channel for that UX, and it does not pretend to enumerate the bundled tier when it names the canonical entry point.
- Lines `:43-49` (`Pipeline engine (DOT-graph workflows)` block) — replace the hand-listed bundled-name examples with one line:
  ```
  Pipeline engine (DOT-graph workflows):
    apparat pipeline list --project my-app             List runnable pipelines (bundled + local)
    apparat pipeline validate workflow.dot             Check a pipeline file for errors
    …
  ```
  No bundled name appears in this prose. The "list" line is the signpost; the catalogue lives in `pipeline list` output.

`src/cli/skills/apparatus/pipelines.md:33` — currently reads:
> "Pipelines are discovered by folder. The folder name is the pipeline name. There is no pipeline registry — what's on disk under `<project>/.apparat/pipelines/` (and the bundled fallback `<npmRoot>/apparat-cli/dist/pipelines/`) is what `pipeline list` returns."

The accuracy subagent flagged that the parenthetical promises something `pipeline list` does not yet deliver (it returns only project-local). **Today the line over-promises**; after this change the over-promise is retired without editing the doc — the seam makes the sentence true as written. **No edit needed here** — the skill doc is already correctly aligned with the post-fix behavior; only `program.ts addHelpText` needs the simplification. (The illumination's "three drift channels" claim is downgraded to two channels because of this.)

### 3.6 README ripple

`README.md` commands section (the verifier flagged this) — replace any prose that hand-lists bundled pipeline names with a pointer at `apparat pipeline list`. Exact lines TBD by the implementing session; the design's contract is "the doc no longer enumerates `implement|janitor|meditate` as if it were authoritative".

### 3.7 Surfaces unchanged

- `Graph` type, `parseDot`, `validateGraph`, `loadPipeline`, `resolvePipelineArg` signatures. Unchanged.
- `pipeline run`, `pipeline validate`, `pipeline trace`, `pipeline show`, `heartbeat *`, `meditate`, `implement`, `init`. Unchanged.
- `--project` surface on `pipeline list`. Unchanged.
- Pipeline `.dot` syntax and agent rubric. Unchanged.
- Daemon IPC. No new caller, no new endpoint.
- Bundled-pipelines folder layout (`src/cli/pipelines/<name>/pipeline.dot`). Unchanged. Names are not relocated.

## 4. Components & files

### 4.1 New code

| Symbol | File | Responsibility |
|---|---|---|
| `listAllPipelines(project)` | `src/cli/lib/pipeline-resolver.ts` (added) | Two-tier walk; returns sorted `PipelineEntry[]` with origin + fork tags |
| `PipelineEntry`, `PipelineOrigin` | `src/cli/lib/pipeline-resolver.ts` (added) | Public shape for renderers to consume |

Tests:

| Test file | What it covers |
|---|---|
| `src/cli/tests/pipeline-list-resolver-parity.test.ts` (new) | For every name from `listAllPipelines(project)`, `resolvePipelineArg(name, project)` returns an existing path. Run on a temp project that exercises all three tiers (folder, flat, bundled-shadowing) plus a fresh-init project (bundled only). |

### 4.2 Rewritten

| File | Treatment |
|---|---|
| `src/cli/commands/pipeline/list.ts` | Full rewrite — composes `listAllPipelines`, groups by origin, marks forks, drops both create hints. ~50 LOC. |

### 4.3 Inline edits

| File | Edit |
|---|---|
| `src/cli/program.ts:43-49` | Replace bundled-name prose in the pipeline-engine block with a `pipeline list` signpost. |
| `README.md` | Replace any commands-section hand-listing of bundled names with a pointer at `apparat pipeline list`. |

### 4.4 Test ripples

| File | Treatment |
|---|---|
| `src/cli/tests/pipeline-preflight.test.ts:77-110` | Migrate from `combined.slice(noInputsIdx, withInputsIdx)` (`:106-109`) to per-line parsing. The slice trick depends on local-only ordering; bundled rows in the new output break the assumption but the underlying assertion (legacy pipelines have no `requires:` line) is portable to per-line parsing. |
| `src/cli/tests/pipeline.test.ts` (existing `pipelineListCommand` cases) | Audit and migrate any assertion that depends on the legacy single-header `Pipelines in <dir>/` shape. The new shape is two grouped headers (`Local pipelines:` / `Bundled pipelines:`). Existing per-pipeline goal/`requires:` line assertions can stay. |
| `src/cli/tests/pipeline-resolver.test.ts` | Add coverage for `listAllPipelines` directly: empty project (bundled only), project with one local pipeline (no fork), project with a fork pair (both rows marked). |

(The verifier listed `pipeline.test.ts`, `pipeline-preflight.test.ts`, and `pipeline-resolver.test.ts` as the test ripple set; the new parity test is `pipeline-list-resolver-parity.test.ts`.)

## 5. Data flow

### 5.1 `pipeline list --project x`

```
apparat pipeline list --project x
  → src/cli/commands/pipeline/list.ts pipelineListCommand
    → listAllPipelines(project)                    [src/cli/lib/pipeline-resolver.ts]
        existsSync(getPipelinesDir(project))?
          for each child of pipelinesDir:
            <child>/pipeline.dot       → local-folder entry
            <child>.dot                → local-flat entry
        existsSync(getBundledPipelinesDir())?
          for each child:
            <child>/pipeline.dot       → bundled entry
        cross-mark forks (bundled name ∈ local names)
        sort each bucket by name
    → group by origin (local | bundled)
    → for each entry:
         readFileSync + parseDot → goal + inputs   [renderer]
         output.info name + tag + goal
         output.info requires: line if any
```

One I/O sweep per tier; no daemon RPC; no `loadPipeline`. The same disk surfaces the resolver consults (`pipeline-resolver.ts:28-37`, `assets.ts:29-38`) are consulted, in the same order, in one call.

### 5.2 Parity contract

```
for each name in listAllPipelines(project).map(e => e.name):
  resolvePipelineArg(name, project) must succeed and return an existing path
```

This is the parity test's body. Drift between resolver and listing fails this test.

## 6. Blast radius / impact surface

- **Size:** **M** by file count, **S** by surface count.
  - File count: 1 new test + 1 new exported symbol pair (`listAllPipelines` + types) + 1 rewritten command + 2 inline edits (program.ts, README.md) + 3 test-file ripples = ~8-13 files.
  - Surface count: CLI (`pipeline list`), library (`pipeline-resolver.ts`), help text, README, tests. No daemon IPC, no agent surface, no `.dot` schema change.
- **Files touched (enumerated):**
  - **New:** `src/cli/tests/pipeline-list-resolver-parity.test.ts`.
  - **Edited (added export):** `src/cli/lib/pipeline-resolver.ts` (`listAllPipelines` + types).
  - **Rewritten:** `src/cli/commands/pipeline/list.ts`.
  - **Inline edits:** `src/cli/program.ts:43-49` (help-text block); `README.md` (commands section).
  - **Test ripples:** `src/cli/tests/pipeline-preflight.test.ts:77-110` (move off `.slice` to per-line parsing), `src/cli/tests/pipeline.test.ts` (audit list-shape assertions), `src/cli/tests/pipeline-resolver.test.ts` (cover `listAllPipelines` directly).
- **Surfaces crossed:**
  - **CLI (`pipeline list`)** — output shape changes from one header + one bucket to two grouped headers (`Local pipelines:` / `Bundled pipelines:`). Empty-state copy changes. Fork suffixes appear on shadowed/forked rows.
  - **Library** — new exported symbol `listAllPipelines` and supporting types. No existing symbol changes.
  - **Help text + README** — bundled names disappear from prose; a single signpost line replaces them.
  - **Tests** — one new file; one assertion-style migration; existing list-shape assertions audited.
- **Breaking changes (named):**
  - **`pipeline list` output shape**. Headers change (`Pipelines in <dir>/` → two grouped headers). Bundled rows appear that previously did not. Per the chat refinement and the original illumination, this is the *intended* contract change — there is no flag-toggle. Scripts that grep today's output must be updated to per-line parsing or move to a future `--brief` shape (out of scope here; that flag belongs to the mission-control design).
    - Single concrete test break identified: `src/cli/tests/pipeline-preflight.test.ts:106-109` uses `combined.slice(noInputsIdx, withInputsIdx)` — refactor to per-line parsing. No CLI-flag break, no exported-symbol break, no `--project` surface change.
- **Spec / docs ripple checklist:**
  - [ ] `README.md` commands section — replace bundled-name prose with `apparat pipeline list` pointer.
  - [ ] `CONTEXT.md` two-tier description — verify it still reads correctly after this change (the verifier flagged it but reading it now shows it describes the resolver's two-tier model, which becomes accurate of the listing surface too — likely no edit needed; flag for the implementing session to confirm).
  - [ ] `src/cli/program.ts:43-49` `addHelpText` — single-line signpost replaces hand-listed names.
  - [ ] `docs/superpowers/plans/2026-04-30-bundle-pipelines-under-src-cli.md` and `docs/superpowers/plans/2026-04-30-bundle-janitor-pipeline.md` — verifier flagged these as doc edges; audit for outdated `pipeline list` claims. **Audit policy:** non-blocking — if stale, update in the same PR; if no semantic change is needed, leave as-is and note the audit result in the implementation plan. The atomic-landing constraint applies to the source change, not to historical plan-doc copy-edits.
  - [ ] No ADR required. ADR-0007 (`docs/adr/0007-ralph-folder-as-project-local-home.md`) and ADR-0008 already endorse the two-tier resolver decision; this change closes the discovery surface for that decision rather than introducing a new principle.
- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/pipeline-list-resolver-parity.test.ts` — for every entry in `listAllPipelines`, `resolvePipelineArg(name, project)` must succeed and return a path that exists on disk. Cover at least: bundled-only project (post-`init` fresh), project with one local pipeline, project with a forked bundled name (both rows tagged correctly).
  - [ ] **Migrate** `src/cli/tests/pipeline-preflight.test.ts:77-110` — replace `.slice(noInputsIdx, withInputsIdx)` with line-by-line parsing. Underlying assertion ("legacy pipeline rows have no `requires:` line") preserved.
  - [ ] **Audit + adjust** `src/cli/tests/pipeline.test.ts` `pipelineListCommand` cases — header-shape assertions migrate to the new two-group layout; per-row goal/`requires:` assertions stay.
  - [ ] **Extend** `src/cli/tests/pipeline-resolver.test.ts` — direct unit coverage for `listAllPipelines`: empty-bucket cases, fork-marking on both rows, alphabetical sort within bucket.

## 7. Trade-offs

### 7.1 Render bundled rows always vs. flag-gated

Always-on was chosen. Reasons:

- The illumination's framing is "the listing lies" — solving the lie demands the truth be the default, not a flag opt-in. A flag-gated bundled view leaves the empty-state still wrong.
- The chat refinement accepted the always-on shape with no carve-outs (`chat_summarizer` round 1).
- Scripts can move to `--brief` (a future addition aligned with the mission-control design) or to per-line parsing today.

### 7.2 Cross-mark forks on both rows vs. one row

Both rows carry the tag. Reasons:

- Operator question 1 ("why did `pipeline run janitor` use my local copy?") is answered by the `(forked → local)` tag on the local row.
- Operator question 2 ("how do I get back to the bundled `janitor`?") is answered by the `(shadowed by local)` tag on the bundled row — the bundled name is still listed, the operator knows what to delete to fall back.
- One-sided tagging would force the operator to remember resolver precedence; the listing should make precedence visible.

### 7.3 Discovery-only seam vs. status-card seam

The seam returns *structural* metadata only (name, origin, absPath, fork tag). It deliberately does **not** call `loadPipeline`/`validateGraph`. Reasons:

- The mission-control design (`docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md`) layers validity/schedule/last-run/SVG-freshness on top of discovery. Coupling that into the seam now would either force the seam to take optional flags (shallow API smell) or lock mission-control into reading raw `PipelineEntry` plus re-deriving status (duplicative).
- Two designs compose: this seam is the *iterator*; mission-control's renderer composes `listAllPipelines` with `pipeline-status.ts` helpers per entry. Today's `parseDot`-per-entry stays in the renderer of `list.ts` exactly as it is.

### 7.4 Drop the create hint vs. fix it

Drop. Reasons:

- The chat refinement explicitly named the broken hint as something to drop; no proposal to write a `pipeline create` command appeared.
- The `2026-05-07T1938-authoring-loop-cold-and-templates-empty.md` illumination addresses C/U/D verbs as a separate body of work. This design is the **R** verb completion. Embedding a placeholder `create` hint here would hand-wave at scope it doesn't own.
- The empty-state copy already gives the operator a start: they see `Bundled pipelines:` populated with three runnable names. No nudge is needed.

### 7.5 `--origin bundled|local|all` flag

Out of scope. Reasons:

- The chat refinement did not pull the flag in when invited (`chat_summarizer` round 1, second bullet). User accepted the explainer's "stretch only" framing.
- The two-group shape with explicit headers is already a queryable surface — `apparat pipeline list | sed -n '/Bundled/,$p'` works. Scripts that need automation should bind to a future `--json` or `--brief` flag aligned with the mission-control design, not to a one-off `--origin` filter.

### 7.6 Atomic vs. staged

Staged would split this into "add seam" → "rewrite list" → "drop hand-listed names". Reasons to ship together:

- Each item alone leaves the gap partially open. Seam without rewrite: the lying listing persists. Rewrite without help-text edit: prose still claims a smaller catalogue than the listing.
- Test edits are correlated (preflight `.slice` migration, parity test, `pipeline.test.ts` shape audit). Staging brittles the test suite during the staging window.
- One developer, one machine. No rollout cohort.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — including the new parity test, the migrated preflight assertions, and any audited assertions in `pipeline.test.ts`.
  - On a fresh `apparat init`-ed project, `apparat pipeline list` lists `Bundled pipelines:` containing `implement`, `janitor`, `meditate` (the three on-disk names at `src/cli/pipelines/<name>/pipeline.dot`), and `Local pipelines:` rendered as `(none)`.
  - `apparat pipeline run janitor --project <fresh-init-project>` resolves and runs as today.
  - On a project with a forked bundled name, the listing shows both rows tagged correctly.
- Repo-wide grep invariants post-merge:
  - `src/cli/commands/pipeline/list.ts` does not contain the string `apparat pipeline create`.
  - `src/cli/lib/pipeline-resolver.ts` exports `listAllPipelines`.
  - `src/cli/program.ts` `addHelpText` block does not enumerate `meditate|implement` as bundled-pipeline examples in the `Pipeline engine` section.
  - `README.md` commands section refers to `apparat pipeline list` for bundled-pipeline discovery rather than naming bundled pipelines inline.
- Behaviour invariants:
  - The same name resolves to the same `.dot` path under both `listAllPipelines` and `resolvePipelineArg`. This is enforced by the parity test.
  - Discovery is purely structural — `listAllPipelines` does not call `parseDot` or `validateGraph`. Only the renderer in `list.ts` calls `parseDot`, and only to extract `goal` + `inputs` for display.

## 9. Open questions

- **Renderer column-width policy — predictability vs. responsiveness?** Section 3.3's sketch widens the constant to 34; section 3.4's sample output reflects that. The truly open dimension is *policy*: a fixed constant gives predictable cross-project output (good for human pattern-matching across projects), while a per-call max gives tight rows when no fork tag is present (good for narrow terminals on bundled-only projects). Today's `padEnd(20)` (`list.ts:41`) is constant. The implementation may pick either; surface the choice in the implementing session's plan rather than silently locking it in.
- **Should `listAllPipelines` deduplicate name collisions across the two project-local sub-tiers (folder + flat)?** Today `resolvePipelineArg` prefers folder over flat. If a project has both `<dir>/<name>/pipeline.dot` and `<name>.dot`, the resolver returns the folder path; the flat file is unreachable. The seam should mirror that — return only the folder entry and warn (or silently drop) the flat entry. Default: silently prefer folder; document the precedence in a one-line comment in `pipeline-resolver.ts`. The illumination did not raise this; flag for the implementing session.
- **Should the parity test exercise the flat-form sub-tier too?** `resolvePipelineArg` walks it, so the seam does too. The parity test should include a fixture that has a `<name>.dot` flat file (no sibling folder) to lock the contract. Default: yes.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `apparat pipeline create` against `src/cli/commands/pipeline/list.ts` — zero hits.
- Grep `listAllPipelines` against `src/cli/lib/` — exactly one definition site (`pipeline-resolver.ts`) and at least one consumer (`commands/pipeline/list.ts`).
- Grep `meditate|implement` against `src/cli/program.ts:21-77` — `implement` may still appear in the `Getting started` block (`:28-30`), but the `Pipeline engine` block (`:43-49`) names no bundled pipelines.

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-list-resolver-parity.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-preflight.test.ts` — passes after `.slice` → per-line migration.
- `npx vitest run src/cli/tests/pipeline.test.ts` — passes after header-shape audit.
- `npx vitest run src/cli/tests/pipeline-resolver.test.ts` — passes with new `listAllPipelines` cases.
- `npx vitest run` (full suite) — passes.

### 10.3 Smoke

- `apparat init my-app && cd my-app && apparat pipeline list` — prints two grouped headers; `Local pipelines:` shows `(none)`; `Bundled pipelines:` shows `implement`, `janitor`, `meditate`.
- `apparat pipeline run janitor --project .` — resolves and runs (regression check).
- In `my-app`, scaffold `.apparat/pipelines/janitor/pipeline.dot` (a local fork). Re-run `pipeline list` — `Local pipelines:` shows `janitor (forked → local)`; `Bundled pipelines:` shows `janitor (shadowed by local)`.
- Validate that a project with a flat-form local pipeline (`<dir>/foo.dot`, no sibling folder) appears under `Local pipelines:` with no fork tag.

### 10.4 Negative cases

- Project with no `.apparat/pipelines/` folder at all — listing shows `Local pipelines:\n  (none)\n\nBundled pipelines:\n  …` (three rows). No "create" hint.
- Project with `.apparat/pipelines/` present but empty — same as above. No "create" hint.
- Bundled folder unexpectedly absent (e.g. partial install) — `Bundled pipelines:` shows `(none)`; the listing exits 0 and renders.
- A `.dot` file that fails to parse — the row renders the name + `(unreadable)` and continues; the parity test still passes (parity is on resolver path returns, not on parse success).

## 11. Summary

`apparat pipeline list` walks one tier (`<project>/.apparat/pipelines/`); the resolver walks three (`pipeline-resolver.ts:18-38`). On a fresh project, `pipeline list` reports "No workflows found" with a hint at a non-existent `apparat pipeline create` command, while `pipeline run janitor` resolves through the bundled fallback (`assets.ts:29-38`) and runs. This design hoists the resolver's two-tier walk into a shared `listAllPipelines(project)` seam in `src/cli/lib/pipeline-resolver.ts`, rewrites `pipelineListCommand` to render that seam grouped by origin (`Local pipelines:` / `Bundled pipelines:`) with fork pairs tagged on both rows (`(forked → local)` and `(shadowed by local)`), drops the lying create hint, simplifies the bundled-name prose in `src/cli/program.ts:43-49` `addHelpText` and the `README.md` commands section to a single `apparat pipeline list` signpost, and adds a parity vitest at `src/cli/tests/pipeline-list-resolver-parity.test.ts` that fails the suite when `listAllPipelines` and `resolvePipelineArg` drift. One concrete test ripple — `src/cli/tests/pipeline-preflight.test.ts:106-109` `.slice` parsing — migrates to per-line parsing. No CLI flag changes, no exported-symbol breakage, no `.dot` schema changes, no daemon IPC changes. Blast radius is M-by-files, S-by-surfaces. Atomic landing.
