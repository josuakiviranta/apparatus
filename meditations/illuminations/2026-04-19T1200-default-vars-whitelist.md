---
date: 2026-04-19
status: open
description: Pipeline node attribute `default_<varname>` only works for a hand-coded whitelist (defaultRefinements, defaultChatNotesPath, defaultTestResult, defaultTestSummary) — every new context var needs an engine PR to add a schema entry, blocking gate/agent labels from gracefully handling unset upstream produces.
---

## Core Idea

`src/attractor/core/schemas.ts:29-32, 54` whitelists exactly four `default*` keys across `AgentNodeSchema` and `GateNodeSchema` via `z.strict()`. Any other `default_<varname>` attribute on a `.dot` node fails validation with `Unrecognized key(s) in object: 'default<Varname>'`.

Concretely: when `chat_summarizer` produces `$scope_changed`, the gate that wants to display it before the chat loop has fired has no way to set a default. Either the gate label drops the variable (loses information) or the pipeline ships broken until an engine PR adds `defaultScopeChanged` to both schemas.

This is a leaky abstraction. The defaults whitelist exists to give nodes something to interpolate when an optional upstream branch hasn't run, but the whitelist is implicitly coupled to a small set of historical produces names — every new structured output needs an engine round-trip.

## Why It Matters

Pipeline authors cannot independently extend the context surface their gates display. Adding any new produces field that might appear in a label or downstream prompt requires:

1. Add `default<Varname>` to `AgentNodeSchema` in `schemas.ts`
2. Add to `GateNodeSchema` if a gate label needs it
3. Add to ToolNodeSchema if a tool node attribute needs a default
4. Rebuild the engine
5. Update tests

For a feature that should be a one-line attribute on the consuming node. The current system rewards giving up on the variable rather than wiring it through cleanly, which leaks important signal (e.g. `$scope_changed`) out of the user-visible decision surface.

## Revised Implementation Steps

1. **Replace the whitelist with a generic `default_*` parser.** In `src/attractor/core/schemas.ts`, change the four explicit `defaultRefinements` / `defaultChatNotesPath` / etc. fields to a single passthrough: any attribute matching the camelCased pattern `default<Capitalized>` is accepted as a string. Implement via `z.record(z.string().regex(/^default[A-Z]/), z.string())` extended into the base schema, OR by replacing `.strict()` with a more permissive shape that captures unknown `default*` keys into a separate map.

2. **Update the runtime defaults applier.** Wherever the engine reads `node.defaultRefinements` to seed `$refinements` when the var is missing, generalize to: iterate every `default<X>` key on the node, derive the context-var name (`<x>` lowercased, snake_cased back from camelCase), and seed it if absent in the current context.

3. **Update `pipeline validate` error messages.** When validation rejects a non-default attribute, the error currently leaks the camelCased key name (e.g. `defaultScopeChanged`). After the change, the only failure mode for `default_*` attributes is "value must be a string" — the unknown-key error goes away for this prefix.

4. **Migration safety.** The four existing whitelisted fields still need to seed their named context vars. The generalized applier must be deterministic: given `default_refinements="X"`, the seeded context var name is exactly `refinements` (snake_case from `defaultRefinements`). Add a unit test asserting this round-trip for both old fields and a new arbitrary one (e.g. `default_scope_changed="false"` → `$scope_changed = "false"`).

5. **Document in the pipeline spec.** One paragraph in `specs/pipeline.md` (or wherever node attributes are listed): "Any attribute named `default_<varname>` seeds `$varname` to the given string when no upstream node has produced it. This makes labels and prompts robust to optional upstream branches."
