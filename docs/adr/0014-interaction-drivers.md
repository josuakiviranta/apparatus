# ADR-0014: Interaction-kind drivers behind one InteractionDriver seam

- Status: accepted
- Date: 2026-05-12
- Predecessor: ADR-0012 (ValidationContext bundle), ADR-0006 (single event stream)

## Context

Every TUI interaction kind (`interactive-agent`, `wait-human`, gate-bearing)
was spread across five files behind no compiler-enforced seam. `LiveBlock`
carried optional `child?`, `onDone?`, `gate?` fields; `NodeEvent` sprouted a
sibling `interactive-ready` / `gate-ready` variant per kind; the reducer had
parallel cases; `LiveFooter` branched on `block.kind` and optional fields;
`GateSelector` lacked a `key.escape` handler. Drift was silent — the missing
Escape was the live proof.

## Decision

Define `InteractionDriver<K>` in `src/cli/lib/interactions/driver.ts`. Each
kind has one driver module owning state, reducer, footer renderer, and keymap
(`escape` required). One register() site at
`src/cli/lib/interactions/drivers/index.ts` uses
`as const satisfies Record<BlockKind, InteractionDriver<BlockKind>>` to enforce
exhaustiveness — adding a kind to `BlockKind` without a driver entry is a type
error.

`LiveBlock` drops `child?`, `onDone?`, `gate?`. `NodeEvent` drops
`interactive-ready` and `gate-ready` and gains one parametric `driver-event`
variant whose `payload` is a `DriverPayload` discriminated union. `LiveFooter`
renders one call: `drivers[block.kind].renderFooter(block, ctx)`.

Per-driver state lives in a module-scoped `Map<blockId, KindState>` owned by
the driver. The reducer stays pure; only the driver's `reduce()` is allowed to
mutate the map. The trade-off is documented in the design doc §7.1.

`Esc` on a gate emits a module-scoped `ABORT_CHOICE = "__abort__"` sentinel
that the Ink interviewer maps to an `abort` outcome. The smoke scenario at
`.apparat/scenarios/interaction-driver-escape/pipeline.dot` plus
`src/cli/tests/interaction-driver-escape-scenario.test.ts` freezes the
contract.

## Consequences

- Adding a new kind: add the kind to `BlockKind`, write one driver module,
  register it in `drivers/index.ts` — `tsc` enforces every other site.
- `Esc` behavior is part of the interface: no kind can ship without declaring
  a cancel.
- Internal breaking changes (none external): `LiveBlock` type export shrinks;
  `NodeEvent` drops two variants and adds one. Both consumers (`run.ts`,
  `interviewer/ink.ts`) and all touched tests migrated in the same atomic PR.
- The slash-command surface (`/end`, `/abort`, `/help`) stays inline in
  `PipelineRunView` for this landing; tightening into the agent driver is a
  follow-up (design §9).
- A dedicated `wait-human` driver is deferred — today's wait-human shares the
  gate driver because no behavior diverges yet (design §7.5). Reopen on the
  first wait-human-specific keymap or footer requirement.
- `ABORT_CHOICE = "__abort__"` is module-scoped: an option literally named
  `__abort__` would short-circuit. If a real collision is observed in user
  pipelines, namespace it (e.g. `__apparat:abort__`); not done preemptively.

## Notes

The originating illumination cited `src/cli/components/PipelineApp.tsx` as the
emit-lambda site. That file was deleted in commit `aeba3c3` (PipelineApp
split) and the god-pattern moved verbatim to `PipelineRunView.tsx` — the
structural gap is unchanged.

## References

- Design doc: `docs/superpowers/specs/2026-05-12-interaction-kinds-need-deep-drivers-design.md`
- Originating illumination: `.apparat/meditations/illuminations/2026-05-11T1610-interaction-kinds-need-deep-drivers.md`
- Implementation plan: `docs/superpowers/plans/2026-05-12-interaction-kinds-need-deep-drivers.md`
