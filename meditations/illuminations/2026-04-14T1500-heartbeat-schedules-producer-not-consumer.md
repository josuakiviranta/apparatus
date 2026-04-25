---
date: 2026-04-13
status: archived
description: The heartbeat daemon schedules `ralph meditate` (producer) but never schedules `ralph pipeline run illumination-to-plan.dot` (consumer) — so the observe-illuminate-plan cycle is a one-way pump, not a loop, and 14 illuminations have accumulated with zero dispatched.
archived_at: 2026-04-25
reason: 14 illuminations now dispatched, consumer pipeline has run many times since claim was written
---

## Core Idea

The heartbeat daemon schedules `ralph meditate` on a recurring interval. It does not schedule `ralph pipeline run illumination-to-plan.dot`. Every heartbeat-triggered session adds one illumination to the corpus. No session removes one. The observe-illuminate-plan cycle was designed as a feedback loop, but only the observe half runs automatically — the system is a one-way pump. Fourteen illuminations exist, all `status: open`. None has been dispatched. The consumer has never run.

## Why It Matters

The backpressure guard (T0300, T1100) is a relief valve: it stops the producer when the queue is too full. It is not a cycle-closer. What closes the cycle is running `illumination-to-plan.dot` against the corpus — moving illuminations from `open` to `dispatched` by generating design docs and plans. That pipeline exists, is invocable via `ralph pipeline run`, and handles empty results gracefully (`preferred_label: empty` when no open illuminations exist). It has simply never been added to the heartbeat schedule.

The heartbeat supports "any command" scheduling (shipped in 0.0.33). The gap is a missing entry, not missing infrastructure.

This also reframes the guard's threshold. With no automated consumer, 14 illuminations accumulated in two days. The spec's default of 5 was calibrated for a system where manual triage is the only consumer and the guard is a hard limit. With a scheduled consumer, the steady-state count should hover near zero — one produced, one consumed per cycle. The threshold of 5 becomes noise: it fires before the consumer has a chance to run, and the message ("run the pipeline first") is advice the system could follow itself.

The "proof of work / proof of usage" lens is the sharpest frame here. Every illumination in this corpus is proof of work — specific, well-reasoned, with concrete steps. None is proof of usage — no design has been generated, no plan written, no code shipped from any of the 14. The meditate sessions demonstrate understanding. The absence of any pipeline invocation demonstrates that understanding has not been used. The system has been writing observations about its own inaction without taking action to break the inaction.

T0900 identified that IMPLEMENTATION_PLAN.md is dark and named the fix: "populate it with the backpressure guard." That is still true. But the structural cause of why it stays dark is that the illumination-to-plan pipeline is not scheduled — so the path from observation to plan never runs autonomously, and it requires a human to manually invoke `ralph pipeline run` to close each loop. No such invocation has happened in two days of active observation.

## Revised Implementation Steps

1. **Manually invoke `ralph pipeline run illumination-to-plan.dot .` once, right now, targeting T0300 or T1100 (the backpressure guard illuminations).** This is not infrastructure work — it is the first consumer invocation, and it is overdue. It unblocks every downstream step: one dispatched illumination proves the state machine works, gives `mark_implemented` a subject, and gives `IMPLEMENTATION_PLAN.md` content. Nothing else in the backlog matters until the consume-side has run once.

2. **After the first pipeline run, add a heartbeat job for the consumer.** In the project's heartbeat configuration, add a scheduled command: `ralph pipeline run illumination-to-plan.dot <project>`. Set it to run once after each meditate session completes, conditional on `countOpenIlluminations() > 0`. The pipeline's `approval_gate` node pauses for human review — the automated portion (verifier → design_writer → plan_writer) can run unattended and produce a design for human approval. The human's only required action is approving or rejecting the design, not initiating the run.

3. **Revise the backpressure guard threshold when the consumer is scheduled.** The default of 5 assumes no automated consumer. With a consumer in the heartbeat, set `RALPH_MEDITATE_MAX_OPEN` default to 10 and change the guard message to: `"N open illuminations — the pipeline may be stalled. Run \`ralph pipeline run illumination-to-plan.dot .\` or check heartbeat status."` The guard becomes a stall detector, not an overflow cap.

4. **Verify the loop has closed.** After step 1 and 2, confirm: `list_illuminations(status=dispatched)` returns at least one file; `IMPLEMENTATION_PLAN.md` contains the plan from the dispatched illumination; `git log` shows the auto-commit from `markDispatched`. If all three are true, the feedback loop has closed for the first time in this project's history.

5. **Do not write another illumination about the backpressure guard, the prompt's write-only behavior, or mark_implemented having no caller.** T0300, T1000, T1100, T1200, T1300, T1400 have already specified these. The next session's mandate is to run the pipeline and populate IMPLEMENTATION_PLAN.md — not to observe that neither has happened yet.
