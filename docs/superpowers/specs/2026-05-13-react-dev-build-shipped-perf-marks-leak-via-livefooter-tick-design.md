# Design: Pin `NODE_ENV=production` in tsup + gate the `LiveFooter` idle tick

**Date:** 2026-05-13
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-13T1057-react-dev-build-shipped-perf-marks-leak-via-livefooter-tick.md`
**Related ADR:** new ADR-0017 (`docs/adr/0017-tsup-node-env-bundle-pin.md`) lands with this change; ADR-0014 (`interaction-kind drivers`, accepted 2026-05-12) makes `LiveFooter` load-bearing across every interactive pipeline.

## 1. Motivation

A long-idle interactive chat (e.g. the `parallel-illumination-to-implementation` verifier/refinement loop, left open without typing) emits this warning on stderr:

```
(node:54717) MaxPerformanceEntryBufferExceededWarning: Possible perf_hooks memory leak detected. 1000001 measure entries added
```

Two compounding defects produce it. Either alone kills the warning; both together also reclaim idle CPU.

### 1.1 Defect A — unconditional 100 ms tick in `LiveFooter`

`src/cli/components/LiveFooter.tsx:38-42`:

```ts
const [, tick] = React.useState(0);
React.useEffect(() => {
  const id = setInterval(() => tick(n => n + 1), 100);
  return () => clearInterval(id);
}, []);
```

The tick exists to keep the `· 12.4s` elapsed counter in `statusLine()` and `formatElapsed()` (`src/cli/components/LiveFooter.tsx:7-9, 12-25`) moving. It runs at 10 Hz for the entire lifetime of any `LiveBlock` — including while `block.kind === "interactive-agent"` or `"wait-human"` is parked waiting for a human keystroke. Each tick fires `setState` → React commit → Ink reconcile, regardless of whether the visible string actually changed. This is the sole `setInterval` under `src/cli/components/` (verified — see Verification §10.1).

### 1.2 Defect B — `tsup` ships the React **dev** bundle

`tsup.config.ts:14`:

```ts
define: { __APPARAT_PROD__: "true" }
```

`process.env.NODE_ENV` is never pinned. With it unset at bundle time, esbuild does not dead-code the `process.env.NODE_ENV !== "production"` branches inside `react-dom` / `react-reconciler` / Ink's renderer, so the published `dist/cli/index.js` ships the **dev** build of React (`react: ^19.2.4` per `package.json`). React 19's dev reconciler instruments every commit with `performance.measure(...)` calls — User Timing entries intended for React DevTools, never read by anyone in a CLI process. The entries accumulate in the perf buffer; Node's default ceiling is 1e6, at which point Node logs the warning once and starts dropping entries.

Composed: 10 commits/s (Defect A) × ~N `performance.measure` calls/commit (Defect B) × hours-idle ≈ 1e6 entries. Matches the observed "long time, no typing" trigger.

### 1.3 Why now — load-bearing surface

ADR-0014 (Accepted 2026-05-12, `interaction-kind drivers`) just made `LiveFooter` the canonical interactive surface across every pipeline that opens an `interactive-agent` or `wait-human` block. The warning was observed during a real `parallel-illumination-to-implementation` session and reads to an operator like apparatus itself is broken. The triage tax — "is this a bug in my pipeline or in apparatus?" — is the cost; the leak itself is harmless until ~28 wall-clock hours of idle.

Neither defect is caught by `npm test` (tests run for seconds, not hours) nor by `pipeline validate` (the validator operates on `.dot` source, not the bundled binary's React mode).

The fix also carries adjacent wins:

- **Bundle size.** Prod React is materially smaller than dev React; every published install of `apparat-cli` shrinks.
- **Idle CPU.** A 10 Hz Ink re-render of an idle interactive chat is wasted laptop battery; even a static `<TextInput>` walks its reconciliation tree 600× per minute today.
- **Dev/prod parity.** `npm run dev` (`tsx`) and `npm run build` (`tsup`) currently disagree on React's mode in silent ways.

## 2. Decision summary

Three landed pieces:

1. **Pin `process.env.NODE_ENV` at bundle time** (`tsup.config.ts:14`). Extend `define:` with `"process.env.NODE_ENV": JSON.stringify("production")`. One-line addition. Fixes Defect B on its own.
2. **Gate the `LiveFooter` interval** (`src/cli/components/LiveFooter.tsx:38-42`). Schedule the `setInterval` only when `block.kind === "streaming"`, at 500 ms cadence (not 100 ms). For `interactive-agent`, `wait-human`, and any other non-streaming kind, schedule no interval at all. Fixes Defect A and reclaims idle CPU.
3. **Build-time regression scan** (`tsup.config.ts` `onSuccess`). After build, grep `dist/cli/index.js` for `react-dom.development` / `react-reconciler.development` strings; fail the build if found. Prevents future config drift from silently reintroducing Defect B.

Plus a README troubleshooting line and a new ADR.

**Locked OUT of scope** (illumination steps 5 & 6, explicit):

- Broader audit of other `setInterval` users (`HeartbeatWatch`, `PipelineRunView`, `PipelineTraceView`). None have been reported leaking; YAGNI until a second report lands.
- `performance.clearMarks()` budgeting or `performance.maxEntries` tuning. The right fix is to stop creating the entries, not to budget for them.
- Changes to the body-line `<Static>` hygiene (already landed in `2026-04-14-pipeline-tui-flicker-fix.md`).
- No changes to `interaction-kind` drivers (`src/cli/lib/interactions/drivers/`) — they continue to own input rendering; only the elapsed-counter tick changes.

## 3. Architecture

### 3.1 Two-layer fix

```
Layer A   Build-time     → pin NODE_ENV=production; dev-build regression scan
Layer B   Component      → gate the tick on block.kind === "streaming", 500ms
```

Each layer kills the warning independently; together they also kill the wasted idle CPU. The build-time pin (Layer A) is the conservative move and ships first in the diff order so a single-layer rollback still leaves the warning fixed.

### 3.2 `tsup.config.ts` (Layer A)

Current state at `tsup.config.ts:14`:

```ts
define: { __APPARAT_PROD__: "true" },
```

After:

```ts
define: {
  __APPARAT_PROD__: "true",
  "process.env.NODE_ENV": JSON.stringify("production"),
},
```

`JSON.stringify("production")` produces `'"production"'` — esbuild requires the value to be a parseable JS literal, not the bare string. This is the standard tsup/esbuild pattern.

`onSuccess` (currently at `tsup.config.ts:18-24`) gains a regression scan after the existing `cpSync` block:

```ts
async onSuccess() {
  cpSync("src/cli/pipelines", "dist/pipelines", { recursive: true });
  cpSync("src/cli/skills", "dist/skills", { recursive: true });
  console.log("Assets copied to dist/");

  // Regression scan: dev React bundles must never ship.
  const bundle = readFileSync("dist/cli/index.js", "utf8");
  const devMarkers = ["react-dom.development", "react-reconciler.development"];
  const found = devMarkers.filter((m) => bundle.includes(m));
  if (found.length > 0) {
    console.error(`Build failed: dev React markers in bundle: ${found.join(", ")}`);
    console.error("Check that define['process.env.NODE_ENV'] is pinned to '\"production\"'.");
    process.exit(1);
  }
},
```

`readFileSync` is imported alongside the existing `cpSync` at `tsup.config.ts:2`.

Rationale: the scan operates on the **already-built** bundle, so it catches the failure regardless of how it might re-enter (a future `define:` edit, an esbuild upgrade that changes constant-folding semantics, a dep change that imports `react-dom/cjs/react-dom.development.js` directly). It is the lower-effort of the illumination's two regression-check options (illumination Step 3 (i) vs (ii)); option (i) is chosen.

### 3.3 `src/cli/components/LiveFooter.tsx` (Layer B)

Current state at `:38-42`:

```ts
const [, tick] = React.useState(0);
React.useEffect(() => {
  const id = setInterval(() => tick(n => n + 1), 100);
  return () => clearInterval(id);
}, []);
```

After:

```ts
const [, tick] = React.useState(0);
React.useEffect(() => {
  if (block.kind !== "streaming") return;
  const id = setInterval(() => tick(n => n + 1), 500);
  return () => clearInterval(id);
}, [block.kind]);
```

Three changes:

- **Gate.** Early-return when `block.kind !== "streaming"`. For `interactive-agent`, `wait-human`, `agent`, and any non-streaming kind, no interval is ever scheduled.
- **Cadence.** 100 ms → 500 ms. `formatElapsed` rounds to one decimal (`(ms / 1000).toFixed(1)`); 500 ms is the truthful precision of the displayed string and halves wakeups during streaming.
- **Dependency.** `[]` → `[block.kind]`. When a block transitions kind (e.g. an `interactive-agent` block finishes its human input and transitions to `streaming` for a follow-up; or a `streaming` block parks back to `interactive-agent`), the effect re-runs and the interval is scheduled/torn down accordingly.

The gate uses `block.kind === "streaming"` directly rather than `isInteractionKind(block.kind)` (imported at `:5` and already used at `:43`). The two predicates are not complements — `isInteractionKind` returns `true` for `interactive-agent` and `wait-human`, which are exactly the *non*-streaming kinds we want to skip; using `block.kind === "streaming"` is the precise positive condition for "this block has mutating turns/tokens/elapsed worth animating."

The `statusLine()` function (`:12-25`) is untouched. For non-streaming blocks, the elapsed counter is recomputed on Ink's natural re-renders (e.g. when stats update from upstream `pipelineEvents`); it does not advance "on its own" while parked, which is the correct behaviour — the elapsed counter for a paused chat ticking up against no activity is itself confusing.

### 3.4 Files-touched buckets

| Bucket          | File                                                        | Treatment |
|---|---|---|
| Build config    | `tsup.config.ts`                                            | Edit — `define` + `onSuccess` scan; import `readFileSync` |
| CLI component   | `src/cli/components/LiveFooter.tsx`                         | Edit — gate `setInterval` on `block.kind === "streaming"`, 500ms |
| Test            | `src/cli/tests/LiveFooter.test.tsx`                         | Extend — interval-gating spec(s) |
| Docs — ADR      | `docs/adr/0017-tsup-node-env-bundle-pin.md`                 | New — records the `NODE_ENV` pin + regression scan |
| Docs — README   | `README.md` (Development section near `:228-235`)           | Edit — one paragraph noting the historical warning was bundle-config drift |

Total: **5 files** — 2 source + 1 test + 1 ADR + 1 README. Verifier called this **S** and the design holds at that size.

## 4. Components & key edits

### 4.1 `tsup.config.ts` (edited)

Current 25 LOC (verified via Read). Two surgical edits:

- **Import.** Line 2 today: `import { cpSync } from "fs";`. After: `import { cpSync, readFileSync } from "fs";`.
- **`define:` block** at `:14`. Add `"process.env.NODE_ENV": JSON.stringify("production")`. The existing `__APPARAT_PROD__: "true"` is untouched — it is an apparatus-internal constant used by the `__RALPH_PROD__`-style dev/prod detection seam noted in `memory/tsup-multi-entry-path-issues.md`, distinct from React's NODE_ENV branch.
- **`onSuccess`** at `:18-24`. Append the dev-marker scan after the existing `cpSync` + `console.log` lines. The scan reads the post-clean, post-build `dist/cli/index.js` and exits the build process non-zero if either marker is present.

### 4.2 `src/cli/components/LiveFooter.tsx` (edited)

Five-line internal change to the existing `React.useEffect` at `:38-42`. No new imports, no exported-signature change. The component continues to accept the same props (`block`, `inputBuffer`, `onInputChange`, `onInputSubmit`) and the only in-repo consumer (`src/cli/components/PipelineRunView.tsx:6` — verified) sees byte-identical output for every kind it cares about. Tested kinds (per existing `src/cli/tests/LiveFooter.test.tsx`): `interactive-agent`, `wait-human`, `agent`, plus `streaming` covered by this design's new test.

### 4.3 `src/cli/tests/LiveFooter.test.tsx` (extended)

Currently 4 cases (verified via Read), all kind-rendering assertions using `ink-testing-library`'s `render` + `lastFrame()`. Add one case that exercises the interval-gating contract using fake timers:

```ts
it("schedules no interval for non-streaming kinds", () => {
  vi.useFakeTimers();
  const blk = block("interactive-agent", "a-3");
  __agentStatesForTest.set("a-3", {
    child: { kill: vi.fn() } as never,
    onDone: vi.fn(),
  });
  render(
    <LiveFooter
      block={blk}
      inputBuffer=""
      onInputChange={() => {}}
      onInputSubmit={async () => {}}
    />,
  );
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("schedules a 500ms interval for streaming kind", () => {
  vi.useFakeTimers();
  const blk = block("streaming", "s-1");
  render(
    <LiveFooter
      block={blk}
      inputBuffer=""
      onInputChange={() => {}}
      onInputSubmit={async () => {}}
    />,
  );
  expect(vi.getTimerCount()).toBe(1);
  vi.useRealTimers();
});
```

`vi.getTimerCount()` is the strongest possible assertion of "no interval scheduled" — it is independent of whether the elapsed counter rendered or not, which is the actual contract being protected. Existing tests continue to pass because they assert on visible output (`lastFrame()`), not timer behaviour. The new tests use `vi.useFakeTimers()` so the existing `afterEach` cleanup (which only clears the driver state maps at `:21-24`) remains untouched; each new test pairs its `useFakeTimers` with an in-test `useRealTimers` to keep timer-mode isolation explicit.

### 4.4 `docs/adr/0017-tsup-node-env-bundle-pin.md` (new)

Outline:

- **Context.** The published `apparat-cli` bundle shipped the React **dev** build because `tsup.config.ts`'s `define:` never pinned `process.env.NODE_ENV`. The dev reconciler's `performance.measure(...)` calls accumulated in the perf-hooks buffer over hours of idle interactive chat use, eventually emitting `MaxPerformanceEntryBufferExceededWarning` on stderr — observed in real operator use during a `parallel-illumination-to-implementation` chat.
- **Decision.** `tsup.config.ts` pins `"process.env.NODE_ENV": JSON.stringify("production")` in `define:`. `onSuccess` runs a regression scan over `dist/cli/index.js` for `react-dom.development` / `react-reconciler.development` strings; build fails non-zero if either is present.
- **Precedent.** Standard tsup/esbuild pattern; documented across the bundler ecosystem.
- **Considered alternatives.**
  - `performance.maxEntries` tuning or periodic `performance.clearMarks()`. Rejected — symptomatic; right fix is to stop creating the entries.
  - Test-time assertion that imports React from the built `dist/` and asserts a prod marker. Rejected — heavier; the static string scan is sufficient and runs at build time.
- **Consequences.** Bundle size shrinks (prod React < dev React). Dev/prod parity between `npm run dev` (`tsx`) and `npm run build` (`tsup`) is preserved. Any future bundler/dep change that re-introduces dev React fails CI immediately rather than silently.

### 4.5 `README.md` Development section (edited)

Current state at `:228-235` (verified):

```
## Development

```bash
npm install
npm run dev        # tsx watch
npm run build      # tsup → dist/
npm link           # test apparat binary locally
```
```

Add one paragraph after the code block:

```md
> **Troubleshooting.** Earlier `apparat-cli` releases occasionally emitted
> `MaxPerformanceEntryBufferExceededWarning` after a long-idle interactive
> chat. This was bundle-config drift (the React dev reconciler shipped),
> not a real leak — fixed in this release. If the warning reappears against
> a current build, the `onSuccess` regression scan in `tsup.config.ts`
> should already have failed the build; see ADR-0017.
```

## 5. Data flow

### 5.1 Layer A — build pipeline (after)

```
npm run build
  → tsup picks up tsup.config.ts
    → define: { __APPARAT_PROD__: "true",
                "process.env.NODE_ENV": "\"production\"" }
    → esbuild constant-folds process.env.NODE_ENV !== "production" branches
      → react-dom dev branches dead-coded
      → react-reconciler dev branches dead-coded
    → dist/cli/index.js produced (no dev React markers)
  → onSuccess:
    → cpSync pipelines, skills (unchanged)
    → readFileSync("dist/cli/index.js")
    → grep "react-dom.development" / "react-reconciler.development" → none found
    → return (build green)
```

### 5.2 Layer A — regression scan failure (e.g. future dep change)

```
npm run build
  → ... bundle produced with stray "react-dom.development" import ...
  → onSuccess:
    → readFileSync("dist/cli/index.js")
    → grep finds "react-dom.development"
    → console.error("Build failed: dev React markers in bundle: react-dom.development")
    → console.error("Check that define['process.env.NODE_ENV'] is pinned ...")
    → process.exit(1)
```

### 5.3 Layer B — `LiveFooter` lifecycle (streaming block)

```
PipelineRunView mounts <LiveFooter block={streamingBlk} ...>
  → useEffect with deps [block.kind = "streaming"]
    → block.kind === "streaming" — schedule setInterval(tick, 500)
    → cleanup function registered
  → every 500ms: tick → setState → React commit → Ink reconcile → statusLine() recomputed
  → stream completes; PipelineRunView swaps block.kind to "agent" or unmounts
    → effect cleanup: clearInterval
```

### 5.4 Layer B — `LiveFooter` lifecycle (interactive-agent block)

```
PipelineRunView mounts <LiveFooter block={interactiveBlk} ...>
  → useEffect with deps [block.kind = "interactive-agent"]
    → block.kind !== "streaming" — early return; no setInterval scheduled
  → operator walks away for 8 hours
    → zero ticks, zero React commits, zero performance.measure calls
    → stderr stays clean
  → operator returns, types a keystroke
    → onInputChange / onInputSubmit fire from the driver's TextInput (existing path)
    → React reconciles only the input character — natural event re-render, no interval needed
  → block transitions kind (e.g. submission triggers "streaming")
    → deps array changes → effect re-runs → interval scheduled now
```

### 5.5 Layer B — kind-transition mid-block

```
block.kind: "streaming" → "interactive-agent" (e.g. mid-loop human gate)
  → React notices [block.kind] dep change
  → cleanup fires: clearInterval (existing interval for "streaming" path)
  → effect runs again: block.kind !== "streaming" → early return
  → result: no interval until next "streaming" transition
```

This is the explicit value of the dep-array change `[]` → `[block.kind]`: without it, a kind change would leave the previous mode's interval scheduled forever (or not at all, depending on which mode was first). The dep array makes the gate kind-state-tracking, not mount-state-tracking.

## 6. Blast radius / impact surface

- **Size: S** (verifier final pass; explainer Tier-2 `## Blast radius` confirms). 5 files: 2 source + 1 test + 1 ADR + 1 README. No upgrade in the design loop.
- **Surfaces crossed:** Build config (`tsup.config.ts`); one Ink/React component (`LiveFooter.tsx`); one test file (`LiveFooter.test.tsx`); docs (1 new ADR, 1 paragraph in README). No `.dot` schema change. No pipeline-engine change. No agent-rubric change. No CLI commander / `program.ts` change. No tracer-schema change. No daemon change. No MCP change.
- **Breaking changes:** **none.**
  - `LiveFooter` exports and props are byte-identical. The only in-repo consumer is `src/cli/components/PipelineRunView.tsx:6` (verified — single import site).
  - No CLI flag, env var, config field, or schema is altered.
  - `__APPARAT_PROD__` is preserved alongside the new `process.env.NODE_ENV` pin — the dev/prod detection seam keeps working as before.
  - `tsup.config.ts` `entry`, `format`, `outDir`, `clean`, `banner` are untouched. The `onSuccess` `cpSync` calls for pipelines and skills are preserved verbatim; the regression scan is additive.
- **Spec / docs ripple checklist:**
  - [ ] `docs/adr/0017-tsup-node-env-bundle-pin.md` — new; records the NODE_ENV pin + regression scan.
  - [ ] `README.md:228-235` (Development section) — one troubleshooting paragraph appended after the existing fence.
  - [ ] *No* CONTEXT.md change — no new domain term introduced.
  - [ ] *No* SKILL.md change — preflight rule unchanged.
- **Test ripple checklist:**
  - [ ] **Extend** `src/cli/tests/LiveFooter.test.tsx` — add 2 interval-gating cases using `vi.useFakeTimers()` + `vi.getTimerCount()`.
  - [ ] *No* test fixture upgrade — existing 4 cases pass unchanged.
  - [ ] *No* new scenario file under `.apparat/scenarios/` — the perf-leak symptom is hour-scale and CI cannot exercise it; the build-time regression scan is the standing guard.

## 7. Trade-offs

### 7.1 Gate-then-throttle vs throttle-only

**Gate-then-throttle chosen.** Illumination Step 2 (a) + Step 2 (b). Alternatives:

- *Throttle-only at 1 Hz across the board* (illumination Step 2 (b)). Halves the warning rate but keeps the wasted idle wakeups during `interactive-agent` / `wait-human` indefinitely. Fixes the warning slower, not the underlying wasted work.
- *Drop the tick entirely* (illumination Step 2 (c)). Cleanest but the elapsed counter freezes mid-`streaming` until the next event arrives — degrades the live-feel during real activity, which the user explicitly values.

Gate-then-throttle preserves the live-feel where it matters (`streaming`) and kills the idle work entirely where it doesn't (`interactive-agent`, `wait-human`).

### 7.2 100 ms → 500 ms cadence

**500 ms chosen** (illumination Step 2 recommendation). `formatElapsed` already rounds to one decimal — 100 ms cadence is finer than the displayed precision. 1 Hz would also work and would halve wakeups again; 500 ms is the middle ground that keeps the elapsed counter "visibly live" without the cognitive feel of a once-per-second tick. If practice shows 1 Hz is indistinguishable, the constant is a one-character edit.

### 7.3 `block.kind === "streaming"` vs `isInteractionKind(block.kind)`

**Direct kind check chosen.** `isInteractionKind` returns `true` for `interactive-agent` and `wait-human` and is already imported at `:5`. Using `!isInteractionKind(block.kind)` would be a double-negative that would happen to be correct today, but if a future fourth kind is added (e.g. `idle` or `paused`), the new kind's interval behaviour would silently default to "schedule" rather than requiring an affirmative entry in the predicate. `block.kind === "streaming"` is the positive condition that protects against silent default behaviour for unknown kinds.

### 7.4 Dev-build regression scan: static string vs runtime probe

**Static-string scan chosen.** Illumination Step 3 (i) vs (ii). The runtime probe (import React from `dist/`; assert version+mode) would catch a wider variety of failures (e.g. an accidentally bundled dev-only side effect that doesn't emit the literal string `react-dom.development`). It also requires spinning up Node in the build pipeline and adding a test-mode entrypoint to the bundle. The static string scan operates on bytes already on disk, is O(bundle-size), and the two markers chosen are stable React 19 strings. If a future React version drops or renames these markers, the scan becomes a no-op (not a false-positive) — at that point a refresh of the markers is the maintenance.

### 7.5 Single PR vs split

**Single PR.** The natural split would be (1) NODE_ENV pin, (2) regression scan, (3) `LiveFooter` gate. Splitting introduces three review cycles for what is collectively a 5-file diff with no cross-piece coupling. The illumination explicitly suggests landing the NODE_ENV pin "first as the conservative move," but that ordering is internal to the commit chain inside one PR; a reviewer can ask for the commits to land in stack-order if desired.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the extended `src/cli/tests/LiveFooter.test.tsx` (6 cases).
- `npm run build` produces a `dist/cli/index.js` that:
  - Does **not** contain `react-dom.development`.
  - Does **not** contain `react-reconciler.development`.
  - Is materially smaller than the pre-change build (measurable shrink).
- `apparat pipeline run` against a real project keeps an `interactive-agent` block open for 5 minutes with no operator input. Stderr is silent. `vi.getTimerCount()` shape: when the block is `interactive-agent`, no `setInterval` is registered against `LiveFooter`.
- A `streaming` block runs for 5 minutes (e.g. a long agent loop). Elapsed counter advances at 500 ms cadence. After 5 min, `dist`-built bundle's `performance.getEntries()` reports fewer than 100 entries for that block's lifetime (vs ~3000 today at 10 Hz × 5 min, plus React-reconciler-per-commit fan-out).
- An intentionally re-introduced `dev React` import (e.g. a hand-broken `tsup.config.ts` reverting the NODE_ENV pin) makes `npm run build` exit non-zero with the explanatory message from §3.2.

Repo-wide grep invariants (post-merge):

- `grep -nR "setInterval" src/cli/components` — one match, inside `LiveFooter.tsx`, inside an `if (block.kind === "streaming")` branch.
- `grep -n "process.env.NODE_ENV" tsup.config.ts` — exactly one match inside `define:`.
- `grep -n "react-dom.development\|react-reconciler.development" tsup.config.ts` — two matches inside the regression scan; zero matches in `dist/cli/index.js` after a clean build.

Behaviour invariants:

- No new tracer fields. `pipeline-start` / `pipeline-end` / `node-*` JSONL events byte-identical.
- No new CLI flag, no new env var, no new top-level command, no `.dot` schema change.
- ADR-0014's interaction-kind drivers continue to render their footers verbatim — only the `statusLine` tick changes.
- The component's elapsed counter is "live" for `streaming` (animated by the gated interval) and "event-driven" for non-streaming kinds (advances on natural Ink re-renders from upstream stats updates). Neither behaviour is documented elsewhere; the test suite is the contract.

## 9. Open questions

### 9.1 Should the regression scan also check `dist/daemon/index.js` and the MCP entrypoint?

The illumination's worry is React-shaped: the dev reconciler ships *because* React is bundled. Today's `dist/daemon/index.js` and `dist/cli/mcp/illumination-server.js` do not import React (the daemon is a long-running scheduler; the MCP server is a JSON-RPC handler). If either grows a React dependency in the future, that future cycle's PR owns extending the scan. Default this design: scan only `dist/cli/index.js`. The scan is one `readFileSync` + one `String.includes`; extending later is cheap.

### 9.2 ADR-0017 numbering

The implementing session should verify the next free ADR number against `docs/adr/` at land-time. If 0017 is taken by an in-flight PR, bump to 0018. The number is not load-bearing for any code reference.

### 9.3 Body-line `<Static>` interaction

`2026-04-14-pipeline-tui-flicker-fix.md` (v0.1.18) moved body lines into `<Static>` to fix flicker. The interval gating here interacts cleanly: `<Static>` already prevents body-line re-renders; this change prevents *footer* re-renders for non-streaming blocks. The two changes compose — there is no interaction risk. Open only because the implementing session should sanity-check this on a real Ink render before declaring victory.

### 9.4 React 19 reconciler-vs-fiber strings

React 19 still ships dev marks via `react-reconciler.development.js` in its `node_modules` layout (verified at design time against `package.json` `react: ^19.2.4`). If a React 19.x patch reorganises the dev-bundle paths, the regression scan's marker list needs an update. The scan failing closed (non-zero exit) on missing markers is **not** a concern because the scan asserts *absence*, not *presence*; a future React version that removes the markers entirely makes the scan a benign no-op, not a false-positive. The fallback guard is bundle-size monitoring, which the implementing session may add as a follow-up in a separate cycle.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `"process.env.NODE_ENV"` in `tsup.config.ts` — present in `define:`.
- Grep `setInterval` in `src/cli/components/LiveFooter.tsx` — present, inside `if (block.kind !== "streaming") return;` guard.
- Grep `setInterval` in `src/cli/components/` recursively — exactly one match (the gated one in `LiveFooter.tsx`). This is the verifier's "sole `setInterval` under `src/cli/components/`" claim, restated as a regression invariant.
- Grep `react-dom.development` in `dist/cli/index.js` (after `npm run build`) — zero matches.
- Grep `react-reconciler.development` in `dist/cli/index.js` (after `npm run build`) — zero matches.

### 10.2 Tests

- `npx vitest run src/cli/tests/LiveFooter.test.tsx` — passes (existing 4 + new 2 cases).
- Full `npx vitest run` — passes.

### 10.3 Smoke

- Build: `npm run build` — exits 0. The `onSuccess` log shows `Assets copied to dist/` followed by no scan-failure output.
- Bundle size: compare `wc -c dist/cli/index.js` before/after the change — expect measurable shrink.
- Manual: `npm link`, then `apparat pipeline run <some-interactive-pipeline> <project>`. When the pipeline parks at an interactive-agent / wait-human block, leave it for 5 minutes. Expect:
  - No `MaxPerformanceEntryBufferExceededWarning` on stderr (ever, but particularly here).
  - The elapsed counter line freezes at its last value during the park, then resumes when the next event arrives (e.g. you type a keystroke and the block transitions). This is the new, correct behaviour.

### 10.4 Negative cases

- Intentionally remove the `"process.env.NODE_ENV"` line from `tsup.config.ts`'s `define:` and re-run `npm run build`. Expect: `onSuccess` scan finds `react-dom.development` in the bundle and exits non-zero with the explanatory message.
- Intentionally drop the `block.kind === "streaming"` guard in `LiveFooter.tsx` and re-run `npx vitest run src/cli/tests/LiveFooter.test.tsx`. Expect: the new "schedules no interval for non-streaming kinds" case fails with `expected 1 to be 0` (or vice-versa).
- A `LiveBlock` whose `kind` is something other than the four enumerated kinds (defensive — shouldn't happen given the type system, but `block.kind === "streaming"` is robust: any unrecognised kind falls through to the early return). The verifier called this out as an implicit guard against silent default behaviour.
- A `streaming` block whose stats never change (no tokens, no turns) — the gated interval still fires every 500 ms but the rendered `statusLine` string is byte-identical from one tick to the next; Ink's reconciliation absorbs the no-op cheaply. This is acceptable; the alternative (memoising the status line to skip the React commit on equal output) is YAGNI given a streaming block with no stats is itself anomalous.

## 11. Summary

A long-idle `apparat` interactive chat emits `MaxPerformanceEntryBufferExceededWarning` on stderr because two compounding defects ship in the same build: (1) `src/cli/components/LiveFooter.tsx:38-42` runs an unconditional 100 ms `setInterval` for the entire lifetime of every `LiveBlock`, including while parked at `interactive-agent` or `wait-human`; (2) `tsup.config.ts:14` never pins `process.env.NODE_ENV` in `define:`, so the published `dist/cli/index.js` ships the React **dev** build whose reconciler emits `performance.measure(...)` per commit. ADR-0014 (accepted 2026-05-12) just made `LiveFooter` load-bearing across every interactive pipeline, so the warning is now felt during every refinement loop and reads to operators like apparatus is broken.

This design ships three pieces: (1) **pin `process.env.NODE_ENV` to `"production"`** in `tsup.config.ts`'s `define:` block — one-line addition; dead-codes the React dev reconciler out of the bundle; (2) **gate the `LiveFooter` interval** at `src/cli/components/LiveFooter.tsx:38-42` on `block.kind === "streaming"` at 500 ms cadence, with `[block.kind]` as the effect dep array so kind transitions schedule/tear-down the interval correctly — no interval is ever scheduled for `interactive-agent` or `wait-human`; (3) **a build-time regression scan** in `tsup.config.ts`'s `onSuccess` that greps `dist/cli/index.js` for `react-dom.development` / `react-reconciler.development` and exits non-zero if either appears. Plus one README troubleshooting paragraph at `:228-235` and a new ADR-0017 recording the NODE_ENV pin + scan decision.

Blast radius is **S** — 5 files: `tsup.config.ts`, `src/cli/components/LiveFooter.tsx`, `src/cli/tests/LiveFooter.test.tsx`, `docs/adr/0017-tsup-node-env-bundle-pin.md` (new), `README.md`. No breaking change for any consumer — `LiveFooter`'s props are byte-identical, its single in-repo consumer (`src/cli/components/PipelineRunView.tsx:6`) sees no behavioural change for any kind it cares about, and `__APPARAT_PROD__` is preserved alongside the new `process.env.NODE_ENV` pin. No `.dot` schema change, no CLI flag, no env var, no tracer field, no agent-rubric change, no daemon edit, no MCP edit. Tests gain two `vi.getTimerCount()`-based interval-gating cases; existing 4 cases pass unchanged. Out of scope and explicitly deferred (per illumination Steps 5 & 6): broader `setInterval` audit of `HeartbeatWatch`, `PipelineRunView`, `PipelineTraceView`; `performance.maxEntries` / `performance.clearMarks()` budgeting. Single PR is the default; splitting into three would manufacture review cycles for a tightly-coupled 5-file diff with no rollback dependency between pieces.
