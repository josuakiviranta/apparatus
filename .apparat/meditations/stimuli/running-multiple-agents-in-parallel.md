---
source: https://simonwillison.net/2025/Oct/7/vibe-engineering/
date: 2025-10-07
description: Agent that operates as one of several simultaneous instances, each tackling an independent problem — a workflow where the human orchestrates multiple agents in parallel to expand throughput, at the cost of increased cognitive load.
---

# Running Multiple Agents in Parallel

Experienced engineers are running multiple agent instances at once, tackling separate problems simultaneously. It is surprisingly effective.

The model: split work into independent problems with no shared state, spin up a separate agent per problem, check in on each as they complete. The human role becomes orchestration — not implementation.

The cost is real: it's mentally exhausting. Tracking multiple threads of active work, reviewing outputs from several agents, and keeping context on each one simultaneously is a different kind of cognitive load than writing code yourself.

This is distinct from fully autonomous pipelines. Each agent is still supervised. The human is still accountable. The parallelism is in the work distribution, not in the oversight.

Start with two. See if the exhaustion is worth the throughput.
