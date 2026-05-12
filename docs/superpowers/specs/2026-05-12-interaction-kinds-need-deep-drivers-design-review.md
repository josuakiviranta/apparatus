# Spec Review: Interaction-kinds Deep Drivers Design

**Reviewer:** spec-document-reviewer
**Date:** 2026-05-12
**Verdict:** **Issues Found** (1 critical, 3 moderate, 2 minor)

## What I verified

- Code citations: `pipelineEvents.ts:22-32,48-63`, `pipelineReducer.ts:66-80,85-100`, `LiveFooter.tsx:7-13,20-33,43-60`, `GateSelector.tsx:13-21`, `PipelineRunView.tsx:61-65,107-161,170-218`, `run.ts:244`, `interviewer/ink.ts:7-17`, `classifyNode.ts:4-11`, `pipelineReducer.test.ts:109-145,258-291`, `pipeline-app-integration.test.tsx:36`. **All match reality verbatim** including the quoted code blocks.
- Test files exist: `LiveFooter.test.tsx`, `GateSelector.test.tsx`, `ink-interviewer.test.ts`, `pipeline-run-view.test.tsx`, `pipeline-app-integration.test.tsx`.
- Internal §2/§3/§4/§8 consistency: type names, file paths, line ranges align.
- Scope: design stays inside the illumination's data-shape/render-layer mandate; defers `PipelineRunView` emit-lambda refactor to the sibling illumination (per §7.6).
- Open questions in §9 each have defaults + reopen triggers — they are real deferrals, not avoided calls.

## Issues Found

### 1. CRITICAL — `templates/scenarios/` does not exist (§4, §6, §8, §11)

The design declares the smoke scenario at `templates/scenarios/interaction-driver-escape/pipeline.dot` and claims "Scenario placement matches the convention in `templates/scenarios/`." Verified with `find` and `ls`: **there is no `templates/` directory in the repo at all.** The actual scenarios live in `.apparat/scenarios/` (confirmed: `gate/`, `conditional/`, `chat-end-to-end/`, etc.). The scenario folder shape is `pipeline.dot` + `task.md` (+ optional per-branch `.md` files like `proceed.md`, `abort.md`).

**Fix:** Replace every occurrence of `templates/scenarios/interaction-driver-escape/` with `.apparat/scenarios/interaction-driver-escape/`. Add a `task.md` next to `pipeline.dot` (the gate scenario has one — copy its shape). Sections affected: §2 (point 8), §3.1 footer mention, §4 (new file row), §6 (heading + body), §8 (scenarios bullet), §11.1, §11.3.

### 2. CRITICAL — `apparat pipeline run --scenario` is invented (§6, §11.3)

§6 says "The harness reuses the existing `apparat pipeline run --scenario` runner; no new infra." §11.3 lists `apparat pipeline run --scenario interaction-driver-escape`. **Grep across `src/` finds zero `--scenario` flag on `pipeline run`.** The only `--scenarios` flag is on `apparat <project>` (the implement loop). Existing "scenario tests" (e.g. `pipeline-failure-footer-scenario.test.ts`) are **vitest tests that drive the renderer in-process**, not a CLI harness with simulated keystrokes.

**Fix:** Either (a) describe the smoke as a vitest scenario test in `src/cli/tests/interaction-driver-escape-scenario.test.tsx` driving `PipelineRunView` with `ink-testing-library` + a synthetic `key.escape` press (the same shape `pipeline-failure-footer-scenario.test.ts` uses), or (b) add a new chunk to §8 acknowledging "new harness affordance: a way to inject keystrokes into a `pipeline run` scenario folder" — but that is non-trivial new infra, not "reuses existing." Option (a) is the path of least resistance and still freezes the contract.

### 3. MODERATE — `Block.onDone` already exists; §3.3 `onFreeze` story is partially redundant (§3.3, §3.4)

`pipelineEvents.ts:34-46` already declares `Block.onDone?: () => void` and the reducer at `:97` already spreads `state.live.onDone` into the frozen block. The design's `onFreeze` hook is described as preserving this behavior, but the wording in §3.3 ("agent driver uses this to surface `onDone` onto the frozen Block") reads as if `Block.onDone` is being introduced. It's not — it's already there.

**Fix:** In §3.3 and §3.4 clarify: "Today the reducer reads `state.live.onDone` directly; with `LiveBlock` losing the field, the agent driver's `onFreeze` returns the `onDone` stashed in its side-map so the reducer can still populate `Block.onDone`." That preserves the existing `Block` shape and the existing `PipelineRunView` post-commit effect — no consumer of `Block.onDone` changes.

### 4. MODERATE — `block.input` mentioned in §1 doesn't exist on `LiveBlock` today (§1)

§1 says "interactive-agent renders `TextInput` if `block.input` is set." That field is **not on `LiveBlock`** — it lives on `LiveBlockWithInput` (the render-layer extension at `LiveFooter.tsx:7-13`). The §1 quote of `LiveFooter.tsx` is correct, but the surrounding prose blurs the boundary.

**Fix:** §1 prose: change "interactive-agent renders `TextInput` if `block.input` is set" to "interactive-agent renders `TextInput` from `LiveBlockWithInput.input`, an extension type at `LiveFooter.tsx:7-13`." The §3.6 rewrite already handles this correctly; only §1 framing drifts.

### 5. MODERATE — `DriverPayload` is type-untied to `K` (§3.2)

The interface signature is `InteractionDriver<K>` but `reduce(payload: DriverPayload, …)` takes the *full* union, not the K-narrowed variant. Each driver's reduce starts with `if (payload.kind !== "agent.ready") return state;` — that's a runtime narrow that the compiler can't help with. The "compiler-enforced" sales pitch in §2 (point 1) overpromises slightly: the registry exhaustiveness is enforced, but per-driver payload routing is not.

**Fix:** Either (a) parameterize `DriverPayload` by kind: `type DriverPayload<K> = K extends "interactive-agent" ? { kind: "agent.ready"; … } : K extends "wait-human" ? { kind: "gate.ready"; … } : never` and have `reduce(payload: DriverPayload<K>, …)` — that gives compile-time narrowing; or (b) downgrade the §2 wording to "registry exhaustiveness is enforced; per-driver payload narrowing is a runtime tag check." (a) is cleaner and matches the design's tone.

### 6. MINOR — illumination cites `PipelineApp.tsx`, design cites `PipelineRunView.tsx` (§1)

The originating illumination references `PipelineApp.tsx` (which was deleted in commit aeba3c3 per §1). The design correctly redirects to `PipelineRunView.tsx` and even calls this out. Fine — but flag it in the §10 ADR consequences too, so future grep-archaeologists don't get confused.

**Fix:** ADR-0014 body: add one line under Consequences — "Originating illumination referenced the now-deleted `PipelineApp.tsx`; the pattern moved verbatim into `PipelineRunView.tsx` (commit aeba3c3, PipelineApp split)."

## Summary

The design is strong on substance — every citation I checked matched the source byte-for-byte, the seam shape is well thought out, the trade-offs (§7) are honest, and §9's open questions are real defaults with reopen triggers (not avoidance). **Issues 1 and 2 are blocking** because the smoke-scenario story rests on infra that does not exist; they need either a path correction (`.apparat/scenarios/`) and a harness substitution (vitest scenario test, not `--scenario` flag), or an explicit "new infra" chunk in §8. Issues 3-5 are wording/typing tightenings that strengthen claims the design already wants to make. Once 1 and 2 are addressed, this is approvable.

Source label: `interaction-drivers-design-review-2026-05-12`
