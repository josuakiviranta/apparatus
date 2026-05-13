---
name: consumer
description: Consumes a qualified output and a bare input
model: sonnet
inputs:
  - producer.result
  - project
outputs:
  summary: string
permissionMode: dangerouslySkipPermissions
tools:
  - Read
---
body
