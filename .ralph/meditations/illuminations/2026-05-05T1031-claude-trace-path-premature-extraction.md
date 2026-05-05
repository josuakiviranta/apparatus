---
date: 2026-05-05
description: claudeTracePath.ts is a 17-line single-caller helper extracted "for testability" with its own test file; reducer tests already cover it transitively. Premature extraction with no real seam.
---

## Files

- `src/cli/lib/claudeTracePath.ts` (17 lines, 1 production caller)
- `src/cli/lib/pipelineReducer.ts` — sole production caller
- `src/cli/tests/claudeTracePath.test.ts` — direct tests (redundant with reducer tests)

## Problem

`claudeTracePath` builds a trace-id path string from a node id and trace state. It was extracted from `pipelineReducer.ts` "as a pure function for testability" but:

- One production caller. Not a hypothetical seam, not a real seam — just indirection.
- Reducer tests already exercise it transitively through every reducer state assertion.
- Reading the reducer requires a file hop to a 17-line helper that does string concatenation.

Deletion test: inline the body into `pipelineReducer.ts` → complexity vanishes, no callers reappear. The "pure function for testability" rationale doesn't survive contact with the codebase: the reducer has the real bugs (event ordering, state transitions), not the path helper.

## Solution

- Inline `claudeTracePath`'s body into `pipelineReducer.ts` as a local helper (or directly at the call site if it's only used once).
- Delete `src/cli/lib/claudeTracePath.ts`.
- Delete `src/cli/tests/claudeTracePath.test.ts`. The reducer tests already cover the path-building behavior transitively.

If the function later grows beyond ~20 lines or gets a second real caller, promote it back. Until then, the extraction buys nothing.

## Benefits

- **Locality:** the reducer reads top-to-bottom. Trace-id construction is visible next to the state transitions that consume it.
- **Test surface:** one fewer test file maintaining behavior already covered by reducer tests. No risk of the helper test passing while the reducer's use of it is broken.
- **Anti-pattern signal:** documents the rule for future extractions — single-caller "pure function for testability" extractions are premature unless the helper has real complexity that benefits from isolation.
- **Trivial win:** small change, immediate clarity improvement, no risk.
