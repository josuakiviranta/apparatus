# Mark Plan Implemented Will Have No Caller — Design

**Status:** Approved
**Date:** 2026-04-26
**Related:** `meditations/illuminations/2026-04-26T0900-mark-plan-implemented-will-have-no-caller.md`, `specs/2026-04-25-plans-have-no-lifecycle-design.md`, `docs/superpowers/plans/2026-04-25-plans-have-no-lifecycle.md`, `src/cli/agents/memory-writer.md`, `src/cli/mcp/illumination-server.ts`, `pipelines/illumination-to-implementation.dot`

## Overview

The `mark_plan_implemented` MCP tool ships at `src/cli/mcp/illumination-server.ts:381` and is registered with the server at `src/cli/mcp/illumination-server.ts:692`. The originating design (`specs/2026-04-25-plans-have-no-lifecycle-design.md:276`) deliberately did **not** pin a caller, leaving the call-site decision as: *"any agent that runs implementation work AND has the `illumination` MCP server attached gets `mark_plan_implemented` whitelisted."* The same design at line 302 explicitly says `pipelines/illumination-to-implementation.dot` needs **no edit**.

Across `src/cli/agents/*.md`, only one whitelist line currently references the tool: `src/cli/agents/janitor.md:14`. The janitor's procedure (`src/cli/agents/janitor.md:43`) reads:

> *"For each dispatched illumination whose `plan_path` resolves to a plan with `status: implemented`, call `mark_implemented`."*

The janitor consumes `status: implemented` to flip illuminations — it never writes that status onto plans. The two terminal nodes in `pipelines/illumination-to-implementation.dot` that *could* write it both opt out:

- `src/cli/agents/implement.md:6-7` — `tools: []`, `mcp: []`
- `src/cli/agents/memory-writer.md:6-12` — `tools: [Read, Write, Grep, Glob, Bash]`, `mcp: []`

Net effect: every plan stays `pending` forever, the janitor's `dispatched → implemented` reconciliation is permanently blocked at the upstream signal, and the observe → illuminate → plan → implement → close loop stays open. This is the same T1000 anti-pattern (`mark-implemented has no caller`, 2026-04-14T1000) reproducing one layer up.

This design pins `memory_writer` as the canonical caller, attaches the illumination MCP server, whitelists `mark_plan_implemented`, and adds one best-effort procedure step after `git push`. It also amends `specs/2026-04-25-plans-have-no-lifecycle-design.md:276` to name `memory_writer` explicitly so the implementing plan does not re-discover the ambiguity.

## Why now

The "plans have no lifecycle" plan (`docs/superpowers/plans/2026-04-25-plans-have-no-lifecycle.md`) is marked `status: implemented` — the tool, helper, and tests have shipped — but the deferred caller-wiring decision means the lifecycle ledger it added is write-blocked from the pipeline side. Until something flips a single plan to `implemented`, the janitor (recently shipped per `src/cli/agents/janitor.md`) accumulates dispatched illuminations whose plans appear unfinished even when shipped.

The shipping README (lines 48–54) advertises janitor lifecycle reconciliation as a project goal. Closing the gap is one MCP block + one tool entry + one procedure step on a node that already pushes commits. No new agents, no new pipeline edits, no new tools — the smallest change that matches the explainer the user approved.

## Architecture

### Why `memory_writer` is the right caller

The terminal node of `pipelines/illumination-to-implementation.dot` is `memory_writer` (`src/cli/agents/memory-writer.md`). Three properties make it the natural call site:

1. **It runs last.** Procedure step 6 (`src/cli/agents/memory-writer.md:103-107`) is the unconditional `git push`. Anything `mark_plan_implemented` does (frontmatter rewrite + auto-commit per `src/cli/mcp/illumination-server.ts:692-704`) is best ordered *after* the human-facing artifacts have been committed and pushed by the implement / tmux-tester nodes.
2. **It already has `$plan_path`.** The agent's input list (`src/cli/agents/memory-writer.md:24-27`) names `$plan_path`, `$design_doc_path`, `$illumination_path`. No pipeline graph edit is required to thread the plan filename to the call site.
3. **It is the finalization node by description.** The mission line (`src/cli/agents/memory-writer.md:3`): *"Close out a pipeline session — distill the run …, commit all pending work, and push to origin."* Lifecycle closure is the natural extension of "close out the session".

The alternative — `implement.md` — was eliminated by inspection: it declares `tools: []` and `mcp: []` (`src/cli/agents/implement.md:6-7`) and runs `git commit` + `git push` from the freeform Bash environment available to its `permissionMode: dangerouslySkipPermissions` posture, not via MCP. Adding MCP machinery to `implement.md` would expand its surface; adding it to `memory_writer.md` aligns with its existing finalization role.

### Best-effort, post-push call

The new step 7 runs **after** push for two compounding reasons:

- **Push is unconditional** (`src/cli/agents/memory-writer.md:103-109`): *"Even if step 5 staged nothing, prior commits from `implement` and `tmux-tester` may not have been pushed yet."* The lifecycle flip auto-commits its own change (`src/cli/mcp/illumination-server.ts:420-428`); ordering the call after the unconditional push means the auto-commit is a tail event with no other commit racing it.
- **The call must not abort the node.** A plan file with no frontmatter (the orphan-plan class addressed by `docs/superpowers/specs/2026-04-25-janitor-lifecycle-orphan-plans-design.md`) returns `success: false` from `markPlanImplemented` (`src/cli/mcp/illumination-server.ts:399-401`). If the call were ahead of push, a frontmatter-missing plan would block the commit/push step that other agents depend on.

The procedure addition is therefore phrased as best-effort: on `success: false`, log the error to the memory file's `Learnings` section but do not abort.

### Why the design doc gets amended (not just the agent file)

The unimplemented design (`specs/2026-04-25-plans-have-no-lifecycle-design.md`) is the source of the ambiguity. Future readers — including any LLM authoring a follow-up plan — will read line 276 as authoritative and re-derive the "any implementing agent" framing. Amending the line in-place to name `memory_writer` keeps the design as the single source of truth, mirrors the pattern used elsewhere in the corpus (e.g., `docs/superpowers/specs/2026-04-25-janitor-lifecycle-orphan-plans-design.md:42-65` rewrites prior pointers in-place rather than via a successor doc), and prevents the spec from outliving its own resolution.

## Components

### File edits (exactly 4)

| # | File | Change |
|---|---|---|
| 1 | `src/cli/agents/memory-writer.md` (frontmatter, lines 6–12) | Add `mcp__illumination__mark_plan_implemented` to the `tools:` list. Replace `mcp: []` with the illumination MCP server block (same shape as `src/cli/agents/meditate.md:14-21`, but without the `META_MEDITATIONS_DIR` arg — memory-writer does not read meta-meditations). The frontmatter rewrite + auto-commit performed by the tool itself live at `src/cli/mcp/illumination-server.ts:420-428`. |
| 2 | `src/cli/agents/memory-writer.md` (Procedure section, after current step 6) | Insert step 7: *"Call `mark_plan_implemented` with the basename of `$plan_path`. If the response is `success: false`, log the error in the memory file's `Learnings` section but do not abort the node."* Renumber the existing step 7 (the structured-JSON emit) to step 8. |
| 3 | `src/cli/agents/memory-writer.md` (Hard rules section) | Add a bullet codifying the best-effort contract: *"`mark_plan_implemented` is best-effort — never abort the node on `success: false`. Push and the JSON emit are non-negotiable; the lifecycle flip is opportunistic."* |
| 4 | `specs/2026-04-25-plans-have-no-lifecycle-design.md:276` | Strike the *"caller identity is not pinned to one specific agent file"* sentence and the trailing parenthetical. Replace with: *"The canonical caller is `memory_writer` (`src/cli/agents/memory-writer.md`), the terminal node of `pipelines/illumination-to-implementation.dot`. The flip runs as a best-effort step after the unconditional `git push`; on `success: false` (e.g., orphan plan with no frontmatter), the node logs to its memory file's `Learnings` section and continues."* |

### Verification

After the edits:

1. **Static check** — Grep `src/cli/agents/memory-writer.md` for `mcp__illumination__mark_plan_implemented` (one tool whitelist line) and `mark_plan_implemented` (one procedure-step body reference). Grep the design doc for `memory_writer` to confirm the amendment landed.
2. **Tmux verification** — Drive `pipelines/illumination-to-implementation.dot` end-to-end against a fresh test illumination + plan pair using the harness in `docs/harness/tmux-drive.md`. Expected outcome: plan frontmatter flips to `status: implemented` (frontmatter rewrite + auto-commit per `src/cli/mcp/illumination-server.ts:693-694`); next janitor run calls `mark_implemented` on the dispatched illumination.
3. **Negative case** — Run the same pipeline with a frontmatter-less test plan. Expected outcome: push succeeds, JSON emit succeeds, the memory file's `Learnings` section logs the `success: false` error, the node exits 0.

No new automated test is required — the underlying `markPlanImplemented` happy-path / no-frontmatter / already-implemented cases are already covered by `src/cli/tests/illumination-server.test.ts` per `specs/2026-04-25-plans-have-no-lifecycle-design.md:316-319`. The end-to-end pipeline behavior is the new surface, exercised by the tmux pass.

## Constraints

- **No pipeline graph edits.** `pipelines/illumination-to-implementation.dot` is unchanged, matching `specs/2026-04-25-plans-have-no-lifecycle-design.md:300-302`.
- **No new MCP tool, no new helper, no new test fixture.** The tool exists; the helper is exported; the fixture set in `src/cli/tests/illumination-server.test.ts` already covers all three failure modes.
- **MCP block shape mirrors `meditate.md:14-21` exactly**, minus the `META_MEDITATIONS_DIR` arg. Token substitutions (`{{ILLUMINATION_SERVER_PATH}}`, `{{PROJECT_ROOT}}`) are resolved by the existing pipeline runtime — no new substitution machinery.
- **Best-effort contract is load-bearing.** The "do not abort on `success: false`" rule is the difference between this change being safe and being a regression for orphan-plan runs. It is encoded in the agent file's Hard rules section so future edits cannot quietly drop it.
- **Stays apples-to-apples with the approved explainer.** Same anchors (`memory-writer.md:6-12`, `implement.md:6-7`, `illumination-server.ts:381,692`, `janitor.md:14`, `meditate.md:14-21`), same before/after framing, same scope split (in: caller wiring; out: pipeline graph; out: janitor MCP-injection bug).

## Out of scope (YAGNI)

- **Janitor MCP-not-registered bug.** The janitor under `permissionMode: dontAsk` has a separate MCP auto-injection failure (per `IMPLEMENTATION_PLAN.md` open follow-up cited in the illumination). Even after this design lands and plans start flipping to `implemented`, the janitor cannot call `mark_implemented` to close the illumination side until that bug is fixed. The illumination explicitly splits this as a sequential follow-up (illumination step 5); fixing both in one change widens scope and couples two independent failure modes.
- **Pinning `implement.md` as a fallback caller.** With `memory_writer` always running as the terminal node, a second caller is redundant. Adding `implement.md` as a backup would re-introduce a coordination point (which agent calls first? what if both call?) for no benefit — the tool's `markPlanImplemented` already returns `success: false` on already-implemented input (`src/cli/mcp/illumination-server.ts:409-413`), but redundant calls still add noise to the trace.
- **Pipeline graph edits to thread `$plan_path` differently.** The variable already reaches `memory_writer.md` via the existing pipeline context (`src/cli/agents/memory-writer.md:25`). No graph change is needed.
- **Auto-commit policy change.** `markPlanImplemented` auto-commits its own frontmatter rewrite (`src/cli/mcp/illumination-server.ts:693-694`). Some readers may prefer that the call be staged-only and folded into the memory-writer's final commit; this is a separate design conversation and would change the contract for the janitor (which assumes the auto-commit lands). Not in scope here.

## Open questions

These are surfaced rather than decided — implementation should resolve them in-line with the user, not in this spec.

1. **What if `$plan_path` is empty or unset for a given run?** Some pipeline runs (e.g., a `meditate` → archive flow that never produces a plan) may not populate `$plan_path` on the terminal node. Implementation options:
   - (a) Skip step 7 entirely when `$plan_path` is empty and log a one-line note to the memory file.
   - (b) Treat empty `$plan_path` as a hard error in step 7 and abort. Inconsistent with the best-effort contract — likely wrong.
   - (c) Validate `$plan_path` upstream (in the pipeline graph) before reaching `memory_writer`. Out of scope per the no-graph-edit constraint.

   Recommendation: (a). The best-effort framing covers it.

2. **Should the memory file's `Learnings` section format the lifecycle outcome as a normal entry, or as a dedicated subsection?** The illumination's wording (*"log the error in the memory file's `Learnings` section"*) leaves this ambiguous. The agent file's existing rubric (`src/cli/agents/memory-writer.md:75-83`) says `Learnings` is optional and reserved for trace-evidence. Implementation should match that bar — log only on `success: false` or other unexpected outcomes; do not pad clean runs with a "lifecycle: ok" line.

## Files modified at implementation

| File | Lines touched |
|---|---|
| `src/cli/agents/memory-writer.md` | ~+10 (frontmatter MCP block + tool entry, +1 procedure step, +1 hard-rules bullet) |
| `specs/2026-04-25-plans-have-no-lifecycle-design.md` | ~+3 / -2 (rewrite line 276 paragraph) |

Total: 2 files. No code changes, no new tests, no pipeline-graph edits.
