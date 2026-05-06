# Design: Split `src/cli/commands/pipeline.ts` into per-subcommand files behind a `loadPipeline()` seam

**Date:** 2026-05-06
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T1426-pipeline-command-orchestration-monolith.md`

## 1. Motivation

`src/cli/commands/pipeline.ts` is a 762-LOC god module that owns every concern the `apparat pipeline` surface touches. The five sub-commands — `run`, `validate`, `show`, `list`, `trace` — live as sibling exported functions inside the same file (`pipelineValidateCommand` at `src/cli/commands/pipeline.ts:147`, `pipelineRunCommand` at `:204`, `pipelineListCommand` at `:550`, `pipelineTraceCommand` at `:585`, `pipelineShowCommand` at `:697`). Each function is registered into commander from `src/cli/program.ts:6-12`.

The "load a pipeline" ritual — *resolve a name or path → read the .dot → parse → validate → expand variables* — is open-coded in two places with subtle drift:

- `pipelineValidateCommand` re-derives it at `src/cli/commands/pipeline.ts:147-201`: `resolvePipelineArg` (`:149-151`) → `readFileSync` (`:157`) → `parseDot` (`:164`) → `validateGraph` (`:178`) → diagnostic loop (`:179-185`). Errors flow through `formatPipelineDiag` (`:161`).
- `pipelineRunCommand` re-derives it at `src/cli/commands/pipeline.ts:204-266`: `resolvePipelineArg` (`:206-208`) → `readFileSync` (`:214`) → `parseDot` (`:216`) → `validateOrRaise` (`:218`) → `scanUndeclaredCallerVars` (`:238`) → `variableExpansionTransform` (`:263`). Errors flow through `formatMissingInputsError` (`:242`) and stdout — a different path.
- `pipelineShowCommand` re-derives the load segment at `src/cli/commands/pipeline.ts:697-738`: `resolvePipelineArg` (`:702-704`) → `readFileSync` (`:712`) → `parseDot` (`:719`) → `validateGraph` (`:734`) → diagnostic loop (`:736-737`). The full function continues to `:762` doing show-specific work (`annotateDotForShow` at `:740`, `renderDotToSvg` at `:743`); it is the *load segment* that drifts from the other two paths.

Three forces converge:

1. **Locality.** Answering "what does `pipeline run` actually do?" requires skimming a 762-line file across imports for attractor core, attractor transforms, formatters, Ink TUI, signal handling, and stream parsing. Five sub-commands' worth of unrelated dependencies (`renderPipelineApp` at `src/cli/commands/pipeline.ts:26`, `annotateDotForShow` at `:29`, `parseStreamJsonEvents` at `:21`) all sit at the top of the file even when reading just `validate`.
2. **Drift.** The validate path and the run path already disagree on which validator entry point to call (`validateGraph` returns diagnostics; `validateOrRaise` throws). The show path picked validation behaviour from the validate path but error formatting that diverges from both. There is no named module that says "this is how an apparat command loads a pipeline graph from disk."
3. **Project direction.** Recent commits show active named-seam extraction from cross-concern code: `graph-validator.ts` was pulled out of `graph.ts` in `ac973ae`, and the consolidation/self-sufficiency push (`526bb7f`, `c33f5c7`) is moving toward smaller, focused modules. ADR-0001 (collapse-to-single-tier) endorses this when the seam earns its name.

The illumination phrases the sub-commands as "conditional branches inside one file." A more precise framing: they are five sibling exported functions that *each open-code the same first 40 lines*. The fix is to name those 40 lines once and let the sub-commands call them.

## 2. Decision Summary

1. **Extract `loadPipeline()` into a new `src/cli/commands/pipeline-invocation.ts`.** It owns the resolve → read → parse → validate → expand sequence and returns a typed `LoadedPipeline { graph, src, absPath, relPath, projectRoot, runId, diagnostics }` value. Failure cases (file not found, syntax error, validation error) raise typed errors the caller maps to its own exit/output convention.

2. **Move each sub-command to its own file under `src/cli/commands/pipeline/`.**
   - `src/cli/commands/pipeline/run.ts` — owns `pipelineRunCommand` + `PipelineRunOptions` + the SIGINT/SIGTERM handler + Ink-TUI plumbing currently at `src/cli/commands/pipeline.ts:204-544`.
   - `src/cli/commands/pipeline/validate.ts` — owns `pipelineValidateCommand` + `PipelineValidateOptions` + `diffEdgeLabels` + `labelIsReferenced` (currently `:115-201`).
   - `src/cli/commands/pipeline/show.ts` — owns `pipelineShowCommand` + `PipelineShowOptions` + `renderDotToSvg` (currently `:686-762`).
   - `src/cli/commands/pipeline/list.ts` — owns `pipelineListCommand` + `PipelineListOptions` (currently `:546-583`).
   - `src/cli/commands/pipeline/trace.ts` — owns `pipelineTraceCommand` (currently `:585-684`).
   - `src/cli/commands/pipeline/runs-gc.ts` — owns `gcOldRuns` + `resolveResumeLogsRoot` (currently `:57-112`). These are pure I/O helpers consumed only by `run`; co-locating them with `run.ts` is also acceptable. Default: separate file because they have their own test (`pipeline-runs-gc.test.ts`).

3. **Keep `src/cli/commands/pipeline.ts` as a barrel re-export** that re-exports every symbol the 11 importing test files (`pipeline`, `pipeline-show`, `pipeline-headless`, `pipeline-failure-reason`, `pipeline-trace-command-validation`, `pipeline-trace-lookup`, `pipeline-show-annotation`, `pipeline-run-preflight`, `pipeline-runs-gc`, `implement`, `meditate`) and the two sibling commands rely on. This lets the split land without rewriting test imports or the `meditate.ts` namespace import.

4. **Update `src/cli/program.ts:6-12`** to import directly from `./commands/pipeline/{run,validate,show,list,trace}.js`. The barrel survives only as a compatibility shim for the test files; new code imports from the per-subcommand modules.

5. **Add a unit-test file `src/cli/tests/pipeline-invocation.test.ts`** that exercises `loadPipeline()` directly: name shorthand resolution, missing file, syntax error, validation error, successful expand. The current sub-command tests stay (they exercise the full command path); the new test covers the seam directly so future drift in the resolve→parse→validate→expand sequence shows up at one assertion site.

6. **No CLI surface change.** Command names, flag names, help text, exit codes, and stderr/stdout formatting are byte-identical before and after. The barrel re-export means every existing test import path keeps working.

7. **Atomic landing.** The split lands as one merge: new files written, `pipeline.ts` rewritten as a barrel, `program.ts` updated. A staged rollout would create an interim state where some sub-commands route through `loadPipeline()` and others don't — the drift this design is meant to remove. Per `VISION.md` ("personal harness for one developer, one machine — not multi-tenant"), no cross-version compatibility window is needed.

## 3. Architecture

### 3.1 Before/after diagram

```
Before                                             After
──────                                             ─────
src/cli/commands/pipeline.ts (762 LOC)             src/cli/commands/pipeline-invocation.ts
  ├─ resolveResumeLogsRoot                            └─ loadPipeline() → LoadedPipeline
  ├─ gcOldRuns                                        └─ types: LoadedPipeline, LoadError
  ├─ diffEdgeLabels / labelIsReferenced
  ├─ pipelineValidateCommand                       src/cli/commands/pipeline/
  │    └─ parseDot → validateGraph → diag             ├─ run.ts        ~340 LOC
  ├─ pipelineRunCommand                               │   pipelineRunCommand + signal handler
  │    └─ parseDot → validateOrRaise →                │   imports loadPipeline, runPipeline, Ink TUI
  │       scanUndeclared → expand →                   │
  │       Ink TUI + signal + stream                   ├─ validate.ts   ~70 LOC
  ├─ pipelineListCommand                              │   pipelineValidateCommand + diffEdgeLabels
  ├─ pipelineTraceCommand                             │   imports loadPipeline + formatPipelineDiag
  ├─ pipelineShowCommand                              │
  │    └─ parseDot → validateGraph →                  ├─ show.ts       ~80 LOC
  │       annotateDotForShow → SVG                    │   pipelineShowCommand + renderDotToSvg
  └─ renderDotToSvg                                   │   imports loadPipeline + annotateDotForShow
                                                      │
src/cli/program.ts:6-12                               ├─ list.ts       ~40 LOC
  imports 5 commands from "./commands/pipeline"       │   pipelineListCommand
                                                      │   imports parseDot directly (no graph load)
11 test files                                         │
  import from "../commands/pipeline.js"               ├─ trace.ts      ~100 LOC
                                                      │   pipelineTraceCommand (no graph load)
                                                      │
                                                      └─ runs-gc.ts    ~60 LOC
                                                          gcOldRuns + resolveResumeLogsRoot
                                                          imported by run.ts and tests

                                                  src/cli/commands/pipeline.ts (~30 LOC barrel)
                                                    re-exports everything for back-compat:
                                                      pipelineRunCommand, pipelineValidateCommand,
                                                      pipelineListCommand, pipelineTraceCommand,
                                                      pipelineShowCommand, gcOldRuns,
                                                      resolveResumeLogsRoot, diffEdgeLabels,
                                                      PipelineRunOptions, PipelineValidateOptions,
                                                      PipelineShowOptions, PipelineListOptions

                                                  src/cli/program.ts:6-12
                                                    imports each command from its own module:
                                                      ./commands/pipeline/run.js, …/validate.js, …
```

### 3.2 `loadPipeline()` contract

```ts
// src/cli/commands/pipeline-invocation.ts

export interface LoadedPipeline {
  /** Parsed graph (NOT variable-expanded — callers expand themselves). */
  graph: Graph;
  /** Original .dot source (for diagnostic formatting). */
  src: string;
  /** Absolute path to the .dot file. */
  absPath: string;
  /** Path relative to process.cwd() — used for diagnostics. */
  relPath: string;
  /** Resolved project root (`opts.project ?? process.cwd()`, normalized). */
  projectRoot: string;
  /** All diagnostics emitted by validateGraph — info + warning + error.
   *  Callers walk this list and decide policy (run exits on error; validate
   *  and show pretty-print and continue or fail). */
  diagnostics: Diagnostic[];
}

export interface LoadPipelineOptions {
  /** Project folder; used for name shorthand resolution and as the `projectRoot` field. */
  project?: string;
}

export async function loadPipeline(
  dotFile: string,
  opts: LoadPipelineOptions = {},
): Promise<LoadedPipeline>;
```

Failure modes raise `PipelineLoadError`: `kind: "not-found"` (file missing), `kind: "read"` (read failed), `kind: "syntax"` (DotSyntaxError; `diagnostic` populated). Validation errors do *not* raise — they are returned in `diagnostics` so callers can format them per their own convention. Variable expansion and run-specific preflight (`scanUndeclaredCallerVars`, `findVarReferences("project")` for `$project`) are *not* part of `loadPipeline()` — they are run-only concerns and stay in `pipeline/run.ts`. (See §7.4 for why.)

`loadPipeline()` preserves the current behaviour of each call site:

- `pipelineRunCommand` calls `loadPipeline(dotFile, { project })`, then itself runs `validateOrRaise(graph)` (run-specific, throws on error), then its own preflight (`$project` + `scanUndeclaredCallerVars`), then `variableExpansionTransform`.
- `pipelineValidateCommand` calls `loadPipeline(dotFile, { project })`, walks `result.diagnostics` printing info / warning / error severity-by-severity, then runs `diffEdgeLabels` if a `previousGraph` was supplied.
- `pipelineShowCommand` calls `loadPipeline(dotFile, { project })`, prints diagnostics, and proceeds to `annotateDotForShow` only if no error-severity diagnostics are present.

**Divergence from explainer-render.** The explainer-render the user approved at the gate listed `LoadedPipeline { graph, diagnostics, projectRoot, runId }`. This contract drops `runId` because `runId` is generated inside `pipelineRunCommand` at `src/cli/commands/pipeline.ts:286` (`randomUUID().slice(0, 8)`) *after* gc decisions and *before* logsRoot derivation. It is a run-scoped concern, not a graph-load concern; including it on every `LoadedPipeline` would force `validate`, `show`, `list`, and `trace` to receive a run id they never use. The explainer's high-level "graph + diagnostics + project root" promise is preserved; only the run-specific field is reattributed to the run command.

### 3.3 Surfaces unchanged

- The `Graph` type, `parseDot`, `validateGraph`, `validateOrRaise`, `variableExpansionTransform`, `scanUndeclaredCallerVars`, `findVarReferences` signatures. Unchanged.
- Diagnostic shape (`src/attractor/types.ts`) and `formatPipelineDiag`. Unchanged.
- Pipeline `.dot` syntax. Unchanged.
- Agent rubric / frontmatter schema. Unchanged.
- `apparat pipeline {run,validate,show,list,trace}` CLI flags, command names, help text, exit codes. Unchanged.
- `pipeline.jsonl` per-node trace shape. Unchanged.
- Public exports from `src/cli/commands/pipeline.ts` — preserved by barrel re-export so the 11 test files and `meditate.ts`'s namespace import (`src/cli/commands/meditate.ts:6`) keep working without edits.

### 3.4 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Pipeline-invocation seam | `src/cli/commands/pipeline-invocation.ts` | **New** — owns `loadPipeline()` + `LoadedPipeline` |
| Sub-command files | `src/cli/commands/pipeline/{run,validate,show,list,trace,runs-gc}.ts` | **New** — extracted from current `pipeline.ts` |
| Barrel | `src/cli/commands/pipeline.ts` | **Rewritten** — pure re-exports |
| CLI registration | `src/cli/program.ts:6-12` | Inline edit — import from per-subcommand modules |
| Sibling consumers | `src/cli/commands/implement.ts:3` (imports `pipelineRunCommand`); `src/cli/commands/meditate.ts:6` (`import * as self from "./pipeline.js"`) | No edits — barrel preserves both shapes |
| Heartbeat | `src/cli/commands/heartbeat.ts:7-8` (imports `parseDot`, `findVarReferences` from attractor — *not* from `pipeline.ts`) | **No edit needed** — heartbeat does not import from `pipeline.ts` (verified by grep; the verifier's blast paragraph mentioned heartbeat as a sharer of `parseDot` but not as an importer of `pipeline.ts`) |
| Tests — existing | 11 files: `src/cli/tests/{pipeline,pipeline-show,pipeline-headless,pipeline-failure-reason,pipeline-trace-command-validation,pipeline-trace-lookup,pipeline-show-annotation,pipeline-run-preflight,pipeline-runs-gc,implement,meditate}.test.ts` | No edits — all import via the barrel path `../commands/pipeline.js` |
| Tests — new | `src/cli/tests/pipeline-invocation.test.ts` | **New** — covers the seam directly |
| Docs | `IMPLEMENTATION_PLAN.md:32,302,374,518,776`; `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md:108`; `src/attractor/core/engine.ts:25` (comment reference) | Inline edit — line numbers in those references will drift; update only the specific line numbers, not the prose |

### 3.5 LOC sanity check

| File | Approx LOC after split |
|---|---|
| `pipeline-invocation.ts` | ~120 (loadPipeline + types + error class) |
| `pipeline/run.ts` | ~340 (run command + signal handler + interactive plumbing) |
| `pipeline/validate.ts` | ~70 |
| `pipeline/show.ts` | ~80 |
| `pipeline/list.ts` | ~40 |
| `pipeline/trace.ts` | ~100 |
| `pipeline/runs-gc.ts` | ~60 |
| `pipeline.ts` (barrel) | ~30 |
| **Total** | **~840** |

The split adds ~80 LOC across imports, type re-declarations, and barrel boilerplate — acceptable for the locality and seam clarity gains. `run.ts` at ~340 LOC is the largest file post-split and itself a candidate for a future split (the SIGINT handler + interactive callback closure is ~120 LOC), but that is out of scope for this design.

## 4. Components & file edits

### 4.1 `src/cli/commands/pipeline-invocation.ts` (new)

```ts
import { existsSync, readFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";
import {
  isNameShorthand,
  resolvePipelineArg,
} from "../lib/pipeline-resolver.js";
import { DotSyntaxError } from "../../attractor/core/dot-syntax.js";
import type { Graph, Diagnostic } from "../../attractor/types.js";

export class PipelineLoadError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "read" | "syntax",
    readonly diagnostic?: Diagnostic,
  ) {
    super(message);
  }
}

export interface LoadedPipeline {
  graph: Graph;
  src: string;
  absPath: string;
  relPath: string;
  projectRoot: string;
  diagnostics: Diagnostic[];
}

export interface LoadPipelineOptions {
  project?: string;
}

export async function loadPipeline(
  dotFile: string,
  opts: LoadPipelineOptions = {},
): Promise<LoadedPipeline> {
  const projectRoot = resolve(opts.project ?? process.cwd());
  const absPath = isNameShorthand(dotFile)
    ? resolvePipelineArg(dotFile, projectRoot)
    : resolve(dotFile);

  if (!existsSync(absPath)) {
    throw new PipelineLoadError(`Dot file not found: ${absPath}`, "not-found");
  }

  let src: string;
  try { src = readFileSync(absPath, "utf8"); }
  catch { throw new PipelineLoadError(`Cannot read file: ${absPath}`, "read"); }

  const relPath = relative(process.cwd(), absPath) || absPath;

  let graph: Graph;
  try { graph = parseDot(src); }
  catch (e) {
    if (e instanceof DotSyntaxError) {
      const diag: Diagnostic = {
        rule: "syntax", severity: "error", message: e.message, location: e.location,
      };
      throw new PipelineLoadError(e.message, "syntax", diag);
    }
    throw e;
  }

  const diagnostics = validateGraph(graph, dirname(absPath));

  return { graph, src, absPath, relPath, projectRoot, diagnostics };
}
```

`loadPipeline()` does *not* call `validateOrRaise`, `findVarReferences("project")`, `scanUndeclaredCallerVars`, or `variableExpansionTransform`. Those are all run-specific concerns and stay in `pipeline/run.ts` (§4.2). `loadPipeline()` returns *all* diagnostics — info + warning + error severity — and the caller decides what to do with them. The `PipelineLoadError` `kind` discriminant lets each caller map I/O and parse failures to its own exit/output convention (run uses `process.exit(1)` with the same stderr text the current code emits at `src/cli/commands/pipeline.ts:209-211`, `:219-222`; validate and show return an exit code from their own command function).

### 4.2 `src/cli/commands/pipeline/run.ts` (new)

`pipelineRunCommand` (currently `src/cli/commands/pipeline.ts:204-544`) is moved with two structural changes:

1. The first ~30 lines (resolve, read, parse) are replaced by a `loadPipeline()` call. The run-specific steps (`validateOrRaise`, `$project` preflight, `scanUndeclaredCallerVars`, `variableExpansionTransform`) stay inline because each one is tied to a specific exit-code or warning policy:

   ```ts
   let loaded: LoadedPipeline;
   try { loaded = await loadPipeline(dotFile, { project: opts.project }); }
   catch (err) {
     if (err instanceof PipelineLoadError) {
       await output.error(err.message);
       process.exit(1);
     }
     throw err;
   }
   let graph = loaded.graph;
   const dotDir = dirname(loaded.absPath);
   const project = loaded.projectRoot;

   try { validateOrRaise(graph); }
   catch (err) { await output.error((err as Error).message); process.exit(1); }

   // $project preflight (preserved from src/cli/commands/pipeline.ts:225-235).
   if (!opts.project) {
     const refs = findVarReferences(graph, "project");
     if (refs.length > 0) {
       process.stderr.write(/* same message */);
       process.exit(1);
     }
   }

   // scanUndeclaredCallerVars preflight (preserved from :237-261).
   const preflight = scanUndeclaredCallerVars(graph, opts.variables ?? {});
   // …existing three branches (formatMissingInputsError / formatLegacyMissingWarning /
   //   formatUndeclaredWarning) unchanged…

   graph = variableExpansionTransform(graph, {
     project: opts.project,
     context: opts.variables,
   });
   // …rest of pipelineRunCommand unchanged from :268 onward.
   ```

2. `gcOldRuns` and `resolveResumeLogsRoot` are imported from `./runs-gc.js` instead of being defined in the same file.

Everything from `src/cli/commands/pipeline.ts:268` (headless safety check) onward — the runId, runsRoot, logsRoot derivation, `JsonlPipelineTracer`, `renderPipelineApp`, the SIGINT/SIGTERM handler, `runPipeline` invocation, and the `finally` block — moves into `run.ts` verbatim.

### 4.3 `src/cli/commands/pipeline/validate.ts` (new)

`pipelineValidateCommand` (currently `src/cli/commands/pipeline.ts:147-201`) plus `diffEdgeLabels` + `labelIsReferenced` (`:115-145`) are moved verbatim. The first ~25 lines collapse to:

```ts
let loaded: LoadedPipeline;
try { loaded = await loadPipeline(dotFile, { project: opts.project }); }
catch (err) {
  if (err instanceof PipelineLoadError) {
    if (err.diagnostic) {
      await output.error(formatPipelineDiag(err.diagnostic, /*src=*/"", err.message));
    } else {
      await output.error(err.message);
    }
    return 1;
  }
  throw err;
}
const { graph, src, relPath, diagnostics } = loaded;
const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);
// …existing severity loop, diff-edge-labels block, success message…
```

### 4.4 `src/cli/commands/pipeline/show.ts` (new)

`pipelineShowCommand` (currently `src/cli/commands/pipeline.ts:697-762`) plus `renderDotToSvg` (`:691-695`) are moved verbatim. The leading 20 lines fold into a `loadPipeline()` call mirroring `validate.ts`. Sister illumination `pipeline-show-couples-to-agent-frontmatter` (also dated 2026-05-06) becomes a much smaller fix once `show.ts` is its own file — the agent-frontmatter coupling lives only in this 80-LOC file.

### 4.5 `src/cli/commands/pipeline/list.ts` (new)

`pipelineListCommand` (currently `src/cli/commands/pipeline.ts:550-583`) is moved verbatim. It does not call `loadPipeline()` because it inspects multiple .dot files and tolerates parse failures per-entry (`src/cli/commands/pipeline.ts:572-579`). It imports `parseDot` directly.

### 4.6 `src/cli/commands/pipeline/trace.ts` (new)

`pipelineTraceCommand` (currently `src/cli/commands/pipeline.ts:585-684`) is moved verbatim. It does not call `loadPipeline()` — it reads `pipeline.jsonl` traces, not .dot files. It is moved purely for sub-command locality.

### 4.7 `src/cli/commands/pipeline/runs-gc.ts` (new)

`gcOldRuns` (currently `src/cli/commands/pipeline.ts:97-112`) and `resolveResumeLogsRoot` (`:57-90`) are moved verbatim. Co-locating them avoids importing run-loop helpers from `run.ts` (which is heavy with Ink). The existing `src/cli/tests/pipeline-runs-gc.test.ts` continues to import `gcOldRuns` from `../commands/pipeline.js` (the barrel).

### 4.8 `src/cli/commands/pipeline.ts` (rewritten as barrel)

```ts
// src/cli/commands/pipeline.ts
//
// Barrel re-export. Implementation lives under ./pipeline/ and in
// ./pipeline-invocation.ts. This file exists to preserve import paths
// for the 11 test files and the sibling commands that import from it.

export { pipelineRunCommand } from "./pipeline/run.js";
export type { PipelineRunOptions } from "./pipeline/run.js";
export { pipelineValidateCommand, diffEdgeLabels } from "./pipeline/validate.js";
export type { PipelineValidateOptions } from "./pipeline/validate.js";
export { pipelineShowCommand } from "./pipeline/show.js";
export type { PipelineShowOptions } from "./pipeline/show.js";
export { pipelineListCommand } from "./pipeline/list.js";
export type { PipelineListOptions } from "./pipeline/list.js";
export { pipelineTraceCommand } from "./pipeline/trace.js";
export { gcOldRuns, resolveResumeLogsRoot } from "./pipeline/runs-gc.js";
```

`meditate.ts:6` (`import * as self from "./pipeline.js"`) continues to work because `self.pipelineRunCommand` resolves to the re-exported binding.

### 4.9 `src/cli/program.ts:6-12`

```ts
import { pipelineRunCommand } from "./commands/pipeline/run.js";
import { pipelineValidateCommand } from "./commands/pipeline/validate.js";
import { pipelineListCommand } from "./commands/pipeline/list.js";
import { pipelineTraceCommand } from "./commands/pipeline/trace.js";
import { pipelineShowCommand } from "./commands/pipeline/show.js";
```

Direct imports avoid round-tripping through the barrel for the entry point. The barrel exists for test/sibling-command back-compat, not for first-class consumers.

### 4.10 `src/cli/tests/pipeline-invocation.test.ts` (new)

A focused unit test on the new seam. Covers:

- `loadPipeline("nonexistent.dot")` → throws `PipelineLoadError` with `kind: "not-found"`.
- `loadPipeline("read-fails.dot")` (file exists but cannot be read; e.g. permission denied via test fixture) → throws `PipelineLoadError` with `kind: "read"`.
- `loadPipeline("syntax-error.dot")` → throws `PipelineLoadError` with `kind: "syntax"` and a populated `diagnostic` carrying `severity: "error"` and a `location`.
- `loadPipeline("validation-error.dot")` (e.g. dangling edge, missing start node) → returns successfully; `result.diagnostics` includes at least one entry with `severity: "error"`. The seam does not throw — callers walk the diagnostics list and decide policy.
- `loadPipeline("name-shorthand", { project })` → returns successfully with `absPath` pointing at `<project>/.apparat/pipelines/name-shorthand/pipeline.dot` (or the bundled fallback path resolved by `resolvePipelineArg`).
- `loadPipeline("good.dot", { project })` → returns `LoadedPipeline` with `graph.name`, `src` containing the original .dot text, `absPath` absolute, `relPath` relative to `process.cwd()`, `projectRoot` equal to `resolve(opts.project)`, and `diagnostics` empty for a clean pipeline.

The test does *not* exercise `validateOrRaise`, `findVarReferences("project")`, `scanUndeclaredCallerVars`, or `variableExpansionTransform` — those live in `pipeline/run.ts` and are exercised by `src/cli/tests/pipeline-run-preflight.test.ts` and the existing `pipeline.test.ts` end-to-end cases through the barrel.

## 5. Data flow

### 5.1 Before — three paths

```
pipeline run workflow.dot --project my-app
  → src/cli/commands/pipeline.ts:204 pipelineRunCommand
    → resolvePipelineArg (:206)
    → readFileSync (:214)
    → parseDot (:216)
    → validateOrRaise (:218)         ← "raise" path
    → findVarReferences (:226)
    → scanUndeclaredCallerVars (:238)
    → variableExpansionTransform (:263)
    → runPipeline + Ink TUI

pipeline validate workflow.dot
  → src/cli/commands/pipeline.ts:147 pipelineValidateCommand
    → resolvePipelineArg (:149)
    → readFileSync (:157)
    → parseDot (:164)
    → validateGraph (:178)            ← "collect" path
    → diagnostic loop (:179-185)
    → diffEdgeLabels (:189)

pipeline show workflow.dot
  → src/cli/commands/pipeline.ts:697 pipelineShowCommand
    → resolvePipelineArg (:702)
    → readFileSync (:712)
    → parseDot (:719)
    → validateGraph (:734)            ← "collect" path again
    → diagnostic loop (:736-737)
    → annotateDotForShow (:740)
    → renderDotToSvg (:743)
```

### 5.2 After — one seam, three callers

```
pipeline run workflow.dot --project my-app
  → src/cli/commands/pipeline/run.ts pipelineRunCommand
    → loadPipeline(dotFile, { project }) ─────┐
    → validateOrRaise (run-specific)          │
    → findVarReferences ($project preflight)  │
    → scanUndeclaredCallerVars                ├─ src/cli/commands/pipeline-invocation.ts
    → variableExpansionTransform              │     loadPipeline:
    → runPipeline + Ink TUI                   │       resolvePipelineArg → readFileSync →
                                              │       parseDot → validateGraph (collect)
pipeline validate workflow.dot                │
  → src/cli/commands/pipeline/validate.ts     │
    → loadPipeline(dotFile, { project }) ─────┤
    → diagnostic loop (validate-specific)     │
    → diffEdgeLabels                          │
                                              │
pipeline show workflow.dot                    │
  → src/cli/commands/pipeline/show.ts         │
    → loadPipeline(dotFile, { project }) ─────┘
    → diagnostic loop (show-specific)
    → annotateDotForShow → renderDotToSvg
```

The first ~40 LOC of each path collapse into one `await loadPipeline(...)` call. Each sub-command keeps its own post-load behaviour (validate runs the diff, show renders SVG, run does preflight + Ink TUI), but the parts they used to disagree on now flow through one named module.

## 6. Blast radius / impact surface

- **Size:** **M** by file count (1 new seam + 6 new sub-command files + 1 new test + 1 rewrite + 1 program.ts edit). **S** by semantic risk — pure mechanical extraction, no behavioural change, all existing tests pass unchanged through the barrel.
- **Files touched:** ~10 (src) + 1 (test) + ~5 doc/comment line-number references.
- **Surfaces crossed:**
  - **CLI command files** — `src/cli/commands/pipeline.ts` rewritten as barrel; new `src/cli/commands/pipeline-invocation.ts`; new `src/cli/commands/pipeline/{run,validate,show,list,trace,runs-gc}.ts`.
  - **CLI registration** — `src/cli/program.ts:6-12`.
  - **Tests** — new `src/cli/tests/pipeline-invocation.test.ts`. The 11 existing test files importing via the barrel are untouched.
  - **Docs (line-number refs)** — `IMPLEMENTATION_PLAN.md` cites `pipeline.ts:288` (`APPARAT_RUNS_KEEP`); `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md:108` cites `pipeline.ts` line 288; `src/attractor/core/engine.ts:25` carries a comment pointing at `src/cli/commands/pipeline.ts`. These references will drift; the implementation plan must update them to the new file (`pipeline/run.ts`).
- **Breaking changes:** **no.**
  - No CLI flag, command name, help text, exit code, or stdout/stderr shape changes.
  - No public TypeScript export from `src/cli/commands/pipeline.ts` is removed — barrel preserves every existing binding.
  - `meditate.ts`'s namespace import (`import * as self from "./pipeline.js"` at `src/cli/commands/meditate.ts:6`) keeps working — `self.pipelineRunCommand` resolves through the re-export. Verified by inspection.
  - `implement.ts`'s named import (`import { pipelineRunCommand } from "./pipeline.js"` at `src/cli/commands/implement.ts:3`) keeps working — same path, same name, barrel-resolved.
  - 11 test files importing from `../commands/pipeline.js` keep working — same path, same names, barrel-resolved.
- **Spec / docs ripple:**
  - [ ] `IMPLEMENTATION_PLAN.md:32,302,374,518,776` — five references to `src/cli/commands/pipeline.ts` line numbers. Update line numbers (or delete if stale plan steps).
  - [ ] `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md:108` — references `pipeline.ts:288`; update line number after the split.
  - [ ] `src/attractor/core/engine.ts:25` — comment referencing `src/cli/commands/pipeline.ts`. Update to point at `src/cli/commands/pipeline/run.ts`.
  - [ ] No ADR required. ADR-0001 (single-tier collapse) and the recent `graph-validator.ts` extraction are the precedent; this design is an *application* of that pattern, not a new principle.
  - [ ] No README, CONTEXT.md, AGENTS.md, or VISION.md change.
- **Test ripple:**
  - [ ] **New** `src/cli/tests/pipeline-invocation.test.ts` — covers the new seam.
  - [ ] No edits to the 12 existing test files. The barrel preserves their import paths. `implement.test.ts:4` (`vi.mock("../commands/pipeline.js", …)`) keeps working — vi.mock against the barrel is satisfied by re-exports because the barrel module is what the consumer imports.

## 7. Trade-offs

### 7.1 Barrel vs. updating 12 test imports

A "no barrel; rewrite imports" variant would update each of the 12 test files to import from the per-subcommand module (e.g. `pipeline-show.test.ts` → `from "../commands/pipeline/show.js"`). Reasons to keep the barrel:

- 12 import-path edits across test files is review noise that obscures the structural change. The barrel keeps the structural change reviewable as one diff: "here is the new layout, here is the shim that preserves contracts."
- `implement.test.ts:4` uses `vi.mock("../commands/pipeline.js", () => ({ pipelineRunCommand: vi.fn() }))`. Without the barrel, this mock target moves to `../commands/pipeline/run.js`. Survivable, but a forced edit per mock site.
- A barrel costs ~30 LOC and incurs no runtime overhead. The cost-to-clarity ratio favours keeping it.
- Future cleanup is cheap: when new code is naturally written against the per-subcommand modules and the barrel's only consumers are test files, the barrel can be deleted in one grep-and-rewrite pass.

### 7.2 Single `loadPipeline()` vs. per-subcommand helpers

A "no shared seam; just split the file" variant would let each sub-command keep its own resolve→read→parse→validate sequence inline. Reasons to extract:

- The drift this design fixes (validate uses `validateGraph`, run uses `validateOrRaise`, show uses `validateGraph` — each with a different error path) is the entire reason the illumination flagged the file. Splitting without naming the sequence preserves the bug class in five smaller files instead of one big one.
- The seam earns its name: it has a clear input (path or shorthand + project), a clear output (typed `LoadedPipeline`), and a clear failure shape (typed `PipelineLoadError` discriminated by `kind`).
- Future tooling (daemon, smoke harness, MCP server) needs the same sequence. Today they re-derive it; with the seam, they import it.

### 7.3 `run.ts` retains the full signal/Ink/stream apparatus vs. further split

`run.ts` at ~340 LOC is the largest post-split file. The SIGINT/SIGTERM handler + `onInteractiveRequest` closure could be its own `pipeline/run-interactive.ts` (~120 LOC). Reasons to defer:

- The illumination's scope is "split the god module by sub-command and extract the load sequence." Splitting `run.ts` further is a separate decision with its own design.
- The interactive callback closes over local variables (`emit`, `currentBlockNodeId`, `interactiveResolve`, `markInteractiveAbort`, `killInteractiveChild`) used only inside `pipelineRunCommand`. Extracting it requires either packaging the closures into a class or threading state through arguments — a real design choice, not a mechanical move.
- 340 LOC for the run command is a substantial improvement over 762 LOC for the whole file. Diminishing returns set in once the file owns one coherent surface.

### 7.4 `loadPipeline()` minimal vs. all-encompassing

An earlier draft of this design had `loadPipeline()` accept a `raiseOnValidationError` flag and a `callerVariables` option that, together, would let it run `validateOrRaise`, the `$project` preflight, and `variableExpansionTransform` on the run path. Reasons the final shape rejects that:

- The preflight steps (`scanUndeclaredCallerVars`, `findVarReferences("project")`) are run-specific exit/warning *policy*, not a generic graph-loading concern. `validate`, `show`, `list`, and `trace` would never call them.
- A function that "parses, validates, conditionally throws or collects, conditionally runs preflight, conditionally expands variables" is doing three jobs guarded by flags. Each flag is a place a future caller will get the policy wrong.
- The clean shape — `loadPipeline()` returns a graph + diagnostics; the caller decides — keeps the seam honest. `pipeline/run.ts` runs the run-specific dance inline; `validate` and `show` walk diagnostics and pretty-print. No flag is needed because each caller has a different next step anyway.

### 7.5 Atomic vs. staged

A staged path — extract `loadPipeline()` first; in a follow-up, split sub-commands — lets each commit land independently green. Reasons to ship atomically:

- Each commit alone produces interim drift: the seam exists but only one sub-command uses it, while the others still open-code the sequence. Reviewing a partial change requires understanding both the new seam and the surviving god-module — more cognitive load than reviewing the final shape.
- The split is mechanical. There is no design risk in landing the whole thing at once that the split-into-stages would mitigate.
- One developer, one machine — no cohort needs an interim commit.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — all 11 existing test files plus the new `pipeline-invocation.test.ts`.
  - `apparat pipeline run`, `validate`, `show`, `list`, `trace` produce byte-identical stderr/stdout to the pre-split baseline. Exit codes unchanged.
- Repo-wide grep invariants post-merge:
  - `src/cli/commands/pipeline.ts` exists and is < 50 LOC (barrel).
  - `src/cli/commands/pipeline-invocation.ts` exists and exports `loadPipeline` + `LoadedPipeline` + `PipelineLoadError`.
  - `src/cli/commands/pipeline/run.ts`, `validate.ts`, `show.ts`, `list.ts`, `trace.ts`, `runs-gc.ts` all exist.
  - `src/cli/program.ts` imports from `./commands/pipeline/run.js` etc., not from `./commands/pipeline`.
  - The 11 test files at `src/cli/tests/{pipeline,pipeline-show,…,implement,meditate}.test.ts` still import from `../commands/pipeline.js` (proves the barrel works).
- Behaviour invariants:
  - `meditate.ts:74` `self.pipelineRunCommand("meditate", …)` runs the same code as before — verified by an existing scenario test.
  - `implement.ts:29` `pipelineRunCommand("implement", …)` runs the same code as before.
  - `vi.mock("../commands/pipeline.js", …)` in `implement.test.ts:4` continues to intercept `pipelineRunCommand` — verified by re-running the existing test.

## 9. Open questions

- **Where does the SIGINT/Ink/stream apparatus live long-term?** This design keeps it in `run.ts`. A future split into `pipeline/run-interactive.ts` is plausible but requires designing the closure shape. Defer.
- **Should `runs-gc.ts` move under `src/cli/lib/` instead of `src/cli/commands/pipeline/`?** It's a pure I/O helper, not a command. Reasons to keep it inside `pipeline/`: it has no other consumer; co-location matches the locality goal of the split. Reasons to move: `gcOldRuns` is also called from the future smoke harness. Default: keep in `pipeline/runs-gc.ts`. Flag for the implementing session.
- **Does `loadPipeline()` belong in `src/cli/commands/` or in `src/cli/lib/`?** It's a CLI-layer helper, not specific to one command. Default placement is `src/cli/commands/pipeline-invocation.ts` because its only consumers are pipeline sub-commands. If a non-CLI consumer (daemon, MCP) ever needs it, lift it to `src/cli/lib/` then. Defer.
- **Does the existing `validateOrRaise` vs `validateGraph` divergence indicate a deeper model bug?** This design treats it as cosmetic (run wants throw, validate/show want collect-then-format). If the real concern is "two validation entry points for one validator," that is its own design, not this one. Out of scope.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean. The barrel re-exports preserve every public symbol; TypeScript catches any missed export.
- Grep `src/cli/commands/pipeline.ts` line count — `wc -l` returns < 50.
- Grep `from "./pipeline"` against `src/cli/program.ts` — zero hits (program imports from `./pipeline/<sub>`).
- Grep `from "../commands/pipeline.js"` against `src/cli/tests/` — 11 hits (unchanged from before).

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/pipeline-show.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/pipeline-runs-gc.test.ts` — passes unchanged (`gcOldRuns` re-exported through barrel).
- `npx vitest run src/cli/tests/implement.test.ts` — passes unchanged (`vi.mock("../commands/pipeline.js", …)` continues to intercept).
- `npx vitest run src/cli/tests/meditate.test.ts` — passes unchanged (`import * as pipelineMod` continues to bind to the barrel).
- `npx vitest run src/cli/tests/pipeline-invocation.test.ts` — new test, passes.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline list --project my-app` — produces identical output before and after.
- `apparat pipeline validate good.dot` — exit 0, identical output.
- `apparat pipeline validate broken.dot` — exit 1, identical diagnostic format.
- `apparat pipeline show good.dot` — writes identical SVG.
- `apparat pipeline run good.dot --project my-app` — runs end-to-end, identical TUI rendering.
- `apparat pipeline trace <runId>` — identical output format.
- `apparat implement my-app` (which calls `pipelineRunCommand("implement", …)` via the barrel) — runs without difference.
- `apparat meditate my-app` (which calls `self.pipelineRunCommand("meditate", …)`) — runs without difference.

### 10.4 Negative cases

- A test that imports a *removed* symbol from `../commands/pipeline.js` — e.g. an internal helper not re-exported through the barrel — TypeScript catches at compile time. The barrel must include every symbol any test imports today.
- A merge that lands `program.ts` updated but `pipeline/run.ts` missing — `npx tsc --noEmit` catches; `vitest run` catches.
- A merge that creates `pipeline/run.ts` but forgets to remove the original `pipelineRunCommand` definition from the (now-rewritten) `pipeline.ts` — `npx tsc --noEmit` catches duplicate-export error.

## 11. Summary

`src/cli/commands/pipeline.ts` is a 762-LOC file that holds five sub-commands as sibling exports and open-codes the resolve→parse→validate sequence three times with subtle drift (validate uses `validateGraph`, run uses `validateOrRaise`, show uses `validateGraph` with a third diagnostic shape). This design extracts the resolve→parse→validate steps into a single `loadPipeline()` seam at `src/cli/commands/pipeline-invocation.ts` returning `LoadedPipeline { graph, src, absPath, relPath, projectRoot, diagnostics }`, and moves each sub-command into its own file under `src/cli/commands/pipeline/{run,validate,show,list,trace,runs-gc}.ts`. Run-specific steps (validateOrRaise, $project preflight, scanUndeclaredCallerVars, variableExpansionTransform) stay inline in `pipeline/run.ts` rather than being absorbed into `loadPipeline()`, because each one is tied to a run-specific exit/warning policy that the other sub-commands never invoke. The current `pipeline.ts` survives as a ~30-LOC barrel re-export so the 11 existing test files and the two sibling commands (`implement.ts`, `meditate.ts`) keep their import paths unchanged. `src/cli/program.ts:6-12` is updated to import directly from the per-subcommand modules; the barrel exists for back-compat, not as the canonical import surface. A new focused unit test `src/cli/tests/pipeline-invocation.test.ts` covers the seam. The explainer-render the user approved at the gate listed `runId` on `LoadedPipeline`; this design drops it because `runId` is generated *inside* `pipelineRunCommand` after gc decisions and is not a graph-load concern (§3.2). Blast radius is M (~10 src files, 1 new test, ~5 doc/comment line-number references); breaking changes: zero. Pipeline `.dot` syntax, agent rubrics, MCP tools, the public CLI surface, exit codes, and stderr/stdout formatting are all byte-identical before and after.
