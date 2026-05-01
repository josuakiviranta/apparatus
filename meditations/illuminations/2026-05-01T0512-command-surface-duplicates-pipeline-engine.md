---
date: 2026-05-01
description: ralph implement/meditate and heartbeat's mirrored implement/meditate subcommands are bespoke wrappers around `pipeline run` with hand-mapped variables — every new bundled pipeline forces 1-2 new top-level commands and contradicts the vision that pipelines are the engine.
---

## Core Idea

`ralph implement` and `ralph meditate` are thin shims that resolve a project path and forward to `pipelineRunCommand` with hand-mapped variables (`src/cli/commands/implement.ts:16-39`, `src/cli/commands/meditate.ts:69-95`). The same pattern is duplicated under `heartbeat` as `heartbeat implement` and `heartbeat meditate` siblings of the generic `heartbeat pipeline` (`src/cli/commands/heartbeat.ts:97-152`). Every bundled pipeline currently costs **two new commander subcommands**, two help blocks, and a custom flag → variable translation table. The vision says "pipelines are the engine; the project is the target" — the command surface still treats `implement` and `meditate` as first-class verbs and `pipeline run` as a power-user fallback. That asymmetry is the single biggest KISS leak in the CLI.

## Why It Matters

- **Steer alignment.** The session steer asks for simpler pipeline creation/management/running. Today, "creation" of a third bundled pipeline implies authoring the .dot, *plus* a top-level command, *plus* a heartbeat sibling, *plus* updating help text in `program.ts:22-69`. The combinatorial cost is invisible until the third pipeline lands.
- **Vision drift.** `VISION.md` calls pipelines "the web" and `implement` is described in memory as "a thin pipeline shim" — yet `program.ts` still lists `implement` and `meditate` as headline commands while pipeline help is buried later. New users learn the wrong primitive first.
- **Hidden coupling.** `meditate.ts` quietly owns PID-locking, `.gitignore` mutation, dir-creation, and `VISION.md` injection. `implement.ts` quietly owns the tmux precondition for `--scenarios`. None of that is declared in `pipeline.dot` — it's invisible to anyone reading the pipeline. A user who runs `ralph pipeline run meditate --project foo` skips all of it. Two execution paths, one called "meditate", produce different behavior.
- **Daemon mirrors the leak.** `heartbeat.ts` ships three near-identical action handlers (`meditate`, `implement`, `pipeline`) that all end up calling the daemon with `command: "meditate" | "implement" | "pipeline"`. The daemon's task type field is now an enum that grows with every bundled pipeline.
- **Existing illuminations corroborate.** `pipeline-list-lies-about-runnables.md` already noted that discovery diverges from execution; `bundled-pipeline-exemplars-disagree.md` noted the three bundled pipelines disagree on conventions. This illumination names the upstream cause: the command layer doesn't believe its own abstraction.

## Revised Implementation Steps

1. **Add a generic `ralph run <pipeline> [project]` command** in `program.ts` that accepts `--var k=v` (already supported by `pipelineRunCommand`) and resolves names through the existing `resolvePipelineArg`. This is the new headline verb.
2. **Push hidden behavior down into pipeline metadata.** Extend the .dot graph header (or a sibling `pipeline.json` per the folder-form convention) with optional fields: `singleton: true` (for the meditate PID lock), `requires_tmux: true` (for `implement --scenarios`), and `gitignore: [".meditate.json", ...]`. Move the existing logic from `meditate.ts:42-66` and `implement.ts:24-29` into the engine prelude so any pipeline gets it for free.
3. **Collapse `heartbeat` to a single `ralph heartbeat run <pipeline>` subcommand.** Delete `heartbeat meditate` and `heartbeat implement`; the daemon `command` field becomes always `"pipeline"`. Task IDs derive from `pipeline:<stem>:<projectKey>` — already half the pattern in `heartbeat.ts:179-180`.
4. **Keep `ralph implement <folder>` and `ralph meditate <folder>` as deprecation aliases for one minor version.** Each forwards to `ralph run implement <folder>` / `ralph run meditate <folder>` and prints a one-line deprecation notice. Removes the burden in tests gradually rather than in one breaking commit.
5. **Rewrite the `program.ts:22-69` help block** so the headline workflow is `ralph run <pipeline> <project>` and `ralph pipeline list` is the discovery primitive (after fixing the `pipeline-list-lies-about-runnables` gap). The DOT file anatomy block stays where it is.
6. **Verify with the existing smoke fixtures.** `pipelines/smoke/` already has 16 fixtures — write one new fixture that asserts `singleton: true` blocks a concurrent run, and one that asserts `requires_tmux: true` exits cleanly with the right message outside tmux. Same shape as the current `pipeline-smoke-*.test.ts` files.
7. **Update `AGENTS.md`, `README.md`, and the orientation docs in the same PR.** The agent-orientation ghost-paths illumination already flagged that docs lie about CLI shape; this collapse makes it tractable to fix doc and code in lockstep.
