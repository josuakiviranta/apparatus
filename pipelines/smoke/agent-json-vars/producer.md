---
name: producer
description: Smoke-test producer that emits a fixed JSON object with result and label fields
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
outputs:
  result: string
  label: string
---

Return JSON with exactly: { "result": "hello", "label": "world" }. Do NOT use any tools.
