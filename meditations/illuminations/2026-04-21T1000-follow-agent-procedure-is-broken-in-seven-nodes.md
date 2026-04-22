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

## Revised Implementation Steps (2026-04-21 — spider/web lens)

The original archetype-flag approach is rejected by the spider/web model (`memory/user-spider-web-mental-model.md`). Universal prepend applies to every agent, including `implement`. The apparent conflict with implement's standalone push/study-specs/update-plan behavior is a pipeline-misdesign problem, not a handler problem — `illumination-to-implementation.dot` is puppeting the spider via suppression clauses. Fix the pipeline and the handler together; do not introduce a classification flag.

1. **Universal prepend in `agent-handler.ts`** (around line 62–76): capture `rubricBody = config.prompt` before the `rawPrompt` line. When `node.prompt` or `node.label` is set (rubric was displaced), assemble as `rubricBody + "\n\n---\n\n" + preamble + jsonWrappedPrompt`. Otherwise the current path (`preamble + jsonWrappedPrompt`, where `rawPrompt === config.prompt` already) is unchanged. No frontmatter flag, no `AgentConfig` field, no per-agent opt-in. The fix applies to all 9 agents uniformly.

2. **Redesign `illumination-to-implementation.dot` to stop puppeting the spider.** This is the paired fix; universal prepend without it would restore the rubric and then contradict it with the current `implement` node's "Do NOT push" override.
   - Delete the `commit_push` tool node and its incoming/outgoing edges. Commit+push is spider autopilot; running it as a sibling of `implement` is the misdesign.
   - Strip suppression clauses from the `implement` node's `prompt=` ("Do NOT push", "Do NOT modify files outside the scope of the plan"). Replace with a fly-handoff: "Execute the plan at `$plan_path`."
   - Audit `memory_writer`: if it records the spider's code changes, fold into implement's autopilot. If it records pipeline-run state (which illumination dispatched, which gate outcomes, which smoke passed), keep as a web strand — legitimate web work at a different layer from the spider's own memory updates.
   - Leave `capture_pre_sha` / `compute_changed_surfaces` (T0300) intact — they are web-strand verification inputs for `tmux_tester`, not spider puppeteering.

3. **Write one unit test** in `src/attractor/tests/agent-handler.test.ts`: for ANY agent, when `node.prompt=` is set, the assembled prompt begins with the rubric body followed by `---`. One test, no flag variants.

4. **Verify `tmux-tester.md`'s Phase 2 edit now executes** by running `pipelines/smoke/tmux-tester.dot` and confirming the graceful `$verification_targets` fallback path is reachable.

5. **Update `specs/pipeline.md`** to document the prepend contract: agent rubrics are always delivered in pipeline context. Pipelines must not encode instructions that contradict the rubric. If they need to, fix the rubric or pick a different agent — do not puppet via suppression.

6. **(Future lint.)** Add a `ralph pipeline validate` rule that flags node `prompt=` strings containing negations ("Do NOT X") that contradict the agent rubric's affirmative directives. Catches spider-puppeteering drift at authoring time.
