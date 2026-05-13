---
date: 2026-05-13
run_id: parallel-illumination-to-implementation-f05d5a17
plan: docs/superpowers/plans/2026-05-13-react-dev-build-shipped-perf-marks-leak-via-livefooter-tick.md
design: docs/superpowers/specs/2026-05-13-react-dev-build-shipped-perf-marks-leak-via-livefooter-tick-design.md
illumination: .apparat/meditations/illuminations/2026-05-13T1057-react-dev-build-shipped-perf-marks-leak-via-livefooter-tick.md
test_result: pass
---

# react-dev-build-shipped-perf-marks-leak-via-livefooter-tick

## What was implemented

Killed the `MaxPerformanceEntryBufferExceededWarning` that surfaced after long-idle interactive chats. Two compounding defects fixed: (A) `tsup.config.ts` now pins `process.env.NODE_ENV=production`, so the published bundle no longer ships the React dev reconciler whose `performance.measure(...)` calls overflowed the entry buffer; (B) `LiveFooter` only schedules a `setInterval` while `block.kind === "streaming"`, at 500 ms (was unconditional 100 ms for every block lifetime).

## Key files

- M `tsup.config.ts` — pin `NODE_ENV=production` in `define:`; fail build if dist ships react dev markers
- M `src/cli/components/LiveFooter.tsx` — gate `setInterval` on `streaming` kind, 500 ms cadence
- M `src/cli/tests/LiveFooter.test.tsx` — non-streaming kinds spawn no interval; streaming kind spawns exactly one
- A `src/cli/tests/buildBundle.devReactMarkers.test.ts` — regression scan for `react-dom.development` strings in `dist/`
- A `docs/adr/0017-tsup-node-env-bundle-pin.md` — ADR explaining bundle-pin + regression guard
- M `README.md` — Development-section troubleshooting paragraph noting historical perf-warning was bundle-config drift

## Decisions and patterns

- **Two-layer fix, two parallel chunks.** `plan_scheduler` split the work into Layer A (build config + dev-marker regression scan + ADR) and Layer B (LiveFooter gating + README paragraph) with no shared files. `batch_orchestrator` ran them in parallel and merged each via its own `merge:` commit; no rebase, no conflicts.
- **TDD ordering preserved** inside each layer: `test: ... (red)` commit lands before the corresponding `fix:` / `feat:` commit (e.g. `749a61c` red → `2bbd168` green for the build pin; `825eb5b` red → `0b7aa1b` green for the LiveFooter gate).
- **Interval cadence chosen at 500 ms**, not 1 s, because LiveFooter's elapsed-time readout needs sub-second smoothness only while streaming — idle blocks schedule no interval at all.

## Gotchas and constraints

- The `__APPARAT_PROD__` constant in `tsup.config.ts` is separate from `process.env.NODE_ENV` — both must be set; React's dev-vs-prod branch keys exclusively off `process.env.NODE_ENV`.
- `LiveFooter`'s sole in-repo consumer is `src/cli/components/PipelineRunView.tsx:6` — any future caller relying on a continuous tick during non-streaming kinds will silently get a frozen footer. The gate is intentional; revisit only if a new block kind genuinely needs animation.
- The `react-dom.development` regression scan greps `dist/cli/index.js`; if future bundle-splitting changes the output path, the scan needs updating or it will silently no-op.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: npm run build + npm test green (180 test files, 1599 passed, 3 skipped, 1 file skipped); 2 live scenarios driven (interaction-driver-escape and pipeline-failure-footer) reached their terminal states with no crashes or TUI glitches. Plan-coverage diff matches all 6 candidate paths. No fixes were needed.
