---
date: 2026-04-08
description: PROMPT_meditation.md references list_illuminations in the task steps but not in the "Tools available" section, making the prompt itself the invisible reason no one noticed the missing buildMeditationArgs wire-up.
---

## Core Idea

Adding a tool to the meditation system requires three files to stay in sync: `illumination-server.ts` (registration), `PROMPT_meditation.md` (documentation), and `buildMeditationArgs` in `meditate.ts` (permission). When `list_illuminations` was added, it was registered in the server and referenced in the prompt's task steps — but never added to the "Tools available" section of the prompt, and never added to `buildMeditationArgs`. Two of three locations. The documentation gap is the reason the permission gap went unnoticed: `PROMPT_meditation.md` is both the agent's instructions and the developer's checklist for what tools exist. If it doesn't appear under "Tools available," no one knows to wire it.

Read the prompt. The "Tools available" section lists five tools: `project_tree`, `glob_files`, `read_file`, `list_meta_meditations`, `read_meta_meditation`. Step 1 of "Your task for this session" says: "Call `list_illuminations`." The tool appears in the task but not in the tools. Every other tool mentioned in the task steps also appears in the "Tools available" section. `list_illuminations` is the only exception.

## Why It Matters

The CRUD lens (crud-is-a-checklist-not-a-menu.md) applies at a meta level: creating a new MCP tool implies a four-part checklist — register, document, permit, test. `list_illuminations` completed only the first. Illumination 1500 correctly identified the fix as `buildMeditationArgs` (the permit step). But it did not name the documentation gap. This matters because the prompt is the primary artifact a developer reads when asking "what does the meditation agent do?" If `list_illuminations` isn't in "Tools available," a developer scanning the prompt before a bug fix session would never identify it as the missing wire. They'd count five tools, find five entries in `buildMeditationArgs`, declare the list consistent, and move on. The omission from the prompt is load-bearing: it's what makes the args omission invisible.

There's a secondary observation. `PROMPT_meditation.md` is bundled into the npm package — it ships to end users and governs every meditation session. If a developer fixes `buildMeditationArgs` without updating the "Tools available" section, `list_illuminations` works but is undocumented in the only file a user can read to understand what the agent can do. The prompt and the implementation stay out of sync permanently.

The current session confirms the live state: `list_illuminations` was denied at the start of this meditation. The prompt's step 1 instructed calling it. The permission model blocked it. The "Tools available" section gave no warning this was possible.

## Revised Implementation Steps

1. **Add `list_illuminations` to the "Tools available" section of `PROMPT_meditation.md`.** Insert it after `read_meta_meditation`, mirroring the style of existing entries:
   ```
   - `list_illuminations` — list all illuminations written to this project, with descriptions.
     Call this first to see what has already been written before exploring the codebase.
   ```
   This is the documentation fix. It makes the prompt internally consistent and surfaces the tool to any developer reading it.

2. **Add `list_illuminations` to `buildMeditationArgs` in `meditate.ts`.** After the `read_meta_meditation` entry:
   ```ts
   "--allowedTools", "mcp__illumination__list_illuminations",
   ```
   This is the permission fix. Together with step 1, these two changes complete the wire-up that was skipped when the tool shipped.

3. **Replace the scattered `buildMeditationArgs` tool assertions with one enumeration test.** In `meditate.test.ts`, add a single test that extracts all `--allowedTools` values and asserts the exact set. This test fails whenever a tool is registered in `illumination-server.ts` but not added to `buildMeditationArgs`. Current individual tests do not catch that relationship.

4. **Add a comment above the `--allowedTools` block in `buildMeditationArgs` naming all three sync points.** Something like:
   ```ts
   // Three files must stay in sync when adding a tool:
   // 1. illumination-server.ts — register the tool
   // 2. PROMPT_meditation.md "Tools available" section — document it
   // 3. this list — permit it in the spawned session
   ```
   This makes the invariant visible at the exact location where it's most likely to be broken.

5. **Commit the prompt and the args change together.** They are logically one operation. A PR that updates `buildMeditationArgs` without updating the prompt leaves the documentation wrong. A PR that updates the prompt without updating the args leaves the session broken. Ship them in a single commit: `fix: add list_illuminations to prompt docs and buildMeditationArgs`.
