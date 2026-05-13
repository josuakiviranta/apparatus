# Scenario: meditate refuses to write into an apparat-internal folder

## Setup
- A clean working directory; the target folder `proj-shape-smoke` does not exist yet.
- `apparat init proj-shape-smoke` (creates apparat-shaped project at proj-shape-smoke/)
- Confirm `proj-shape-smoke/.apparat/` exists.

## Action
`apparat meditate proj-shape-smoke/.apparat`

## Expect
- exit code is 1
- stderr contains "apparat-internal folder"
- stderr contains the string `proj-shape-smoke` (the parent — i.e. the intended target)
- no file under `proj-shape-smoke/.apparat/.apparat/` exists
- no file under `proj-shape-smoke/.apparat/meditations/illuminations/` was created
- no file `proj-shape-smoke/.apparat/.meditate.pid` exists

## Negative case (companion)
`apparat meditate /tmp/no-shape-here-$$/` (a path with no VISION.md / CONTEXT.md / .apparat/ / .git/):
- exit code is 1
- stderr contains "does not look like an apparat-shaped project"
- stderr lists all four signals
