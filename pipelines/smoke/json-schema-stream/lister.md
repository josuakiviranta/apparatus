---
name: lister
description: Lists files in src/cli/lib/ and returns a structured JSON array with name and description for each file
auto_inputs: true
model: haiku
permissionMode: dangerouslySkipPermissions
tools:
  - Glob
mcp: []
inputs: []
outputs:
  files:
    type: array
    items:
      name: string
      description: string
---

List the files in src/cli/lib/ using the Glob tool. For each file found, write one sentence describing what it does based on its name. Then return your structured JSON output.
