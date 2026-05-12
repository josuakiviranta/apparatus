---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-fe4624db
plan: /Users/josu/Documents/projects/apparatus/docs/superpowers/plans/2026-05-12-interaction-kinds-need-deep-drivers.md
design: /Users/josu/Documents/projects/apparatus/docs/superpowers/specs/2026-05-12-interaction-kinds-need-deep-drivers-design.md
illumination: .apparat/meditations/illuminations/2026-05-11T1610-interaction-kinds-need-deep-drivers.md
test_result: pass
---

# interaction-kinds-need-deep-drivers

## What was implemented
Collapsed the three TUI interaction kinds (interactive-agent, gate, wait-human) — previously scattered across `LiveBlock` optionals, sibling reducer cases, `LiveFooter` branches, and `GateSelector` keymap — behind a single `InteractionDriver<K>` interface with per-kind driver modules. Gate cancel via `key.escape` now works (routed through `__abort__`), and a scenario freezes the cross-driver escape contract.

## Key files
- `docs/adr/0014-interaction-drivers.md` (new — ratifies the seam)
- `src/cli/lib/interactions/driver.ts` (new — `InteractionDriver<K>` interface)
- `src/cli/lib/interactions/drivers/agent.tsx` (new — interactive-agent driver)
- `src/cli/lib/interactions/drivers/gate.tsx` (new — gate driver + `ABORT_CHOICE` sentinel)
- `src/cli/lib/interactions/drivers/index.ts` (new — registry, `satisfies` exhaustiveness)
- `src/cli/lib/pipelineEvents.ts` (M — `LiveBlock` shrunk; `child?`/`onDone?`/`gate?` dropped)
- `src/cli/lib/pipelineReducer.ts` (M — sibling `interactive-ready` + `gate-ready` cases folded into one `driver-event` case)
- `src/cli/components/LiveFooter.tsx` (M — `drivers[block.kind].renderFooter(block)`)
- `src/cli/components/GateSelector.tsx` (M — `key.escape` → `ABORT_CHOICE`)
- `src/cli/components/PipelineRunView.tsx` (M — emit lambda routed through drivers)
- `src/cli/commands/pipeline/run.ts` (M — emitter updated)
- `src/attractor/interviewer/ink.ts` (M — emitter updated)
- `.apparat/scenarios/interaction-driver-escape/pipeline.dot` (new — freezes Esc → `__abort__` contract)
- Tests: `interactions-agent-driver.test.ts`, `interactions-gate-driver.test.tsx`, `interactions-registry.test.ts`, `interaction-driver-escape-scenario.test.ts`, plus rewrites of `pipelineReducer.test.ts`, `LiveFooter.test.tsx`, `GateSelector.test.tsx`, `pipeline-run-view.test.tsx`, `pipeline-app-integration.test.tsx`, `ink-interviewer.test.ts`.

## Decisions and patterns
- Esc-on-gate outcome resolved as **abort** (sentinel `ABORT_CHOICE` → `__abort__` route), not first-option. Smoke scenario pins this live: Escape emits `(gate aborted)` and routes to `__abort__`; Approve routes via `after` node.
- Drivers registry uses TypeScript `satisfies` so a missing kind is a **compile error** at the registry — the original "compiler doesn't catch a missing LiveFooter branch" gap is closed at the seam.
- Drivers landed as `.tsx` (not `.ts` per plan) because they render JSX footer fragments. Functional intent unchanged; one verbatim path mismatch noted by tmux_tester.
- `wait-human` driver depth deferred — only the two active kinds (agent, gate) ship a driver this round; the third interaction kind remains as the existing wait.human path. Registry shape leaves room for it without breaking exhaustiveness.

## Gotchas and constraints
- `LiveBlock` is an **internal** type export — consumed by `LiveFooter.tsx:3` and tests, not part of any published wire format. JSONL replay (`parseClaudeEvent.ts`) never emitted `interactive-ready` / `gate-ready`, so the reducer-case fold is replay-safe.
- The new `ABORT_CHOICE` sentinel is gate-driver-internal; downstream nodes should keep treating `__abort__` as the route name, not the sentinel value.
- Driver `renderFooter(block)` must remain pure — no `useInput` inside footer renderers (keyboard handling stays in the parent component bound to the active driver's `keymap`).

## Learnings from the run
- `plan_writer-8a6d` failed on first attempt and the engine retried it as `plan_writer-015e` — one retry, then success. Trace shows the prior attempt left no plan artifact; the second produced the executed plan. Worth watching whether `plan_writer` retries cluster on illuminations with many citation paths (this one's verifier output named ~21 files).
- One `merge_resolver-e273` cycle between two `batch_orchestrator` runs (`-96fd` then `-d61b`) — conflicts on c2 ("Flip the seam") and c3 ("Cross-driver escape contract scenario") because both touched `pipelineEvents.ts`, `pipelineReducer.ts`, `LiveFooter.test.tsx`, `pipeline-run-view.test.tsx`. Resolved in two `resolve conflict:` commits (a873af7, 8300b3f). Pattern is predictable: any chunk that edits the shared `LiveBlock` shape will collide with chunks that add drivers consuming it.
- tmux_tester completed in **cycle 1, zero fixes**. 11 scenarios ran (all PASS), 5 Claude-session scenarios SKIP'd per hard rules, 1516 unit tests passed. The escape contract was verified live in `interaction-driver-escape`.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, npm test 1516 passed / 3 skipped, 11 scenarios INCLUDED ran (all PASS) and 5 Claude-session scenarios SKIP'd per hard rules. Esc-aborts-gate contract verified live in interaction-driver-escape: Escape emitted (gate aborted) and routed via __abort__; Approve routed to after node. No fixes needed.
