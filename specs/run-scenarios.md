# Run Scenarios

`src/cli/commands/run-scenarios.ts` discovers and runs scenario tests, using Claude to interpret output and write actionable reports.

## Usage

```
ralph run-scenarios <project-folder> [--all]
```

## Options

- `--all` — skip interactive selection, run every discovered scenario

## Scenario Discovery

Scenarios are discovered from `<project-folder>/scenario-tests/*.md`. Each `.md` file in that directory is treated as a runnable scenario.

## Execution Flow

1. Scan `scenario-tests/` for `.md` files
2. **Without `--all`:** Present interactive selection (via readline) for the user to choose which scenarios to run
3. **With `--all`:** Run every discovered scenario
4. For each selected scenario:
   - Run as an isolated non-interactive Claude session
   - Use a templated prompt that includes the scenario content
   - Claude executes the scenario and interprets the output
5. Write timestamped results to `<project-folder>/scenario-runs/`

## Report Output

Results are written to `<project-folder>/scenario-runs/` with timestamps in the filename. Each report contains Claude's interpretation of the scenario execution, including:
- What was tested
- What happened
- Actionable findings

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Project folder missing | Exit with error |
| No scenarios found | Exit with message |
| Claude session fails | Log error, continue with remaining scenarios |
