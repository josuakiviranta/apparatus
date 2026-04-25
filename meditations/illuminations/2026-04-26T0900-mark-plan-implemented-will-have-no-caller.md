---
date: 2026-04-25
status: open
description: The plans-have-no-lifecycle design creates mark_plan_implemented but defers the call site to "any implementing agent" — both terminal pipeline agents (implement, memory_writer) have mcp: [], making neither a viable caller, and the T1000 anti-pattern (tool with no caller) repeats at the plan layer.
---

## Core Idea

`docs/superpowers/specs/2026-04-25-plans-have-no-lifecycle-design.md` is an approved, unimplemented design that adds the `mark_plan_implemented` MCP tool. Its call-site decision reads: "any agent that runs implementation work AND has the `illumination` MCP server attached gets `mark_plan_implemented` whitelisted." It explicitly marks `pipelines/illumination-to-implementation.dot` as "No edit." The two natural terminal agents in that pipeline — `implement` (`src/cli/agents/implement.md`) and `memory_writer` (`src/cli/agents/memory-writer.md`) — both carry `mcp: []`. Neither has the illumination server attached. The tool will be built, the whitelist will be added to agents that already have MCP, but no pipeline node will actually call it. This is the T1000 anti-pattern (`mark-implemented has no caller`, 2026-04-14T1000) reproducing one layer up.

## Why It Matters

The janitor's reconciliation loop at step 2 of `src/cli/agents/janitor.md` reads: *"For each dispatched illumination whose `plan_path` resolves to a plan with `status: implemented`, call `mark_implemented`."* The janitor cannot close an illumination until the plan it references is flipped to `implemented`. If no pipeline node flips it, every plan stays `pending` indefinitely, and the janitor's dispatch→implemented path is permanently blocked. `IMPLEMENTATION_PLAN.md` already documents that the janitor is broken in headless mode due to MCP auto-injection not reaching `permissionMode: dontAsk` agents. Two bugs compound: the janitor cannot reach its tools, and the upstream signal it reads (`plan.status === "implemented"`) will never be written. The entire observe→illuminate→plan→implement→close loop remains open at both the plan and illumination boundaries.

`memory_writer` is the correct call site. It already runs at pipeline end, already commits all pending work, and already has `$plan_path` in its inputs. Adding MCP access and one procedure step closes the loop at the natural finalization node without modifying the pipeline graph.

## Revised Implementation Steps

1. **Add MCP block to `src/cli/agents/memory-writer.md`.** Replace `mcp: []` with the illumination server block (same shape as `src/cli/agents/meditate.md:17-23`). This is the prerequisite for any MCP tool call from the terminal node.

2. **Add `mcp__illumination__mark_plan_implemented` to `memory_writer.md` tools list.** Place it next to `Read`, `Write`, `Bash` in the `tools:` array.

3. **Add step 7 to the `memory_writer.md` procedure.** After step 6 (push), before emitting structured JSON: *"Call `mark_plan_implemented` with the basename of `$plan_path`. If it returns `success: false`, log the error in the memory file's `Learnings` section but do not abort."* The call must be best-effort — a missing-frontmatter plan (backfill gap) must not break the push step.

4. **Update `plans-have-no-lifecycle-design.md` to name `memory_writer` as the canonical call site.** Strike the "any implementing agent" language and replace with the concrete agent + procedure step. This prevents the plan that implements the design from re-discovering the ambiguity.

5. **Resolve the janitor MCP-not-registered bug (`IMPLEMENTATION_PLAN.md` open follow-up) as a separate, sequential task.** The janitor reconciliation loop is blocked independently of plan closure: even after (1)–(3) land and plans start getting marked `implemented`, the janitor cannot call `mark_implemented` to close the illumination side. The MCP auto-injection failure in `permissionMode: dontAsk` paths must be diagnosed and fixed before the full observe→illuminate→plan→implement→close cycle is verifiable end-to-end.
