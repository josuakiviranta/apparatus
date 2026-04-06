---
source: https://factory.strongdm.ai/techniques/gene-transfusion
date: 2026-04-05
description: Agent that reuses working patterns across codebases by pointing at concrete exemplars — internal or external, same language or different — and synthesizing equivalent implementations rather than abstracting or porting by hand.
---

# Gene Transfusion: Pattern Reuse by Exemplar

The old way to reuse a pattern was to abstract it into a library, document it, publish it, and depend on it. That works when the pattern is stable, the audience is broad, and the overhead is justified. Most of the time, none of those conditions hold. You just want the thing that works over there to also work over here.

Gene transfusion is the alternative: find a working implementation, point an agent at it, and ask it to synthesize the equivalent in your context. The exemplar does not need to be in your codebase. It does not need to be in your language. Caddy's Let's Encrypt integration is a valid reference for building Let's Encrypt support in a Python service. The agent reads the structure, extracts the invariants, identifies the edge cases, and produces something behaviorally equivalent — adapted to local constraints, not copied verbatim.

**The key ingredient is not the exemplar alone — it is the exemplar paired with tests.** Tests define what equivalence means. Without them, "synthesize this pattern" is underspecified. With them, the agent has a target: make these tests pass in this new context. The validation step is what turns an approximation into a confirmed port.

This changes how you think about external codebases. A well-written open source project is not just software you can use — it is a library of solved problems you can transfuse. The pattern for retrying with exponential backoff, the pattern for structured logging, the pattern for graceful shutdown — these exist, implemented correctly, in dozens of projects. The cost of reusing them is no longer the cost of abstracting them. It is the cost of pointing an agent at a good exemplar and running the tests.

Once a pattern is introduced, it propagates. The first transfusion is the expensive one — finding the exemplar, establishing the tests, validating equivalence. Every subsequent application to a new context in the same codebase is cheaper, because the exemplar now exists internally and the validation suite travels with it.

