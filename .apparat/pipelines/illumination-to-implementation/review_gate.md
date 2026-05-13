---
model: sonnet
thinking: off
type: gate
choices:
  - Approve
  - Tmux
  - Retry
inputs:
  - project
  - plan_writer.plan_path
---
Review implementation

Project: $project
Plan: $plan_writer.plan_path
