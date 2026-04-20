# Run Scenarios

`src/cli/commands/run-scenarios.ts` discovers scenario test scripts, spawns each one under `bash`, and writes a timestamped report capturing the script's exit status and raw output.

## Usage

```
ralph run-scenarios <project-folder> [--all]
```

## Options

- `--all` — skip interactive selection, run every discovered scenario

## Scenario Discovery

Scenarios live in `<project-folder>/scenario-tests/`. Every regular file in that directory is treated as a runnable scenario — the discovery step does not filter by extension, so `.sh`, `.md`, or any other filename is accepted. In practice scripts are shell (bash) scripts; the `.md` header-comment convention is recognised for documentation purposes (see below).

Each scenario file may declare optional metadata on any of the first 10 lines:

- `# @name: <human-readable name>` (or `// @name:` / `-- @name:`)
- `# @description: <one-line summary>` (or `// @description:` / `-- @description:`)

If no `@name` is declared, the scenario name defaults to the filename without extension.

## Execution Flow

1. Scan `scenario-tests/` for all regular files
2. Parse `@name` / `@description` from each file's header
3. Print the discovered list to stdout
4. **Without `--all`:** Prompt the user via `readline` for a space-separated list of indices (or `all`); run only the selected scenarios
5. **With `--all`:** Run every discovered scenario
6. Ensure `<project-folder>/scenario-runs/` exists
7. For each selected scenario:
   - Spawn `bash <scenario-file>` with the current process env
   - Stream stdout and stderr to the terminal while buffering both
   - On child exit, write a markdown report to `scenario-runs/<timestamp>-<slug>.md`

The scenario script itself is responsible for doing whatever work the scenario describes. The harness does **not** spawn a Claude session, apply prompt templates, or interpret results — it only records the raw exit code and captured output. Scenarios that need LLM interpretation must invoke `ralph`, `claude`, or another tool from within the script.

## Report Output

Reports are written to `<project-folder>/scenario-runs/<YYYY-MM-DD>T<HHMM>-<slug>.md` with the following shape:

```markdown
---
date: <ISO timestamp>
scenario: <name>
script: <absolute path>
status: pass | fail
---

# <name>

## What ran
<description or name>

## Result
Script exited with code <N>.

<details>
<summary>Raw output</summary>

```
<combined stdout + stderr>
```

</details>
```

`status` is `pass` when the child exits with code 0, otherwise `fail`.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Project folder missing | Print error, exit 1 |
| No `scenario-tests/` directory or empty | Print info, exit 0 |
| Interactive selection empty | Print info, exit 0 |
| Scenario script exits non-zero | Report `status: fail`, continue with remaining scenarios |
