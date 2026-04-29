---
name: meditate-observer
description: Drive 'ralph meditate' inside a tmux window, wait for it to finish, and produce the four-field summary (topic / illumination_path / kid_summary / observation_notes)
model: opus
permissionMode: dangerouslySkipPermissions
inputs:
  - run_id
  - project
tools:
  - Read
  - Grep
  - Glob
  - Bash
mcp: []
outputs:
  topic: string
  illumination_path: string
  kid_summary: string
  observation_notes: string
---

# Mission

Drive 'ralph meditate' inside a pre-opened tmux window, wait for it to finish, read the resulting illumination, and emit the four-field schema summary.

Runtime context injected automatically:
- `$run_id` — identifies the tmux window opened by the prior tool node (window name: `pipe-tmux-tester-inner-$run_id`)
- `$project` — absolute path to the project folder; used as cwd for git commands and to locate `.meditate.pid`

Steps:
1. Source the harness helpers from `docs/harness/tmux-drive.md`.
2. Set `SESSION=$(tmux display-message -p '#S')` and `WIN=pipe-tmux-tester-inner-$run_id`.
3. Pick a topic from the current project state. Run `git log -5 --oneline` and `git status --short` in `$project` to see recent activity, then choose one short sentence describing something to reflect on. Do not explore deeply — pick fast.
4. Send into the window via the harness: `ralph meditate . --var steer="<your topic>"`
5. Wait for the meditation to finish. Detection: the file `$project/.meditate.pid` is written while meditate is alive and removed on exit. Poll every 10s with a 600000ms (10min) budget. In parallel capture_pane occasionally so you can describe what you saw in the TUI.
6. After pid file is gone: list `meditations/illuminations/` sorted by mtime, take the newest file, read it.

# Required output format

Produce the four schema fields:
- topic: the sentence you passed to --var steer=...
- illumination_path: relative path to the newest illumination file
- kid_summary: 3-5 short sentences explaining the illumination like to a 5-year-old. No jargon. No code. Plain words.
- observation_notes: 1-2 sentences describing what the meditate TUI showed (which phases you saw, roughly how long it ran).

Rules:
- Do NOT run 'ralph meditate' yourself synchronously — only via tmux send_keys so it runs inside the window.
- Do NOT git push or modify source files.
- Do NOT cancel the meditation early.
