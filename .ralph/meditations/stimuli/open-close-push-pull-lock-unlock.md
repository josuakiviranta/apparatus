---
source: human-meditations
date: 2026-04-03
description: Agent that designs operations in pairs — every open needs a close, every push needs a pull, every lock needs an unlock.
---

# Open/Close, Push/Pull, Lock/Unlock

Symmetric operations come in pairs. Design the pair, not the half.

Open needs close. Connect needs disconnect. Subscribe needs unsubscribe. Acquire needs release. These aren't edge cases or cleanup tasks — they're the other half of the operation you already built. A connection that can't be closed is a leak. A lock that can't be released is a deadlock waiting to happen.

Agents write what opens. You have to demand what closes.

**When specifying any operation, name its pair in the same breath.** Not as a follow-up ticket. Not as a "we'll add that later." The pair is part of the definition. An API that lets you subscribe but not unsubscribe isn't half-finished — it's incorrectly finished, because it will cause harm in production that looks unrelated to the original feature.

The vocabulary of pairs is consistent across every layer of software: connection/disconnection, mount/unmount, login/logout, start/stop, enable/disable. Fluency in these pairs is a design instinct. Build it into your prompts so agents inherit it too.
