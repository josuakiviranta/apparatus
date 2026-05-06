# Design: Make the bundled `meditate` pipeline self-sufficient under `pipeline run`

**Date:** 2026-05-06
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-04T2342-meditate-pipeline-not-pipeline-run-callable.md`

## 1. Motivation

The bundled `meditate` pipeline declares `inputs="steer,vision"` (`src/cli/pipelines/meditate/pipeline.dot:2`) but only `apparat meditate <folder>` actually works — the canonical `apparat pipeline run meditate --project <folder>` invocation fails preflight because nothing supplies `vision` from the caller. The wrapper command at `src/cli/commands/meditate.ts:39-42,83` privately calls `readVisionIfPresent(absPath)` and stuffs the file contents into `--var vision=<contents>`; the `.dot` file pretends those inputs come from outside. The sibling `janitor` pipeline already solves the same problem the right way, with a `read_vision` tool node + sibling `read-vision.mjs` (`src/cli/pipelines/janitor/pipeline.dot:8-12`). One bundled pipeline stands alone; the other only works through a single shorthand.

Three forces converge:

1. **Two behaviours, one pipeline.** `apparat meditate my-app` succeeds. `apparat pipeline run meditate --project my-app` fails at the preflight reject (`src/cli/commands/pipeline.ts:240-250`) before any node executes. The README and `program.ts` hold up `pipeline run` as the canonical engine command; the bundled exemplar fails it.
2. **`VISION.md` is read in three places** — `meditate.ts:readVisionIfPresent`, `janitor/read-vision.mjs`, and any agent with `read_file`. ADR-0008 just relocated `VISION.md`; the next move forces three lockstep edits with no single seam to enforce agreement. CONTEXT.md's "concept implemented twice with no single seam" anti-pattern names the failure mode the meditation lens is supposed to flag.
3. **Heartbeat surface inflation** — `apparat heartbeat meditate <folder>` exists as its own subcommand (`src/cli/commands/heartbeat.ts:103-132`) only because the pipeline cannot run unattended without the wrapper's variable-stuffing. Fixing the pipeline collapses the bespoke heartbeat subcommand into the generic `apparat heartbeat pipeline meditate` path, advancing the active `command-surface-collapse-to-pipeline-alias` direction.

`VISION.md` declares "pipelines are the engine; apparatus is the choreography." Burying input acquisition in the wrapper command directly contradicts that line. The bundled meditate pipeline is, today, a misleading exemplar for project-local pipeline authors who copy from it.

## 2. Decision Summary

1. **Add a `read_vision` tool node to `src/cli/pipelines/meditate/pipeline.dot`** mirroring `src/cli/pipelines/janitor/pipeline.dot:8-12` exactly: `type="tool"`, `cwd="$project"`, `script_file="read-vision.mjs"`, `produces_from_stdout=true`. Wire `start -> read_vision -> meditate -> end`.

2. **Copy the script.** `src/cli/pipelines/janitor/read-vision.mjs` becomes `src/cli/pipelines/meditate/read-vision.mjs` as a sibling file. File-copy reuse per ADR-0001 — no shared helper module. The contract (read `VISION.md`, emit `{ "vision": "<contents-or-empty>" }` on stdout) is identical.

3. **Drop `vision` from the pipeline's caller-supplied `inputs`.** `inputs="steer,vision"` becomes `inputs="steer"`. After the change, only `steer` is caller-supplied; `read_vision.vision` flows in via the new tool node.

4. **Switch the agent rubric to consume the qualified input.** `src/cli/pipelines/meditate/meditate.md` frontmatter `inputs:` becomes `[steer, read_vision.vision]`; the `<vision>` body placeholder becomes `<read_vision_vision>` (the `inputs-resolver.ts`-rendered tag for a qualified input). The `meditate` agent node in `pipeline.dot` gains `default_vision=""` so a missing `VISION.md` still resolves to an empty string.

5. **Reduce `meditateCommand` to a thin shim.** `src/cli/commands/meditate.ts:61-89` shrinks to `pipelineRunCommand("meditate", { project: absPath, variables: { steer: opts.variables?.steer ?? "" } })`. `readVisionIfPresent` is deleted. PID-locking + `appendMeditateGitignore` stay (separate gap, tracked by `janitor-dual-pid-guards`).

6. **Remove the bespoke `apparat heartbeat meditate <folder>` subcommand.** `src/cli/commands/heartbeat.ts:102-132` is deleted. `apparat heartbeat pipeline meditate --project <folder> --every <n>` becomes the supported path. The deprecation lands in CONTEXT.md's glossary.

7. **New scenario: `bundled-pipelines-self-sufficient`.** A smoke-pipeline scenario at `.apparat/scenarios/bundled-pipelines-self-sufficient/` invokes each bundled pipeline through `pipeline run` with only the documented `--project` and `--var` flags it advertises in its `inputs=` declaration. Failing this test is the contract that catches the next time a pipeline secretly relies on a wrapper command.

8. **No transition release / no compat shim.** The wrapper's variable-stuffing path is removed atomically with the pipeline's self-sufficiency. Per VISION.md "personal harness for one developer, one machine — not multi-tenant", no cohort needs cross-version compatibility.

9. **`apparat meditate <folder>` shorthand survives.** It now does what `apparat heartbeat pipeline meditate` does — invokes `pipeline run meditate` with the same `--project` plumbing. The shorthand stays because the README + tab-completion habit muscle-memory references it; it stops being a special path.

## 3. Architecture

### 3.1 Before/after diagram

```
Before                                     After
──────                                     ─────
inputs="steer,vision"                      inputs="steer"

start                                      start
  └─> meditate ─> end                        └─> read_vision ─> meditate ─> end
       (vision injected by wrapper)               (reads VISION.md from
                                                   $project/VISION.md)

apparat meditate my-app                    apparat meditate my-app
  └─> readVisionIfPresent(absPath)           └─> pipelineRunCommand("meditate", {
  └─> pipelineRunCommand("meditate", {              project, variables: { steer }
        project, variables: {                    })  ← vision now self-acquired
          steer, vision: <contents>
        }
      })

apparat pipeline run meditate              apparat pipeline run meditate
  --project my-app                           --project my-app
  └─> preflight reject:                      └─> read_vision tool node
      "Missing inputs: vision"                   reads VISION.md
      → exit 1                                  └─> meditate agent runs
                                                  └─> end
```

### 3.2 Janitor-mirror approach

The change is structurally a copy of janitor's existing layout (`src/cli/pipelines/janitor/pipeline.dot:1-17`):

```
digraph janitor {
  goal="..."
  headless_safe=true
  inputs="project"

  start [shape=Mdiamond]

  read_vision [type="tool",
               cwd="$project",
               script_file="read-vision.mjs",
               produces_from_stdout=true]

  janitor [agent="janitor", default_vision=""]
  done [shape=Msquare]

  start -> read_vision -> janitor -> done
}
```

Meditate, post-change, follows the same shape. The only differences are the agent node id (`meditate` vs `janitor`), the agent name in `agent="..."`, and that meditate retains a `steer` caller input where janitor takes only `project`.

### 3.3 Surfaces unchanged

- Pipeline `.dot` syntax (`type=`, `cwd=`, `script_file=`, `produces_from_stdout=`, edge composition). Unchanged.
- Agent frontmatter schema (`inputs:`, `outputs:`, `mcp:`, `tools:`, `model:`, `permissionMode:`). Unchanged.
- `inputs-resolver.ts` qualified-input rendering rule (`<read_vision_vision>` for `read_vision.vision`). Already supported; this design relies on existing behaviour.
- Pipeline preflight semantics (`src/cli/commands/pipeline.ts:237-261`). Unchanged. The fix removes the *reason* the preflight rejects, not the preflight itself.
- `pipeline.jsonl` per-node record shape. Unchanged.
- `apparat init` scaffolding. Unchanged.
- `apparat meditate <folder>` shorthand command name. Survives, with new internals.

### 3.4 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Pipeline definition | `src/cli/pipelines/meditate/pipeline.dot` | Inline edit (add `read_vision` node, `default_vision=""` on `meditate`, drop `vision` from `inputs`, rewire edge) |
| Pipeline sibling script | `src/cli/pipelines/meditate/read-vision.mjs` | **New** (copy of `src/cli/pipelines/janitor/read-vision.mjs`) |
| Agent rubric | `src/cli/pipelines/meditate/meditate.md` | Frontmatter `inputs:` swap; body `<vision>` → `<read_vision_vision>` |
| CLI command | `src/cli/commands/meditate.ts` | Delete `readVisionIfPresent` (lines 39-42); shrink `meditateCommand` (lines 61-89) to thin shim |
| Heartbeat | `src/cli/commands/heartbeat.ts` | Delete the `meditate <folder>` subcommand block (lines 102-132) |
| Tests — meditate | `src/cli/commands/meditate.test.ts` (~12 cases on `readVisionIfPresent`) | Delete tests for the removed helper; add a unit asserting the thin-shim behaviour |
| Tests — heartbeat | `src/cli/commands/heartbeat.test.ts` | Delete cases for the removed `heartbeat meditate <folder>` subcommand |
| Tests — smoke | `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` | Update to assert `pipeline run meditate` parity with shorthand |
| Tests — new scenario | `.apparat/scenarios/bundled-pipelines-self-sufficient/` | **New** — smoke-pipeline scenario asserting every bundled pipeline runs via `pipeline run` with only declared inputs |
| Docs | `AGENTS.md` (line 25, references `meditate.ts` as bundled command); `README.md` (describes `apparat meditate` shorthand); `CONTEXT.md` (glossary deprecation note for `heartbeat meditate`) | Inline edit |

## 4. Components & file edits

### 4.1 `src/cli/pipelines/meditate/pipeline.dot`

Before (current full file):

```
digraph meditate {
  inputs="steer,vision"

  start [shape=Mdiamond];
  end   [shape=Msquare];

  meditate [shape=box, agent="meditate"];

  start -> meditate -> end;
}
```

After:

```
digraph meditate {
  inputs="steer"

  start [shape=Mdiamond];
  end   [shape=Msquare];

  read_vision [type="tool",
               cwd="$project",
               script_file="read-vision.mjs",
               produces_from_stdout=true]

  meditate [shape=box, agent="meditate", default_vision=""];

  start -> read_vision -> meditate -> end;
}
```

### 4.2 `src/cli/pipelines/meditate/read-vision.mjs`

New file. Byte-for-byte copy of `src/cli/pipelines/janitor/read-vision.mjs:1-9`:

```js
import fs from "node:fs";

let vision = "";
try {
  vision = fs.readFileSync("VISION.md", "utf8");
} catch {
  // VISION.md absent — empty string is the contract.
}
console.log(JSON.stringify({ vision }));
```

The script runs with `cwd="$project"`, so `VISION.md` resolves to `<project>/VISION.md`. The catch covers the absent-file case; combined with `default_vision=""` on the `meditate` agent node, a missing `VISION.md` produces an empty string at the agent's `<read_vision_vision>` placeholder.

### 4.3 `src/cli/pipelines/meditate/meditate.md`

Frontmatter `inputs:` block (currently lines 6-8):

```yaml
inputs:
  - vision
  - steer
```

becomes:

```yaml
inputs:
  - steer
  - read_vision.vision
```

Body placeholder (currently in the "Strategic compass" block referencing `<vision>` at line 33-34) becomes `<read_vision_vision>`. The narrative around it stays — only the rendered tag changes.

### 4.4 `src/cli/commands/meditate.ts`

`readVisionIfPresent` (lines 39-42) is deleted. `meditateCommand` (lines 61-89) shrinks to:

```ts
export async function meditateCommand(
  projectFolder: string,
  opts: { variables?: Record<string, string> } = {},
): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  const runningPid = readPid(absPath);
  if (runningPid !== null && isPidAlive(runningPid)) {
    await output.info(`Meditation session already running (PID ${runningPid}). Skipping.`);
    process.exit(0);
  }
  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);
  writePid(absPath, process.pid);
  try {
    return await self.pipelineRunCommand("meditate", {
      project: absPath,
      variables: { steer: opts.variables?.steer ?? "" },
    });
  } finally {
    removePid(absPath);
  }
}
```

The single behavioural delta: `vision: readVisionIfPresent(absPath)` (line 83) is removed from the variables object. Everything else — PID lock, gitignore append, `ensureMeditationDirs` — stays. The retained lock + gitignore plumbing remains tracked by `janitor-dual-pid-guards` for a future consolidation.

### 4.5 `src/cli/commands/heartbeat.ts`

Lines 102-132 — the entire `hb.command("meditate <folder>")` block — are deleted. The replacement is the existing generic `apparat heartbeat pipeline meditate --project <folder> --every <n>` path that already handles arbitrary bundled pipelines.

### 4.6 New scenario `.apparat/scenarios/bundled-pipelines-self-sufficient/`

Sibling to the 14 existing scenarios. Asserts every bundled pipeline (currently `meditate`, `janitor`, `illumination-to-implementation`, `pipeline-create`, `pipeline-refine`, plus future additions) runs end-to-end via `apparat pipeline run <name> --project <fixture>` supplying *only* the variables its `inputs=` declaration advertises. Failing this contract catches future regressions where a pipeline secretly relies on a wrapper command's variable-stuffing.

The scenario harness pattern is documented under `.apparat/scenarios/` README; the new entry follows the same shape as the existing 14.

## 5. Data flow

### 5.1 Before

```
apparat pipeline run meditate --project my-app
  → parse pipeline.dot → graph.inputs = ["steer", "vision"]
  → preflight (pipeline.ts:237-261)
    → scanUndeclaredCallerVars: missing vision
    → formatMissingInputsError → process.exit(1)
  ✗ never enters the engine

apparat meditate my-app
  → meditateCommand: readVisionIfPresent → contents-or-""
  → pipelineRunCommand("meditate", { project, variables: { steer, vision } })
  → preflight passes (both inputs supplied)
  → engine runs meditate agent with <vision> + <steer> rendered
  ✓ illumination written
```

### 5.2 After

```
apparat pipeline run meditate --project my-app
  → parse pipeline.dot → graph.inputs = ["steer"]
  → preflight passes (steer defaulted to "" by absence; if absent, undeclared-warn but continue per pipeline.ts:253-256 + scanUndeclaredCallerVars on steer)
  → engine runs read_vision tool node (cwd=$project, script_file=read-vision.mjs)
    → produces context value: read_vision.vision = <VISION.md contents-or-"">
  → engine runs meditate agent: <read_vision_vision> + <steer> rendered
  ✓ illumination written

apparat meditate my-app
  → meditateCommand (thin shim): pipelineRunCommand("meditate", { project, variables: { steer } })
  → identical pipeline-run path as above
  ✓ illumination written — parity with `pipeline run` invocation
```

The engine path becomes the single way meditate runs. The shorthand command is now a convenience alias, not a privileged execution path.

### 5.3 Heartbeat path before/after

Before: `apparat heartbeat meditate <folder> --every <n> [--var steer=...]` registers a daemon task whose command is `meditate` with positional folder arg + `--var` flags (`heartbeat.ts:118-126`).

After: `apparat heartbeat pipeline meditate --project <folder> --every <n> [--var steer=...]` registers a daemon task whose command is `pipeline run meditate` with the same `--project` and `--var` plumbing the generic heartbeat-pipeline path already supports.

## 6. Blast radius / impact surface

- **Size:** **M** by file count, S by semantic risk (mechanical structural copy from janitor; one removed CLI subcommand; one removed helper function).
- **Files touched:** ~6 source + ~3 test across 5 surfaces.
- **Surfaces crossed:**
  - **Pipeline definition** — `src/cli/pipelines/meditate/pipeline.dot` (inline edit), `src/cli/pipelines/meditate/read-vision.mjs` (new sibling file).
  - **Agent rubric** — `src/cli/pipelines/meditate/meditate.md` (frontmatter `inputs:` + body placeholder).
  - **CLI command** — `src/cli/commands/meditate.ts` (`readVisionIfPresent` deletion, `meditateCommand` shrink).
  - **Heartbeat subcommand** — `src/cli/commands/heartbeat.ts:102-132` removed.
  - **Smoke scenarios** — new `.apparat/scenarios/bundled-pipelines-self-sufficient/` + update to existing `pipeline-smoke-meditate-steer-folder.test.ts`.
- **Breaking changes:** **yes**, scoped to one removed subcommand and one input plumbing path, both with named replacement paths:
  1. `apparat heartbeat meditate <folder> --every <n>` syntax goes away. Replacement: `apparat heartbeat pipeline meditate --project <folder> --every <n>`.
  2. `--var vision=...` on the heartbeat-meditate path is removed. Replacement: `<project>/VISION.md` is read from disk by the new `read_vision` tool node.
  3. The exported `readVisionIfPresent` symbol from `src/cli/commands/meditate.ts` is removed. Internal-only — no external consumer.
- **Spec / docs ripple:**
  - [ ] `AGENTS.md` line 25 (or thereabouts; verify with grep) — `meditate.ts` reference reads correctly under the thinner shim shape.
  - [ ] `README.md` — `apparat meditate` shorthand description survives; add a one-line note that `apparat pipeline run meditate --project <folder>` is the canonical engine invocation.
  - [ ] `CONTEXT.md` — glossary deprecation note: "`apparat heartbeat meditate` (removed 2026-05-06): use `apparat heartbeat pipeline meditate`."
  - [ ] No ADR required. ADR-0001 (file-copy reuse) and ADR-0008 (`VISION.md` location) already cover the relevant decisions; this design is an *application* of those, not a new principle.
  - [ ] No CLAUDE.md references to `readVisionIfPresent` (verified via grep).
- **Test ripple:**
  - [ ] `src/cli/commands/meditate.test.ts` — delete the ~12 cases targeting `readVisionIfPresent`; add one unit asserting the thin-shim variable construction.
  - [ ] `src/cli/commands/heartbeat.test.ts` — delete cases for the removed `heartbeat meditate <folder>` subcommand.
  - [ ] `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` — adjust to assert `pipeline run meditate` parity (the test currently exercises the shorthand command path; it must additionally cover the engine path).
  - [ ] **New** `.apparat/scenarios/bundled-pipelines-self-sufficient/` — sibling to the 14 existing scenarios. The contract test that guards future regressions.
- **MEMORY.md ripple:** topic file `2026-04-19-illumination-pipeline-walkthrough.md` and `2026-04-22-rubric-prepend-shipped.md` reference meditate's vision plumbing in passing. Frozen prose — left untouched per the project's MEMORY-as-historical-record convention.

## 7. Trade-offs

### 7.1 Tool-node read vs. shared helper

A shared `lib/read-vision.ts` module imported by both janitor and meditate would deduplicate the 9-line script. Reasons to keep file-copy:

- ADR-0001 (Accepted, 2026-04-30) endorses cross-pipeline reuse by file copy. The principle: pipelines are self-contained units; bundled pipelines must run from any project's `.apparat/pipelines/` after a copy without dragging engine-internal helpers.
- The script is 9 lines. Consolidation cost (new module + import wiring + tests) exceeds the maintenance cost of two 9-line files.
- Future divergence (e.g., janitor reads `VISION.md` differently from meditate) is cheap with two files; expensive with one shared helper that grows conditionals.

### 7.2 Drop `vision` from `inputs=` vs. keep both paths

Keeping `inputs="steer,vision"` *and* adding the `read_vision` tool node would let callers either pass `--var vision=...` or rely on the file. Reasons to drop:

- Two paths to the same value invite drift. If the caller passes `--var vision="X"` and `VISION.md` says "Y", which wins? The engine has no resolution rule today.
- `inputs=` declares *caller-supplied* inputs. `read_vision.vision` is graph-internal. Listing it as caller-supplied is the lie that caused this bug originally.
- The caller's only legitimate need to override `vision` would be a test scenario; that's exactly what the new `bundled-pipelines-self-sufficient` scenario covers via fixture `VISION.md` files.

### 7.3 Remove `apparat heartbeat meditate` vs. keep as alias

Keeping the bespoke subcommand as a thin alias preserves muscle memory. Reasons to remove:

- The `command-surface-collapse-to-pipeline-alias` direction (active illumination in queue) explicitly targets bespoke `heartbeat <pipeline>` subcommands. Removing meditate's instance now is one step of that broader collapse, not a parallel decision.
- The replacement (`apparat heartbeat pipeline meditate`) already exists. Aliases for "what we used to type" are exactly the technical-debt accumulator the project's "delete surface, don't add surface" preference rejects.
- One developer, one machine — the cohort that needs the alias is one operator who can update muscle memory once.

### 7.4 New `bundled-pipelines-self-sufficient` scenario vs. ad-hoc test

A unit test inside `pipeline-smoke-meditate-steer-folder.test.ts` would catch the meditate-specific regression. Reasons to add a cross-pipeline scenario:

- The bug is a *class*, not an instance. Janitor today is correct; meditate today is wrong. Without a contract that runs every bundled pipeline through `pipeline run` with only declared inputs, the next bundled pipeline added is free to repeat the wrapper-stuffing pattern.
- The scenario directory is the natural home: `.apparat/scenarios/` already houses 14 cross-cutting smoke tests sibling to `pipeline-smoke-*-folder.test.ts`. Adding one more is consistent.

### 7.5 Atomic vs. staged rollout

A staged path — first add the tool node, then on a later commit remove the wrapper variable-stuffing — lets early commits land green even before the wrapper is updated. Reasons to ship atomically:

- Per VISION.md, no external cohort needs cross-version compatibility. The "stage to keep callers green" rationale doesn't apply.
- A staged rollout creates an interim state where `apparat meditate` double-supplies `vision` (once via `--var`, once via the tool node). That's a behaviour cliff worth avoiding even briefly.
- The change is small enough (~6 files) to ship atomically without making the diff hard to review.

## 8. Constraints

- The tool node + sibling script + `default_vision=""` triplet must mirror the janitor pattern exactly. Drift here re-creates the "concept implemented twice with no single seam" failure.
- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — including the updated `pipeline-smoke-meditate-steer-folder.test.ts` and new `bundled-pipelines-self-sufficient` scenario.
  - `apparat pipeline run meditate --project <folder>` produces an illumination end-to-end with no shorthand involved.
  - `apparat meditate <folder>` produces an illumination identical in shape to the engine-path invocation (parity check).
  - `apparat heartbeat pipeline meditate --project <folder> --every <n>` registers a daemon task that, on its next tick, runs the same pipeline-run path.
- Repo-wide grep invariants post-merge:
  - Zero hits for `readVisionIfPresent` outside frozen prose (MEMORY.md topic files, plans, sessions, archived illuminations).
  - Zero hits for `hb.command("meditate <folder>")` or `command("meditate <folder>")` in `src/`.
  - At least one hit for `read_vision` in `src/cli/pipelines/meditate/pipeline.dot`.
  - At least one hit for `read_vision.vision` in `src/cli/pipelines/meditate/meditate.md`.
- The `meditateCommand` retains PID-locking + gitignore-append behaviour. Removing those is out of scope (tracked by `janitor-dual-pid-guards`).

## 9. Open questions

- **`apparat meditate` shorthand: keep or also remove?** The illumination's step 7 audits the heartbeat subcommand for removal but does not address the shorthand command at `program.name("apparat") meditate`. The shorthand's only remaining value is muscle-memory ergonomics; structurally it is now identical to `apparat pipeline run meditate`. The current decision is to *keep* the shorthand because the README documents it and `command-surface-collapse-to-pipeline-alias` will address the broader cleanup. If the user's preference is to remove it now, the rename PR collapses by one more file. Default: keep; flag for the implementing session.
- **Pipeline-level frontmatter in `meditate.md` for `default_vision`.** The janitor pattern places `default_vision=""` on the agent node in the `.dot` file (`janitor [agent="janitor", default_vision=""]`). This design follows that pattern. An alternative — declaring the default in `meditate.md`'s frontmatter — would centralize agent defaults in the rubric file. Out of scope for this design; if adopted later, both meditate and janitor migrate together.
- **Scenario format for `bundled-pipelines-self-sufficient`.** The 14 existing scenarios use one folder per scenario with a fixture `.apparat/` tree. Whether the new scenario takes that shape, or a parameterized form (one scenario folder iterating over each bundled pipeline), is an implementation choice for the plan. Default: parameterized — fewer fixture trees to maintain.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean. The deletion of `readVisionIfPresent` from `meditate.ts` cascades to any caller; TypeScript guides any missed reference.
- Grep `readVisionIfPresent` against `src/` — zero hits expected.
- Grep `meditate <folder>` against `src/cli/commands/heartbeat.ts` — zero hits.
- Grep `read_vision` against `src/cli/pipelines/meditate/pipeline.dot` — at least one hit.
- Grep `read_vision.vision` against `src/cli/pipelines/meditate/meditate.md` — at least one hit.
- Grep `default_vision` against `src/cli/pipelines/meditate/pipeline.dot` — at least one hit.

### 10.2 Tests

- `npx vitest run src/cli/commands/meditate.test.ts` — passes with the slimmer shim assertions; cases targeting `readVisionIfPresent` are deleted.
- `npx vitest run src/cli/commands/heartbeat.test.ts` — passes; cases for the removed `heartbeat meditate <folder>` subcommand are deleted.
- `npx vitest run src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` — passes with both `pipeline run` and shorthand invocations exercised.
- `npx vitest run` against the new `bundled-pipelines-self-sufficient` scenario — passes for every currently bundled pipeline.
- Full `npx vitest run` suite — passes.

### 10.3 Smoke

- In a temp directory with a `VISION.md` file, run `apparat pipeline run meditate --project <tmp>`. Expected: illumination file written under `<tmp>/.apparat/meditations/illuminations/`.
- In the same temp directory with `VISION.md` *removed*, repeat. Expected: same illumination shape, with the `<read_vision_vision>` placeholder rendered as the empty string (per `default_vision=""`). No crash.
- `apparat meditate <tmp>` — produces an illumination identical in structure to the `pipeline run` path. Parity confirmed.
- `apparat heartbeat pipeline meditate --project <tmp> --every 5` — registers; first tick runs the meditate pipeline; illumination appears.
- `apparat heartbeat meditate <tmp> --every 5` — fails with `unknown command: meditate` (or Commander's equivalent error). The replacement command name is suggested in the error message if Commander supports near-match suggestions; otherwise the user sees an unknown-command failure.

### 10.4 Negative cases

- A `<project>/VISION.md` that is unreadable (permission denied): the `read_vision.mjs` script's catch block emits `{"vision":""}`; the agent runs with `default_vision=""`. Acceptable — same outcome as a missing file.
- A `<project>` that does not exist: the existing `meditateCommand` `existsSync(absPath)` check (line 66) catches this before `pipelineRunCommand`. Behaviour unchanged. The `apparat pipeline run meditate --project <bad>` path also rejects because `pipelineRunCommand` validates `--project` separately.
- A pipeline file that omits `default_vision=""`: the `inputs-resolver.ts` rules govern this; the design relies on the existing default-attribute behaviour. If the implementer notices the resolver does not apply `default_*` to qualified inputs from tool nodes, that is a discovery for the plan, not this design.

## 11. Summary

The bundled `meditate` pipeline crashes immediately under the canonical `apparat pipeline run meditate --project <folder>` invocation because half its declared inputs (`vision`) are silently filled in by the `apparat meditate` shorthand command. This design copies the existing janitor pattern: a `read_vision` tool node + sibling `read-vision.mjs` reads `VISION.md` from `cwd="$project"`, the agent rubric switches to the qualified input `read_vision.vision` with `default_vision=""`, the pipeline's caller-supplied `inputs=` shrinks to `steer`, and `meditateCommand` reduces to a thin `pipelineRunCommand` shim. The bespoke `apparat heartbeat meditate <folder>` subcommand collapses into the generic `apparat heartbeat pipeline meditate` path. A new `.apparat/scenarios/bundled-pipelines-self-sufficient/` smoke-pipeline scenario makes the contract explicit: every bundled pipeline must run end-to-end through `pipeline run` with only its declared inputs. Blast radius is M (~6 source + ~3 test files across 5 surfaces); breaking changes are scoped to one removed subcommand and one input plumbing path, both with named replacement paths. Pipeline `.dot` syntax, agent frontmatter shapes, MCP tools, and the public CLI command surface beyond the removed heartbeat-meditate subcommand are unchanged.
