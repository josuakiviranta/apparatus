---
date: 2026-04-13
status: archived
description: The --steer flag appends text after the 7-step workflow that mandates write_illumination, so closure-only steers don't escape step 7 — the agent produces a new illumination even when steered to only close existing ones.
archived_at: 2026-04-25
reason: Declined at approval gate
---

## Core Idea

The `--steer` flag is implemented by appending the steer text to the workflow prompt, not by replacing or branching it. In `agent.ts` the join is literal: `${expandedPrompt}\n\n${options.message}`. The meditate.md workflow ends with step 7: "call `write_illumination`." A steer that says "verify open illuminations for closure — do not write a new one" is appended after step 7, not wired into it. The agent receives competing instructions: the workflow says to write, the steer says not to. There is no branch.

The "every action needs an escape" principle names the failure: the meditate workflow is a modal with no exit path. `--steer` looks like an escape hatch but is implemented as additional text inside the same modal. It cannot close the modal.

## Why It Matters

T1200 explicitly recommends: "run a meditate session with `--steer 'verify open illuminations for closure and call mark_implemented on any that are resolved.'`" This recommendation will not work as intended. The steer competes with step 7, and step 7 wins — it is earlier in the prompt, more authoritative in tone ("When you are ready to record the illumination, call write_illumination"), and structurally presented as the session's deliverable. The agent will likely perform the closure pass AND then write a new illumination, increasing the open corpus count by one even during what was meant to be a closure session.

The current `meditate-steer.dot` smoke test (`pipelines/smoke/meditate-steer.dot`) validates only additive steers: its steer text says "write one illumination" — fully compatible with step 7. It passes not because steer-as-override works, but because that test never exercises override behavior. There is no test for a closure-only steer.

The backpressure guard (when implemented) will use `countOpenIlluminations()`. A user trying to reduce backlog below the threshold by running `--steer "close implemented illuminations"` will find the count unchanged or incremented by one — the opposite of the intended effect.

Two illuminations describe the same correction path (T1200: add a closure step; T1000: mark_implemented needs a caller) but neither identifies that `--steer` cannot plausibly deliver that correction through its current implementation. The closure step must be in the workflow prompt itself, not supplied at runtime via steer.

## Revised Implementation Steps

1. **Add a conditional branch to `src/cli/agents/meditate.md` before step 7.** After step 6 ("Reflect deeply"), insert: "Before calling `write_illumination`, check whether your steer text (if any) asked you to close existing illuminations rather than write a new one. If so: call `mark_implemented` or `mark_archived` on the relevant illuminations and stop. Do not call `write_illumination` unless you have identified a genuinely new insight not covered by any existing open illumination." This is the minimum fix — it gives the agent an explicit escape path from step 7 that can be activated by steer text.

2. **Add a second test case to `pipelines/smoke/meditate-steer.dot`** with steer text: `"Do not write a new illumination. Verify whether any open illuminations describe a feature that now exists in src/ and call mark_implemented on those that do."` Assert postcondition: `mark_implemented` was called at least once OR a log message explains why no illuminations qualified. This is the only test that would have caught the flaw described here.

3. **Document the steer contract in `docs/superpowers/specs/2026-04-14-meditate-steer-flag-design.md`.** Add a section: "Steer semantics: additive vs. overriding." Additive steers ("focus on module X") are always safe. Overriding steers ("do not write a new illumination") depend on the workflow having an explicit conditional branch for them. Without that branch, the workflow's step 7 takes precedence regardless of steer text. Callers who need override behavior must ensure step 6.5 is present in the agent config before relying on it.

4. **Update T1200's step 5 before it becomes the basis for a plan.** T1200 says: "After shipping the backpressure guard, run a meditate session with `--steer 'verify open illuminations for closure.'`" That step will not produce closure-only behavior until steps 1–3 above are complete. Add a note to T1200 (or ensure the plan derived from it includes the workflow branch as a prerequisite) so the closure workflow is wired before anyone attempts to invoke it.
