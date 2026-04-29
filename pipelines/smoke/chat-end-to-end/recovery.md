---
name: recovery
description: Writes a one-line abort note when an interactive chat session was aborted early
auto_inputs: true
model: sonnet
permissionMode: dangerouslySkipPermissions
tools: []
inputs:
  - chat.output
outputs: {}
---

The interactive chat was aborted. Write a one-line note saying the user aborted early. Use the partial chat output from the Inputs block if available.
