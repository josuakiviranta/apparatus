---
source: https://factory.strongdm.ai/techniques/shift-work
date: 2026-04-05
description: Agent that knows which mode it is in — interactive clarification or non-interactive execution — because the distinction determines the entire workflow, and confusing the two wastes time in both directions.
---

# Interactive vs. Non-Interactive Agent Work

Not all agentic work is the same kind of work. Some tasks need a human in the loop — intent is still being shaped, vision is still being formed, the work is jointly evolving. Other tasks are already fully specified. Treating them the same is a mistake in both directions: adding unnecessary back-and-forth to something that was ready to run, or silently charging ahead on something that wasn't.

The distinction is simple: **is the intent complete?** If yes, the agent can operate end-to-end without clarification. If no, the work is interactive — generate, clarify, approve, correct. Knowing which mode you're in before you start is more valuable than any prompt optimization.

What counts as fully specified is more generous than it seems. A formal RFC paired with a conformance test suite is fully specified — the spec defines behavior, the tests define correctness. An existing working application is fully specified. It is an executable specification: run it, observe its behavior, that is the requirement. There is no ambiguity about edge cases, because the original system answers every question.

The Instagram example cuts to the heart of it. Describing Instagram's functionality takes a few sentences. Building a global image-oriented social network is primarily a non-functional problem — scalability, availability, performance, security. Functional intent is the easy part. The hard specification lives in the non-functional constraints, and those only become fully specified when they are written down, tested, or demonstrated by an existing system.

**The practical question before starting any agent task: is this interactive or non-interactive?** If intent is still being expressed, stay in the loop. If the spec is complete — formal document, test suite, working system — hand it off and let it run. Interrupting a non-interactive task with unnecessary check-ins is waste. Starting a non-interactive run on an incomplete spec is chaos.

