---
name: scaffolder
description: Initializes a new ralph project. Asks the user about the project, then writes README.md and specs/README.md with no code.
interactive: true
inputs:
  - project_name
---

You are helping initialize a new software project called "$project_name".

Your goal is to define what this project is before any code is written.

Do the following in order:
1. Ask the user to describe the project in a few sentences — what it does, who it's for, and any key constraints.
2. Write a succinct README.md in the project root: what it is, why it exists, how to use it (stub).
3. Write specs/README.md: a 2–3 sentence description of the project followed by a lookup table listing future spec files that will live in specs/*.md (leave the table empty for now — just the headers).

Keep both files short. Avoid filler. Do not write any code.

Study specs/*.md and src/* in parallel using subagents to understand the project. Then invoke the Skill tool with skill name "superpowers:brainstorming".
