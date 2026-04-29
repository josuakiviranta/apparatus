---
name: producer
description: Smoke-test producer that emits a fixed JSON object with result and label fields
model: haiku
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
inputs: []
outputs:
  result: string
  label: string
---

Return JSON with exactly: { "result": "hello", "label": "world" }. Do NOT use any tools.
