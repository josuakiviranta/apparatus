---
date: 2026-04-08
description: loop.ts already imports streamEvents from stream-formatter.ts, but stream-formatter.ts has no such export — the build is actively broken, not merely incomplete, and Chunk 1 of the implementation plan is the only unblocking step.
---

## Core Idea

`loop.ts` (line 4) imports `{ streamEvents }` from `./stream-formatter.js`. `stream-formatter.ts` exports `initialState`, `flushState`, `processLine`, and `serializeEvent` — no `streamEvents`. The import is unresolvable. The codebase does not build right now. This is not a semantic problem where the CLI produces wrong output — it is a structural break where the CLI cannot be produced at all.

The migration commit (`ea81384`) wrote `loop.ts` to consume an API (`streamEvents`) before that API was created. The `IMPLEMENTATION_PLAN.md` was written to add `streamEvents` in Chunk 1 — but the plan treats Chunk 2 ("Update loop.ts to use streamEvents") as a separate implementation step. Chunk 2 is already done. Loop.ts already calls `streamEvents(child.stdout)`. The plan is internally ahead of itself: Chunk 1 is the unblocking prerequisite, and Chunk 2 is a verification that the import now resolves.

## Why It Matters

Prior illuminations diagnosed the migration as "half-complete" — UI chrome ported to Ink, streaming sections still using raw stdout. That framing is accurate but undersells the severity. The half-migration is not just functionally incomplete; it is structurally broken. `npm run build` fails. `npx vitest run` would also fail if it requires the built module. Any session that tries to test or manually verify the current CLI will encounter a build error before reaching any command logic.

Illuminations 1100, 0900, 1300, and 1900 all addressed what happens after the migration — the renderOnce timing bug, the session_id extraction gap, the convergence prescription. None of them identified that the migration commit left the codebase in a state where none of those runtime concerns can even be reached. The forward reference in `loop.ts` means the "half-migration" diagnosis is generous: the implemented half is also currently broken.

The IMPLEMENTATION_PLAN.md correctly sequences the fix: Chunk 1 adds `streamEvents` to `stream-formatter.ts`. But nothing in the plan flags that the build is currently broken — a developer picking up the plan could spend time reading Task 1 (write failing tests for `streamEvents`) without realizing the entire test suite is failing for a different reason first.

## Revised Implementation Steps

1. **Confirm the break before touching anything.** Run `npm run build` from the project root. Expect a TypeScript error on `loop.ts:4` — something like `Module '"./stream-formatter.js"' has no exported member 'streamEvents'`. This is the single blocker.

2. **Implement Chunk 1 of the plan in full before anything else.** Add `streamEvents` to `src/cli/lib/stream-formatter.ts` with the signature and `onSessionId` callback pattern the plan prescribes. Run `npm run build` — it must pass before any other step begins. The tests for `streamEvents` (plan Task 1) should be written first (TDD order), but the build break means they also fail for the wrong reason until the export exists.

3. **Treat Chunk 2 of the plan as a verification step, not an implementation step.** `loop.ts` already imports and calls `streamEvents`. After Chunk 1 resolves the export, run `npx vitest run src/cli/tests/loop.test.ts` and check that loop's mock for `stream-formatter` includes `streamEvents`. If the mock doesn't include it (likely — it was written before the import was added), add `streamEvents: vi.fn(async function* () {})` to the mock block. That is the only change Chunk 2 requires.

4. **Then address the renderOnce timing bug from illumination 1300 before proceeding to Chunks 3–5.** Once the build is green and loop.ts tests pass, `output.ts`'s `renderOnce` still uses `setTimeout(0)` + `unmount()`. Every `output.step`, `output.info`, `output.warn`, etc. call in the migrated commands runs on that timing assumption. The SelfClosing wrapper fix is a 5-line change. It must land before `plan.ts`, `new.ts`, and `meditate-create.ts` are migrated — those commands call `output.step()` in sequence with `output.stream()`, and the transition between them depends on `renderOnce` releasing the terminal correctly.

5. **Proceed with Chunks 3–5 (plan.ts, new.ts, meditate-create.ts) only after steps 1–4 are committed.** The sequence is: green build → loop tests pass → renderOnce fixed → command migrations. Each gate is a `npm run build && npx vitest run` check, not a visual inspection.
