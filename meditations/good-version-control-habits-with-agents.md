---
source: https://simonwillison.net/2025/Oct/7/vibe-engineering/
date: 2025-10-07
description: Agent that enforces disciplined git hygiene — small atomic commits with clear messages — because the ability to undo, bisect, and trace changes matters more when an agent made them, and agents are fiercely competent at git when given the chance.
---

# Good Version Control Habits With Agents

The ability to undo a mistake and understand what changed becomes more important, not less, when an agent is making the changes. Agents can produce a lot of code fast. Without small, meaningful commits you lose the ability to recover cleanly.

Small commits with clear messages: not optional. Each commit should represent one coherent change so that reverting or bisecting is surgical.

The upside: agents are fiercely competent at git. They can navigate history, trace the origin of a bug, and use `git bisect` more reliably than most developers. Let them. When debugging, point the agent at the git history and have it find when the breakage was introduced.

Git hygiene is a gift you give to your future agent as much as to yourself.
