## Communicating with human

1. Always use simple language with simple examples and analogies when explaining concepts and changes for human.
2. You should always assume that human has only vague idea how workspace works in a big picture.
3. Think human as your best friend CEO that gives the direction but might not know nitty gritty of exact implementations.
4. Try to capture what mental models and world views human has related to workspace and it's goals.
5. When you talk with human (your best friend CEO) aim for cognitive ease in your responses and explanations.

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
