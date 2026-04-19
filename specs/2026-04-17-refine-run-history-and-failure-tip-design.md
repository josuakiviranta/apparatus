# Refine Iteration Loop — Post-Failure Tip Design

**Date:** 2026-04-17
**Status:** Approved (scoped)
**Source illumination:** `meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md`

## Overview

`ralph pipeline refine` converted pipeline authoring from a one-shot creation event into a repeatable, agent-assisted iteration loop. The source illumination proposed four follow-ups. Verification against the current codebase found three of them already shipped; this spec narrows to the **one remaining gap**: after a failed `ralph pipeline run`, nothing tells the developer that `refine` exists.

Closing this gap is a single-line stdout addition in `pipelineRunCommand`. No new helper, no new config, no new bundled prompt. Small, self-contained, ships as one PR.

## What Already Shipped (and is therefore out of scope)

The illumination's verification pass and a follow-up code review established the following already exist in `main`:

1. **Two-phase Claude session extracted.** `runTwoPhaseClaudeSession()` lives at `src/cli/lib/session.ts:114` and is called by both `pipelineCreateCommand` and `pipelineRefineCommand`. No duplication remains. (Illumination item #1.)
2. **Recent run traces injected into the refine trigger.** `pipelineRefineCommand` (`src/cli/commands/pipeline.ts:679-689`) composes a `traceBlock` using `listRecentTraces(name, REFINE_TRACE_COUNT, { tracesRoot })` (line 442) and `digestTraceFile()` (line 468), prepended to `refineFraming` before the graph block. Gated by `opts.traces !== false`. (Illumination item #2.)
3. **Edge-label diff after refine.** `diffEdgeLabels()` (`pipeline.ts:~99-104` inside `pipelineValidateCommand`) runs automatically when `pipelineRefineCommand` passes `previousGraph` (line 720). Silent label renames produce validator errors. (Illumination item #3.)

This spec does **not** re-design any of the above. References are included only so the plan authored from this spec avoids re-implementing solved work.

## The Remaining Gap

Today a developer whose pipeline ends in failure sees the failure outcome printed by the Ink pipeline renderer and then the process exits non-zero. There is no pointer toward `ralph pipeline refine`. Discovery of the iteration loop depends on the developer already knowing `refine` exists — exactly the wrong discoverability model for the command that makes the loop useful.

The failure moment is the one moment the developer is already asking "what should I change about this pipeline?" A single line at that moment routes them into the agent-assisted loop.

## Architecture

### Current state

- `pipelineRunCommand` (`src/cli/commands/pipeline.ts:115`) is the single entry point for `ralph pipeline run`. It returns `Promise<void>` — it does NOT return an exit code. The caller (`src/cli/program.ts:168-174`) simply awaits it.
- Two categories of failure occur:
  - **Pre-engine guards.** Four sites call `process.exit(1)` directly before the engine starts:
    - Line ~122: dot file does not exist.
    - Line ~130: `validateOrRaise(graph)` throws (invalid/unparsable DOT).
    - Line ~145: declared `inputs=` missing from caller-supplied vars.
    - Line ~169: `headless_safe=false` pipeline invoked without a TTY.
  - **Engine failure.** `runPipeline(...)` resolves with `result.status !== "success"`. The renderer has already painted a `fail` outcome (lines ~376-382). The function then falls through `finally` and returns normally. No `process.exit` is called for engine failure; the CLI terminates with exit code 0 by default.

The implication: the user's experience of "failure" comes from the renderer's paint + stderr text, not from the process exit code. Any tip must therefore hook the *user-visible* failure, not a non-zero exit.

### Target state

Introduce a module-private helper `printRefineTip(invokedAs: string)` and call it at every point where the user has just seen a failure, before the process detaches the terminal:

```
Tip: ralph pipeline refine <name> to improve this pipeline with agent assistance.
```

Call sites:

1. **Line ~130** (invalid DOT) — emit tip. A broken DOT is the canonical reason a user would want agent-assisted editing. Call before `process.exit(1)`.
2. **Line ~145** (missing `inputs=`) — emit tip. Missing declared inputs often signal a graph whose author-contract has drifted; refine is a reasonable next step. Call before `process.exit(1)`.
3. **Line ~169** (headless-safe rejection without TTY) — emit tip. User is interactively running a CLI; pointing at refine is appropriate. Call before `process.exit(1)`.
4. **Engine failure path** — after `runPipeline` resolves but before `done()` / `waitUntilExit()`, if `result.status !== "success"`, emit tip. Must run *after* the Ink app unmounts so the plain-text line appears below the final painted frame, not inside its live region. Concretely: set a boolean `pipelineFailed = result.status !== "success"` inside the `try` block, then in the `finally` (after `await waitUntilExit()`), emit the tip if `pipelineFailed`.

Explicit non-call-sites:

- **Line ~122** (file not found) — do NOT emit the tip. `ralph pipeline refine <nonexistent>` is not a useful next step; refine requires the file to exist. Keep the existing error as-is.
- **Exit 0** — do NOT emit the tip under any condition. Engine success means no user-visible failure happened.

No TTY gate, no `--no-tips` flag, no config knob. YAGNI.

### Philosophy alignment

The change is purely at the human-feedback surface. The pipeline engine is unchanged. "Everything is a pipeline" is unchanged. No new command, no new bundled prompt, no new data written to disk.

## Components

### 1. Shared tip emitter

**Location:** `src/cli/commands/pipeline.ts`, private to the module.

**Shape:** a tiny helper so all failure paths funnel through one line.

```ts
function printRefineTip(invokedAs: string): void {
  const name = refineNameFromInvocation(invokedAs);
  // Plain stdout; no color codes, no Ink, no error stream.
  console.log(`Tip: ralph pipeline refine ${name} to improve this pipeline with agent assistance.`);
}
```

`refineNameFromInvocation(invokedAs)` rule is exact:

- If `isNameShorthand(invokedAs)` returns `true` (reuse the existing helper from `src/cli/lib/pipeline-resolver.ts:8`), return `invokedAs` unchanged.
- Otherwise, return `basename(invokedAs, ".dot")`.

No other branches. Copy-pasting the tip must always produce a valid `ralph pipeline refine` command.

### 2. Wire-up at the four failure sites

The helper is called at four explicit sites inside `pipelineRunCommand`:

| Site | Condition | Before what |
|---|---|---|
| a | line ~130 `catch` after `validateOrRaise` throws | `process.exit(1)` |
| b | line ~145 `inputs=` missing | `process.exit(1)` |
| c | line ~169 headless-safe + no TTY | `process.exit(1)` |
| d | after `runPipeline(...)` resolves, if `result.status !== "success"` | inside `finally`, after `await waitUntilExit()`, before function returns |

Site (d) requires hoisting a local boolean (e.g. `let pipelineFailed = false;`) scoped to the `try`/`finally`. Inside the `try`, after `result` resolves (around line 376 where the existing `if (result.status !== "success" && …)` check lives), set the flag. In the `finally`, after the existing cleanup, call `if (pipelineFailed) printRefineTip(dotFile);`.

No call at line ~122 (file-not-found): the invocation target does not exist, so refine cannot run against it.

### 3. Tests

Three unit-level assertions on stdout:

- **Missing-inputs failure** (exercises site b): run a pipeline whose `.dot` declares `inputs=[foo]` without providing `foo` → expect exit 1 and stdout contains `Tip: ralph pipeline refine <name> ...`.
- **Headless-safe rejection** (exercises site c): run a pipeline with `headless_safe=false` under non-TTY stdin → expect exit 1 and stdout contains the tip.
- **Success path**: run the existing passing fixture used elsewhere in `src/cli/tests/pipeline.test.ts` → stdout must NOT contain `Tip:`.
- **File-not-found**: run with a non-existent path → expect exit 1 and stdout does NOT contain the tip.

Engine-failure (site d) is the hardest to unit-test because the renderer is Ink-driven. If the existing test harness already covers an engine-fail scenario (see `pipeline.test.ts`), extend it with a single stdout assertion. Otherwise deferring this assertion to tmux-harness smoke coverage (per `docs/harness/tmux-drive.md`) is acceptable — explicitly noted here so the plan author makes the call.

A dedicated `refineNameFromInvocation` unit test is optional; the above tests cover both shorthand and path cases through their fixtures.

## Data Flow

```
ralph pipeline run <name-or-path>
        │
        ▼
file exists?
   ├── no  → error + exit 1  (NO tip — refine needs an existing file)
   └── yes
        │
        ▼
validateOrRaise
   ├── throws → error + printRefineTip + exit 1
   └── ok
        │
        ▼
preflight caller vars
   ├── missing declared inputs → error + printRefineTip + exit 1
   └── ok
        │
        ▼
headless_safe + TTY gate
   ├── rejected → error + printRefineTip + exit 1
   └── ok
        │
        ▼
runPipeline (Ink renderer paints)
        │
        ├── result.status === "success"
        │        └── finally { waitUntilExit } → return (NO tip)
        │
        └── result.status !== "success"
                 └── set pipelineFailed = true
                     finally { waitUntilExit; if (pipelineFailed) printRefineTip } → return
```

## Constraints

- **Single-line output.** Plain stdout, no ANSI, no Ink integration. The Ink live region has already unmounted by the time the tip is printed.
- **Only on failure.** Exit 0 prints nothing new.
- **Skip tip when target doesn't exist.** If the dot file was never found, refining it is impossible; suppressing the tip avoids misleading advice.
- **Name resolution mirrors the user's invocation.** Copy-paste must produce a valid `ralph pipeline refine` command.
- **No new files, no new helpers outside `pipeline.ts`.** Keeps the diff trivial and review surface small.
- **No interaction with tracer, JSONL, or trace paths.** Run-history injection is already shipped; this change does not touch it.
- **No changes to bundled prompts.** `PROMPT_pipeline_create.md` and friends are unchanged.
- **Gate.** `npm run build && npm test` green before handoff.

## What This Excludes

- **Auto-invoking `refine` on failure.** The tip points at the command; it does not run it. Agent sessions are consequential; user intent gates the loop.
- **TTY gating / `--no-tips` flag.** YAGNI until real evidence of noise complaints appears.
- **Styling the tip with color or icons.** Intentionally plain — scriptable consumers already have the pipeline tracer for structured data.
- **Anything involving `pipelineRefineCommand` itself.** Every proposed enhancement to refine from the source illumination is already shipped. This spec is only about the *discoverability* of the existing command from `run`.
- **Restructuring `pipelineRunCommand` exit paths.** The helper is added at existing exit sites, not used as an excuse to refactor them.
