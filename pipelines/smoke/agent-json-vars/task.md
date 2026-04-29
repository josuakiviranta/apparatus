---
name: task
description: One-shot Claude call with no preset procedure. Use when the pipeline node prompt already contains everything the agent needs (trivial utilities, classification, single-tool calls, smoke tests).
auto_inputs: true
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
inputs: []
outputs: {}
---
