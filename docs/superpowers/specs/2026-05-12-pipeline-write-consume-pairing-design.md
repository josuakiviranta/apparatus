# Design: Asymmetric success/failure GC of run-scoped scratch paths

**Date:** 2026-05-12
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-12T1033-pipeline-write-consume-pairing.md`

## 1. Motivation

Two pipeline-internal scratch paths grow forever today. Nothing reads them after the run that wrote them, but nothing deletes them either.

Concrete current state:

- `.apparat/runs/<run_id>/` accumulates `checkpoint.json`, per-node `prompt.md` / `raw-attempt-N.txt` / `status.json`, and `pipeline.jsonl`. 93 such dirs are on disk right now (verifier subagent count). Janitor is read-only by design — its `tools:` block at `src/cli/pipelines/janitor/janitor.md:6-12` lists only `Grep` + `mcp__illumination__*` (no `Edit`, no `Write`, no `rm`), so accumulation is unbounded by the agent layer.
- `.apparat/meditations/illuminations/.triage/<run_id>/chat-notes.md` is a same-run handoff between `chat_session` / `chat_summarizer` and the next-node `verifier` / `explainer`. 18 such dirs are on disk right now (verifier subagent count). The write path is hardcoded at `chat-summarizer.md:22` to `$project/.apparat/meditations/illuminations/.triage/$run_id/chat-notes.md`; no `src/` code writes to this directory (the agent writes via `Bash`).

Existing retention is **quantity-based and runs at pipeline start**, not at the tail and not success-aware:

```ts
// src/cli/commands/pipeline/runs-gc.ts:67-93
export function gcOldRunsPerPipeline(runsRoot: string, retention: GcRetention): void {
  if (!existsSync(runsRoot)) return;
  const summaries = listAllRuns(runsRoot);
  …
  for (const [key, arr] of buckets) {
    …
    for (const e of ordered.slice(keep)) {
      rmSync(join(runsRoot, e.runId), { recursive: true, force: true });
    }
  }
}
```

Called from the `onPipelineStart` tracer hook at `src/cli/commands/pipeline/run.ts:159-162`:

```ts
onPipelineStart(meta) {
  jsonlTracer.onPipelineStart(meta);
  runGc();
},
```

`runGc` itself is the wrapper at `run.ts:150-156` using `positiveIntEnv("APPARAT_RUNS_KEEP", 10)`. The retained-K-newest contract bounds project disk, but it is orthogonal to whether a specific run succeeded — a green run can survive eviction as long as 10 newer green ones haven't replaced it, and a red run can be evicted while you are still trying to debug it.

The pattern the refinements pin as precedent is the success-gated consume gate at `.apparat/pipelines/illumination-to-implementation/memory-writer.md:145`:

> Pre-check. If `$tmux_tester_test_result` equals the literal string `"fail"`, **skip both 7a and 7b entirely.** Failed verification means the implement node produced no shippable diff (or shipped broken code); deleting the plan and illumination would destroy the only artefacts the next run needs to recover.

That gate already protects two per-illumination artefacts (`docs/superpowers/plans/*.md` and `meditations/illuminations/*.md`) on red. This design extends the **same** asymmetric rule to two more **run-scoped** paths at the **pipeline tail**, not at a per-node consume call.

The illumination's framing was wider — a universal `lifecycle:` frontmatter system, a graph-validator artefact-flow rule, a `consume_design` MCP tool, and one-shot cleanup of 29 accumulated specs. The chat refinements (round 1) reduced that to "focus on C and D" — only `runs/` and `.triage/chat-notes` — because everything else (specs, sessions, illuminations, stimuli) functions as institutional memory that survives context resets. This design honours that reduction.

## 2. Decision summary

Add a **success-gated tail GC** for two paths, keyed by the current `<run_id>`:

1. **Path A:** `<project>/.apparat/runs/<run_id>/` — remove the entire run dir on green tail; preserve on red tail.
2. **Path B:** `<project>/.apparat/meditations/illuminations/.triage/<run_id>/` — same rule; same `<run_id>` key.

The decision lives in the existing `finally` block of `pipeline run` (`src/cli/commands/pipeline/run.ts:392-422`), gated on `result.status === "success"` (the variable already in scope at `:225`, surfaced as `pipelineFailed` at `:389-391`). On green: `rmSync` both paths. On red: leave both as-is for debugging.

The existing quantity-based `gcOldRunsPerPipeline` at pipeline **start** stays. It now layers below the tail GC: tail eviction frees disk on green; the start-time bucket cap evicts the oldest survivors (always failed runs after this lands) once the per-pipeline `APPARAT_RUNS_KEEP` ceiling is exceeded.

Codify the rule in a new `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`, citing ADR-0002 (`consume(filename, reason)`) and the precedent gate at `memory-writer.md:145`.

**Locked OUT of scope** (chat refinements):

- Lifecycle frontmatter system across 29 agents (refinement bullet "Scope reduced from M to S — lifecycle frontmatter…out").
- Graph-validator artefact-flow rule (same bullet).
- `consume_design` MCP tool (same bullet).
- GC of `docs/superpowers/specs/`, `.apparat/sessions/`, `.apparat/meditations/illuminations/`, `.apparat/meditations/stimuli/` (refinement bullets "Illuminations and stimuli folders are off-limits", "Sessions stay untouched", "Specs stay untouched").
- One-shot cleanup of the 93 + 18 already on disk (refinement bullet "Pre-existing accumulation is out of scope; rule is forward-looking only").
- Parallel-pipeline re-validation (refinement bullet "Parallel-pipeline re-validation dropped — no new validator rule means nothing new to validate"). The parallel pipeline inherits the run-scoped GC automatically because the rule lives at the pipeline runner, not in any agent.

## 3. Architecture

### 3.1 Two paths, one key, one gate

```
on pipeline tail:
  if result.status === "success":
    rmSync(<project>/.apparat/runs/<run_id>/)
    rmSync(<project>/.apparat/meditations/illuminations/.triage/<run_id>/)
  else:
    leave both as-is
```

`<run_id>` is the same string already in scope at `run.ts:227` (`runPipeline` `runId` option) and at `run.ts:405` (passed to `loadFailureHandoff`). Both paths share that one key — the GC needs no additional plumbing.

### 3.2 Where the decision lands

`src/cli/commands/pipeline/run.ts:389-422` is the finally block as it exists today:

```ts
    if (result.status !== "success") {
      pipelineFailed = true;
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await new Promise((resolve) => setImmediate(resolve));

    let handoff: ReturnType<typeof loadFailureHandoff> | null = null;
    if (pipelineFailed && lastFailedNodeId) {
      handoff = loadFailureHandoff({ … });
      emit({ kind: "failure-handoff", handoff });
    }

    done();
    await waitUntilExit();

    if (pipelineFailed) {
      if (handoff) {
        process.stderr.write(renderFailureFooter(handoff));
      }
      process.exit(1);
    }
  }
```

The tail GC inserts **after** `await waitUntilExit()` (so the TUI has unmounted and any final renders have flushed) and **before** `if (pipelineFailed) { … process.exit(1); }`. On green (`pipelineFailed === false`), the GC runs and then the function returns normally. On red, the GC is skipped and the existing footer/exit path runs unchanged.

Concrete shape:

```ts
    done();
    await waitUntilExit();

    if (!pipelineFailed) {
      gcRunScopedArtefactsOnSuccess(project, runId);
    }

    if (pipelineFailed) {
      if (handoff) {
        process.stderr.write(renderFailureFooter(handoff));
      }
      process.exit(1);
    }
  }
```

The helper is wholly synchronous (`rmSync` × 2) so no `await` is needed and no failure mode bleeds into the exit path.

### 3.3 The helper

New helper exported from the existing GC module so all run-scoped retention logic lives in one file:

```ts
// src/cli/commands/pipeline/runs-gc.ts (new export)
export function gcRunScopedArtefactsOnSuccess(project: string, runId: string): void {
  const runDir = join(project, ".apparat", "runs", runId);
  const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(triageDir, { recursive: true, force: true });
}
```

`force: true` makes a missing `.triage/<run_id>/` a no-op (pipelines that never invoke `chat-summarizer` simply do not create that dir; the GC must not error on its absence). Same property on `<runs>/<run_id>/` covers crash-before-tracer-init, though in practice the tracer always creates the dir before pipeline-start.

`runDir` is built via `path.join` rather than calling the existing `runDir(project, runId)` helper at `src/cli/lib/apparat-paths.ts` to keep `runs-gc.ts`'s import surface narrow (it already does `join(runsRoot, e.runId)` directly at `:90`). Editorial — either form satisfies the contract.

### 3.4 What the engine already gives us (no plumbing change)

The verifier subagent reported `onPipelineEnd` lacks outcome; that report is **wrong**. The current code already plumbs outcome through:

```ts
// src/attractor/core/engine.ts:124-130
function finalize(result: PipelineResult, opts: EngineOptions, runId: string): PipelineResult {
  opts.traceWriter?.onPipelineEnd({
    runId,
    outcome: result.status === "success" ? "success" : "failure",
  });
  return result;
}
```

And the tracer interface declares it:

```ts
// src/attractor/tracer/pipeline-tracer.ts:8
onPipelineEnd(meta: { runId: string; outcome: "success" | "failure" }): void;
```

This design **does not** modify `engine.ts` or the tracer interface. It uses the `result` returned by `runPipeline` directly (`run.ts:225` `const result = await runPipeline(…)`) and the `pipelineFailed` flag set at `run.ts:389-391`. The asymmetric gate sits one layer above the engine — at the `run.ts` finally block — where the result is already in scope.

This is the simpler seam: one variable already in scope, no public interface widened, no second tracer hook fired.

### 3.5 Interaction with the start-time GC

`gcOldRunsPerPipeline` at `src/cli/commands/pipeline/runs-gc.ts:67-93` keeps running at `onPipelineStart` (`run.ts:159-162`). After this design lands:

- A green run **at tail** removes its own dir. The start-time bucket cap (`APPARAT_RUNS_KEEP` per pipeline) never sees the green run as a survivor.
- A red run **at tail** leaves its dir. The start-time bucket cap evicts the oldest survivor in the bucket once K+1 reds accumulate.
- A run aborted mid-execution (SIGINT, hard kill, crash) leaves its dir — the `finally` block runs, but `pipelineFailed === true`, so the gate skips GC.

`APPARAT_RUNS_KEEP=N` semantics shift in practice from "the newest N runs survive on disk" to "the newest N **failed** runs survive on disk per pipeline" — because greens evict themselves at tail. This is a behavioural shift, not a contract break: the env var still bounds disk, the number still caps survivors. The README paragraph documents the shift.

### 3.6 Trace command compatibility on green runs

`apparat pipeline trace <runId>` reads the run dir directly:

```ts
// src/cli/commands/pipeline/trace.ts:11-18
const tracePath = join(runDir(project, runId), "pipeline.jsonl");
if (!existsSync(tracePath)) {
  await output.error(`No trace found for run: ${runId}`);
  await output.error(`Expected: ${tracePath}`);
  process.exit(1);
  return;
}
```

**Behavioural change:** after this design lands, `pipeline trace <runId>` for a **green** run will exit 1 with `No trace found for run: <runId>` because the dir has been GC'd at tail.

This is **intentional** under the refined scope: green runs have shipped, their trace is no longer needed for debugging. The illumination's framing of "scratch trash" applies precisely here — the trace is run-scoped, single-reader-during-debug, no cross-run consumer.

**Mitigation:** update `trace.ts:14-15`'s error message to hint at the asymmetric rule:

```ts
await output.error(`No trace found for run: ${runId}`);
await output.error(`Expected: ${tracePath}`);
await output.error(`(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`);
```

The third line is the only material edit to `trace.ts`. The exit-1 contract is unchanged. The hint is the hand-off to the user when their muscle memory hits the wall.

**Out-of-scope alternative considered:** copy `pipeline.jsonl` into a long-lived `<project>/.apparat/traces/<run_id>.jsonl` before deleting the run dir. Rejected — it reintroduces the same accumulation problem one folder over (per the "every write needs its pair" framing in the illumination); a green run's trace is precisely what the refined scope deems disposable.

### 3.7 `APPARAT_RUNS_KEEP` and `.gitignore` reconciliation

Verifier flagged `APPARAT_RUNS_KEEP`'s keep-last-N contract as conflicting with always-delete-on-green. Resolution: **asymmetric rule wins**, contract is reframed (not broken).

`APPARAT_RUNS_KEEP=N` after this design:

- Default 10 (unchanged at `run.ts:153`).
- Caps **failed-run survivors per pipeline** (greens self-evict at tail).
- Setting it to a higher number does not preserve green runs — they are gone before the next run's start-time GC even looks at the bucket.

`README.md:79` paragraph becomes:

> Older runs are pruned in two ways. **At pipeline tail**, a successful run removes its own `.apparat/runs/<runId>/` and `.apparat/meditations/illuminations/.triage/<runId>/` directories — only failed runs leave debug artefacts on disk. **At pipeline start**, `APPARAT_RUNS_KEEP` (default 10) caps the newest K failed-run survivors per pipeline; a stricter K=5 bucket (override with `APPARAT_CRASH_AT_START_KEEP`) covers crash-at-start dirs. The asymmetric rule is documented in ADR-0015.

`init.ts:50` already adds `.apparat/runs/` to `.gitignore`; `.triage/` is not gitignored. Neither needs to change — the GC removes from the working tree, not from git history, and `.triage/` is already untracked (no commits reference it).

### 3.8 ADR-0015

New file: `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`.

Skeleton (the implementer will fill in the prose; the contract here is the structure):

- **Status:** accepted (2026-05-12).
- **Context.** Pipeline runs produce two run-scoped scratch paths (`.apparat/runs/<run_id>/`, `.apparat/meditations/illuminations/.triage/<run_id>/chat-notes.md`) that have no readers after the run ends. Existing retention is quantity-based at pipeline start, not outcome-aware; janitor is read-only by design.
- **Decision.** At pipeline tail, on `result.status === "success"`, the runner removes both run-scoped paths keyed by `<run_id>`. On non-success, both paths are preserved untouched. The rule lives at `src/cli/commands/pipeline/run.ts` finally block — one variable (`pipelineFailed`) gates two `rmSync` calls. No new declarative system, no validator rule, no MCP tool.
- **Precedent cited.** ADR-0002 (`consume(filename, reason: "implemented" | "declined")` for illuminations and plans). Same gate shape lives at `.apparat/pipelines/illumination-to-implementation/memory-writer.md:145` (skip consume on `tmux_tester_test_result === "fail"`). This ADR generalises the gate to two more run-scoped paths.
- **Considered alternatives.**
  - **(a) Universal `lifecycle:` frontmatter system across all agents + validator artefact-flow rule + `consume_design` MCP tool.** Rejected: per chat refinement, only runs/ and .triage are unambiguously trash; specs/sessions/illuminations/stimuli are institutional memory.
  - **(b) Quantity-based tail GC (keep-newest-N regardless of outcome).** Rejected: the explicit refinement bullet ("if run have errors those files are useful to give claude for debugging") demands asymmetry. A green run is disposable; a red run is the debugging context.
  - **(c) Move chat-notes under `.apparat/runs/<run_id>/` so one GC handles both paths.** Rejected: requires atomic update of `chat-summarizer.md:22`'s hardcoded write path and any node reading it. The refined design GC's at the current path; the repath is editorial and may happen later if `.triage/` is no longer wanted as a directory at all.
  - **(d) Retroactive cleanup of the 93 + 18 dirs already on disk.** Rejected: refinement bullet "Pre-existing accumulation is out of scope; rule is forward-looking only." A sibling `chore` commit may follow at the implementer's discretion.
- **Consequences.**
  - `apparat pipeline trace <runId>` on a green run will exit 1; `trace.ts:14-15` adds a hint pointing at ADR-0015.
  - `APPARAT_RUNS_KEEP=N` semantics shift from "the newest N runs survive" to "the newest N **failed** runs survive per pipeline" (greens self-evict at tail).
  - The parallel pipeline inherits this rule automatically; no re-validation needed.
  - 93 run dirs and 18 triage dirs accumulated pre-rule remain on disk; the user may run a one-shot `chore` cleanup at their discretion (not part of this ADR).

### 3.9 Files-touched buckets

| Bucket | File | Treatment |
|---|---|---|
| GC helper | `src/cli/commands/pipeline/runs-gc.ts` | Edit — add `gcRunScopedArtefactsOnSuccess(project, runId)` export (one ~10-LOC function); existing `gcOldRunsPerPipeline` + `resolveResumeLogsRoot` untouched |
| Run command | `src/cli/commands/pipeline/run.ts` | Edit — insert one call (`if (!pipelineFailed) gcRunScopedArtefactsOnSuccess(project, runId);`) in the finally block between `await waitUntilExit()` (`:414`) and `if (pipelineFailed) { … process.exit(1); }` (`:416-421`) |
| Trace command | `src/cli/commands/pipeline/trace.ts` | Edit — add one hint line at `:14-15` pointing at ADR-0015 when the trace file is missing |
| ADR | `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md` | **New** — full ADR per §3.8 |
| Doc — README | `README.md` | Edit `:79` paragraph — replace the "lazily pruned last 50 per project" sentence with the asymmetric two-step phrasing (§3.7) |
| Existing test | `src/cli/tests/pipeline-runs-gc.test.ts` | Edit — add cases asserting `gcRunScopedArtefactsOnSuccess` removes both paths; existing `gcOldRunsPerPipeline` cases preserved |
| Existing test | `src/cli/tests/runs-gc-per-pipeline.test.ts` | Edit if and only if it asserts on the green-run dir surviving — the asymmetric rule changes that survivor's lifetime; verify the existing test does not lock the "green run dir on disk" property; if it does, retarget the assertion to "failed run dir on disk" |
| Existing test | `src/cli/tests/runs-index.test.ts` | Edit if needed — confirm the test does not assume a green-run dir is present after the run completes; retarget to a fixture or to a pre-staged dir rather than a live run if it does |
| New test | `src/cli/tests/post-tail-gc.test.ts` | **New** — direct unit tests on `gcRunScopedArtefactsOnSuccess`: removes both paths, no-op when missing, force-true safety |
| Engine / tracer | `src/attractor/core/engine.ts`, `src/attractor/tracer/pipeline-tracer.ts` | **No change** — `onPipelineEnd` already carries outcome; this design uses `result.status` in `run.ts` instead |
| Parallel pipeline | `.apparat/pipelines/parallel-illumination-to-implementation/*` | **No change** — inherits the run-scoped GC automatically; no agent file edit, no validator rule |
| CONTEXT.md | `CONTEXT.md` | **No change** — sections at `:26-40`, `:66-98`, `:167-201` are durable; the rule is implementation-internal |

Total files: ~6 source/doc/test (3 edits + 1 new ADR + 1 new test + 1 README paragraph + ≤ 2 conditional test edits). Surfaces crossed: pipeline runner (`run.ts`), GC module (`runs-gc.ts`), trace command (`trace.ts`), one new ADR, one README paragraph, tests. No engine change, no tracer change, no agent rubric change, no `.dot` schema change, no Ink TUI change, no daemon IPC change, no MCP tool change.

## 4. Components & key edits

### 4.1 `src/cli/commands/pipeline/runs-gc.ts` (edited)

Add one export. Imports already include `rmSync` (`:1`) and `join` (`:3`). Module owns all retention logic — keeping the new helper here is the single-source-of-truth play.

```ts
export function gcRunScopedArtefactsOnSuccess(project: string, runId: string): void {
  const runDir = join(project, ".apparat", "runs", runId);
  const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(triageDir, { recursive: true, force: true });
}
```

No interaction with `gcOldRunsPerPipeline`. The start-time bucket cap reads `listAllRuns(runsRoot)` (`:69`) fresh on each call, so a green run that GC'd itself at the previous tail simply does not appear in the next start's bucket.

### 4.2 `src/cli/commands/pipeline/run.ts` (edited)

Single-line guarded call in the finally block. `project` is in scope at `run.ts:228` (`cwd: project`), `runId` at `run.ts:227`, `pipelineFailed` at `run.ts:200`. Insertion site is **after** `await waitUntilExit()` (`:414`) and **before** the `if (pipelineFailed) { … process.exit(1); }` block (`:416-421`):

```ts
    done();
    await waitUntilExit();

    if (!pipelineFailed) {
      gcRunScopedArtefactsOnSuccess(project, runId);
    }

    if (pipelineFailed) {
      …
    }
  }
```

The two `if` blocks could fuse into `if (pipelineFailed) { … } else { gcRunScopedArtefactsOnSuccess(…); }`. Either form satisfies the contract; the implementer picks. The two-block form is preferred for diff minimisation (the existing `if (pipelineFailed) { … process.exit(1); }` block stays byte-identical).

Why **after** `waitUntilExit`: that promise resolves once the Ink TUI has unmounted and any final renders have flushed. Removing the run dir before unmount risks the TUI re-reading a file mid-deletion. After unmount is the safe moment.

Why **before** `process.exit(1)`: the GC is skipped on red anyway (guarded by `!pipelineFailed`), but placing the call above the exit keeps the control flow linear and the diff minimal.

Why **synchronous** (`rmSync`): the finally block already runs synchronously after the awaited `waitUntilExit`. An async helper would force a second `await` and lengthen the SIGINT-to-exit window without payoff. `rmSync` with `force: true` cannot throw on missing paths — the only failure mode is permission denied, which is an operator-level bug, not a runtime guard.

### 4.3 `src/cli/commands/pipeline/trace.ts` (edited)

One added stderr line in the existing missing-trace branch at `:13-18`:

```ts
if (!existsSync(tracePath)) {
  await output.error(`No trace found for run: ${runId}`);
  await output.error(`Expected: ${tracePath}`);
  await output.error(`(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`);
  process.exit(1);
  return;
}
```

The hint runs on every missing-trace exit, not only on green-cleaned runs (the runner has no way to distinguish "GC'd because green" from "never existed"). This is fine — the second sentence pre-explains the most common new failure mode without lying about the others.

The second `if (!existsSync(tracePath))` branch at `:23-28` (catch on `readFileSync`) gets the same hint for symmetry.

### 4.4 `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md` (new)

Per §3.8 skeleton. Length: ≤ 80 lines, matching ADR-0002's terse register (a context paragraph, decision paragraph, considered-alternatives list, consequences list — no implementation details).

### 4.5 `README.md` (edited)

`:79` paragraph replaced per §3.7 prose. One paragraph in length. The surrounding sentences (resume mechanics, failure footer) stay byte-identical.

### 4.6 `src/cli/tests/post-tail-gc.test.ts` (new)

Cases:

- `gcRunScopedArtefactsOnSuccess` removes a populated `.apparat/runs/<runId>/` dir (with `pipeline.jsonl` + nested per-node dirs).
- `gcRunScopedArtefactsOnSuccess` removes a populated `.apparat/meditations/illuminations/.triage/<runId>/` dir (with `chat-notes.md`).
- `gcRunScopedArtefactsOnSuccess` is a no-op when neither path exists (no throw).
- `gcRunScopedArtefactsOnSuccess` is a no-op for the missing path when the other exists (independent `force: true`).
- The function does **not** touch sibling `<runs>/<otherId>/` dirs or sibling `.triage/<otherId>/` dirs.
- The function does **not** touch `.apparat/sessions/`, `docs/superpowers/specs/`, or `.apparat/meditations/illuminations/` (any non-`.triage` siblings).

The sibling-safety cases are the load-bearing guard: the refinement-locked out-of-scope folders must remain demonstrably untouched even if the helper is invoked with a runId that happens to collide with another folder's basename.

### 4.7 `src/cli/tests/pipeline-runs-gc.test.ts` (edited)

Existing cases for `gcOldRunsPerPipeline` stay verbatim. Append one case asserting the export `gcRunScopedArtefactsOnSuccess` exists and is callable (the deeper behavioural cases live in `post-tail-gc.test.ts`).

### 4.8 `src/cli/tests/runs-gc-per-pipeline.test.ts` and `src/cli/tests/runs-index.test.ts` (conditional edits)

These tests pre-stage run-dir fixtures and then exercise the start-time GC / runs reader. Neither runs a real pipeline, so neither observes the new tail GC. They should pass unmodified.

The conditional edit applies **only if** either test indirectly invokes `pipelineRunCommand` (or its full finally path) and then asserts on the run dir being present — that assertion will go red on green-pipeline outcomes. If so, retarget the assertion to a failed-run fixture or to a pre-staged dir.

## 5. Data flow

### 5.1 Green run (new behaviour)

```
apparat pipeline run meditate <project>
  → graph parsed, runId = "meditate-abc12345"
  → onPipelineStart: gcOldRunsPerPipeline (start-time bucket cap, unchanged)
  → ... pipeline executes ... all nodes succeed
  → result.status === "success"
  → finally:
      await waitUntilExit (TUI unmounts)
      pipelineFailed === false → gcRunScopedArtefactsOnSuccess(project, runId)
        rmSync(<project>/.apparat/runs/meditate-abc12345/, {recursive,force})
        rmSync(<project>/.apparat/meditations/illuminations/.triage/meditate-abc12345/, {recursive,force})
      (skip the if(pipelineFailed) footer/exit block)
  → process exits 0
on disk after: both run-scoped dirs are gone
```

### 5.2 Red run (existing behaviour preserved)

```
apparat pipeline run meditate <project>
  → ... some node fails (or SIGINT, or crash) ...
  → result.status === "fail" (or undefined-then-default)
  → pipelineFailed = true
  → finally:
      await waitUntilExit
      pipelineFailed === true → skip GC entirely
      loadFailureHandoff + renderFailureFooter
      process.exit(1)
on disk after: <project>/.apparat/runs/<runId>/ retained for `pipeline trace <runId>`;
               <project>/.apparat/meditations/illuminations/.triage/<runId>/ retained
```

### 5.3 Pipeline that never wrote `.triage/<runId>/` (pipelines without chat-summarizer)

```
apparat pipeline run janitor <project>
  → runs (no chat_session, no chat_summarizer node)
  → success
  → finally: gcRunScopedArtefactsOnSuccess
      rmSync(<runs>/<runId>/) — present, deleted
      rmSync(<.triage>/<runId>/) — missing, force:true → silent no-op
on disk after: clean exit, no error
```

### 5.4 Start-time bucket cap interaction (after the rule lands)

```
Suppose APPARAT_RUNS_KEEP=10, pipeline "meditate" has had:
  - 15 green runs (all GC'd at their own tails)
  - 12 red runs (preserved)
  - 3 crash-at-start dirs

onPipelineStart of run #16's first failure:
  gcOldRunsPerPipeline reads listAllRuns(runsRoot)
  meditate bucket: 12 reds visible (no greens to count)
  meditate bucket.slice(10) → 2 oldest reds evicted
  __crash_at_start__ bucket: 3 dirs visible
  crash bucket.slice(5) → 0 evicted
```

The bucket cap thus governs **how many failed runs survive per pipeline**, which is the practically useful contract.

## 6. Blast radius / impact surface

- **Size:** **S.** Verifier blast paragraph: S, ~5–7 surfaces. Explainer Tier-2 §Blast radius: S. This design ships closer to ~6 surfaces because the `engine.ts` plumbing edit drops out (verifier was wrong about `onPipelineEnd` lacking outcome — see §3.4).
  - **Files touched:** ~6 — 2 new (`docs/adr/0015-…md`, `src/cli/tests/post-tail-gc.test.ts`) + 4 edited (`src/cli/commands/pipeline/runs-gc.ts`, `src/cli/commands/pipeline/run.ts`, `src/cli/commands/pipeline/trace.ts`, `README.md`) + ≤ 2 conditional test edits (`pipeline-runs-gc.test.ts` minor, `runs-gc-per-pipeline.test.ts` / `runs-index.test.ts` only if they assert on green-run-dir presence after a live run).
  - **Surfaces crossed:** pipeline runner (`run.ts` finally block), GC module (`runs-gc.ts` new export), trace command (`trace.ts` hint line), ADR layer (one new file), README retention paragraph, tests (1 new + 1–3 edited). No engine change, no tracer schema change, no agent rubric change, no `.dot` schema change, no Ink TUI change, no daemon IPC change, no MCP tool change, no validator rule change.

- **Breaking changes:** **yes, contained — two contracts shift, none break.**
  1. **`apparat pipeline trace <runId>` on a green run exits 1.** The path-not-found exit is unchanged; the dir's absence after green is the new normal. Mitigation: `trace.ts:14-15` adds a hint line pointing at ADR-0015 (§3.6). External callers that rely on green-run trace persistence must read the ADR or pivot to running with `APPARAT_RUNS_KEEP` semantics flipped (no flag exists — see §9.2 open question).
  2. **`APPARAT_RUNS_KEEP=N` semantics shift** from "the newest N runs survive on disk per pipeline" to "the newest N **failed** runs survive on disk per pipeline." Greens self-evict at tail. Documented in README.md:79 (§3.7).
  3. **Tests that assert a green run's dir is present after the run completes will go red.** Mitigated by §4.8 — most tests pre-stage fixtures and do not exercise the live finally path; only those that do need a retargeted assertion. Implementer audits in pass-1 of the implementation.
  4. **The parallel pipeline** inherits the rule automatically (run-scoped GC at the runner level, not per-agent). No agent-file edit; no second-pipeline regression check needed. Refinement bullet "Parallel-pipeline re-validation dropped" applies.

- **Spec / docs ripple checklist:**
  - [ ] `README.md:79` — paragraph rewritten per §3.7.
  - [ ] `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md` — new ADR per §3.8.
  - [ ] **No CONTEXT.md change.** Sections at `:26-40` (project-local layout), `:66-98` (illumination lifecycle), `:167-201` (project-local artefacts) describe the *kinds* of paths, not their retention. The rule is implementation-internal. Verifier CONTEXT subagent confirmed no domain term shifts.
  - [ ] **No `src/cli/skills/apparatus/pipelines.md` change** for retention text — verifier README subagent flagged `README.md:79` as the canonical retention copy; the skill file does not redocument it.
  - [ ] **No ADR-0002 amendment.** ADR-0002 documents the illumination consume lifecycle; ADR-0015 cites it as precedent and stands on its own.
  - [ ] **No update to `init.ts:50`'s gitignore line.** `.apparat/runs/` is already gitignored; `.triage/` is untracked and stays untracked (the GC removes from working tree, not git history).

- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/post-tail-gc.test.ts` (§4.6 case list — 6 cases including sibling-safety guards).
  - [ ] **Edit** `src/cli/tests/pipeline-runs-gc.test.ts` — minor add: assert `gcRunScopedArtefactsOnSuccess` export exists (§4.7).
  - [ ] **Conditional edit** `src/cli/tests/runs-gc-per-pipeline.test.ts` — only if it asserts green-run-dir presence after a live run (§4.8).
  - [ ] **Conditional edit** `src/cli/tests/runs-index.test.ts` — same conditional (§4.8).
  - [ ] **No edit** to `src/attractor/tests/engine.test.ts` or `src/attractor/tracer/jsonl-pipeline-tracer.test.ts` — the engine and tracer are untouched.

## 7. Trade-offs

### 7.1 Tail GC in `run.ts` finally vs. new tracer hook

**`run.ts` finally** chosen. Reasons:

- The result is already in scope at `run.ts:225` and `:389-391`. No interface widens.
- Tail GC is a CLI-side concern (the engine should not know about `.triage/` or project paths). Keeping it in `run.ts` matches separation already established by `loadFailureHandoff` and `renderFailureFooter`, both of which live in the same finally block.
- Cost: the rule does not fire for non-`pipeline run` invocations (e.g., embedded engine tests). Benefit: zero engine API change; no tracer schema risk.

### 7.2 Asymmetric (success/failure) vs. quantity-based tail GC

**Asymmetric** chosen. Refinement-locked. Reasons:

- Refinement bullet: "if run have errors those files are useful to give claude for debugging."
- The precedent at `memory-writer.md:145` is asymmetric on the same axis (`tmux_tester.test_result !== "fail"`); this design extends the gate, it does not invent a new pattern.
- Cost: green-run trace is no longer inspectable post-run. Benefit: red-run debug context is preserved exactly when it matters.

### 7.3 Repath chat-notes under `.apparat/runs/<runId>/` vs. GC at current path

**GC at current path** chosen. Reasons (refinement bullet "Category D — Repath under runs/ optional, not required"):

- The repath would need `chat-summarizer.md:22`'s hardcoded write path updated atomically with the GC, plus any node reading from `.triage/` (today: `verifier`, `explainer` — read via Bash, no `src/` write).
- The current-path GC is mechanically identical: same key, same `rmSync`. Repath is a folder layout question, not a GC correctness question.
- Cost: `.triage/` directory survives as an empty dir under `meditations/illuminations/` until manually removed. Benefit: zero touch on agent prompts, zero atomic-update concern.

### 7.4 Synchronous `rmSync` vs. async `rm`

**Synchronous** chosen. Reasons:

- The finally block is already linear after `await waitUntilExit()`. Async would force a second `await` and lengthen the SIGINT-to-exit window.
- `rmSync` with `force: true` is idempotent on missing paths; no failure mode bleeds.
- Cost: blocks the event loop for ≈ 1–5 ms (a typical run dir is < 1 MB). Benefit: deterministic ordering with the existing `process.exit(1)` path on the red branch.

### 7.5 Sibling chore-commit to clean the 93 + 18 backlog vs. ship rule-only

**Ship rule-only** chosen. Refinement-locked. Reasons:

- Refinement bullet: "Pre-existing accumulation (93 run dirs, 17 triage dirs) is out of scope; rule is forward-looking only."
- A retroactive `git rm` would not surface the rule's intent; a separate `chore(lifecycle): clean pre-protocol artefacts` commit cleanly attributes the backlog cleanup to its own reason.
- Cost: backlog stays on disk until manually removed. Benefit: rule lands without entangling cleanup of pre-rule state.

### 7.6 Hint line in `trace.ts` vs. add a flag (`--allow-missing`, `--from-archive`)

**Hint only** chosen. Reasons:

- A flag implies a future feature (trace archival) that the refined scope explicitly drops (§3.6 alternative considered).
- The hint pre-explains the most common new failure mode without adding surface.
- Cost: users with muscle memory hit the wall the first time they try to trace a green run. Benefit: zero new CLI surface, zero open-ended "where did the trace go?" question.

### 7.7 ADR-0015 narrowed to runs+triage vs. universal `consume-seam` rule

**Narrowed** chosen. Refinement-locked. Reasons:

- Refinement bullet: "ADR-0015 narrowed: codifies the success-gated GC rule for runs/ + chat-notes only, NOT a universal consume-seam generalization."
- A universal rule would force the validator artefact-flow check (out of scope) and the `consume_design` MCP tool (out of scope).
- Cost: when the next run-scoped scratch path appears (e.g., a new node's `.apparat/scratch/<run_id>/foo`), it must either land under `.apparat/runs/<run_id>/` (auto-cleaned) or get a fresh `rmSync` line in `gcRunScopedArtefactsOnSuccess`. Benefit: the rule is narrow, defensible, and ships in one PR.

### 7.8 Sequencing — single PR

Single PR. The four edited surfaces (`runs-gc.ts`, `run.ts`, `trace.ts`, `README.md`) plus the two new files (`0015-…md`, `post-tail-gc.test.ts`) are interlocked: the README sentence describes behaviour that lands in `run.ts`; the ADR cites code anchors from `runs-gc.ts`; the test exercises the helper added to `runs-gc.ts` and asserts the absence of green-run dirs after a live run (if it pivots that far). Split adds review cycles without payoff.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the new `post-tail-gc.test.ts` and any conditional edits to existing tests.
- `apparat pipeline run <name>` on a green outcome leaves **no** `.apparat/runs/<runId>/` or `.apparat/meditations/illuminations/.triage/<runId>/` on disk after exit.
- `apparat pipeline run <name>` on a red outcome leaves **both** paths on disk (when they exist; `.triage/` may be absent if the pipeline never invoked `chat-summarizer`).
- `apparat pipeline trace <runId>` on a green run exits 1 with the missing-trace message and the new ADR-0015 hint line; on a red run, succeeds as today.
- `apparat pipeline run <name> --resume <runId>` on a green-run runId fails per existing `resolveResumeLogsRoot` semantics (`runs-gc.ts:18-23`) — the dir is gone, so the equality lookup misses; the existing `run dir not found` message stands. No new behaviour.
- `APPARAT_RUNS_KEEP=N` continues to cap survivors per pipeline; effective contract is "newest N failed runs per pipeline."
- `gcOldRunsPerPipeline` at pipeline start runs unchanged.
- ADR-0002 is **not** edited; ADR-0015 stands alongside.
- The parallel pipeline at `.apparat/pipelines/parallel-illumination-to-implementation/*` inherits the rule with **zero** agent-file edits.

Repo-wide grep invariants (post-merge):

- `grep -nR "gcRunScopedArtefactsOnSuccess" src` — at least two matches: the export in `runs-gc.ts` and the call in `run.ts`. The test file adds 1–N matches.
- `grep -nR "rmSync" src/cli/commands/pipeline/runs-gc.ts` — exactly two matches inside the file: the existing one at the old `:90` and the two new ones inside the helper (so 3 total, or 1 new with the helper using `rmSync` × 2 inline).
- `grep -nR "ADR-0015" docs/` — at least two matches: the ADR's own filename and one cite from another ADR (only ADR-0015 itself if no other ADR cites it).
- `grep -nR "ADR-0015" src/cli/commands/pipeline/trace.ts` — exactly one match (the hint line).

Behaviour invariants:

- No new tracer fields. `pipeline-start` / `pipeline-end` JSONL events are byte-identical.
- No new IPC. No new socket calls. No new LLM invocations. No new MCP tool. No new MCP tool parameter.
- No new env vars. No new CLI flags.
- `pipeline run` exit codes unchanged on red (1). On green: 0 (unchanged in spirit; the dir's absence is post-exit state).
- The Ink TUI is untouched. The failure-handoff footer is untouched.

## 9. Open questions

### 9.1 Pipelines that do not invoke `chat-summarizer` produce a missing `.triage/<runId>/` — silent no-op or skip the rm?

The helper uses `force: true`, so missing paths are silent no-ops (`rmSync` with `force: true` never throws on `ENOENT`). This is the simpler shape and is preferred. The alternative (probe `existsSync` first) is editorial; the implementer may add the probe if it improves the test fixture story. Either path satisfies the contract.

### 9.2 Should there be an escape hatch for keeping a green run's trace?

**Default: no.** Refinement-locked. If the user wants to inspect a green run's trace, they can pause the pipeline mid-run (SIGINT → fail-path edge) or temporarily comment out the GC call locally.

A future env var (`APPARAT_KEEP_SUCCESSFUL_TRACES=1`) is plausible but out of scope per the "no new env vars" invariant in §8. If the user surfaces a real workflow that demands it, it lands as a follow-up.

### 9.3 Backlog cleanup commit — does the implementer include the chore?

**Default: no.** The 93 + 18 backlog stays. The refinement bullet ("Pre-existing accumulation is out of scope; rule is forward-looking only") is explicit. The implementer may emit a sibling `chore(lifecycle): clean pre-protocol artefacts` commit in the same PR or a follow-up, but it does not belong to this design.

### 9.4 Trace hint copy

The hint line in `trace.ts:14-15` is:

> `(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`

Alternatives the implementer may choose between (editorial — all satisfy the contract):

- `(successful runs auto-clean their trace at tail — see ADR-0015)`
- `(trace dirs are GC'd on green pipeline exit; only failed runs retain their trace — see ADR-0015)`

Either preserves the intent: pre-explain the most common new failure mode, point at the ADR.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `gcRunScopedArtefactsOnSuccess` — present in `runs-gc.ts` and `run.ts` (and `post-tail-gc.test.ts`).
- Grep `rmSync` inside `gcRunScopedArtefactsOnSuccess` body — exactly two calls.
- Grep `ADR-0015` — present in `0015-…md` filename, `trace.ts` hint line, `README.md` retention paragraph.
- Grep `onPipelineEnd` — **unchanged count** from before the design (engine + tracer untouched).

### 10.2 Tests

- `npx vitest run src/cli/tests/post-tail-gc.test.ts` — new, passes (§4.6's 6 cases).
- `npx vitest run src/cli/tests/pipeline-runs-gc.test.ts` — passes after the minor add (§4.7).
- `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts src/cli/tests/runs-index.test.ts` — passes (no edit if the conditional in §4.8 is not triggered; with edit if it is).
- Full `npx vitest run` — passes.

### 10.3 Smoke

- Run `apparat pipeline run meditate <project>` and let it succeed — confirm `ls <project>/.apparat/runs/` shows the runId is **gone** and `ls <project>/.apparat/meditations/illuminations/.triage/` shows the runId is **gone**.
- Run `apparat pipeline run meditate <project>` and force a failure (e.g., kill mid-run, or use a fixture pipeline that fails a node) — confirm both paths **survive**.
- Run `apparat pipeline trace <green-runId>` — exit 1 with the hint line.
- Run `apparat pipeline trace <red-runId>` — succeeds as today.
- Run `apparat pipeline run` for a pipeline that has no `chat_summarizer` node (e.g., `janitor`) and let it succeed — confirm no error, no orphaned `.triage/` dir.

### 10.4 Negative cases

- A green run with `<runId>` matching another pipeline's `<otherId>` substring — only the exact-match dir is removed (sibling-safety case in §4.6).
- A red run with no `lastFailedNodeId` (pre-handler crash) — `pipelineFailed === true`, GC skipped, footer emits the pre-handler crash path; no double-render.
- SIGINT during the finally block, after `gcRunScopedArtefactsOnSuccess` has started — `rmSync` is synchronous and atomic enough that the dir is fully gone or fully present; partial deletion is acceptable (the run already succeeded).
- A green run inside a worktree where the project root is a symlink — `path.join(project, …)` follows the symlink; the dir is removed from the symlink target. Same behaviour as the existing start-time GC, no regression.

## 11. Summary

Two pipeline-internal scratch paths grow forever today — `<project>/.apparat/runs/<run_id>/` (93 dirs on disk) and `<project>/.apparat/meditations/illuminations/.triage/<run_id>/chat-notes.md` (18 dirs on disk). The janitor is read-only by design (`src/cli/pipelines/janitor/janitor.md:6-12` tools block has no `rm`), so accumulation is unbounded. Existing retention is quantity-based at pipeline **start** (`gcOldRunsPerPipeline` called from `run.ts:159-162`), not outcome-aware. This design extends the **same** asymmetric success-gate already established at `memory-writer.md:145` (skip consume on `tmux_tester_test_result === "fail"`) to the two run-scoped paths at the **pipeline tail**: on `result.status === "success"` (in scope at `run.ts:225`, surfaced as `pipelineFailed` at `:389-391`), both paths are `rmSync`'d; on any other outcome, both are preserved untouched. The decision lives in one `if (!pipelineFailed)` block in `run.ts`'s existing finally (`:392-422`), calling a new ~10-LOC helper `gcRunScopedArtefactsOnSuccess(project, runId)` exported from `runs-gc.ts`. No engine change (the verifier's claim that `onPipelineEnd` lacks outcome is wrong — `engine.ts:124-130` already plumbs `outcome: "success" | "failure"`; this design avoids the public-interface widening and uses `result.status` directly one layer up). No tracer schema change, no agent rubric change, no MCP tool, no validator rule, no `lifecycle:` frontmatter system. `apparat pipeline trace <runId>` on a green run exits 1 with a new hint line at `trace.ts:14-15` pointing at ADR-0015; `APPARAT_RUNS_KEEP=N` semantics shift from "newest N runs per pipeline" to "newest N **failed** runs per pipeline" (greens self-evict at tail), documented in `README.md:79`. The parallel pipeline at `.apparat/pipelines/parallel-illumination-to-implementation/*` inherits the rule with zero agent-file edits because the GC lives at the runner level, not in any agent. ADR-0015 codifies the rule narrowly — runs + triage only, not a universal consume-seam generalization — citing ADR-0002 (`consume(filename, reason)`) and the `memory-writer.md:145` gate as precedent. Pre-existing accumulation (93 + 18 dirs) stays on disk; the rule is forward-looking only per the refinement lock. Blast radius is **S** — ~6 surfaces (3 edits + 1 new ADR + 1 new test + 1 README paragraph, plus ≤ 2 conditional test edits), two contained behavioural shifts (trace-on-green exits 1; `APPARAT_RUNS_KEEP` reframes to "failed-run survivors"), zero broken contracts. Single PR; the implementer may emit a sibling `chore(lifecycle): clean pre-protocol artefacts` commit at their discretion.
