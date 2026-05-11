# Design: collapse `apparat implement` and `apparat meditate` to thin pipeline-aliasing shims

**Date:** 2026-05-11
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-11T1551-pipeline-shims-hide-pipeline-dot.md`

## 1. Motivation

Three top-level command shapes (`apparat implement <project>`, `apparat meditate <project>`, `apparat pipeline run <name> --project <project>`) all funnel into `pipelineRunCommand`, yet each carries a different positional layout, a different flag→var translation, and its own pre-run bootstrap (tmux preflight, PID lock, `.gitignore` append, dir-ensure) buried in `commands/*.ts` and invisible to `pipeline.dot`.

Direct evidence in the current tree:

- `src/cli/commands/implement.ts:22-27` — bespoke `--scenarios` tmux preflight that aborts with `process.exit(1)` before the pipeline ever runs:
  ```ts
  if (options.scenarios && !process.env.TMUX) {
    await output.error(
      "Error: --scenarios requires running inside a tmux session. Start tmux first, then re-run.",
    );
    process.exit(1);
  }
  ```
- `src/cli/commands/implement.ts:29-35` — bespoke flag→var translation:
  ```ts
  await pipelineRunCommand("implement", {
    project: absPath,
    variables: {
      scenarios_dir: options.scenarios ?? "",
      max_iterations: String(options.max ?? 0),
    },
  });
  ```
- `src/cli/commands/meditate.ts:10-52` — 40+ lines of PID-lock helpers (`pidPath`, `writePid`, `readPid`, `removePid`, `isPidAlive`), `ensureMeditationDirs`, and `appendMeditateGitignore` (writes `".meditate.json"`, `".meditate.log"`, `".meditate.pid"`, `MCP_CONFIG_GLOB` to `.gitignore`).
- `src/cli/program.ts:87-95` — `implement <project-folder>` Commander entry declares `--max <n>` and `--scenarios <path>` options that exist nowhere else.
- `src/cli/program.ts:105-113` — `meditate <project-folder>` uses the generic `--var <key=value>` collector but no first-class `--steer` flag.
- `src/cli/program.ts:117-152` — `pipeline run <dotfile>` uses `--project <folder>` as an *option*, so the positional shape (`pipeline run <name> --project <p>`) differs from the implement/meditate shape (`implement <p>` / `meditate <p>`).

The asymmetry has already been walking the thin-shim direction in recent commits. `apparat heartbeat meditate` was deleted on 2026-05-06 (CONTEXT.md note: "the bespoke heartbeat subcommand existed only because the bundled meditate pipeline could not run unattended") in favor of `apparat heartbeat pipeline meditate`; `apparat watch` and `apparat pipeline list`-the-verb were dropped (`b978b8e`, `be0b44e`); `pipeline.ts` collapsed to a barrel (`d2ae811`). The top-level `implement`/`meditate` shims are the last surfaces where the same engine still speaks three dialects.

The user-visible cost is a wider CLI surface than the engine warrants. The maintenance cost is that a fourth bundled pipeline would require a fourth bespoke shim, and `pipeline.dot` cannot tell its own story — half of "what running this pipeline does to my working tree" lives in TypeScript.

This design collapses both shims to thin Commander aliases that call `pipelineRunCommand`, drops `--max` and `--scenarios` from `implement` entirely (the user confirms they are never invoked; `pipeline.dot` has safe defaults; `pipeline run --var` remains the escape hatch), keeps `--steer` as a first-class daily-driver flag on `meditate` that translates to `--var steer=...`, unifies the positional shape across the three surfaces, and moves the shared bootstrap (PID lock, gitignore append, ensureDirs, tmux check) into one TypeScript helper module. **No new declarative format** — the original illumination proposed a `pipeline.toml` sibling; the user rejected it as format-creep (refinement-log round 1) and the design honors that. Schema, validator, and `loadPipeline` are untouched.

## 2. Decision summary

1. **Drop `--max` and `--scenarios` from `apparat implement` without alias.** Both options vanish from `src/cli/program.ts:91-92` and from `ImplementOptions` in `src/cli/commands/implement.ts:6-9`. The tmux preflight at `implement.ts:22-27` goes with `--scenarios`. The escape hatch is `apparat pipeline run implement --project <p> --var scenarios_dir=... --var max_iterations=N`.

2. **Collapse `src/cli/commands/implement.ts` to a ~6-line alias** — resolve the project path, fail fast if it does not exist, call `pipelineRunCommand("implement", { project: absPath })`. No flag translation, no tmux check, no `variables` block.

3. **Add `--steer <text>` as a first-class Commander option on `meditate`** at `src/cli/program.ts:105-113`. Translates internally to `variables.steer = opts.steer` in the thin shim. The generic `--var <key=value>` collector stays so `--var steer=...` keeps working (alias equivalence).

4. **Move shared bootstrap into a new module `src/cli/lib/pipeline-bootstrap.ts`** (~60 LOC). Public surface: `writePid`, `readPid`, `removePid`, `isPidAlive`, `pidPath`, `ensureMeditationDirs`, `appendMeditateGitignore`. Imported by `meditateCommand`. The helpers are pure utilities — no new abstraction layer, no scheduler, no declarative DSL.

5. **Collapse `src/cli/commands/meditate.ts` to a thin shim** that uses the new lib for PID-lock / gitignore / dirs and delegates to `pipelineRunCommand("meditate", { project: absPath, variables: { steer } })`. The `try / finally` PID-lock pattern stays in the shim (one caller — no need to push the pattern into the lib).

6. **Unify the positional shape across `implement`, `meditate`, and `pipeline run`.** The target shape is `apparat <pipeline-name> <project> [--var k=v ...]`. `implement <project>` and `meditate <project>` already match. `pipeline run <dotfile> --project <folder>` is the outlier: rewrite it to `pipeline run <name> <project>` while keeping `--project <folder>` as a deprecated alias that prints a one-line warning when used. (Scope guard: the deprecation alias is the only backwards-compat token kept; everything else in `pipeline run` — `--resume`, `--run-id`, `--logs-root`, `--var` — is unchanged.)

7. **Delete the flag-existence tests in `src/cli/tests/implement.test.ts`** — five blocks: `:28-36` (default `max_iterations='0'`), `:38-46` (`--max N`), `:55-63` (`scenarios_dir=''` default), `:65-79` (`--scenarios` inside tmux), `:81-96` (rejects `--scenarios` outside tmux), `:98-107` (no tmux preflight when `--scenarios` absent). The tests assert behavior that no longer exists. The remaining tests (project-path delegation at `:20-26` and "does not pass specs_dir" at `:48-53`) stay and verify the thin shim, adapted to expect a `variables`-free call.

8. **Migrate the PID-lock / gitignore / ensureDirs unit tests** from `src/cli/tests/meditate.test.ts:40-129` to a new `src/cli/tests/pipeline-bootstrap.test.ts` (same assertions, importing from the new lib path). The `meditateCommand` shim tests at `meditate.test.ts:232-313` stay where they are — they verify the shim's composition, not the helpers in isolation.

9. **Add one new test** `src/cli/tests/pipeline-shape-parity.test.ts` that asserts the three Commander registrations expose the same `<pipeline> <project>` positional shape — drift between them becomes a red test. (Concretely: walk `createProgram()`'s commands, assert that `implement`, `meditate`, and `pipeline run` each have two positional args named in the expected order, and that `implement` has zero options beyond the inherited ones.)

10. **Update `README.md`:** at `:31-40` delete the `--max` / `--scenarios` examples and the `--scenarios` doc paragraph; at `:53-56` add a one-liner noting `--steer <text>` and `--var steer=<text>` are equivalent; surface the unified `apparat <pipeline-name> <project>` shape in the commands header. Help text in `src/cli/program.ts:30-31` keeps the canonical `apparat implement my-app` example; the `--max` example at `:31` is removed.

11. **Atomic landing.** One commit (or one PR) lands all eleven items. Staging would leave intermediate states where the lib exists but the shims still inline their own bootstrap, or where docs name flags the binary no longer accepts.

## 3. Architecture

### 3.1 Before / after

```
Before (today)                                    After
──────                                            ─────
program.ts:88-95                                  program.ts:88-95
  .command("implement <project-folder>")            .command("implement <project-folder>")
    .option("--max <n>", ...)                          (no --max, no --scenarios)
    .option("--scenarios <path>", ...)               .action → implementCommand(absPath)
    .action → implementCommand(projectFolder, opts)

commands/implement.ts:11-36                        commands/implement.ts (~6 lines)
  ImplementOptions { max?, scenarios? }              resolve(projectFolder)
  resolve(projectFolder)                             existsSync? else exit(1)
  existsSync? else exit(1)                           pipelineRunCommand("implement", {project})
  if (scenarios && !TMUX) error+exit
  pipelineRunCommand("implement", {
    project, variables: { scenarios_dir, max_iterations }
  })

program.ts:105-113                                 program.ts:105-113
  .command("meditate <project-folder>")              .command("meditate <project-folder>")
    .option("--var <key=value>", collectKV)            .option("--steer <text>", "...")
                                                       .option("--var <key=value>", collectKV)
    .action → meditateCommand(projectFolder,           .action → meditateCommand(projectFolder, {
      { variables })                                     steer, variables })

commands/meditate.ts:10-52                          commands/meditate.ts (shim)
  pidPath / writePid / readPid / removePid           import { ... } from lib/pipeline-bootstrap.js
  isPidAlive
  ensureMeditationDirs                               meditateCommand:
  appendMeditateGitignore                              resolve, existsSync, PID-check,
  meditateCommand:                                     ensureDirs, gitignore, writePid,
    PID-check / dirs / gitignore /                     try { pipelineRunCommand(...) }
    writePid / try { run } finally { removePid }       finally { removePid }

(no shared lib)                                    lib/pipeline-bootstrap.ts (~60 LOC)
                                                     pidPath, writePid, readPid, removePid
                                                     isPidAlive
                                                     ensureMeditationDirs
                                                     appendMeditateGitignore

program.ts:117-152                                 program.ts:117-152
  pipeline run <dotfile>                              pipeline run <pipeline> [project]
    --project <folder>                                  --project <folder> (deprecated alias)
                                                        ⤷ if set, warn once
```

### 3.2 The new lib: `src/cli/lib/pipeline-bootstrap.ts`

```ts
// src/cli/lib/pipeline-bootstrap.ts (~60 LOC)
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { MCP_CONFIG_GLOB } from "./agent.js";
import { illuminationsDir } from "./apparat-paths.js";

export function pidPath(projectFolder: string): string {
  return join(projectFolder, ".meditate.pid");
}

export function writePid(projectFolder: string, pid: number): void { /* ... */ }
export function readPid(projectFolder: string): number | null { /* ... */ }
export function removePid(projectFolder: string): void { /* ... */ }
export function isPidAlive(pid: number): boolean { /* ... */ }
export function ensureMeditationDirs(projectFolder: string): void {
  mkdirSync(illuminationsDir(projectFolder), { recursive: true });
}
export function appendMeditateGitignore(projectFolder: string): void { /* ... */ }
```

Implementations are line-by-line ports of `src/cli/commands/meditate.ts:10-52` — same semantics, same edge cases (file not found, malformed pid, duplicate gitignore entry, trailing-newline preservation). No behavioural change.

The lib is **not** a generic preflight DSL. It exports six concrete helpers that the meditate shim composes. A future caller (e.g. a second pipeline that also needs a PID lock) can import the helpers and compose the same way; nothing forces them to. This deliberately stops short of inventing the declarative preflight schema the illumination originally proposed — that path was rejected in refinement round 1 ("Project uses zero TOML today; introducing it for one sibling is format-creep").

### 3.3 Rewritten `src/cli/commands/implement.ts`

```ts
import { existsSync } from "fs";
import { resolve } from "path";
import { pipelineRunCommand } from "./pipeline.js";
import * as output from "../lib/output.js";

export async function implementCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  await pipelineRunCommand("implement", { project: absPath });
}
```

No `ImplementOptions`. No `variables` block. No tmux check. The implement pipeline's defaults at `src/cli/pipelines/implement/pipeline.dot:13` (`default_max_iterations="0"`) and `:27-28` (the `scenarios_dir!=''` / `scenarios_dir=''` branch on `implementer`) handle the absent-variable case cleanly. `pipeline run --var` remains the escape hatch.

### 3.4 Rewritten `src/cli/commands/meditate.ts`

```ts
import { existsSync } from "fs";
import { resolve } from "path";
import * as output from "../lib/output.js";
import {
  readPid, writePid, removePid, isPidAlive,
  ensureMeditationDirs, appendMeditateGitignore, pidPath,
} from "../lib/pipeline-bootstrap.js";
import * as self from "./pipeline.js";

export async function meditateCommand(
  projectFolder: string,
  opts: { steer?: string; variables?: Record<string, string> } = {},
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
    const steer = opts.steer ?? opts.variables?.steer ?? "";
    return await self.pipelineRunCommand("meditate", {
      project: absPath,
      variables: { steer },
    });
  } finally {
    removePid(absPath);
  }
}

// Re-export helpers from the lib so existing imports in heartbeat scheduler and
// other in-tree callers (if any) keep working through the migration commit.
export {
  pidPath, writePid, readPid, removePid, isPidAlive,
  ensureMeditationDirs, appendMeditateGitignore,
} from "../lib/pipeline-bootstrap.js";
```

The `--steer` first-class flag and the `--var steer=...` generic path produce the same `steer` value. `opts.steer` wins if both are passed (Commander option precedence over `--var`), with no error — daily-driver path stays ergonomic.

Re-exports cover the in-tree imports identified in `src/cli/tests/meditate.test.ts:18-27`. The re-exports stay until consumers are migrated to import from the lib directly; a one-line `// TODO: remove after consumers migrate` comment is the only non-explanatory comment added. (The migration of the test file's import line is part of this design's atomic landing — see §4.4.)

### 3.5 Rewritten `pipeline run` registration

```ts
// program.ts:117 (sketch — positional shape changes)
pipeline
  .command("run <pipeline> [project]")
  .description("Run a pipeline (name or .dot path); optional positional project folder")
  .option("--project <folder>", "Deprecated — pass project as the second positional arg")
  .option("--resume [runId]", ...)
  .option("--run-id <id>", ...)
  .option("--logs-root <path>", ...)
  .option("--var <key=value>", "pass caller variable (repeatable)", collectKV, {} as Record<string, string>)
  .action(async (pipelineArg: string, projectPositional: string | undefined, opts) => {
    const project = projectPositional ?? opts.project;
    if (!projectPositional && opts.project) {
      await output.warn("--project flag is deprecated; pass project as the second positional arg.");
    }
    await pipelineRunCommand(pipelineArg, { project, /* ...rest unchanged */ });
  });
```

The deprecation warning is one line; it does not exit. Heartbeat's scheduled invocations shell out via the CLI binary (verifier confirmed zero ripple — "heartbeat shells out via the CLI shim path, so bootstrap is automatic"), so heartbeat's already-emitted `--project` calls keep working through the deprecation window. A follow-up illumination can remove `--project <folder>` once heartbeat templates are regenerated; that removal is out of scope here.

**Scope guard:** the deprecation is the *only* backwards-compatibility token. There is no `--max`/`--scenarios` deprecation alias on `implement` — those flags are removed clean. The asymmetry is deliberate: heartbeat scripts in the wild are the load-bearing reason for the `--project` alias; the implement flags have a user-confirmed zero-usage profile.

### 3.6 Help-text + README simplifications

- `src/cli/program.ts:30-31` — keep `apparat implement my-app` example; delete the `apparat implement my-app --max 3` example. The "Getting started" block no longer names flags `implement` does not accept.
- `src/cli/program.ts:90` (the implement `addHelpText` block) — replace the four-example list (`apparat implement my-app`, `--max 5`, `--max 0`, `--scenarios ...`) with a single line: `Examples:\n  apparat implement my-app`. Drop the `--scenarios requires tmux` doc paragraph.
- `src/cli/program.ts:108` (the meditate `addHelpText` block) — extend the examples block to show `apparat meditate my-app --steer "focus on auth flow"` alongside `apparat meditate my-app`.
- `README.md:31-40` — replace the flagged `apparat implement <project-folder> [--max N] [--scenarios <path>]` heading with `apparat implement <project-folder>`; delete the `--scenarios` documentation paragraph at `:35-40`.
- `README.md:53-56` — extend the meditate paragraph: `--steer <text>` is the first-class form; `--var steer=<text>` is the equivalent generic form.
- `README.md` `pipeline run` paragraph — add one line: `--project <folder>` is deprecated; pass the project as the second positional arg.

### 3.7 Surfaces unchanged

- `Graph` type, `parseDot`, `validateGraph`, `loadPipeline`, `resolvePipelineArg` signatures. Unchanged.
- `pipeline validate`, `pipeline trace`, `pipeline show`, `pipeline explain`, `init`, `status`, `heartbeat *`. Unchanged.
- `apparat <project>` root-level shorthand. Per verifier finding (pipeline-run subagent: "NO root `.action()`/`.argument()` on `program` itself"), this shorthand is not currently wired in `program.ts` — it's a pre-existing README/help-text claim, not real code. This design does not introduce or remove the shorthand. It stays an open documentation-debt item out of scope here.
- Pipeline `.dot` syntax, agent rubric, schema, validator. Unchanged.
- Daemon IPC. No new caller, no new endpoint.
- `src/cli/pipelines/implement/pipeline.dot` and `src/cli/pipelines/meditate/pipeline.dot`. Unchanged — the defaults at `implement/pipeline.dot:13,27-28` already cover the absent-variable case.

## 4. Components & files

### 4.1 New code

| Symbol | File | Responsibility |
|---|---|---|
| `pidPath`, `writePid`, `readPid`, `removePid`, `isPidAlive`, `ensureMeditationDirs`, `appendMeditateGitignore` | `src/cli/lib/pipeline-bootstrap.ts` (new) | Pure utility helpers ported from `commands/meditate.ts:10-52`; same semantics |

### 4.2 Rewritten

| File | Treatment |
|---|---|
| `src/cli/commands/implement.ts` | Full rewrite — ~6-line shim. `ImplementOptions` interface deleted. |
| `src/cli/commands/meditate.ts` | Helper definitions deleted; replaced by imports + re-exports from `lib/pipeline-bootstrap.ts`. `meditateCommand` accepts `opts.steer` alongside `opts.variables`. |
| `src/cli/program.ts:91-95` | Delete `--max`/`--scenarios` options; `.action` signature loses `options` arg. |
| `src/cli/program.ts:105-113` | Add `--steer <text>` option; `.action` reads both `opts.steer` and `opts.variables.steer`. |
| `src/cli/program.ts:117-152` | Change positional to `<pipeline> [project]`; keep `--project` as deprecated alias with one-line warning. |

### 4.3 Inline edits

| File | Edit |
|---|---|
| `src/cli/program.ts:30-31` | Drop `--max 3` example from "Getting started" block. |
| `src/cli/program.ts:90` (implement `addHelpText`) | Collapse to single `apparat implement my-app` example; drop `--scenarios` paragraph. |
| `src/cli/program.ts:108` (meditate `addHelpText`) | Add `apparat meditate my-app --steer "..."` example. |
| `README.md:31-40` | Drop `[--max N] [--scenarios <path>]` from heading; delete `--scenarios` paragraph. |
| `README.md:53-56` | Extend meditate paragraph with `--steer` ↔ `--var steer=` equivalence. |
| `README.md` (pipeline-run paragraph) | Add deprecated `--project` note. |

### 4.4 Test ripples

| File | Treatment |
|---|---|
| `src/cli/tests/implement.test.ts:38-107` | Delete the five tests that assert `--max`/`--scenarios`/tmux behavior (`:38-46`, `:48-53`, `:55-63`, `:65-79`, `:81-96`, `:98-107`). Keep `:20-26` (project-path delegation) and adapt its expectation: the `variables` block no longer contains `max_iterations` or `scenarios_dir`. Drop the `:28-36` "default max_iterations='0'" test entirely — the variable is no longer passed. |
| `src/cli/tests/meditate.test.ts:40-129` | Migrate the `ensureMeditationDirs`, `appendMeditateGitignore`, `pidPath`, `writePid/readPid/removePid`, `isPidAlive` test blocks to a new file `src/cli/tests/pipeline-bootstrap.test.ts`, importing from the new lib path. Adjust imports only — assertions are unchanged. |
| `src/cli/tests/meditate.test.ts:232-313` | Keep in place. The shim tests at `:232-313` verify `meditateCommand` composition (delegates to `pipelineRunCommand`, runs preflight, removes PID file, does not pass `vision`/`specs_dir`). Adapt `:233-243` to also cover `opts.steer` precedence over `opts.variables.steer` — one added test case. |
| `src/cli/tests/meditate.test.ts:18-27` | Update the import block to pull helpers from `../lib/pipeline-bootstrap` (the lib module) while keeping `meditateCommand` from `../commands/meditate`. |
| `src/cli/tests/pipeline-shape-parity.test.ts` (new) | Walks `createProgram()`'s `commands` array. Asserts: `implement` has exactly one positional arg + no `--max`/`--scenarios` options; `meditate` has one positional arg + `--steer` + `--var`; `pipeline run` has two positional args (`<pipeline>` required, `[project]` optional) + `--project` marked as the deprecated alias. |
| `src/cli/tests/pipeline-bootstrap.test.ts` (new) | Receives the migrated PID/gitignore/dirs assertions from `meditate.test.ts:40-129`. |

The verifier flagged `src/cli/tests/implement.test.ts:38,65,81,98` as the deletion set. Re-reading the file confirms `:48-53` ("does NOT pass specs_dir") stays — it tests an absence, which is still true after the flag removal — and `:55-63` ("scenarios_dir='' by default") gets deleted because the variable is no longer passed at all.

## 5. Data flow

### 5.1 `apparat implement <project>`

```
apparat implement my-app
  → program.ts implement.action(absPath)
    → implementCommand(absPath)
        resolve(absPath)
        existsSync? else exit(1)
        pipelineRunCommand("implement", { project: absPath })
          → pipeline.dot resolves with default_max_iterations="0",
            scenarios_dir="" branch picks the no-tests path
```

No flag translation, no tmux preflight. `pipeline run --var max_iterations=N --var scenarios_dir=<p>` is the way to opt into the previously-flagged behaviors.

### 5.2 `apparat meditate <project> [--steer <text>]`

```
apparat meditate my-app --steer "focus on auth"
  → program.ts meditate.action(absPath, opts)
    → meditateCommand(absPath, { steer: opts.steer, variables: opts.var })
        resolve(absPath); existsSync? else exit(1)
        readPid → isPidAlive? exit(0) (already running)
        ensureMeditationDirs(absPath)        [lib/pipeline-bootstrap.ts]
        appendMeditateGitignore(absPath)     [lib/pipeline-bootstrap.ts]
        writePid(absPath, process.pid)       [lib/pipeline-bootstrap.ts]
        try {
          steer = opts.steer ?? opts.variables?.steer ?? ""
          pipelineRunCommand("meditate", { project, variables: { steer } })
        } finally {
          removePid(absPath)                 [lib/pipeline-bootstrap.ts]
        }
```

PID-lock semantics unchanged from `meditate.ts:65-80`. `--steer` precedence over `--var steer=...` is the documented daily-driver path.

### 5.3 `apparat pipeline run <pipeline> [project]`

```
apparat pipeline run meditate my-app --var steer=...
  → program.ts pipeline.run.action(name, project, opts)
    → pipelineRunCommand(name, { project, variables, resume, runId, logsRoot })

apparat pipeline run meditate --project my-app --var steer=...   (legacy)
  → projectPositional === undefined; opts.project === "my-app"
    → warn once: "--project is deprecated; pass project as second positional"
    → pipelineRunCommand(name, { project: opts.project, ... })
```

### 5.4 Shape parity contract

```
for each cmd in [implement, meditate, pipeline run]:
  cmd.positionals[0] === "<pipeline-name>" (implicit for the shims)
  cmd.positionals[1] === "<project>" (positional second arg)
  cmd.options must not include --max or --scenarios (implement)
  cmd.options may include --steer and --var (meditate)
  cmd.options may include --project but only marked deprecated (pipeline run)
```

This is the parity test's body. Drift between the three surfaces fails this test.

## 6. Blast radius / impact surface

- **Size:** **S–M** by file count, **S** by surface count.
  - File count: 1 new lib + 1 new test + 2 rewritten command files + 1 rewritten command registration block (3 edits in `program.ts`) + 2 README sections + 2 migrated test files = **~8 files**.
  - Surface count: CLI shims, library (new), help text, README, tests. **No** schema, **no** validator, **no** `loadPipeline`, **no** daemon IPC, **no** agent surface.

- **Files touched (enumerated):**
  - **New:** `src/cli/lib/pipeline-bootstrap.ts`, `src/cli/tests/pipeline-bootstrap.test.ts`, `src/cli/tests/pipeline-shape-parity.test.ts`.
  - **Rewritten:** `src/cli/commands/implement.ts`, `src/cli/commands/meditate.ts`.
  - **Edited (registration + help):** `src/cli/program.ts:30-31` (Getting-started example), `:88-95` (implement registration + addHelpText), `:105-113` (meditate registration + addHelpText), `:117-152` (pipeline-run positional shape).
  - **Edited (docs):** `README.md:31-40` (implement section), `:53-56` (meditate section), pipeline-run paragraph.
  - **Edited (tests):** `src/cli/tests/implement.test.ts` (delete five tests, adapt one), `src/cli/tests/meditate.test.ts:18-27,40-129,232-243` (migrate imports + helper tests + extend shim coverage).

- **Surfaces crossed:**
  - **CLI** — `implement` loses two flags; `meditate` gains `--steer`; `pipeline run` accepts a second positional; `--project` flag deprecated on `pipeline run`.
  - **Library** — one new module exporting seven helpers.
  - **Help text + README** — flagged commands updated, deprecated alias documented.
  - **Tests** — two new files; three existing files edited.

- **Breaking changes (named):**
  - **`--max <n>` on `apparat implement`** — removed without alias. Replacement: `apparat pipeline run implement <project> --var max_iterations=N`. User confirmed zero usage in refinement round 1.
  - **`--scenarios <path>` on `apparat implement`** — removed without alias. Replacement: `apparat pipeline run implement <project> --var scenarios_dir=<path>` (inside a tmux session if running the implementation-tester branch; the pipeline's own runtime requirements stand, the CLI just no longer pre-validates them). User confirmed zero usage in refinement round 1.
  - **`pipeline run <dotfile> --project <folder>`** — the `--project` option is now deprecated (still works; emits a one-line warning). Heartbeat-emitted scripts and any in-the-wild invocations continue running unchanged through the deprecation window. Full removal is a separate follow-up illumination.

- **Spec / docs ripple checklist:**
  - [ ] `README.md:31-40` — drop `[--max N] [--scenarios <path>]` from the implement heading; delete the `--scenarios` paragraph.
  - [ ] `README.md:53-56` — extend the meditate paragraph to note `--steer <text>` / `--var steer=<text>` equivalence.
  - [ ] `README.md` `pipeline run` paragraph — document the deprecated `--project` alias and the new positional shape.
  - [ ] `src/cli/program.ts:30-31` — Getting-started block: drop `--max 3` example.
  - [ ] `src/cli/program.ts:90` — implement `addHelpText`: collapse examples + drop `--scenarios` paragraph.
  - [ ] `src/cli/program.ts:108` — meditate `addHelpText`: add `--steer` example.
  - [ ] `CONTEXT.md` — verify the 2026-05-06 shim-collapse entry still reads correctly after this change extends the same direction; likely no edit (audit-only).
  - [ ] No new ADR required. The change extends ADR-0001 (sibling precedent) and the implicit "everything is a pipeline" direction documented in CONTEXT.md's 2026-05-06 entry. Adding an ADR for "we removed two flags" would be over-formalizing.

- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/pipeline-bootstrap.test.ts` — migrated assertions from `meditate.test.ts:40-129` (PID-lock, gitignore, dirs).
  - [ ] **New** `src/cli/tests/pipeline-shape-parity.test.ts` — walks `createProgram()` commands, asserts unified positional shape and absent removed flags.
  - [ ] **Delete** `src/cli/tests/implement.test.ts:28-36` ("default max_iterations='0'"), `:38-46` (`--max N`), `:55-63` ("scenarios_dir=''"), `:65-79` (`--scenarios` in tmux), `:81-96` ("rejects --scenarios outside tmux"), `:98-107` ("does not preflight tmux without --scenarios").
  - [ ] **Adapt** `src/cli/tests/implement.test.ts:20-26` and `:48-53` — `variables` block is now absent in the call; assertions migrate to "called with `{ project }` only".
  - [ ] **Migrate** `src/cli/tests/meditate.test.ts:18-27` — import helpers from `lib/pipeline-bootstrap`, not `commands/meditate`.
  - [ ] **Extend** `src/cli/tests/meditate.test.ts:232-243` — one new case verifying `opts.steer` precedence over `opts.variables.steer`.

## 7. Trade-offs

### 7.1 Drop `--max`/`--scenarios` clean vs. alias to `--var`

Clean removal chosen. Reasons:

- User explicitly confirmed in refinement round 1: "I never use implement with max_iterations or scenarios_dir so these can be removed." No usage-in-the-wild to preserve.
- Aliasing (`--max N` → `--var max_iterations=N`) would carry the flag's translation cost forward as dead Commander wiring. The point of the change is *less surface*, not *renamed surface*.
- `pipeline run --var` is documented and tested. Operators who need the behavior have a one-command escape hatch.

The cost is one breaking-change line in the changelog. Acceptable given zero-usage confirmation.

### 7.2 `--steer` first-class vs. drop in favor of `--var steer=...`

First-class kept. Reasons:

- User flagged `--steer` as a daily-driver in refinement round 1: "However, steer flag I use often." Ergonomics matter when the flag is in muscle memory.
- The translation is one line in the shim (`opts.steer ?? opts.variables?.steer ?? ""`). No declarative format needed.
- Alias equivalence (`--steer "x"` ≡ `--var steer=x`) is documented in README and verified by the new test case at `meditate.test.ts:232-243`.

### 7.3 Move bootstrap to lib vs. leave inline in `meditate.ts`

Move to lib. Reasons:

- The illumination's core observation is that bootstrap is invisible from `pipeline.dot`. A separate `lib/pipeline-bootstrap.ts` file gives the bootstrap a name and a discoverable location even though it is still imported by TypeScript and not declared in the pipeline file.
- Re-exports from `meditate.ts` keep the migration commit atomic and avoid breaking heartbeat / status / any in-tree consumer that currently imports `pidPath` from `commands/meditate.ts`.
- The lib stays narrow — seven helpers, no DSL, no scheduler. YAGNI everything else.

The path-not-taken (sibling `pipeline.toml` declarative preflight) was explicitly rejected by the user in refinement round 1: "Project uses zero TOML today; introducing it for one sibling is format-creep." The TS-helper idiom is the project's existing way of factoring shared utility code; the design stays inside that idiom.

### 7.4 `pipeline run`: positional vs. flag for project

Both, with deprecation. Reasons:

- The unification goal (`apparat <pipeline> <project>` everywhere) requires positional alignment. `pipeline run`'s `--project <folder>` is the outlier; making `project` positional brings it into line.
- Heartbeat templates and scripted invocations in the wild use `--project <folder>` (verifier flagged zero heartbeat ripple, but the flag is already documented in `program.ts:139` and used in README examples). Removing the flag clean would break those.
- The deprecated alias prints a one-line warning, costs near-zero, and gives a follow-up illumination the room to remove the flag once heartbeat templates are regenerated.

Cost: one extra branch in the `pipeline run` action handler, deleted in a follow-up.

### 7.5 Atomic vs. staged landing

Atomic. Reasons:

- Each item alone leaves an intermediate state with mismatched docs/code/tests (e.g. lib lands but shims still inline helpers; or shims collapse but docs still name the dropped flags).
- The test-suite migration is correlated — moving the PID-lock tests requires the lib to exist, and dropping the implement flag-existence tests requires the flags to be gone in the same commit.
- One developer, one machine, no rollout cohort. The breaking-change line in the changelog is a single discrete event.

### 7.6 Shape parity test: walk `createProgram` vs. snapshot help output

Walk `createProgram`. Reasons:

- Commander's `commands` array is the structural source of truth; help-output snapshots are brittle to wording changes and would force re-recording on every minor edit.
- The parity guarantee being tested is structural ("these three commands expose the same positional shape"), not textual. Asserting structurally matches the guarantee.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — including the new `pipeline-bootstrap.test.ts`, the new `pipeline-shape-parity.test.ts`, the migrated meditate tests, and the trimmed implement tests.
  - `apparat implement my-app` resolves the path, runs `pipelineRunCommand("implement", { project })`, and exits when the pipeline finishes. No `--max`/`--scenarios` flags are parsed.
  - `apparat implement my-app --max 3` exits with Commander's standard "unknown option" error.
  - `apparat meditate my-app --steer "x"` runs the meditate pipeline with `variables.steer === "x"`. Same effect as `apparat meditate my-app --var steer=x`.
  - `apparat pipeline run meditate my-app --var steer=x` works (new positional shape).
  - `apparat pipeline run meditate --project my-app --var steer=x` works *and* prints a one-line deprecation warning (legacy shape).
  - `apparat heartbeat pipeline implement --project . --every 60` continues to schedule unchanged (heartbeat shells out via CLI; the deprecated alias keeps the flag form alive).
- Repo-wide grep invariants post-merge:
  - `src/cli/commands/implement.ts` does not contain `--scenarios`, `--max`, `TMUX`, `scenarios_dir`, or `max_iterations`.
  - `src/cli/commands/meditate.ts` does not define `pidPath`/`writePid`/`readPid`/`removePid`/`isPidAlive`/`ensureMeditationDirs`/`appendMeditateGitignore` — only re-exports them.
  - `src/cli/lib/pipeline-bootstrap.ts` exports those seven symbols and nothing else.
  - `src/cli/program.ts` does not contain `--max <n>` or `--scenarios <path>` option declarations.
  - `README.md` does not list `--max` or `--scenarios` as `apparat implement` flags.
- Behaviour invariants:
  - PID-lock semantics for meditate are byte-identical to today (same file path, same liveness check, same try/finally release).
  - Gitignore-append entries are byte-identical: `.meditate.json`, `.meditate.log`, `.meditate.pid`, `MCP_CONFIG_GLOB`.
  - `ensureMeditationDirs` creates the same `.apparat/meditations/illuminations` path.
  - The implement pipeline runs with the same `default_max_iterations="0"` and same `scenarios_dir==""` branch as today when invoked without `--var` overrides.

## 9. Open questions

- **Should the `--project <folder>` deprecation warning go to stdout or stderr?** Today `output.warn` (verified at `src/cli/lib/output.js`) routes to the same stream Commander uses for help text — consistent with the rest of the CLI. Default: keep `output.warn`. Implementing session may revisit if scripted callers capture stdout and the warning pollutes parsed output.
- **Should `meditate.ts` keep the `// TODO: remove after consumers migrate` comment indefinitely, or schedule the re-export removal in this commit?** The verifier did not enumerate in-tree consumers beyond the test file; if the consumers are all in-tree and migrated in this commit, the re-export block can be deleted clean. Implementing session should grep for `from ".*meditate"` and report; if the only consumer is `meditate.test.ts:18-27` (migrated here), drop the re-export block.
- **Does `apparat <project>` shorthand survive?** Verifier confirmed it does not exist in code today. The README still names it (line search not done in this design — flag for implementing session). The shim-collapse direction would suggest dropping the README mention; this design does not take that step because the verifier classified it as "pre-existing documentation debt, not introduced by this change."

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `--max` against `src/cli/program.ts` — zero hits in `implement` registration; may still appear elsewhere (heartbeat) — confirm only.
- Grep `--scenarios` against `src/cli/` — zero hits.
- Grep `pidPath\|writePid\|readPid\|removePid\|isPidAlive\|ensureMeditationDirs\|appendMeditateGitignore` against `src/cli/commands/meditate.ts` — appear only in import + re-export lines (no `export function` definitions).
- Grep `pidPath\|writePid\|readPid\|removePid\|isPidAlive\|ensureMeditationDirs\|appendMeditateGitignore` against `src/cli/lib/pipeline-bootstrap.ts` — exactly seven `export function` definitions.

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-bootstrap.test.ts` — passes (migrated assertions, same semantics).
- `npx vitest run src/cli/tests/pipeline-shape-parity.test.ts` — passes.
- `npx vitest run src/cli/tests/implement.test.ts` — passes with the trimmed suite (project-path delegation + no-`specs_dir` + no-`max_iterations`/`scenarios_dir`).
- `npx vitest run src/cli/tests/meditate.test.ts` — passes with migrated imports and extended shim coverage (`--steer` precedence case added).
- `npx vitest run` (full suite) — passes.

### 10.3 Smoke

- `apparat init my-app && apparat implement my-app` — runs the pipeline, exits cleanly when the pipeline completes.
- `apparat implement my-app --max 3` — exits with `error: unknown option '--max'`.
- `apparat meditate my-app --steer "focus on auth"` — runs meditate; pipeline receives `variables.steer === "focus on auth"`; `.meditate.pid` is created then removed.
- `apparat meditate my-app --var steer=alt` — same as above with `variables.steer === "alt"`.
- `apparat meditate my-app --steer "first" --var steer=second` — `variables.steer === "first"` (`--steer` precedence).
- `apparat pipeline run meditate my-app` — resolves and runs (new positional shape).
- `apparat pipeline run meditate --project my-app` — runs, prints deprecation warning once, then continues normally.

### 10.4 Negative cases

- `apparat implement` (no project arg) — Commander's standard "missing required argument" error.
- `apparat implement /does/not/exist` — `output.error` prints `Error: project folder not found: ...`; exit 1. No pipeline call.
- `apparat meditate my-app` when `.meditate.pid` exists and PID is alive — "Meditation session already running ... Skipping."; exit 0; no pipeline call.
- `apparat pipeline run` (no positional, no `--project`) — Commander's standard "missing required argument" error for `<pipeline>`. `[project]` is optional so its absence does not fail — `pipelineRunCommand` validates `--project` requirement downstream as today.

## 11. Summary

Three top-level commands (`apparat implement`, `apparat meditate`, `apparat pipeline run`) all wrap `pipelineRunCommand` but each carries its own positional shape, its own flag→var translation, and its own pre-run bootstrap (tmux preflight, PID lock, gitignore append, ensureDirs) embedded in `commands/*.ts` — invisible from `pipeline.dot`. This design collapses both `implement.ts` and `meditate.ts` to thin Commander aliases, drops `--max` and `--scenarios` from `implement` without alias (user-confirmed zero usage; `pipeline.dot` defaults cover; `pipeline run --var` is the escape hatch), keeps `--steer` as a first-class daily-driver flag on `meditate` that translates internally to `variables.steer`, unifies the positional shape to `apparat <pipeline> <project> [--var k=v ...]` across all three surfaces (deprecating `--project <folder>` on `pipeline run` with a one-line warning to preserve heartbeat scripts), and moves the shared PID-lock / gitignore / dirs helpers into a new `src/cli/lib/pipeline-bootstrap.ts` (~60 LOC, seven exported functions, no DSL). The original illumination's proposed `pipeline.toml` sibling declarative-preflight format is **out of scope** — user rejected it as format-creep (refinement round 1). One concrete breaking-change tuple — `--max` and `--scenarios` on `implement` removed without alias — is the only no-fallback change; everything else preserves call-site compatibility through deprecation aliases or behavioral equivalence. Blast radius is S–M by file count (~8 files), S by surface count (no schema, no validator, no `loadPipeline`, no daemon IPC, no agent surface). Atomic landing.
