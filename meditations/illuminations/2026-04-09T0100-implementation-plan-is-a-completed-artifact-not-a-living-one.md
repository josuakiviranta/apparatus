---
date: 2026-04-08
description: IMPLEMENTATION_PLAN.md describes completed stream-formatter work while the actual next work (meditate.ts two-file repair) lives only in scattered illumination Revised Implementation Steps sections — the project's primary planning artifact has become a graveyard, not a guide.
---

## Core Idea

`IMPLEMENTATION_PLAN.md` currently documents the stream-formatter fix — fully complete, every checkbox checked, committed as `9fb0ab1`. It is an archive, not a plan. The actual pending work (fix `buildMeditationArgs` to include `list_illuminations`, replace the inline parser in `runMeditationSession` with `processLine`/`flushState`, apply the same fix to `new.ts::runKickoffSession`) exists only as "Revised Implementation Steps" sections inside illumination files. A developer opening the project tomorrow would read the plan file, see nothing actionable, and not know where to look. The illuminations are diagnosis files; `IMPLEMENTATION_PLAN.md` is the execution file. The execution file is empty.

The `proof-of-work / proof-of-usage` lens sharpens this. Eight illuminations accumulated today. Each one produced evidence of analysis. None of that analysis is proof that implementation will happen. The plan file is the mechanism that converts illumination into action — and it points at completed work.

## Why It Matters

The full repair is two files, ~35 lines, one commit. It is as well-characterized as any work in this codebase. Illumination 2100 gives the exact steps. Illumination 2300 extends them to `new.ts`. Illumination 1900 has the precise test assertion to change. The diagnostic overhead is already done. The only thing missing is a structured execution plan that a developer or agent can follow without reconstructing the work from 8 separate files.

There is also a secondary observation about the tests. Illumination 2100 claims the test `"emits tool-use indicator for tool_use stream events"` will *fail* when the inline parser is replaced — calling it "the contract that locks the inline parser in place." This is wrong. `processLine` routes non-Agent tool_use blocks through `formatToolUse`, which returns `→ [tool] read_file\n` via the default case. The test assertion `toContain("→ [tool] read_file")` would *pass* after the fix — as a false green. The test is not a lock. It is a gap: it asserts old format behavior that the new implementation happens to satisfy by coincidence. The real contract test to write is one that asserts `▶▶▶ MAIN AGENT` appears in tool_use output — the new format requires the MAIN AGENT header. That test currently does not exist.

## Revised Implementation Steps

1. **Replace IMPLEMENTATION_PLAN.md with the pending repair plan.** Archive or delete the stream-formatter content. Write a new plan with two tasks: (a) the `meditate.ts` repair (allowedTools + inline parser replacement), and (b) the identical repair in `new.ts::runKickoffSession`. Draw the step-by-step content from illuminations 2100 and 2300. The plan becomes the execution entry point.

2. **Fix `buildMeditationArgs` first (1 line, immediate unblock).** Add `"--allowedTools", "mcp__illumination__list_illuminations"` to `src/cli/commands/meditate.ts`. This is independent of the inline parser fix. It unblocks all meditation sessions now. Do not bundle it into a larger PR — ship it alone.

3. **Write the correct regression test before replacing the inline parser.** In `src/cli/tests/meditate.test.ts`, add a test that passes a `{ type: "assistant", message: { content: [{ type: "tool_use", name: "read_file" }] } }` line through `runMeditationSession` and asserts `written.toContain("▶▶▶ MAIN AGENT")`. This test fails before the fix. Do not change the existing `→ [tool] read_file` assertion — it will pass through the transition as a free confirmations that the tool name rendering still works.

4. **Replace the inline parser in `runMeditationSession`.** Import `{ processLine, initialState, flushState }` from `../lib/stream-formatter`. Replace the manual chunk buffer + `JSON.parse` loop with a `readline.createInterface` on `child.stdout` (matching the `loop.ts` pattern exactly). Call `flushState` in the close handler and write output. The new regression test from step 3 turns green.

5. **Apply the same fix to `new.ts::runKickoffSession`.** Identical transformation. Illumination 2300 named this target; no other illumination includes it in its repair steps. Do not commit `meditate.ts` without also patching `new.ts` — both will otherwise diverge permanently.

6. **Add `scenario-runs/` to ralph-cli's own `.gitignore`.** One line. The `new.ts` scaffold already knows this directory should be ignored (it writes that rule for every new project). The host project does not apply its own rule. The directory currently shows as untracked in `git status`.

7. **Update IMPLEMENTATION_PLAN.md to complete status** once the above commit lands, and add a new chunk if additional work is identified. The plan file is the project's living memory for what to build next — keep it pointing at work that isn't done.
