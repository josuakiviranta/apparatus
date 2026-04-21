---
date: 2026-04-21
status: open
description: prompt= $var references already declare what each agent consumes, but buildPreamble ignores them and injects all ctx.values — a fidelity="scoped" mode that drops the "Key context values" section eliminates unbounded preamble noise without requiring the new consumes= attribute T2200 proposed.
---

## Core Idea

Every agent's `prompt=` attribute already contains a complete, machine-readable list of what that agent needs: the `$var` references inside the template. `agent-handler.ts` expands those references inline via `expandVariables` before the agent sees the prompt. Yet `buildPreamble` then runs independently — with no knowledge of the template — and dumps ALL `ctx.values` as a "Key context values" block on top. The result is double-injection for every referenced variable and unbounded noise injection for every unreferenced one. The fix requires no new DOT attribute: `prompt=` is already the implicit consumes declaration.

## Why It Matters

By the time `tmux_tester` or `implement` runs in `illumination-to-implementation.dot`, `ctx.values` has accumulated output from 10–15 prior nodes: `explainer_render` (a full markdown before/after render, potentially 2 000+ tokens), the cumulative `refinements` chat log, `agent.iterations`, `agent.success`, `agent.sessionId`, `scope_changed`, and more. None of these are referenced in `tmux_tester`'s `prompt=`. They arrive as preamble noise, consuming tokens and presenting the agent with a misleading picture of its own interface.

T0400 identified this as "unbounded preamble noise." T2200 proposed a new `consumes=` attribute to fix it. Both are correct diagnoses, but the consumes attribute adds author burden. The `rawPrompt` variable in `agent-handler.ts:63` is already in scope before `buildPreamble` is called at line 71 — the information needed to scope the preamble is already sitting one line away.

The duplication is also real: `$plan_path` appears in `tmux_tester`'s expanded prompt body (via `expandVariables`) AND again in the preamble's "Key context values" list. Every referenced variable is sent twice.

## Revised Implementation Steps

1. **Add `fidelity="scoped"` to `buildPreamble`** (`src/attractor/transforms/preamble.ts`): in this mode, emit only the "Completed stages" line — drop the "Key context values" block entirely. Values referenced in `prompt=` are already expanded inline; nothing else belongs.

2. **Change the default fidelity in `agent-handler.ts`** (line ~70) from `"compact"` to `"scoped"`. Keep `"compact"` as an explicit opt-in for debugging sessions where seeing all context is useful. Keep `"full"` for suppressing even the "Completed stages" line.

3. **Verify with a unit test** in `src/attractor/tests/` that `buildPreamble` in `"scoped"` mode emits no "Key context values" block even when `ctx.values` is non-empty, and that `"compact"` mode still dumps all values (regression guard).

4. **Run the existing preamble/agent-handler tests** to confirm nothing breaks. The change is backward-compatible: nodes that already set `fidelity="full"` are unaffected; nodes with no `fidelity` attribute get the new scoped default.

5. **Audit `illumination-to-implementation.dot`** for any node that explicitly sets `fidelity="compact"` and remove those overrides — they were probably set to compensate for what "scoped" should have been from the start.
