# Scenario: `ralph init <project>` scaffolds the .ralph/ tree

## Setup
- A clean working directory; the target folder `init-smoke` does not exist yet.
- `mkdir -p init-smoke`

## Action
`ralph init init-smoke`

## Expect
- exit code is 0
- directory `init-smoke/.ralph/pipelines` exists
- directory `init-smoke/.ralph/meditations/illuminations` exists
- directory `init-smoke/.ralph/meditations/stimuli` exists
- directory `init-smoke/.ralph/sessions` exists
- directory `init-smoke/docs/adr` exists
- file `init-smoke/VISION.md` exists and starts with `# Vision`
- file `init-smoke/CONTEXT.md` exists and starts with `# Domain Language`
- file `init-smoke/README.md` exists
- file `init-smoke/.gitignore` exists and contains a line equal to `.ralph/runs/`
- directory `init-smoke/.git` exists (git repo was initialized)
