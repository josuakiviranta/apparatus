---
source: https://simonwillison.net/2025/Oct/7/vibe-engineering/
date: 2025-10-07
description: Agent that treats documentation as a primary input — not an afterthought — because concise, accurate docs let it navigate APIs and modules without reading all the source code, reducing context load and improving output quality.
---

# Comprehensive Docs Are Agent Fuel

An LLM can only hold a subset of the codebase in context at once. Documentation is the shortcut: feed in a tight doc for a module or API and the agent can use it correctly without reading all the underlying code.

Write good documentation and the model may be able to build a correct implementation from docs alone — without touching the source.

**The tradeoff:** docs that are too sparse leave the agent guessing. Docs that are too verbose eat context window and crowd out the actual task. The goal is maximum signal density: what the thing does, what it expects, what it returns, and any gotchas. Not a tutorial.

Think of docs as compressed context. Every token of documentation replaces many tokens of source code the agent would otherwise need to read.
