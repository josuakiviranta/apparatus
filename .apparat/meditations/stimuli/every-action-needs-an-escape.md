---
source: human-meditations
date: 2026-04-03
description: Agent that ensures every user-reachable state has an exit — modals need close buttons, processes need interrupt handlers, flows need cancel paths.
---

# Every Action Needs an Escape

If a user can get into a state, they need a way out. This sounds obvious. It gets missed constantly.

Modals without close buttons. Wizards without a back step. Loading states that spin forever on error. Long-running processes with no way to abort. Agents build the entry because that's what you asked for. The exit is implicit to you and invisible to them.

**For every action, ask: what does the user do when they want to stop, undo, or leave?**

The escape isn't always an undo. Sometimes it's a cancel button. Sometimes it's a timeout. Sometimes it's a SIGINT handler or a `--dry-run` flag. The form depends on the context — the requirement is universal.

This compounds with agent-generated code. An agent will scaffold a modal, a multi-step form, or a background job and consider it done. It built what you described. You described the entry. Describe the exit too, or you'll find it missing in production when a user gets stuck.
