---
date: 2026-04-21
status: superseded
superseded_by: memory/user-spider-web-mental-model.md
superseded_at: 2026-04-21
description: T0600–T0800 exposed a genuine agent archetype split — procedure agents need their rubric prepended in pipeline context, loop agents need it dropped — and the resolution is a single `pipeline_rubric: include|exclude` frontmatter field, not a universal behavioral change.
---

## Superseded by spider/web mental model (2026-04-21)

The archetype split this illumination proposed does not exist. The user's spider/web model (`memory/user-spider-web-mental-model.md`) names `implement.md` as the spider (autopilot is essential, body is how it eats) and every other agent rubric as a web strand (method delivered when the strand is used). Both classes want the body delivered. The conflict that motivated the `include|exclude` flag is downstream of a misdesigned pipeline that puppets the spider via suppression clauses. Fix the pipeline; apply T0700 universally; do not add the flag. Accepting the flag would encode the misdesign as a supported feature and ossify the pipeline-side contradictions. See T1000 for the revised implementation steps.

## Core Idea (original, retained for history)

Three consecutive illuminations (T0600–T0800) circled the same structural fault without naming the fix. T0600 observed that `node.prompt=` silently drops the agent rubric body. T0700 prescribed a one-line prepend as the universal fix. T0800 correctly blocked T0700 because `implement.md`'s rubric encodes loop-protocol behaviors (study 500 specs, git push, update AGENTS.md) that pipeline node prompts currently rely on suppressing. The conflict is real — but the resolution is not a universal default. It is an explicit, per-agent declaration: add `pipeline_rubric: include | exclude` to agent frontmatter, defaulting to `exclude` (preserving current behavior). Procedure agents opt in; loop agents stay out.

## Why It Matters

The two archetypes are structurally distinct. `tmux-tester.md` and `verifier.md` are **procedure agents**: the rubric *is* the method (phases 0–4, fix-step loop, hard rules), and the pipeline prompt is merely the instance data. Without the rubric, the agent has no methodology and improvises. `implement.md` is a **loop agent**: its rubric is a standalone protocol for pipeline-free autonomous use — the 9999-numbered behaviors exist precisely *because* there is no pipeline directing the work. When a pipeline node does direct the work, those behaviors become noise or worse, contradictions. The current `rawPrompt = node.prompt ?? node.label ?? config.prompt` drop is *correct* for loop agents and *incorrect* for procedure agents. Neither T0700's "always prepend" nor the current "always drop" handles both archetypes. Only an explicit declaration by the agent author does — and the agent author already has the right mental model when writing the rubric; the frontmatter just needs a place to record it.

The agent-handler change is minimal. `AgentConfig` gains one optional field. The handler reads it before assembling the prompt. No new subsystems, no behavioral ambiguity.

## Revised Implementation Steps

1. **Add `pipeline_rubric` to `AgentConfig`** in `src/cli/lib/agent.ts` (or wherever `AgentConfig` is typed): `pipeline_rubric?: "include" | "exclude"`. Default is `"exclude"` — backward compatible.

2. **Parse the field from agent frontmatter** in `src/cli/lib/agent-registry.ts` (wherever `.md` frontmatter is read into `AgentConfig`). No-op for any agent that omits it.

3. **Apply in `agent-handler.ts`**: after `rawPrompt = node.prompt ?? node.label ?? config.prompt`, add a three-line branch: if `config.pipeline_rubric === "include"` and `node.prompt` was set (i.e. rubric was displaced), prepend `config.rubricBody + "\n\n"` before the assembled prompt. `config.rubricBody` is the raw markdown body of the agent's `.md` file — already read during registry resolution.

4. **Mark procedure agents with `pipeline_rubric: include`** in their frontmatter: `tmux-tester.md`, `verifier.md`, `memory-writer.md`, `chat-summarizer.md`, `explainer.md`, `change-explainer.md`, `design-writer.md`, `plan-writer.md`. Leave `implement.md` without the field.

5. **Add a unit test** in `src/attractor/tests/agent-handler.test.ts` asserting that: (a) an agent with `pipeline_rubric: include` and `node.prompt=` set receives a prompt that starts with the rubric body; (b) an agent without the field (or with `exclude`) produces a prompt identical to current behavior.
