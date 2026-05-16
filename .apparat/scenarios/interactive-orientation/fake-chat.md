---
name: fake-chat
description: Minimal interactive agent used by the interactive-orientation scenario to assert the engine appends the grounded-opening block.
model: sonnet
thinking: off
permissionMode: dangerouslySkipPermissions
tools:
  - Read
mcp: []
inputs:
  - verifier_summary
---

# Mission

Echo your understanding of the injected `verifier_summary` and stop.
