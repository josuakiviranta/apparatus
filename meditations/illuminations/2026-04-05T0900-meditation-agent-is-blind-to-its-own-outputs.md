---
date: 2026-04-05
description: 'Every time `ralph meditate` runs, it reads the codebase and writes an illumination to `meditations/illuminations/`.'
---

# Meditation Agent Is Blind to Its Own Outputs

## Core Idea

Every time `ralph meditate` runs, it reads the codebase and writes an illumination to `meditations/illuminations/`. The next session starts with no awareness of what was previously written. The tools to read those files — `read_file` and `glob_files` — are already in the agent's allowed set. The prompt is one instruction away from closing this loop.

## Why It Matters

The `the-filesystem-as-agent-memory` lens makes the gap obvious: the filesystem is the right substrate for persistent agent memory, but only if the agent is directed to read it before writing to it. Right now `PROMPT_meditation.md` directs the agent to explore the codebase (code, specs, plans) and to read meta-meditation lenses — but not to read prior illuminations. The result is that each session is independent: the same observations can be restated, subtle progressions go unnoticed, and the accumulating record in `meditations/illuminations/` is invisible to the very agent that produced it.

The `the-agentic-loop-is-a-graph` lens adds a sharper frame: the current meditate loop is a single opaque pass — orient, reflect, write, done. Adding a prior-work review step would introduce an explicit phase boundary: *what has already been seen* vs. *what is new or changed*. That distinction is what turns isolated snapshots into a continuous analytical thread.

This isn't a theoretical concern. The project currently has six freshly-added meta-meditations (untracked in git). If meditate runs today and again after a future ESM-related fix, nothing prevents the same "ESM migration forced a multi-entry path audit" observation from appearing in both outputs, because neither session knows what the other wrote.

## Revised Implementation Steps

1. **Add a prior-illuminations review step to `PROMPT_meditation.md`.** Before step 3 (meta-meditations), insert: "Call `glob_files('meditations/illuminations/*.md')` to list prior illuminations. Read the 2–3 most recent using `read_file`. Note what has already been observed."

2. **Add guidance on non-redundancy to the reflection instructions.** After the new step, add: "Your illumination should build on, contradict, or deepen prior observations — not restate them. If a previous insight is now resolved or outdated, say so explicitly."

3. **Add a `specs/README.md` to the ralph-cli project's own `specs/` folder** that documents the meditate system's intended memory semantics — specifically that illuminations are cumulative and meant to be read back. This is the spec equivalent of writing the design intent down before it becomes invisible.

4. **Reconsider whether illuminations belong in `.gitignore` in the project scaffold (`new.ts` line ~55).** If illuminations are the project's analytical memory, gitignoring them treats them as ephemeral scratch. That's a deliberate choice worth making explicitly — not just a default. If they're worth generating, they may be worth committing.
