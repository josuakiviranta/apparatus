---
date: 2026-05-01
description: pipelineRunCommand is a 348-line monolith with a 5-variable mutable signal-handler closure that makes abort semantics impossible to reason about in isolation.
---

## Findings

1. **What:** `pipelineRunCommand` in `src/cli/commands/pipeline.ts:237` is a 348-line async function conflating path resolution, preflight checks, run-dir GC, TUI setup, signal handling, engine invocation, and post-run cleanup — none of which share data in a way that justifies co-location.

   **Evidence:** The function body spans lines 237–584. Within it, the signal-handling cluster declares five interdependent mutable variables in a row:

   ```ts
   // src/cli/commands/pipeline.ts:326-333
   let currentBlockNodeId: string | null = null;
   let abortHandledFor: string | null = null;
   let interactiveResolve: (() => void) | null = null;
   let markInteractiveAbort: (() => void) | null = null;
   let killInteractiveChild: (() => void) | null = null;
   ```

   `onSignal` (lines 334–348) closes over all five. The `onInteractiveRequest` callback (lines 399–450) mutates three of them. `onNodeEnd` (lines 467–484) reads and resets `abortHandledFor` and `currentBlockNodeId`. A reader must hold all five in mind simultaneously to understand what happens when C-c arrives mid-interactive-session vs. mid-agent-node — yet these are spread across ~150 lines of intervening code.

   **Why it matters (KISS lens):** The five closure variables form an implicit state machine with no type, no name, and no transition diagram. Every future change to abort semantics (e.g. adding a third signal type, or a second interactive node) requires tracing all five variables across 150 lines of callbacks. The function also owns run-dir GC logic, TUI mounting, engine invocation, and process.exit — unrelated concerns that obscure the control flow.

   **Suggested action:** Extract the signal-handling cluster into a `createAbortController(emit, ac)` helper that returns `{ onSignal, setCurrentNode, setInteractiveHandles }` — hiding the five variables behind a typed interface. Separately, extract `buildEngineCallbacks(graph, callbacks, project)` that assembles the 9-callback options object (lines 375–552) and returns it, making `pipelineRunCommand` itself a ~50-line orchestrator.

2. **What:** `pipeline.ts` also accumulates utilities with no command-level consumer: `deriveProjectKey` (line 54), `resolveResumeLogsRoot` (line 69), `gcOldRuns` (line 109), `maybePrintLayoutV2Notice` (line 131), `diffEdgeLabels` (line 148), `findRunAcrossProjects` (line 644), `listAllProjectRunsRoots` (line 629). Each is exported and tested independently, but they all live in the command module rather than a purpose-built `lib/pipeline-runs.ts`.

   **Evidence:**
   ```ts
   // src/cli/commands/pipeline.ts:54
   export function deriveProjectKey(projectPath: string): string {
   // src/cli/commands/pipeline.ts:109
   export function gcOldRuns(runsRoot: string, keep: number): void {
   // src/cli/commands/pipeline.ts:629
   function listAllProjectRunsRoots(): string[] {
   ```

   **Why it matters (KISS lens):** The command module is 854 lines because run-dir management utilities were never extracted. Future authors look in `commands/pipeline.ts` to understand "how does a command work" but instead encounter a util library.

   **Suggested action:** Move `deriveProjectKey`, `resolveResumeLogsRoot`, `gcOldRuns`, `maybePrintLayoutV2Notice`, `listAllProjectRunsRoots`, `findRunAcrossProjects` to `src/cli/lib/pipeline-runs.ts`. Update the two test files that import them.

## Reading thread

- `2026-05-01T0120-janitor-graph-validator-bloat.md` — covers bloat in `graph.ts`; complementary (validator bloat vs. command bloat — different files, same pattern of one file doing too much).
- `2026-05-01T0211-pipeline-lifecycle-cli-surface-gap.md` — covers missing `pipeline create` surface inside `pipeline.ts`; related context but distinct issue (dead command vs. monolithic run function).
- `2026-05-01T0212-janitor-dead-two-phase-fn.md` — covers dead exports in `session.ts`; complementary (dead code vs. live-but-oversized code).
