# Scenario: `apparat init` is idempotent and never overwrites existing files

## Setup
- `mkdir -p idem-smoke`
- `apparat init idem-smoke` (first invocation — creates the tree)
- Overwrite the scaffolded files with sentinel content:
  - write `CUSTOM VISION` to `idem-smoke/VISION.md`
  - write `CUSTOM CONTEXT` to `idem-smoke/CONTEXT.md`
  - write `CUSTOM README` to `idem-smoke/README.md`

## Action
`apparat init idem-smoke`

## Expect
- exit code is 0
- file `idem-smoke/VISION.md` content is exactly `CUSTOM VISION` (not overwritten)
- file `idem-smoke/CONTEXT.md` content is exactly `CUSTOM CONTEXT` (not overwritten)
- file `idem-smoke/README.md` content is exactly `CUSTOM README` (not overwritten)
- file `idem-smoke/.gitignore` contains exactly one line equal to `.apparat/runs/` (no duplicate appended)
