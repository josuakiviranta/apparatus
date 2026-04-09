# Structured Output & Pipeline Display Fixes Implementation Plan

> All items complete. Implemented in commits 03fa6a8 (core fixes) and the follow-up readline test commit.

**Goal:** Fix three chained bugs that cause `ralph pipeline run` with structured-output nodes to silently exit with no output.

**Spec:** `docs/superpowers/specs/2026-04-13-structured-output-pipeline-fixes-design.md`

---

## Chunk 1: Fix structured output unwrapping — COMPLETE

- [x] Tests for Claude CLI object wrapper and array wrapper formats (`agent-handler.test.ts`)
- [x] Implementation: unwrap `{type:"result", result:"..."}` and array formats before parsing (`agent-handler.ts:114-139`)

## Chunk 2: Fix readline/close race condition — COMPLETE

- [x] Implementation: `rlDone` promise awaits readline close before returning (`agent.ts:199-213`)
- [x] Regression test: mock spawn + readline completion test (`agent.test.ts`)

## Chunk 3: Fix Ink render race on pipeline exit — COMPLETE

- [x] `setTimeout(resolve, 0)` macrotask yield before `done()` in pipeline finally block (`pipeline.ts:148`)
