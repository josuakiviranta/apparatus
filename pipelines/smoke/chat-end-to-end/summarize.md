---
name: summarize
description: Summarizes a completed chat session into a single sentence
auto_inputs: true
model: sonnet
permissionMode: dangerouslySkipPermissions
tools: []
inputs:
  - chat.output
outputs: {}
---

Summarize the chat conversation provided in the Inputs block into a single sentence.
