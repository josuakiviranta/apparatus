---
name: lister
description: Lists files in src/cli/lib/ and returns a structured JSON array of file paths
model: haiku
permissionMode: dangerouslySkipPermissions
tools:
  - Glob
mcp: []
inputs: []
outputs:
  files: {type: array, items: string}
---

List the files in src/cli/lib/ using the Glob tool. Return your structured JSON output as `{"files": ["path1", "path2", ...]}`.
