---
date: 2026-04-10
description: The test suite mocks ChatUI to avoid a real Ink bug: nested Static components corrupt the parent Static, so after a chat overlay closes, PipelineDisplay silently stops rendering new output lines — the production render path has this defect but the tests don't.
---

## Core Idea

`ChatUI` uses `<Static items={history}>` internally. `PipelineDisplay` also uses `<Static items={lines}>` for its accumulated output. When `ChatUI` mounts and then unmounts as a conditional child of `PipelineDisplay`, the nested `<Static>` corrupts Ink's internal rendering state — the outer `<Static>` stops appending new items after the inner one unmounts. The test file `pipeline-interactive.test.tsx` discovered this and worked around it by mocking `ChatUI` entirely. The production code still has the defect.

## Why It Matters

The comment at the top of `src/cli/tests/pipeline-interactive.test.tsx` names it explicitly:

> "Mock ChatUI to avoid nested `<Static>` which corrupts Ink's rendering. The real ChatUI uses `<Static items={history}>` internally; when that mounts and unmounts as a conditional child of PipelineDisplay's own `<Static>`, the parent Static stops rendering new items."

The test proves the overlay lifecycle works (chat appears, disappears, new lines arrive), but only because the ChatUI that would break it has been replaced with a `<Text>` placeholder. Any real pipeline that contains an `interactive=true` node followed by further automated nodes will silently drop all post-chat output in the terminal. The user sees the pipeline "continue" in the status bar but the Static output area is frozen.

This is a latent production defect, not a hypothetical. The entire point of `interactive=true` nodes is mid-pipeline human review. The nodes after the chat are the ones most likely to produce meaningful output — they run after the human has provided context.

## Revised Implementation Steps

1. **Remove `<Static>` from `ChatUI`.** Replace `<Static items={history}>` with a plain `<Box flexDirection="column">` wrapping mapped `<TurnView>` components. Chat history within a single session is short enough that there's no scrollback budget worth preserving; the Ink correctness guarantee is more important.

2. **Add an integration test for the real `ChatUI` inside `PipelineDisplay`.** Once the nested-`<Static>` removal is in place, write a test that does NOT mock `ChatUI` and asserts post-chat lines appear in `lastFrame()`. This test should currently fail (proving the defect exists) and pass after step 1.

3. **Audit all other `<Static>` uses for nesting.** `ChatUI.tsx` and `PipelineDisplay.tsx` are the only two confirmed cases, but `ui.tsx` may be involved. A quick `grep -r "<Static" src/` will confirm scope.

4. **Update the mock comment in `pipeline-interactive.test.tsx`** once the fix lands. The comment warns future readers of a known bug; after the fix it should document why `ChatUI` is not mocked (the real component now renders correctly as a child).
