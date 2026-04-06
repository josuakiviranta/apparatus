# Scenario Reports Have a Write Path but No Read Path

## Core Idea

`ralph run-scenarios` writes structured diagnostic reports to `<project>/scenario-runs/`. No agent in the ralph system is instructed to read them. The filesystem-as-memory pattern requires both halves: an explicit write path and an explicit read path. Ralph designs the write half and leaves the read half to human memory. The carefully structured frontmatter, root-cause sections, and `<details>` blocks in each report are designed for Claude consumption — but no Claude session is told they exist.

## Why It Matters

The `run-scenarios` design spec (closing section, "Closing the loop") describes the handoff:

> When the Claude Code TUI opens, the user pastes the path to the scenario report file. Claude reads the actionable findings and acts on them directly in the implement session.

The entire value of `run-scenarios` depends on this handoff. But the handoff mechanism is: the user remembers to paste a path. That's it. There is no tooling, no automatic context, no instruction in `PROMPT_build.md` to check `scenario-runs/`. The implement session (`ralph implement`) has no awareness that `scenario-runs/` exists. The scenario report sits on disk in a well-known location while the implement agent opens with no knowledge of it.

This is the exact failure mode the filesystem-as-memory lens describes: writing state to disk is only useful if you also design who reads it and when. The illumination MCP server (`illumination-server.ts`) is the read path for meditate — the meditation agent is explicitly given tools and allowed tools to read project files and write illuminations. There is no equivalent read-path design for scenario reports.

The meditations directory is analogous and instructive. Prior illuminations (`2026-04-05T2330`) identified that `PROMPT_meditation.md` had no step to read previous illuminations before exploring. That gap means each meditation session re-discovers what the last nine sessions already noticed. The scenario handoff is the same problem one layer up: each implement session starts from zero even when specific, actionable findings were just written to disk minutes earlier.

The bundled `PROMPT_build.md` (`src/cli/prompts/PROMPT_build.md`) is the only persistent instruction set that reaches the implement session. It currently says nothing about `scenario-runs/`. The `ralph new` scaffold creates `scenario-runs/` as a folder and adds it to `.gitignore` — the infrastructure is designed — but the implement agent has no instruction to look there.

## Revised Implementation Steps

1. **Add a `scenario-runs/` read step to the bundled `PROMPT_build.md`**. Before starting any implementation work, the implement agent should check for files in `scenario-runs/` that are newer than 24 hours. If found, read them. Treat actionable findings as context for the current session — not requirements to execute blindly, but signals to consider alongside the implementation plan. One paragraph in `PROMPT_build.md`, placed before the build instructions.

2. **Add a `--with-scenario` flag to `ralph implement`** that accepts a path to a scenario report. Ralph passes this path as an initial message fragment: "Before starting, read the scenario report at `<path>` and incorporate its findings." This makes the handoff explicit and mechanical rather than relying on the user to compose the right message manually.

3. **After `run-scenarios` completes, print the suggested next command.** Instead of just `Done: scenario-runs/<file>`, print:

   ```
   Done: scenario-runs/2026-04-05T1942-auth-flow-integration.md

   To incorporate findings in your next session:
     ralph <project> implement --with-scenario scenario-runs/2026-04-05T1942-auth-flow-integration.md
   ```

   The user's next action is shown, not inferred.

4. **Do not rely on PROMPT_build.md alone for the read path.** `PROMPT_build.md` is user-editable and is gitignored per project — it will drift from the bundled default. The `--with-scenario` flag in step 2 is the reliable mechanism; the PROMPT_build.md step is the fallback for sessions where the flag isn't used.

5. **Consider whether `scenario-runs/` should be visible to the projectTree MCP tool during meditate sessions.** Currently gitignored dirs are skipped. Scenario reports are ephemeral diagnostic artifacts, not versioned state — gitignoring them is correct. But a future meditate session that observes `scenario-runs/2026-04-05T1942-auth-flow.md` in the tree could note that specific findings are unresolved in the code. The meditation agent becoming a convergence check between scenario findings and implementation state is a natural extension of its current role.
