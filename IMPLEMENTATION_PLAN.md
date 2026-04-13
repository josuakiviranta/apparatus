# Pipeline Static Rendering + Streaming Text Implementation Plan

> **Status: COMPLETE** — All tasks implemented and verified. Tag: v0.1.17

**Goal:** Fix pipeline TUI flicker by using Ink's built-in index in `<Static>` blocks, and enable streaming text for `json_schema_file` nodes by switching from `--output-format json` to `stream-json`.

**Architecture:** `PipelineApp.tsx` uses `<Static>` for frozen blocks with built-in index. `agent.ts` streams NDJSON through a `PassThrough` tee — events flow to the TUI while being accumulated into `capturedOutput` for `agent-handler.ts`, which falls back to `event.result` when `structured_output` is null.

---

## Chunk 1: Code changes — DONE

### Task 1: Fix `findIndex` in PipelineApp.tsx — DONE

- [x] Updated Static render callback to use `(item, index)` instead of `findIndex`
- [x] Tests pass (4/4)
- [x] Committed: `7fdbf39`

### Task 2: Switch json_schema nodes to stream-json in agent.ts — DONE

- [x] Updated test (TDD red step)
- [x] Added PassThrough import, removed parseStructuredOutput import
- [x] Simplified buildArgs — all non-interactive runs use `stream-json`
- [x] Replaced 85-line buffering block with 22-line PassThrough tee
- [x] Added error listener on PassThrough for robustness
- [x] All 714 tests pass
- [x] Committed: `11c23d7`, `e2feaae`

---

## Chunk 2: Smoke pipelines — DONE

### Task 3: static-multi-node smoke pipeline — DONE

- [x] Created `pipelines/smoke/static-multi-node.dot`
- [x] Committed: `2fce843`

### Task 4: json-schema-stream smoke pipeline — DONE

- [x] Created `pipelines/smoke/schemas/file-list.json`
- [x] Created `pipelines/smoke/json-schema-stream.dot`
- [x] Committed: `bd3e79c`

---

## How to test with tmux

Read `docs/harness/tmux-drive.md` for the full harness. Quick reference:

```bash
ralph pipeline run pipelines/smoke/static-multi-node.dot
# → nodes 1+2 should never repaint after completing

ralph pipeline run pipelines/smoke/json-schema-stream.dot
# → streaming text (file descriptions) should appear in live block
#   before the node completes and the JSON result is processed
```
