---
date: 2026-04-06
description: '`meditate.ts` has been read. The four changes needed by Tasks 1 and 2 are not abstract — they are concrete, line-level diffs in a 180-line file.'
---

# The Exemplar Is Live and the Diffs Are Observable

## Core Idea

`meditate.ts` has been read. The four changes needed by Tasks 1 and 2 are not abstract — they are concrete, line-level diffs in a 180-line file. `runMeditationSession` is declared but not exported. `spawn("claude", ...)` is hardcoded with no `RALPH_TEST_CMD` override. The close handler resolves without checking the exit code. The stream parser handles `text` blocks but not `tool_use` blocks. An executing agent does not need to consult the plan, amend it, or reconcile illuminations to make these four changes — it can read `meditate.ts` and make them directly.

## Why It Matters

Twenty-seven illuminations have been written about the run-scenarios plan. At least three (`T1300`, `T1500`, this one) diagnose the stasis: the observation loop has no exit node. Every session identifies the gap between illumination space and plan file space, then writes the diagnosis into illumination space. The plan remains unchanged. `run-scenarios.ts` does not exist.

The meditation loop is a graph with no termination condition (per `the-agentic-loop-is-a-graph`). The meditation agent can write to `meditations/illuminations/` only. It cannot patch `docs/superpowers/plans/2026-04-05-run-scenarios.md`. It cannot create `src/cli/commands/run-scenarios.ts`. The escape route (per `every-action-needs-an-escape`) was never built into the meditation protocol — there is no transition condition that moves from "observation" to "execution." Each session enters the observation node and exits by writing another illumination.

The six amendments in `T0800` are correct and necessary. But an executing agent doesn't need them to be embedded in the plan file. It needs: (a) the four concrete diffs to `meditate.ts`, and (b) the instruction to derive `runScenarioSession` from `meditate.ts` as it exists after those diffs. Both are available now. The plan is a secondary artifact. The exemplar is the primary one.

The SIGINT handler in `meditate.ts` is already written and works. Lines 122–127:
```typescript
const cleanup = () => {
  child.kill("SIGTERM");
  removePid(absPath);
  cleanupMcpConfig(mcpConfigPath);
};
process.once("SIGTERM", cleanup);
process.once("SIGINT", cleanup);
```
Task 7's `runScenarioSession` can inherit this pattern with `removePid` and `cleanupMcpConfig` removed. No shared state, no `onSpawn` callback, no cross-function flag. The amendment debate in `T1500` is resolved by reading the file that already has the answer.

## Revised Implementation Steps

These steps are addressed to the next executing agent, not the next meditating session.

1. **Read `src/cli/commands/meditate.ts` in full before touching any file.** The SIGINT pattern, the stream parser shape, the permission model (`--permission-mode dontAsk`, `--allowedTools` flags), and the close handler are all there. `runScenarioSession` is a structural derivative of `runMeditationSession` — fewer flags, no MCP config, no PID management.

2. **Make the four diffs to `meditate.ts` (Tasks 1–2):**
   - Add `export` to `runMeditationSession` declaration
   - Replace `spawn("claude", args, ...)` with `const cmd = process.env.RALPH_TEST_CMD ?? "claude"; spawn(cmd, args, ...)`
   - Update the close handler to check exit code: `child.on("close", (code) => { ...; if (code !== 0) process.stderr.write(\`Warning: claude exited with code \${code}\n\`); res(); })`
   - Add `else if (block.type === "tool_use") { process.stdout.write(\`\n→ [tool] \${block.name}\n\`); }` to the stream parser

3. **Write `runScenarioSession` by direct analogy from `meditate.ts`, not from the plan's Task 7 code block.** The plan's Task 7 code block was written before the T0800 amendments and contains three bugs: `--dangerously-skip-permissions` instead of `--permission-mode dontAsk`, no `RALPH_TEST_CMD` override, and no SIGINT handler. The plan's code is stale. `meditate.ts` (post-diff) is current.

4. **Add `RALPH_TEST_CMD` override and three subprocess tests for `runScenarioSession` before writing its implementation.** Mirror the test structure from `meditate.test.ts` Task 2 block: stub exiting 1 emits stderr warning; stub exiting 0 does not; stub emitting a `tool_use` stream line produces `→ [tool]` output. These tests are the escape hatch the plan is missing — they verify the session runner without invoking the real `claude` binary.

5. **Add `existsSync(outPath)` check after each `await runScenarioSession(...)` call.** If the file was not written, emit a stderr warning. Do not print the Done message. Claude can exit 0 without writing the report — permission failures and prompt errors both produce this outcome.

6. **Do not write another illumination about this plan.** The observation work is complete. `T0800` contains every amendment. `meditate.ts` contains the SIGINT answer. This illumination adds the concrete diffs. The next action is `src/cli/commands/meditate.ts` open in an editor, not `write_illumination`.
