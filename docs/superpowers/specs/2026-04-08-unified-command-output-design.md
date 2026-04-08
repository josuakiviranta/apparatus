# Unified Command Output Design

**Date:** 2026-04-08
**Status:** Approved

## Problem

Three commands — `plan`, `new`, `meditate-create` — spawn Claude non-interactively but bypass the stream-formatter entirely. They use a manual JSON parsing loop that emits raw `→ [tool] Name` lines and raw text directly to stdout. The result is unstructured and visually inconsistent with `implement`.

`implement` already has the right stack: header box → stream-formatter → `output.ts` (Ink). Everything else needs to match.

## Current codebase state

These APIs already exist and are correct — no changes needed to them:

- `stream-formatter.ts` — `processLine(line, state)` returns `{ events: StreamEvent[]; nextState: FormatterState }`. `flushState`, `initialState`, `serializeEvent` all exist.
- `output.ts` — exports `step`, `info`, `warn`, `error`, `success`, `header`, `spinner`, and `stream(iter: AsyncIterable<StreamEvent>)`.
- `loop.ts` — already uses the full stack correctly.

The three commands also already spawn Claude with `--output-format stream-json`. The only problem is their output handling: they manually parse chunks and write raw text/tool lines instead of routing through `stream-formatter.ts` and `output.ts`.

## Goal

All Claude-spawning commands produce identical visual output:

1. Header box (mode · branch · project path · PID)
2. Trace path info line (emitted once session ID is known)
3. Stream-formatted agent output (`▶▶▶ MAIN AGENT`, subagent blocks, tool lines)
4. Transition separator before interactive TUI handoff (for commands that resume interactively)

Commands that do not spawn Claude (`heartbeat`, `run-scenarios`) are out of scope — their step/spinner output is already consistent.

## Architecture

### One new export in `stream-formatter.ts`

Add `streamEvents(readable)` — an async generator that wraps the existing `processLine` / `flushState` functions:

```ts
export async function* streamEvents(
  readable: NodeJS.ReadableStream
): AsyncGenerator<StreamEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let state = initialState();
  for await (const line of rl) {
    const { events, nextState } = processLine(line, state);
    state = nextState;
    for (const e of events) yield e;
  }
  for (const e of flushState(state)) yield e;
}
```

`processLine`, `flushState`, and all existing logic are untouched. This is the only addition to `stream-formatter.ts`.

### No new files

`claude-runner.ts` is not needed. Each command owns its own spawn, header, and session ID capture — those differ per command. The only real duplication was the readline loop, which belongs naturally in `stream-formatter.ts` alongside `processLine` and `flushState`.

## Changes per file

### `stream-formatter.ts`
- Add `streamEvents(readable: NodeJS.ReadableStream): AsyncGenerator<StreamEvent>` export
- `readline` import already exists (used in the CLI entrypoint at the bottom of the file)

### `plan.ts`
Replace `runBrainstormKickoff()` (lines 48–83) with inline logic:
- `output.header({ mode: "plan", project: absPath, branch, pid: process.pid })`
- Spawn Claude with existing args (already uses `--output-format stream-json`)
- Intercept `session_id` from the JSON stream — it appears as a top-level `session_id` field on the first event that carries it; emit `output.info("trace: ~/.claude/projects/...")` immediately when captured
- `await output.stream(streamEvents(child.stdout))`
- `await output.step("━━━ Launching interactive session ━━━")`
- `spawnSync("claude", ["--resume", sessionId], { stdio: "inherit" })`

The session ID capture must happen concurrently with `streamEvents` since both consume from the same process. The session ID should be intercepted by tapping into the readline loop inside `streamEvents`, or by splitting the stream — the simplest approach is to capture the session ID inside `streamEvents` itself via a callback/ref passed in, or to peek at the first line before the generator yields.

### `new.ts`
Replace `runKickoffSession()` (lines 89–127) with the same pattern as `plan.ts`:
- `output.header({ mode: "new", project: targetPath, branch: "main", pid: process.pid })`
- Spawn Claude with existing args (already uses `--output-format stream-json`, prompt passed via `-p`)
- Capture `session_id` → emit trace info line
- `await output.stream(streamEvents(child.stdout))`
- `await output.step("━━━ Launching interactive session ━━━")`
- `spawnSync("claude", ["--resume", sessionId], { stdio: "inherit" })`

### `meditate-create.ts`
Replace `runMeditateCreateKickoff()` (lines 36–63) with the same pattern:
- `output.header({ mode: "meditate", project: absPath, branch, pid: process.pid })`
- Spawn Claude with existing args (already uses `--output-format stream-json`, prompt passed via `-p`)
- Capture `session_id` → emit trace info line
- `await output.stream(streamEvents(child.stdout))`
- `await output.step("━━━ Launching interactive session ━━━")`
- `spawnSync("claude", ["--resume", sessionId], { stdio: "inherit" })`

### `loop.ts`
Replace the inline `sessionStream()` async generator (lines 94–111) with `streamEvents(child.stdout)`:

```ts
// Before
async function* sessionStream(): AsyncGenerator<StreamEvent> { ... }
await output.stream(sessionStream());

// After
await output.stream(streamEvents(child.stdout));
```

The rest of the loop (iteration tracking, git push, stop detection, signal handling) is unchanged.

## Session ID and trace path

The `session_id` field appears as a top-level key on stream-json events (alongside `type`, `message`, etc.). It is present from the first event onward. The trace file path is constructed as:

```
~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl
```

Where `encoded-project-path` replaces each `/` separator with `-` (e.g. `/Users/josu/Documents/projects/ralph-cli` → `-Users-josu-Documents-projects-ralph-cli`).

The header box is rendered immediately at spawn time. The trace line is emitted as an `output.info()` line once the session ID is first seen — before any agent output.

## Header and output format

```
┌───────────────────────────────────────────────────────────────────────┐
│ plan  ·  main  ·  /Users/josu/Documents/projects/ralph-cli            │
│ PID 12630   ·  Ctrl+C or: kill 12630                                  │
└───────────────────────────────────────────────────────────────────────┘
◆ trace: ~/.claude/projects/-Users-josu-Documents-projects-ralph-cli/abc123.jsonl
▶▶▶ MAIN AGENT
I'll study the project structure first.
◈ ctx: 41,513 tokens
→ [tool] ToolSearch
→ [glob] docs/superpowers/specs/*.md
▶ SUBAGENT: Study source files
  → [tool] ctx_batch_execute
◀ SUBAGENT
◀◀◀ MAIN AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
*(interactive TUI takes over)*

## What does not change

- `stream-formatter.ts` internals (`processLine`, `flushState`, `initialState`, `serializeEvent`, state types)
- `output.ts` — no changes
- `heartbeat.ts`, `run-scenarios.ts`, `meditate.ts` — out of scope

## Output comparison

**Before (`plan`):**
```
❯ Starting brainstorm session in /Users/josu/Documents/projects/ralph-cli...
❯ Brainstorming in progress — this may take a moment...
→ [tool] ToolSearch
→ [tool] Glob
→ [tool] Agent
I've studied the project — here's what I found...
→ [tool] Skill
```

**After (`plan`):**
```
┌───────────────────────────────────────────────────────────────────────┐
│ plan  ·  main  ·  /Users/josu/Documents/projects/ralph-cli            │
│ PID 12630   ·  Ctrl+C or: kill 12630                                  │
└───────────────────────────────────────────────────────────────────────┘
◆ trace: ~/.claude/projects/-Users-josu-.../abc123.jsonl
▶▶▶ MAIN AGENT
I'll study the project structure first.
◈ ctx: 41,513 tokens
→ [tool] ToolSearch
→ [glob] docs/superpowers/specs/*.md
▶ SUBAGENT: Study source files
  → [tool] ctx_batch_execute
◀ SUBAGENT
◀◀◀ MAIN AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
