# Pipeline Observability Implementation Plan

**Goal:** Make `ralph pipeline run` show live output — which node is running, what Claude is doing, and a persistent sticky status bar at the bottom of the terminal throughout the run.

**Status:** ✅ COMPLETE (all 3 chunks implemented and tested, 408 tests passing)

---

## Summary of Changes

### Chunk 1: Engine + AgentHandler Hooks ✅

**Task 1:** Added `onNodeStart` and `onStdout` callbacks to `EngineOptions` in `engine.ts`.
- `onNodeStart?(node)` is called before each handler dispatch (exit nodes are processed before handler dispatch, so they don't trigger this callback)
- `onStdout` is threaded through to handlers via the meta object

**Task 2:** `AgentHandler` reads `meta.onStdout` and `node.interactive` from meta/node.
- `onStdout` is forwarded to `agent.run()` for non-interactive nodes
- `interactive: true` is passed to `agent.run()` when `node.interactive === "true"` (DOT attributes are strings)
- Interactive nodes suppress `onStdout` since they use `stdio: "inherit"`

### Chunk 2: PipelineDisplay Component ✅

Created `PipelineDisplay.tsx` — a long-lived Ink component with:
- `Static` scrolling history for `DisplayLine` items (stream, step, info, warn, success)
- Fixed bottom status bar showing pipeline name, current node, PID, and Ctrl+C hint
- `onReady` callback pattern providing `{ push, setStatus, done }` to the caller
- `renderPipelineDisplay()` helper for mounting from non-React code

### Chunk 3: Pipeline Command Wiring ✅

Rewrote `pipelineRunCommand` in `pipeline.ts` to:
- Mount `PipelineDisplay` before running the pipeline
- Show overview (name, branch, project, goal, node list) via `push()`
- Wire `onNodeStart` → `push({ kind: "step" })` + `setStatus()`
- Wire `onStdout` → `streamEvents()` → `push({ kind: "stream" })`
- Show success/failure via `push()` and clean up with `done()` + `waitUntilExit()`

### Files Modified/Created

| File | Action |
|------|--------|
| `src/attractor/core/engine.ts` | Modified — added `onNodeStart`, `onStdout` to EngineOptions |
| `src/attractor/handlers/agent-handler.ts` | Modified — reads `onStdout`, `interactive` from meta/node |
| `src/cli/components/PipelineDisplay.tsx` | Created — Ink component with Static history + sticky bar |
| `src/cli/components/PipelineDisplay.test.tsx` | Created — 3 unit tests |
| `src/cli/commands/pipeline.ts` | Modified — rewrote pipelineRunCommand to use PipelineDisplay |
| `src/attractor/tests/engine.test.ts` | Modified — 2 new tests for callbacks |
| `src/attractor/tests/agent-handler.test.ts` | Modified — 2 new tests for onStdout/interactive |
| `src/cli/tests/pipeline.test.ts` | Modified — added PipelineDisplay mock, updated assertions |
