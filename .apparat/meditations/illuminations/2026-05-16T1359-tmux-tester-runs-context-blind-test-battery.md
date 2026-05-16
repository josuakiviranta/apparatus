---
date: 2026-05-16
description: tmux-tester always runs the full test suite and a diff-driven scenario battery without first forming a focused test plan from the implementation — adding a pre-cycle understanding phase would make its cycles faster, more targeted, and more useful to the confirming human.
---

## Core Idea

The note observed: *"tmus_tester should not always run the same smoke tests instead it should think which tests to run, and which aspects to focus its attention based on what was actually implemented."*

`tmux-tester` already has Phase 3a for scenario selection — but Phase 1 always runs `npm test` blindly, and Phase 3a's cross-cutting fallback (`diff touches engine internals → INCLUDE all`) means in practice almost every implementation run includes the full scenario battery. The agent never forms a focused test hypothesis before it starts running. It enters Phase 1 without a question it is trying to answer.

## Why It Matters

This matters in two directions:

1. **Wasted cycles.** Running 400+ tests and all scenarios when only `src/cli/components/TextInput.tsx` changed is expensive and produces a signal-to-noise ratio that makes the `### Scenarios run` log hard to read at `tmux_confirm_gate`.

2. **Missed depth.** Without a pre-cycle model of what changed, the agent cannot decide to run a targeted `npm test TextInput` first for fast feedback, or to focus its Phase 3 manual exercise on the specific behavior the implementer changed. It exercises breadth but not depth.

Phase 3a was a step in the right direction, but it is downstream of Phase 1. The agent reads the diff at Phase 1c — *after* the full test run — solely to count plan coverage. It never reads the diff *before* running to plan which subset of tests to prioritize.

The cross-cutting fallback in Phase 3a (`engine internals → include all`) also punishes the common case: any change to `src/attractor/` or `src/cli/lib/` triggers a full scenario sweep. Most implementation changes touch at least one of these paths, so the "relevance selection" rarely prunes anything in practice.

## Revised Implementation Steps

1. **Add Phase 0b — Implementation understanding.** After Phase 0a (candidate extraction), run `git diff --stat $pre_sha HEAD` and `git diff --name-only $pre_sha HEAD` to understand what was actually changed. Record a short human-readable summary: which source modules changed, which categories of code were touched (handlers, validator, TUI components, CLI commands, scenarios, pipeline agents). Hold this as `impl_summary` — it drives decisions in Phase 1 and Phase 3a.

2. **Run a targeted test sub-suite before the full run.** At the top of Phase 1, before `npm test`, identify the 1–3 most relevant test files by grepping for test files that `import` or reference the changed modules. Run them first (`npm test -- <files>`). This gives fast feedback (usually ≤30s) before committing 3–5 minutes to the full suite. If the targeted run is red, skip to the Fix step immediately without waiting for the full run.

3. **Tighten the cross-cutting fallback.** Replace "engine internals → INCLUDE all" with a tiered rule:
   - `src/attractor/handlers/` → include handler scenarios + one cross-cutting sanity (`static-multi-node` or `conditional`)
   - `src/attractor/core/` (validator, graph-ast, engine) → include all
   - `src/cli/lib/` but not validator/engine → include only scenarios exercising the specific command whose lib code changed
   - `src/cli/components/` → include only scenarios that drive TUI interactively (gate, chat-end-to-end)
   This makes the INCLUDE set proportional to the blast radius of the change.

4. **Prepend a `### Test focus` section to `test_render`.** The first thing the human sees at `tmux_confirm_gate` should be: what changed, which tests were run first, why. Example:
   ```
   ### Test focus
   Changed: src/cli/components/TextInput.tsx
   Targeted: TextInput.test.tsx (fast), full suite (baseline)
   Scenarios: gate, chat-end-to-end (TUI-interactive; others skipped — no TUI overlap)
   ```
   This lets the human audit the agent's reasoning in 5 seconds before reading the full report.

5. **Pass `impl_summary` into Phase 3 (manual exercise).** Phase 3 currently checks `git log -1 --stat` at runtime. Replace this with the `impl_summary` already computed in Phase 0b — the agent already knows what changed and should exercise the *specific* new behavior rather than rediscovering it from git.
