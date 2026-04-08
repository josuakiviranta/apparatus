---
date: 2026-04-08
description: The meditate.ts test suite verifies every internal function in isolation but has no cross-file contract tests — so tool registration gaps (missing list_illuminations) and output pipeline divergence (inline parser instead of stream-formatter) both went undetected despite full coverage.
---

## Core Idea

`meditate.test.ts` has thorough unit tests for every function in `meditate.ts`: PID management, gitignore appending, MCP config writing, arg construction, subprocess exit codes. All local behavior is tested. But neither of meditate's two cross-file contracts is verified: (1) that `buildMeditationArgs --allowedTools` is a superset of the tools registered in `illumination-server.ts`, and (2) that `runMeditationSession` output format matches what `stream-formatter.ts` produces. Both contracts are implicit, undocumented, and uncheckable from inside any single file's test. Both have already failed.

## Why It Matters

The `buildMeditationArgs` tests in `meditate.test.ts` check individual tools by name (`expect(allowed).toContain("mcp__illumination__write_illumination")`), but never enumerate the complete allowed set against a ground truth. `illumination-server.ts` now registers 7 tools. `buildMeditationArgs` allows 6. There is no test that would catch that mismatch — only a test that says "this one tool I remembered to mention is present." The 0.0.26 commit that added `list_illuminations` to the server is the proof: it passed all tests, produced a working build, and shipped with the tool completely unreachable in production.

The inline parser situation is the mirror image: `runMeditationSession` has one test for its output path. It asserts `expect(written).toContain("→ [tool] read_file")`. This test is *passing* right now — which means it is actively locking in the inline parser behavior the 1700 illumination proposes to delete. When a developer follows 1700's steps, this test will fail. They won't be warned. They'll either revert or patch around it without understanding what they broke.

Both gaps follow the same shape: a local test that says "a thing I know about is present" instead of "the complete set matches the canonical source."

The CRUD lens clarifies what was skipped: registering an MCP tool in the server is the *create* step. Adding it to `buildMeditationArgs` is the *wire* step. Asserting the complete allowedTools list is the *verify* step. 0.0.26 did create, skipped wire, skipped verify. The test suite had no checklist.

## Revised Implementation Steps

1. **Fix `buildMeditationArgs` immediately (1-line).** Add `"--allowedTools", "mcp__illumination__list_illuminations"` to the list in `src/cli/commands/meditate.ts`. This is the fix from the 1500 illumination. Do it first — it unblocks every meditation session.

2. **Replace the individual `buildMeditationArgs` `allowedTools` tests with one complete-set test.** In `src/cli/tests/meditate.test.ts`, replace the scattered `toContain("mcp__illumination__X")` tests with a single assertion:
   ```ts
   it("allows exactly the tools registered in illumination-server.ts", () => {
     const registeredTools = [
       "write_illumination", "read_file", "glob_files", "project_tree",
       "list_meta_meditations", "read_meta_meditation", "list_illuminations",
     ];
     const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
     const allowed = args.filter((_, i) => args[i - 1] === "--allowedTools");
     for (const tool of registeredTools) {
       expect(allowed).toContain(`mcp__illumination__${tool}`);
     }
   });
   ```
   This test will fail whenever a new tool is registered but not wired. It is a drift detector.

3. **Update the `runMeditationSession` output test to expect stream-formatter format.** Change the existing stub test from asserting `"→ [tool] read_file"` to asserting `"▶▶▶ MAIN AGENT"`. This makes the test fail now (before the 1700 fix) and pass after. It locks in the *new* contract instead of the old one.

4. **Implement the inline parser replacement from 1700.** Replace the `JSON.parse` loop in `runMeditationSession` with `processLine` / `flushState` from `stream-formatter.ts`. The updated test from step 3 will turn green. The old `→ [tool]` test is gone, so there's no false red.

5. **Add a comment above the `--allowedTools` block in `buildMeditationArgs`.** Something like: `// Must match tools registered in illumination-server.ts. Update test enumerations too.` The comment makes the contract visible at the call site; the test makes it enforceable.
