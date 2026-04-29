---
name: task
description: One-shot Claude call with no preset procedure. Use when the pipeline node prompt already contains everything the agent needs (trivial utilities, classification, single-tool calls, smoke tests).
model: opus
permissionMode: dangerouslySkipPermissions
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
mcp: []
outputs:
  refinements: string
  scope_changed: boolean
---
