# Pipeline Command Orchestration Monolith Split — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 762-LOC `src/cli/commands/pipeline.ts` god module into a `loadPipeline()` seam plus per-subcommand files, behind a barrel re-export that preserves all existing import paths.

**Architecture:** Extract the resolve→read→parse→validate sequence into a typed `loadPipeline()` in a new `src/cli/commands/pipeline-invocation.ts` (returning `LoadedPipeline { graph, src, absPath, relPath, projectRoot, diagnostics }` and raising `PipelineLoadError` for I/O / syntax failures). Move each sub-command into its own file under `src/cli/commands/pipeline/{run,validate,show,list,trace,runs-gc}.ts`. Rewrite the original `pipeline.ts` as a barrel re-export so the 11 existing test files and sibling commands (`implement.ts`, `meditate.ts`) keep their imports unchanged. Update `program.ts` to import directly from the per-subcommand modules. No CLI surface change; behaviour byte-identical.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Commander, Ink, attractor pipeline engine.

**Source of truth:** [`docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md`](../specs/2026-05-06-pipeline-command-orchestration-monolith-design.md)

**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T1426-pipeline-command-orchestration-monolith.md`

---

## Conventions for every chunk

- Run all `npx` commands from repo root (`/Users/josu/Documents/projects/apparatus`).
- After every code change, run `npx tsc --noEmit` and the targeted test before committing.
- Commit each step with the message specified — small commits are intentional.
- Do **not** edit any other test file. The barrel preserves their import paths.
- Use the same code formatting as the surrounding file (2-space indent, double quotes, trailing commas where present).

---

## Chunk 1: Extract `loadPipeline()` seam (TDD red → green)

### Task 1.1: Write failing test for `loadPipeline()` happy path

**Files:**
- Create: `src/cli/tests/pipeline-invocation.test.ts`

- [x] **Step 1: Write the failing test file**

Create `src/cli/tests/pipeline-invocation.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  loadPipeline,
  PipelineLoadError,
} from "../commands/pipeline-invocation.js";

const GOOD_DOT = `digraph g {
  start [label="start"];
  done [label="done"];
  start -> done;
}`;

const SYNTAX_DOT = `digraph g { start [label= ;`;

const VALIDATION_DOT = `digraph g {
  orphan [label="orphan"];
}`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pipeline-invocation-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadPipeline", () => {
  it("loads a clean .dot file and returns the graph + diagnostics", async () => {
    const dotPath = join(tmp, "good.dot");
    writeFileSync(dotPath, GOOD_DOT, "utf8");
    const result = await loadPipeline(dotPath);
    expect(result.graph).toBeDefined();
    expect(result.src).toContain("digraph");
    expect(result.absPath).toBe(resolve(dotPath));
    expect(result.relPath).toBeTruthy();
    expect(result.projectRoot).toBe(resolve(process.cwd()));
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("uses opts.project as projectRoot", async () => {
    const dotPath = join(tmp, "good.dot");
    writeFileSync(dotPath, GOOD_DOT, "utf8");
    const project = mkdtempSync(join(tmpdir(), "proj-"));
    try {
      const result = await loadPipeline(dotPath, { project });
      expect(result.projectRoot).toBe(resolve(project));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("throws PipelineLoadError with kind=not-found for missing file", async () => {
    const missing = join(tmp, "nope.dot");
    await expect(loadPipeline(missing)).rejects.toMatchObject({
      kind: "not-found",
    });
    await expect(loadPipeline(missing)).rejects.toBeInstanceOf(PipelineLoadError);
  });

  it("throws PipelineLoadError with kind=syntax + diagnostic for parse error", async () => {
    const dotPath = join(tmp, "bad.dot");
    writeFileSync(dotPath, SYNTAX_DOT, "utf8");
    try {
      await loadPipeline(dotPath);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineLoadError);
      const err = e as PipelineLoadError;
      expect(err.kind).toBe("syntax");
      expect(err.diagnostic).toBeDefined();
      expect(err.diagnostic?.severity).toBe("error");
    }
  });

  it("returns validation diagnostics WITHOUT throwing", async () => {
    const dotPath = join(tmp, "validation.dot");
    writeFileSync(dotPath, VALIDATION_DOT, "utf8");
    const result = await loadPipeline(dotPath);
    expect(result.graph).toBeDefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-invocation.test.ts`
Expected: FAIL — module `../commands/pipeline-invocation.js` not found.

- [x] **Step 3: Commit the failing test**

```bash
git add src/cli/tests/pipeline-invocation.test.ts
git commit -m "test: add failing pipeline-invocation seam tests"
```

### Task 1.2: Implement `loadPipeline()` to make the test pass

**Files:**
- Create: `src/cli/commands/pipeline-invocation.ts`

- [x] **Step 1: Confirm imports & symbols exist**

Run:
```bash
grep -n "export class DotSyntaxError\|export function parseDot" src/attractor/core/dot-syntax.ts src/attractor/core/graph.ts
grep -n "export function validateGraph" src/attractor/core/graph-validator.ts
grep -n "export function isNameShorthand\|export function resolvePipelineArg" src/cli/lib/pipeline-resolver.ts
grep -n "export interface Diagnostic\|export interface Graph" src/attractor/types.ts
```
Expected: each symbol resolves. If `isNameShorthand` is not exported from `pipeline-resolver.ts`, fall back to inlining the check as a small helper inside `pipeline-invocation.ts` (a leading "/" or containing `/`/`\` means it is a path; otherwise it is shorthand).

- [x] **Step 2: Write `pipeline-invocation.ts`**

Create `src/cli/commands/pipeline-invocation.ts`:

```ts
import { existsSync, readFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";
import { resolvePipelineArg } from "../lib/pipeline-resolver.js";
import { DotSyntaxError } from "../../attractor/core/dot-syntax.js";
import type { Graph, Diagnostic } from "../../attractor/types.js";

export class PipelineLoadError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "read" | "syntax",
    readonly diagnostic?: Diagnostic,
  ) {
    super(message);
    this.name = "PipelineLoadError";
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

function looksLikePath(arg: string): boolean {
  return arg.includes("/") || arg.includes("\\") || arg.endsWith(".dot");
}

export async function loadPipeline(
  dotFile: string,
  opts: LoadPipelineOptions = {},
): Promise<LoadedPipeline> {
  const projectRoot = resolve(opts.project ?? process.cwd());
  const absPath = looksLikePath(dotFile)
    ? resolve(dotFile)
    : resolvePipelineArg(dotFile, projectRoot);

  if (!existsSync(absPath)) {
    throw new PipelineLoadError(`Dot file not found: ${absPath}`, "not-found");
  }

  let src: string;
  try {
    src = readFileSync(absPath, "utf8");
  } catch {
    throw new PipelineLoadError(`Cannot read file: ${absPath}`, "read");
  }

  const relPath = relative(process.cwd(), absPath) || absPath;

  let graph: Graph;
  try {
    graph = parseDot(src);
  } catch (e) {
    if (e instanceof DotSyntaxError) {
      const diag: Diagnostic = {
        rule: "syntax",
        severity: "error",
        message: e.message,
        location: (e as unknown as { location?: Diagnostic["location"] }).location,
      } as Diagnostic;
      throw new PipelineLoadError(e.message, "syntax", diag);
    }
    throw e;
  }

  const diagnostics = validateGraph(graph, dirname(absPath));

  return { graph, src, absPath, relPath, projectRoot, diagnostics };
}
```

- [x] **Step 3: Reconcile shape mismatches**

If `validateGraph(graph, dotDir)` arity differs in the current codebase, run:
```bash
grep -n "export function validateGraph" src/attractor/core/graph-validator.ts
```
And match the call signature exactly. Same for `Diagnostic` shape — open `src/attractor/types.ts` and adjust the syntax-error `Diagnostic` literal so every required field is set (use the same construction the current `pipelineValidateCommand` uses for its DotSyntaxError → diagnostic conversion in `src/cli/commands/pipeline.ts:163-170`).

If `resolvePipelineArg` signature differs (e.g. takes options instead of `(arg, project)`), match its actual signature.

- [x] **Step 4: Run tsc and the seam test**

Run:
```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline-invocation.test.ts
```
Expected: tsc clean; all 5 cases pass.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/pipeline-invocation.ts
git commit -m "feat(pipeline): add loadPipeline() seam in pipeline-invocation.ts"
```

## Verification targets

- Smokes: None
- Manual exercises: None
- Lint: `npx vitest run src/cli/tests/pipeline-invocation.test.ts`, `npx tsc --noEmit`
- Surfaces touched: CLI command files

---

## Chunk 2: Extract `runs-gc.ts` (lowest-coupling helper first)

`gcOldRuns` and `resolveResumeLogsRoot` (`src/cli/commands/pipeline.ts:57-112`) have only one consumer (`pipelineRunCommand`) and one test (`pipeline-runs-gc.test.ts`). Move them first because they have no dependency on `loadPipeline()` and let us prove the barrel pattern works on the simplest case.

### Task 2.1: Move `gcOldRuns` + `resolveResumeLogsRoot` into a new module

**Files:**
- Create: `src/cli/commands/pipeline/runs-gc.ts`
- Modify: `src/cli/commands/pipeline.ts` (remove the two functions, add re-export)

- [x] **Step 1: Read the current implementations**

Open `src/cli/commands/pipeline.ts` and copy lines `57-112` verbatim — the two functions plus any local helpers/imports they use (look at lines `1-56` for the imports `gcOldRuns`/`resolveResumeLogsRoot` need: `existsSync`, `readdirSync`, `rmSync`, `statSync`, `join`, `resolve`, plus any constants like `APPARAT_RUNS_KEEP`).

- [x] **Step 2: Create the new file**

Create `src/cli/commands/pipeline/runs-gc.ts`. Paste the two functions plus the imports they actually reference. Do **not** re-export anything else. The file must compile in isolation.

- [x] **Step 3: Update `pipeline.ts` to re-export from the new file**

In `src/cli/commands/pipeline.ts`:
1. Delete the two function definitions and any imports that became unused.
2. Add at the top of the file (after surviving imports):
   ```ts
   export { gcOldRuns, resolveResumeLogsRoot } from "./pipeline/runs-gc.js";
   ```
3. Make sure the call sites inside `pipelineRunCommand` (still in `pipeline.ts`) now import the same names — change the in-file references to use the imports we just re-exported. If the run command body still resolves these locally because they were file-level functions, add `import { gcOldRuns, resolveResumeLogsRoot } from "./pipeline/runs-gc.js";` and remove the export-from-re-export collision (re-export plus import is fine in TS).

- [x] **Step 4: Run tsc + the runs-gc test**

```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline-runs-gc.test.ts
```
Expected: tsc clean; test passes (still imports `gcOldRuns` from `../commands/pipeline.js`, which is now a re-export).

- [x] **Step 5: Run the broader pipeline tests as smoke**

```bash
npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-headless.test.ts
```
Expected: pass.

- [x] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline/runs-gc.ts src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): move gcOldRuns + resolveResumeLogsRoot to pipeline/runs-gc.ts"
```

## Verification targets

- Smokes: None
- Manual exercises: None
- Lint: `npx vitest run src/cli/tests/pipeline-runs-gc.test.ts src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-headless.test.ts`, `npx tsc --noEmit`
- Surfaces touched: CLI command files

---

## Chunk 3: Extract `list` and `trace` (no `loadPipeline` dependency)

`pipelineListCommand` (`pipeline.ts:550-583`) and `pipelineTraceCommand` (`pipeline.ts:585-684`) do not call the resolve→parse→validate sequence. Move them next to validate the per-subcommand directory layout before tackling the three commands that use the new seam.

### Task 3.1: Extract `pipelineListCommand`

**Files:**
- Create: `src/cli/commands/pipeline/list.ts`
- Modify: `src/cli/commands/pipeline.ts`

- [x] **Step 1: Copy the function and its `PipelineListOptions` interface verbatim**

From `src/cli/commands/pipeline.ts:546-583` (and the `PipelineListOptions` interface — search the file for `interface PipelineListOptions` and grab it). Paste into `src/cli/commands/pipeline/list.ts` along with the imports it references (`parseDot`, `readdirSync`, `existsSync`, `join`, `relative`, `resolve`, the project-paths helper if any, plus `output` from `../lib/output.js`). Leave behaviour byte-identical.

- [x] **Step 2: Replace in-place with a re-export**

In `src/cli/commands/pipeline.ts`:
- Remove `pipelineListCommand` and `PipelineListOptions`.
- Append:
  ```ts
  export { pipelineListCommand } from "./pipeline/list.js";
  export type { PipelineListOptions } from "./pipeline/list.js";
  ```

- [x] **Step 3: Validate**

```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline.test.ts
```
Expected: pass.

- [x] **Step 4: Commit**

```bash
git add src/cli/commands/pipeline/list.ts src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): extract pipelineListCommand to pipeline/list.ts"
```

### Task 3.2: Extract `pipelineTraceCommand`

**Files:**
- Create: `src/cli/commands/pipeline/trace.ts`
- Modify: `src/cli/commands/pipeline.ts`

- [x] **Step 1: Copy `pipelineTraceCommand` (`pipeline.ts:585-684`) verbatim**

Paste into `src/cli/commands/pipeline/trace.ts` along with referenced imports (`readFileSync`, `existsSync`, `readdirSync`, `join`, `resolve`, the trace-related helpers — search `pipeline.ts` lines 585-684 for any locally-defined helpers used only by trace; if there are any, move them too).

- [x] **Step 2: Replace with re-export in `pipeline.ts`**

```ts
export { pipelineTraceCommand } from "./pipeline/trace.js";
```

- [x] **Step 3: Validate**

```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline-trace-lookup.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts
```
Expected: pass.

- [x] **Step 4: Commit**

```bash
git add src/cli/commands/pipeline/trace.ts src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): extract pipelineTraceCommand to pipeline/trace.ts"
```

## Verification targets

- Smokes: None
- Manual exercises: `apparat pipeline list --project <some-project>` produces same output as before; `apparat pipeline trace <runId>` ditto.
- Lint: `npx vitest run src/cli/tests/pipeline-trace-lookup.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts src/cli/tests/pipeline.test.ts`, `npx tsc --noEmit`
- Surfaces touched: CLI command files

---

## Chunk 4: Extract `validate` and wire it through `loadPipeline()`

### Task 4.1: Extract `pipelineValidateCommand` to `pipeline/validate.ts`

**Files:**
- Create: `src/cli/commands/pipeline/validate.ts`
- Modify: `src/cli/commands/pipeline.ts`

- [x] **Step 1: Identify what to move**

From `src/cli/commands/pipeline.ts`:
- `pipelineValidateCommand` (`:147-201`)
- `PipelineValidateOptions` interface
- `diffEdgeLabels` + `labelIsReferenced` (`:115-145`) — these are validate-specific helpers per design §4.3

- [x] **Step 2: Create `pipeline/validate.ts`**

Move all four items into `src/cli/commands/pipeline/validate.ts`. Replace the leading resolve→read→parse→validate block (`pipeline.ts:148-185` approximately) with:

```ts
import { dirname } from "path";
import {
  loadPipeline,
  PipelineLoadError,
  type LoadedPipeline,
} from "../pipeline-invocation.js";
import { formatPipelineDiag } from "../../lib/pipeline-diag-format.js";
import { output } from "../../lib/output.js";
import type { Diagnostic } from "../../../attractor/types.js";

// existing imports for diffEdgeLabels / labelIsReferenced (Graph type, etc.)

// …PipelineValidateOptions interface, diffEdgeLabels, labelIsReferenced unchanged…

export async function pipelineValidateCommand(
  dotFile: string,
  opts: PipelineValidateOptions,
): Promise<number> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.diagnostic) {
        await output.error(formatPipelineDiag(err.diagnostic, "", err.message));
      } else {
        await output.error(err.message);
      }
      return 1;
    }
    throw err;
  }
  const { graph, src, relPath, diagnostics } = loaded;
  const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);

  // …existing severity-by-severity loop, diff-edge-labels block, success message — copied verbatim from old pipelineValidateCommand body, just using `graph`, `src`, `relPath`, `diagnostics` from `loaded` instead of the old local vars.
}
```

The exact signature (return type, async vs sync) must match what `program.ts` registered. Open `src/cli/program.ts` and confirm. If the current command returns `void` and calls `process.exit`, keep that shape.

**Match import paths.** `pipeline-invocation.ts` lives at `src/cli/commands/pipeline-invocation.ts`; from `src/cli/commands/pipeline/validate.ts` it is imported as `"../pipeline-invocation.js"`. `formatPipelineDiag` lives at `src/cli/lib/pipeline-diag-format.ts`, imported as `"../../lib/pipeline-diag-format.js"`. Verify with:

```bash
grep -n "export" src/cli/lib/pipeline-diag-format.ts
```

- [x] **Step 3: Replace in `pipeline.ts` with re-export**

```ts
export { pipelineValidateCommand, diffEdgeLabels } from "./pipeline/validate.js";
export type { PipelineValidateOptions } from "./pipeline/validate.js";
```

(`labelIsReferenced` is internal — do **not** re-export unless any test imports it. Check with `grep -rn "labelIsReferenced" src/cli/tests/`.)

- [x] **Step 4: Validate**

```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-diag-format.test.ts
```
Expected: pass. Diagnostic output is byte-identical because `formatPipelineDiag(d, src, relPath)` is unchanged.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/pipeline/validate.ts src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): extract pipelineValidateCommand through loadPipeline() seam"
```

## Verification targets

- Smokes: None (validate is exercised by the unit tests)
- Manual exercises: `apparat pipeline validate <good.dot>` prints same output and returns exit 0; `apparat pipeline validate <broken.dot>` returns exit 1 with same diagnostic format.
- Lint: `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-diag-format.test.ts`, `npx tsc --noEmit`
- Surfaces touched: CLI command files

---

## Chunk 5: Extract `show` through `loadPipeline()`

### Task 5.1: Move `pipelineShowCommand` and `renderDotToSvg` to `pipeline/show.ts`

**Files:**
- Create: `src/cli/commands/pipeline/show.ts`
- Modify: `src/cli/commands/pipeline.ts`

- [x] **Step 1: Identify scope**

From `src/cli/commands/pipeline.ts`:
- `pipelineShowCommand` (`:697-762`)
- `renderDotToSvg` (`:691-695`) — only used by show
- `PipelineShowOptions` interface

- [x] **Step 2: Create `pipeline/show.ts`**

Pattern the leading block on validate's loadPipeline() block. The remainder of `pipelineShowCommand` (annotateDotForShow → renderDotToSvg) is moved verbatim. `annotateDotForShow` lives in `src/cli/lib/annotate-show.ts` (verify with `grep -n annotateDotForShow src/cli/lib/annotate-show.ts`); import it as `"../../lib/annotate-show.js"`.

```ts
import { dirname } from "path";
import {
  loadPipeline,
  PipelineLoadError,
  type LoadedPipeline,
} from "../pipeline-invocation.js";
import { formatPipelineDiag } from "../../lib/pipeline-diag-format.js";
import { annotateDotForShow } from "../../lib/annotate-show.js";
import { output } from "../../lib/output.js";
import type { Diagnostic } from "../../../attractor/types.js";

// PipelineShowOptions interface (verbatim from old pipeline.ts)
// renderDotToSvg (verbatim — lines 691-695)

export async function pipelineShowCommand(
  dotFile: string,
  opts: PipelineShowOptions,
): Promise<number> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.diagnostic) {
        await output.error(formatPipelineDiag(err.diagnostic, "", err.message));
      } else {
        await output.error(err.message);
      }
      return 1;
    }
    throw err;
  }
  const { graph, src, absPath, relPath, diagnostics } = loaded;
  const dotDir = dirname(absPath);

  // …existing severity-by-severity loop. If any diagnostic has severity "error",
  //   return 1 BEFORE calling annotateDotForShow (preserve current behaviour at
  //   pipeline.ts:736-738).
  // …then annotateDotForShow + renderDotToSvg, copied verbatim from old body.
}
```

- [x] **Step 3: Replace in `pipeline.ts` with re-export**

```ts
export { pipelineShowCommand } from "./pipeline/show.js";
export type { PipelineShowOptions } from "./pipeline/show.js";
```

- [x] **Step 4: Validate**

```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline-show.test.ts src/cli/tests/pipeline-show-annotation.test.ts
```
Expected: pass.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/pipeline/show.ts src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): extract pipelineShowCommand through loadPipeline() seam"
```

## Verification targets

- Smokes: None
- Manual exercises: `apparat pipeline show <good.dot>` writes byte-identical SVG; `apparat pipeline show <broken.dot>` errors with same format.
- Lint: `npx vitest run src/cli/tests/pipeline-show.test.ts src/cli/tests/pipeline-show-annotation.test.ts`, `npx tsc --noEmit`
- Surfaces touched: CLI command files

---

## Chunk 6: Extract `run` (the largest, most cross-cutting piece)

`pipelineRunCommand` is `pipeline.ts:204-544` (~340 LOC). It uses `loadPipeline()` for the leading sequence but keeps run-specific steps inline: `validateOrRaise`, `$project` preflight, `scanUndeclaredCallerVars`, `variableExpansionTransform`, runId derivation, runsRoot/logsRoot setup, JsonlPipelineTracer, Ink TUI, SIGINT/SIGTERM handler, runPipeline call, and finally block.

### Task 6.1: Move `pipelineRunCommand` to `pipeline/run.ts`

**Files:**
- Create: `src/cli/commands/pipeline/run.ts`
- Modify: `src/cli/commands/pipeline.ts`

- [x] **Step 1: Inventory imports**

Open `src/cli/commands/pipeline.ts:1-50` and identify every import the run command uses. Expect:
- `validateOrRaise` from `../../attractor/core/graph-validator.js`
- `findVarReferences` from `../../attractor/core/graph.js` (or wherever it lives — `grep -rn "export function findVarReferences" src/`)
- `scanUndeclaredCallerVars` from `../../attractor/core/preflight.js` (verify)
- `variableExpansionTransform` from `../../attractor/transforms/variable-expansion.js` (verify)
- `runPipeline` from `../../attractor/core/engine.js` (verify)
- `renderPipelineApp` from `../tui/pipeline-app.js` (verify)
- `parseStreamJsonEvents`, `JsonlPipelineTracer`, formatters, `randomUUID`, `output`, signal handlers
- `gcOldRuns`, `resolveResumeLogsRoot` from `./runs-gc.js`

Confirm each path with `grep -n "export" <file>`.

- [x] **Step 2: Create `pipeline/run.ts`**

Copy `PipelineRunOptions` interface and `pipelineRunCommand` (`pipeline.ts:204-544`) verbatim into `src/cli/commands/pipeline/run.ts`. Then replace the leading block (`:206-218` approximately — the resolvePipelineArg / readFileSync / parseDot section) with:

```ts
import {
  loadPipeline,
  PipelineLoadError,
  type LoadedPipeline,
} from "../pipeline-invocation.js";
import { gcOldRuns, resolveResumeLogsRoot } from "./runs-gc.js";

// inside pipelineRunCommand:
let loaded: LoadedPipeline;
try {
  loaded = await loadPipeline(dotFile, { project: opts.project });
} catch (err) {
  if (err instanceof PipelineLoadError) {
    await output.error(err.message);
    process.exit(1);
  }
  throw err;
}
let graph = loaded.graph;
const dotDir = dirname(loaded.absPath);
const project = loaded.projectRoot;

try {
  validateOrRaise(graph);
} catch (err) {
  await output.error((err as Error).message);
  process.exit(1);
}

// $project preflight — preserved from pipeline.ts:225-235 verbatim
if (!opts.project) {
  const refs = findVarReferences(graph, "project");
  if (refs.length > 0) {
    process.stderr.write(/* same message as before */);
    process.exit(1);
  }
}

// scanUndeclaredCallerVars preflight — preserved from pipeline.ts:237-261 verbatim
const preflight = scanUndeclaredCallerVars(graph, opts.variables ?? {});
// …existing three branches (formatMissingInputsError / formatLegacyMissingWarning /
//   formatUndeclaredWarning) — UNCHANGED…

graph = variableExpansionTransform(graph, {
  project: opts.project,
  context: opts.variables,
});

// …rest of pipelineRunCommand from the original :268 onward — runId derivation,
//   gcOldRuns call, runsRoot/logsRoot setup, JsonlPipelineTracer, renderPipelineApp,
//   SIGINT/SIGTERM handler, runPipeline invocation, finally block — UNCHANGED.
```

**CRITICAL:** Walk every line from old `:218` to old `:544` and confirm it appears (renamed local var if needed) in the new file. Do not paraphrase. Do not delete the `$project`-preflight stderr message text — copy the exact bytes.

- [x] **Step 3: Replace in `pipeline.ts` with re-export**

```ts
export { pipelineRunCommand } from "./pipeline/run.js";
export type { PipelineRunOptions } from "./pipeline/run.js";
```

- [x] **Step 4: Validate (this is the big one)**

```bash
npx tsc --noEmit
npx vitest run src/cli/tests/pipeline.test.ts \
                src/cli/tests/pipeline-headless.test.ts \
                src/cli/tests/pipeline-run-preflight.test.ts \
                src/cli/tests/pipeline-failure-reason.test.ts \
                src/cli/tests/pipeline-preflight.test.ts \
                src/cli/tests/pipeline-app-integration.test.tsx \
                src/cli/tests/implement.test.ts \
                src/cli/tests/meditate.test.ts
```
Expected: all pass. If `implement.test.ts`'s `vi.mock("../commands/pipeline.js", …)` interception breaks, do not change the test — re-examine the barrel re-export. The mock targets the module specifier the consumer (`implement.ts`) imports; that consumer still imports from `../commands/pipeline.js` so the mock must continue to bind.

- [x] **Step 5: Run a smoke pipeline end-to-end**

Pick the cheapest smoke test:
```bash
npx vitest run src/cli/tests/pipeline-smoke-static-multi-node-folder.test.ts
```
Expected: pass.

- [x] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline/run.ts src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): extract pipelineRunCommand through loadPipeline() seam"
```

## Verification targets

- Smokes: `src/cli/tests/smoke/static-multi-node/pipeline.dot` (via `pipeline-smoke-static-multi-node-folder.test.ts`); spot-check one more (`pipeline-smoke-tool-folder.test.ts`).
- Manual exercises: `apparat pipeline run <smoke.dot> --project <tmp>` shows identical Ink TUI; `apparat implement <project>` runs end-to-end (uses `pipelineRunCommand` via the barrel from `implement.ts`); SIGINT during a run still cleans up.
- Lint: `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-headless.test.ts src/cli/tests/pipeline-run-preflight.test.ts src/cli/tests/implement.test.ts src/cli/tests/meditate.test.ts`, `npx tsc --noEmit`
- Surfaces touched: CLI command files, CLI registration consumers (`implement.ts`, `meditate.ts` via the barrel)

---

## Chunk 7: Switch `program.ts` to direct per-subcommand imports

### Task 7.1: Update CLI registration

**Files:**
- Modify: `src/cli/program.ts:6-12`

- [x] **Step 1: Confirm current imports**

```bash
grep -n "from \"./commands/pipeline\"" src/cli/program.ts
```
Expected: 5 imports from `./commands/pipeline.js` (run, validate, list, trace, show).

- [x] **Step 2: Rewrite imports**

Replace the block `src/cli/program.ts:6-12` with:

```ts
import { pipelineRunCommand } from "./commands/pipeline/run.js";
import { pipelineValidateCommand } from "./commands/pipeline/validate.js";
import { pipelineListCommand } from "./commands/pipeline/list.js";
import { pipelineTraceCommand } from "./commands/pipeline/trace.js";
import { pipelineShowCommand } from "./commands/pipeline/show.js";
```

- [x] **Step 3: Validate**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: full suite passes.

- [x] **Step 4: Smoke run from the built CLI**

```bash
npm run build
node dist/cli/index.js pipeline list --help
node dist/cli/index.js pipeline validate --help
node dist/cli/index.js pipeline run --help
node dist/cli/index.js pipeline show --help
node dist/cli/index.js pipeline trace --help
```
Expected: each prints the same help text as before the refactor.

- [x] **Step 5: Commit**

```bash
git add src/cli/program.ts
git commit -m "refactor(pipeline): import sub-commands directly in program.ts"
```

## Verification targets

- Smokes: full smoke set as the final regression — `npx vitest run src/cli/tests/pipeline-smoke-*-folder.test.ts`
- Manual exercises: `apparat pipeline {run,validate,show,list,trace} --help` text byte-identical to pre-split baseline.
- Lint: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
- Surfaces touched: CLI registration

---

## Chunk 8: Tighten the barrel and update doc/comment line-number references

### Task 8.1: Final barrel cleanup

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [x] **Step 1: Confirm barrel content**

After Chunks 2–6 the file should already be a sequence of re-exports plus possibly stale imports. Open it and rewrite to exactly:

```ts
// src/cli/commands/pipeline.ts
//
// Barrel re-export. Implementation lives under ./pipeline/ and in
// ./pipeline-invocation.ts. This file exists to preserve import paths
// for the existing test files and the sibling commands that import
// from it (implement.ts, meditate.ts).

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

- [x] **Step 2: Confirm no test imports a removed internal symbol**

```bash
grep -rn "from \"../commands/pipeline\"\|from \"../commands/pipeline.js\"" src/cli/tests/
```
For each line, confirm the imported names appear in the barrel above. If a test imports something not re-exported, add the export to the barrel (preferred) — do **not** edit the test.

- [x] **Step 3: Validate constraints**

```bash
wc -l src/cli/commands/pipeline.ts
npx tsc --noEmit
npx vitest run
```
Expected: line count < 50; tsc clean; full suite pass.

- [x] **Step 4: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "refactor(pipeline): collapse pipeline.ts to barrel re-export"
```

### Task 8.2: Update doc and comment line-number references

**Files:**
- Modify: `IMPLEMENTATION_PLAN.md` (lines 32, 302, 374, 518, 776 per design §6)
- Modify: `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md:108`
- Modify: `src/attractor/core/engine.ts:25` (comment reference)

- [x] **Step 1: Find current state of references**

```bash
grep -n "src/cli/commands/pipeline.ts" IMPLEMENTATION_PLAN.md docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md src/attractor/core/engine.ts
```
For each hit:
- If the prose names a function/symbol that now lives in `pipeline/run.ts`, update the path.
- If the line number is now stale because lines moved into `pipeline/run.ts`, recompute and update.
- If the reference is to the barrel itself (`pipeline.ts` as the import target), keep as-is.

- [x] **Step 2: Edit each file**

Use Edit tool to replace each old reference with its post-split path. Preserve surrounding prose verbatim.

- [x] **Step 3: Validate**

```bash
grep -rn "src/cli/commands/pipeline.ts:[0-9]" IMPLEMENTATION_PLAN.md docs/ src/
```
Expected: any remaining hits are correct (i.e. point at the barrel itself), or there are zero hits.

- [x] **Step 4: Commit**

```bash
git add IMPLEMENTATION_PLAN.md docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md src/attractor/core/engine.ts
git commit -m "docs: update pipeline.ts line-number refs after sub-command split"
```

## Verification targets

- Smokes: full smoke set as final regression — `npx vitest run`.
- Manual exercises: `wc -l src/cli/commands/pipeline.ts` < 50; `ls src/cli/commands/pipeline/` shows `run.ts validate.ts show.ts list.ts trace.ts runs-gc.ts`; `ls src/cli/commands/pipeline-invocation.ts` exists.
- Lint: `npx tsc --noEmit`, `npx vitest run`
- Surfaces touched: CLI command files, docs

---

## Final invariant checklist

Run these as the last step before declaring done:

```bash
# Barrel is a thin shim
test "$(wc -l < src/cli/commands/pipeline.ts)" -lt 50 && echo OK || echo FAIL

# All per-subcommand files exist
ls src/cli/commands/pipeline/{run,validate,show,list,trace,runs-gc}.ts
ls src/cli/commands/pipeline-invocation.ts

# program.ts imports from the per-subcommand modules, not the barrel
grep -c 'from "./commands/pipeline/' src/cli/program.ts   # expect 5
grep -c 'from "./commands/pipeline"' src/cli/program.ts   # expect 0

# Test files still import via the barrel
grep -lrn 'from "../commands/pipeline\.js"' src/cli/tests/ | wc -l   # expect ≥ 11

# Static checks
npx tsc --noEmit
npx vitest run
```

All commands above should succeed. Any FAIL means do not declare the chunk shipped.

---

## Open questions surfaced from design §9

- `runs-gc.ts` placement: kept under `src/cli/commands/pipeline/` per design default. Revisit if a non-pipeline consumer appears.
- `pipeline-invocation.ts` placement under `commands/`: kept per design default. Revisit if daemon/MCP needs the seam.
- Further split of `run.ts` (extract SIGINT/Ink closure into `run-interactive.ts`): explicitly out of scope; flag as a follow-up illumination if `run.ts` exceeds ~400 LOC after this split.
