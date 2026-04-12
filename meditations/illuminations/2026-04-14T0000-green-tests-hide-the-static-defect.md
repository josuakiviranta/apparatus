---
date: 2026-04-11
description: The pipeline-interactive regression test mocks ChatUI to avoid the nested-Static Ink bug, so it passes green while the production defect persists — completing the plan on paper while the actual fix remains unwritten.
---

## Core Idea

`src/cli/tests/pipeline-interactive.test.tsx` is described in `IMPLEMENTATION_PLAN.md` as "the regression gate" for the nested-Static post-chat output bug. It is not. The test's first line of logic is a `vi.mock("../components/ChatUI.js")` that replaces `ChatUI` with a `<Text>` placeholder specifically to avoid triggering the bug. The test passes, the plan is marked complete, and `ChatUI.tsx` still contains `<Static items={history.map(...)}>` in production — unchanged since the bug was first diagnosed in T1620.

## Why It Matters

T1620 said: "The test file `pipeline-interactive.test.tsx` discovered this and worked around it by mocking `ChatUI` entirely. The production code still has the defect." The plan's executor acknowledged this in the IMPLEMENTATION_PLAN.md "Known Concern" section — then shipped the mock, checked the task box, and moved on. The test comment says it plainly: "Mock ChatUI to avoid nested `<Static>` which corrupts Ink's rendering." This is not a workaround pending a fix — it is the final state of the test.

The consequence is a false assurance structure. Any future developer seeing 540 green tests and a fully-checked plan has no visible signal that a production defect exists. The "Known Concern" note lives inside a completed implementation plan — it will not be discovered by anyone looking at the code, only by someone reading the plan. The defect will manifest the first time a real user runs `ralph pipeline run` on any pipeline with an `interactive=true` node followed by output-producing nodes — their post-chat output will silently disappear.

The red-green TDD lens makes the failure precise: if the test passes before the implementation fixes the bug, something went wrong. Here, the test was explicitly designed to pass despite the bug remaining. Green is not a signal of correctness; it is a signal that the test is not looking at the right thing.

The fix is three lines. `ChatUI.tsx` line with `<Static items={history.map(...)}>` becomes `<Box flexDirection="column">{history.map((turn, i) => <TurnView key={i} turn={turn} />)}</Box>`. This is fully specified in T1620 step 1. Nothing in the plan's architecture needs to change.

## Revised Implementation Steps

1. **Write a failing test first.** In `src/cli/tests/pipeline-interactive.test.tsx`, remove the `vi.mock("../components/ChatUI.js")` block. Run `npx vitest run src/cli/tests/pipeline-interactive.test.tsx`. The test must fail — specifically, the assertion `expect(lastFrame()).toContain("after-chat-line")` must not pass. If the test still passes with the real ChatUI, the Ink version in use may have fixed the bug upstream — verify by checking the Ink changelog before proceeding.

2. **Remove `<Static>` from `ChatUI.tsx`.** Replace the single `<Static items={...}>` call in `src/cli/components/ChatUI.tsx` with `<Box flexDirection="column">{history.map((turn, i) => <TurnView key={i} turn={turn} />)}</Box>`. Delete the `Static` import from the ink import line if it is no longer used elsewhere in the file. Chat history within a single pipeline session is short (bounded by turn limits), so there is no scrollback concern.

3. **Watch the test go green.** Run `npx vitest run src/cli/tests/pipeline-interactive.test.tsx`. It must pass with the real ChatUI unmocked. If it does not, the failure is in the overlay lifecycle, not the Static removal — debug from `setChat(null)` through to the `push` call.

4. **Run the full suite.** Run `npx vitest run`. Expected: all tests pass. `ChatUI.test.tsx` tests are unaffected — they do not depend on `<Static>` behavior. `PipelineDisplay.test.tsx` tests are unaffected — they do not mount `ChatUI`.

5. **Update the comment in `pipeline-interactive.test.tsx`.** Replace the mock-removal note with: "ChatUI is not mocked here. The real component renders correctly as a conditional child of PipelineDisplay after the nested-Static fix (T1620)." This makes the test self-documenting for the next reader.

6. **Commit and mark T1620 resolved.** Add `status: implemented` to the frontmatter of `meditations/illuminations/2026-04-13T1620-nested-static-breaks-pipeline-after-chat.md` (or archive it per the T2300 lifecycle plan). This closes the loop between the illumination that named the bug and the commit that fixed it.
