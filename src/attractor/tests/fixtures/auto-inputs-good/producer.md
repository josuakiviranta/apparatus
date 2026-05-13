---
name: producer
description: Produces a result from the project input
model: sonnet
inputs:
  - project
outputs:
  result: string
permissionMode: dangerouslySkipPermissions
tools:
  - Read
---
body
