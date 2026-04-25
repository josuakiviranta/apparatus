---
name: janitor
description: Janitor — read-only nightly agent that reconciles illumination lifecycle and surfaces doc drift / dead code as new illuminations
model: sonnet
permissionMode: dontAsk
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__list_plans
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented
  - mcp__illumination__mark_plan_implemented
  - Grep
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
---

placeholder body — replaced in Task 2
