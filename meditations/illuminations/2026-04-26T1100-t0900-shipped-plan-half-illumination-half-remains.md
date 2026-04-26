---
date: 2026-04-26
status: open
description: T0900 shipped MCP-based plan closure directly in memory_writer, making T1000's plan-script node redundant — but the illumination itself still has no closer, and the same MCP pattern that worked for the plan can close it with one additional tool whitelist entry and one procedure line.
---

## Core Idea

T0900 shipped. `src/cli/agents/memory-writer.md` now carries a full MCP block, `mcp__illumination__mark_plan_implemented` in the tool whitelist, and step 7 that calls it best-effort after `git push`. The plan layer closes. The illumination layer does not — `status: dispatched` stays forever. T1000 prescribed two `.mjs` scripts and two tool nodes to close both; now that T0900 used the MCP-in-agent pattern for the plan, the same pattern closes the illumination with one more entry. T1000's `close_plan` node and `mark-plan-implemented.mjs` script are now redundant before they were written.

## Why It Matters

The janitor agent (`src/cli/agents/janitor.md:43`) reads `plan.status === "implemented"` to decide whether to flip the illumination. T0900 fixed the plan signal. But the janitor is broken in headless mode (MCP auto-injection fails in `permissionMode: dontAsk`, per `IMPLEMENTATION_PLAN.md` open follow-up). Even when fixed, the janitor fires on a schedule — it is not part of the pipeline run. The illumination stays `dispatched` until the next janitor cycle, and if the janitor MCP bug is not fixed that is never.

`memory_writer` already has the MCP server attached. `mcp__illumination__mark_implemented` is a live registered tool at `src/cli/mcp/illumination-server.ts`. Adding it to the whitelist and one procedure line in step 7 closes the illumination in the same best-effort call site that already closes the plan — no new scripts, no pipeline graph edits, no new tool nodes. T1000 as written remains partially correct only for idempotency tests (the `.mjs` script shape and fixture pattern are still worth having), but the pipeline structure it proposes is now unnecessary.

## Revised Implementation Steps

1. **Add `mcp__illumination__mark_implemented` to `src/cli/agents/memory-writer.md` tools list.** One line, adjacent to `mcp__illumination__mark_plan_implemented`. The MCP block is already present — no structural change needed.

2. **Extend step 7 in `memory-writer.md` procedure.** After the `mark_plan_implemented` call, add: *"If `$illumination_path` is set and non-empty, call `mark_implemented` with the basename of `$illumination_path`. Apply the same best-effort contract: on `success: false`, log to `Learnings from the run`; do not abort."*

3. **Add a best-effort bullet for `mark_implemented` to the Hard rules section.** Mirror the existing `mark_plan_implemented` bullet: *"`mark_implemented` is best-effort — a wrong-status illumination (e.g. already `implemented`, or `open`) must not abort finalization."*

4. **Trim T1000's scope before implementing it.** `meditations/illuminations/2026-04-26T1000-dispatch-open-close-pair-is-broken.md` step 2 (`mark-plan-implemented.mjs`) and step 3–4 (`close_plan` node and edges) are now redundant. If T1000 is dispatched as written, the implementer will add a `close_plan` node that double-calls a flip `memory_writer` already made. Update T1000's steps before dispatch to: write only `mark-implemented.mjs` (for test coverage of the script pattern), add only `close_illumination` tests — and note that the pipeline-graph steps (3–4) are superseded by the MCP-in-agent approach from T0900.

5. **Verify the closed loop.** Run `pipelines/illumination-to-implementation.dot` end-to-end against a real `open` illumination. After `memory_writer` exits: confirm `$illumination_path` frontmatter reads `status: implemented`, confirm `$plan_path` frontmatter reads `status: implemented`, confirm both auto-commits appear in `git log --oneline -5`. Next janitor run should find zero dispatched illuminations with `status: implemented` plans to reconcile.
