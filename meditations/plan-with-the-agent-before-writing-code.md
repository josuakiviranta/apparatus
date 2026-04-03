---
source: https://simonwillison.net/2025/Oct/7/vibe-engineering/
date: 2025-10-07
description: Agent that iterates on a plan collaboratively before writing any code — treating planning as a first-class agentic step, not a human prerequisite — while keeping the plan concise enough to not consume excessive context window.
---

# Plan With the Agent Before Writing Code

Don't hand the agent a vague task. Don't hand it an essay either. Iterate on the plan *with* the agent first — then execute.

The planning step is itself an agentic loop: describe the goal, have the agent draft an approach, push back on anything wrong, tighten the scope. By the time you say "now implement this," the agent has the full picture and you've caught misunderstandings before they become code.

**The optimization problem:** plans that are too short miss important constraints. Plans that are too long eat context window and dilute attention. Aim for the minimum structure that captures: what to build, what not to build, and any non-obvious constraints. A good plan is dense, not comprehensive.

A plan that fits in one screen is almost always better than one that doesn't.
