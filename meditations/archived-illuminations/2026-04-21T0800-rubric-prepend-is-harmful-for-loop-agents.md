---
date: 2026-04-21
status: archived
description: T0700's rubric-prepend fix is correct for procedure-style agents (tmux-tester, verifier) but harmful for loop-style agents (implement) whose rubrics encode standalone behaviors — git push, study 500 specs — that pipeline node prompts currently rely on the rubric being dropped to suppress.
archived_at: 2026-04-27
archive_reason: superseded by memory/user-spider-web-mental-model.md
---

## Superseded by spider/web mental model (2026-04-21)

The user's spider/web model (`memory/user-spider-web-mental-model.md`) invalidates this illumination's conclusion. There is no loop-vs-procedure archetype split. `implement.md`'s body — push, study specs, update plan, tag — is how the spider eats, not a liability that pipelines should suppress. The observed contradiction with the `implement` node's "Do NOT push" override signals that **the pipeline itself is misdesigned**, not that the rubric is harmful. Correct path: apply T0700's universal prepend AND redesign `illumination-to-implementation.dot` to hand a prepared fly to the spider and trust autopilot. See T1000 for the revised implementation steps.

## Core Idea (original, retained for history)

`implement.md`'s rubric body is a standalone agentic loop: it instructs the agent to push after every commit, study `specs/*` with up to 500 parallel subagents, and continuously update `IMPLEMENTATION_PLAN.md`. The `implement` pipeline node in `illumination-to-implementation.dot` overrides all three: "Do NOT push," "Read the implementation plan at `$plan_path`," "Do NOT modify files outside the scope of the plan." Today those overrides work because the rubric is silently dropped (T0600/T0700). T0700's proposed one-line prepend would restore the rubric, causing the agent to see "git push" *and* "Do NOT push" simultaneously — an unresolved conflict whose outcome depends on instruction ordering and temperature.

By contrast, `tmux-tester.md` was written pipeline-first: its Hard Rules section already says "Do NOT `git push`," its Procedure is structured so pipeline nodes can safely say "Follow your agent-level procedure," and its node prompt only adds missing specifics (`$run_id`, `$project`). Prepending the tmux-tester rubric is safe. Prepending the implement rubric is not.

## Why It Matters

Two implicit behavioral classes exist across `src/cli/agents/*.md`:

- **Procedure agents** (`tmux-tester`, `verifier`, `design-writer`, `plan-writer`, `change-explainer`): rubric is a portable, pipeline-safe procedure. "Follow your agent-level procedure" in a node prompt is a live reference to real instructions the agent needs.
- **Loop agents** (`implement`, `meditate-observer`): rubric is a standalone agentic loop with built-in defaults (push, study specs, iterate until done). These defaults exist because the agent was designed to run autonomously outside pipelines. Inside a pipeline, those defaults are liabilities — they contradict the node prompt and violate pipeline invariants like "no push until commit_push."

This distinction is invisible to `agent-handler.ts`, which assembles the prompt identically for both classes. The rubric-drop behavior (T0600/T0700's bug) is accidentally load-bearing for loop agents running inside pipelines. Fixing it universally would break the implement node's "no push" guarantee — a regression harder to notice than the original bug.

## Revised Implementation Steps

1. **Audit agent rubrics for standalone-mode behaviors.** Read every `.md` under `src/cli/agents/`. Flag any instruction that conflicts with common pipeline constraints: push, global file writes (`IMPLEMENTATION_PLAN.md`, `AGENTS.md`), bulk spec reads, or "run until done" loops. `implement.md` is the confirmed problematic case; check `meditate-observer.md` and others.

2. **Introduce a rubric section convention.** Add a `## Pipeline procedure` heading to rubrics of procedure agents — this is the section that node prompts mean when they say "Follow your agent-level procedure." Loop agents (`implement.md`) get a `## Standalone defaults` heading wrapping push/study-specs rules. The heading distinction tells a future reader (and a future agent-handler enhancement) which sections are portable.

3. **Rewrite `implement.md` standalone defaults as pipeline-safe.** Move push and IMPLEMENTATION_PLAN.md update rules under `## Standalone defaults`. Under a new `## Pipeline procedure`, write the minimal portable behavior: red/green TDD, one commit per passing chunk, no push. The pipeline node prompt can then be shortened to "Follow your agent-level procedure. Plan: `$plan_path`."

4. **Apply T0700's fix selectively.** In `agent-handler.ts`, when `node.prompt` or `node.label` is set, prepend only if `config.prompt` contains a `## Pipeline procedure` section — extract just that section. If no such section exists, retain current behavior (node prompt only). This keeps loop agents working correctly without requiring all rubrics to be refactored first.

5. **Add a smoke assertion.** In `pipelines/smoke/`, add a one-node pipeline that runs `agent="implement"` with a trivial `prompt=` and verifies that no `git push` appears in its trace. This prevents silent regression if step 4 is later removed or bypassed.
