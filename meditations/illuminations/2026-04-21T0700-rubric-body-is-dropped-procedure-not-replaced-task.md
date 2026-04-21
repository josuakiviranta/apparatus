---
date: 2026-04-21
status: open
description: agent-handler.ts discards the rubric body whenever node.prompt= is set — the fix is a one-line prepend that injects the rubric as a preceding section, making "Follow your agent-level procedure" a live reference instead of a broken pointer.
---

## Core Idea

`agent-handler.ts` resolves the agent config (rubric body lands in `config.prompt`), then immediately overwrites it: `const rawPrompt = node.prompt ?? node.label ?? config.prompt`. Every pipeline node that sets `prompt=` silently discards the rubric body. "Follow your agent-level procedure" is a dead reference — those instructions never reach Claude. The fix is one change to the prompt assembly block: when `node.prompt` was the source, prepend `rubricBody + "\n\n---\n\n"` before the preamble + task. No CLI changes, no new attributes, no agent reauthoring.

## Why It Matters

The rubric body is compressed procedure — exactly what the meta-meditation "comprehensive-docs-are-agent-fuel" describes. It contains the operating manual Claude needs to act correctly. When it's dropped, Claude guesses. The cost scales with rubric length and complexity.

`tmux-tester` is the worst-case example. Its rubric (`src/cli/agents/tmux-tester.md`) is ~200 lines: the bash harness definition, four numbered phases, idempotency rules, commit/push discipline, and a list of hard rules (do NOT kill the window, do NOT spawn new sessions, do NOT push). Its node prompt in `pipelines/illumination-to-implementation.dot` is ~100 words ending with "Follow your agent-level procedure and harness helpers." Without the prepend fix, Claude receives none of those 200 lines and must improvise. Improvised harness setup, ignored phases, and guessed hard rules explain every observed tmux-tester anomaly.

The full code trace is:
1. `agent-registry.ts:parseAgentFile` → `config.prompt = body` (rubric body)
2. `agent-handler.ts:55` → `const rawPrompt = node.prompt ?? node.label ?? config.prompt` → rubric body evicted
3. `agent-handler.ts:62` → `const prompt = preamble + jsonWrappedPrompt` → rubric body absent
4. `agent.ts:run()` → `child.stdin.write(expandedPrompt)` → rubric body never reaches Claude

Every node in `illumination-to-implementation.dot` that delegates via "Follow your agent-level procedure" — `verifier`, `explainer`, `design_writer`, `plan_writer`, `tmux_tester`, `memory_writer` — is silently broken in the same way.

## Revised Implementation Steps

1. **In `src/attractor/handlers/agent-handler.ts`**, capture the rubric body before the rawPrompt line:
   ```typescript
   const rubricBody = config.prompt;  // save before potential override
   const rawPrompt = node.prompt ?? node.label ?? config.prompt;
   ```
   Then in the prompt assembly (currently `const prompt = preamble + jsonWrappedPrompt`), inject the rubric body when the node overrode it:
   ```typescript
   const nodeOverrodePrompt = !!(node.prompt || node.label);
   const prompt = nodeOverrodePrompt
     ? rubricBody + "\n\n---\n\n" + preamble + jsonWrappedPrompt
     : preamble + jsonWrappedPrompt;
   ```

2. **Write a failing unit test first** in `src/attractor/tests/agent-handler.test.ts`:
   - Create a node with `prompt="Run the task"` and an agent whose rubric body is `"Procedure: step A. Hard rule: never push."`
   - Assert the assembled prompt passed to `agent.create()` starts with the rubric body
   - Assert "Run the task" also appears after the separator

3. **Implement the change** (step 1) to make the test pass.

4. **Run the full test suite** (`npm test`) — no existing test should break since the rubric body was previously invisible to Claude and tests assert on node-level prompt content, not rubric content.

5. **Audit the six affected pipeline nodes** in `pipelines/illumination-to-implementation.dot` (`verifier`, `explainer`, `design_writer`, `plan_writer`, `tmux_tester`, `memory_writer`). Each ends with a procedure-delegation phrase. Confirm that after the fix each node's assembled prompt in `~/.ralph/runs/<id>/<node>/prompt.md` begins with the rubric body followed by `---`. This is a one-line grep check per node on a real run's trace.
