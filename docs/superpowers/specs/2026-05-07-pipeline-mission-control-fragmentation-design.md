# Design: Deepen `pipeline list` into a mission-control view + auto-render SVG on `pipeline validate` success

**Date:** 2026-05-07
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T1907-pipeline-mission-control-fragmentation.md`

## 1. Motivation

`apparat pipeline list` is the operator's first encounter with the pipeline surface, and it is doubly broken:

1. **It lies.** When the pipelines folder is missing or empty, both branches print `Create one with: apparat pipeline create <name> --project ${project}` (`src/cli/commands/pipeline/list.ts:16` and `:23`). But `src/cli/program.ts:107-203` registers only five sub-commands — `run` (`:110`), `validate` (`:143`), `list` (`:162`), `trace` (`:177`), `show` (`:187`) — and the chain closes at `:203` before `registerHeartbeatCommand` at `:205`. There is no `apparat pipeline create` command. The hint is a broken promise the user hits the very first time they want to start a new pipeline.
2. **It under-delivers.** The render loop at `list.ts:28-42` prints only the padded name, the `goal` attribute, and (when present) the `inputs=` requires line. To answer "is this pipeline valid right now? when did it last run? did that run succeed? is it on a schedule? is the SVG diagram fresh?" the operator must run four other commands and stitch the answers together by hand — `pipeline validate <name>`, `heartbeat list`, `pipeline trace <runId>` (assuming they remember the runId), and a manual `ls`+mtime check on the colocated `.svg`.

A second drift compounds the management gap: `pipeline validate` (`src/cli/commands/pipeline/validate.ts:51-96`) succeeds with `await output.success(\`Pipeline valid …\`)` at `:91-93` and writes nothing. The colocated SVG produced by `pipeline show` (`src/cli/commands/pipeline/show.ts:54-65` via `renderDotToSvg` at `:18-22`) is therefore always at risk of being stale relative to `pipeline.dot`, a drift acknowledged in the 2026-04-27 graph-preview session-closure file. The only existing remedy is "remember to run `pipeline show` after every edit," which is precisely the kind of manual discipline the project's deep-module ethos (ADR-0001) tries to remove.

Strategic compass: `docs/VISION.md:6-8` frames apparat as "solo-developer tooling to orchestrate agents into graphs" — a working pipeline should "feel like delegating to someone who already understands the shape of the problem." The current management surface inverts that promise: the human, not the harness, holds cross-command state. The graph itself is a deep module (one folder, one `pipeline.dot`, sibling agents per ADR-0001); everything *around* the graph is shallow, with information already available somewhere in the system but never collected in one view.

The illumination called for seven items spanning new commands (`pipeline runs`, `pipeline replay <runId>`), Ink-renderer reuse for replay, and trace churn (`--node-receive` demotion, `--text` rename). The chat refinement collapsed that to four modifications to *existing* surface only — no new commands, no `trace` churn, no Ink replay. This design implements only those four.

## 2. Decision Summary

1. **Fix the lying create-hint** at `src/cli/commands/pipeline/list.ts:16` and `:23`. Replace both occurrences with the real authoring path: `apparat init`, then add `.apparat/pipelines/<name>/pipeline.dot`. Do not register a new `pipeline create` command — the chat refinement explicitly drops creation as out-of-scope.

2. **Deepen `pipeline list` into a per-pipeline status card.** For each `.dot` file under `<project>/.apparat/pipelines/`, the new render emits, in addition to today's name + goal:
   - **Validity:** `✓` (no error-severity diagnostics) or `✗` (one or more), sourced from `validateGraph()` via `loadPipeline()` (the seam at `src/cli/commands/pipeline-invocation.ts:33-88`).
   - **Schedule:** the daemon-task interval if a heartbeat exists for this pipeline, sourced from `request("list_tasks")` via `src/lib/daemon-client.ts:60` — the same call `heartbeat list` already uses at `src/cli/commands/heartbeat.ts:204`.
   - **Last-run outcome + runId:** parsed from the most-recent `pipeline-end` event in `<project>/.apparat/runs/<runId>/pipeline.jsonl`, using the persisted shape `{kind: "pipeline-end", runId, outcome: "success"|"failure", timestamp}` at `src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`.
   - **SVG freshness:** `fresh` (colocated `.svg` exists and `mtime >= pipeline.dot mtime`), `stale` (colocated `.svg` exists but is older), or `none` (no colocated `.svg`).

3. **Preserve today's line shape behind `--brief`.** Scripts that grep `pipeline list` output stay green by passing `--brief`; the deepened render is the new default. The flag and its semantics are part of the contract.

4. **Auto-render SVG on `pipeline validate` success when `pipeline.dot` is newer than the colocated `.svg`.** Reuse `renderDotToSvg` and the SVG-write code path from `show.ts:18-22,54-65` — no duplicate renderer, no new dependency. The render fires on the success branch of `validate.ts:91-93` only; failure branches still write nothing. This is the design's only behavioural change to `validate`.

5. **Surface heartbeat schedule inside the deepened `pipeline list`** by reading daemon state read-only via the same `request("list_tasks")` call. No write IPC, no new daemon endpoint.

6. **Add one helper module** under `src/cli/lib/pipeline-status.ts` that exposes:
   - `readLastRunOutcome(runsRoot: string): { runId, outcome, timestamp } | null`
   - `getSvgFreshness(absDotPath: string): "fresh" | "stale" | "none"`
   - `findHeartbeatForPipeline(tasks: Task[], pipelineName: string, projectRoot: string): Task | undefined`

   Each helper is a pure read; tested in isolation. `pipeline list` composes them.

7. **Atomic landing.** One commit (or one PR) lands all four items. Staging would create an interim state where the lying hint is fixed but the deepened view is still phoneable, or where `validate` writes SVG but `list` still says nothing about freshness — exactly the fragmentation this design is meant to remove.

## 3. Architecture

### 3.1 Before / after diagram

```
Before                                         After
──────                                         ─────
pipeline list --project x                      pipeline list --project x
  list.ts:16  print broken create-hint           list.ts (rewritten)
  list.ts:23  print broken create-hint             1. read .dot files
  list.ts:28  for each .dot:                       2. for each: loadPipeline → diagnostics
                  parseDot                                    + readLastRunOutcome
                  print "name + goal + reqs"                  + getSvgFreshness
                                                              + findHeartbeatForPipeline
                                                  3. render status card (default)
                                                     OR today's line shape (--brief)

pipeline validate good.dot                     pipeline validate good.dot
  validate.ts:91 success → no IO                 validate.ts (success branch only)
                                                   if (svg-stale-or-missing) renderDotToSvg →
                                                                              writeFileSync
                                                   then output.success as before

(SVG drifts silently after every edit)         (SVG regenerates on every successful validate;
                                                colocated diagram tracks the source)
```

### 3.2 New helper module: `src/cli/lib/pipeline-status.ts`

```ts
import { existsSync, statSync, readFileSync, readdirSync, lstatSync } from "fs";
import { join, basename } from "path";
import type { Task } from "../../daemon/state.js";

export interface LastRunOutcome {
  runId: string;
  outcome: "success" | "failure";
  timestamp: string;
}

/**
 * Read the most-recent pipeline-end event from <runsRoot>/<runId>/pipeline.jsonl.
 * Returns null when runsRoot is missing, contains no run dirs, or contains no
 * pipeline-end events. Pure I/O — never throws on missing/malformed files.
 */
export function readLastRunOutcome(runsRoot: string): LastRunOutcome | null;

/**
 * Compare mtimes of a .dot file and its colocated .svg sibling.
 *  - "fresh": .svg exists and svg.mtime >= dot.mtime
 *  - "stale": .svg exists and svg.mtime  < dot.mtime
 *  - "none":  no colocated .svg
 */
export function getSvgFreshness(absDotPath: string): "fresh" | "stale" | "none";

/**
 * Find the daemon task whose command/args target the given pipeline. Matches
 * the same shape registered by `apparat heartbeat pipeline …` at
 * src/cli/commands/heartbeat.ts:186-191 (command="pipeline", args includes
 * the pipeline name or absolute .dot path).
 */
export function findHeartbeatForPipeline(
  tasks: Task[],
  pipelineName: string,
  projectRoot: string,
): Task | undefined;
```

Three helpers, one file, one focused test (`src/cli/tests/pipeline-status.test.ts`). The status card is then a 20-line composition in `list.ts`.

### 3.3 Deepened `list.ts` shape (default render)

```text
Pipelines in /Users/josu/proj/.apparat/pipelines/

  illumination-to-implementation  ✓  "Triage an illumination …"
                                  schedule: every 60 min
                                  last run: success  d9859ff1  2026-05-07 19:08
                                  svg: fresh

  janitor                         ✗  "Sweep the runs/ folder"
                                  schedule: (none)
                                  last run: (no runs yet)
                                  svg: stale

  meditate                        ✓  "One-shot meditation"
                                  schedule: every 30 min
                                  last run: failure  1a2b3c4d  2026-05-07 18:33
                                  svg: none
```

Indent + 2-space gutter chosen to match today's `name.padEnd(20)` rhythm at `list.ts:41`. `--brief` keeps the existing single-line shape verbatim:

```text
Pipelines in /Users/josu/proj/.apparat/pipelines/
  illumination-to-implementation "Triage an illumination …"
                                 requires: …
  janitor                        "Sweep the runs/ folder"
  meditate                       "One-shot meditation"
```

### 3.4 Deepened `list.ts` data flow

```
pipeline list --project x  (default)
  → read pipelines dir
  → request("list_tasks")             ── ONE daemon RPC for the whole listing,
  → for each .dot:                       results filtered per-pipeline locally
      loadPipeline(absPath, {project})   ── existing seam, returns diagnostics
      readLastRunOutcome(runsDir(...))   ── new helper, parses pipeline.jsonl
      getSvgFreshness(absPath)           ── new helper, mtime compare
      findHeartbeatForPipeline(tasks, name, project) ── new helper
  → render card per pipeline

pipeline list --project x --brief
  → existing path, unchanged             ── one parseDot per .dot, no daemon, no validation
```

The default path issues *one* daemon RPC and *N* file reads (where N = number of pipelines). Per-pipeline IPC was rejected — for any project with >1 pipeline it would amplify socket roundtrips for no benefit. `--brief` skips the daemon RPC entirely so script consumers never wake the daemon by reading the listing.

### 3.5 Daemon-unavailable degradation

`request("list_tasks")` calls `ensureDaemon()` at `src/lib/daemon-client.ts:43-50`, which transparently spawns the daemon if the socket is missing. For `pipeline list`, this is the wrong default — listing pipelines should not silently start a long-running background process. Mitigation:

- `list.ts` wraps the `request("list_tasks")` call in a try/catch with a 1500 ms timeout. On any failure (timeout, ENOENT on the socket, daemon spawn refusal), the schedule line renders `(daemon offline)` and listing continues.
- `--brief` does not call the daemon at all.
- This is consistent with the read-only contract: deepening `list` must never side-effect the daemon's lifecycle. A follow-up could add a `read-only` flavor of `request()` that skips `ensureDaemon`; this design uses the timeout-and-degrade path because it is local to `list.ts` and needs no IPC change.

### 3.6 Auto-render-SVG-on-validate-success

```ts
// src/cli/commands/pipeline/validate.ts (success branch only, near :91-93)

if (errors.length === 0 && !diffHasError) {
  const svgPath = absPath.replace(/\.dot$/, ".svg");
  if (shouldRenderSvg(absPath, svgPath)) {
    const annotated = annotateDotForShow(src, dirname(absPath));
    try {
      const svg = await renderDotToSvg(annotated);
      writeFileSync(svgPath, svg);
    } catch (err) {
      // Render failure does NOT fail validate — surface as warning.
      await output.warn(`SVG auto-render failed: ${(err as Error).message}`);
    }
  }
  await output.success(
    `Pipeline valid (${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
  );
  return 0;
}

function shouldRenderSvg(absDotPath: string, svgPath: string): boolean {
  if (!existsSync(svgPath)) return true;
  return statSync(absDotPath).mtimeMs > statSync(svgPath).mtimeMs;
}
```

`renderDotToSvg` is imported from `./show.js` (re-exported alongside `pipelineShowCommand`); `annotateDotForShow` is already imported by `show.ts:9`. No new dependency. The render is best-effort: a graphviz failure logs a warning and `validate` still returns 0, because validity is the contract — SVG is a side-effect of success, not the success criterion.

### 3.7 Surfaces unchanged

- The `Graph` type, `parseDot`, `validateGraph`, `loadPipeline` signatures. Unchanged.
- `pipeline.jsonl` per-node trace shape and the `pipeline-end` event shape (`src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`). Unchanged.
- Daemon `Task` shape (`src/daemon/state.ts:5-14`) and the `list_tasks` action. Unchanged — `list.ts` is a new caller of an existing read.
- `apparat pipeline {run,trace,show}`, `heartbeat *`, `meditate`, `implement`, `init`. Unchanged.
- Pipeline `.dot` syntax and agent rubric. Unchanged.
- `pipeline list --brief` is byte-identical to today's `pipeline list` (modulo the new flag itself).
- Existing exit codes: `validate` still exits 0 on success and 1 on validation error; the SVG render never raises the exit code.

### 3.8 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Status helpers | `src/cli/lib/pipeline-status.ts` | **New** — `readLastRunOutcome`, `getSvgFreshness`, `findHeartbeatForPipeline` |
| List command | `src/cli/commands/pipeline/list.ts` | **Rewritten** — fix hint, deepen render, add `--brief` branch, compose helpers |
| Validate command | `src/cli/commands/pipeline/validate.ts` | Inline edit — success branch renders SVG when stale/missing |
| Show command | `src/cli/commands/pipeline/show.ts` | Inline edit — re-export `renderDotToSvg` so `validate.ts` can import it without duplication |
| CLI registration | `src/cli/program.ts:161-174` | Inline edit — add `--brief` option to `pipeline list`; help text mentions the new fields |
| Tests — new | `src/cli/tests/pipeline-status.test.ts` | **New** — covers the three helpers in isolation |
| Tests — edited | `src/cli/tests/pipeline.test.ts:328-358`, `src/cli/tests/pipeline-preflight.test.ts:77-99` | Migrate the existing `pipelineListCommand` assertions onto `--brief` (since the default render shape changes); add new assertions for the deepened render |
| Tests — invocation | `src/cli/tests/pipeline-invocation.test.ts:33-80` | No edit — `loadPipeline` contract unchanged |
| Spec ripple | `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` | Inline edit — `validate.ts` is no longer side-effect-free; add a paragraph documenting the SVG-on-success branch and updating §3.7 / §6 ("CLI flags … help text … exit codes" still byte-identical, but `validate` now writes one file on success) |

### 3.9 LOC sanity check

| File | Approx LOC after change |
|---|---|
| `src/cli/lib/pipeline-status.ts` (new) | ~80 (three helpers + types) |
| `src/cli/commands/pipeline/list.ts` (rewritten) | ~110 (was ~45) |
| `src/cli/commands/pipeline/validate.ts` (edited) | ~115 (was ~96, +SVG branch + helper) |
| `src/cli/commands/pipeline/show.ts` (edited) | ~80 (was ~77, +1 export line) |
| `src/cli/program.ts` (edited) | +5 LOC for `--brief` option |
| `src/cli/tests/pipeline-status.test.ts` (new) | ~150 |
| **Net new code** | ~+330 LOC, all behind narrow surfaces |

## 4. Components & file edits

### 4.1 `src/cli/lib/pipeline-status.ts` (new)

```ts
import { existsSync, readFileSync, readdirSync, lstatSync, statSync } from "fs";
import { join, basename } from "path";
import type { Task } from "../../daemon/state.js";

export interface LastRunOutcome {
  runId: string;
  outcome: "success" | "failure";
  timestamp: string;
}

export function readLastRunOutcome(runsRoot: string): LastRunOutcome | null {
  if (!existsSync(runsRoot)) return null;
  const runs: { name: string; path: string; mtime: number }[] = [];
  for (const name of readdirSync(runsRoot)) {
    const path = join(runsRoot, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory()) continue;
      runs.push({ name, path, mtime: st.mtimeMs });
    } catch { continue; }
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => b.mtime - a.mtime);
  for (const run of runs) {
    const tracePath = join(run.path, "pipeline.jsonl");
    if (!existsSync(tracePath)) continue;
    let content: string;
    try { content = readFileSync(tracePath, "utf8"); } catch { continue; }
    // Walk lines bottom-up; the pipeline-end event is last when present.
    const lines = content.split("\n").filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]);
        if (ev.kind === "pipeline-end" && typeof ev.runId === "string"
            && (ev.outcome === "success" || ev.outcome === "failure")) {
          return { runId: ev.runId, outcome: ev.outcome, timestamp: ev.timestamp ?? "" };
        }
      } catch { continue; }
    }
  }
  return null;
}

export function getSvgFreshness(absDotPath: string): "fresh" | "stale" | "none" {
  const svgPath = absDotPath.replace(/\.dot$/, ".svg");
  if (!existsSync(svgPath)) return "none";
  try {
    const dotMtime = statSync(absDotPath).mtimeMs;
    const svgMtime = statSync(svgPath).mtimeMs;
    return svgMtime >= dotMtime ? "fresh" : "stale";
  } catch { return "none"; }
}

export function findHeartbeatForPipeline(
  tasks: Task[],
  pipelineName: string,
  projectRoot: string,
): Task | undefined {
  return tasks.find(t => {
    if (t.command !== "pipeline") return false;
    return t.args.includes(pipelineName)
        || t.args.some(a => a.endsWith(`/${pipelineName}.dot`)
                         || a.endsWith(`/${pipelineName}/pipeline.dot`));
  });
}
```

The matcher inspects both name shorthand (e.g. `apparat heartbeat pipeline meditate --project my-app` → `args = ["meditate", "--project", "..."]`) and absolute-path forms (e.g. `args = [".../my-app/.apparat/pipelines/meditate/pipeline.dot", "--project", "..."]`). Both are produced today by the heartbeat registration path at `src/cli/commands/heartbeat.ts:170-196`. `projectRoot` is reserved as a parameter for the path-form match — kept in the signature so a stricter "match only this project's tasks" filter can be added without a breaking change.

### 4.2 `src/cli/commands/pipeline/list.ts` (rewritten)

```ts
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join, basename, relative } from "path";
import { parseDot } from "../../../attractor/core/graph.js";
import { loadPipeline, PipelineLoadError } from "../pipeline-invocation.js";
import { getPipelinesDir } from "../../lib/pipeline-resolver.js";
import { runsDir } from "../../lib/apparat-paths.js";
import {
  readLastRunOutcome,
  getSvgFreshness,
  findHeartbeatForPipeline,
} from "../../lib/pipeline-status.js";
import { request } from "../../../lib/daemon-client.js";
import type { Task } from "../../../daemon/state.js";
import * as output from "../../lib/output.js";

const REAL_HINT =
  "Run `apparat init`, then add `.apparat/pipelines/<name>/pipeline.dot`.";

export interface PipelineListOptions {
  project?: string;
  brief?: boolean;
}

export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const pipelinesDir = getPipelinesDir(project);

  if (!existsSync(pipelinesDir)) {
    await output.info(`No pipelines folder found in ${project}.\n${REAL_HINT}`);
    return;
  }
  const dotFiles = readdirSync(pipelinesDir).filter(f => f.endsWith(".dot"));
  if (dotFiles.length === 0) {
    await output.info(`No workflows found in ${pipelinesDir}.\n${REAL_HINT}`);
    return;
  }

  if (opts.brief) {
    await renderBrief(project, pipelinesDir, dotFiles);
    return;
  }
  await renderDeep(project, pipelinesDir, dotFiles);
}
```

`renderBrief` is the existing loop at today's `list.ts:27-43` lifted verbatim. `renderDeep` adds the four status fields:

```ts
async function renderDeep(project: string, pipelinesDir: string, files: string[]): Promise<void> {
  const tasks = await listTasksWithTimeout();
  await output.info(`Pipelines in ${pipelinesDir}/\n`);
  for (const file of files.sort()) {
    const absPath = join(pipelinesDir, file);
    const name = basename(file, ".dot");
    let validity: "✓" | "✗" = "✓";
    let goal = "(no goal defined)";
    try {
      const loaded = await loadPipeline(absPath, { project });
      if (loaded.diagnostics.some(d => d.severity === "error")) validity = "✗";
      if (loaded.graph.goal) goal = `"${loaded.graph.goal}"`;
    } catch (err) {
      if (err instanceof PipelineLoadError) validity = "✗";
      else throw err;
    }
    const sched = tasks ? findHeartbeatForPipeline(tasks, name, project) : undefined;
    const last = readLastRunOutcome(runsDir(project));
    const svg = getSvgFreshness(absPath);

    await output.info(`  ${name.padEnd(30)} ${validity}  ${goal}`);
    await output.info(`  ${"".padEnd(30)} schedule: ${sched ? `every ${sched.interval} min` : "(none)"}`);
    await output.info(`  ${"".padEnd(30)} last run: ${formatLastRun(last)}`);
    await output.info(`  ${"".padEnd(30)} svg: ${svg}`);
    await output.info("");
  }
}

async function listTasksWithTimeout(): Promise<Task[] | null> {
  try {
    const res = await Promise.race([
      request("list_tasks"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500)),
    ]);
    return (res as { data: Task[] }).data;
  } catch { return null; }
}
```

(`formatLastRun` renders `"success  <runId>  <timestamp>"` / `"failure  <runId>  <timestamp>"` / `"(no runs yet)"`.)

### 4.3 `src/cli/commands/pipeline/validate.ts` (edited)

The success branch at `validate.ts:91-93` becomes:

```ts
if (errors.length === 0 && !diffHasError) {
  const svgPath = absPath.replace(/\.dot$/, ".svg");
  const renderNeeded = !existsSync(svgPath)
    || statSync(absPath).mtimeMs > statSync(svgPath).mtimeMs;
  if (renderNeeded) {
    try {
      const annotated = annotateDotForShow(src, dirname(absPath));
      const svg = await renderDotToSvg(annotated);
      writeFileSync(svgPath, svg);
    } catch (err) {
      await output.warn(`SVG auto-render failed: ${(err as Error).message}`);
    }
  }
  await output.success(`Pipeline valid (${graph.nodes.size} nodes, ${graph.edges.length} edges)`);
  return 0;
}
```

`renderDotToSvg` is imported from `./show.js`; `annotateDotForShow` from `../../lib/annotate-show.js` (already used by `show.ts:9`). Failure modes:

- Graphviz crash: caught, surfaced as `output.warn`, exit code stays 0 (validity is the contract).
- File write failure (permissions, ENOSPC): same — warning, no exit-code change.
- Source mtime equal to or older than SVG mtime: skip render, no I/O.

### 4.4 `src/cli/commands/pipeline/show.ts` (edited)

Add one re-export so `validate.ts` and any future consumer share the same renderer without lifting it to a third file:

```ts
// at the bottom of show.ts
export { renderDotToSvg };
```

`renderDotToSvg` is currently a non-exported function at `show.ts:18-22`. The export is the smallest possible move that avoids duplicating the wasm-graphviz bootstrap.

### 4.5 `src/cli/program.ts` (edited)

```ts
pipeline
  .command("list")
  .description("List pipeline workflows in a project (deep view: validity, schedule, last run, SVG freshness)")
  .addHelpText("after", `
Examples:
  apparat pipeline list --project my-app
  apparat pipeline list --brief    # script-friendly: name + goal only
`)
  .option("--project <folder>", "Project folder (defaults to cwd)")
  .option("--brief", "Print only name + goal + requires (legacy line shape)")
  .action(async (opts: { project?: string; brief?: boolean }) => {
    await pipelineListCommand(opts);
  });
```

## 5. Data flow

### 5.1 `pipeline list --project x` (deep, default)

```
apparat pipeline list --project x
  → src/cli/commands/pipeline/list.ts pipelineListCommand
    → readdirSync(pipelinesDir)
    → request("list_tasks")           ── single RPC, 1500ms timeout, degrades on failure
    → for each .dot:
        loadPipeline(absPath, {project})
          (src/cli/commands/pipeline-invocation.ts:33-88
            → resolvePipelineArg → readFileSync → parseDot → validateGraph)
        readLastRunOutcome(runsDir(project))
          (src/cli/lib/pipeline-status.ts → mtime-sort run dirs → tail-walk pipeline.jsonl)
        getSvgFreshness(absPath)
          (mtime compare)
        findHeartbeatForPipeline(tasks, name, project)
          (in-memory filter on the already-fetched tasks list)
        render status card via output.info
```

### 5.2 `pipeline list --project x --brief`

```
apparat pipeline list --project x --brief
  → list.ts renderBrief (legacy path)
    → for each .dot: parseDot → output.info("name  goal") → output.info("requires: …") if any
  (no daemon RPC, no loadPipeline, no SVG check)
```

### 5.3 `pipeline validate good.dot --project x`

```
apparat pipeline validate good.dot --project x
  → src/cli/commands/pipeline/validate.ts pipelineValidateCommand
    → loadPipeline(dotFile, {project})
    → walk diagnostics → output.info/warn/error per severity
    → diffEdgeLabels (if previousGraph supplied)
    → if (errors.length === 0 && !diffHasError):
         if (svg-stale-or-missing):
           annotateDotForShow → renderDotToSvg → writeFileSync(svgPath)
         output.success(...) → return 0
       else:
         return 1
```

The render fires only on the success branch, only when the source is newer than the colocated SVG. Validation failure paths still write nothing.

## 6. Blast radius / impact surface

- **Size:** **S** by file count, **M** by surface count.
  - File count: 1 new helper + 1 new test + 3 inline edits + 2 test edits + 1 spec edit ≈ 8 files.
  - Surface count: CLI (`pipeline list`, `pipeline validate`), daemon IPC (read-only), runs JSONL reader (new consumer), spec.
- **Files touched:**
  - **New:** `src/cli/lib/pipeline-status.ts`, `src/cli/tests/pipeline-status.test.ts`.
  - **Rewritten:** `src/cli/commands/pipeline/list.ts`.
  - **Inline edits:** `src/cli/commands/pipeline/validate.ts` (success branch), `src/cli/commands/pipeline/show.ts` (one re-export), `src/cli/program.ts` (`--brief` option + help text).
  - **Test edits:** `src/cli/tests/pipeline.test.ts:328-358` (migrate existing assertions onto `--brief`; add deep-render assertions), `src/cli/tests/pipeline-preflight.test.ts:77-99` (port the `requires:` test to `--brief`).
  - **Spec edit:** `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` — add a paragraph noting `validate` now writes a colocated SVG on success when stale/missing.
- **Surfaces crossed:**
  - **CLI** — `pipeline list` default render shape changes; new `--brief` flag preserves the old shape.
  - **CLI** — `pipeline validate` gains a colocated-SVG write on success when source is newer than SVG.
  - **Daemon IPC** — new read-only consumer of `request("list_tasks")` from `list.ts`. No new daemon endpoint, no write IPC.
  - **Runs JSONL** — new read consumer of the `pipeline-end` event shape at `src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`. No write.
  - **Tests** — new file (`pipeline-status.test.ts`), shape migrations in two existing test files.
- **Breaking changes (narrowed):**
  - **`pipeline list` default output shape changes.** Mitigated by `--brief` preserving the legacy shape. Scripts that grep today's output must add `--brief`. No way to make this non-breaking without a behavior flag toggle, which the design rejects on YAGNI grounds.
  - **`pipeline validate` gains a write side-effect on success.** This contradicts the no-IO contract documented in `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` §3.7 ("CLI flags, command names, help text, exit codes, and stderr/stdout formatting are all byte-identical"). The 2026-05-06 spec must be updated to record the new contract: stdout/stderr are byte-identical on the success path; one new file write (the colocated SVG) is the deliberate side effect.
- **Spec / docs ripple:**
  - [ ] `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` — update §3.7 surfaces-unchanged paragraph and §6 breaking-changes paragraph to record the SVG-on-validate-success write.
  - [ ] `src/cli/program.ts` help text at `:43-51` mentions `pipeline show` but not the new SVG-on-validate behavior. Add one line under the `pipeline list` block explaining the deepened render and `--brief`.
  - [ ] No ADR required. ADR-0001 (single-tier collapse, agents next to pipeline.dot) and the cross-command-state ethos in `docs/VISION.md:6-8` already endorse "one command answers one question" — this design is an *application*, not a new principle. The 2026-04-27 graph-preview session-closure file's "stale SVG drift" note becomes resolved.
  - [ ] No README or CONTEXT.md change.
- **Test ripple:**
  - [ ] **New** `src/cli/tests/pipeline-status.test.ts` — covers `readLastRunOutcome` (no runs / one run / multiple runs / missing pipeline.jsonl / malformed line), `getSvgFreshness` (none / fresh / stale), `findHeartbeatForPipeline` (name match / path match / no match).
  - [ ] **Migrate** `src/cli/tests/pipeline.test.ts:328-358` — the three existing `pipelineListCommand` cases assert `expect.stringContaining("apparat pipeline create")` (which the new hint removes) and the legacy single-line shape. Migrate them to call `pipelineListCommand({ project: dir, brief: true })` for the legacy-shape assertions; add new assertions against the deep-render shape on the default branch (validity glyph, schedule line, last-run line, svg line). Update the broken-hint expectation to `expect.stringContaining("apparat init")` on both branches.
  - [ ] **Migrate** `src/cli/tests/pipeline-preflight.test.ts:77+` — the `requires:` test asserts the legacy line shape. Port to `--brief`.
  - [ ] No edits to `pipeline-invocation.test.ts` (`loadPipeline` contract unchanged), `pipeline-trace*.test.ts` (`trace` untouched per refinement), `pipeline-show*.test.ts` (`show` only gains an export), `pipeline-runs-gc.test.ts` (gc untouched).

## 7. Trade-offs

### 7.1 Deepen `list` vs. add `pipeline runs` / `pipeline replay`

The illumination's original 7-step plan included a new `pipeline runs` subcommand and a new `pipeline replay <runId>` reusing the live Ink `PipelineApp`. Chat refinement explicitly rejected both:

- "Feels like a bloat at this moment" → drop `pipeline runs`. The deepened `pipeline list` already surfaces the most recent run per pipeline, which covers the common post-mortem need.
- "Can we just skip these new commands? What's the point and use of folding those?" → drop `pipeline replay` entirely; do not relocate the behaviour into `trace`.
- "Bah sounds complicated leave pipeline trace out." → no `trace` churn at all (no Ink replay, no `--node-receive` demotion, no `--text` rename).

This design honors all three. The status card surfaces *enough* to answer "what's the state of this pipeline?" without adding CLI surface. If forensic depth is later needed, the existing `pipeline trace <runId>` is unchanged and now gets the runId from the listing.

### 7.2 One daemon RPC + degrade vs. per-pipeline RPCs

A per-pipeline `request("get_task", { id })` was rejected for two reasons:

- For any project with >1 pipeline, N socket roundtrips amplify latency and hurt the "list reads like a dashboard" feel.
- The daemon's `list_tasks` already does the work; we just filter the result locally. Adding a `get_task` action would require a daemon-side change, which the chat refinement disallows ("no new commands").

The downside — listing wakes the daemon if it's offline — is mitigated by the 1500 ms timeout and the `(daemon offline)` fallback. `--brief` skips the call entirely.

### 7.3 SVG-on-validate vs. pre-commit hook

A pre-commit hook would regenerate SVG outside the CLI. Reasons to reject:

- Pre-commit hooks are a per-machine choice; `validate` is a per-command choice. The harness should make the right thing happen by default, not depend on shell config.
- The 2026-04-27 graph-preview session-closure file flagged this same option and chose "tooling, not hooks" — auto-render on a successful validate matches that direction.
- The render is gated on `dot.mtime > svg.mtime`, so the cost is paid only when the source actually changed since the last render.

### 7.4 SVG render failure: warn vs. fail validate

Reasons to warn:

- `validate`'s contract is "is this `.dot` syntactically and semantically valid?" SVG generation depends on the bundled wasm-graphviz, which is technically a separate concern. A wasm load failure should not flip a green pipeline to red.
- The colocated SVG is a developer-experience nicety; the system runs without it.

Reasons to fail (rejected):

- Hides a real misconfiguration (broken graphviz wasm). Mitigated: the warning is loud, on stderr.

### 7.5 `--brief` keeps full legacy shape vs. new minimal shape

`--brief` preserves the *existing* `name + goal + requires` line layout byte-for-byte, not a new minimal shape. Reasons:

- It is the script-stability promise the chat refinement explicitly named ("`--brief` retained for scripts").
- Inventing a new minimal shape would split testing in three (default / brief / legacy) for no benefit; today's tests at `pipeline.test.ts:328-358` and `pipeline-preflight.test.ts:77+` migrate cleanly onto `--brief`.

### 7.6 Helper module placement: `src/cli/lib/` vs. `src/cli/commands/pipeline/`

`src/cli/lib/pipeline-status.ts` was chosen because:

- All three helpers are pure I/O readers with no command-shaped behaviour. They could plausibly be reused by a future `heartbeat watch` enhancement, by an MCP tool, or by the daemon itself.
- `src/cli/commands/pipeline/` is for sub-command implementations (per the 2026-05-06 split spec); putting library helpers there blurs that line.
- No co-location penalty: `list.ts` imports the helpers, just like it imports `pipeline-resolver` from `src/cli/lib/`.

### 7.7 Atomic vs. staged

Staging would split this into "fix hint" + "deepen list" + "auto-SVG" three-way. Reasons to ship together:

- Each item alone leaves the broken status surface partially fragmented. Staged review obscures the structural promise: deep view + fresh diagram on validation success = single-place mission control.
- Tests covering the new line shape and the new SVG behavior are correlated (both rely on `getSvgFreshness`); landing them together avoids interim test brittleness.
- One developer, one machine — no rollout cohort needs an interim shape.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — including the new `pipeline-status.test.ts`, the migrated assertions in `pipeline.test.ts` and `pipeline-preflight.test.ts`, and all unchanged sibling tests.
  - `apparat pipeline list --brief --project my-app` produces byte-identical output to today's `apparat pipeline list --project my-app`.
  - `apparat pipeline validate good.dot --project my-app` exits 0 and writes `<dirname>/<name>.svg` if and only if the source is newer than (or the SVG is missing). On unchanged sources, validate is a pure read.
  - `apparat pipeline validate broken.dot` exits 1, writes nothing — unchanged from today.
  - `apparat pipeline show good.dot` exits 0 and writes the SVG — unchanged from today.
- Repo-wide grep invariants post-merge:
  - `src/cli/commands/pipeline/list.ts` does not contain the string `apparat pipeline create`.
  - `src/cli/commands/pipeline/list.ts` does contain the string `apparat init`.
  - `src/cli/lib/pipeline-status.ts` exists and exports `readLastRunOutcome`, `getSvgFreshness`, `findHeartbeatForPipeline`.
  - `src/cli/program.ts` registers `--brief` on `pipeline list`.
- Behaviour invariants:
  - Listing wakes the daemon only on the deep path. `--brief` issues zero socket calls.
  - SVG render failure on `validate` does not change exit code.
  - `loadPipeline` is the *only* validation entry point used by the deep `list` path — no second validator call site.

## 9. Open questions

- **Should `findHeartbeatForPipeline` strictly filter by project root?** Today the heartbeat task identity is `pipeline:<args-hash>` and `args` includes the absolute path or the name + `--project`. The current matcher returns the first task whose args mention the pipeline name; if two projects have a `meditate` pipeline scheduled, the listing for project A could surface project B's task. Mitigation: tighten the matcher to require the `--project` flag in `args` to match `projectRoot`. Default: tighten in this design (the helper signature already takes `projectRoot`); flag for the implementing session if the heartbeat registration shape disagrees.
- **Should the timeout be configurable?** 1500 ms is a guess. If it proves too short on slow machines (cold daemon spawn), a `APPARAT_LIST_TIMEOUT_MS` env var could override. Default: ship with the constant; revisit on first user complaint.
- **Should `--brief` also skip `loadPipeline`?** Today's legacy path uses `parseDot` only — no validation, no diagnostics. Keeping `--brief` on raw `parseDot` preserves the legacy semantics (a pipeline with validation errors still appears in `--brief` output as long as it parses). Default: yes, keep `--brief` on `parseDot` only.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `apparat pipeline create` against `src/cli/commands/pipeline/list.ts` — zero hits.
- Grep `renderDotToSvg` against `src/cli/commands/pipeline/` — two import sites: `validate.ts` and `show.ts` (the definition site).
- Grep `request\("list_tasks"` — exactly two call sites post-merge: existing `src/cli/commands/heartbeat.ts:204` and new `src/cli/commands/pipeline/list.ts`.

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-status.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline.test.ts` — passes after migration of `pipelineListCommand` assertions onto `--brief` + new deep-render assertions.
- `npx vitest run src/cli/tests/pipeline-preflight.test.ts` — passes after `requires:` test ports to `--brief`.
- `npx vitest run src/cli/tests/pipeline-invocation.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/pipeline-show.test.ts` — passes unchanged (the new re-export does not change behavior).
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline list --project my-app` — produces deepened status cards, including at least one card per pipeline showing validity, schedule, last run, svg freshness.
- `apparat pipeline list --project my-app --brief` — byte-identical to today's `apparat pipeline list --project my-app` output.
- `apparat pipeline list --project my-app` with the daemon stopped — schedule line shows `(daemon offline)`; the rest of the listing renders normally.
- `apparat pipeline validate <changed-dot>` — exits 0, writes a fresh `<changed-dot>.svg`.
- `apparat pipeline validate <unchanged-dot>` — exits 0, writes nothing (mtime gate skipped).
- `apparat pipeline validate <broken-dot>` — exits 1, writes nothing.
- `apparat pipeline show <good-dot>` — unchanged from today.

### 10.4 Negative cases

- `pipeline.jsonl` containing only a `pipeline-start` event (no `pipeline-end`) — `readLastRunOutcome` returns `null` for that run dir and walks back to the next one. Listing renders `(no completed runs)` for that pipeline.
- `pipeline.jsonl` containing a malformed JSON line — the line is skipped; the next valid `pipeline-end` (or `null`) is returned.
- Two pipelines named `meditate` in two different projects, each scheduled — the matcher's project-root filter (open question §9 item 1) restricts the listing to the calling project's tasks.
- Daemon socket missing and daemon refuses to spawn — `request("list_tasks")` rejects within 1500 ms; the listing renders `(daemon offline)` and exits 0. Listing must never exit non-zero on daemon trouble.
- `validate` succeeds but graphviz wasm load fails — warning to stderr, exit 0, no SVG written. The next successful validate retries.

## 11. Summary

`apparat pipeline list` advertises a `pipeline create` command that does not exist (`src/cli/commands/pipeline/list.ts:16,23` vs. `src/cli/program.ts:107-203`), and it under-delivers — name + goal + optional `requires:` is the entire surface, while validity, schedule, last-run outcome, and SVG freshness all live in four other commands the operator must run by hand. `pipeline validate` succeeds without any side effect (`validate.ts:91-93`), so the colocated SVG produced by `pipeline show` drifts silently after every edit (the 2026-04-27 graph-preview session-closure file's "stale SVG drift" note). This design fixes the hint at both occurrences, deepens `pipeline list` into a per-pipeline status card (validity ✓/✗, schedule, last-run outcome+runId, SVG fresh/stale/none) sourced from the existing `loadPipeline()` seam, the existing `request("list_tasks")` IPC, the persisted `pipeline-end` events at `src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`, and an mtime compare; preserves today's exact output behind `--brief` for scripts; and auto-renders the colocated SVG on `pipeline validate` success when the source is newer, reusing `renderDotToSvg` from `show.ts:18-22`. Surface heartbeat schedule inside the deepened listing by reading daemon state read-only, with a 1500 ms timeout and `(daemon offline)` fallback. Three new helpers under `src/cli/lib/pipeline-status.ts`; new test file; rewritten `list.ts`; small inline edits to `validate.ts`, `show.ts`, and `program.ts`. Per the chat refinement, no new commands (`pipeline runs` and `pipeline replay` explicitly dropped), no `pipeline trace` churn, no agent / pipeline-format changes. Blast radius is S-by-files, M-by-surfaces. Two narrow breaking changes, both deliberate: `pipeline list` default output shape (mitigated by `--brief`) and `pipeline validate` gaining a write side-effect on success (the 2026-05-06 monolith-split spec's no-IO contract is updated to record this).
