---
source: human-meditations
date: 2026-04-03
description: Agent that treats CRUD as a complete contract — when you build create, you're committing to read, update, and delete too.
---

# CRUD Is a Checklist, Not a Menu

When you ask an agent to add a feature that stores data, it will build create. Maybe read. It will stop there unless you say otherwise. Update and delete feel like follow-up work — optional, deferrable, someone else's problem. They aren't.

The moment you persist something, you've made a contract with the user: this thing can be changed and removed. A list you can add to but never edit or clear isn't a feature, it's a trap.

**Treat CRUD as a checklist. All four items ship together or the feature isn't done.**

This applies beyond databases. Any resource that can be created — a config entry, a file, a user account, an API key — implies the full set of operations. Agents will implement what you specify. Specify all of it upfront, not as an afterthought when a user files a bug that they can't delete something.

The cost of adding update and delete during initial implementation is low. The cost of retrofitting them into a live system with real data is not.
