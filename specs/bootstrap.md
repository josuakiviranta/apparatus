# Prompt Bootstrap

Runs before every command. Ensures the project has prompt files before any Claude session starts.

## Algorithm

For each of `PROMPT_plan.md` and `PROMPT_build.md`:
- If `<project-folder>/<file>` does not exist:
  - Copy bundled default → `<project-folder>/<file>`
  - Append `<file>` to `<project-folder>/.gitignore` (create if needed)
  - Record as injected

If any files were injected:
- Print notice listing what was injected
- Print: "Review and customize these prompts, then re-run your command."
- **Exit 0** — do not proceed with the requested command

If both files already exist → continue normally.

## Example Output (first run)

```
Injected default prompts into /path/to/project:
  + PROMPT_plan.md
  + PROMPT_build.md
  + Added entries to .gitignore

Review and customize these prompts, then re-run your command.
```

## Intent

Projects own their prompts. The defaults are a starting point — users should tailor them to their workflow. Adding to `.gitignore` keeps them out of the project repo by default.
