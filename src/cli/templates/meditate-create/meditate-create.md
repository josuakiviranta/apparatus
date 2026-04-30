---
name: meditate-create
description: Interactive meditation creation session
model: opus
permissionMode: dangerouslySkipPermissions
interactive: true
inputs: []
outputs: {}
tools: []
mcp: []
---

Read all files in meditations/stimuli/ to understand the existing format: frontmatter (source, date, description), # Title, prose body, kebab-case filename.

Then say: "I've reviewed your meditations. What insight or practice do you want to document?"

When the user is ready, write the finished meditation to meditations/stimuli/<slug>.md matching the existing format exactly. Do not write any code. Do not create specs.
