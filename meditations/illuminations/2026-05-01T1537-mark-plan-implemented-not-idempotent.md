---
date: 2026-05-01
description: Pipeline tail node mark_plan_implemented errors on status=done, so resumed runs silently skip the lifecycle flip and emit success:false in the trace.
---

## Core Idea

`mcp__illumination__mark_plan_implemented` rejects plans whose frontmatter is already `status: done`, returning `success: false` with `"Cannot mark as implemented: current status is done"`. Pipelines that re-run (e.g. `--resume`, replay after a crash, or the same plan landing in two different runs) hit this error after the first run, and the tail node silently records the failure instead of treating "already done" as success. The flip should be idempotent — `done → done` is a no-op, not an error.

## Why It Matters

Run `59649093-c812-473e-8054-44973e3edf41` (illumination-to-implementation) finished cleanly: 1258/1258 vitest pass, build green, commit landed, tmux smoke clean. Despite that, `memory_writer` recorded:

> `mark_plan_implemented` returned `success: false` with error `"Cannot mark as implemented: current status is done"` — the plan's status had already advanced past `pending` before this node ran. Lifecycle flip skipped; manual frontmatter inspection may be warranted.

(Source: `memory/2026-05-01-janitor-dead-two-phase-fn.md`, "Learnings from the run".)

Failure semantics here are inverted. The pipeline's terminal contract is "after a successful run, the plan's status reflects implemented." If a previous run already wrote `done`, the post-condition is satisfied — surfacing an error muddies traces, suppresses real failures (a future genuine bug in the flip will look identical), and forces every operator to manually verify frontmatter on every resumed run. It also blocks any future automation that wants to assert "tail node clean" as a release gate.

The git log shows the user already noticed this once: `ef70a21 chore(memory): note plan-flip failure for janitor-dead-two-phase-fn`. That commit only documents the symptom — the underlying MCP behavior is unchanged.

## Revised Implementation Steps

1. Locate the `mark_plan_implemented` handler in the illumination MCP server (likely under `src/cli/mcp/illumination-server.ts` or a sibling). Confirm where it reads frontmatter status and where it throws the `"current status is done"` error.
2. Change the `done → done` path: return `{ success: true, alreadyDone: true, path }` instead of erroring. Reserve `success: false` for genuinely bad transitions (e.g. `pending → done` blocked by validation, or missing frontmatter).
3. If the handler currently distinguishes `pending` vs other statuses, add an explicit branch for `done` that short-circuits with the idempotent-success payload before reaching the rejection arm.
4. Update the corresponding test (or add one) covering: (a) `pending → done` flips and returns success, (b) `done → done` returns success with `alreadyDone: true`, (c) any other status (e.g. `archived`, missing frontmatter) still returns a clear error.
5. Audit the tail-node prompt in `pipelines/illumination-to-implementation/` (and any other pipeline that calls `mark_plan_implemented`) to confirm it treats `success: true, alreadyDone: true` as a clean exit — adjust messaging only if it currently asserts a state change occurred.
6. Optional follow-up: surface `alreadyDone: true` in the run trace as an info-level note so operators can still see "plan was already done" without it counting as a failure.

## Provenance

- Source memory: `memory/2026-05-01-janitor-dead-two-phase-fn.md`
- Pipeline run id: `59649093-c812-473e-8054-44973e3edf41`
- Surfaced by: memory-reflector
