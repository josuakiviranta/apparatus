---
date: 2026-05-13
description: A long-idle interactive chat emits `MaxPerformanceEntryBufferExceededWarning: 1000001 measure entries` because `src/cli/components/LiveFooter.tsx:38-42` ticks a React state setter every 100 ms unconditionally AND `tsup.config.ts` never pins `process.env.NODE_ENV="production"` — so the shipped binary runs the React **dev** build whose reconciler emits `performance.measure(...)` per commit. Two evening-sized fixes; either alone kills the warning, both together also reclaim idle CPU.
---

## Core Idea

A user observed the following on stderr after leaving an interactive chat (e.g. `parallel-illumination-to-implementation` verifier/refinement loop) open without typing:

```
(node:54717) MaxPerformanceEntryBufferExceededWarning: Possible perf_hooks memory leak detected. 1000001 measure entries added
```

Two compounding defects produce it.

1. **`src/cli/components/LiveFooter.tsx:38-42`** runs an unconditional 100 ms tick for the entire lifetime of any `LiveBlock`:

   ```ts
   const [, tick] = React.useState(0);
   React.useEffect(() => {
     const id = setInterval(() => tick(n => n + 1), 100);
     return () => clearInterval(id);
   }, []);
   ```

   The tick exists to keep the `· 12.4s` elapsed counter in `statusLine()` and `formatElapsed()` (lines 7-9, 22) moving. It runs at 10 Hz forever — including while `block.kind === "interactive-agent"` is parked waiting for a human keystroke. Each tick fires a `setState` → React commit → Ink reconcile, regardless of whether the visible output actually changed.

2. **`tsup.config.ts`** does not pin `process.env.NODE_ENV`. Its `define:` block sets only `__APPARAT_PROD__: "true"`. With `NODE_ENV` unset at bundle time, esbuild does not dead-code the `process.env.NODE_ENV !== "production"` branches inside `react-dom` / `react-reconciler` / Ink's renderer, so the published `dist/cli/index.js` ships the **dev** build of React. The dev reconciler instruments every commit with `performance.measure(...)` calls (component render timings used by React DevTools — never read by anyone in a CLI process). User Timing entries accumulate in the perf buffer; the default ceiling is 1e6 → Node logs the warning once and starts dropping entries.

Composed: 10 commits/s × ~N measure calls/commit × ~hours-idle ≈ 1e6 entries. Matches the observed "long time, no typing" trigger.

## Why It Matters

`when-code-is-slop.md` names exactly this shape: a small thing that compiles, ships, and looks correct under unit tests, but degrades silently in long-running real use. Neither defect is caught by `npm test` (tests run for seconds, not hours) nor by `pipeline validate` (the validator operates on `.dot` source, not on the bundled binary's React mode).

The vision file says *"running a pipeline feels like delegating to someone who already understands the shape of the problem."* A perf-leak warning landing on the operator's terminal mid-session is the opposite — it reads like the apparatus is broken, even though the human-visible behavior is unchanged. The operator now has to triage whether it indicates a bug in their pipeline or in apparatus itself. That triage tax is the cost; the leak itself is harmless until ~28 wall-clock hours of idle.

The fix carries adjacent wins:

- **Bundle size.** Prod React is materially smaller than dev React; every published install of `apparat-cli` would shrink.
- **Idle CPU.** A 10 Hz Ink re-render of an idle interactive chat is wasted work on a laptop battery. Even a static `<TextInput>` has to walk its reconciliation tree 600× per minute today.
- **Startup parity.** Bundled-binary behavior diverges from `npm run dev` (which sets `NODE_ENV=development` via `tsx`'s defaults) in ways that are silent today and will be silent next time too. Pinning prod at build time closes that gap.

This pairs naturally with the long-running thread on interactive-pipeline hygiene captured in `2026-04-13-interactive-pipeline-context-bug.md` and `2026-04-14-pipeline-tui-debugging.md`: every interactive surface in apparatus today is a candidate for "what does it do when nobody is touching it for an hour?" — and the answer should be "nothing measurable."

`deep-modules-hide-complexity.md` is relevant in the inverse direction: `LiveFooter` looks like a 56-line leaf component, but it owns the heartbeat of the interactive TUI. A bug here is felt across every interactive pipeline (`parallel-illumination-to-implementation`, `meditate`, any future `wait-human` gate). Worth treating its lifecycle hooks as load-bearing.

## Revised Implementation Steps

1. **Pin `process.env.NODE_ENV` at bundle time.** In `tsup.config.ts`, extend `define:` with `"process.env.NODE_ENV": JSON.stringify("production")`. Rebuild and confirm `grep -c "process.env.NODE_ENV !== 'production'" dist/cli/index.js` drops to zero (or compare bundle size before/after — expect a meaningful shrink). One-line change; fixes the warning on its own. Land first as the conservative move.

2. **Gate or throttle the `LiveFooter` tick.** Options, cheapest first:
   - **a.** Only schedule the interval while `block.kind === "streaming"` (the one kind where `block.stats.tokensIn/tokensOut` and `turns` are mutating). For `interactive-agent` and `wait-human`, the only animated datum is elapsed time — a 1 Hz tick is more than enough and the tick can stop entirely while the block is idle.
   - **b.** Lower the rate to 1 Hz across the board (`setInterval(..., 1000)`). `formatElapsed` rounds to one decimal — even 250 ms would suffice, but seconds-resolution is the truthful precision of the displayed string.
   - **c.** Drop the tick and let Ink re-render on real events only; recompute elapsed inside `statusLine()` each render. Accept that the elapsed counter looks frozen until the next event arrives.
   Recommend (a) + a 500 ms tick for streaming; this preserves the live-feel during real activity and kills the idle work entirely.

3. **Add a regression check.** Either: (i) a build-time assertion that scans `dist/cli/index.js` for `"react-dom.development"` / `react-reconciler.development` strings and fails the build if found; or (ii) a tiny test that imports React from the built dist and asserts `React.version` works in a prod context. Option (i) is the lower-effort guard.

4. **Document the warning's history.** Add one paragraph to `README.md`'s `## Development` section (or a new `## Troubleshooting` mini-section) noting that the previously-seen `MaxPerformanceEntryBufferExceededWarning` was bundle-config drift, not a real leak — so future operators see this surfaced in case the warning reappears for a different reason.

5. **(Deferred, do not build yet.)** A broader audit of every `useEffect(() => setInterval(...))` in `src/cli/components/`. `HeartbeatWatch.tsx`, `PipelineRunView.tsx`, `PipelineTraceView.tsx` are the candidates. None have been reported as leaking, and `pipeline trace --follow` is a short-lived command, so this stays YAGNI until a second report lands. Note the option here and walk away.

6. **(Deferred, do not build yet.)** Surface `performance.maxEntries`-style tuning or call `performance.clearMarks()` periodically. The warning is symptomatic; the right fix is to stop creating the entries, not to budget for them. If for any reason step 1 cannot land (e.g. React 19 needs dev marks for some feature in `pipeline-app-integration`), this becomes the fallback. Today it is unnecessary complexity.

## Provenance

- User report verbatim: `"(node:54717) MaxPerformanceEntryBufferExceededWarning: Possible perf_hooks memory leak detected. 1000001 measure entries added"` — observed after leaving the interactive chat open without input for a long period.
- Source files: `src/cli/components/LiveFooter.tsx:38-42` (unconditional 100 ms tick), `tsup.config.ts` (no `process.env.NODE_ENV` in `define:`), `package.json` (`react: ^19.2.4`, dev/prod split is React-version-relevant).
- Adjacent illuminations: `2026-04-14-pipeline-tui-debugging.md` and `2026-04-14-pipeline-tui-debug-session2.md` (prior TUI fragility threads); `2026-04-14-pipeline-tui-flicker-fix.md` (related re-render hygiene work that already moved body lines to `<Static>`).
- Surfaced by: user observation during an interactive `parallel-illumination-to-implementation` chat refinement loop; not by a meditate run.
