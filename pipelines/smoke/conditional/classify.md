---
name: classify
description: Smoke-test classifier that emits a fixed JSON object with a result field
auto_inputs: true
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
inputs: []
outputs:
  result: string
---

Return JSON with exactly: { "result": "pass" }. Do NOT use any tools.
