---
name: consumer
description: Smoke-test consumer that reads producer's JSON outputs via auto-injected Inputs block
auto_inputs: true
model: haiku
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
inputs:
  - producer.result
  - producer.label
outputs: {}
---

Output exactly one line to stdout: `agent-json-vars: ok`. Do NOT use any tools.
