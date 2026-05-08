---
date: 2026-05-08
description: tmux-tester Phase 2 collapses every scenario to "exit 0 = pass / exit ≠ 0 = fail", but `missing-caller-var` is a designed-failure scenario whose goal is "fail fast at startup when --var omitted" — today's PASS verdict came from ad-hoc human-side judgment, not from any encoded contract; without a goal-aware classifier the next agent reading the prompt naively will flip it to FAIL.
---

## Core Idea

`tmux-tester` Phase 2 (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md`) treats `apparat pipeline run` exit codes uniformly: `exit 0` → PASS, `exit ≠ 0` → FAIL. But at least one bundled scenario inverts this: `.apparat/scenarios/missing-caller-var/` exists *to* exit non-zero (its `goal=` line says "fails fast at startup when --var omitted"). In this run (5c59f36d), tmux-tester correctly recorded it as PASS, but only because the agent read the goal line and overrode the rule by hand. The contract is implicit and unverifiable — the next run with a less attentive judge will mark it FAIL, and the regression will look like a flake.

## Why It Matters

- **Silent inversion risk.** A scenario authored as a designed-failure has its success criterion encoded in prose (`goal=` line) but enforced nowhere. The pass/fail classifier in `tmux-tester.md` Phase 2 is the only gate; if it stops reading goals and applies the exit-code rule strictly, `missing-caller-var` flips to FAIL on every illumination run, blocking the pipeline on a working scenario.
- **The exception is not a one-off.** Once you accept "designed-failure is a valid scenario shape", others will follow — preflight rejection scenarios, validator diagnostic scenarios, --max bounding scenarios, intentional-timeout scenarios. Each one needs the same encoded inversion or each becomes a special case the prompt has to remember.
- **Memory file flagged it explicitly.** The session memory (`.apparat/sessions/2026-05-09-static-multi-node-agent-filename-mismatch.md:31`) names this as "candidate refinement: future work may need a goal-aware PASS/FAIL classifier or a scenario rename." It survived this run on hand-judgment; it will not survive every future run.
- **Adjacent illumination, distinct fix.** `2026-05-09T0051-tmux-tester-phase-2-mixes-mechanics-with-judgment.md` argues for extracting MECHANICS (discovery, validate, parse-vars) into a tool node. PASS/FAIL classification straddles both halves: the rule is mechanical, but the inversion is per-scenario contract. Both illuminations can land independently — extracting mechanics does not encode the inversion, and encoding the inversion does not extract mechanics.

## Revised Implementation Steps

1. **Pick the encoding shape.** Two viable options:
   - (a) Add an explicit field to the scenario's `pipeline.dot` graph attributes — e.g. `expect_exit = "nonzero"` or `expect_exit = "0"` (default `"0"`). Lives next to `goal=`. Cheap to read from the discovery side; easy for authors to spot.
   - (b) Add a `success_when` line inside the scenario's top-of-graph `goal=` block — e.g. `success_when = "exit_nonzero"`. Keeps the success criterion adjacent to the goal prose. Less greppable, but no graph-attribute schema change.
   - Prefer (a): `pipeline.dot` graph attributes are already typed and pass through the existing parser; no new prose-parsing surface. Surface the choice at `review_gate` of the implementing illumination.
2. **Wire it into discovery.** When `discover_scenarios` (existing or future tool node, see T0051) lists each scenario, read `expect_exit` from the parsed graph and emit it on each row alongside `folder`, `vars`. Default to `"0"`.
3. **Make the classifier read the field.** In `tmux-tester.md` Phase 2 step 4 (the per-scenario run loop), replace the prose rule "exit ≠ 0 → fail" with: "compare actual exit to `expect_exit`; PASS iff they match. Record the comparison in the per-row reason." This stays JUDGMENT-tier — the prose still owns the rendering of `### Scenarios run` — but the rule is no longer hand-rolled per scenario.
4. **Annotate `missing-caller-var/pipeline.dot`.** Add `expect_exit = "nonzero"` to the graph attributes. This is the only known designed-failure scenario today; do it as part of the same change so the new classifier has a non-default case from day one.
5. **Audit other scenarios** for hidden inversions before merging: grep `.apparat/scenarios/*/pipeline.dot` for any `goal=` line that promises failure ("fail", "reject", "exit non-zero", "must error"). Today only `missing-caller-var` qualifies; documenting the audit in the implementing PR keeps future authors honest.
6. **Update the design doc.** `docs/superpowers/specs/2026-05-08-static-multi-node-agent-filename-mismatch-design.md` "Plausible defaults" list mentions exit-code judgment in passing. Add a one-line note: "designed-failure scenarios opt in via `expect_exit = \"nonzero\"`; classifier compares against the declared value, not against zero." Same edit pass can fix the chat-terminator wording (`one-line affirmative continuation` → `/end` per `src/cli/lib/slash-commands.ts:19`) flagged in the same memory file.

## Provenance

- Source memory: `.apparat/sessions/2026-05-09-static-multi-node-agent-filename-mismatch.md`
- Pipeline run id: `5c59f36d`
- Surfaced by: memory-reflector
