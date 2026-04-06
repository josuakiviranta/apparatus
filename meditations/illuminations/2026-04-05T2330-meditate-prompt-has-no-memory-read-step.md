# Meditate Prompt Has No Memory-Read Step

## Core Idea

`PROMPT_meditation.md` directs the agent to survey the project, pick lenses, reflect, and write. It contains no step to read existing illuminations first. Every session begins blind — with zero awareness of what prior sessions already noticed. As `meditations/illuminations/` grows, re-discovery becomes the default rather than the exception, and the filesystem memory that the workflow is building goes unread.

## Why It Matters

The prompt's six steps (`project_tree` → `glob_files`/`read_file` → `list_meta_meditations` → `read_meta_meditation` → reflect → `write_illumination`) are a discovery loop, not an accumulation loop. Nothing in the prompt triggers the agent to check what prior sessions produced before deciding what to notice.

Today this project has 9 illuminations in `meditations/illuminations/`. Each one identifies a real problem: magic strings across files, untested orchestration, no consumer for meditate-create, two-phase session duplication. A future session with the same prompt will hit `project_tree`, see the same code, pick the same lenses, and produce a tenth illumination about tool names being magic strings — because nothing directed it to ask "has this been noticed before?"

The `the-filesystem-as-agent-memory` lens is explicit: "design agent workflows to write state explicitly... Make the filesystem the source of truth." This project does that. But the lens continues: the filesystem only functions as memory if agents are directed to read from it before writing to it. The meditate prompt handles the write side and omits the read side entirely.

The cost is not just redundancy. It's calibration. An agent that reads prior illuminations can distinguish "re-confirming a known problem" from "noticing something genuinely new." Without that read step, every output is reported with equal weight, and the developer reading in the morning can't tell whether they're seeing something fresh or the fifth description of the same gap.

The fix is a single prompt amendment — one new step, before exploration, that takes 30 seconds of agent time and saves every subsequent session from starting from zero.

## Revised Implementation Steps

1. **Add a "prior illuminations" step to `src/cli/prompts/PROMPT_meditation.md`**, inserting it between the current steps 1 and 2. The new step:
   > "Before exploring the codebase, call `glob_files('meditations/illuminations/*.md')`. Read the titles of all files returned. For each one that seems relevant to what you may observe, call `read_file` to skim its Core Idea. Build a brief internal list: what has already been noticed. Do not repeat these as your illumination topic — seek what is new."

2. **Add a directive to target freshness** in the same step or immediately after:
   > "Prefer topics where: (a) the code has changed since a prior illumination was written, (b) a prior illumination predicted a problem that has since materialized, or (c) no prior illumination covers the area you are examining."

3. **Add an optional provenance note to the illumination format**. After "Write for a human who will read this in the morning," add: "If your insight extends or refines a prior illumination, name it explicitly in the opening sentence (e.g., 'Building on `2026-04-05T2230-tool-names-are-magic-strings-across-files.md`...')." This creates a traceable chain of reasoning across sessions without requiring a formal link graph.

4. **Update `illumination-server.ts` to sort `list_illuminations` results by date descending** (if a `list_illuminations` tool is added), or simply rely on the alphabetical sort of the YYYY-MM-DD filename format, which already gives recency order. The agent skimming prior illuminations should read the most recent first — the current naming convention already enables this.

5. **Add a test in `src/cli/tests/meditate.test.ts`** that verifies `buildMeditationArgs` includes `--allowedTools mcp__illumination__read_file` — confirming the agent has the mechanical capability to read prior illuminations (it already does). This test is the canary that prevents a future refactor from accidentally dropping the tool permission that makes the memory-read step possible.
