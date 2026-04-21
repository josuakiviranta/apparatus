---
date: 2026-04-21
status: open
description: 7 of 9 agent nodes in illumination-to-implementation.dot contain "Follow your agent-level procedure" — every one is a silent broken cross-reference because agent-handler drops the rubric body whenever node.prompt= is set, making the procedure layer of the pipeline structurally inert.
---

## Core Idea

7 of 9 agent nodes in `illumination-to-implementation.dot` contain the phrase "Follow your agent-level procedure" (or "Follow your agent-level rubric / format / harness helpers"). Every one is a broken pointer. `agent-handler.ts` drops `config.prompt` (the rubric body) whenever `node.prompt=` is set — the assembled prompt is `preamble + node_task` only. The rubric exists in the `.md` files but never reaches the running agent when dispatched from a pipeline node. The procedure layer of the pipeline is entirely inert.

The recently modified `src/cli/agents/tmux-tester.md` (untracked in git) is the clearest evidence: its Phase 2 section was updated to gracefully prefer `$verification_targets` / `$changed_files` / `$touched_surfaces` when supplied by upstream nodes. That improvement is dead on arrival — the rubric body containing it never reaches the agent in pipeline context.

## Why It Matters

T0900 framed `pipeline_rubric: include|exclude` as a design choice for agent authors. The 7-of-9 count reframes it: these nodes were *authored* with rubric-first semantics. The rubric was written first as the standing procedure; the node `prompt=` was written second as "do THIS specific thing." The intent was layering — procedure in the rubric, task in the node prompt. The agent-handler implemented it backwards: task replaces procedure instead of extending it.

The affected nodes and agents:

| Node | Agent | Broken phrase |
|------|-------|--------------|
| `verifier` | verifier | "Follow your agent-level rubric … and procedure" |
| `explainer` | change-explainer | "Follow your agent-level format and procedure" |
| `chat_session` | chat-refiner | "Follow your agent-level format and append rule" |
| `design_writer` | design-writer | "Follow your agent-level procedure: derive …" |
| `plan_writer` | plan-writer | "Follow your agent-level procedure: derive …" |
| `tmux_tester` | tmux-tester | "Follow your agent-level procedure and harness helpers" |
| `memory_writer` | memory-writer | "Follow your agent-level procedure:" |

The `implement` and `chat_summarizer` nodes have full standalone instructions in `prompt=` — no rubric reference — making them the only nodes correctly designed for the current architecture.

`tmux-tester` is the most critical gap: the harness bash block, phase procedure (0–4), and hard rules ("no git push", "no cleanup_run") live exclusively in the rubric. The node prompt says "follow your harness helpers" but provides none. The agent is flying without its instruments.

## Revised Implementation Steps

1. **Add `pipeline_rubric: include` frontmatter** to the 7 affected agent `.md` files: `verifier.md`, `change-explainer.md`, `chat-refiner.md`, `design-writer.md`, `plan-writer.md`, `tmux-tester.md`, `memory-writer.md`. Add `pipeline_rubric: exclude` to `implement.md` (loop agent — rubric encodes standalone git-push behavior that pipeline suppresses via node prompt).

2. **Extend `AgentConfig`** to carry the parsed `pipelineRubric` flag. In `agent-registry.ts` / wherever the `.md` frontmatter is parsed, read the field and include it in the returned config.

3. **Update `agent-handler.ts`** (around line 62–70): when `config.pipelineRubric === "include"`, prepend the rubric body before the preamble. Final prompt order: `rubric_body + "\n\n" + preamble + jsonWrappedPrompt`. When `exclude` or unset (default), current behavior unchanged.

4. **Write one unit test** in `src/attractor/tests/agent-handler.test.ts` asserting that an include-flagged agent's assembled prompt begins with the rubric body when `node.prompt=` is set. One test for exclude/default confirming rubric body is absent.

5. **Verify `tmux-tester.md`'s recent Phase 2 edit now executes** by running the `tmux-tester` smoke (`pipelines/smoke/tmux-tester.dot`) and confirming the graceful `$verification_targets` fallback path is reachable in the rubric's Phase 2 section.

6. **Do not touch node `prompt=` strings** in `illumination-to-implementation.dot` — the "Follow your agent-level procedure" phrases become correct and self-documenting once the rubric is present. No rewrites needed.
