# Design: Failure-footer `resume:` recipe honours `--project` and `--var`

**Date:** 2026-05-11
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-11T2330-failure-resume-recipe-drops-project-and-vars.md`
**Predecessor spec:** `docs/superpowers/specs/2026-05-09-pipeline-failure-handoff-is-shallow-design.md`

## 1. Motivation

The May-09 spec deepened the failure footer into a four-line recipe explicitly marketed as paste-and-go. The README says so at `README.md:79`:

> `resume:` (the exact `pipeline run … --resume <runId>` command for after you fix it).

"Exact" is the failure mode. The recipe builder at `src/cli/lib/failure-handoff.ts:86` is a two-slot string template:

```ts
const resumeCommand = `apparat pipeline run ${args.dotFile} --resume ${args.runId}`;
```

The caller at `src/cli/commands/pipeline/run.ts:391-399` has `opts.project` and `opts.variables` in scope but never threads them into `loadFailureHandoff()`. The `LoadFailureHandoffArgs` interface at `src/cli/lib/failure-handoff.ts:56-67` carries seven fields — `tracePath, failedNodeId, failureReason, dotFile, dotDir, runId, graph` — and zero invocation flags.

Concrete incident, run `parallel-illumination-to-implementation-df1d9cf6`, 2026-05-11. The pipeline was invoked as `apparat pipeline run .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot --project .` and failed at `tmux_confirm_gate`. The printed footer:

```
resume: apparat pipeline run .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot --resume parallel-illumination-to-implementation-df1d9cf6
```

Copy-paste verbatim → engine rejects at `src/cli/commands/pipeline/run.ts:71-75`:

```
✗ [project_binding_missing] Pipeline references $project but --project flag not passed.
  Pass --project <folder>, not --var project=...
```

The user's second attempt (`--var project=.`) hits Commander's `--var "project" expected key=value`. The correct command is derivable, but the whole point of the printed recipe is to remove that mental diff.

Two adjacent surfaces make the bug load-bearing rather than cosmetic:

- **`apparat heartbeat`** schedules pipelines with `--project` and `--var` baked in. The whole point of heartbeat is that scheduled invocations don't require human flag-typing. A failure that prints an incomplete resume command breaks that contract.
- **`apparat pipeline run --resume <runId>`** preflight at `run.ts:67-77` rejects `--var project=...` with *"Pass --project <folder>, not --var project=..."* — so the recipe can't even silently lie via `--var`. Two parts of the same module disagree about whether `--project` is a first-class concept.

Same shape as the May-09 spec's motivation: the *interface promise* (the printed recipe is copy-pasteable and exact) is stronger than the *implementation delivers*. Three- to ten-line fix; no new concept.

## 2. Decision summary

1. **Thread optional `project` and `variables` into `LoadFailureHandoffArgs`** at `src/cli/lib/failure-handoff.ts:56-67`. Both fields optional so existing callers and tests that don't pass them stay green; the caller at `src/cli/commands/pipeline/run.ts:391-399` passes `opts.project` and `opts.variables` through.
2. **Replace the inline template at `src/cli/lib/failure-handoff.ts:86`** with a pure `buildResumeCommand()` helper that appends `--project <folder>` when set and `--var k=v` (shell-quoted) per entry in `variables`.
3. **Extract and export the existing `shellQuote()` helper** from `src/attractor/handlers/tool.ts:23-25` so the recipe builder and the script-file interpreter share one quoting rule. New location: `src/cli/lib/shell-quote.ts` (or co-located inside `failure-handoff.ts` — see §3.3).
4. **Regression tests** in `src/cli/tests/failure-handoff.test.ts` covering: project-only, variables-only, both, neither (byte-for-byte backwards compat), and quoting of values containing whitespace/metacharacters.
5. **Audit, do not change, the `inspect:` line** at `src/cli/lib/failure-handoff.ts:48`. `pipeline trace` does not require `--project` or `--var`; the audit is part of this work so the recipe surface is uniformly trustworthy.
6. **Cross-link from `README.md:79`** that the resume line includes any caller flags so users know they can paste-and-go even from scrollback.

**Locked OUT of scope:**

- Any change to `--var` parsing or the `--project` preflight at `run.ts:67-77`. The engine's strict-binding signal is correct; only the recipe builder is wrong.
- Any change to the `inspect:` line shape — already complete.
- Persisting invocation flags to disk (e.g. into the trace JSONL) for cross-process resume. Out of scope; this design recovers flags from in-process state only. Daemon/cron invocations supply their own flags from the schedule.
- New IPC, new tracer fields, success-path footer changes.

## 3. Architecture

### 3.1 Before / after

**Before** — `src/cli/lib/failure-handoff.ts:86`:

```ts
const resumeCommand = `apparat pipeline run ${args.dotFile} --resume ${args.runId}`;
```

**After** — same line, switched to a helper that consumes the new optional fields:

```ts
const resumeCommand = buildResumeCommand({
  dotFile: args.dotFile,
  runId: args.runId,
  project: args.project,
  variables: args.variables,
});
```

Output examples:

```
# no project, no variables — current behaviour, byte-for-byte
resume: apparat pipeline run pipelines/my.dot --resume a1b2c3d4

# --project . only (the parallel-impl incident)
resume: apparat pipeline run pipelines/my.dot --resume a1b2c3d4 --project .

# --var with whitespace value
resume: apparat pipeline run pipelines/my.dot --resume a1b2c3d4 --project . --var 'steer=focus on auth' --var lens=tests
```

Argument order: `<dotFile>` first, then `--resume <runId>`, then `--project <folder>` (when set), then `--var k=v` pairs in insertion order. Insertion order is stable because `opts.variables` is built by Commander into a `Record<string, string>` whose key order reflects CLI argv order.

### 3.2 The `buildResumeCommand` helper

New pure function co-located in `src/cli/lib/failure-handoff.ts` (the same file that already exposes `renderFailureFooter` — they round-trip the same data and tests sit alongside):

```ts
export interface BuildResumeCommandArgs {
  dotFile: string;
  runId: string;
  project?: string;
  variables?: Record<string, string>;
}

export function buildResumeCommand(args: BuildResumeCommandArgs): string {
  const parts = [`apparat pipeline run ${args.dotFile} --resume ${args.runId}`];
  if (args.project !== undefined) {
    parts.push(`--project ${shellQuote(args.project)}`);
  }
  if (args.variables) {
    for (const [k, v] of Object.entries(args.variables)) {
      parts.push(`--var ${shellQuote(`${k}=${v}`)}`);
    }
  }
  return parts.join(" ");
}
```

Pure, no I/O — easy to snapshot-test inline. `shellQuote()` always quotes (single-quote style identical to `tool.ts:23-25`) — uniform quoting is simpler than a "needs quoting?" heuristic and the cost is two extra characters on values that didn't need it. Round-trips through `bash`/`zsh`/`sh` identically.

### 3.3 The `shellQuote` shared helper

Existing private helper at `src/attractor/handlers/tool.ts:23-25`:

```ts
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
```

Already in use at `tool.ts:97-98` for script-file interpreter invocation. Extract to `src/cli/lib/shell-quote.ts` (one-line module: `export { shellQuote }`), import from both `failure-handoff.ts` and `tool.ts`. Single source of truth for shell-quoting across the CLI.

Alternative considered: inline a second copy inside `failure-handoff.ts`. Rejected because the two call sites need to agree on quoting semantics (script-file `script_args` is the closest analog to recipe `--var` values — both are user-supplied strings that may contain shell metacharacters). Two copies drift; one helper does not.

### 3.4 Threading through `LoadFailureHandoffArgs`

`src/cli/lib/failure-handoff.ts:56-67`, additive only:

```ts
export interface LoadFailureHandoffArgs {
  tracePath: string;
  failedNodeId: string;
  failureReason: string;
  dotFile: string;
  dotDir: string;
  runId: string;
  graph: Graph;
  /** Optional: forwards `--project <folder>` into the printed resume command. */
  project?: string;
  /** Optional: forwards `--var k=v` pairs into the printed resume command. */
  variables?: Record<string, string>;
}
```

Optional fields preserve every existing test — they default to `undefined`, the helper short-circuits, and the rendered footer is byte-for-byte identical to today's output. Zero external importers (verified by the verifier subagent) so this is non-breaking by construction.

Caller update at `src/cli/commands/pipeline/run.ts:391-399`:

```ts
handoff = loadFailureHandoff({
  tracePath,
  failedNodeId: lastFailedNodeId,
  failureReason: lastFailureReason ?? "pipeline failed",
  dotFile,
  dotDir,
  runId,
  graph,
  project: opts.project,
  variables: opts.variables,
});
```

`opts.project` is `string | undefined` and `opts.variables` is `Record<string, string> | undefined` (verified at `run.ts:38`).

### 3.5 The `inspect:` audit

`src/cli/lib/failure-handoff.ts:48` builds:

```ts
`inspect: apparat pipeline trace ${h.runId} --node-receive ${h.nodeReceiveId} --full`
```

`pipeline trace` does not bind `$project` and does not consume `--var` — verified by reading `src/cli/commands/pipeline/trace.ts` (no preflight, no project resolution). The line is complete. The audit is a one-line confirmation in this design and a one-line comment in the implementation; no code change.

## 4. Data flow

```
user types: apparat pipeline run <dot> --project . --var steer="focus on auth"
                       │
                       ▼
         opts: { project: ".", variables: { steer: "focus on auth" } }   ← run.ts:38
                       │
                       ▼
       pipeline executes, fails at <node>
                       │
                       ▼
  loadFailureHandoff({ ..., project: opts.project, variables: opts.variables })   ← run.ts:391
                       │
                       ▼
   FailureHandoff.resumeCommand = buildResumeCommand({ dotFile, runId, project, variables })
                       │
                       ▼
   renderFailureFooter(h) → "resume: apparat pipeline run <dot> --resume <runId> --project '.' --var 'steer=focus on auth'"
                       │
                       ▼
            stderr  ─┬─→  human pastes verbatim  →  preflight passes
                     │
                     └─→  Ink frame mirrors same line (PipelineRunView.tsx:269-270 already renders `h.resumeCommand`)
```

The Ink fail frame renders `h.resumeCommand` verbatim (`src/cli/components/PipelineRunView.tsx:269-270`) — once the field is correct in the source-of-truth, the TUI and stderr footer agree by construction.

## 5. Components

| Component | Path | Change |
| --- | --- | --- |
| `LoadFailureHandoffArgs` | `src/cli/lib/failure-handoff.ts:56-67` | Add optional `project`, `variables` fields |
| `loadFailureHandoff` | `src/cli/lib/failure-handoff.ts:82` | Read new args, forward to `buildResumeCommand` |
| Inline template | `src/cli/lib/failure-handoff.ts:86` | Replace with `buildResumeCommand({...})` call |
| `buildResumeCommand` (new) | `src/cli/lib/failure-handoff.ts` (new export) | Pure helper, joins flags |
| `shellQuote` | `src/attractor/handlers/tool.ts:23-25` | Extract to `src/cli/lib/shell-quote.ts`, import from both sites |
| Caller | `src/cli/commands/pipeline/run.ts:391-399` | Pass `opts.project`, `opts.variables` through |
| `BuildResumeCommandArgs` (new) | `src/cli/lib/failure-handoff.ts` (new export) | Type for helper input |

Type-only consumers (no logic change, may need to re-typecheck after the interface gains fields):

- `src/cli/components/PipelineRunView.tsx:10,38` — imports `FailureHandoff` type
- `src/cli/lib/pipelineEvents.ts` — imports `FailureHandoff` type
- `src/cli/lib/pipelineReducer.ts` — imports `FailureHandoff` type

`FailureHandoff` itself does not change shape (`resumeCommand: string` is still a single string). Only the *upstream input* surface (`LoadFailureHandoffArgs`) grows.

## 6. Constraints

- **Backwards compatibility.** New fields on `LoadFailureHandoffArgs` are optional. Zero external importers (`grep` confirms `LoadFailureHandoffArgs` is only referenced inside `failure-handoff.ts` and `run.ts`). When both fields are absent, `buildResumeCommand` produces the same string as the current template — byte-for-byte.
- **Argument order stability.** `--resume` before `--project` before `--var` pairs, `--var` pairs in `Record<string, string>` insertion order. Test fixtures pin this order so reviewers can read diffs.
- **Quoting must round-trip through `bash`/`zsh`/`sh`.** Always-quote keeps the rule trivial: `'${value.replace(/'/g, "'\\''")}'`. No conditional logic. Identical to the `tool.ts` precedent.
- **No I/O in `buildResumeCommand`.** Pure function, no file reads, no env lookups. Trivially snapshot-testable.
- **`loadFailureHandoff` keeps its "never throws" contract.** Adding optional input fields cannot introduce new throw paths.

## 7. Testing

New test cases in `src/cli/tests/failure-handoff.test.ts`:

1. **No flags** — `project: undefined, variables: undefined` → output identical to current behaviour. Locks backwards compatibility.
2. **Project only** — `project: "."` → `... --resume <runId> --project '.'`. Mirrors the parallel-impl incident.
3. **Variables only** — `variables: { lens: "tests" }` → `... --resume <runId> --var 'lens=tests'`. No `--project` clause.
4. **Both** — `project: "."`, `variables: { steer: "focus on auth", lens: "tests" }` → `... --project '.' --var 'steer=focus on auth' --var 'lens=tests'`. Pins order and quoting.
5. **Quoting edge cases** — values containing single quotes, double quotes, `$`, backticks, spaces. Asserts the helper escapes single quotes via the `'\''` pattern.
6. **Empty record** — `variables: {}` → no `--var` clause emitted (distinct from `undefined`, same outcome).

Existing tests that may need refreshing because they assert footer shape:

- `src/cli/tests/failure-handoff.test.ts` — pre-existing tests should keep passing untouched (they don't pass `project`/`variables`).
- `src/cli/tests/pipeline-app-integration.test.tsx:122` — asserts `FailureHandoff` shape into the Ink frame; the `resumeCommand` string changes only when fixtures opt-in by passing `project` or `variables`. Audit, refresh if it pins a specific resume string.
- `src/cli/tests/pipeline-failure-footer-scenario.test.ts` — scenario-style end-to-end. Audit, refresh if it asserts the resume line literally.
- `src/cli/tests/pipeline-failure-reason.test.ts:70` — was already updated by the May-09 footer work. Audit, refresh if its fixture now passes `--project`.

`shellQuote` shared helper: unit test in `src/cli/tests/shell-quote.test.ts` (new) covering the same edge cases as test 5 above, so the helper has independent coverage from `buildResumeCommand`. Optional but cheap.

## 8. Blast radius / impact surface

- **Size:** S/M, ~8 files.
- **Surfaces crossed:** CLI library + CLI command + tests + docs. No engine, no agents, no daemon, no Ink frame logic.
- **Breaking change:** none. New fields on `LoadFailureHandoffArgs` are optional; zero external importers (verified). `FailureHandoff.resumeCommand` remains `string`. `shellQuote` extraction preserves the existing signature; the `tool.ts` call sites just swap their import.
- **Files touched:**
  - **Primary edit (1):** `src/cli/lib/failure-handoff.ts` — interface, helper, threading.
  - **Caller (1):** `src/cli/commands/pipeline/run.ts:391-399` — pass two more fields.
  - **Shared helper extraction (1 new + 1 edit):** `src/cli/lib/shell-quote.ts` (new), `src/attractor/handlers/tool.ts:23-25` (replace local fn with import).
  - **Type-only ripple (2 — recheck, no logic change):** `src/cli/components/PipelineRunView.tsx`, `src/cli/lib/pipelineEvents.ts`.
  - **Tests (4 to audit / refresh):** `src/cli/tests/failure-handoff.test.ts`, `src/cli/tests/pipeline-app-integration.test.tsx:122`, `src/cli/tests/pipeline-failure-footer-scenario.test.ts`, `src/cli/tests/pipeline-failure-reason.test.ts:70`. Plus optional new `src/cli/tests/shell-quote.test.ts`.
- **Spec / docs ripple (additive only):**
  - `README.md:79` — one-sentence cross-link confirming the resume line includes caller flags.
  - `docs/superpowers/specs/2026-05-09-pipeline-failure-handoff-is-shallow-design.md` — predecessor design. Lines 70, 214, 265, 318, 340, 483, 529 reference the resume command shape; flagged by the verifier as additive-only ripple (note the new fields, no rewrite).
- **ADR ripple:** none new. The change is on-trajectory for ADR-0008 (partition principle) and commit `93eadd6` (record `--project` in `~/.apparat/projects.json`) — both invest in `--project` as a first-class concept.
- **Migration / data:** none. Pure presentation change.

## 9. Open questions

1. **Should `shellQuote` live at `src/cli/lib/shell-quote.ts` (new file) or be inlined inside `failure-handoff.ts` with a re-export?** Recommendation: own file. Two consumers today (`failure-handoff.ts`, `tool.ts`); cheap to keep a one-symbol module. Reviewer: confirm or counter.
2. **Should `variables: {}` (empty record) emit no `--var` clauses (current proposal) or render an explicit empty marker?** Recommendation: no `--var` clauses — distinct from `undefined` at the type level but identical on the command line. Reviewer: confirm.
3. **Do we want a future "include all engine-resolved variables" mode for the resume line?** Out of scope here; flagged for completeness because the May-09 spec also rejected scope creep into trace-side concerns. Engine-resolved variables are recoverable from the JSONL trace, not from `opts.variables`. Defer until a real use case appears.
