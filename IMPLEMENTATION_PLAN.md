# Implementation Plan

_No active chunks._ The most recent plan — **Deep Loop Nodes** — shipped in full at tag `deep-loop-nodes` / `v0.1.73` on 2026-04-29.

When new work begins, replace this stub with a fresh plan written via `superpowers:writing-plans`.

---

## Last shipped: Deep Loop Nodes

- **Spec:** `docs/superpowers/specs/2026-04-29-deep-loop-nodes.md`
- **Plan (full):** `docs/superpowers/plans/2026-04-29-deep-loop-nodes.md`
- **Memory:** `2026-04-29-deep-loop-nodes-shipped.md`
- **Tag:** `deep-loop-nodes` (also `v0.1.73`)

Replaces manual Ctrl+C as the only termination for `ralph implement`. Agents declare `loop: true` + `outputs: { done: boolean }`; the handler iterates with fresh contexts and breaks on `done=true`. Optional `note` field carries across iterations as `$prev_note`. Cap cascade: `node > agent > (loop ? Infinity : 1)`. New validator rule `loop_missing_done_field`.

### Open follow-up (deferred, not CI-blocking)

- [~] **Live smoke — `ralph implement` on a tiny disposable plan** (Final-verification Step 5)
  - In a scratch project: create `IMPLEMENTATION_PLAN.md` with one chunk and a single `[ ]` task, run `npx ralph implement <scratch-folder>`.
  - Confirm: agent commits the chunk, marks `[x]`, emits `{ "done": true }` as final text, loop terminates without Ctrl+C.
  - Confirm: TUI shows `onIterationStart` / `onIterationEnd` blocks and a clean exit.
  - Hands-on; document the result in implementation memory but do not block CI on it.

---

## Notes for the executing agent (timeless)

- Chunks 1–3 of `agent-output-validation-and-retry` are shipped to main — `evaluateAgentOutput`, `outputs-to-zod.ts`, and the `--resume` retry path already exist. Do not redo.
- `signal?.aborted` checks remain at the top of the iteration loop body. Do NOT remove them when restructuring deep-loop handlers.
- Iteration counter must NOT increment on retries. Retries are sub-attempts of the same iteration.
- The `onIterationEnd` TUI hook fires only when the loop will continue to iteration `i+1`. When breaking on `done=true`, do NOT call it — the outer `onNodeEnd` closes the block.
- If a behavior gap surfaces during execution that the active plan does not cover, update the plan in place and continue. A follow-up chunk is preferred to silent extension.
