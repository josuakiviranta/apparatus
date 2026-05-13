---
date: 2026-05-13
description: After the relocation to `.apparat/scenarios/`, only 3 of 17 entries have any test wiring, and CONTEXT.md still documents a `pipeline-smoke-<name>-folder.test.ts` discovery convention that does not exist anywhere in `src/cli/tests/` — the new home is as orphan-prone as the old `pipelines/smoke/` location an adjacent illumination already flagged.
---

## Core Idea

The 2026-05-07 `relocate-operator-scenarios` design moved smoke-pipeline fixtures from `pipelines/smoke/` to `.apparat/scenarios/`, but the relocation only fixed location, not wiring. Today 17 entries live under `.apparat/scenarios/` (14 folders + 3 markdown operator scenarios), yet only 3 are referenced from `src/cli/tests/` — `scheduler-shape-collision`, `pipeline-failure-footer`, `interaction-driver-escape`. The remaining 14 are dead fixtures. Worse, `CONTEXT.md` actively documents a discovery convention (`pipeline-smoke-<name>-folder.test.ts` in `src/cli/tests/`) that does not exist anywhere — the three live tests use the `-scenario.test.ts` suffix and number three. The directory the glossary calls "the engine's own test surface" is mostly unread, and the naming convention is fictional.

## Why It Matters

`CONTEXT.md` defines a **Smoke-pipeline scenario** as:

> A pipeline-engine test fixture: a `pipeline.dot` plus its agent `.md` files… Lives at `<repo>/.apparat/scenarios/<name>/`. Consumed by the `pipeline-smoke-<name>-folder.test.ts` files in `src/cli/tests/` to verify parser, validator, runtime, and per-folder discovery — the engine's own test surface, not user-facing operator scenarios.

Grep `src/cli/tests/` for `pipeline-smoke-*-folder*` returns zero matches. The three actual wires — `interaction-driver-escape-scenario.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `scheduler-shape-collision-scenario.test.ts` — use a different naming convention and don't iterate the folder. Everything else (`agent-implement/`, `agent-json-vars/`, `chat-end-to-end/`, `chat-only/`, `conditional/`, `gate/`, `json-schema-stream/`, `meditate-observer/`, `meditate-steer/`, `missing-caller-var/`, `static-multi-node/`, `store/`, `tool/`, `tool-runtime-vars/`, plus the three markdown operator scenarios at the root) is fixture-without-runner. Three of these — `meditate-observer/`, `meditate-steer/`, `tool-runtime-vars/` — were added recently (post-rename), so the pattern is *still actively accreting* orphans.

This is exactly the failure mode the adjacent illumination `2026-05-13T0900-pipelines-smoke-orphan-contradicts-context-md.md` flagged for the *old* `pipelines/smoke/` location: a directory billed as a test surface that no test runner reads. The relocation design moved the problem one folder over without fixing the underlying gap — there is no engine-side mechanism that says "every `<name>/pipeline.dot` under `.apparat/scenarios/` MUST be parsed/validated/run by some test." Authors are trusted to remember to hand-wire a `*-scenario.test.ts` per fixture, and most of the time they don't (or do once and then drop the test).

Against the strategic compass: VISION.md says pipelines are "the **web** … each agent doing one job." The web is supposed to be testable end-to-end, and `.apparat/scenarios/` is named as the place where that testability lives. Three working scenarios out of seventeen is not a web — it is three load-bearing threads and fourteen tangled strands attracting more tangle every week. The compounding cost: every new pipeline feature (output-schema rule, gate input-ref rule, ADR-0015 GC rule, etc.) silently passes against the live three and is never exercised against the other fourteen, even though those fourteen exist precisely to be exercised.

The naming-convention drift compounds: CONTEXT.md is consulted by janitor, meditate, and the apparatus skill as authoritative; future-Claude readers will look for `pipeline-smoke-*-folder.test.ts` files, find zero, and either spend time hunting or assume the engine surface was removed entirely. The glossary lies — fix the glossary or fix the code (preferably both).

This is *not* the same point as `2026-05-13T0900` (which is about the obsolete repo-root `pipelines/smoke/` directory still attracting writes per README) nor the same as `2026-05-12T2243` (which is tmux-tester crashing on doc-only DOTs). Those are tactical. This is the structural follow-on: even after relocation, the test-discovery contract for the new home is unwritten and the docs lie about it.

## Revised Implementation Steps

1. **Pick one discovery rule and codify it in code, not docs.** Replace the per-scenario hand-written `*-scenario.test.ts` with a single `scenarios.test.ts` (or `pipeline-scenarios.test.ts`) that globs `.apparat/scenarios/*/pipeline.dot` and asserts `parseGraph` + `validateGraph` succeed for every match — the baseline contract every smoke-pipeline fixture by definition meets. Net effect: adding a `pipeline.dot` under `.apparat/scenarios/<x>/` automatically enrolls it; deleting a folder de-enrolls it. No manual `-folder.test.ts` per fixture, no naming convention to remember.

2. **Promote scenario-specific behavior to the same file as a `describe.each` allow-list.** Scenarios that need beyond parse/validate (the current three, plus any others that grow runtime expectations) get a per-scenario `describe` block in the same file with custom assertions. Keeps engine surface in one place; deletes three trivially-named files; ends the `*-scenario.test.ts` vs `*-folder.test.ts` confusion.

3. **Rewrite the CONTEXT.md `Smoke-pipeline scenario` entry to match reality.** Replace the line "Consumed by the `pipeline-smoke-<name>-folder.test.ts` files" with the actual discovery rule (one glob runner over the directory). State explicitly: "every `pipeline.dot` under `.apparat/scenarios/` is auto-discovered; specific runtime expectations attach via per-scenario `describe.each` blocks in `<filename>`." If step 1 isn't taken, at minimum delete the fictional convention so the docs don't lie.

4. **Audit the 14 orphans for purpose vs. rot.** For each (`agent-implement`, `agent-json-vars`, `chat-end-to-end`, `chat-only`, `conditional`, `gate`, `json-schema-stream`, `meditate-observer`, `meditate-steer`, `missing-caller-var`, `static-multi-node`, `store`, `tool`, `tool-runtime-vars` and the three markdown root-scenarios) classify: (a) still represents a real engine feature → keep, auto-enrolled by step 1; (b) was a write-once playground from feature work that landed via unit tests → delete in one commit; (c) doc-only / `tmux_confirm_gate`-style → opt into the auto-skip the `2026-05-12T2243` illumination proposes. The three known-live scenarios stay untouched.

5. **Add one negative test: scenarios without a `pipeline.dot` fail loudly.** A bare `<name>/` folder under `.apparat/scenarios/` with no `pipeline.dot` should be a CI error, not a silent skip. Forces authors to either ship the fixture or remove the placeholder — closes the "I'll wire the test later" drift path that produced the 14 orphans in the first place.

6. **Cross-link in the next ADR.** This work superseding the `pipeline-smoke-<name>-folder.test.ts` clause in CONTEXT.md is small enough to fit on the same ADR as the `pipelines/smoke/`-removal step from `2026-05-13T0900`; folding both into one ADR keeps the smoke-directory story coherent. The new ADR title: "Auto-discovery of pipeline scenarios under `.apparat/scenarios/`."

## Provenance

- Source files surveyed: project tree under `.apparat/scenarios/` (17 entries), `src/cli/tests/*-scenario.test.ts` (3 files), `src/cli/tests/pipeline-illum-to-impl-*-folder.test.ts` (4 files, but these target `.apparat/pipelines/illumination-to-implementation/`, not scenarios), `CONTEXT.md` Smoke-pipeline scenario entry, `docs/superpowers/specs/2026-05-07-relocate-operator-scenarios-design.md`.
- Adjacent illuminations not duplicated: `2026-05-13T0900-pipelines-smoke-orphan-contradicts-context-md.md` (repo-root old location), `2026-05-12T2243-tmux-tester-doc-only-scenario-discovery-fragility.md` (tmux-tester opt-in marker).
- Notes file at meditation start: all open notes already marked `[x]`; steer `focus on .apparat/notes.md if not already marked` thus satisfied; this illumination was discovered by direct project exploration.
- Surfaced by: meditate (run_id: meditate-aa44cc1f)
