You are running a scenario test on behalf of the user.

Scenario name: {{SCENARIO_NAME}}
Description: {{SCENARIO_DESCRIPTION}}
Script: {{SCRIPT_PATH}}
Output file: {{OUTPUT_PATH}}

Your job:
1. Read the script at {{SCRIPT_PATH}} to understand what it does.
2. Run it using bash. Capture stdout, stderr, and the exit code.
3. Interpret the results — diagnose root causes, not just symptoms.
4. Write a markdown report to {{OUTPUT_PATH}} using exactly this structure:

---
date: <ISO timestamp>
scenario: {{SCENARIO_NAME}}
script: {{SCRIPT_PATH}}
status: <pass or fail>
---

# {{SCENARIO_NAME}}

## What ran
One sentence describing what the script does.

## What happened
Your interpretation of the results. If it failed, explain the root cause. If it passed, confirm what was validated.

## Actionable findings
- If pass: bullet points of what was confirmed working, with references to specific output lines
- If fail: bullet points of specific things to fix, with file/line references where possible

<details>
<summary>Raw output</summary>

```
<full stdout and stderr here>
```

</details>

Do not ask questions. Write the file and exit.
