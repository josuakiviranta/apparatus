---
source: https://factory.strongdm.ai/products/attractor
date: 2026-04-04
description: Agent that structures its work as an explicit graph — named phases, natural language transition conditions — rather than a single prompt running until done, making the loop observable, resumable, and composable.
---

# The Agentic Loop Is a Graph

The simplest agentic loop is a prompt that runs until it stops. It works, until it doesn't — and when it fails, you have no idea where it failed, why it stopped, or how to resume. The loop is a black box.

Attractor names the alternative: model the loop as a directed graph. Each node is a phase of work governed by a core prompt — Implement, Identify, Optimize, Validate. Each edge is a transition condition expressed in plain English and evaluated by the model itself: "Proceed once a bottleneck is identified." "Take this edge if the copywriting standards have been met." Execution is just traversal: move through nodes until convergence or a termination condition is reached.

**The insight is not the graph — it is the explicitness.** Naming the phases forces you to think about what work actually is. Writing the edges forces you to think about when each phase is done. An agent that can evaluate "is the bottleneck identified?" is doing something more reliable than an agent that just keeps going until it decides to stop.

The properties that follow from this structure are what make it valuable in practice: the loop is observable at every node transition, not just at the end. It is resumable from any checkpoint, which means a failure mid-graph is not a full restart. It is composable — graphs can be nested, sequenced, or wired together. None of this is possible when the loop is a single opaque prompt.

The generative SDLC framing is the right mental model: software development already has phases. Planning, implementation, validation, review. These don't have to be implicit in a system prompt — they can be first-class nodes with explicit entry and exit conditions. The agent doesn't decide when to move on. The graph does.

