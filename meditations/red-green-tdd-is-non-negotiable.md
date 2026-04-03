---
source: https://www.youtube.com/watch?v=wc8FBhQtdsA
date: 2026-04-03
description: Agent that always writes tests first and watches them fail before implementing — using the phrase "red/green TDD" as a trigger, because agents understand this jargon and produce better, leaner code when forced to prove tests fail before making them pass.
---

# Red/Green TDD Is Non-Negotiable

You don't have to enjoy TDD. The agent doesn't care. That's the point.

The discipline of writing tests first, watching them fail (red), then writing the implementation to make them pass (green) was hard to maintain as a human because it was boring and slowed exploration. Agents don't have that problem. They don't get bored. They don't want to explore first. Tell them to do it and they will.

The result: fewer missed test cases, no unnecessary implementation code, tests that you can trust actually caught something.

**The prompt is two words: `red/green TDD`**

That's it. Agents know this jargon. No need for a paragraph explaining "write the test first, run it, watch it fail, then implement, then watch it pass." The compressed term works. Use it.

If a test passes before the implementation exists, something has gone wrong. That's the whole insight. Make sure the agent demonstrates the failure before claiming success.

Side effect: verbose test suites are now fine. Code is cheap. 100 tests on a small library is acceptable. Let agents write as many as make sense — you can always throw them away later.
