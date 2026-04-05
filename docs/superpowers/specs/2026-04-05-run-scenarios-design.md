# ralph run-scenarios — Design Spec

**Date:** 2026-04-05
**Scope:** `ralph run-scenarios` new command, `meditate.ts` fixes, `ralph new` scaffold correction

---

## Background

A meditation (`meditations/illuminations/2026-04-05T1900-meditate-orchestration-is-the-untested-core.md`) identified that `runMeditationSession` in `meditate.ts` has zero test coverage, a silent `catch {}` discards JSON parse errors, and the close handler ignores the exit code. All six claims were verified accurate by code inspection.

The meditation proposed scenario tests as the solution. This spec designs the scenario test infrastructure as a first-class ralph command, extending the meditation's recommendation into a language-agnostic harness usable across all ralph-managed projects.

---

## Goals

1. `ralph run-scenarios <project-folder>` — discover, select, and run scenario tests in any target project, with Claude interpreting and writing actionable reports
2. Fix three concrete bugs in `meditate.ts` identified by the meditation
3. Correct `ralph new` scaffold to be language-agnostic (remove TS-specific structure)

---

## Design

### `ralph run-scenarios <project-folder>`

#### Discovery

Globs `<project-folder>/scenario-tests/` for all files. If the folder does not exist:

```
No scenario-tests/ folder found in <project-folder>.
Run `ralph new <project-folder>` to scaffold the ralph structure, or create scenario-tests/ manually.
```

#### Description parsing

For each discovered file, ralph reads the first 10 lines and matches `@name:` and `@description:` after any comment prefix (`#`, `//`, `--`). Falls back to filename without extension if no header found.

Convention for scenario scripts:

```sh
#!/bin/bash
# @name: Auth Flow Integration
# @description: Tests login, token refresh, and logout end-to-end against a live server
```

```go
// @name: API Contract Tests
// @description: Verifies all REST endpoints return correct shapes with real HTTP requests
```

#### Interactive selection

```
Scenario tests found in scenario-tests/:

  1. Auth Flow Integration
     Tests login, token refresh, and logout end-to-end
     [test-auth-flow.sh]

  2. API Contract Tests
     Verifies all REST endpoints return correct shapes
     [test-api-contracts.sh]

  3. test-smoke.sh  (no description)

Enter numbers to run (e.g. 1 3) or 'all':
```

`--all` flag skips the prompt for non-interactive/CI use.

#### Execution — isolated Claude sessions

Each selected scenario runs as an **isolated non-interactive Claude session**, following the `meditate-create.ts` pattern. Per scenario, ralph spawns `claude` with:

- `--system-prompt` from bundled `PROMPT_scenario.md`
- Initial message substituting `{{SCENARIO_NAME}}`, `{{SCENARIO_DESCRIPTION}}`, `{{SCRIPT_PATH}}`, `{{OUTPUT_PATH}}`
- `cwd` set to `<project-folder>`

Ralph streams Claude's progress to terminal and prints the output path on completion. Scenarios run sequentially — they are potentially expensive and stateful.

Live terminal output:

```
Running: Auth Flow Integration...
  → [tool] bash
  → [tool] write_file
Done: scenario-runs/2026-04-05T1942-auth-flow-integration.md

Running: API Contract Tests...
  → [tool] bash
Done: scenario-runs/2026-04-05T1942-api-contract-tests.md
```

#### `PROMPT_scenario.md` responsibilities

Instructs Claude to:
1. Read the script at `{{SCRIPT_PATH}}`
2. Run it via bash, capture exit code and output
3. Interpret what happened — diagnose, not just transcribe
4. Write a markdown file to `{{OUTPUT_PATH}}` with this structure:

```markdown
---
date: 2026-04-05T19:42
scenario: Auth Flow Integration
script: scenario-tests/test-auth-flow.sh
status: fail
---

# Auth Flow Integration

## What ran
One sentence describing the script's intent.

## What happened
Claude's interpretation of the output — root cause, not symptom.

## Actionable findings
- Specific findings attributed to output lines
- If pass: what was confirmed working
- If fail: what to fix and where

<details>
<summary>Raw output</summary>

[stdout/stderr here]

</details>
```

#### Output location

One file per scenario in `<project-folder>/scenario-runs/`. Filename: `YYYY-MM-DDTHHMM-<scenario-slug>.md`. Folder created if absent.

`scenario-runs/` is gitignored by default in `ralph new` scaffold — run outputs are ephemeral diagnostic artifacts. Projects that want to track them can remove the `.gitignore` entry.

---

### `meditate.ts` fixes

Three targeted changes, no structural refactor:

**1. Overridable binary**

```ts
// before
const child = spawn("claude", args, { ... });

// after
const cmd = process.env.RALPH_TEST_CMD ?? "claude";
const child = spawn(cmd, args, { ... });
```

Prerequisite for scenario tests that exercise `runMeditationSession` end-to-end.

**2. Exit code surfaced**

```ts
child.on("close", (code) => {
  try { cleanupMcpConfig(mcpConfigPath); } catch {}
  if (code !== 0) process.stderr.write(`Warning: claude exited with code ${code}\n`);
  res();
});
```

No throw — meditate is fire-and-forget. The signal is surfaced, not fatal.

**3. Tool-use progress indicators**

Add to the existing stream parser loop (matching plan.ts and new.ts):

```ts
else if (block.type === "tool_use") {
  process.stdout.write(`\n→ [tool] ${block.name}\n`);
}
```

Users see activity during the 2-3 minute exploration phase instead of silence.

---

### `ralph new` scaffold correction

**Remove:** `src/tests/{integration,unit,scenarios}/` — TypeScript-specific, wrong for a language-agnostic tool.

**Corrected scaffold:**

```
<project-name>/
  src/                          # empty — ralph convention: code lives here
  scenario-tests/               # empty — scenario scripts go here
  scenario-runs/                # created, added to .gitignore
  specs/                        # empty — design docs
  AGENTS.md                     # empty
  IMPLEMENTATION_PLAN.md        # empty, gitignored
  PROMPT_build.md               # copied from ralph bundle
  PROMPT_plan.md                # copied from ralph bundle
  README.md                     # written by Claude kickoff session
```

`.gitignore` contents:

```
PROMPT_build.md
PROMPT_plan.md
IMPLEMENTATION_PLAN.md
scenario-runs/
```

The kickoff session (non-interactive Claude then interactive resume) is unchanged.

---

## File structure changes in ralph-cli

**New files:**

```
src/cli/commands/run-scenarios.ts     # new command
src/cli/prompts/PROMPT_scenario.md    # bundled prompt for Claude scenario sessions
src/cli/tests/run-scenarios.test.ts   # unit tests: discovery, header parsing, slug generation
scenario-tests/                       # ralph-cli's own scenario tests
  test-run-scenarios.sh               # stub project + scenario script -> assert report written
  test-meditate-session.sh            # RALPH_TEST_CMD stub -> assert illumination written
```

**Modified files:**

```
src/cli/index.ts                      # register run-scenarios command
src/cli/commands/new.ts               # corrected scaffold
src/cli/commands/meditate.ts          # 3 fixes
src/cli/tests/meditate.test.ts        # add runMeditationSession scenario test via RALPH_TEST_CMD
```

**`tsup.config.ts` — no change needed.** `PROMPT_scenario.md` placed in `src/cli/prompts/` is picked up automatically by the existing `onSuccess` copy hook.

**`run-scenarios.test.ts` unit test coverage:**
- Header parser: extracts `@name`/`@description` from `#`, `//`, `--` prefixes
- Fallback: filename used when no header found
- Slug generation: scenario name to kebab-case filename
- Discovery: returns empty list when `scenario-tests/` absent

---

## Closing the loop

The intended workflow after `ralph run-scenarios`:

```
ralph run-scenarios <project-folder>
→ scenario-runs/2026-04-05T1942-auth-flow-integration.md written

ralph <project-folder> implement
```

When the Claude Code TUI opens, the user pastes the path to the scenario report file. Claude reads the actionable findings and acts on them directly in the implement session.

The scenario report format is designed for this handoff — structured frontmatter for filtering, Claude-written actionable findings for immediate consumption, raw output in foldable `<details>` blocks for deep inspection when needed.
