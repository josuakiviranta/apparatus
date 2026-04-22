---
date: 2026-04-21
status: superseded
superseded_by: memory/user-spider-web-mental-model.md
superseded_at: 2026-04-21
description: The pipeline has two implicit node-authoring conventions — inline-procedure (prompt= contains the full task) and reference-procedure (prompt= defers to the rubric with "Follow your agent-level procedure") — but the engine treats both identically, dropping the rubric in both cases and making all 7 reference-procedure nodes structurally broken.
---

## Superseded by spider/web mental model (2026-04-21)

The "two conventions" framing is an artifact of a misdesigned pipeline, not a real authoring pattern. The user's spider/web model (`memory/user-spider-web-mental-model.md`) names every agent's rubric as the method; the handler should always deliver it. `implement`'s apparent "inline-procedure" convention exists because `illumination-to-implementation.dot` encodes suppression clauses ("Do NOT push", "Do NOT modify files outside the scope of the plan") that contradict the spider's autopilot, and the rubric-drop bug (T0600) made the contradiction invisible. Fix the pipeline, apply T0700 universally, and the two-convention illusion resolves. No archetype classification, no lint rule for "which convention does this node use" — just universal delivery and a pipeline that stops puppeting the spider. See T1000 for the revised implementation steps.

## Core Idea (original, retained for history)

Two authoring conventions coexist silently in `illumination-to-implementation.dot`. Inline-procedure nodes (`implement`, `chat_summarizer`) embed the full task in `prompt=` and are self-contained. Reference-procedure nodes (the other 7) end with "Follow your agent-level procedure and harness helpers" — their `prompt=` is intentionally minimal, treating the rubric as the load-bearing spec. The engine drops the rubric whenever `node.prompt=` is set, making no distinction. All 7 reference-procedure nodes are structurally broken: the agent receives a 3-line task stub where it expects its complete operating manual.

The breakage is most severe for `tmux_tester`, whose rubric is 300 lines of harness bash, multi-phase cycle structure, fix-step procedure, and hard rules. Without rubric inclusion, the agent must invent its own tmux driving idioms from scratch every run — and it gets them wrong (T2800's wrong-surface selection, T1000's pattern).

## Why It Matters

The two conventions are detectable by a string scan — any node `prompt=` containing `"Follow your agent-level"` marks a reference node. Running `grep -n "Follow your agent-level" pipelines/illumination-to-implementation.dot` surfaces all 7 in one shot. The fix T0900 proposed (`pipeline_rubric: include|exclude` frontmatter) is the right resolution, but the classification of which agent gets which flag is already encoded in the pipeline — no guesswork needed.

The "comprehensive docs are agent fuel" lens applies here: `tmux-tester.md`'s harness section is compressed context — the agent cannot drive tmux correctly without the `wait_stable`/`capture` helpers and phase structure any more than it could call an API without docs. The current rubric-drop is equivalent to giving the agent an undocumented API and telling it to "follow the procedure."

The inline-procedure convention is also correct — `implement` node deliberately overrides the standalone rubric (which would git-push, create tags, study 500 specs) with a focused plan-execution task. That suppression must be intentional and documented, not accidental.

## Revised Implementation Steps

1. **Add `pipeline_rubric: include` frontmatter** to: `verifier.md`, `change-explainer.md`, `design-writer.md`, `plan-writer.md`, `chat-refiner.md`, `tmux-tester.md`, `memory-writer.md`. These are the 7 reference-procedure agents — their rubric is the spec.

2. **Add `pipeline_rubric: exclude` frontmatter** to `implement.md`. Documents the intentional suppression: standalone rubric behaviors (git push, tag creation, 500-subagent study pass) must not bleed into pipeline-scoped task execution.

3. **Implement the flag in `agent-handler.ts`**: after resolving `config`, read `pipeline_rubric` from frontmatter. When `include`, prepend `config.prompt + '\n\n---\n\n'` before the assembled node prompt. When `exclude` (or absent on a node with explicit `prompt=`), current behavior unchanged.

4. **Add lint rule to `ralph pipeline validate`**: flag any node whose `prompt=` contains `"Follow your agent-level"` where the resolved agent file lacks `pipeline_rubric: include`. This catches future authoring drift — new agents added in the reference-procedure style without the flag set.

5. **No default needed**: the lint rule ensures explicit classification. Unclassified agents that don't reference "Follow your agent-level" are inline-procedure by definition and need no flag.
