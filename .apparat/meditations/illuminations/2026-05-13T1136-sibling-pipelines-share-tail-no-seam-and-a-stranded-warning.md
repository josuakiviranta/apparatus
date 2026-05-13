---
date: 2026-05-13
description: ADR-0001's file-copy rule was costed at N=1; today's N=2 has `illumination-to-implementation/` and `parallel-illumination-to-implementation/` carrying 14 byte-identical agent files with zero enforcing seam — and the 2026-05-12T1028 illumination prescribing a tail collapse is stranded in the ghost `.apparat/.apparat/` folder, so its forced-double-edit warning is invisible to `list_illuminations`.
---

## Core Idea

ADR-0001 (2026-04-30) ratified "cross-pipeline agent reuse is by file copy" when only one implementation pipeline existed. As of today there are **two** sibling pipelines — `.apparat/pipelines/illumination-to-implementation/` and `.apparat/pipelines/parallel-illumination-to-implementation/` — and a directory diff shows **14 files are present in both folders**, including `memory-writer.md` (171 lines, byte-identical), `memory-reflector.md`, `verifier.md`, `change-explainer.md`, `tmux-tester.md`, `design-writer.md`, `plan-writer.md`, `chat-refiner.md`, `chat-summarizer.md`, `approval_gate.md`, `remove_gate.md`, `tmux_confirm_gate.md`, `capture-pre-sha.sh`, `consume.mjs`. CONTEXT.md handwaves the cost with "once stable, the parallel-impl nodes collapse into illumination-to-implementation directly and this folder retires" — but apparat has no mechanism to enforce that promise, and 13 days in there is no collapse PR in sight.

The alarm is already ringing. The 2026-05-12T1028 illumination ("collapse-memory-tail-and-tier-pipeline-models") explicitly prescribes a tail change with the instruction "Mirror the change in `parallel-illumination-to-implementation/pipeline.dot` since it carries the same tail" — a forced double-edit, written down by a previous meditate run. Worse: that illumination lives in `.apparat/.apparat/meditations/illuminations/` (the ghost folder flagged by `2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans.md`). It is invisible to `list_illuminations`. Future meditate sessions, and the operator, will keep rediscovering the same pattern because the original write was buried at the wrong path.

## Why It Matters

Two failure modes compound:

1. **Sibling-pipeline drift is a shallow-module smell.** Per the `deep-modules-hide-complexity` stimulus: "A concept implemented twice with no single seam where they're forced to agree. Drift between parallel implementations is a shallow-module symptom." 14 byte-identical files with no enforcing seam is exactly that shape. The duplication is intentional per ADR-0001, but the ADR's only justification — "no global agent library, copy if you need it" — was reasoned at N=1 sibling pipelines. At N=2 the locality cost flips: every change to a shared agent now touches **two** folders, and there is nothing in the validator, no scenario test, no CI step that fails when the two copies diverge.

2. **The stranded illumination hides the alarm.** A future meditate run will read `list_illuminations()`, see the 11 visible files, miss the buried `2026-05-12T1028-…md`, and reach independently for the same insight. The operator who scans `.apparat/meditations/illuminations/` in the morning won't find the prescription either. Three actionable steps — tail collapse, sonnet tiering, stop-writing-to-sessions — are sitting at the wrong path, gated behind the ghost-folder bug. Until the file moves, those steps cannot get picked up by the implement pipeline that consumes illuminations.

The two compose: the *prescription* for paying down the copy tax is itself orphaned by an unrelated bug. So the copy tax keeps growing while the cure is invisible.

The architectural question ADR-0001 dodges is: what is the seam that forces two pipelines using the same tail to agree on what that tail does? Today there isn't one. The "tail" is not a module — it's a copy-pasted spreadsheet of `.md` files in two folders that humans must remember to update in lockstep. That is the legacy-codebase shape the stimulus warns about, six months before it has time to become legacy.

## Revised Implementation Steps

1. **Rescue the stranded illumination first.** Run `git mv .apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md .apparat/meditations/illuminations/` and commit. Then delete the entire `.apparat/.apparat/` ghost subtree (`git rm -rf .apparat/.apparat`). This unblocks the tail-collapse prescription so the implement pipeline can pick it up tomorrow. Without this step every other step here is moot — the next operator can't act on advice they can't see.

2. **Execute 2026-05-12T1028's tail collapse next.** Its prescription (`memory_writer -> memory_reflector` → one `finalize` node; default `model: sonnet`; stop writing to `.apparat/sessions/`) eliminates two of the 14 duplicated files outright (`memory-writer.md`, `memory-reflector.md`) and changes the cost shape of the rest. Land this before paying any more copy-tax on those files. Mirror the .dot edit in both pipelines in the same PR.

3. **Audit the remaining 12 duplicated files for actual usage.** For each of `verifier.md`, `change-explainer.md`, `tmux-tester.md`, `design-writer.md`, `plan-writer.md`, `chat-refiner.md`, `chat-summarizer.md`, `approval_gate.md`, `remove_gate.md`, `tmux_confirm_gate.md`, `capture-pre-sha.sh`, `consume.mjs`: grep both `pipeline.dot` files for the agent name. Any file referenced from only one .dot is dead in the other folder — delete the inert copy. Expectation: at least 2-3 of these files exist by inheritance, not by use. Smaller surface area is its own win.

4. **Add a drift-detector scenario for what genuinely must stay duplicated.** Once the audit lands, create `.apparat/scenarios/sibling-pipeline-tail-parity/` with a smoke test that asserts byte-identity (or content-hash equality) between the two pipelines' remaining shared agent files. When two copies must agree, a test must enforce the agreement — that is the missing seam. Today the agreement is operator memory; replace it with a check that fails loudly.

5. **Supersede ADR-0001 with an N>1 follow-up.** Write `docs/adr/0016-sibling-pipeline-shared-agents.md` recording the new reality: file copy was fine at N=1, breaks down at N=2, and the chosen mitigation (step 4's parity scenario, or — if the audit in step 3 leaves <3 files duplicated — accept the residual cost). Either way, the ADR makes the decision visible to future meditate runs and to the next operator who forks a third sibling pipeline. Reference the stranded 2026-05-12T1028 illumination as the original alarm.

6. **Make CONTEXT.md's "this folder retires" promise enforceable or retract it.** Pick one: (a) add an expiration marker to `parallel-illumination-to-implementation/pipeline.dot` — a frontmatter `experimental_until: 2026-06-15` that `apparat pipeline validate` fails on after the date; or (b) edit CONTEXT.md to drop the "retires" sentence and accept that the fork is durable. Promises without enforcement rot into folklore — the 13-day gap with no collapse PR is already evidence of that.
