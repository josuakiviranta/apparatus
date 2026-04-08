---
date: 2026-04-08
description: The buildMeditationArgs test suite verifies each known tool is present but has no complete-set test, so adding a new MCP tool without wiring it into allowedTools produces zero failures — the scenario run from 2026-04-07 confirms 31 tests passing, which is evidence the list was complete before list_illuminations existed, not that it is complete now.
---

## Core Idea

The `buildMeditationArgs` tests in `src/cli/tests/meditate.test.ts` are additive-only: each test asserts that a specific known tool IS present in the `--allowedTools` list. But no test enumerates the complete expected set. This creates an omission blindspot: adding a tool to `illumination-server.ts` without adding it to `buildMeditationArgs` produces zero test failures. The scenario run from 2026-04-07 shows all 31 tests green — but those 31 tests were written before `list_illuminations` existed. The green signal is a frozen snapshot of completeness at an earlier moment, not live evidence that the current list is correct.

The specific tests in the run are:
- `allows the three MCP read/glob/tree tools` — passes
- `allows the MCP illumination tool` — passes (checks `write_illumination`)
- `includes mcp__illumination__list_meta_meditations in allowedTools` — passes
- `includes mcp__illumination__read_meta_meditation in allowedTools` — passes

`list_illuminations` was registered in `illumination-server.ts` at 0.0.26. No test was added for it. The test suite has been passing ever since, with no awareness of the gap.

## Why It Matters

This is the mechanical explanation for why `list_illuminations` is still missing from `buildMeditationArgs` today — two sessions after illumination 1300 identified it. The omission produced no red signal. There was no broken test, no CI failure, no runtime error. The current test architecture cannot catch this class of gap.

The scenario run is concrete evidence of the problem. It was run on 2026-04-07, one day before `list_illuminations` shipped and one day before the Ink migration was tagged 0.0.28. Its 31 passing tests say nothing about whether the post-0.0.26 allowedTools list is correct. Yet the scenario run file exists, looks like evidence of health, and will be read by future sessions as confirmation that `buildMeditationArgs` is well-tested. It is well-tested for 2026-04-06. It is not well-tested for today.

This pattern will recur every time a new MCP tool is added. The fix is structural, not a one-time patch.

## Revised Implementation Steps

1. **Write a complete-set enumeration test for `buildMeditationArgs`.** In `src/cli/tests/meditate.test.ts`, add one test that extracts all `--allowedTools` values from the returned args array and asserts exact equality against the full expected set:

   ```typescript
   it("allowedTools is exactly the registered MCP tool set", () => {
     const args = buildMeditationArgs("/proj", "prompt", "/mcp.json");
     const allowed = args.filter((_, i) => args[i - 1] === "--allowedTools");
     expect(new Set(allowed)).toEqual(new Set([
       "mcp__illumination__read_file",
       "mcp__illumination__glob_files",
       "mcp__illumination__project_tree",
       "mcp__illumination__write_illumination",
       "mcp__illumination__list_meta_meditations",
       "mcp__illumination__read_meta_meditation",
       "mcp__illumination__list_illuminations",
     ]));
   });
   ```

   This test is red immediately, before touching `meditate.ts`. It becomes the correct starting state for the repair session.

2. **Add `list_illuminations` to `buildMeditationArgs`.** One line, same pattern as the existing entries. The enumeration test from step 1 turns green.

3. **Re-run the scenario test and commit a new scenario run.** The existing run at `scenario-runs/2026-04-07T1625-meditate-session-orchestration.md` predates `list_illuminations` and predates the Ink migration. Run `./scenario-tests/test-meditate-session.sh`, capture the output, and write a new `scenario-runs/` file. The new run is the first post-migration evidence of health.

4. **Add a comment to `buildMeditationArgs` naming the invariant.** Something like: `// Must stay in sync with tools registered in illumination-server.ts — see enumeration test`. The comment makes the two-part deployment requirement visible at the call site.

5. **Do not delete the per-tool individual tests.** They verify specific tools by name and serve as documentation. Keep them alongside the new enumeration test. The enumeration test catches future omissions; the individual tests catch regressions in specific entries.
