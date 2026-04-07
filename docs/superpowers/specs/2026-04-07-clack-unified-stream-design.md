# Clack-Unified Stream Output Design

## Problem

`loop.ts` uses `@clack/prompts` for lifecycle markers (`intro`, `log.step`, `spinner`, `outro`, `note`) but routes stream-formatter output via raw `process.stdout.write()`. These are two separate render layers — clack writes styled lines with `│` gutters, and the formatter output falls outside that frame. The result is visually inconsistent: the PID line has a clack symbol, then the Claude session output drops to raw text.

## Goal

Route all Claude session output through a single clack stream per loop iteration, so the `│` gutter frames the entire session uniformly. Simplify block markers to use `▶`/`◀` open/close pairs instead of ASCII box-drawing.

## Non-Goals

- Changing `stream-formatter.ts` return types (still returns strings synchronously)
- Concurrent stream calls or per-block clack transitions
- Changing any other command (plan, meditate, heartbeat)

## Dependencies

`@clack/prompts` v1.2.0 (already installed) exports `stream`. Confirmed via runtime check — `'stream' in require('@clack/prompts') === true`.

---

## Architecture

One `await stream.message(generator)` call wraps the entire Claude session per loop iteration. The async generator replaces the current `readline → processLine → stdout.write` loop in `loop.ts`. `stream-formatter.ts` gains open/close block markers. No other files change.

```
loop.ts
  intro(...)
  log.step(PID)

  while (iteration < max):
    spawn claude
    await stream.message(sessionStream(child, state))  ← one call per iteration
    spinner → git push
    note(LOOP N)

  outro(...)
```

---

## Output Format

```
┌  ralph implement  |  branch: main  |  prompt: PROMPT_build.md
│
◇  PID: 54021  (Ctrl+C or: kill 54021)
│
│  ▶ MAIN AGENT
│  → [tool] ToolSearch
│  ◈ ctx: 15,740 tokens
│  Let me start by invoking the relevant skills.
│  ◈ ctx: 26,786 tokens
│  → [tool] Skill
│  ◀ MAIN AGENT
│  ▶ SUBAGENT: Study specs markdown files
│  → [read] specs/README.md
│  → [read] specs/architecture.md
│  ◀ SUBAGENT
│  ▶ MAIN AGENT
│  → [tool] Agent
│  ◀ MAIN AGENT
│  ▶ SUBAGENT: Investigate breaking changes
│  → [bash] npm test
│  12 tests passed
│  ◀ SUBAGENT
│  ▶ MAIN AGENT
│  ◈ ctx: 31,000 tokens
│  Based on the findings, here is my plan.
│  ◀ MAIN AGENT
│
◇  git push done
│
◆  LOOP 1
│
```

Key rules:
- `▶ MAIN AGENT` opens when the first substantive main agent event arrives
- `◀ MAIN AGENT` closes immediately before each `▶ SUBAGENT:` opens
- `◀ SUBAGENT` closes the subagent block, followed immediately by `▶ MAIN AGENT` to reopen
- `◈ ctx:` lines appear inside the main agent block (unchanged behavior — only printed when total increases)
- `flushState` closes whatever block is open at stream end

---

## Changes

### `loop.ts`

Replace the readline + `stdout.write` section with an async generator passed to `stream.message()`:

```ts
import { stream } from "@clack/prompts";

async function* sessionStream(
  child: ChildProcess,
  promptFile: string
): AsyncGenerator<string> {
  const readStream = createReadStream(promptFile);
  readStream.pipe(child.stdin as NodeJS.WritableStream);

  const rl = readline.createInterface({
    input: child.stdout as NodeJS.ReadableStream,
    crlfDelay: Infinity,
  });

  let state = initialState();
  for await (const line of rl) {
    const { output, nextState } = processLine(line, state);
    state = nextState;
    if (output) yield output;
  }

  const flush = flushState(state);
  if (flush) yield flush;
}

// In runLoop, per iteration:
await stream.message(sessionStream(child, promptFile));
await exitPromise;
if (exitCode !== 0) {
  log.warn(`claude exited with code ${exitCode}`);
}
// then: spinner → git push, note(LOOP N)
```

`stream.message()` default symbol is gray `│` — no `symbol` option override is needed; the yielded content (`▶ MAIN AGENT`, `→ [tool]`, etc.) appears after the `│  ` prefix naturally.

Signal handling is unaffected — `SIGINT`/`SIGTERM` calls `killCurrent()` which kills the child process, closing its stdout, ending the readline, ending the generator cleanly. The `readline` import in `loop.ts` is retained.

### `stream-formatter.ts`

**State changes:**
- Remove `mainHeaderPrinted: boolean`
- Add `mainAgentOpen: boolean`

**Removed:**
- `HEADER` constant (`┌─ MAIN AGENT ──...`)
- `formatSubagentBlock()` function (box-drawing borders)

**Block transition logic:**

| Event | Condition | Output emitted |
|---|---|---|
| First substantive main agent content | `mainAgentOpen === false` | `▶ MAIN AGENT\n` |
| `Agent` tool_use detected | `mainAgentOpen === true` | `◀ MAIN AGENT\n▶ SUBAGENT: <desc>\n` |
| `Agent` tool_use detected | `mainAgentOpen === false` | `▶ SUBAGENT: <desc>\n` (edge case: subagent is the very first event) |
| `tool_result` closes subagent | always | `◀ SUBAGENT\n▶ MAIN AGENT\n` |
| `flushState` | `mainAgentOpen === true` | `◀ MAIN AGENT\n` |
| `flushState` | pending subagent in `subagentBuffers` (no tool_result fired) | buffered content from `subagentBuffers` + `◀ SUBAGENT\n` |

---

## Tests

**`stream-formatter.test.ts`:**
- Replace all assertions on `HEADER` (`┌─ MAIN AGENT`) with `▶ MAIN AGENT`
- Replace all assertions on `formatSubagentBlock` borders (`┌─ SUBAGENT`, `◀ ─`) with `▶ SUBAGENT: <desc>` / `◀ SUBAGENT`
- Add assertions: first main agent event sets `mainAgentOpen === true` and output starts with `▶ MAIN AGENT\n`
- Add assertions: `Agent` tool_use output is `◀ MAIN AGENT\n▶ SUBAGENT: <desc>\n`
- Add assertions: `Agent` tool_use as first event (no prior main agent) output is `▶ SUBAGENT: <desc>\n` (no close marker)
- Add assertions: `tool_result` for subagent emits `◀ SUBAGENT\n▶ MAIN AGENT\n`
- Add assertions: `flushState` with `mainAgentOpen === true` emits `◀ MAIN AGENT\n`
- Add assertions: `flushState` with pending subagent in `subagentBuffers` emits buffered content + `◀ SUBAGENT\n`

**`loop.test.ts`:**
- Remove `process.stdout.write` spy
- Mock `stream.message` and assert it is called once per iteration with an `AsyncGenerator`
- Assert `log.warn` is called after `stream.message` resolves when exit code is non-zero

---

## Considered Alternatives

**Per-block clack calls** (`stream.step()` per transition): More colorful symbols per block type but requires a new awaited call per open/close event — complex coordination with the generator lifecycle. Rejected in favour of simplicity.

**`log.message()` per line**: Simple but clack adds a newline after each call, breaking multi-line subagent content. Rejected.
