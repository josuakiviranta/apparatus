## Development and planning principles to always keep in mind

1. YAGNI -> (You aren't gonna need it)
2. SOLID -> (2.1 Single responsibility principle, 2.2 Open–closed principle, 2.3 Liskov substitution principle, 2.4 Interface segregation principle, 2.5 Dependency inversion principle)
3. DRY -> (Don't repeat yourself)
4. KISS -> (Keep it simple, stupid)

## After suggesting approaches:

After suggesting approaches launch always subagents to verify those approaches for breaking changes. Give final suggestions after subagents have return their validations.

## Gathering information from workspace:

Use always subagents when gathering information from workspace.

## Subagent driven development:

Use always subagent driven development when implementing IMPLEMENTATION_PLAN.md instructed with red/green TDD principle

## Debugging the Ink TUI

When you need to observe or interact with ralph's Ink TUI (pipeline display, ChatUI overlay, meditate session, etc.), read `docs/harness/tmux-drive.md` first. It contains the complete, authoritative set of bash patterns for driving ralph inside tmux. Do not invent your own tmux incantations — the document already accounts for edge cases (nanosecond timing, atomic JSON updates, orphan recovery, terminal focus).
