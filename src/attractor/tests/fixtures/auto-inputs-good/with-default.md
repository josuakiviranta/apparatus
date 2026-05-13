---
name: with-default
description: Bare input not in caller inputs, covered by default_optional_thing on the node
model: sonnet
inputs:
  - optional_thing
outputs:
  final: string
permissionMode: dangerouslySkipPermissions
tools:
  - Read
---
body
