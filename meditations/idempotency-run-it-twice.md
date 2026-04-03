---
source: human-meditations
date: 2026-04-03
description: Agent that validates operations are safe to repeat — scripts, commands, and setup steps should produce the same result whether run once or ten times.
---

# Idempotency — Run It Twice

The test for any command, script, or setup step is simple: run it twice. Does it break? Create the same record twice. Apply the same migration twice. Run the install script on an already-configured machine. If it errors, crashes, or duplicates, it isn't done.

Agents don't think about this unless you tell them to. They implement the happy path — first run, clean state, everything in order. The second run is an afterthought. Make it explicit: *this operation must be safe to repeat*.

**The prompt: "Make this idempotent. It should produce the same result whether run once or ten times."**

This matters most for CLI tools, database migrations, provisioning scripts, and any setup step a user might re-run when something goes wrong. Those are exactly the moments where a broken second run causes the most damage — the user is already in a bad state, and now the recovery tool has failed them too.
