---
date: 2026-04-21
status: open
description: agent-handler.ts discards the rubric body whenever node.prompt= is set — the fix is a one-line prepend that injects the rubric as a preceding section, making "Follow your agent-level procedure" a live reference instead of a broken pointer.
---

## Addendum (2026-04-21 — spider/web lens)

The user's spider/web mental model (`memory/user-spider-web-mental-model.md`) confirms this illumination's universal-prepend approach. Follow-up illuminations T0800, T0900, and T1100 proposed blocking or conditioning the universal fix on an apparent loop-vs-procedure archetype split — under spider/web, that split dissolves. `implement.md`'s body is how the spider eats; prepending it is correct for every agent. The pipeline-side suppression clauses ("Do NOT push") in `illumination-to-implementation.dot` are misdesign to fix in the graph, not reasons to withhold the rubric from the agent. Step 5 below remains valuable as the post-fix audit — "Follow your agent-level procedure" becomes a live reference across all 7 affected nodes simultaneously once the prepend lands AND the pipeline stops puppeting the spider. See T1000 for the paired pipeline redesign.

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

1. **In `src/attractor/handlers/agent-handler.ts`**, capture the rubric body before the rawPrompt line and assemble with a labeled provenance section (replaces the earlier bare-`---` separator — the label tells the agent where the second block came from so "Follow your agent-level procedure" becomes a live pointer to the rubric above):

   ```typescript
   const rubricBody = config.prompt;                         // save before potential override
   const rawPrompt = node.prompt ?? node.label ?? config.prompt;
   const nodeOverrodePrompt = !!(node.prompt ?? node.label);
   const runId = ctx.values["run_id"] as string | undefined;

   const taskHeader = nodeOverrodePrompt
     ? `\n\n---\n\n## Task context\n\nSource: pipeline \`${dotFile}\`, node \`${node.id}\`, run \`${runId ?? "unknown"}\`.\n\n${preamble}\n\n## Task\n\n`
     : "";

   const prompt = nodeOverrodePrompt
     ? rubricBody + taskHeader + jsonWrappedPrompt
     : preamble + jsonWrappedPrompt;   // rawPrompt IS config.prompt; preamble precedes as today
   ```

   Three of the four provenance values are already in scope: `node.id` is on the `node` param, `runId` reads from `ctx.values["run_id"]` (injected by the engine at `src/attractor/core/engine.ts:140`), and `preamble` is the local variable already computed by `buildPreamble(...)` at `agent-handler.ts:65–68`.

   The fourth value, `dotFile`, needs one small addition — the handler has `meta.dotDir` (directory) but not the `.dot` basename. Extend `HandlerExecutionContext` in `src/attractor/handlers/registry.ts` to add `dotFile: string` next to `dotDir`, then populate it from the engine where the DOT source path is already resolved. Destructure `dotFile` alongside `dotDir` in the handler. One field, two call sites, no new types.

2. **Write a failing unit test first** in `src/attractor/tests/agent-handler.test.ts`:
   - Create a node with `prompt="Run the task"` and an agent whose rubric body is `"Procedure: step A. Hard rule: never push."`
   - Assert the assembled prompt passed to `agent.create()` starts with the rubric body
   - Assert "Run the task" also appears after the separator

3. **Implement the change** (step 1) to make the test pass.

4. **Run the full test suite** (`npm test`) — no existing test should break since the rubric body was previously invisible to Claude and tests assert on node-level prompt content, not rubric content.

5. **Audit the six affected pipeline nodes** in `pipelines/illumination-to-implementation.dot` (`verifier`, `explainer`, `design_writer`, `plan_writer`, `tmux_tester`, `memory_writer`). Each ends with a procedure-delegation phrase. Confirm that after the fix each node's assembled prompt in `~/.ralph/runs/<id>/<node>/prompt.md` begins with the rubric body followed by `---`. This is a one-line grep check per node on a real run's trace.
