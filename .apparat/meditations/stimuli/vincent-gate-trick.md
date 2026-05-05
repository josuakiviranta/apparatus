---
source: https://blog.fsck.com/2026/04/07/rules-and-gates/
date: 2026-04-30
description: Agent that converts fuzzy in-head rules ("verify before asserting", "look both ways") into disk-anchored gates with concrete artifact checks the agent cannot rationalize past.
---

# Vincent's Gate Trick

A **rule** is an instruction that lives in the agent's head: *"verify claims before asserting them"*, *"don't proceed without testing"*. Rules have an invisible opt-out. When the moment arrives, the agent feels confident, decides the work is solid enough, and skips the check. The rule fires only when the agent chooses to fire it.

A **gate** is the same intent, restated as a sequence with an artifact:

> *"When a claim is forming → web search happens → URLs in hand → then I speak."*

The gate gives the agent a concrete question it cannot lie its way past. **"Did I verify?"** is too easy to answer *yes*. **"Do I have URLs?"** has only one honest answer.

## The Practical Test

When you're about to skip a step, does the gate formulation give you a question whose answer is observable on disk?

| Cheatable question | Uncheatable question |
|---|---|
| "Did I verify this?" | "Does `verification-report.md` say `Status: PASS`?" |
| "Did I check the tests pass?" | "Did `npm test` exit 0 in this session?" |
| "Did I look at the spec?" | "Did I quote line N from `spec.md` in my reply?" |

The right-hand column is uncheatable because the answer lives outside the agent. The disk doesn't lie.

## Why It Works

Agents rationalize. Given a rule and a deadline, the agent finds a path through the rule that feels plausible. The gate removes the path — the next action is structurally blocked until the artifact appears. There is no clever phrasing that lets the agent move on without producing the proof.

This is also why the **diamond** in a workflow diagram is more than a visual element. The diamond's label has to be a question answerable from observable state — file existence, exit code, regex match, git tag. If the diamond's question is internal ("am I confident?"), the diamond is a rule wearing diamond's clothing.

## Designing Gates

When you write a workflow, every diamond should fail this test:

- **Bad gate:** "Quality is acceptable?" — internal judgment, agent gives itself a pass.
- **Good gate:** "Does `audit/structural-summary.md` contain `FAIL`?" — grep returns or doesn't.
- **Good gate:** "Does the directory `workspace/raw/specs/` contain at least one file per module listed in `module-map.md`?" — countable.
- **Good gate:** "Did the previous step write a git tag matching `gate-N-pass`?" — durable, restart-safe.

Bound retry budgets explicitly. *"Up to 3 attempts, then STOP"* in the diagram becomes `if [ $attempt -ge 3 ]; then exit 1` in the procedure. Without a bound, a gate becomes a forever-loop and the agent finds a way to pretend it cleared.

## When Rules Are Enough

Rules work fine when the cost of skipping is low or the agent has no incentive to skip. *"Use 4-space indents"* doesn't need a gate — there's nothing to gain by violating it, and lint catches it later anyway.

Reserve gates for the moments where skipping the check would be locally rational ("I'm pretty sure", "tests usually pass on my machine") but globally wrong. Verification, contamination, completeness, safety — anywhere "feeling done" diverges from "actually done."

## Carrying It Forward

The gate trick is the small idea behind a large amount of agent reliability. Every time you find yourself writing *"the agent should remember to..."*, stop. Replace it with: *what file must exist, what exit code must occur, what tag must be set, before the next step is allowed?*

The artifact is the gate. The diagram just documents which artifacts gate which transitions.
