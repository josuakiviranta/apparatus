# Design: Ink Unified Output Migration

**Date:** 2026-04-08
**Status:** Approved

## Overview

Migrate all ralph command output from a mix of Clack (`implement`), raw `console.log` (`plan`, `new`, `meditate`, `meditate-create`, `run-scenarios`, `heartbeat` subcommands) to a single unified Ink-based output system. All commands use helper functions from `output.ts`; Ink and React are implementation details hidden behind that API.

## Goals

- Consistent visual style across all commands
- Commands never import Ink or React directly
- Append-only output (no live-updating regions except spinners that commit on completion)
- Stream output (agent/subagent blocks) rendered through Ink's render cycle with colors
- Remove `@clack/prompts` dependency once migration is complete (defined below)

## Architecture

### 1. `src/cli/lib/output.ts` — Public API

The only file command code imports. Exports plain functions:

```ts
output.step(msg)                // ❯ msg              cyan prefix
output.info(msg)                // msg                dim, no prefix
output.warn(msg)                // ⚠ msg              yellow prefix
output.error(msg)               // ✖ msg              red prefix
output.success(msg)             // ✔ msg              green prefix
output.header(opts)             // bordered block     mode / project / branch? / pid?
output.spinner(label, fn)       // live spinner → commits result line on completion
output.stream(iter)             // renders an AsyncIterator<StreamEvent> (see below)
```

`step`, `info`, `warn`, `error`, `success`: each calls `render(<Component />)` once. These are infrequent one-shot calls so separate `render()` instances are fine.

`spinner(label, fn)`: renders a live `<Spinner>` component, awaits `fn()`, then unmounts and commits a `<Success>` or `<Warn>` line depending on outcome.

`stream(iter)`: handles high-frequency streaming. Creates **one** `render()` with a stateful `<StreamOutput>` component. The component consumes the `AsyncIterator<StreamEvent>` via `useEffect` and appends each event to a `<Static>` list. Unmounts when the iterator is exhausted. This avoids the per-event `render()` anti-pattern (each `render()` would create a new Ink app instance and corrupt stdout).

### 2. `src/cli/components/ui.tsx` — Shared Ink Components

Internal to `output.ts`. Commands never import these.

| Component | Ink rendering |
|---|---|
| `<Step text>` | `<Text color="cyan">❯ {text}</Text>` |
| `<Info text>` | `<Text dimColor>{text}</Text>` |
| `<Warn text>` | `<Text color="yellow">⚠ {text}</Text>` |
| `<Error text>` | `<Text color="red">✖ {text}</Text>` |
| `<Success text>` | `<Text color="green">✔ {text}</Text>` |
| `<Header opts>` | `<Box borderStyle="single">` with mode / optional branch / optional pid |
| `<Spinner label>` | `ink-spinner` animated, commits final state on stop |
| `<StreamLine event>` | Renders a `StreamEvent` (see below) |
| `<StreamOutput iter>` | Stateful component: consumes `AsyncIterator<StreamEvent>`, renders `<Static items={events}><StreamLine /></Static>` |

### 3. `src/cli/lib/stream-formatter.ts` — Structured Events

`processLine()` return type changes from `{ output: string }` to `{ events: StreamEvent[] }`.
`flushState()` return type changes from `string` to `StreamEvent[]`.

```ts
type StreamEvent =
  | { type: "main_agent_open" }
  | { type: "main_agent_close" }
  | { type: "subagent_open"; description: string }
  | { type: "subagent_close" }
  | { type: "text"; content: string; indented?: boolean }
  | { type: "tool"; name: string; label: string; indented?: boolean }
  | { type: "ctx"; tokens: number }
```

Note: `tool_result` content blocks received by the main agent directly (not subagent-wrapped) do not currently produce visible output in the stream-formatter — no additional event type is needed.

The standalone CLI path (when stream-formatter is executed directly as a pipe for debugging) serializes events back to plain text, preserving existing behavior.

#### `<StreamLine>` color scheme

| Event | Style |
|---|---|
| `main_agent_open` | bold cyan `▶▶▶ MAIN AGENT` |
| `main_agent_close` | cyan `◀◀◀ MAIN AGENT` |
| `subagent_open` | bold yellow `▶ SUBAGENT: {description}` |
| `subagent_close` | yellow `◀ SUBAGENT` |
| `text` | white (2-space indent if `indented`) |
| `tool` | dim `→ [{name}] {label}` |
| `ctx` | dim magenta `◈ ctx: {tokens} tokens` |

Open and close markers for the same block type share the same color (bold for open, normal weight for close).

### 4. `src/cli/lib/loop.ts` — Stream Rendering

`sessionStream()` becomes an `AsyncGenerator<StreamEvent>` (was `AsyncGenerator<string>`).

At end of each iteration:

```ts
// Was: await stream.message(sessionStream())
await output.stream(sessionStream());
// output.stream() internally: render(<StreamOutput iter={iter} />), await waitUntilExit()
```

`flushState()` trailing events are yielded as the final items from `sessionStream()` before the generator returns — no separate call site needed.

## Visual Output (implement example)

```
┌──────────────────────────────────────────────┐
│ implement  ·  main  ·  PROMPT_build.md       │
│ PID 1234   ·  Ctrl+C or: kill 1234           │
└──────────────────────────────────────────────┘

▶▶▶ MAIN AGENT                               ← bold cyan
Let me look at the failing tests first.
→ [read] src/cli/commands/implement.ts       ← dim
→ [edit] src/cli/commands/implement.ts       ← dim
Done. The fix is in place.
◈ ctx: 45,231 tokens                         ← dim magenta
◀◀◀ MAIN AGENT                               ← cyan

▶ SUBAGENT: check test output                ← bold yellow
  → [bash] npm test                          ← dim, indented
  Tests pass.                                ← indented
◀ SUBAGENT                                   ← yellow

✔ git push done                              ← green
❯ LOOP 1 ────────────────────────────────────
```

## Migration Map

### `implement` / `loop.ts` (Clack → output.ts)

| Before | After |
|---|---|
| `intro(...)` | `output.header({ mode: "implement", project, branch, pid })` |
| `log.step()` PID | removed — pid now in header |
| `log.warn()` claude exit | `output.warn()` |
| `spinner` git push | `output.spinner("git push...", fn)` |
| `log.warn()` git push fail | `output.warn()` |
| `note("LOOP N")` | `output.step("LOOP N ─────────")` |
| `outro("Stopped.")` | `output.info("Stopped.")` |
| `outro("Reached max iterations: N")` | `output.info("Reached max iterations: N")` |
| `cancel()` errors | `output.error()` + `process.exit(1)` |
| `stream.message(sessionStream())` | `output.stream(sessionStream())` |

### `plan` / `new` / `meditate-create` (console.log → output.ts)

| Before | After |
|---|---|
| `console.error(...)` | `output.error()` + `process.exit(1)` |
| `console.log(...)` status messages | `output.step()` |
| `process.stdout/stderr.write` streaming | unchanged (raw passthrough) |

### `meditate` (console.log → output.ts)

| Before | After |
|---|---|
| `━━━` border + mode/project/pid | `output.header({ mode: "meditate", project, pid })` — no branch |
| `console.log` already running | `output.info()` |
| `process.stderr.write` Warning | `output.warn()` |
| Streaming passthrough | unchanged |

### `run-scenarios` (partial migration)

`run-scenarios` uses `promptSelection()` (readline on stdin). Ink sets stdin to raw mode, which conflicts with readline. To avoid this:

- Pre-prompt output (scenario list) stays as `console.log` — no Ink before readline
- Post-selection output migrates to `output.ts`:

| Before | After |
|---|---|
| `console.error(...)` | `output.error()` + `process.exit(1)` |
| "No scenarios selected." | `output.info()` — called after prompt exits |
| "Running: X..." | `output.step()` — post-selection |
| "Done: path" | `output.success()` — post-selection |
| Scenario list (`console.log`) | unchanged — pre-prompt, before Ink |
| Streaming passthrough | unchanged |

Full migration of `run-scenarios` list output is deferred until `promptSelection()` is replaced with an Ink-native select component.

### `heartbeat` subcommands (console.log → output.ts)

| Before | After |
|---|---|
| `console.error(...)` | `output.error()` + `process.exit(1)` |
| `console.log` confirmations | `output.success()` |
| `formatTable()` | unchanged for now (plain console, migrate separately) |

**`heartbeat logs --follow`**: streams log lines at high frequency via a callback. Using `output.step()` per line would create one Ink instance per log line. This pattern is excluded from this migration — it stays as `console.log` and is deferred to a follow-up (same issue as `run-scenarios` prompts: needs a dedicated streaming render path).

### `heartbeat watch`

Unchanged — already Ink.

## "Migration Complete" Definition

The Clack dependency (`@clack/prompts`) can be removed when:
1. All imports of `@clack/prompts` are gone from `loop.ts`
2. No other file imports Clack
3. `npm run build` succeeds without it

## Dependencies

| Package | Type | Action |
|---|---|---|
| `ink` | runtime | already installed |
| `ink-spinner` | runtime | add |
| `ink-testing-library` | devDependency | add |
| `@clack/prompts` | runtime | remove after migration |

## Testing

- `output.ts`: unit tests using `ink-testing-library`'s `render()` for each helper function
- `stream-formatter.ts`: existing tests updated for `events: StreamEvent[]` return type
- `loop.ts`: existing tests updated for `AsyncGenerator<StreamEvent>` stream type
- Visual smoke test: run `ralph implement` on a test project and verify output
