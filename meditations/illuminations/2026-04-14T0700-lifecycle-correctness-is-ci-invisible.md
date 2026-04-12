---
date: 2026-04-12
status: open
description: The illumination state machine is unit-tested in isolation but has no smoke pipeline — two of T0600's three bugs are undetectable by CI, and the idempotency property that the state machine was built to enforce is unverified end-to-end.
---

## Core Idea

The illumination state machine — `markDispatched`, `markImplemented`, `markArchived`, `listIlluminations(status=...)` — has thorough unit tests in `src/cli/tests/illumination-server.test.ts`. But `pipelines/illumination-to-plan.dot` is the only pipeline in the project with no entry in `pipelines/smoke/`. The 8 smoke pipelines cover agent, chat, gate, conditional, store, tool, meditate-steer, and chat-end-to-end. None tests the illumination lifecycle. Two of T0600's three bugs — missing auto-commits on mutation functions, and `listIlluminations(status="archived")` reading the wrong directory — will never cause a CI failure. The state machine shipped, all smoke tests pass, and the implementation's correctness against its own contract is untested.

## Why It Matters

The idempotency lens names the exact property the state machine was built to provide: run the illumination pipeline twice on the same corpus and the second run produces nothing — because the first run marked everything dispatched. T0600's verifier bug (glob instead of `list_illuminations(status=open)`) breaks this: both runs process the same illumination and generate a duplicate plan. But this failure mode has no test that can catch it.

There is an asymmetry in the current test suite. `markDispatched` has 7 unit tests in `describe("markDispatched")` — they verify frontmatter rewrites, body preservation, status rejection logic. What they don't have is a `mockExecSync` call. The `describe("writeIllumination auto-commit")` suite in the same file mocks `execSync` and asserts git commit behavior explicitly. That suite is three `it` blocks that took roughly 20 lines. The same pattern is absent for all three mutation functions. The implementation gap (no execSync call) and the test gap (no execSync assertion) were introduced together and will be fixed together — but only if someone notices the parallel.

`listIlluminations(status="archived")` always returns "No illuminations found" because archived files live in `meditations/illuminations/archive/` but the function reads `meditations/illuminations/`. This is a one-conditional fix. There is no test that calls `markArchived` followed by `listIlluminations(status="archived")` and asserts visibility — which is the exact test that would catch it.

## Revised Implementation Steps

1. **Add a smoke pipeline at `pipelines/smoke/illumination-lifecycle.dot`.** It should: (a) call `list_illuminations` with `status: open` to find available illuminations, (b) if one exists, call `mark_dispatched` on it with a stub plan path, (c) call `list_illuminations(status: open)` again and assert the file is absent, (d) call `mark_archived` to clean up the fixture. This pipeline tests the state machine contract — not AI judgment — and runs deterministically. It does not need a verifier node or subagents.

2. **Add `mockExecSync` assertions to `markDispatched`, `markImplemented`, `markArchived` test suites.** Each needs a `describe("<function> auto-commit")` block mirroring `describe("writeIllumination auto-commit")`. Write the tests first. They will fail. Then add the 4-line `try { execSync(...add...); execSync(...commit...) } catch {}` block to each mutation function in `illumination-server.ts`, following the existing pattern in `writeIllumination`. The tests then pass.

3. **Fix `listIlluminations` for archived status.** In `illumination-server.ts`, at the top of `listIlluminations`, add: if `status === "archived"`, reassign `dir` to `join(projectRoot, "meditations", "illuminations", "archive")`. Add a test: `markArchived` a file, then call `listIlluminations(projectRoot, "archived")` and assert it appears. This test should be in the new `markArchived` auto-commit describe block or a dedicated `listIlluminations archived` suite.

4. **Fix the verifier prompt in `illumination-to-plan.dot`.** Replace step 1 of the verifier prompt (`Run glob on meditations/illuminations/*.md`) with `Call mcp__illumination__list_illuminations with status: open`. If the result is `No illuminations found.`, return `preferred_label: empty`. This is the only one of T0600's three bugs that a smoke pipeline cannot catch — it requires reading the `.dot` file and confirming the prompt text. It is a one-line edit.

5. **Run the new smoke pipeline twice against a corpus with one open illumination.** The first run should dispatch it. The second run should route to `done` immediately (empty result). If both runs produce output, the idempotency contract is broken and one of the above fixes is incomplete. This is the verification step that confirms the state machine actually gates the pipeline — not just in unit tests, but in the workflow it was built for.
