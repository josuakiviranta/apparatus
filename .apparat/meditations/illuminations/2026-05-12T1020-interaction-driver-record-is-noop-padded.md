---
date: 2026-05-12
description: `drivers: Record<BlockKind, InteractionDriver>` is padded with five `noopDriver` entries because the interaction surface (2 kinds) is narrower than the render surface (7 kinds) — split `InteractionKind` and `LiveFooter` stops dispatching through dead drivers, and Esc stops being silently swallowed on non-interactive blocks.
---

## Core Idea

ADR-0014 landed today with a clean exhaustiveness guard — `drivers as const satisfies Record<BlockKind, InteractionDriver<BlockKind>>` — but the guard buys safety on a union that is *deliberately wider than the concept*. `BlockKind` covers seven things the renderer needs to draw (`agent`, `interactive-agent`, `tool`, `store`, `wait-human`, `conditional`, `marker`); interaction is real for only two of them. `src/cli/lib/interactions/drivers/index.ts:7-26` confesses this with a `noopDriver(kind)` helper that produces five empty drivers whose `initState`, `reduce`, `renderFooter`, and `keymap.escape` all return / do nothing. The right shape is `InteractionKind = "interactive-agent" | "wait-human"` and a `Record<InteractionKind, …>`; non-interactive kinds simply don't enter the driver pathway.

## Why It Matters

Two concrete drifts the noop padding hides:

1. **`LiveFooter.tsx:42` dispatches through a driver for every block** — `drivers[block.kind].renderFooter(...)`. For `tool` / `store` / `agent` / `conditional` / `marker` blocks that call returns `null`, but the lookup still happens, and the call site reads as if every kind has footer behavior. A reader following the seam discovers five decorative stubs before finding the two that matter — exactly the "interface as big as what's behind it" smell from `deep-modules-hide-complexity.md`.

2. **`noopDriver.keymap.escape: () => {}` silently swallows Esc on non-interactive blocks.** If focus ever lands on a tool/marker block (today: not possible; tomorrow: trivially possible once the `i`-hotkey inspector from `2026-05-11T1630-trace-inspector-shallow-out-of-process.md` lands, or the agent driver's `/help` ever grows), the abort sentinel `__abort__` won't fire because `useInput` will route Esc to a driver whose contract is "do nothing." The smoke `interaction-driver-escape` scenario locks the contract for interactive kinds only; the noop entries never get tested because there's nothing to test. That's the worst kind of dead code — it doesn't break, it just makes the design read wrong.

The bigger structural point: the choice to make `BlockKind` and the driver index agree was a *type-system convenience*, not a domain modeling decision. Adding a new render kind (e.g., `parallel`, `codergen`) will require a noop entry that has no business existing. Adding a new interaction kind (e.g., `approve-diff` per ADR-0014 future work, or a future `pick-file` block) should be additive on `InteractionKind` alone. Today both motions cost the same; they shouldn't.

Composes with `2026-05-12T0952-plan-scheduler-shape-consumer-collision.md`: this is exactly the "edit shared shape vs. consume shape" pattern flagged there. The next driver-adding chunk will edit `BlockKind` in `classifyNode.ts` while sibling chunks add drivers consuming `BlockKind` — separating `InteractionKind` shrinks the collision surface for that future refactor too.

## Revised Implementation Steps

1. **Introduce `InteractionKind` next to `BlockKind`.** In `src/cli/lib/classifyNode.ts`, add `export type InteractionKind = "interactive-agent" | "wait-human";` plus `export function isInteractionKind(k: BlockKind): k is InteractionKind`. One predicate, two members — the narrowest possible interface.

2. **Reshape the driver registry.** Rewrite `src/cli/lib/interactions/drivers/index.ts` as `export const drivers = { "interactive-agent": agentDriver, "wait-human": gateDriver } as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>;`. Delete the `noopDriver` helper and the five stub entries. `InteractionDriver<K>`'s `K` parameter is now bound by `InteractionKind`, not `BlockKind`.

3. **Gate the LiveFooter dispatch.** `LiveFooter.tsx:42` becomes `{isInteractionKind(block.kind) ? drivers[block.kind].renderFooter(block, ctx) : null}`. Non-interactive blocks render just the `statusLine` — same observable output, but the absence of a driver is structural, not stubbed.

4. **Move Esc routing behind the same gate in `PipelineRunView`.** The Esc `useInput` handler should call `drivers[block.kind].keymap.escape(block)` only when `isInteractionKind(block.kind)` is true. Today the gate is implicit (no non-interactive block ever takes focus); making it explicit prevents the silent-swallow regression when focus mechanics change.

5. **Lock the contract with a type-level test.** Add a vitest in `src/cli/tests/interactions-registry.test.ts` that imports `drivers` and asserts `Object.keys(drivers).sort()` equals `["interactive-agent", "wait-human"]`. Pair with a one-line `// @ts-expect-error` proving that adding a `tool` key to `drivers` fails — making the narrowing decision visible to anyone refactoring later.

6. **Amend ADR-0014.** Add a "Refinement (2026-05-12)" stanza noting that the `BlockKind`-wide `Record` was reverted to an `InteractionKind`-wide one once the interaction concept stabilized; cite the noop-driver smell as the trigger and `deep-modules-hide-complexity.md` as the lens. Keeps the architectural reasoning legible without rewriting the original ADR (per the "ADRs are append-only" convention in `CONTEXT.md`'s Documentation channels section).
