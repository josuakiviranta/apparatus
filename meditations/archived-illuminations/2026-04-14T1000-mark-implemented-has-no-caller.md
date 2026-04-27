---
date: 2026-04-13
status: archived
description: The illumination lifecycle defines four states but the pipeline terminates at `dispatched` — `mark_implemented` exists in the state machine, exposes an MCP tool, and has unit tests, yet has zero callers in any pipeline or documented workflow, leaving every resolved illumination suspended in `dispatched` forever.
archived_at: 2026-04-25
reason: mark_implemented now wired in meditate prompt line 39 and agent whitelist line 12
---

## Core Idea

The illumination state machine has four states: `open → dispatched → implemented → archived`. The pipeline (`illumination-to-plan.dot`) calls `mark_dispatched` after the design doc is approved, then `plan_writer` writes the plan, then routes to `done`. The pipeline ends there. After code ships — feature built, tests passing, commit landed — no workflow, prompt, or doc instructs anyone to call `mark_implemented`. The function exists in `src/cli/mcp/illumination-server.ts`, is exposed as an MCP tool, and has `describe("markImplemented")` unit tests. It has never been called in production. Every illumination that has ever been dispatched remains `dispatched` forever.

## Why It Matters

The CRUD lens names the failure precisely: the lifecycle state machine is a resource with four transitions (create, mark-dispatched, mark-implemented, mark-archived). Three of those transitions are wired to callers. `mark_implemented` is the orphaned one — built, tested, exposed, but not called.

This has a concrete downstream effect. `list_illuminations(status=open)` is what the `illumination-to-plan.dot` verifier *should* query to avoid re-processing illuminations (the T0600 bug). The intent was clear: `dispatched` means "a plan exists," `implemented` means "the feature shipped," and a future session querying `status=open` would only see illuminations with no plan and no implementation. But because `mark_implemented` is never called, `dispatched` is the effective terminal state — indistinguishable from "plan written but nobody implemented it" and "plan written and shipped last week."

The 10 current illuminations are all `status: open`. When the backpressure guard ships and the `illumination-to-plan` pipeline runs, those 6 illuminations about the guard will become `dispatched`. A session three months from now will query the corpus, find 6 illuminations about the backpressure guard in `dispatched` state, and have no way to know whether the guard exists in the codebase or not. The lifecycle that was supposed to surface implementation truth instead obscures it.

There is also a structural gap in the `agentic-loop-is-a-graph` model: the pipeline graph has no node after `plan_writer` where closure happens. The graph terminates without calling home. In graph terms, `done` is a terminal node, but the illumination's lifecycle graph has a longer path that the pipeline doesn't traverse: `dispatched → [code written] → implemented`. That middle step — `code written` — happens outside the pipeline, in a separate implementation session. The bridge back never fires.

## Revised Implementation Steps

1. **Add a `mark_implemented` call to the meditate agent's workflow documentation.** In `src/cli/agents/meditate.md`, add a section: "When an illumination's feature has been implemented: call `mark_implemented` with the illumination's filename. Do this after verifying the feature exists in the codebase." This is the minimum needed — the tool already exists, it just needs a named trigger point.

2. **Create a `mark-implemented-lifecycle.dot` smoke pipeline** (or extend `pipelines/smoke/`). The pipeline: (a) call `list_illuminations(status=dispatched)` to find candidates, (b) for one candidate, verify the associated feature exists in `src/` using glob/grep, (c) if confirmed, call `mark_implemented`. This gives the `implemented` state a caller and makes the lifecycle closure testable end-to-end.

3. **Add `execSync` git-commit calls to `markDispatched`, `markImplemented`, `markArchived`** (the T0700 fix). The `writeIllumination` function already has this pattern — a try/catch wrapping two `execSync` calls. All three mutation functions should do the same. Write tests first (mock `execSync`, assert it's called with the expected commit message). This makes lifecycle state changes visible in `git log` and auditable across sessions.

4. **After implementing the backpressure guard, call `mark_implemented` on the relevant illuminations.** Specifically: `2026-04-14T0300-meditate-has-no-backpressure.md` and any others whose primary claim is the guard's absence. Do this in the same session that commits the guard — it is a two-line MCP tool call, and it establishes the first real use of `mark_implemented` in the project's history.

5. **Verify `list_illuminations(status=implemented)` returns the correct files after step 4.** This confirms the end-to-end closure. If the result is "No illuminations found," the lifecycle has been closed and future sessions can trust the `dispatched` bucket as "plan exists, implementation unknown" — a useful signal rather than a dead end.
