# Chat round notes — 2026-05-04T00:00Z

## What the user raised

- "Does this introduce hardcoded strings to codebase?"
- "So what will changes from the perspective of pipeline caller?"
- "Give me command and output examples."
- "And how would run pipeline command look? any change to that?"
- "What's the problem now and what does this change solve? I'm dumb so explain simply."
- "Is there even anything that should be written to notes from this chat session?"
- Reacting to assistant's note that `validate` stays silent today: "It should show user any errors before run time to save time and fix errors early."

## Conclusions reached

- **Scope confirmed as-is — no pivot, no added constraints.** The verifier's plan stands: import `STRING_ATTRS` into `graph.ts`, replace the two hardcoded field arrays at `graph.ts:255–263` (variable_coverage) and `graph.ts:645` (checkOrphanOutput), retire the keep-in-sync comment at `variable-expansion.ts:135–136`, add one `cwd=` test case to `graph.test.ts`. Portability-heuristic at `graph.ts:333` stays untouched.
  - Came from: user accepted the "explain simply" recap without modification ("Ok sounds good").
  - Rationale: user understood the fix as plugging a spell-checker hole; no reason to broaden or narrow the change.

- **Net change is a *reduction* in hardcoded strings, not an addition.** Two hardcoded field arrays in `graph.ts` get replaced by iteration over the already-exported `STRING_ATTRS` constant. `STRING_ATTRS` itself preexists; nothing new is hardcoded.
  - Came from: user's first question ("Does this introduce hardcoded strings to codebase?").
  - Rationale: user wanted to confirm the fix consolidates rather than duplicates. Confirming this prevented a wrong-direction objection later.

- **Framing for the design doc: this fix is about `validate`-vs-`run` *signal-time consistency*, not crash-prevention.** The runtime expander and `scanUndeclaredCallerVars` already use `STRING_ATTRS`, so `pipeline run` already catches `$var` typos in `cwd=` (via missing-input error or `UndefinedVariableError`). The gap is `pipeline validate` staying silent on a class of typo that `run` errors on — confusing because validate said OK, run said no.
  - Came from: assistant initially mis-stated that pre-fix `run` crashed silently; user's follow-up forced the correction. User then explicitly endorsed the "validate should catch errors early to save time" framing.
  - Rationale: design doc must not oversell as crash-prevention — runtime already errors. The user-visible benefit is **earlier** signal (at validate time) and **command-to-command consistency**, so authors don't have to invoke `run` to learn about an authoring mistake.

- **`pipeline run` behavior is unchanged by this fix.** No new error paths, no changed messages — only `pipeline validate` gains diagnostics.
  - Came from: user's "any change to that?" on `pipeline run`.
  - Rationale: keep the blast-radius framing accurate. Surface change is `validate`-only; `run` is untouched.

## Open questions

- None.
