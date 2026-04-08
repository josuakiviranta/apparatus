---
date: 2026-04-08
description: The inline JSON parser that today's illuminations prescribe fixing in meditate.ts already exists verbatim in new.ts, so the 2100 repair prescription addresses one of two infected files and will leave the project half-fixed.
---

## Core Idea

The inline `JSON.parse` loop in `runMeditationSession` — the subject of illuminations 1700, 1900, and 2100 — has an identical twin in `new.ts::runKickoffSession`. Both functions follow the same structure: spawn claude with `--output-format stream-json`, buffer lines, parse each one, emit raw text for `type === "text"` blocks, emit `→ [tool] name` for `type === "tool_use"` blocks. Neither calls `stream-formatter.ts`. The 2100 illumination's 30-line repair prescription names only `meditate.ts`. After that fix ships, `runKickoffSession` will still produce `→ [tool] name` output, missing `▶▶▶ MAIN AGENT` headers, ctx counts, and all subagent buffering.

## Why It Matters

The gene transfusion lens makes this concrete. The repair pattern is: import `{ processLine, initialState, flushState }` from `stream-formatter.ts`, replace the JSON parse loop with a `processLine` call, flush on close. `loop.ts` is the established exemplar — the first transfusion already happened. The cost of applying the pattern to a second location is lower than the first was. But the cost is zero only if the second patient is named.

A developer reading the 2100 illumination tomorrow will fix `meditate.ts` and close four illumination threads. `new.ts` will never appear in their task list because none of today's observations enumerate it. The project will have two commands that use stream-formatter (`implement` and `meditate`) and one that still renders `→ [tool] name` lines (`new`). The divergence will be invisible until someone runs `ralph new` and notices the output looks wrong.

There is also a permission model divergence worth noting alongside this. `meditate.ts` uses `--permission-mode dontAsk` with an explicit `--allowedTools` list. `new.ts` uses `--dangerously-skip-permissions` with no restriction. These are different security postures for functionally similar operations — both spawn non-interactive Claude sessions with a prompt, capture output, and parse the result. The difference is intentional for now (the new command needs broad permissions to scaffold and write files), but it means that when tool-restriction logic is ever applied to `new.ts`, the permission model will need separate handling. The pattern is not fully portable.

One unrelated finding from the same reading session: `scenario-runs/` is correctly listed in the `.gitignore` that `new.ts::scaffoldProject` writes into newly created projects. But ralph-cli's own `.gitignore` (root) does not contain `scenario-runs/`. When `ralph run-scenarios` is executed against ralph-cli itself — which is how the scenario tests are run — the directory is created at `ralph-cli/scenario-runs/` and becomes untracked noise in `git status`. The scaffold knows this directory should be ignored; the host project does not apply its own rule to itself.

## Revised Implementation Steps

1. **Add `new.ts` to the 2100 repair commit.** When implementing the `meditate.ts` stream-formatter fix, open `src/cli/commands/new.ts::runKickoffSession` and apply the identical transformation: import `processLine`, `initialState`, `flushState`; replace the `JSON.parse` loop with the `processLine` pattern. The exemplar is `loop.ts`. Do not close the 2100 illumination with only `meditate.ts` fixed.

2. **Write a unit test for `runKickoffSession` output path.** Add a test in `src/cli/tests/new.test.ts` (or inline with the existing new command tests) that passes a synthetic `▶▶▶ MAIN AGENT` event through the kickoff output path and asserts it appears in the output. Mirror the pattern from the updated `meditate.test.ts`.

3. **Add `scenario-runs/` to ralph-cli's own `.gitignore`.** One line: `scenario-runs/`. The directory is already being created (it exists as untracked in git now), and the scaffold correctly ignores it in new projects. Apply the same rule to the host project.

4. **Document the permission model split.** Add a comment above the `--dangerously-skip-permissions` line in `runKickoffSession` explaining why it differs from `meditate.ts`'s `--allowedTools` model. The new command needs file-write access; the meditate command is intentionally locked to MCP tools only. This difference is correct but invisible without a note.

5. **Search for any additional inline parsers before closing.** Run `grep -r "JSON.parse" src/cli/commands/` to confirm no third instance exists. If `plan.ts` was similarly structured at some point, it may have been fixed or may also need updating. Verify before committing.
