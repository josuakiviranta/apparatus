# Refine Authoring Loop Design

**Date:** 2026-04-17
**Status:** Approved
**Source illumination:** `meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md`

## Overview

`ralph pipeline refine` shipped in 2026-04-16 with the mechanics of a second authoring command, but it quietly changed the authoring model: pipeline authoring is no longer a single green-field event, it is a repeatable iteration loop over an artifact that lives in the project tree. Four follow-ups make that loop first-class:

1. **Extract `runTwoPhaseClaudeSession` into `src/cli/lib/session.ts`.** The two-phase pattern (non-interactive stream-json run to capture session id, then `spawnSync --resume` for interactive handoff) is currently triplicated across `plan.ts`, `pipelineCreateCommand`, and `pipelineRefineCommand`. The rule of three triggers extraction.
2. **Inject a digest of recent pipeline run traces into the refine trigger.** Refine today sees the `.dot` graph verbatim but nothing about how that graph has been executing. The most common reason to refine is failure; feeding the last N run traces into the session makes the agent a debugging collaborator, not just a DOT editor.
3. **Add a graph-diff edge-label check to `pipelineValidateCommand`.** The refine trigger asks the agent to "preserve node IDs and edge labels that the user does not explicitly want changed." That instruction is policy-in-prose. A post-refine structural comparison turns it into enforceable policy.
4. **Surface `ralph pipeline refine` as a post-failure suggestion in `pipelineRunCommand`.** When a run exits non-zero, the next step is almost always to inspect and iterate. A tip pointing at `refine <name>` — emitted only on failure — closes the run → refine → run loop in the UI layer.

Each proposal is independent. They can ship as four separate PRs in any order. Their combined effect is to make the refine loop legible at every layer: the authoring code (#1), the agent's context (#2), the validator (#3), and the runner's output (#4).

## Architecture

### Current state

The refine command exists and works. `composeCreatePrompt(project)` is shared between `pipelineCreateCommand` and `pipelineRefineCommand`, so both see project-local agents and the same 11-node-type scheme. The preserve-labels constraint is hard-coded in the refine trigger at `src/cli/commands/pipeline.ts:602–603`. Validation is already invoked after a clean refine session. Two-phase Claude session orchestration is duplicated in three commands with nearly identical bodies.

### Target state

- A single `runTwoPhaseClaudeSession()` helper in `src/cli/lib/session.ts` is the only place that knows how to run the kickoff → resume pattern. `plan.ts`, `pipelineCreateCommand`, and `pipelineRefineCommand` each reduce to "build trigger, call helper, handle result."
- `pipelineRefineCommand` reads the N most recent run traces for the target pipeline, digests them through `buildSessionDigest()` (already in `src/cli/lib/session.ts`), and prepends that digest to the refine trigger under a clearly labeled "Recent run traces" block.
- `pipelineValidateCommand` accepts an optional previous-graph input. When supplied, it diffs edge labels between previous and current and reports any label that was silently renamed on an edge whose `from`/`to` nodes are unchanged. The refine flow captures the pre-session graph and passes it in; direct `ralph pipeline validate` invocations skip the diff.
- `pipelineRunCommand` prints `Tip: ralph pipeline refine <name>` on failure exit paths, alongside the existing failure output. Success paths are unchanged.

### Philosophy alignment

All four changes live at the authoring meta-layer — they make authoring better. They do not introduce a competing execution model. "Everything is a pipeline" stays intact at runtime; the refine loop is the human-facing workflow that produces and maintains those pipelines.

## Components

### 1. `runTwoPhaseClaudeSession` helper (new in `src/cli/lib/session.ts`)

`src/cli/lib/session.ts` already exists and currently exports type definitions plus `buildSessionDigest()`. Extend it — do not create a new file.

Signature:

```ts
export interface TwoPhaseSessionOptions {
  cwd: string;
  systemPromptPath: string;
  trigger: string;
  output: OutputAdapter;
  onSessionId?: (sessionId: string) => void;
  signal?: AbortSignal;
}

export interface TwoPhaseSessionResult {
  sessionId: string | null;
  exitCode: number;
  interrupted: boolean;
}

export async function runTwoPhaseClaudeSession(
  opts: TwoPhaseSessionOptions,
): Promise<TwoPhaseSessionResult>;
```

Responsibilities:

- Phase 1: spawn `claude -p --system-prompt-file <path> --output-format stream-json --append-system-prompt … <trigger>` non-interactively, parse `session_id` from the first `system` event, surface the id via `onSessionId`, wait for phase-1 completion.
- Phase 2: `spawnSync('claude', ['--resume', sessionId], { stdio: 'inherit', cwd })` for the interactive handoff.
- Signal handling: translate SIGINT into `interrupted: true` and a non-zero exit code.
- No knowledge of pipeline schemas, no validation, no file I/O beyond what `claude` itself does. The three callers stay responsible for pre/post work.

Migration steps (per caller):

- `plan.ts`: replace inline two-phase body with `runTwoPhaseClaudeSession()`; keep plan-specific trigger composition.
- `pipelineCreateCommand`: same.
- `pipelineRefineCommand`: same.

Tests: unit-test the helper with a stubbed spawn (confirm phase-2 is skipped when phase-1 fails, session id propagates, SIGINT path works). Existing scenario tests for `plan`/`pipeline create`/`pipeline refine` continue to exercise it end-to-end.

### 2. Run-trace injection into refine trigger (`src/cli/commands/pipeline.ts`)

The refine trigger gains a new optional block, inserted **before** the current `Here is the current pipeline workflow …` block:

```
Recent run traces for <name>:

<digested trace 1>

<digested trace 2>

---

Here is the current pipeline workflow at <relative-path>:
…
```

Trace source: the existing pipeline trace directory (see `pipelineTraceCommand` for the canonical location). The refine command:

1. Lists trace files for `<name>`, newest first.
2. Takes up to `REFINE_TRACE_COUNT` (constant, default 3) most recent traces.
3. Passes each through `buildSessionDigest()` so the refine trigger stays compact (token-efficient and reviewable).
4. Skips the block entirely when no traces exist (first refine after `create`).

A `--no-traces` flag on `refine` lets the user suppress injection for cases where recent traces are noise (e.g., experimenting with a half-written pipeline). Default is traces-on.

The "preserve node IDs and edge labels" constraint text stays exactly where it is at `pipeline.ts:602–603`. Run traces inform the agent; the preservation rule constrains it.

### 3. Edge-label diff in `pipelineValidateCommand` (`src/cli/commands/pipeline.ts`)

Extend `pipelineValidateCommand` to accept an optional `previousGraph` argument (the pre-edit graph object, not a path). When supplied, after normal schema validation, walk both graphs' edge sets and emit a diagnostic for any edge where:

- `from` and `to` nodes are unchanged between previous and current graphs (same node ids, same in-graph identity), AND
- the edge label text differs.

Diagnostic classification: **warning** by default, **error** when the previous label is referenced elsewhere in the graph (e.g., as a condition target). The warning names both labels and cites the rule: "Edge labels are routing keys; silent renames break downstream handlers."

Refine flow integration:

- Before launching the session, `pipelineRefineCommand` reads and parses the current `.dot` into a `Graph` object — call this `previousGraph`.
- After a clean session exit, it re-reads the (possibly-modified) file, parses it, and calls `pipelineValidateCommand` with `{ previousGraph }` alongside the usual path.
- Direct `ralph pipeline validate <path>` callers still work unchanged; the diff only runs when `previousGraph` is provided.

Tests: unit tests for the diff checker covering label rename with stable topology, label rename with changed topology (should not fire), added edges, removed edges, and first-refine cases where the graph was previously absent.

### 4. Post-failure refine tip in `pipelineRunCommand` (`src/cli/commands/pipeline.ts`)

On every non-zero exit path of `pipelineRunCommand`, append a tip to the existing failure output:

```
Tip: ralph pipeline refine <name>   # edit this pipeline with agent assistance
```

Implementation:

- Tip emission lives inside `pipelineRunCommand` itself — not in a generic error handler — so it only surfaces for pipeline runs, not for unrelated commands that happen to exit non-zero.
- `<name>` is the same name used to invoke `pipeline run`; path forms resolve back through the shared name-resolution helper already used elsewhere.
- The tip is suppressed when output is not a TTY (e.g., CI, piped output) to avoid polluting machine-readable logs.
- A `--no-tips` flag on `pipeline run` provides an explicit opt-out for human TTY sessions that prefer clean output.

Tests: scenario test that forces a pipeline failure and asserts the tip appears on TTY, does not appear under `FORCE_COLOR=0` + non-TTY simulation.

## Data Flow

### Refine loop after all four changes

```
ralph pipeline refine <name> --project <folder>
        │
        ▼
resolveDotPath(name, project)  ──► <project>/pipelines/<name>.dot
        │
        ▼
readFileSync + parse  ──►  previousGraph
        │
        ▼
listRecentTraces(name, REFINE_TRACE_COUNT)
        │
        ▼
traceBlock = traces.map(buildSessionDigest).join("\n\n")
        │
        ▼
trigger = renderRefineTrigger({
  traceBlock,               // new
  relativePath,
  dotPath,
  existingContent,
})
        │
        ▼
runTwoPhaseClaudeSession({ cwd: project, systemPromptPath, trigger })   ◄── extracted helper
        │
        ├── SIGINT / non-zero ─► exit same status
        │
        ▼ clean exit
re-read file, re-parse  ──►  currentGraph
        │
        ▼
pipelineValidateCommand(dotPath, { previousGraph })   ◄── new diff branch
        │
        ▼
exit with validation status
```

### Run loop with failure tip

```
ralph pipeline run <name>
        │
        ▼
execute pipeline
        │
        ├── success ─► exit 0, no tip
        │
        ▼ failure
print existing failure output
        │
        ▼
isTTY && !--no-tips ?  ──yes──►  print "Tip: ralph pipeline refine <name>"
        │
        ▼
exit non-zero
```

## Constraints

- **Four independent PRs, any order.** None of the four changes depends on another shipping first. Each is a small, atomic improvement to the authoring loop. Bundling them would delay value without reducing risk.
- **Extract, don't create.** `src/cli/lib/session.ts` already exists with `buildSessionDigest()` and type definitions. `runTwoPhaseClaudeSession` extends that file; it does not spawn a new one. Co-locating session helpers keeps the authoring pipeline's touchpoints discoverable.
- **Preserve-labels prompt text stays.** The text at `src/cli/commands/pipeline.ts:602–603` is not removed once the edge-label diff lands. Prompt-level guidance and validator-level enforcement are complementary, not redundant: the prompt shapes agent behavior during the session; the diff catches violations after.
- **Digests, not raw traces.** Run-trace injection uses `buildSessionDigest()` output, not raw trace content. Raw traces can run tens of thousands of tokens; digests are designed for cache-friendly prompt inclusion and are already the canonical compact form.
- **Traces are opt-out, tips are opt-out, diff is opt-in (via caller).** Refine with traces and run-failure tips are defaulted on because they help the common case. The validator's edge-label diff is opt-in at the API level (caller supplies `previousGraph`) because direct `pipeline validate` invocations have no "previous" to compare against.
- **No new bundled prompts.** The refine trigger composition changes in code only. `PROMPT_pipeline_create.md` is unchanged. Bundled prompts remain the authoring scheme; code owns the per-invocation framing.
- **Audience split shapes the documentation.**
  - #1 (helper extraction) and #3 (edge-label diff) are internal changes with no user-facing surface — no README update needed, only inline doc comments.
  - #2 (trace injection) is agent-facing — the behavior is visible in session output; document briefly in the refine section of `README.md` and in `PROMPT_pipeline_create.md` commentary if the trigger format changes meaningfully.
  - #4 (post-failure tip) is user-facing — add a note to the `pipeline run` section of `README.md`.
- **No git operations introduced.** None of the four changes stages, commits, or pushes anything. Working-tree hygiene remains the user's responsibility, same as the existing refine/create behavior.
- **TTY-safe UX changes.** The failure tip respects `isTTY` and a `--no-tips` opt-out. The goal is ergonomics for interactive users, not noise in automated pipelines.

## What This Excludes

- **A new `pipeline iterate` or `pipeline edit` command.** Refine already covers the iteration loop. Another verb would fragment discoverability. If a non-interactive edit mode is ever needed, it should be a flag on `refine`, not a sibling command.
- **Automatic refine invocation on failure.** The tip points at the command; it does not execute it. Running a Claude session is a consequential, multi-minute operation; automating it on every failure would be hostile. User intent gates the loop.
- **Cross-pipeline trace injection.** Trace digests in refine are scoped to the pipeline being refined. Traces from other pipelines are never injected, even when they share nodes. Refine is a single-graph operation and the trigger should reflect that.
- **Structural diff beyond edge labels.** Node additions, removals, and renames are out of scope for the #3 diff. Only edge-label renames on otherwise-stable edges are checked, because that is the specific class of silent-break failure the preserve-labels rule is designed to prevent. Broader structural auditing can be layered on later if a real need emerges.
- **Persisting the "previous graph" across sessions.** The diff compares the pre-session graph captured in memory during a single refine invocation against the post-session graph. It does not consult git history, does not maintain a sidecar record, and does not know about branches. In-process capture is the simplest correct thing.
- **Changing the two-phase mechanism itself.** #1 is a pure extraction — same spawn calls, same stdio plumbing, same resume flow. If the mechanism later migrates (e.g., to a single `claude --handoff` call when one exists), the helper is the single place to update, which is precisely the point of extracting it.
