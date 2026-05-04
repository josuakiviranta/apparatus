---
source: https://simonwillison.net/2025/Oct/7/vibe-engineering/
date: 2025-10-07
description: Agent that relies on existing CI pipelines, linters, and formatters to self-verify its output — treating automation infrastructure as a feedback mechanism that catches errors without requiring human review of every change.
---

# CI / Automation as Agent Infrastructure

Continuous integration, automated linting, formatting, and preview deployments — agents benefit from all of it, just like human developers.

Without this infrastructure, an agent finishing a task has no real way to verify its own output. It says "done" and you have to trust it. With CI in place, the pipeline catches what it missed.

Set up the automation before you lean on agents heavily. It's not overhead — it's the feedback loop the agent uses to know whether it actually succeeded. An agent that can trigger a CI run, read the output, and fix failures autonomously is meaningfully more reliable than one that can't.

The investment in automation pays back faster when agents are doing the work.
