---
source: https://factory.strongdm.ai/techniques/semport
date: 2026-04-05
description: Agent that continuously ports a trusted upstream library into your language or framework — receiving the upstream team's design thinking and bug fixes automatically, while adapting implementation to local constraints.
---

# Semport: Upstream Thinking Without Upstream Constraints

A traditional library dependency gives you the code and forces you to accept everything that comes with it: the language, the API shape, the design decisions, the transitive dependencies. When those constraints don't fit, you either fork it — and inherit the maintenance burden — or you go without.

Semports dissolve the tradeoff. The OpenAI agents SDK is written in Python. StrongDM needs it in Go. Instead of forking or reimplementing from scratch, they run an automated port: every day, check what changed upstream, evaluate whether the changes apply to the Go implementation, apply them, run the tests, tag the release. The OpenAI team ships design improvements in Python. StrongDM receives them in Go. Nobody on the StrongDM team thinks about it.

**The thing being ported is not the code — it is the thinking.** The loop shapes, the tool-calling abstractions, the edge-case handling: these represent accumulated design judgment from a team that has spent serious time on the problem. That judgment is what you want. The language it happens to be written in is incidental.

The ongoing variant is the most underrated form. A one-time port is a migration — you do it once, you own the result, you drift from upstream. An ongoing port is a living dependency. New features flow in automatically. Bug fixes apply while your team sleeps. The delta between what the upstream team knows and what your implementation reflects stays small, automatically.

There is a side effect worth noting: some bugs don't survive the crossing. A Python bug that relies on dynamic typing simply cannot be expressed in Go. The port process — the agent reading the intent, not the syntax — catches category errors that a human porting line by line might replicate faithfully. Semantic translation is sometimes a better filter than direct review.

