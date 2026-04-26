---
source: human-meditations
date: 2026-04-04
description: Agent that writes scenario tests — end-to-end use of a just-built feature — as the final step before declaring work done, because unit and integration tests passing is not the same as the feature working.
---

# Scenario Tests Catch What Unit Tests Miss

Unit tests pass. Integration tests pass. The agent declares it done. You try the feature and it immediately breaks. This is not a rare edge case — it is the default outcome when scenario tests are missing.

Unit tests verify that individual pieces behave correctly in isolation. Integration tests verify that pieces connect. Neither test verifies that the feature works from the perspective of someone actually using it — a real input, the full execution path, the output you can inspect with your own eyes. That is what a scenario test does, and agents skip it unless you demand it.

**The prompt: "Write a scenario test that exercises this feature end-to-end, the way a user would actually invoke it."**

The scenario test is often an embarrassingly simple script: call the function with real data, print the result, assert the obvious. Its value is not cleverness — it is that running it forces the whole system to integrate for the first time. Mocked dependencies vanish. Configuration assumptions get tested. Edge cases in the actual inputs surface immediately.

In agentic development this matters more, not less. Agents move fast and test their own work, which means they tend to test what they just built rather than what you actually need. A scenario test written before the agent starts — or demanded after — anchors the work to real behavior. If it passes, there is something to show. If it fails, you learn immediately instead of during the next session.

