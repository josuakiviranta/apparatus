---
source: https://factory.strongdm.ai/techniques/filesystem
date: 2026-04-05
description: Agent that uses the filesystem as its primary memory substrate — writing indexes, scratch state, and context to disk — so that work persists across sessions, stays inspectable by humans, and can be shared across agents.
---

# The Filesystem as Agent Memory

Agents given an open-ended task will, without being told to, start creating directories, writing Markdown indexes, and saving state to disk. This wasn't a design decision — it was an observation. The filesystem is the natural answer to the question of where things go.

The thought experiment makes it obvious: if all you had were a home directory and a text editor, how would you track anything? You'd create folders with meaningful names. You'd write an index. You'd save state as files. There is no other answer. Agents reach the same conclusion independently, because it is simply the correct one.

The implication is that the filesystem is not just a place to write code. It is the agent's memory — mutable, persistent, and inspectable. State written to disk survives the end of a session, survives a context window reset, survives swapping to a different model. The work continues because the knowledge is not in the context; it is on disk.

**Genrefying** is the name for what happens when that structure needs maintenance. As a hierarchy of concepts grows, it becomes unbalanced — redundant directories, stale indexes, ambiguous naming. The corrective action is reorganization: the same thing a librarian does when a collection outgrows its original classification scheme. An agent can do this too. The filesystem is not a write-once artifact; it is a living structure that gets rebalanced as understanding evolves.

The practical consequence: design agent workflows to write state explicitly. Not just outputs — intermediate conclusions, open questions, session summaries, dependency notes. Make the filesystem the source of truth, not the context window. Then a human can inspect it, modify it, or hand it to a different agent. The work becomes auditable and composable in a way that in-context state never is.

