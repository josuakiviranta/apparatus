# Design: Narrow `drivers` registry to `Record<InteractionKind, …>`, retire the noop padding

**Date:** 2026-05-12
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-12T1020-interaction-driver-record-is-noop-padded.md`

## 1. Motivation

ADR-0014 landed the same day with a clean exhaustiveness guard:
`drivers as const satisfies Record<BlockKind, InteractionDriver<BlockKind>>`
at `src/cli/lib/interactions/drivers/index.ts:25`. The guard buys safety
on a union (`BlockKind`) that is **deliberately wider than the concept**:
`BlockKind` covers seven things the renderer needs to draw, but interaction
behavior exists for only two of them.

The padding shows up as a `noopDriver` helper plus five stub entries:

```ts
// src/cli/lib/interactions/drivers/index.ts:7-25
function noopDriver<K extends BlockKind>(kind: K): InteractionDriver<K> {
  return {
    kind,
    initState: () => undefined,
    reduce: (_p, s) => s,
    renderFooter: () => null,
    keymap: { escape: () => {} },
  };
}

export const drivers = {
  "interactive-agent": agentDriver,
  "wait-human": gateDriver,
  agent: noopDriver("agent"),
  tool: noopDriver("tool"),
  store: noopDriver("store"),
  conditional: noopDriver("conditional"),
  marker: noopDriver("marker"),
} as const satisfies Record<BlockKind, InteractionDriver<BlockKind>>;
```

Two concrete drifts the padding hides — both flagged in the illumination
and confirmed by source reads during the chat round:

1. **`LiveFooter.tsx:42` dispatches a driver call for every block.**
   `drivers[block.kind].renderFooter(block, {...})` runs for `tool` /
   `store` / `agent` / `conditional` / `marker` blocks. The call returns
   `null`, but the lookup still happens — and the call site reads as if
   every kind has footer behavior. Reader following the seam discovers
   five decorative stubs before finding the two that matter. Classic
   "interface as big as what's behind it" smell
   (`.apparat/meditations/stimuli/deep-modules-hide-complexity.md`).

2. **`noopDriver.keymap.escape: () => {}` silently swallows Esc on
   non-interactive blocks.** `PipelineRunView.tsx:103` routes Esc through
   `drivers[state.live.kind].keymap.escape(state.live)` gated only on
   `state.live` truthiness — not on whether the block kind has real
   interaction. Today no non-interactive block ever takes focus, so the
   silent swallow is invisible. The first hotkey that lets focus land on
   a `tool` / `marker` block (e.g. the `i`-inspector teased in
   `.apparat/meditations/illuminations/2026-05-11T1630-trace-inspector-shallow-out-of-process.md`)
   would convert the bug from latent to live without a single test
   failing. The smoke `interaction-driver-escape` scenario locks the
   contract for interactive kinds only; the noop entries never get
   tested because there is nothing to test.

The structural point (chat-summarizer round 1, bullet "padding for an
over-wide type constraint"): the seven noop fields are **not stubs
awaiting implementation**. Future interaction kinds (ADR-0014's
possible `approve-diff`, or a future `pick-file`) will be added to
`InteractionKind`, never by un-padding an existing noop. Today both
motions cost the same; they shouldn't.

## 2. Decision summary

This slice is **a structural narrowing**. No behaviour change: every
runtime path that exists today still exists after the change, with
identical observable output. The chat round pinned five things:

1. **Split `InteractionKind` out of `BlockKind`** in
   `src/cli/lib/classifyNode.ts`: add
   `export type InteractionKind = "interactive-agent" | "wait-human";`
   and the type-guard
   `export function isInteractionKind(k: BlockKind): k is InteractionKind`.
   `BlockKind` itself is untouched — `pipelineEvents.ts` keeps
   `BlockKind` on `start.blockKind` (`:23`), `Block.kind` (`:37`), and
   `LiveBlock.kind` (`:51`).

2. **Narrow the driver registry** in
   `src/cli/lib/interactions/drivers/index.ts`: rewrite to
   `as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>`,
   keep only the `"interactive-agent": agentDriver` and
   `"wait-human": gateDriver` entries, **delete the `noopDriver`
   helper** plus the five stub entries.

3. **Gate the four internal call sites on `isInteractionKind`** —
   `LiveFooter.tsx:42`, `PipelineRunView.tsx:103`,
   `pipelineReducer.ts:70`, `pipelineReducer.ts:81`. All four edits
   **must land in the same commit** as the registry narrowing (chat
   round, bullet "atomic edit is non-negotiable") — narrowing the
   registry without gating the sites is a tsc compile error, which is
   the intended forcing function.

4. **Invert the existing
   `src/cli/tests/interactions-registry.test.ts`** (chat round,
   bullet "INVERT, not ADD"). The file already exists (58 lines, mtime
   2026-05-12 09:32) and asserts the 7-key noop shape — those
   assertions become invalid after narrowing and must be deleted, not
   adjusted. Delete the noop-behavior `it()` at lines 20-49; shrink
   the key-count `it()` at lines 7-16 from 7 to 2 keys; add a single
   `// @ts-expect-error` proof line showing that an `as const`
   registry with a `tool` key fails the satisfies check.

5. **Append a 2026-05-12 refinement stanza to ADR-0014** (per the
   append-only ADR convention quoted at ADR-0014:42-60) noting that
   the `BlockKind`-wide `Record` was reverted to an `InteractionKind`-wide
   one once the interaction concept stabilized. Cite the noop-driver
   smell as the trigger and `deep-modules-hide-complexity.md` as the
   lens. No rewrite of the original Decision section.

**Locked OUT of scope** (chat round, refinements bullet "no external
break"):

- `BlockKind` itself is **not** changed. All seven kinds remain.
- `pipelineEvents.ts` is **read-only**. `start.blockKind`,
  `Block.kind`, `LiveBlock.kind` all stay `BlockKind`. The event
  contract does not shift, so no agent / frontmatter / CLI / MCP
  surface moves.
- No new interaction kind. No new render kind. No new commands.
- No CONTEXT.md edit, no README edit (verifier confirmed zero
  doc ripple beyond the ADR refinement stanza).
- No refactor of the `Map<blockId, KindState>` per-driver state
  pattern documented at ADR-0014:32-34 — that pattern is unaffected.

## 3. Architecture

### 3.1 Before / after

**Before — registry is padded with five no-op entries; four internal
call sites assume every `BlockKind` is keyable in the registry.**

```
src/cli/lib/classifyNode.ts:4-11        BlockKind = 7 kinds
src/cli/lib/interactions/drivers/index.ts:7-25
                                        noopDriver<K> helper +
                                        7-entry drivers registry
                                        as const satisfies Record<BlockKind, …>
src/cli/components/LiveFooter.tsx:42    drivers[block.kind].renderFooter(...)
src/cli/components/PipelineRunView.tsx:103
                                        drivers[state.live.kind].keymap.escape(state.live)
                                        (gated only on state.live truthiness)
src/cli/lib/pipelineReducer.ts:70       const driver = drivers[state.live.kind];  (driver-event case)
src/cli/lib/pipelineReducer.ts:81       const driver = drivers[state.live.kind];  (end case, calls driver.onFreeze?.)
src/cli/tests/interactions-registry.test.ts
                                        58 lines pinning 7-kind shape + noop-behavior contract
```

**After — registry has two real entries only; call sites are gated by
`isInteractionKind`; `BlockKind` and `pipelineEvents` contract
unchanged.**

```
src/cli/lib/classifyNode.ts             + export type InteractionKind = "interactive-agent" | "wait-human";
                                        + export function isInteractionKind(k: BlockKind): k is InteractionKind;
                                        BlockKind unchanged at 7 kinds.

src/cli/lib/interactions/drivers/index.ts
                                        export const drivers = {
                                          "interactive-agent": agentDriver,
                                          "wait-human": gateDriver,
                                        } as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>;
                                        (noopDriver helper deleted; 5 stub entries deleted)

src/cli/components/LiveFooter.tsx:42    const footer = isInteractionKind(block.kind)
                                          ? drivers[block.kind].renderFooter(block, ctx)
                                          : null;

src/cli/components/PipelineRunView.tsx:102-104
                                        if (key.escape && state.live && isInteractionKind(state.live.kind)) {
                                          drivers[state.live.kind].keymap.escape(state.live);
                                        }

src/cli/lib/pipelineReducer.ts:68-73    case "driver-event": gated on isInteractionKind(state.live.kind)
src/cli/lib/pipelineReducer.ts:78-90    case "end": gated on isInteractionKind(state.live.kind) before
                                        calling driver.onFreeze?.(...)
```

### 3.2 New types in `classifyNode.ts`

`BlockKind` itself is untouched. Two additive exports below the
existing union:

```ts
// src/cli/lib/classifyNode.ts (below the existing BlockKind union at :4-11)
export type InteractionKind = "interactive-agent" | "wait-human";

export function isInteractionKind(k: BlockKind): k is InteractionKind {
  return k === "interactive-agent" || k === "wait-human";
}
```

The predicate is the type-system seam. `InteractionDriver<K>`'s
parameter is rebound to `K extends InteractionKind` in
`src/cli/lib/interactions/driver.ts:27` so that the registry value
type and the call-site narrowing line up.

`driver.ts:27-37` reads today:

```ts
export interface InteractionDriver<K extends BlockKind> {
  readonly kind: K;
  initState(block: LiveBlock): unknown;
  …
}
```

Rebind to `K extends InteractionKind`. The `LiveBlock` and `Block`
parameter types stay as-is (their `kind` is still `BlockKind`); only
the driver's `kind` field narrows.

### 3.3 Narrowed registry

```ts
// src/cli/lib/interactions/drivers/index.ts (after)
import type { InteractionKind } from "../../classifyNode.js";
import type { InteractionDriver } from "../driver.js";
import { agentDriver } from "./agent.js";
import { gateDriver } from "./gate.js";

export const drivers = {
  "interactive-agent": agentDriver,
  "wait-human": gateDriver,
} as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>;
```

The `noopDriver` helper is deleted. The `BlockKind` import becomes
unnecessary (replaced by `InteractionKind`).

### 3.4 Gated call sites

All four gated under `isInteractionKind`. Each edit must compile
green only after every other site is also gated — tsc is the
atomicity enforcer (chat round, bullet "use tsc as the atomicity
enforcer").

**`src/cli/components/LiveFooter.tsx:42`** — today:

```tsx
const footer = drivers[block.kind].renderFooter(block, {
  inputBuffer,
  onInputChange,
  onInputSubmit,
});
```

After:

```tsx
const footer = isInteractionKind(block.kind)
  ? drivers[block.kind].renderFooter(block, {
      inputBuffer,
      onInputChange,
      onInputSubmit,
    })
  : null;
```

Observable change: none. The previous noop drivers also returned
`null`. `<Box flexDirection="column">{footer}<Text dimColor>…</Text></Box>`
at `:47-52` is unchanged.

**`src/cli/components/PipelineRunView.tsx:102-104`** — today:

```tsx
if (key.escape && state.live) {
  drivers[state.live.kind].keymap.escape(state.live);
}
```

After:

```tsx
if (key.escape && state.live && isInteractionKind(state.live.kind)) {
  drivers[state.live.kind].keymap.escape(state.live);
}
```

Observable change: none today (no non-interactive block ever takes
focus). Future-proofing: when a hotkey lets focus land on a
non-interactive block, Esc falls through to normal handling rather
than being silently swallowed by a `() => {}` stub.

**`src/cli/lib/pipelineReducer.ts:68-73`** (the `driver-event` case)
— today:

```ts
case "driver-event": {
  if (!state.live) return state;
  const driver = drivers[state.live.kind];
  const newLive = driver.reduce(event.payload, state.live);
  return newLive === state.live ? state : { ...state, live: newLive };
}
```

After:

```ts
case "driver-event": {
  if (!state.live || !isInteractionKind(state.live.kind)) return state;
  const driver = drivers[state.live.kind];
  const newLive = driver.reduce(event.payload, state.live);
  return newLive === state.live ? state : { ...state, live: newLive };
}
```

Observable change: none. `driver-event` events only originate from
real drivers, so the predicate is always true in practice today —
but the guard makes the invariant compile-checked.

**`src/cli/lib/pipelineReducer.ts:78-90`** (the `end` case) — today:

```ts
case "end": {
  if (!state.live) return state;
  const filled = fillStats(state.live, event.stats);
  const driver = drivers[state.live.kind];
  const freezeExtras = driver.onFreeze?.(state.live, event.outcome) ?? {};
  …
}
```

After (introduce a `freezeExtras` defaulted to `{}` when the kind is
non-interactive; the rest of the case is unchanged):

```ts
case "end": {
  if (!state.live) return state;
  const filled = fillStats(state.live, event.stats);
  const freezeExtras = isInteractionKind(state.live.kind)
    ? (drivers[state.live.kind].onFreeze?.(state.live, event.outcome) ?? {})
    : {};
  …
}
```

Observable change: none. `onFreeze` is optional on
`InteractionDriver` (`driver.ts:36`); neither `agentDriver` nor
`gateDriver` needs special handling for non-interactive kinds because
the previous noop drivers had no `onFreeze` either.

### 3.5 Inverted registry test

`src/cli/tests/interactions-registry.test.ts` is rewritten — chat
round, bullet "INVERT the existing test". The file's three `it()`
blocks today (verifier confirmation; mtime 2026-05-12 09:32, 58
lines, 1723 bytes):

- **Lines 7-16** — `it("declares one driver per BlockKind", …)` asserts
  a 7-element sorted array. Shrink to a 2-element sorted array:
  `["interactive-agent", "wait-human"]`.
- **Lines 20-49** — `it("non-interactive kinds expose a noop
  renderFooter and escape", …)`. **Delete this whole block.** Its
  contract is gone — non-interactive kinds no longer have a driver
  entry to test.
- **Lines 52-57** — `it("interactive-agent and wait-human are wired
  to the real drivers", …)`. Keep as-is; the assertion is still
  valid.

Plus a new third `it("rejects non-InteractionKind keys at the type
level", …)` block proving the narrowing is tsc-enforced. The
assertion lives in its own `it()` so the failure name is precise
when the directive flips. Final shape of the file is given in §7.

If a future refactor widens the registry back to `BlockKind`, the
`// @ts-expect-error` directive turns into a build error — visible
to anyone reading the diff.

### 3.6 ADR-0014 refinement stanza

Append to `docs/adr/0014-interaction-drivers.md` after the existing
"Notes" section (`:61-66`) and before "References" (`:68-72`):

```
## Refinement (2026-05-12)

The original Decision pinned `drivers` as
`Record<BlockKind, InteractionDriver<BlockKind>>` for exhaustiveness.
Once `interactive-agent` + `wait-human` were the only kinds with
real drivers, the satisfies guard required five `noopDriver` entries
whose `initState` / `reduce` / `renderFooter` / `keymap.escape` all
returned / did nothing. The padding violated the deep-modules lens
(`.apparat/meditations/stimuli/deep-modules-hide-complexity.md`) —
the seam read as if every kind had interaction behavior. Worse, the
noop `keymap.escape: () => {}` silently swallows Esc on
non-interactive blocks the moment any future hotkey lets focus land
there.

The registry is now narrowed to
`Record<InteractionKind, InteractionDriver<InteractionKind>>`, where
`InteractionKind = "interactive-agent" | "wait-human"` is declared
in `src/cli/lib/classifyNode.ts` alongside the type-guard
`isInteractionKind`. The four internal call sites
(`LiveFooter.tsx:42`, `PipelineRunView.tsx:103`,
`pipelineReducer.ts:70`, `pipelineReducer.ts:81`) gate their
registry access on the predicate; tsc enforces the atomicity. Future
interaction kinds (e.g. `approve-diff`) are added to
`InteractionKind`, never by un-padding a deleted noop.

`BlockKind` itself remains unchanged at 7 kinds. The
`pipelineEvents` contract (`start.blockKind`, `Block.kind`,
`LiveBlock.kind` all `BlockKind`) is untouched — this is an internal
refinement, not an external breaking change.
```

## 4. Data flow

No runtime data flow change. Every emit, every reducer transition,
every render path that exists today exists after the change with
identical observable output. The only difference is that two of the
five paths "into" the registry are now compile-checked through a
predicate; the other three (`driver-event`, `end`, and the gate-driver
escape sentinel) were already de facto interaction-only.

```
NodeEvent (start, driver-event, end, …)
   │
   ▼
pipelineReducer  ──── case "driver-event" ───► isInteractionKind(live.kind) ? drivers[live.kind].reduce(…) : state
   │                  case "end"          ───► isInteractionKind(live.kind) ? drivers[live.kind].onFreeze?.(…) : {}
   ▼
PipelineState
   │
   ▼
PipelineRunView ───── useInput Esc ────────► isInteractionKind(live.kind) ? drivers[live.kind].keymap.escape(live) : (fallthrough)
   │
   ▼
LiveFooter      ───── renderFooter ────────► isInteractionKind(block.kind) ? drivers[block.kind].renderFooter(block, ctx) : null
```

The `Map<blockId, KindState>` per-driver state pattern documented at
ADR-0014:32-34 is unaffected — those maps live inside `agentDriver`
and `gateDriver` themselves and are only accessed through the
registry, which is now guaranteed by tsc to only contain those two.

## 5. Components

| Component | Path | Change |
| --- | --- | --- |
| `InteractionKind` type + `isInteractionKind` predicate | `src/cli/lib/classifyNode.ts` (append below `BlockKind` at `:11`) | New additive exports. `BlockKind` untouched. |
| `InteractionDriver<K>` interface | `src/cli/lib/interactions/driver.ts:27` | Rebind `K extends BlockKind` → `K extends InteractionKind`. `LiveBlock` / `Block` / `Outcome` params keep their existing types. |
| `drivers` registry | `src/cli/lib/interactions/drivers/index.ts:17-25` | Narrow to 2 entries; satisfies `Record<InteractionKind, …>`. Delete `noopDriver` helper at `:7-15`. Swap the `BlockKind` import for `InteractionKind`. |
| `LiveFooter` footer dispatch | `src/cli/components/LiveFooter.tsx:42` | Wrap `drivers[block.kind].renderFooter(…)` in `isInteractionKind(block.kind) ? … : null`. Import the predicate. |
| `PipelineRunView` Esc handler | `src/cli/components/PipelineRunView.tsx:102-104` | Add `&& isInteractionKind(state.live.kind)` to the `key.escape` branch. Import the predicate. |
| `pipelineReducer` driver-event case | `src/cli/lib/pipelineReducer.ts:68-73` | Add `|| !isInteractionKind(state.live.kind)` to the early-return guard. Import the predicate. |
| `pipelineReducer` end case | `src/cli/lib/pipelineReducer.ts:78-90` | Replace the unconditional `const driver = drivers[state.live.kind]; const freezeExtras = driver.onFreeze?.(…)` with a predicate-gated ternary. |
| Registry test | `src/cli/tests/interactions-registry.test.ts` | Delete the noop-behavior `it()` at `:20-49`. Shrink the key-count assertion at `:7-16` from 7 to 2 keys. Add a `// @ts-expect-error` proof line. Keep the "wired to the real drivers" `it()` at `:52-57`. |
| ADR-0014 | `docs/adr/0014-interaction-drivers.md` | Append "Refinement (2026-05-12)" stanza between `:66` (end of Notes) and `:68` (References header). Original Decision section is **not** rewritten — append-only per the ADR convention quoted at `:42-60`. |
| `pipelineEvents.ts` | `src/cli/lib/pipelineEvents.ts:23,37,51` | **Read-only — no edits.** `start.blockKind: BlockKind`, `Block.kind: BlockKind`, `LiveBlock.kind: BlockKind` all stay. Verifier confirmed; chat round bullet "no external break" pinned this. |

## 6. Constraints

- **Atomic commit.** Registry narrowing + four call-site gates land
  together. Chat round bullet "atomic edit is non-negotiable". Tsc
  enforces this — landing the registry narrowing without one of the
  gates produces a compile error of the form `Property '<kind>' does
  not exist on type 'Record<InteractionKind, …>'` at the gateless
  site. The forcing function is the mechanism, not a CI rule.

- **`BlockKind` unchanged.** Seven kinds remain. The event contract
  (`pipelineEvents.ts:23,37,51`) is untouched — no agent /
  frontmatter / CLI / MCP surface shifts. Verified by blast-radius
  subagent in the verifier rubric.

- **`InteractionDriver<K>`'s `K` rebinds to `InteractionKind`.** Today
  the bound is `K extends BlockKind` (`driver.ts:27`). After: `K
  extends InteractionKind`. `agentDriver` and `gateDriver` already
  declare `kind: "interactive-agent"` and `kind: "wait-human"`
  respectively, so the rebind is a no-op for them. The change forces
  any future "driver" outside the InteractionKind set to be a
  type error at registration.

- **`onFreeze` stays optional.** `driver.ts:36` reads
  `onFreeze?(live, outcome): Partial<Block>`. The `end` case's new
  predicate-gated ternary preserves the existing behavior: non-driver
  kinds fall through with `freezeExtras = {}`, exactly like the old
  noop driver returned an empty object via `?.`.

- **No new ADR.** This is a refinement of ADR-0014, not a new
  decision. Refinement stanza follows the append-only convention
  pinned at ADR-0014:42-60 ("Adding a new kind: … `tsc` enforces
  every other site"). Other ADRs remain untouched.

- **No README / CONTEXT.md edits.** Verifier confirmed zero
  doc-ripple beyond the ADR refinement (`docs/superpowers/specs/2026-05-12-interaction-driver-record-is-noop-padded-design.md` will be created by this slice; that is the design doc, not a README edit).

- **Internal-only.** `drivers` is not re-exported from any package
  entry point — blast-radius subagent confirmed no external
  reference. Behavior visible to the CLI / TUI / pipeline / agent /
  MCP surface is identical pre- and post-change.

## 7. Testing

**Test file changes are limited to the registry test.** Chat round
bullet "INVERT, not ADD" — the file already exists and asserts the
old shape; those assertions become invalid after narrowing and must
be deleted, not adjusted.

**`src/cli/tests/interactions-registry.test.ts` — final shape (~28
lines):**

```ts
import { describe, it, expect } from "vitest";
import { drivers } from "../lib/interactions/drivers/index.js";
import type { InteractionDriver } from "../lib/interactions/driver.js";
import type { InteractionKind } from "../lib/classifyNode.js";

describe("drivers registry", () => {
  it("declares one driver per InteractionKind", () => {
    expect(Object.keys(drivers).sort()).toEqual(
      ["interactive-agent", "wait-human"].sort(),
    );
  });

  it("interactive-agent and wait-human are wired to the real drivers", async () => {
    const { agentDriver } = await import("../lib/interactions/drivers/agent.js");
    const { gateDriver } = await import("../lib/interactions/drivers/gate.js");
    expect(drivers["interactive-agent"]).toBe(agentDriver);
    expect(drivers["wait-human"]).toBe(gateDriver);
  });

  it("rejects non-InteractionKind keys at the type level", () => {
    // @ts-expect-error - 'tool' is not an InteractionKind; satisfies must reject it
    const _proof = {
      "interactive-agent": drivers["interactive-agent"],
      "wait-human": drivers["wait-human"],
      tool: drivers["interactive-agent"],
    } as const satisfies Record<InteractionKind, InteractionDriver<InteractionKind>>;
    void _proof;
  });
});
```

**Existing tests that must stay green unchanged** (verifier
blast-radius subagent, "4 driver tests verified-still-pass"):

- `src/cli/tests/interactions-gate-driver.test.tsx` — gate driver
  contract; does not touch the registry shape.
- `src/cli/tests/interactions-agent-driver.test.ts` — agent driver
  contract; same.
- `src/cli/tests/LiveFooter.test.tsx` — LiveFooter rendering. Today's
  cases use `interactive-agent` and `wait-human` blocks, so the
  predicate is always true. If a case uses a non-interactive kind,
  it asserts a `null` footer — same observable behavior as before
  (noop driver also returned `null`).
- `src/cli/tests/interaction-driver-escape-scenario.test.ts` — smoke
  scenario for the interactive-driver Esc contract. Uses
  `interactive-agent` and `wait-human` only.

**Tests that should be re-read** (chat round; verifier blast-radius
"2 view tests reviewed"):

- `src/cli/tests/pipelineReducer.test.ts` — confirm no case constructs
  a `LiveBlock` with a non-interactive `kind` and then fires a
  `driver-event` against it (impossible by design today, but verify).
- `src/cli/tests/pipeline-run-view.test.tsx` — same shape; confirm no
  case fires Esc on a non-interactive live block.

**Mocks** (verifier "plus 2 indirect mocks"): if any test stubs the
drivers registry, it must drop the five noop entries from its stub.
Audit at edit time.

## 8. Blast radius / impact surface

- **Size:** M. Pure refinement — no behavior change, no schema
  change, no public API change. Surface area shrinks (registry from
  7 entries to 2; one helper deleted).
- **Surfaces crossed:** CLI runtime (`pipelineReducer.ts`), TUI
  components (`LiveFooter.tsx`, `PipelineRunView.tsx`), interactions
  module (`drivers/index.ts`, `driver.ts`), type system
  (`classifyNode.ts`), tests, 1 ADR amendment.
- **Breaking change:** **None externally.** `drivers` is
  internal-only (no external re-export — confirmed by blast-radius
  subagent). `pipelineEvents` keeps `BlockKind` on
  `start.blockKind` / `Block.kind` / `LiveBlock.kind` so no agent /
  frontmatter / CLI / MCP surface shifts. **Internal-atomic-edit
  required: YES** — registry narrowing + four call-site gates land
  in the same commit, enforced by tsc.
- **Files touched (6 source + 1 ADR + 1 test edited):**
  - **Edit (6 source):** `src/cli/lib/classifyNode.ts` (append
    `InteractionKind` + `isInteractionKind`),
    `src/cli/lib/interactions/driver.ts:27` (`K extends BlockKind` →
    `K extends InteractionKind`),
    `src/cli/lib/interactions/drivers/index.ts:7-25` (delete
    `noopDriver`, narrow registry to 2 entries),
    `src/cli/components/LiveFooter.tsx:42` (gate on
    `isInteractionKind`),
    `src/cli/components/PipelineRunView.tsx:102-104` (gate on
    `isInteractionKind`),
    `src/cli/lib/pipelineReducer.ts:68-73 & 78-90` (gate two
    cases).
  - **Edit (1 test):** `src/cli/tests/interactions-registry.test.ts`
    (delete noop-behavior block, shrink key-count, add
    `@ts-expect-error`).
  - **Append (1 ADR):** `docs/adr/0014-interaction-drivers.md`
    (Refinement (2026-05-12) stanza).
  - **Re-typecheck only (~6 tests):**
    `src/cli/tests/interactions-gate-driver.test.tsx`,
    `src/cli/tests/interactions-agent-driver.test.ts`,
    `src/cli/tests/LiveFooter.test.tsx`,
    `src/cli/tests/interaction-driver-escape-scenario.test.ts`,
    `src/cli/tests/pipelineReducer.test.ts`,
    `src/cli/tests/pipeline-run-view.test.tsx`.
  - **Untouched read-only:** `src/cli/lib/pipelineEvents.ts` (event
    shape stays on `BlockKind`).
- **Spec / docs ripple:** 1 ADR refinement stanza appended
  (ADR-0014). 0 CONTEXT.md edits. 0 README edits. 0 other ADR
  edits. This design doc itself
  (`docs/superpowers/specs/2026-05-12-interaction-driver-record-is-noop-padded-design.md`)
  is the only `specs/` addition.
- **Migration / data:** none. No trace JSONL shape change, no
  checkpoint migration, no CLI flag change, no agent rubric change.
- **Behavior delta visible to users:** none today. The future delta
  (when a non-interactive block can take focus) is: Esc falls
  through to normal handling instead of being silently swallowed.
  That is the bug-prevention payload of the slice.

## 9. Open questions

1. **`InteractionDriver<K>`'s `K` rebind — keep the generic or
   collapse to a non-generic `InteractionDriver`?** Today
   `agentDriver: InteractionDriver<"interactive-agent">` and
   `gateDriver: InteractionDriver<"wait-human">`. With only two
   kinds, the generic still pays for itself (the `kind` literal type
   on each driver value is checked against the registry key). With
   three or more, it pays for itself more obviously. Recommendation:
   keep the generic. Reviewer: confirm.

2. **`pipelineReducer.ts` end case — predicate guard vs.
   shape-of-driver test?** The proposed shape is
   `isInteractionKind(state.live.kind) ? drivers[…].onFreeze?.(…) ?? {} : {}`.
   An alternative: drop the predicate and trust that `onFreeze` is
   optional — but that requires keeping a registry lookup against a
   kind that isn't in the registry, which tsc rejects. The
   predicate is mandatory; this is documentation, not a real
   choice. Resolved.

3. **Should `isInteractionKind` live in `classifyNode.ts` or in a
   new `interactions/kinds.ts`?** `classifyNode.ts` already owns
   `BlockKind` and the classifier; co-locating the narrower kind +
   predicate keeps the type system in one place. The interactions
   folder owns drivers, not the kind definition. Recommendation:
   `classifyNode.ts`. Reviewer: confirm.

4. **Future sibling — should `noopDriver`-style padding in other
   registries (e.g. anywhere else in the codebase using `as const
   satisfies Record<WideKind, …>`) get the same narrowing
   treatment?** Out of scope for this slice. Note here so a future
   meditation has a pointer; a single Grep for `noopDriver` /
   `noop.*Driver` / `as const satisfies Record<` would surface
   candidates.
