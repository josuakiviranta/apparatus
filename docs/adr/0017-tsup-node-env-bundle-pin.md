# ADR 0017 — Pin `NODE_ENV=production` in the `tsup` bundle + dev-React regression scan

**Status:** Accepted
**Date:** 2026-05-13
**Related:** ADR-0014 (interaction drivers — accepted 2026-05-12; made `LiveFooter` load-bearing across every interactive pipeline)

## Context

The published `apparat-cli` bundle shipped the React **dev** build because `tsup.config.ts`'s `define:` block never pinned `process.env.NODE_ENV`. With it unset at bundle time, esbuild did not dead-code the `process.env.NODE_ENV !== "production"` branches inside `react-dom` / `react-reconciler` / Ink's renderer, so the published `dist/cli/index.js` carried the dev reconciler. React 19's dev reconciler instruments every commit with `performance.measure(...)` calls — User Timing entries intended for React DevTools, never read in a CLI process. Combined with `LiveFooter`'s unconditional 100 ms `setInterval` (see the companion gate change at `src/cli/components/LiveFooter.tsx:38-42`), the entries accumulated in the perf-hooks buffer over hours of idle interactive chat use, eventually emitting `MaxPerformanceEntryBufferExceededWarning` on stderr.

The warning was observed in real operator use during a `parallel-illumination-to-implementation` chat that was left parked at an `interactive-agent` block overnight. It reads to an operator like apparatus is broken; the triage tax is the cost.

## Decision

`tsup.config.ts` pins `"process.env.NODE_ENV": JSON.stringify("production")` inside `define:` alongside the existing `__APPARAT_PROD__: "true"` (the apparatus-internal dev/prod detection seam). The published bundle no longer carries the React dev reconciler.

`tsup.config.ts`'s `onSuccess` hook runs a static-string regression scan over `dist/cli/index.js` for `react-dom.development` and `react-reconciler.development`. If either marker is present, `process.exit(1)` is called with an explanatory message naming the missing `define:` entry. The scan operates on bytes already on disk and is O(bundle-size).

`src/cli/tests/buildBundle.devReactMarkers.test.ts` carries the same assertion at vitest level, skipping cleanly when no `dist/cli/index.js` exists (running `vitest` before `tsup` is common in dev). It is a redundant guard against drift sneaking past the build hook (e.g. a future bundler/dep change that emits the dev strings only under a path the `onSuccess` hook does not re-check).

## Considered alternatives

- **`performance.maxEntries` tuning or periodic `performance.clearMarks()`.** Rejected — symptomatic; the right fix is to stop creating the entries.
- **Test-time assertion that imports React from `dist/` and checks for a prod marker.** Rejected — heavier (spins Node in the build pipeline, requires a dedicated entrypoint); the static-string scan is sufficient and runs at build time.
- **Skipping the regression scan entirely.** Rejected — without it, a future `define:` edit / esbuild upgrade / dep change that re-imports `react-dom/cjs/react-dom.development.js` would silently re-introduce the leak. The scan is one `readFileSync` + one `String.includes`; the cost is negligible.

## Consequences

- The published bundle shrinks (prod React is materially smaller than dev React).
- Dev/prod parity is preserved: `npm run dev` (`tsx`) and `npm run build` (`tsup`) now agree on React's mode.
- Any future bundler/dep change that re-introduces dev React fails the build immediately rather than silently. The error message names the missing `define:` entry, so the fix is one line.
- If a React 19.x patch reorganises the dev-bundle paths and drops these marker strings, the scan becomes a benign no-op (it asserts *absence*, not *presence*). At that point the marker list needs a refresh, surfaced by the operator who observes a regression that the scan failed to catch.
- The scan today targets only `dist/cli/index.js`. The daemon (`dist/daemon/index.js`) and MCP server (`dist/cli/mcp/illumination-server.js`) do not import React; if either grows a React dependency in the future, that cycle's PR owns extending the scan.
