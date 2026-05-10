# Design: Deepen `pipeline list` into a zoom-in surface over `.apparat/runs/`

**Date:** 2026-05-10
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2312-runs-folder-is-an-opaque-graveyard.md`

## 1. Motivation

`<project>/.apparat/runs/` already holds the gold for every interactive run — `checkpoint.json`, `pipeline.jsonl`, per-node `prompt.md` + `raw-attempt-N.txt` + `status.json`. But the directory is a **flat bag of 8-char UUIDs** and nothing in the CLI joins it on the time axis.

Concrete current state:

- The runId generator is `src/cli/lib/apparat-paths.ts:42-44`:
  ```ts
  export function newRunId(): string {
    return randomUUID().slice(0, 8);
  }
  ```
  Pipeline name never enters. Two real entries in this repo, both from the `janitor` pipeline, look identical: `533e1a8c` vs. `5836ed5f`.

- `pipeline list` is a single-axis static-roster view (`src/cli/commands/pipeline/list.ts:13-33`):
  ```ts
  export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
    const project = resolve(opts.project ?? process.cwd());
    const entries = listAllPipelines(project);

    const local = entries.filter(e => e.origin !== "bundled");
    const bundled = entries.filter(e => e.origin === "bundled");
    // Local pipelines: / Bundled pipelines: …
  }
  ```
  No positional argument; `program.ts:173-186` registers `--project` only. The runs directory is invisible from this surface.

- `pipeline trace <runId>` is the per-run zoom (`src/cli/program.ts:188-196`, body in `src/cli/commands/pipeline/trace.ts:11`):
  ```ts
  const tracePath = join(runDir(project, runId), "pipeline.jsonl");
  ```
  It accepts an exact bare runId; there is no list-of-runs surface that hands the human a copy-pasteable runId.

- GC is project-global by mtime (`src/cli/commands/pipeline/runs-gc.ts:52-67`):
  ```ts
  export function gcOldRuns(runsRoot: string, keep: number): void {
    if (!existsSync(runsRoot)) return;
    const entries: { path: string; mtime: number }[] = [];
    for (const name of readdirSync(runsRoot)) { …push… }
    entries.sort((a, b) => b.mtime - a.mtime);
    for (const e of entries.slice(keep)) {
      rmSync(e.path, { recursive: true, force: true });
    }
  }
  ```
  A 30-iteration `meditate` smoke loop this morning evicts last week's only successful `illumination-to-implementation` run that the human still wanted to inspect. `APPARAT_RUNS_KEEP=50` (called from `src/cli/commands/pipeline/run.ts:132-133`) defends against unbounded growth but ignores composition entirely.

- `pipeline-end` already carries the data a runs table needs (`src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`):
  ```ts
  this.append({ kind: "pipeline-end", runId, outcome, timestamp: new Date().toISOString() });
  ```
  Combined with `pipeline-start` at `:12-24` (`pipelineName`, `goal`, `timestamp`), every row's outcome / start time / pipeline name is a trailing-line read away. No new tracer fields needed.

The strategic compass: VISION's "one human, one machine, many projects, many pipelines" only stays tractable with a time axis. The `deep-modules-hide-complexity` lens (per the user's chat directive — `keep this stimuli file in your mind when you do it .apparat/meditations/stimuli/deep-modules-hide-complexity.md`) is decisive here: a sibling `pipeline runs` command would be the textbook shallow-module symptom — *one concept, two implementations, no enforcing seam*. The deep move is to deepen `pipeline list` so one verb projects the same data along two axes (static roster vs. per-pipeline time series), and to compose runId from pipeline-name so `.apparat/runs/` becomes self-describing on disk.

## 2. Decision summary

The chat refinement (rounds 1 + 2) reduced the illumination's seven steps to three landed pieces. Steps 5 (failure-footer history hint) and 6 (daemon-runs merge) are deferred onto their owning draft specs and are **not** part of this design.

1. **Deepen `apparat pipeline list` with an optional positional `<name>` argument** (`src/cli/program.ts:173-186` + `src/cli/commands/pipeline/list.ts:13-33`). Without `<name>`: today's behaviour preserved exactly — `Local pipelines:` / `Bundled pipelines:` headers, current rows. With `<name>`: same Local/Bundled section structure, but under the named pipeline's row a recent-runs table expands (≤ K rows from per-pipeline retention). Each row prints `→ apparat pipeline trace <runId>` for copy-paste drill-in.

2. **Bucket the GC by pipeline.** Replace the flat `gcOldRuns(runsRoot, 50)` (`src/cli/commands/pipeline/runs-gc.ts:52-67`) with `gcOldRunsPerPipeline(runsRoot, perPipelineKeep, crashAtStartKeep)`. Group entries by pipeline name (read from `pipeline.jsonl` trailing `pipeline-start` line — fall back to "unknown" for crashed-at-start dirs), keep the newest K per group. Default K = 10 per pipeline; crashed-at-start entries (no `pipeline.jsonl`, or `pipeline.jsonl` with no `pipeline-start` line) get their own bucket with K = 5 so a meditate crash-loop cannot evict last week's only successful illumination run. Caller in `src/cli/commands/pipeline/run.ts:132-133` switches to the new helper.

3. **Compose runId from pipeline-name + UUID prefix** (`src/cli/lib/apparat-paths.ts:42-44`). `newRunId()` grows a `pipelineName` argument and returns `<pipeline-slug>-<uuid8>` (e.g. `janitor-533e1a8c`). Both interactive callers (`src/cli/commands/pipeline/run.ts:129`) and the daemon (`src/daemon/runner.ts:55`) thread the slug in. `pipeline trace <runId>` and the `--resume` parser accept both new (`<slug>-<uuid8>`) and bare (`<uuid8>`) forms — back-compat for run dirs that exist on disk today and for any callers that pass a bare id.

**Locked OUT of scope** (chat refinements):

- A new `apparat pipeline runs` sibling command. Round 1, bullet 1: "commands should flow like a zooming in meaning there should be first command to see bird eye perspective and if I want to zoom in something I would just copy paste command from first command's output." One verb, two zoom levels.
- `--limit`, `--failed`, `--runs` flags. Round 1, bullet 4: "I'm probably never have time to write these kind of flags: `--runs --limit 8` or this kind of flags: `--runs janitor --limit 5`." Per-pipeline GC retention bounds Layer 2 visually; the retained history *is* the table.
- Failure-footer "previous runs" hint (illumination step 5). Round 1: cited spec `2026-05-09-pipeline-failure-handoff-is-shallow-design.md` is `Status: draft`. When that spec ships, the footer gains one line: `history: apparat pipeline list <name>` — no flag chain. Until then, no footer change here.
- Daemon-scheduled-runs merge (illumination step 6). Round 1: cited spec `2026-05-09-two-run-homes-no-cross-project-view-design.md` is `Status: draft`. When that spec ships and routes daemon runs into the project-local tracer via `injectRunArgs` (`src/daemon/runner-args.ts:14-23`), the cross-home view collapses to a single `source: interactive | scheduled` column on the same Layer-2 table.
- Mission-control spec amendment. Round 2: user treats `docs/superpowers/specs/` as historical reference; mission-control's "no new commands" line is not a binding constraint here.
- Long-name column truncation (today's `NAME_COL = 34` at `src/cli/commands/pipeline/list.ts:11` plus wrap-to-second-line). Round 2, bullet "Can we ignore this question right now?". Out of scope this cycle.

## 3. Architecture

### 3.1 Three-layer zoom

```
Layer 1   apparat pipeline list                  → all pipelines, current behaviour
Layer 2   apparat pipeline list <name>           → recent runs for that pipeline
Layer 3   apparat pipeline trace <runId>         → per-run drill-in (untouched)
```

Each layer's output literally prints the next-zoom command on its own row (`→ apparat pipeline list <name>` is *not* added to Layer 1 in this cycle — out of scope per round 2 "leave it as it is right now"). Layer 2's table prints `→ apparat pipeline trace <runId>` on every row so the human's drill-in is always one copy away. Zero flag memorisation across the chain.

### 3.2 Layer 1 (no positional) — preserved verbatim

`pipelineListCommand` with `name === undefined` walks `listAllPipelines(project)` (`src/cli/lib/pipeline-resolver.ts:118-135`) and renders the existing two sections. Section headers, NAME_COL padding (`src/cli/commands/pipeline/list.ts:11`), goal column, `(forked → local)` / `(shadowed by local)` tags, `requires:` continuation rows — **all unchanged**. Round 2 lock: "If possible leave it as it is right now."

### 3.3 Layer 2 (`<name>` positional) — same shape, runs nested

When `<name>` is supplied:

1. Resolve the pipeline via `listAllPipelines(project).find(e => e.name === name)`. Unknown name → exit 1 with `pipeline not found: <name> (apparat pipeline list to see roster)`.
2. Print the same `Local pipelines:` / `Bundled pipelines:` headers (preserving the round-2 layout-stability lock). Only the row matching `<name>` renders; the other section prints `(none)` or is omitted to avoid confusion — see open question §9.1.
3. Under that row, render a recent-runs sub-table read from disk (§3.4).

Sketch (illustrative, not final):

```
Local pipelines:
  meditate                            "Generate illuminations"

  recent runs:
    ✓  meditate-2f8a91c3   2026-05-09 19:30   12.4s
       → apparat pipeline trace meditate-2f8a91c3
    ✗  meditate-7c1d4e02   2026-05-09 18:12    4.1s   failed at: classifier
       → apparat pipeline trace meditate-7c1d4e02
    …  (≤ 10 rows; oldest dropped by per-pipeline GC)

Bundled pipelines:
  (none for this name — see `apparat pipeline list` for the full bundled roster)
```

The runs table's columns are fixed, no flags: outcome glyph (✓ / ✗ / … in-progress), runId, ISO start time, duration, optional `failed at: <node>` tail. Newest first. Capped at the per-pipeline retention K (default 10). The cap is implicit — the retained history *is* the table — so there is no "show me more" question to answer.

### 3.4 Reading runs off disk

The reader is a new pure function in a new lib file:

```ts
// src/cli/lib/runs-index.ts
export interface RunSummary {
  runId: string;                     // <slug>-<uuid8> or bare <uuid8>
  pipelineName: string | null;       // null when pipeline-start is missing (crash-at-start)
  startedAt: string | null;          // ISO timestamp from pipeline-start
  outcome: "success" | "failure" | "in-progress" | "crashed";
  durationMs: number | null;         // null when in-progress or crashed
  failedNodeId: string | null;       // null on success / in-progress / crashed-at-start
}

export function listRunsForPipeline(runsRoot: string, pipelineName: string): RunSummary[];
export function listAllRuns(runsRoot: string): RunSummary[];
```

Implementation:

- `readdirSync(runsRoot)` → for each subdir, attempt to read `pipeline.jsonl`.
- Parse the **first** `pipeline-start` event (carries `pipelineName`, `timestamp`) and the **last** `pipeline-end` event (carries `outcome`, `timestamp`). Both are already authored by `JsonlPipelineTracer` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:12-24` + `:51-58`).
- If `pipeline-start` is missing or `pipeline.jsonl` does not exist → classify `outcome: "crashed"`, `pipelineName: null` (the dir is the "unknown" GC bucket).
- If `pipeline-start` exists but `pipeline-end` is missing → `outcome: "in-progress"`, `durationMs: null`.
- If `pipeline-end` carries `outcome: "failure"`, walk the JSONL once more for the most recent `node-end` with `success: false` to extract `failedNodeId`. (Optional polish — Layer 2 can ship without `failed at:` and add it later. See §9.2.)
- Sort by `startedAt` descending; newest first.

`listRunsForPipeline(runsRoot, name)` is `listAllRuns(runsRoot).filter(r => r.pipelineName === name)`. The filter happens after parse so retention's K-newest-per-pipeline rule and the table's K-newest-per-pipeline rule share one definition of "pipeline".

No tracer schema change — every field consumed is already in the JSONL. Verifier subagent confirmed `pipeline-end` carries `outcome` + `timestamp` at `src/attractor/tracer/jsonl-pipeline-tracer.ts:47-53`; this design uses both unmodified.

### 3.5 Slug-prefixed runId

```ts
// src/cli/lib/apparat-paths.ts:42-44 (current)
export function newRunId(): string {
  return randomUUID().slice(0, 8);
}

// after
export function newRunId(pipelineName: string): string {
  const slug = slugify(pipelineName);          // [a-z0-9-]+; collapse runs of non-slug chars to "-"
  return `${slug}-${randomUUID().slice(0, 8)}`;
}
```

Callers:

- `src/cli/commands/pipeline/run.ts:129` — `const runId = opts.runId ?? newRunId();` becomes `const runId = opts.runId ?? newRunId(graph.name);`. `graph.name` is in scope by `:129` (set during `parseDot`).
- `src/daemon/runner.ts:54-55` — `runTask(task)` body's `const runId = newRunId();` becomes `const runId = newRunId(graph.name);` *only when the daemon knows the pipeline name*. Inside `runTask` the name is not yet parsed (the daemon spawns the CLI as a child); pass the slug via `task.command + task.args[0]`-derived hint or, more cleanly, leave the daemon-side `newRunId()` returning a bare 8-char id and let the spawned child re-derive a slugged id only when no `--run-id` was injected. Concrete plan: keep `newRunId()` callable with **no argument** as a back-compat shape that returns the bare 8-char form (today's behaviour) — only `pipeline run`'s direct call site uses the slugged form. Daemon-side runs get their slugged id when the two-run-homes spec ships and `injectRunArgs` (`src/daemon/runner-args.ts:14-23`) gains pipeline-name awareness; until then, daemon runs land as bare-id directories (already a tested back-compat path — see §3.6).

The slug rule:

```ts
function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);   // cap to keep the on-disk path short
}
```

Examples: `"meditate"` → `meditate-2f8a91c3`; `"illumination-to-implementation"` → `illumination-to-implementation-7c1d4e02`; `"My Pipeline!"` → `my-pipeline-…`.

### 3.6 Back-compat for bare 8-char runIds

Two surfaces accept user-supplied runIds:

1. `pipeline trace <runId>` (`src/cli/program.ts:188-196` → `src/cli/commands/pipeline/trace.ts:11`). Today: `tracePath = join(runDir(project, runId), "pipeline.jsonl")`. Existing behaviour is "look up an exact directory by name." That works unchanged for both `<slug>-<uuid8>` and bare `<uuid8>` directories — `runDir` is just a `path.join`. **No code change needed in trace.ts** for the basic case.

2. `--resume <runId>` parser (`src/cli/commands/pipeline/runs-gc.ts:16-22`). Today:
   ```ts
   if (typeof resume === "string") {
     const dir = join(runsRoot, resume);
     if (!existsSync(dir)) {
       process.stderr.write(`[apparat] --resume ${resume}: run dir not found: ${dir}\n`);
       process.exit(1);
     }
     return dir;
   }
   ```
   Same property — equality lookup against the on-disk name. A `<slug>-<uuid8>` user id matches a `<slug>-<uuid8>` dir; a bare `<uuid8>` user id matches a bare `<uuid8>` dir. No change required for back-compat.

The actual back-compat surface that needs work is the **runId-format test** (`src/cli/tests/apparat-paths.test.ts:54-63`):

```ts
describe("newRunId", () => {
  it("returns an 8-char hex slice of randomUUID", () => {
    const id = newRunId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
  …
});
```

After the change `newRunId("meditate")` returns `meditate-<8hex>`; the regex must become `/^[a-z0-9-]+-[0-9a-f]{8}$/`. The test also exercises the `newRunId()` no-arg shape for back-compat (used by daemon-side until the two-run-homes spec ships) — that case still matches `/^[0-9a-f]{8}$/`.

A second downstream is `src/cli/tests/pipeline.test.ts:179-180`:
```ts
expect(opts.logsRoot).toMatch(
  new RegExp(`\\.apparat[\\\\/]runs[\\\\/][0-9a-f]{8}$`),
);
```
Becomes `\\.apparat[\\\\/]runs[\\\\/][a-z0-9-]+-[0-9a-f]{8}$` (or accepts both shapes via alternation).

A new test `src/cli/tests/pipeline-trace-runid-compat.test.ts` exercises both runId shapes against `pipeline trace`.

### 3.7 Per-pipeline GC

```ts
// src/cli/commands/pipeline/runs-gc.ts (after)
export interface GcRetention {
  perPipelineKeep: number;     // default 10
  crashAtStartKeep: number;    // default 5
}

export function gcOldRunsPerPipeline(runsRoot: string, retention: GcRetention): void {
  if (!existsSync(runsRoot)) return;
  const summaries = listAllRuns(runsRoot);   // §3.4
  // Bucket by pipelineName (null → "__crash_at_start__").
  // For each bucket: sort by startedAt|mtime desc, slice(keep), rmSync the rest.
}
```

The flat `gcOldRuns(runsRoot, keep)` is **deleted**. No call sites outside `src/cli/commands/pipeline/run.ts:132-133` and the test `src/cli/tests/pipeline-runs-gc.test.ts:1-51`. The latter is rewritten against `gcOldRunsPerPipeline` semantics.

`APPARAT_RUNS_KEEP=N` semantics shift from "keep N project-wide" to "keep N per pipeline" — this is a breaking change for anyone scripting around the env var. New env var `APPARAT_CRASH_AT_START_KEEP=N` controls the crash bucket; default 5. Document the semantics shift in `README.md` (one paragraph in the resume/trace area at `:97-102`) and in `src/cli/skills/apparatus/pipelines.md:484-509` (the existing `Older runs are pruned to the last 50 per project (override with env APPARAT_RUNS_KEEP=N).` line at `:489` becomes `Older runs are pruned to the last 10 per pipeline (override with env APPARAT_RUNS_KEEP=N). Crash-at-start dirs are kept to a stricter K=5 bucket (override with APPARAT_CRASH_AT_START_KEEP=N).`).

### 3.8 Files-touched buckets

| Bucket | File | Treatment |
|---|---|---|
| Runs reader | `src/cli/lib/runs-index.ts` | **New** — `listRunsForPipeline`, `listAllRuns`, `RunSummary` |
| Path module | `src/cli/lib/apparat-paths.ts` | Edit — `newRunId(pipelineName?)` accepts optional slug; back-compat no-arg shape preserved |
| GC | `src/cli/commands/pipeline/runs-gc.ts` | Edit — replace `gcOldRuns` with `gcOldRunsPerPipeline`; preserve `resolveResumeLogsRoot` unchanged |
| Run command | `src/cli/commands/pipeline/run.ts` | Edit — `newRunId(graph.name)` at `:129`; switch GC call at `:132-133` to per-pipeline |
| List command | `src/cli/commands/pipeline/list.ts` | Edit — accept optional `name` arg; render runs table when supplied |
| Commander wiring | `src/cli/program.ts` | Edit — `.command("list [name]")` at `:174`; help text update |
| Daemon runner | `src/daemon/runner.ts` | No change this cycle (back-compat no-arg `newRunId()` keeps it working; slug-side waits for two-run-homes spec) |
| Existing tests | `src/cli/tests/apparat-paths.test.ts` | Edit — update regex at `:55-57`; add no-arg back-compat assertion |
| Existing tests | `src/cli/tests/pipeline-runs-gc.test.ts` | Rewrite against `gcOldRunsPerPipeline`; cover per-pipeline bucketing + crash-at-start bucket |
| Existing tests | `src/cli/tests/pipeline.test.ts` | Edit — update logsRoot regex at `:179-180` |
| Existing tests | `src/cli/tests/pipeline-trace-command-validation.test.ts` | Edit if needed — confirm it does not lock on bare-8-char runId shape |
| Existing tests | `src/cli/tests/pipeline-run-runid.test.ts` | Edit — exercise slugged + bare shapes |
| New tests | `src/cli/tests/pipeline-list-layer2.test.ts` | New — Layer-2 table rendering with fixture runs dir |
| New tests | `src/cli/tests/runs-gc-per-pipeline.test.ts` | New — per-pipeline + crash bucket retention |
| New tests | `src/cli/tests/apparat-paths-slug-format.test.ts` | New — slug rule edge cases (unicode, long names, empty, special chars) |
| New tests | `src/cli/tests/pipeline-trace-runid-compat.test.ts` | New — `pipeline trace` accepts both shapes |
| New tests | `src/cli/tests/runs-index.test.ts` | New — `listAllRuns` parsing of fixture JSONL files |
| Doc — README | `README.md` | Edit `:97` (list one-liner gains the `[<name>]` form), `:102` (trace one-liner gains the `<slug>-<uuid8>` example) |
| Doc — skill | `src/cli/skills/apparatus/pipelines.md` | Edit `:17` (workflow step 7 gains the Layer-2 hint), `:484-509` (Resume / Trace section: env-var semantics + new runId shape) |

Total files: ~17 (1 new lib + 5 new tests + 8 edited source/tests + 2 docs + 1 commander entry). Surfaces crossed: CLI commander, runId generation, GC retention, list rendering, runs reader (new), tests (5 edited + 5 new), docs (2 edited). No daemon IPC change, no `.dot` schema change, no tracer schema change, no Ink TUI change, no agent rubric change.

## 4. Components & key edits

### 4.1 `src/cli/lib/runs-index.ts` (new)

See §3.4. ~80 LOC. Two exports — `listAllRuns` (full walk) and `listRunsForPipeline` (filter wrapper). Pure I/O; no side effects beyond `readFileSync`. Single source of truth for "what does a run dir contain?" — used by both `pipelineListCommand` (Layer 2) and `gcOldRunsPerPipeline`. The shared seam is the deep-modules-hide-complexity payoff: one parse, two consumers, no drift.

### 4.2 `src/cli/lib/apparat-paths.ts` (edited)

The signature widens but the no-arg call shape is preserved:

```ts
export function newRunId(pipelineName?: string): string {
  const uuid8 = randomUUID().slice(0, 8);
  if (!pipelineName) return uuid8;
  return `${slugify(pipelineName)}-${uuid8}`;
}
```

Round 2 spec-status reality: the daemon-side `src/daemon/runner.ts:55` keeps calling `newRunId()` (no arg) until the two-run-homes spec ships and `injectRunArgs` learns the pipeline name. The optional-arg shape lets us land slug-prefixing on the interactive path *now* without coupling to a draft spec.

### 4.3 `src/cli/commands/pipeline/runs-gc.ts` (edited)

Drop `gcOldRuns(runsRoot, keep)` (`:52-67`). Add `gcOldRunsPerPipeline(runsRoot, retention)`. `resolveResumeLogsRoot` (`:12-45`) is **unchanged** — the equality-lookup behaviour at `:16-22` still works for both runId shapes (§3.6).

The crash-at-start bucket is detected by the same `listAllRuns` parse: `RunSummary.pipelineName === null` ↔ "no `pipeline-start` line was authored" ↔ "this is a crash-at-start dir." No second pass.

### 4.4 `src/cli/commands/pipeline/list.ts` (edited)

Signature widens: `pipelineListCommand(opts: { project?: string; name?: string })`. With `name === undefined`: today's body executes verbatim. With `name` supplied: same body executes (preserving Local/Bundled headers and the matched-row render), and after the matched row prints, `renderRunsTable(listRunsForPipeline(runsRoot, name))` appends.

The runs-table renderer is a new ~30-LOC pure function in the same file (or extracted to `src/cli/lib/runs-table.ts` if the implementing session prefers — editorial, not contractual). Output shape per §3.3.

### 4.5 `src/cli/program.ts` (edited)

```ts
pipeline
  .command("list [name]")
  .description("List pipelines (no arg) or recent runs of one pipeline")
  .addHelpText("after", `
Examples:
  apparat pipeline list                       # all pipelines (Layer 1)
  apparat pipeline list meditate              # recent runs of 'meditate' (Layer 2)
  apparat pipeline list --project my-app
`)
  .option("--project <folder>", "Project folder (defaults to cwd)")
  .action(async (name: string | undefined, opts: { project?: string }) => {
    await pipelineListCommand({ ...opts, name });
  });
```

The `--project` option survives unchanged; `name` is optional positional, so today's `apparat pipeline list` invocations are byte-identical to before.

### 4.6 `src/cli/tests/apparat-paths.test.ts` (edited)

```ts
describe("newRunId", () => {
  it("returns a slugged shape when pipelineName provided", () => {
    expect(newRunId("meditate")).toMatch(/^meditate-[0-9a-f]{8}$/);
    expect(newRunId("illumination-to-implementation"))
      .toMatch(/^illumination-to-implementation-[0-9a-f]{8}$/);
  });

  it("returns the bare 8-char shape when no pipelineName provided (back-compat)", () => {
    expect(newRunId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("slugifies special characters", () => {
    expect(newRunId("My Pipeline!")).toMatch(/^my-pipeline-[0-9a-f]{8}$/);
  });

  it("returns a different id on each call (collision-resistant)", () => {
    expect(newRunId("x")).not.toBe(newRunId("x"));
  });
});
```

### 4.7 `src/cli/tests/pipeline-runs-gc.test.ts` (rewritten)

Cases:

- 12 runs from one pipeline → keep newest 10, delete 2.
- 5 runs from `meditate` + 3 runs from `janitor`, K=2 → keep 2 newest of each (delete 3 + 1).
- Crash-at-start dirs (no `pipeline.jsonl`) bucket separately, K=5.
- Mixed bucket with both regular and crash dirs respects per-bucket K.
- Empty `runsRoot` is a no-op.
- Non-directory entries ignored.
- `APPARAT_RUNS_KEEP=N` env override changes per-pipeline K.

### 4.8 `src/cli/tests/pipeline-list-layer2.test.ts` (new)

Cases:

- Fixture runs dir with 3 `meditate` runs (1 success, 1 failure, 1 in-progress) → Layer 2 renders all three rows newest-first with correct glyphs.
- Layer 2 prints `→ apparat pipeline trace <runId>` on every row.
- Layer 2 with no runs for that pipeline prints `recent runs: (none)`.
- Layer 2 for an unknown pipeline name exits 1 with a clear message.
- Layer 1 (no positional) still renders the existing two-section roster byte-for-byte (regression guard).

### 4.9 `src/cli/tests/runs-index.test.ts` (new)

Cases:

- Single pipeline-start + pipeline-end → success summary.
- pipeline-start without pipeline-end → in-progress.
- No `pipeline.jsonl` → crashed.
- pipeline-end with `outcome: "failure"` + most-recent failed `node-end` → `failedNodeId` populated.
- Multiple runs across pipelines → bucket correctly by `pipelineName`.

## 5. Data flow

### 5.1 Layer 1 (today, preserved)

```
apparat pipeline list --project x
  → pipelineListCommand({ project: x })
    → listAllPipelines(project)            // src/cli/lib/pipeline-resolver.ts:118-135
    → render Local + Bundled sections      // src/cli/commands/pipeline/list.ts:13-33
```

### 5.2 Layer 2 (new)

```
apparat pipeline list meditate --project x
  → pipelineListCommand({ project: x, name: "meditate" })
    → listAllPipelines(project) → find name === "meditate" or exit 1
    → render Local/Bundled section headers + matched row (preserves layout)
    → renderRunsTable(listRunsForPipeline(runsDir(project), "meditate"))
        → readdirSync(runsDir(project))
        → for each subdir: parse pipeline.jsonl (first pipeline-start, last pipeline-end, optional last failed node-end)
        → filter by pipelineName === "meditate"
        → sort desc by startedAt
        → cap implicit (per-pipeline GC retention bounds the list)
    → each row prints "→ apparat pipeline trace <runId>"
```

### 5.3 Run lifecycle (slugged runId path)

```
apparat pipeline run meditate --project x
  → graph = parseDot(...)                       // graph.name === "meditate"
  → runId = opts.runId ?? newRunId(graph.name)  // → "meditate-2f8a91c3"
  → gcOldRunsPerPipeline(runsRoot, retention)   // §3.7
  → JsonlPipelineTracer authors pipeline-start/-end as today
  → on disk: <project>/.apparat/runs/meditate-2f8a91c3/pipeline.jsonl
```

### 5.4 Daemon-spawned run (back-compat path, this cycle)

```
runTask(task)                                   // src/daemon/runner.ts:54-75
  → runId = newRunId()                          // no arg → bare "2f8a91c3" (back-compat)
  → injectRunArgs spawns child with --run-id=2f8a91c3
  → child writes <project>/.apparat/runs/2f8a91c3/pipeline.jsonl
  → Layer 2's listRunsForPipeline still finds and renders this dir (pipelineName parsed from JSONL, not the dir name)
```

When the two-run-homes spec ships, the daemon will pass the pipeline name through `injectRunArgs` and adopt the slugged shape; this design's Layer-2 reader already tolerates both shapes today.

## 6. Blast radius / impact surface

- **Size:** **M.** Verifier final pass: M (refined from the illumination's L). Explainer Tier-2 §Blast radius: M. Same envelope.
  - **Files touched:** ~17 — 6 new (`runs-index.ts`, `runs-index.test.ts`, `pipeline-list-layer2.test.ts`, `runs-gc-per-pipeline.test.ts`, `apparat-paths-slug-format.test.ts`, `pipeline-trace-runid-compat.test.ts`) + 11 edited (`apparat-paths.ts`, `runs-gc.ts`, `run.ts`, `list.ts`, `program.ts`, `apparat-paths.test.ts`, `pipeline-runs-gc.test.ts`, `pipeline.test.ts`, `pipeline-run-runid.test.ts`, `README.md`, `pipelines.md`).
  - **Surfaces crossed:** CLI commander (`program.ts:173-186` `list [name]`), runId generation (`apparat-paths.ts:42-44`), GC retention (`runs-gc.ts:52-67`), list rendering (`list.ts:13-33`), runs reader (new `runs-index.ts`), tests (5 edited + 5 new), docs (`README.md:97,102`, `pipelines.md:17,484-509`). No daemon IPC change, no `.dot` schema change, no tracer schema change, no Ink TUI change, no agent rubric change, no `program.ts` new top-level command (Round 1 lock: no sibling `pipeline runs`).

- **Breaking changes:** **yes, contained.**
  1. `newRunId()` now optionally takes a pipelineName. The no-arg shape still returns a bare 8-char id (back-compat for daemon-side), so external callers that ignore the new arg keep working. **Test break:** `src/cli/tests/apparat-paths.test.ts:55-57` regex `/^[0-9a-f]{8}$/` — updated in §4.6.
  2. `gcOldRuns(runsRoot, keep)` → `gcOldRunsPerPipeline(runsRoot, retention)`. The old export is **deleted**. **Test break:** `src/cli/tests/pipeline-runs-gc.test.ts:1-51` rewritten in §4.7.
  3. `APPARAT_RUNS_KEEP=N` semantics shift from project-global to per-pipeline. **Behavioural break** for anyone scripting around the env var; documented in `README.md` and `pipelines.md:489`.
  4. `src/cli/tests/pipeline.test.ts:179-180` logsRoot regex `\.apparat[\\/]runs[\\/][0-9a-f]{8}$` — updated to accept slug prefix.
  5. `src/cli/commands/pipeline/runs-gc.ts:16-22` resume-parser equality lookup is **unchanged** (§3.6). No break — both id shapes are exact-match against the on-disk dir name.
  6. `src/cli/commands/pipeline/trace.ts:11` direct `runDir(project, runId)` join — **unchanged**. Both id shapes work as exact lookups. No break.

- **Spec / docs ripple checklist:**
  - [ ] `README.md:97` — list one-liner gains the `[<name>]` positional form: `apparat pipeline list [<name>] --project <folder>`. One paragraph after the existing one explains Layer 2.
  - [ ] `README.md:102` — trace one-liner adds a `<pipeline-slug>-<uuid8>` example for the new runId shape.
  - [ ] `src/cli/skills/apparatus/pipelines.md:17` — workflow step 7 gains a Layer-2 hint: "or `apparat pipeline list <name>` for a chronological table of recent runs."
  - [ ] `src/cli/skills/apparatus/pipelines.md:489` — env-var documentation updates from "last 50 per project" to "last 10 per pipeline" + add `APPARAT_CRASH_AT_START_KEEP` paragraph.
  - [ ] `src/cli/skills/apparatus/pipelines.md:484-509` — Run / Resume / Trace section gains one paragraph showing the new runId shape and the Layer-2 zoom path.
  - [ ] **No new ADR.** ADR-0007 (`docs/adr/0007-ralph-folder-as-project-local-home.md`) is reinforced — runs stay in `<project>/.apparat/runs/`. ADR-0008 (single-home) likewise. Verifier ADR subagent confirmed none of the 13 ADRs constrain the deepen-`pipeline list` approach.
  - [ ] **No CONTEXT.md change** unless the runId-format becomes a domain term (verifier flagged this as "possibly" — defer to the implementing session's read on whether the slug prefix is load-bearing enough to surface there).
  - [ ] **No mission-control spec amendment.** Round 2 lock: that spec is historical reference.

- **Test ripple checklist:**
  - [ ] **Edit** `src/cli/tests/apparat-paths.test.ts:54-65` — slug + back-compat regex (§4.6).
  - [ ] **Rewrite** `src/cli/tests/pipeline-runs-gc.test.ts:1-52` against `gcOldRunsPerPipeline` (§4.7).
  - [ ] **Edit** `src/cli/tests/pipeline.test.ts:179-180` — logsRoot regex accepts slug prefix.
  - [ ] **Edit** `src/cli/tests/pipeline-run-runid.test.ts` — confirm both shapes (TBD if file already locks the bare-id assumption; verifier flagged it as a high-risk test).
  - [ ] **Confirm** `src/cli/tests/pipeline-trace-command-validation.test.ts` does not lock on bare-id shape.
  - [ ] **New** `src/cli/tests/pipeline-list-layer2.test.ts` (§4.8).
  - [ ] **New** `src/cli/tests/runs-gc-per-pipeline.test.ts` (§4.7's case list).
  - [ ] **New** `src/cli/tests/apparat-paths-slug-format.test.ts` — slug edge cases.
  - [ ] **New** `src/cli/tests/pipeline-trace-runid-compat.test.ts` — both shapes round-trip through `pipeline trace`.
  - [ ] **New** `src/cli/tests/runs-index.test.ts` — `listAllRuns` parsing fixtures (§4.9).

## 7. Trade-offs

### 7.1 Deepen `pipeline list` vs. add `pipeline runs`

**Deepen** chosen. Reasons (refinement-locked):

- Round 1, bullet "deep-modules-hide-complexity lens": a sibling `pipeline runs` is the textbook shallow-module symptom — "a concept implemented twice with no single seam where they're forced to agree."
- Round 1, bullet "zoom hierarchy": user wants `apparat pipeline list` (all) → `apparat pipeline list <name>` (zoom). One verb, two zoom levels.
- Cost: `pipelineListCommand` grows a branch (renders runs table when `name` is supplied). Benefit: zero new top-level command, zero help-text drift between roster view and runs view, one parse/render path for both layers.

### 7.2 Implicit cap (per-pipeline retention) vs. `--limit N`

**Implicit cap** chosen. Reasons (refinement-locked):

- Round 1, bullet "no flags": "I'm probably never have time to write these kind of flags: --runs --limit 8…"
- The retained history *is* the table. Per-pipeline GC default K=10 is small enough to scan visually; if the user wants more they raise K via `APPARAT_RUNS_KEEP`.
- Cost: no quick "show me last 3" filter. Benefit: zero flag memorisation, zero "should I make this a flag?" decisions for future surfaces.

### 7.3 Slug-prefixed runId vs. bare 8-char

**Slug-prefixed** chosen. Reasons (refinement-locked):

- Round 1, bullet "I like the run id's are suffixes in your output examples": user prefers self-describing folder names.
- `ls .apparat/runs/` becomes self-describing; copy-pasted `→ apparat pipeline trace <runId>` rows carry pipeline context inline.
- Cost: one breaking change (regex test) + slug rule to implement. Benefit: every CLI output and every on-disk path becomes greppable by pipeline name.

### 7.4 No-arg back-compat shape vs. mandatory slug

**No-arg back-compat** chosen. Reasons:

- Daemon-side (`src/daemon/runner.ts:55`) does not yet have the pipeline name in scope; threading it through requires the two-run-homes spec to ship first (Round 1 deferral).
- Optional `pipelineName` arg keeps the slug-prefixing contained to interactive runs *now* without coupling to a draft spec.
- Cost: daemon-side runs land as bare-id directories until the two-run-homes spec ships; bare-id back-compat code lives a little longer than ideal. Benefit: this design ships standalone.

### 7.5 Per-pipeline + crash buckets vs. flat per-pipeline

**Per-pipeline + crash bucket** chosen. Reasons:

- Round 1, bullet "useful runs ≡ noisy crashes": a 30-iteration meditate crash-loop with no successful nodes shouldn't evict last week's only successful `illumination-to-implementation` run.
- The crash signal (`pipeline.jsonl` missing or no `pipeline-start` line) is trivially detectable in the same scan that Layer 2 does. Zero extra parse.
- Cost: one extra bucket and one extra env var. Benefit: doubles effective history depth for noisy pipelines.

### 7.6 Read JSONL on every Layer-2 invocation vs. cache an index

**Read JSONL** chosen. Reasons:

- The runs dir is bounded by GC retention (default 10/pipeline + 5 crash). 70 dirs × ~5 events (typical pipeline.jsonl head/tail) = ~350 lines parsed per Layer-2 invocation. Below 100ms on any modern disk.
- An index file would create a second source of truth (cache vs. JSONL) and need cache-busting on every run start/end. Round-2 simplicity preference.
- Cost: O(N) parse per Layer-2 call. Benefit: zero new on-disk artifact, zero cache invalidation logic.

### 7.7 Layer-2 layout — preserve sections vs. dedicated runs view

**Preserve sections** chosen. Reasons (refinement-locked):

- Round 2, bullet "If possible leave it as it is right now."
- Visual rhyme between Layer 1 and Layer 2; the named pipeline appears under whichever section header (`Local pipelines:` / `Bundled pipelines:`) it belongs to, with the runs table nested below it.
- Cost: Layer 2 has a "ghost section" for the empty side (e.g. when zooming a local pipeline, `Bundled pipelines:` prints `(none for this name)` or is omitted). Editorial — see §9.1. Benefit: one layout primitive, two zoom levels.

### 7.8 Sequencing — single PR vs. split

Single PR is the default. The natural multi-PR split would be:

- **PR 1:** `runs-index.ts` + `runs-index.test.ts` (no behaviour change yet).
- **PR 2:** `gcOldRunsPerPipeline` + tests; runId slug + tests + doc updates.
- **PR 3:** Layer-2 list rendering + tests.

But the test-update-in-lockstep constraint (regex changes in `apparat-paths.test.ts` and `pipeline.test.ts` go red mid-PR2 without the slug landing first) means the seam-first split adds review cycles. Default to single PR; the implementer may split if review bandwidth requires.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the 5 new test files and all 5 edited test files.
- `apparat pipeline list` (no positional) — byte-identical output to today's behaviour. Regression-guarded by §4.8's Layer-1 case.
- `apparat pipeline list <name>` — renders the matched pipeline's row from Layer 1 *plus* a recent-runs table (≤ K=10 rows by default), each row carrying outcome glyph, runId, ISO start time, duration, optional failed-node tail, and a `→ apparat pipeline trace <runId>` line.
- `apparat pipeline list <unknown>` — exit 1 with `pipeline not found: <unknown> (apparat pipeline list to see roster)`.
- New runs created by `apparat pipeline run <name>` write to `<project>/.apparat/runs/<name-slug>-<uuid8>/`.
- `APPARAT_RUNS_KEEP=N` (default 10) caps per-pipeline retention. `APPARAT_CRASH_AT_START_KEEP=N` (default 5) caps the crash bucket.
- `apparat pipeline trace <runId>` accepts both `<slug>-<uuid8>` and bare `<uuid8>` runId shapes.
- `apparat pipeline run <name> --resume <runId>` accepts both shapes.
- Old bare-id directories on disk remain readable, listable in Layer 2, and resumable — no migration.

Repo-wide grep invariants (post-merge):

- `grep -nR "gcOldRuns\b" src` — zero matches in source (the old export is gone); only `gcOldRunsPerPipeline` is referenced.
- `grep -nR "newRunId" src` — at least three importers (`run.ts`, `daemon/runner.ts`, tests).
- `grep -nR "listRunsForPipeline\|listAllRuns" src` — at least two importers (`list.ts`, `runs-gc.ts`) and the test files.
- `grep -nR "randomUUID().slice(0, 8)" src` — exactly one match (inside `newRunId` in `apparat-paths.ts`); no other call site reproduces the truncation rule.

Behaviour invariants:

- No new tracer fields. `pipeline-start` / `pipeline-end` JSONL events are byte-identical to today.
- No new IPC. No new socket calls. No new LLM invocations.
- `pipeline run` exit codes unchanged. `pipeline trace` exit codes unchanged.
- The Ink TUI is untouched.

## 9. Open questions

### 9.1 Layer-2 ghost section formatting

When `apparat pipeline list meditate` resolves to a Local pipeline, what does the `Bundled pipelines:` header render? Three plausible forms:

1. **Print the header with `(none for this name)`** — visual rhyme with Layer 1, slight noise.
2. **Omit the empty section entirely** — cleaner, but breaks the round-2 "leave layout as is" lock more aggressively.
3. **Print only the section that contains `<name>`** — minimal noise; the user already named one pipeline, so they don't need the other section's empty state.

Default: **option 1** (print both headers, empty side gets a one-line `(none for this name — see apparat pipeline list for the full roster)`). This honours round 2's "leave it as it is right now" most faithfully — both headers always print. Implementer may pick option 3 if option 1 is judged too noisy in practice; either is consistent with the design's contract.

### 9.2 `failed at: <node>` in Layer-2 rows

Polish, not core. The `RunSummary.failedNodeId` field requires one extra JSONL pass per failed run (§3.4). The implementing session may skip this in the first cut and add it in a follow-up — Layer 2 still works without it (✗ glyph + duration is enough to triage). If shipped as polish, the column is omitted on success rows.

### 9.3 `runs-table.ts` extraction

The Layer-2 row renderer (~30 LOC) lives inside `list.ts` by default. Extracting to `src/cli/lib/runs-table.ts` is editorial — pick whichever the implementing session finds cleaner after the renderer is written. Either path satisfies the design.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `listAllRuns\|listRunsForPipeline` in `src/cli/lib/runs-index.ts` — both present.
- Grep `gcOldRunsPerPipeline\b` in `src/cli/commands/pipeline/runs-gc.ts` — present.
- Grep `gcOldRuns\b` in `src` — zero matches outside `runs-gc.ts` source itself (the old export is gone; `gcOldRunsPerPipeline` is the only public name).
- Grep `randomUUID\(\)\.slice\(0, 8\)` in `src` — exactly one match (`apparat-paths.ts` `newRunId`).

### 10.2 Tests

- `npx vitest run src/cli/tests/runs-index.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-list-layer2.test.ts` — new, passes.
- `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts` — new, passes.
- `npx vitest run src/cli/tests/apparat-paths-slug-format.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-trace-runid-compat.test.ts` — new, passes.
- `npx vitest run src/cli/tests/apparat-paths.test.ts src/cli/tests/pipeline-runs-gc.test.ts src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-run-runid.test.ts` — passes after edits.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- Run `apparat pipeline list` in this repo — output byte-identical to before the change.
- Run `apparat pipeline run meditate` — confirm the on-disk dir is `<project>/.apparat/runs/meditate-<8hex>/`.
- Run `apparat pipeline list meditate` — confirm the recent-runs table shows the new run plus historical bare-id meditate runs (the parser reads `pipelineName` from the JSONL, not the dir name, so old + new dirs interleave correctly).
- Run `apparat pipeline trace <slug>-<uuid8>` and `apparat pipeline trace <bare-uuid8>` — both succeed.
- Set `APPARAT_RUNS_KEEP=2`, run `meditate` 5 times, run `janitor` 5 times — confirm 2 of each survive on disk (per-pipeline bucketing). Confirm crash-at-start dirs (synthesised by truncating a `pipeline.jsonl` mid-write) bucket separately at K=5.

### 10.4 Negative cases

- Layer 2 against an unknown pipeline name — exit 1, clear message.
- Layer 2 against a pipeline with zero runs — `recent runs: (none)`.
- Run dir with empty `pipeline.jsonl` — classified as crash-at-start, listed under the crash bucket, not under any pipeline-named bucket.
- Run dir with `pipeline-start` but no `pipeline-end` (in-progress or hard-killed) — `outcome: "in-progress"`, `durationMs: null`, listed correctly.
- Pipeline name with special characters (`"My Pipeline!"`) — slug rule produces `my-pipeline-<uuid8>`, dir is created, Layer 2 round-trips it.
- Bare-id directory created by an old version of the CLI — Layer 2 reads `pipelineName` from its JSONL and lists it under the right pipeline.

## 11. Summary

`<project>/.apparat/runs/` is a flat bag of opaque 8-char runIds — `src/cli/lib/apparat-paths.ts:42-44` truncates a UUID without consulting the pipeline name; `src/cli/commands/pipeline/runs-gc.ts:52-67` keeps the newest 50 by mtime regardless of pipeline; `src/cli/commands/pipeline/list.ts:13-33` walks the *static* roster but never the time axis. The data the human needs to ask "what did my janitor pipeline do this week?" is on disk — `pipeline-end` already carries `outcome` + `timestamp` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`), `pipeline-start` already carries `pipelineName` + `timestamp` (`:12-24`) — but nothing joins it. This design ships three pieces tightly scoped by the chat refinement: (1) deepen `apparat pipeline list` with an optional positional `<name>` so the same verb projects both the static roster (Layer 1) and a chronological recent-runs table for one pipeline (Layer 2) — same Local/Bundled section structure, with each runs-table row printing `→ apparat pipeline trace <runId>` for copy-paste drill-in; (2) replace the flat `gcOldRuns(runsRoot, 50)` with `gcOldRunsPerPipeline(runsRoot, retention)` — newest K=10 per pipeline, plus a stricter K=5 bucket for crash-at-start dirs so a meditate crash-loop cannot evict last week's only successful illumination run; (3) compose the runId from pipeline-name + UUID8 prefix (`meditate-2f8a91c3`) so `.apparat/runs/` becomes self-describing on disk, with `pipeline trace` and `--resume` accepting both new and bare 8-char shapes. The deep-modules-hide-complexity lens (per the user's chat directive) is decisive: a sibling `pipeline runs` command would be the textbook shallow-module — one concept, two implementations, no enforcing seam — so this design deepens one verb instead. Per the round-1 chat lock the failure-footer history hint (illumination step 5) is deferred onto `2026-05-09-pipeline-failure-handoff-is-shallow-design.md` (currently `Status: draft`); the daemon-runs merge (illumination step 6) is deferred onto `2026-05-09-two-run-homes-no-cross-project-view-design.md` (also `Status: draft`). Per the round-2 lock the existing Layer-1 layout is preserved verbatim. Blast radius is **M** — ~17 files (6 new, 11 edited), four contained breaking changes (two test regexes, one env-var semantic shift, one renamed export). No new tracer fields, no new IPC, no new top-level CLI command, no `.dot` schema change, no Ink TUI change, no agent rubric change. Sequencing defaults to a single PR; the implementer may split into a seam-first three-PR train if review bandwidth requires.
