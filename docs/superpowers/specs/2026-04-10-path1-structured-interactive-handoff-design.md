# Structured Interactive Handoff (Path 1.5)

- **Status:** Approved — all open questions resolved 2026-04-10; ready for implementation planning
- **Date:** 2026-04-10
- **Supersedes:** `memory/2026-04-13-interactive-pipeline-context-bug.md` (in-memory plan)
- **Related work (deferred):** Path 2 (fidelity=full + thread_id) — separate future spec; migration of `pipelines/illumination-to-plan.dot` to use the new interactive mechanism

---

## Section 1 — Overview & Scope

### Goal

Eliminate file-based conversation handoff between interactive pipeline nodes and downstream nodes by aligning `Outcome.contextUpdates` with the attractor spec's `Map<String, Any>`, spawning Claude Code CLI in a long-lived bidirectional stream-json process, and rendering the conversation via a host-owned Ink UI that keeps the full conversation history in ralph's memory.

### Primary user-visible outcome

A ralph-cli pipeline node can declare `interactive=true` and have its chat conversation flow as a structured digest into downstream nodes automatically — no file-based handoff via `meditations/.triage/chat-notes.md` or similar scratch files. The capability is validated end-to-end with a new dedicated smoke pipeline (`pipelines/smoke/chat-end-to-end.dot`). The existing `pipelines/illumination-to-plan.dot` is **intentionally left untouched** in this spec so it continues to serve as a regression baseline; its migration to the new mechanism is deferred to follow-up work.

### Supersedes (bug rollup from in-memory plan)

- **Bug A** (interactive prompt dropped in `agent.ts:146-180`) — *becomes moot* in Path 1.5 because `stdio: "inherit"` is replaced entirely with a bidirectional stream-json spawn.
- **Bug B.1** (`src/attractor/handlers/wait-human.ts:18` missing `expandVariables()` on label) — still needed; the handler must expand `${var}` references in its label text before rendering the human prompt.
- **Bug B.2** (`src/attractor/core/graph.ts` `parseAttrs()` doesn't unescape `\n`/`\t`/`\"`/`\\`) — still needed; DOT edge/node attributes containing escape sequences are currently parsed verbatim.
- **Option B** (`--append-system-prompt` for interactive mode) — still needed, used on the long-lived spawn so the node's prompt text is injected as an addendum to Claude's default system prompt.

### Non-goals (explicitly deferred)

- Path 2 (`fidelity`/`thread_id` for session continuation across nodes)
- Migrating legacy two-phase kickoff callers (`plan.ts`, `new.ts`, `meditate-create.ts`) to the new ChatUI — they stay on `stdio: "inherit"` per this spec
- `steer()` / `follow_up()` mid-turn injection (architecturally enabled but not wired)
- Tool-call permission flow (assumes pre-approved allowlist or `--dangerously-skip-permissions`)
- Paste, multi-line, IME, undo in TextInput
- Chat history persistence across pipeline runs beyond the digest
- Windows/WSL support
- Performance testing for long chat sessions

### Spec alignment

Brings ralph-cli back onto **attractor-spec.md** Sec 5.1–5.2 (`context_updates` typing) and **coding-agent-loop-spec.md** §1.2 (library-not-CLI principle), §2.1 (Session primitive), §2.3 (AWAITING_INPUT state), §2.9 (typed event iterator), §7.3 (SubAgentResult digest shape), §9.11 (graceful abort).

### References

- **Upstream attractor spec:** `/Users/josu/Documents/projects/attractor-specs/attractor-spec.md` — §5.1 Outcome, §5.2 Context merge, §5.4 Context Fidelity (deferred), §4.6 WaitForHumanHandler, §6 Interviewer protocol, §10.3 Preamble synthesis, §11.4 Goal gates
- **Upstream coding-agent-loop spec:** `/Users/josu/Documents/projects/attractor-specs/coding-agent-loop-spec.md` — §1.2 library principle, §1.3 event-driven interface, §2.1 Session, §2.3 AWAITING_INPUT, §2.4 AssistantTurn fields, §2.6 Steering, §2.8 stop conditions, §2.9 event iterator, §7.3 SubAgentResult, §9.1 multi-turn DoD, §9.11 graceful abort
- **Sibling specs** (not cited but in same directory): `unified-llm-spec.md`, `coding-agent-loop-spec.md`
- **Prior in-memory plan (superseded):** `memory/2026-04-13-interactive-pipeline-context-bug.md`
- **Claude Code CLI:** version 2.1.69; bidirectional stream-json confirmed working via smoke test

---

## Section 2 — Architecture & Data Flow

### Guiding principle

Ralph owns the Session. Claude Code CLI is a stateless turn executor invoked once per chat session. The full conversation history lives in ralph's memory as `Session.history: Turn[]`. The user interacts with ralph's Ink UI, which translates keystrokes into stream-json events on Claude's stdin and renders Claude's stream-json output events directly. No scratch file is touched.

This maps onto coding-agent-loop-spec §1.2 ("library, not a CLI"), §2.1 (Session with host-assigned UUID), §2.9 (event iterator), §7.3 (SubAgentResult handoff).

### High-level sequence

```
┌─────────────────────────────────────────────────────────────────┐
│  Pipeline engine reaches node with interactive=true              │
└───────────────────────────────────┬─────────────────────────────┘
                                    ▼
              ┌───────────────────────────────────────┐
              │ agent-handler.ts                       │
              │  1. crypto.randomUUID() → sessionId   │
              │  2. buildPreamble() + expandVariables │
              │  3. new Session(sessionId)            │
              │  4. agent.runInteractive({            │
              │       session,                        │
              │       systemPrompt: preamble+prompt,  │
              │       ...                             │
              │     })                                │
              └───────────────────┬───────────────────┘
                                  ▼
              ┌───────────────────────────────────────┐
              │ agent.ts — runInteractive()            │
              │  • spawn claude with:                 │
              │     -p                                │
              │     --input-format stream-json        │
              │     --output-format stream-json       │
              │     --verbose                         │
              │     --append-system-prompt <combined> │
              │     --session-id <uuid>               │
              │  • stdio: ["pipe", "pipe", "inherit"] │
              │  • returns ChildHandle {              │
              │      events, submit, end, kill        │
              │    }                                  │
              └───────────────────┬───────────────────┘
                                  ▼
              ┌───────────────────────────────────────┐
              │ ChatUI.tsx (Ink, parent renders)       │
              │  state:                               │
              │   • history: Turn[]                   │
              │   • currentAssistantText: string      │
              │   • inputBuffer: string               │
              │   • status: streaming|awaiting|ended  │
              │                                       │
              │  loop:                                │
              │   a. for await event of events$:      │
              │        update currentAssistantText,   │
              │        on `result` event → push       │
              │        AssistantTurn into history,    │
              │        transition → awaiting          │
              │   b. user types message, presses enter│
              │      → if slash cmd: dispatch locally │
              │      → else: push UserTurn to history,│
              │        write stream-json event to     │
              │        child.stdin                    │
              │   c. user types /end → stdin.end()    │
              │      → wait for child exit            │
              │      → Ink unmounts                   │
              └───────────────────┬───────────────────┘
                                  ▼
              ┌───────────────────────────────────────┐
              │ agent-handler.ts                       │
              │  5. Session.history is already        │
              │     populated — no parsing needed     │
              │  6. buildSessionDigest(session)       │
              │  7. flatten digest into contextUpdates│
              │     under <node_id>.* prefix          │
              │  8. return Outcome { status, ctx }    │
              └───────────────────┬───────────────────┘
                                  ▼
              ┌───────────────────────────────────────┐
              │ engine.ts                              │
              │  • merge contextUpdates into ctx      │
              │  • saveCheckpoint                     │
              │  • selectNextEdge → next node         │
              └───────────────────────────────────────┘
```

### Module boundaries

| Module | Status | Responsibility |
|---|---|---|
| `src/attractor/types.ts` | modified | Widen `Outcome.contextUpdates` value type from `string` to `unknown` |
| `src/attractor/core/checkpoint.ts` | modified | Accept `Map<string, unknown>` on serialize/deserialize round-trip |
| `src/attractor/core/preamble.ts` | modified | Coerce non-string values to string via `JSON.stringify` fallback when injecting into prompts |
| `src/attractor/core/variable-expansion.ts` | modified | Coerce non-string values to string when expanding `${var}` references |
| `src/attractor/core/engine.ts` | modified | Merge `unknown`-typed contextUpdates into ctx without string assumption |
| `src/attractor/core/conditions.ts` | modified | Compare unknown values via string coercion for equality/contains edge predicates |
| `src/attractor/core/graph.ts` | modified | **Bug B.2** — unescape `\n`, `\t`, `\"`, `\\` in `parseAttrs()` |
| `src/attractor/handlers/wait-human.ts` | modified | **Bug B.1** — call `expandVariables()` on label before rendering |
| `src/attractor/handlers/agent-handler.ts` | modified | Interactive branch: create Session, call `runInteractive`, render ChatUI, build digest, flatten to contextUpdates |
| `src/cli/lib/agent.ts` | modified | Add `runInteractive()` method returning `ChildHandle`; `run()` unchanged |
| `src/cli/lib/session.ts` | **new** | Session class, Turn union, ToolCall, Usage, ExitReason, InteractiveSessionDigest, `buildSessionDigest()` |
| `src/cli/lib/stream-json-input.ts` | **new** | `formatUserTurn(text)` → NDJSON line for stdin |
| `src/cli/lib/slash-commands.ts` | **new** | `parseSlashCommand()` discriminated union, HELP_TEXT constant |
| `src/cli/components/ChatUI.tsx` | **new** | Ink component: consumes events iterator, renders history, owns TextInput |
| `src/cli/components/TextInput.tsx` | **new** | Custom ~85-line Ink text input (no external package) |
| `pipelines/smoke/chat-only.dot` | **new** | Minimal single-node smoke pipeline for ChatUI isolation testing (Q3) |
| `pipelines/smoke/chat-end-to-end.dot` | **new** | Dedicated end-to-end smoke pipeline exercising success + recovery paths (Q4) |
| `pipelines/smoke/schemas/summary.json` | **new** | JSON schema consumed by the `summarize` node in chat-end-to-end |
| `pipelines/illumination-to-plan.dot` | **untouched** | Stays as regression baseline; migration deferred to follow-up spec (Q4) |

### Data shapes

```ts
// src/cli/lib/session.ts

export type Turn =
  | { role: "user"; text: string; at: number }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      usage?: Usage;
      stopReason?: "end_turn" | "turn_limit" | "abort" | "error";
      at: number;
    }
  | { role: "tool_result"; toolCallId: string; content: string; isError: boolean; at: number }
  | { role: "system"; text: string; at: number };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type ExitReason =
  | "user_end"      // /end
  | "abort"         // /abort or Ctrl-C
  | "turn_limit"    // Claude stop_reason
  | "child_crash"   // process exit != 0
  | "parse_error"   // malformed stream-json
  | "parent_killed"; // SIGTERM from outside

export class Session {
  readonly id: string;             // host-assigned UUID
  history: Turn[] = [];
  exitReason?: ExitReason;

  constructor(id: string) { this.id = id; }

  lastAssistantText(): string { /* … */ }
  turnsUsed(): number { /* count user turns */ }
  aggregateUsage(): Usage { /* sum across assistant turns */ }
  toolCallsSummary(): Array<{ name: string; count: number }> { /* … */ }
}

export interface InteractiveSessionDigest {
  output: string;                  // last assistant text (SubAgentResult-aligned)
  success: boolean;                // exitReason in {user_end, turn_limit}
  turnsUsed: number;
  sessionId: string;
  exitReason: ExitReason;
  transcriptPath: null;            // Path 1.5: no transcript file
  digest: {
    messageCount: number;
    usage: Usage;
    tools: Array<{ name: string; count: number }>;
  };
}

export function buildSessionDigest(session: Session): InteractiveSessionDigest {
  /* … */
}
```

```ts
// src/cli/lib/agent.ts (additions)

export interface ChildHandle {
  events: AsyncIterable<StreamJsonEvent>;
  submit(userText: string): Promise<void>;
  end(): Promise<void>;            // graceful: stdin.end(), await exit
  kill(signal?: NodeJS.Signals): Promise<void>; // hard: SIGTERM then 3s SIGKILL
  sessionId: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
```

### Flat-key flattening example

Given a node with `id="chat_session"` and a completed `InteractiveSessionDigest`, the handler returns:

```
chat_session.output         → "Here's the summary we agreed on..."
chat_session.success        → true
chat_session.turnsUsed      → 7
chat_session.sessionId      → "9c0a…-e4f1"
chat_session.exitReason     → "user_end"
chat_session.transcriptPath → null   // Path 1.5 omits transcript file
chat_session.digest         → { messageCount: 14, usage: {...}, tools: [...] }
```

These flow into `ctx` via `Outcome.contextUpdates`, where downstream nodes reference them as `${chat_session.output}` etc.

### Wire protocol

**stdin (one NDJSON line per user turn):**

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
```

**stdout events** (parsed line-by-line from `--output-format stream-json --verbose`):

- `system` — session initialization, model info
- `assistant` — partial/complete assistant messages (text + tool_use blocks)
- `user` — tool_result messages fed back by the loop
- `result` — end-of-turn marker with `stop_reason`, `usage`, final text

**Termination:** ChatUI calls `child.stdin.end()` on `/end`. Claude Code sees stdin close, completes current turn if any, exits 0.

### Slash commands v1

| Command | Behavior |
|---|---|
| `/end` | Graceful: `child.stdin.end()`, await exit, unmount Ink, digest built. `exitReason="user_end"`. Handler returns `status="success"`. |
| `/abort` | Hard: `child.kill("SIGTERM")`, 3s timeout then `SIGKILL`, unmount Ink. `exitReason="abort"`. Handler returns `status="failure"`. |
| `/help` | Local: render HELP_TEXT block inside ChatUI (no round-trip). No state change. |

### Ink component tree

```tsx
<ChatUI session={session} child={child} onExit={onExit}>
  <Static items={history}>
    {(turn) => <TurnView key={turn.at} turn={turn} />}
  </Static>
  <StreamingMessage text={currentAssistantText} visible={status === "streaming"} />
  <TextInput
    value={inputBuffer}
    onChange={setInputBuffer}
    onSubmit={handleSubmit}
    disabled={status !== "awaiting"}
    placeholder="Type a message, /help, or /end"
  />
  <StatusBar status={status} turnsUsed={session.turnsUsed()} usage={lastUsage} />
</ChatUI>
```

### Error handling taxonomy summary

The ChatUI and agent layer together recognize 18 distinct failure/edge conditions; these are enumerated in Section 4.1 with detection points, user-visible behavior, and resulting `exitReason` / `Outcome.status`.

### Spec compliance checklist

| Spec section | Path 1.5 implementation |
|---|---|
| coding-agent-loop §1.2 (library, not CLI) | CLI is subprocess; ralph owns Session object |
| coding-agent-loop §1.3 (event-driven) | `ChildHandle.events` is `AsyncIterable<StreamJsonEvent>` |
| coding-agent-loop §2.1 (Session, host UUID) | `crypto.randomUUID()` in handler; passed as `--session-id` |
| coding-agent-loop §2.3 (AWAITING_INPUT) | ChatUI `status` state machine: streaming → awaiting |
| coding-agent-loop §2.4 (AssistantTurn fields) | Turn union carries text, toolCalls, usage, stopReason |
| coding-agent-loop §2.6 (steering) | Deferred; architecturally enabled via `submit()` during streaming |
| coding-agent-loop §2.8 (stop conditions) | `end_turn`, `turn_limit`, `abort`, `error` mapped from stream-json `result` |
| coding-agent-loop §2.9 (typed event iterator) | `events: AsyncIterable<StreamJsonEvent>` |
| coding-agent-loop §7.3 (SubAgentResult digest) | `InteractiveSessionDigest` shape matches |
| coding-agent-loop §9.1 (multi-turn DoD) | Multi-turn verified in Smoke test 3 |
| coding-agent-loop §9.11 (graceful abort) | `/abort` path + 3s SIGKILL escalation |
| attractor-spec §5.1 Outcome | `contextUpdates: Map<string, unknown>` |
| attractor-spec §5.2 Context merge | Flat-key merge preserved; engine handles unknown |

### Backwards compatibility

- Non-interactive `agent.run()` unchanged.
- Legacy two-phase kickoff callers (`plan.ts`, `new.ts`, `meditate-create.ts`) stay on `stdio: "inherit"` per §1 decision.
- Checkpoints deserialize fine because `JSON.parse` already returns `unknown`-compatible values; the type widening merely removes an incorrect cast assertion.

### What this section deliberately does not address

Steering, `follow_up()`, checkpoint mid-chat resume, the TextInput package dependency question (resolved in §3.6 as "custom component").

---

## Section 3 — Components

### §3.1 `src/cli/lib/session.ts` (new)

**Responsibility:** Data model for an interactive Claude session and the digest function that converts it to a `SubAgentResult`-shaped record for downstream consumption.

**Exports:** `Session` class, `Turn` union, `ToolCall`, `Usage`, `ExitReason`, `InteractiveSessionDigest`, `buildSessionDigest()`.

**Non-responsibilities:** does not spawn processes, does not own Ink state, does not touch disk.

```ts
export class Session {
  readonly id: string;
  history: Turn[] = [];
  exitReason?: ExitReason;

  constructor(id: string) {
    this.id = id;
  }

  lastAssistantText(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const t = this.history[i];
      if (t.role === "assistant") return t.text;
    }
    return "";
  }

  turnsUsed(): number {
    return this.history.filter((t) => t.role === "user").length;
  }

  aggregateUsage(): Usage {
    const acc: Usage = { inputTokens: 0, outputTokens: 0 };
    for (const t of this.history) {
      if (t.role === "assistant" && t.usage) {
        acc.inputTokens += t.usage.inputTokens;
        acc.outputTokens += t.usage.outputTokens;
        acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + (t.usage.cacheReadTokens ?? 0);
        acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + (t.usage.cacheWriteTokens ?? 0);
      }
    }
    return acc;
  }

  toolCallsSummary(): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const t of this.history) {
      if (t.role === "assistant") {
        for (const tc of t.toolCalls) {
          counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts, ([name, count]) => ({ name, count }));
  }
}

export function buildSessionDigest(session: Session): InteractiveSessionDigest {
  return {
    output: session.lastAssistantText(),
    success: session.exitReason === "user_end" || session.exitReason === "turn_limit",
    turnsUsed: session.turnsUsed(),
    sessionId: session.id,
    exitReason: session.exitReason ?? "user_end",
    transcriptPath: null,
    digest: {
      messageCount: session.history.length,
      usage: session.aggregateUsage(),
      tools: session.toolCallsSummary(),
    },
  };
}
```

**Design decision (Option Q chosen):** `buildSessionDigest` is a standalone function rather than a `Session.toDigest()` method. This follows ralph-cli's existing convention of standalone `buildPreamble`, `buildScenarioPrompt`, `buildKickoffPrompt`, `buildHandlerMap` builder functions kept separate from their data classes. Rationale: easier to unit-test with mock sessions, easier to swap digest shapes later without class migrations, consistent with the rest of the codebase.

### §3.2 `src/cli/lib/slash-commands.ts` (new)

**Responsibility:** Parse user input lines into either a slash command dispatch or a regular message. Pure function, no side effects.

**Non-responsibilities:** does not execute commands, does not render help text (only exports the constant).

**v1 scope:** `/end`, `/abort`, `/help`. `/save` dropped from v1 — no persistent transcript in Path 1.5.

```ts
export type SlashCommand =
  | { kind: "end" }
  | { kind: "abort" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string }
  | { kind: "message"; text: string };

export function parseSlashCommand(input: string): SlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "message", text: input };
  const cmd = trimmed.slice(1).toLowerCase();
  if (cmd === "end") return { kind: "end" };
  if (cmd === "abort") return { kind: "abort" };
  if (cmd === "help") return { kind: "help" };
  return { kind: "unknown", raw: trimmed };
}

export const HELP_TEXT = `
Available commands:
  /end    Finish the chat gracefully. The full conversation will be
          summarized and passed to the next pipeline node.
  /abort  Abort the chat immediately. The pipeline will fail.
  /help   Show this message.

Type a regular message (no leading slash) to send it to Claude.
`.trim();
```

### §3.3 `src/cli/lib/stream-json-input.ts` (new)

**Responsibility:** Format a user text turn as a single NDJSON line suitable for Claude Code's `--input-format stream-json` stdin.

**Why its own file:** unit-testable in isolation; likely to need tweaking as Claude Code's input schema evolves.

```ts
export function formatUserTurn(text: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    }) + "\n"
  );
}
```

### §3.4 `src/cli/lib/agent.ts` (modified)

**Design decision (Option X — two methods — chosen):**

The existing `Agent.run()` stays exactly as it is. A new `Agent.runInteractive()` method is added alongside, returning a `ChildHandle` object. Zero caller churn for the non-interactive path.

**New signature:**

```ts
class Agent {
  run(options: RunOptions): Promise<RunResult> { /* unchanged */ }

  runInteractive(options: RunInteractiveOptions): ChildHandle {
    // spawn claude with:
    //   -p
    //   --input-format stream-json
    //   --output-format stream-json
    //   --verbose
    //   --append-system-prompt <combined>
    //   --session-id <options.session.id>
    // stdio: ["pipe", "pipe", "inherit"]
    // wire stdout → line splitter → JSON.parse → AsyncIterable events
    // wire submit() → formatUserTurn → stdin.write
    // wire end() → stdin.end + await exit
    // wire kill() → SIGTERM with 3s SIGKILL escalation
    // populate session.history as events flow (shared reference)
    return { events, submit, end, kill, sessionId, exited };
  }
}

export interface RunInteractiveOptions {
  session: Session;
  systemPrompt: string;            // combined preamble + node prompt
  cwd: string;
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
  abortSignal?: AbortSignal;
}
```

**Why Option X wins:**

1. **Zero caller churn.** Every existing caller of `Agent.run()` works unchanged.
2. **Spec alignment.** `runInteractive` hands out a Session-shaped handle directly; `run` stays as the one-shot turn helper.
3. **Testability.** Two methods = two small contracts to mock. A unified method with a mode flag would force every test to deal with both paths.
4. **Shared logic.** Both methods internally call the same private `buildArgs()` and `resolveBinary()` helpers.

### §3.5 Existing `streamEvents()` in `src/cli/lib/stream-formatter.ts`

**No changes.** The existing helper that parses Claude's stream-json output into typed events is reused by `runInteractive`. Path 1.5 does not introduce a second parser.

### §3.6 `src/cli/components/TextInput.tsx` (new)

**Design decision:** Custom implementation, ~85 lines, chosen over the `ink-text-input` package.

**Justification:**

- `ink-text-input@6.0.0` is 2 years stale.
- Its peer dependency targets Ink 5.x; ralph-cli is on Ink 6.8.0.
- We already have a working `useInput` pattern in `HeartbeatWatch.tsx`.
- An 85-line custom component costs less than debugging a peer-dep mismatch.

```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  focus?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "",
  focus = true,
}: Props) {
  const [cursor, setCursor] = useState(value.length);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        onSubmit(value);
        setCursor(0);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          const next = value.slice(0, cursor - 1) + value.slice(cursor);
          onChange(next);
          setCursor(cursor - 1);
        }
        return;
      }
      if (key.leftArrow) {
        setCursor(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, cursor + 1));
        return;
      }
      if (key.ctrl && input === "a") { setCursor(0); return; }
      if (key.ctrl && input === "e") { setCursor(value.length); return; }

      // Printable
      if (input && !key.ctrl && !key.meta) {
        const next = value.slice(0, cursor) + input + value.slice(cursor);
        onChange(next);
        setCursor(cursor + input.length);
      }
    },
    { isActive: focus && !disabled },
  );

  if (value.length === 0 && placeholder) {
    return (
      <Box>
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </Box>
  );
}
```

### §3.7 `src/cli/components/ChatUI.tsx` (new)

**Responsibility:** Render the interactive chat, consume the child's event stream, translate user input into stdin writes, manage the status state machine, and resolve a promise when the session ends.

```tsx
import React, { useEffect, useState, useCallback } from "react";
import { Box, Static, Text } from "ink";
import type { Session, Turn, Usage } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";
import { parseSlashCommand, HELP_TEXT } from "../lib/slash-commands.js";
import { TextInput } from "./TextInput.js";

type Status = "streaming" | "awaiting" | "ended";

interface Props {
  session: Session;
  child: ChildHandle;
  onExit: (reason: Session["exitReason"]) => void;
}

export function ChatUI({ session, child, onExit }: Props) {
  const [history, setHistory] = useState<Turn[]>(session.history);
  const [streamingText, setStreamingText] = useState("");
  const [inputBuffer, setInputBuffer] = useState("");
  const [status, setStatus] = useState<Status>("streaming");
  const [lastUsage, setLastUsage] = useState<Usage | undefined>();

  // Consume events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for await (const ev of child.events) {
        if (cancelled) break;
        if (ev.type === "assistant_delta") {
          setStreamingText((s) => s + ev.textDelta);
        } else if (ev.type === "result") {
          setHistory([...session.history]);
          setStreamingText("");
          setLastUsage(ev.usage);
          if (ev.stopReason === "turn_limit") {
            setStatus("ended");
            session.exitReason = "turn_limit";
            onExit("turn_limit");
          } else {
            setStatus("awaiting");
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // SIGINT — node-scoped
  useEffect(() => {
    const handler = () => {
      session.exitReason = "abort";
      child.kill("SIGTERM").finally(() => onExit("abort"));
    };
    process.once("SIGINT", handler);
    return () => { process.removeListener("SIGINT", handler); };
  }, [child, session, onExit]);

  const handleSubmit = useCallback(
    async (raw: string) => {
      const parsed = parseSlashCommand(raw);
      setInputBuffer("");

      if (parsed.kind === "help") {
        session.history.push({ role: "system", text: HELP_TEXT, at: Date.now() });
        setHistory([...session.history]);
        return;
      }
      if (parsed.kind === "unknown") {
        session.history.push({
          role: "system",
          text: `Unknown command: ${parsed.raw}. Type /help.`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        return;
      }
      if (parsed.kind === "end") {
        setStatus("ended");
        session.exitReason = "user_end";
        await child.end();
        onExit("user_end");
        return;
      }
      if (parsed.kind === "abort") {
        setStatus("ended");
        session.exitReason = "abort";
        await child.kill("SIGTERM");
        onExit("abort");
        return;
      }
      // regular message
      if (parsed.text.trim().length === 0) return;
      session.history.push({ role: "user", text: parsed.text, at: Date.now() });
      setHistory([...session.history]);
      setStatus("streaming");
      try {
        await child.submit(parsed.text);
      } catch (err) {
        session.history.push({
          role: "system",
          text: `Failed to send: ${(err as Error).message}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
      }
    },
    [child, session, onExit],
  );

  return (
    <Box flexDirection="column">
      <Static items={history}>
        {(turn, i) => <TurnView key={i} turn={turn} />}
      </Static>
      {status === "streaming" && streamingText ? (
        <Box marginTop={1}>
          <Text color="cyan">{streamingText}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{"> "}</Text>
        <TextInput
          value={inputBuffer}
          onChange={setInputBuffer}
          onSubmit={handleSubmit}
          disabled={status !== "awaiting"}
          placeholder="Type a message, /help, or /end"
        />
      </Box>
      <StatusBar status={status} turnsUsed={session.turnsUsed()} usage={lastUsage} />
    </Box>
  );
}

function TurnView({ turn }: { turn: Turn }) { /* render per role */ return null as any; }
function StatusBar({ status, turnsUsed, usage }: {
  status: Status; turnsUsed: number; usage?: Usage;
}) { return null as any; }
```

### §3.8 Modified `src/attractor/handlers/agent-handler.ts`

**New interactive branch** (pseudocode sketch):

```ts
async function handleAgentNode(node, ctx, deps): Promise<Outcome> {
  const prompt = expandVariables(node.prompt, ctx);
  const preamble = buildPreamble(node, ctx);
  const systemPrompt = `${preamble}\n\n${prompt}`;

  if (!node.interactive) {
    // existing non-interactive path
    return runNonInteractive(/* … */);
  }

  // --- Path 1.5 interactive branch ---
  const sessionId = crypto.randomUUID();
  const session = new Session(sessionId);

  const child = deps.agent.runInteractive({
    session,
    systemPrompt,
    cwd: deps.cwd,
    allowedTools: node.allowedTools,
    dangerouslySkipPermissions: node.dangerouslySkipPermissions,
  });

  // Render ChatUI and wait for it to resolve
  const exitReason = await new Promise<ExitReason>((resolve) => {
    const { unmount } = render(
      <ChatUI session={session} child={child} onExit={resolve} />,
    );
    child.exited.finally(() => unmount());
  });

  // Ensure process is gone
  await child.exited.catch(() => {});

  // Build digest and flatten into contextUpdates
  const digest = buildSessionDigest(session);
  const contextUpdates = new Map<string, unknown>();
  const prefix = node.id;
  contextUpdates.set(`${prefix}.output`, digest.output);
  contextUpdates.set(`${prefix}.success`, digest.success);
  contextUpdates.set(`${prefix}.turnsUsed`, digest.turnsUsed);
  contextUpdates.set(`${prefix}.sessionId`, digest.sessionId);
  contextUpdates.set(`${prefix}.exitReason`, digest.exitReason);
  contextUpdates.set(`${prefix}.transcriptPath`, digest.transcriptPath);
  contextUpdates.set(`${prefix}.digest`, digest.digest);

  return {
    status: digest.success ? "success" : "failure",
    contextUpdates,
  };
}
```

### §3.9 Type widening (mechanical)

| # | File | Change |
|---|---|---|
| 1 | `src/attractor/types.ts` | `contextUpdates?: Map<string, string>` → `contextUpdates?: Map<string, unknown>` |
| 2 | `src/attractor/core/checkpoint.ts` | `Map<string, string>` → `Map<string, unknown>` on serialize/deserialize |
| 3 | `src/attractor/core/preamble.ts` | When injecting `${var}` values, coerce: `typeof v === "string" ? v : JSON.stringify(v)` |
| 4 | `src/attractor/core/variable-expansion.ts` | Same coercion rule in `expandVariables()` |
| 5 | `src/attractor/core/engine.ts` | `ctx.set(k, v)` now takes `unknown` value; no cast |
| 6 | `src/attractor/core/conditions.ts` | Equality/contains compare via `String(v)` coercion |

### §3.10 Bug rollups

**Bug B.1 — `src/attractor/handlers/wait-human.ts:18`:**

```ts
// Before
const label = node.label;

// After
const label = expandVariables(node.label ?? "", ctx);
```

**Bug B.2 — `src/attractor/core/graph.ts` `parseAttrs()`:**

```ts
function unescapeAttr(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// In parseAttrs(): after stripping surrounding quotes
value = unescapeAttr(value);
```

**Scoping constraint:** `unescapeAttr()` must ONLY run on values that were surrounded by quotes in the DOT source. Unquoted identifiers (`kind=agent`, `weight=5`) must pass through untouched — DOT grammar does not support escape sequences in unquoted values, and running the replacer on them could corrupt identifiers that happen to contain backslashes. The planner must confirm `parseAttrs()` tracks the quoted-vs-unquoted distinction at the point of call.

### Component dependency graph

```
agent-handler.ts
├── Session, buildSessionDigest        (session.ts)
├── Agent.runInteractive               (agent.ts)
│   └── streamEvents                   (stream-formatter.ts, existing)
└── render(<ChatUI>)                   (ChatUI.tsx)
    ├── TextInput                      (TextInput.tsx)
    ├── parseSlashCommand, HELP_TEXT   (slash-commands.ts)
    └── formatUserTurn (via child.submit) (stream-json-input.ts)
```

---

## Section 4 — Error handling & edge cases

### §4.1 Failure taxonomy

| # | Condition | Detection | User-visible behavior | Session.exitReason | Outcome.status |
|---|---|---|---|---|---|
| 1 | `/end` | parseSlashCommand → kind=end | Input cleared, status→ended, stdin closed, "Session ended" notice | `user_end` | `success` |
| 2 | `/abort` | parseSlashCommand → kind=abort | "Aborting…", SIGTERM sent, Ink unmounts | `abort` | `failure` |
| 3 | Ctrl-C | process SIGINT handler | Same as /abort | `abort` | `failure` |
| 4 | `result.stopReason === "turn_limit"` | events loop | System notice "Turn limit reached. Type /end.", TextInput disabled | `turn_limit` | `success` |
| 5 | Child crash (exit ≠ 0 before /end) | `child.exited` resolves early | System notice with exit code, Ink unmounts | `child_crash` | `failure` |
| 6 | Child hang (no `result` in N seconds) | (v1: not detected; user must /abort) | — | — | — |
| 7 | Stream-json parse error | JSON.parse throws in line splitter | System notice with raw line, keep session alive | `parse_error` (if terminal) | `failure` only if no recovery |
| 8 | `stdin.write` EPIPE | write throws | System notice, status→ended, treat as abort | `abort` | `failure` |
| 9 | Empty submit (whitespace only) | handleSubmit early return | No-op, input cleared | — | — |
| 10 | Typing during streaming | TextInput disabled prop | Keystrokes ignored | — | — |
| 11 | Rapid sequential submits | submit rejects when status !== awaiting | Second submit is a no-op | — | — |
| 12 | Tool call permission prompt | (v1: not handled; assumes pre-approved allowlist) | — | — | — |
| 13 | Parent process killed (SIGTERM from outside) | process signal | Ink unmount attempt, child killed | `parent_killed` | `failure` |
| 14 | Checkpoint save failure (after node) | engine catches | Engine error path (unchanged) | — | propagated |
| 15 | AbortSignal from caller | signal.aborted | child.kill("SIGTERM"), unmount | `abort` | `failure` |
| 16 | Terminal resize | Ink handles via its reflow | Repaint; no state change | — | — |
| 17 | Non-TTY stdin (e.g., piped) | process.stdin.isTTY false at mount | System notice "Interactive mode requires a TTY", fail fast | `parent_killed` | `failure` |
| 18 | Concurrent interactive nodes | (v1: not supported; engine is single-node) | — | — | — |

### §4.2 Resource cleanup contract

Every exit path from the interactive branch must run these six steps in order:

1. Close stdin via `child.stdin.end()` (idempotent).
2. Wait for child exit, or force-kill with 3-second SIGKILL timeout.
3. Unsubscribe the node-scoped SIGINT handler.
4. Unmount the Ink render.
5. Restore terminal state (Ink does this on unmount).
6. Persist via engine checkpoint (done by engine after handler returns).

```ts
try {
  // … run ChatUI, await exit reason …
} finally {
  try { await child.kill("SIGTERM"); } catch {}
  process.removeListener("SIGINT", sigintHandler);
  unmount();
}
```

### §4.3 SIGINT propagation rules (Q1 resolved: **node-only** with double-SIGINT escalation)

**Decision:** Ctrl-C inside ChatUI aborts only the current interactive node. The pipeline engine continues via normal failure-routing semantics. A second Ctrl-C during teardown escalates to a full process kill via Node's default handler.

**Rules:**

- ChatUI takes SIGINT ownership for its lifetime via `process.once("SIGINT", handler)`.
- First Ctrl-C: handler sets `exitReason="abort"`, calls `child.kill("SIGTERM")`, resolves the ChatUI promise with `exitReason="abort"`. Handler returns `Outcome { status: "fail", failureReason: "Interactive session aborted by user", contextUpdates: <partial digest> }`.
- Engine loop at `src/attractor/core/engine.ts:222–231` catches `status="fail"` and calls `selectNextEdge(node, outcome, context, edges)` (the same code path used for every other handler failure — no new logic required).
- Edge selection priority (existing engine behavior, `engine.ts:54–91`):
  1. Outgoing edge with `condition="outcome=fail"` — follow it (pipeline continues on the recovery branch).
  2. `node.retry_target` / `node.fallback_retry_target`.
  3. Highest-weight unconditional edge.
  4. Lexical tiebreak.
  5. If **no** outgoing edge applies, the engine returns `{ status: "fail", ... }` at line 231 and the pipeline terminates with a clear failure reason — not a silent continuation.
- ChatUI does **not** re-propagate SIGINT — the engine owns the "what happens next" decision.
- A second Ctrl-C while ChatUI is tearing down falls through to Node.js's default SIGINT handler (kill entire process tree). This is the user's "try harder" escape hatch.
- Engine SIGINT handling: the engine registers its own SIGINT handler at pipeline start. On node entry, the engine's handler must be deregistered before `process.once("SIGINT", chatUiHandler)` so ChatUI owns the signal for its lifetime. On node exit (finally block), ChatUI's handler is removed and the engine re-registers its own. A second Ctrl-C during the brief gap falls through to Node default — acceptable because the gap is microseconds.
- Partial `contextUpdates` captured before the abort ARE preserved in the `failure` Outcome, so a recovery node reached via the `outcome=fail` edge can read `${chat_session.output}` (whatever was produced) and handle gracefully.

### §4.4 Turn limit behavior (Q2 resolved: **no default** for interactive nodes)

**Decision:** Interactive chat nodes have **no default turn limit**. Context-window exhaustion (surfaced by Claude CLI as `result.stop_reason === "turn_limit"` or similar) will always reach the user long before any arbitrary turn cap would fire, so a default limit is dead code that complicates reasoning for zero benefit.

**Rules:**

- **Node-level** `maxIterations` is **not set by default** for interactive nodes. A pipeline author MAY still opt in via DOT attribute `max_iterations=N` on the node if they want a hard cap (e.g., for adversarial scenarios or automated test harnesses), but ralph-cli supplies no implicit value.
- **Claude-level** `result.stop_reason === "turn_limit"` IS still handled: ChatUI posts a system notice ("Turn limit reached. Type /end to finish."), disables TextInput, and waits for the user to `/end`. This path is exit reason `turn_limit` → `Outcome.status="success"` (graceful — the chat completed, just not on user initiative).
- Non-interactive nodes are unaffected — their existing `maxIterations` semantics carry over unchanged.

### §4.5 Empty-history edge case

If the user types `/end` immediately without sending any messages:

- `session.history` contains only `system` turns (if any).
- Digest: `output = ""`, `turnsUsed = 0`, `success = true`, `exitReason = "user_end"`.
- Downstream nodes can route on `${chat_session.turnsUsed > 0}` to distinguish.

### §4.6 Checkpoint behavior (Q5 resolved: **digest only**, no full Session.history)

**Decision:** Checkpoints store only the flattened `InteractiveSessionDigest` keys (e.g., `chat_session.output`, `.success`, `.turnsUsed`, `.sessionId`, `.exitReason`, `.digest`). The full `Session.history` array is **discarded** at node completion. Mid-conversation resume of an interactive node is explicitly **out of scope** for Path 1.5.

**Justification:**

- **Attractor-spec §5.3** explicitly states "in-memory LLM sessions cannot be serialized… degrade to summary:high for the first resumed node." The digest *is* the summary:high degradation.
- **coding-agent-loop-spec §7.3** defines `SubAgentResult` as opaque (`output`, `success`, `turns_used` only) — the host never receives or stores full history. Our digest mirrors this shape by design.
- **Size efficiency:** digest ~1–3 KB vs full history 40–150 KB per session. Over 10 runs, saves 400–1500 KB of checkpoint bloat for zero functional gain.
- **Simplicity:** `CheckpointState.context: Record<string, unknown>` stays flat; no nested Session objects crossing the JSON boundary.

**Resume semantics:**

- Interactive nodes checkpoint like non-interactive nodes: before node runs (`currentNode` set), after node completes (`contextUpdates` merged into context, node id added to `completedNodes`).
- `ralph pipeline resume` on a checkpoint whose last completed node was interactive: engine sees the node in `completedNodes`, **does not re-run it**, and advances to the next node via normal edge routing. Downstream nodes read `${chat_session.output}` etc. from restored context — no UI re-entry.
- If the crash happened **during** the interactive node (checkpoint was written before node entry but not after), resume re-runs the interactive node **from scratch** — the user re-enters the chat. There is no partial replay of previous turns.
- The flat-keyed context entries produced by a completed chat survive checkpoint round-trip via the `contextUpdates: Record<string, unknown>` widening (Section 3.9).

**Future-proofing:** If Path 2 later wants to add full `Session.history` persistence for true mid-conversation resume, the additive field is non-breaking — old digest-only checkpoints continue to parse, and resume code can detect `history` presence/absence and switch paths.

### §4.7 Known gaps

1. No tool-call permission flow (assumes allowlist or `--dangerously-skip-permissions`).
2. No mid-chat session resumption.
3. No paste support in TextInput.
4. Custom `TextInput` has no external package fallback — if it ships with a defect, the fix must land in `src/cli/components/TextInput.tsx` itself rather than by swapping to `ink-text-input` (intentional — external package was evaluated and rejected as stale; see §3.6).
5. No multi-chat concurrency (engine executes nodes sequentially).

---

## Section 5 — Testing strategy

### §5.1 Unit tests

| File | Cases |
|---|---|
| `src/cli/tests/session.test.ts` | `lastAssistantText` with empty/mixed history; `turnsUsed` counts user turns only; `aggregateUsage` sums across assistant turns and handles missing fields; `toolCallsSummary` groups and counts; `buildSessionDigest` on empty session, user-end, turn-limit, abort, child-crash, parse-error paths |
| `src/cli/tests/slash-commands.test.ts` | `/end`, `/abort`, `/help`, `/unknown`, plain message, leading/trailing whitespace, message starting with `/` but not a known command |
| `src/cli/tests/stream-json-input.test.ts` | `formatUserTurn` produces valid NDJSON; unicode; empty string; trailing newline present |
| `src/attractor/tests/preamble.test.ts` | Non-string context value coerced via `JSON.stringify`; object with toString; null/undefined handled |
| `src/attractor/tests/variable-expansion.test.ts` | `${foo.bar}` with object value coerced; boolean coercion; array coercion |
| `src/attractor/tests/conditions.test.ts` | Equality with non-string LHS; contains with mixed types |
| `src/attractor/tests/graph.test.ts` | **Bug B.2**: `parseAttrs()` unescapes `\n`, `\t`, `\"`, `\\`; does not mangle unescaped content |
| `src/attractor/tests/wait-human.test.ts` | **Bug B.1**: label with `${var}` expands against ctx before rendering |

### §5.2 Contract tests for `agent.runInteractive()`

**File:** `src/cli/tests/agent-interactive.test.ts`. Uses a fake child process (EventEmitter + mock stdin stream) to avoid spawning real Claude.

1. `buildArgs` includes `-p --input-format stream-json --output-format stream-json --verbose --append-system-prompt <prompt> --session-id <uuid>`.
2. `submit("hello")` writes exactly one NDJSON line to fake stdin.
3. Events iterator yields parsed assistant/result events from fake stdout.
4. `end()` calls stdin.end and resolves when child exit event fires.
5. `kill()` sends SIGTERM, then SIGKILL after 3s if still alive.
6. Multiple `submit()` calls in sequence produce distinct stdin lines.
7. `submit()` after `end()` rejects with clear error.
8. Malformed JSON line is reported as a parse error without crashing the iterator.

### §5.3 Component tests for ChatUI

**File:** `src/cli/tests/ChatUI.test.tsx`. Uses `ink-testing-library` with a fake ChildHandle.

1. Initial render: placeholder visible, status="streaming", empty history.
2. First `result` event arrives → history populated, status→awaiting, TextInput enabled.
3. User types "hi" + Enter → submit called, user turn in history, status→streaming.
4. `/end` → `child.end` called, onExit("user_end") fires.
5. `/help` → system turn with HELP_TEXT appended, no child interaction.
6. `/abort` → `child.kill("SIGTERM")`, onExit("abort").
7. Unknown `/foo` → system turn with "Unknown command", no child interaction.
8. Empty submit (whitespace only) → no-op.
9. SIGINT during awaiting → kill + onExit("abort").
10. Turn-limit result → status="ended", TextInput disabled, notice shown.
11. Stream parse error → notice in history, session stays alive.
12. Child crash (exited rejects) → onExit("child_crash").

### §5.4 TextInput component tests

**File:** `src/cli/tests/TextInput.test.tsx`.

1. Placeholder shown when value empty.
2. Value + cursor rendered with inverse block.
3. Character input appends and moves cursor.
4. Backspace deletes previous character.
5. Return calls `onSubmit` with current value.
6. Left/right arrows move cursor within bounds.
7. `disabled=true` ignores all keystrokes.
8. `focus=false` disables input handling.

### §5.5 Integration test at handler level

**File:** `src/attractor/tests/agent-handler-interactive.test.ts`. Uses a fake `Agent` that returns a controllable fake `ChildHandle`.

1. Node with `interactive=false` → existing path (regression).
2. Node with `interactive=true` → ChatUI rendered, Session created, digest flattened.
3. Preamble + prompt combined into `systemPrompt` argument.
4. Variable expansion applied to prompt before passing to agent.
5. `contextUpdates` contains `<node.id>.output`, `.success`, `.turnsUsed`, `.sessionId`, `.exitReason`, `.transcriptPath`, `.digest`.
6. Success path: `status="success"` when exit reason is `user_end`.
7. Abort path: `status="failure"` when exit reason is `abort`.
8. Turn-limit path: `status="success"` (graceful).
9. Child crash: `status="failure"`.
10. AbortSignal from caller: propagates to `child.kill`.

### §5.6 Regression tests for contextUpdates widening

**File:** `src/attractor/tests/context-widening.test.ts`.

1. Preamble injection coerces non-string values via `JSON.stringify`.
2. Variable expansion coerces non-string values.
3. Condition comparison works across mixed types.
4. Checkpoint save/load round-trip preserves non-string values.
5. Engine merge accepts `unknown` without type errors.

### §5.7 Real-usage smoke tests (`npm run build` first)

**THIS IS THE VERIFICATION-BEFORE-COMPLETION GATE.** Each smoke test below must pass manually. These are not automated — they require a human at the terminal driving the interactive UI.

#### Preconditions

**Important:** All smoke tests that reference pipeline files by relative path (`pipelines/smoke/...`) must be invoked with the ralph-cli repo root as the current working directory. JSON schema paths are resolved via `resolve(cwd, jsonSchemaFile)` in `src/attractor/handlers/agent-handler.ts:48`, so running from any other directory will fail schema loading.

```bash
cd /Users/josu/Documents/projects/ralph-cli
npm install
npm run build
npm link
which ralph
ralph --version
claude --version   # 2.1.69 or newer
```

#### Smoke test 1 — `npm test`

All unit, contract, and component tests from §5.1–§5.6 pass.

```bash
npm test
```

#### Smoke test 2 — Non-interactive regression

Legacy commands must be unchanged.

```bash
ralph <folder> plan           # stdio:inherit two-phase, unchanged
ralph <folder> implement --max 1
```

Expected: plan launches the interactive TUI as before; implement runs one iteration and exits cleanly.

#### Smoke test 3 — ChatUI standalone via minimal DOT (Q3 resolved: **minimal DOT**, not `ralph chat` command)

**Decision:** Validate ChatUI in isolation with a minimal dedicated pipeline file checked into the repo. No dev-only `ralph chat <folder>` command — that would be a parallel entry point that drifts from the real codepath.

Create `pipelines/smoke/chat-only.dot` (new file, checked into repo):

```
digraph chat_only {
  start [kind=entry];
  chat  [kind=agent, interactive=true, prompt="You are a helpful assistant. Introduce yourself in one sentence, then ask the user what they want to talk about."];
  done  [kind=exit];
  start -> chat;
  chat  -> done;
}
```

Run:

```bash
ralph pipeline run pipelines/smoke/chat-only.dot
```

**Manual checklist:**

- [ ] Ink ChatUI appears after pipeline banner
- [ ] Claude's introduction streams in visible chunks
- [ ] Status transitions to "awaiting" after stream completes
- [ ] TextInput accepts typed characters, shows cursor
- [ ] `/help` shows HELP_TEXT in-place
- [ ] Regular message round-trips (user → assistant)
- [ ] `/end` unmounts cleanly; terminal returns to normal
- [ ] Pipeline engine logs show `chat.output` contained the last assistant message
- [ ] Checkpoint file has flat-keyed entries (`chat.output`, `chat.success`, etc.)
- [ ] `ps aux | grep claude` shows no orphan process

#### Smoke test 4 — Abort paths

- **4a:** Run Smoke test 3, type `/abort`. Expected: SIGTERM delivered, Ink unmounts, `exitReason="abort"`, pipeline reports failure on the terminal branch (chat-only has no `outcome=fail` edge, so pipeline exits with failure).
- **4b:** Run Smoke test 3, press Ctrl-C once. Expected: ChatUI unmounts, pipeline fails, parent shell returns to prompt (no hang).
- **4b-2:** Run Smoke test 3, press Ctrl-C **twice in rapid succession**. Expected: double-SIGINT escalation fires Node's default handler, whole process tree is killed. Parent shell returns to prompt with non-zero exit.
- **4c (optional):** Child crash simulation — kill the `claude` subprocess from another terminal. Expected: ChatUI detects exit, reports `child_crash`, pipeline fails cleanly.
- **4d:** Node-only abort with recovery edge — use `pipelines/smoke/chat-end-to-end.dot` (Smoke test 5), type `/abort` during the chat. Expected: pipeline follows the `outcome=fail` edge to the recovery node and completes successfully.

#### Smoke test 5 — Dedicated end-to-end smoke pipeline (Q4 resolved: **new simple file**, `illumination-to-plan.dot` untouched)

**Decision:** Create a new minimal end-to-end smoke pipeline dedicated to this feature. Do **not** modify `pipelines/illumination-to-plan.dot` — it stays as-is so existing workflows and regression baselines are preserved. Migration of `illumination-to-plan.dot` to the new mechanism is deferred follow-up work.

Create `pipelines/smoke/chat-end-to-end.dot` (new file, checked into repo):

```
digraph chat_end_to_end {
  start [kind=entry];

  chat [
    kind=agent,
    interactive=true,
    prompt="You are helping the user capture one thing they learned today. Ask them one question, acknowledge their answer, then tell them you will summarize it for them."
  ];

  summarize [
    kind=agent,
    interactive=false,
    prompt="Summarize this chat into a single sentence. Input:\n\n${chat.output}",
    json_schema_file="pipelines/smoke/schemas/summary.json"
  ];

  recovery [
    kind=agent,
    interactive=false,
    prompt="The interactive chat was aborted. Write a one-line note saying the user aborted early. Partial output (may be empty): ${chat.output}"
  ];

  done [kind=exit];

  start     -> chat;
  chat      -> summarize [condition="outcome=success"];
  chat      -> recovery  [condition="outcome=fail"];
  summarize -> done;
  recovery  -> done;
}
```

Create `pipelines/smoke/schemas/summary.json`:

```json
{
  "type": "object",
  "required": ["summary"],
  "properties": {
    "summary": { "type": "string" }
  }
}
```

Run:

```bash
ralph pipeline run pipelines/smoke/chat-end-to-end.dot
```

**Manual checklist — success path:**

1. [ ] Pipeline enters `chat` node, ChatUI appears.
2. [ ] Claude asks the user a question.
3. [ ] User answers, gets acknowledgement, types `/end`.
4. [ ] Ink unmounts cleanly.
5. [ ] Pipeline advances to `summarize` (non-interactive).
6. [ ] `summarize` produces a JSON object matching the schema, populated with content derived from `${chat.output}`.
7. [ ] Pipeline reaches `done` with `status=success`.
8. [ ] **Verify** `meditations/.triage/chat-notes.md` and any other scratch files do **not** exist at any point during the run.
9. [ ] Checkpoint file contains `chat.output`, `chat.success=true`, `chat.exitReason=user_end`, `chat.turnsUsed>0`, `summarize.structured_output.summary`.

**Manual checklist — failure path (reused by Smoke test 4d):**

1. [ ] Re-run the same pipeline, type `/abort` during the chat.
2. [ ] Pipeline follows the `outcome=fail` edge to `recovery`.
3. [ ] `recovery` node completes, writes its note.
4. [ ] Pipeline reaches `done` with overall `status=success` (because recovery succeeded).
5. [ ] Checkpoint contains `chat.success=false`, `chat.exitReason=abort`, partial `chat.output` (whatever Claude produced before the abort).

#### Smoke test 6 — Checkpoint resume

Uses `pipelines/smoke/chat-end-to-end.dot`. Validates Q5 (digest-only checkpoint resume semantics).

1. Start `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`.
2. Complete `chat` with `/end` (success path).
3. While `summarize` is running, press Ctrl-C at the shell level (i.e., between nodes, not inside ChatUI — simulate a crash).
4. Run `ralph pipeline resume`.
5. Verify the resume:
   - [ ] Does **not** re-launch ChatUI (interactive node already in `completedNodes`).
   - [ ] Picks up at `summarize` with `${chat.output}` still populated from the restored context.
   - [ ] Reaches `done` successfully.
6. Verify by inspecting the checkpoint file that `chat.output`, `chat.success`, `chat.exitReason`, and `chat.turnsUsed` are flat-keyed strings/primitives — **not** a nested `Session.history` array.

### §5.8 Smoke test failure handling

Each smoke test failure is a blocker until fixed. The spec is **not** complete until tests 1, 2, 3, 4a, 4b, 4b-2, 4d, 5 (both success and failure paths), and 6 all pass. Smoke test 4c is optional.

### §5.9 Not tested

- Claude Code internals (we rely on its stream-json contract as-shipped).
- Terminal emulator quirks (iTerm2, Alacritty, tmux, etc. — spot-checked on one).
- Long-chat performance (100+ turns, large history rendering).
- Cross-platform Windows/WSL.

---

## Section 6 — Rollout / migration order

Implementation sequencing is chosen so that (a) each phase is independently verifiable, (b) the legacy non-interactive path never breaks, and (c) the new interactive path becomes usable end-to-end only once all its dependencies are in place.

### §6.1 Phase sequence

| Phase | Scope | Dependencies | Verification |
|---|---|---|---|
| **P0 — Type widening** | Widen `contextUpdates` / `ContextMap` from `Record<string, string>` to `Record<string, unknown>` across: `src/attractor/types.ts` (`Outcome.contextUpdates`), `src/attractor/core/engine.ts:196` (merge annotation), `src/attractor/checkpoint.ts` (`CheckpointState.context`). Add `String(...)` coercion at exactly three call sites: **(a)** `src/attractor/transforms/preamble.ts:14` — `${v}` → `${String(v)}`; **(b)** `src/attractor/transforms/variable-expansion.ts:10` — `String(ctx[key] ?? match)`; **(c)** `src/attractor/core/conditions.ts:3,21,25` — widen `ContextMap` + coerce in `resolveKey()`. | None. | `npm test` green (Smoke test 1). No semantic change to any pipeline. Regression tests §5.6. |
| **P1 — Bug rollups** | Bug B.1 (`wait-human.ts:18` `expandVariables()`), Bug B.2 (`graph.ts` `unescapeDotString()` in `parseAttrs()`). | P0. | Unit tests §5.1 (`graph.test.ts`, `wait-human.test.ts`). |
| **P2 — Session primitive + digest** | New `src/cli/lib/session.ts` (`Session` class, `InteractiveSessionDigest`, `buildSessionDigest()`). Also new `src/cli/lib/slash-commands.ts` and `src/cli/lib/stream-json-input.ts`. Pure functions, no I/O, no Claude spawn. | P0. | Unit tests §5.1 (session, slash-commands, stream-json-input). |
| **P3 — `agent.runInteractive()`** | `src/cli/lib/agent.ts` — new `runInteractive()` method returning `ChildHandle` (async event iterator + submit + end + kill). `buildArgs()` branch for `interactiveStreamJson` flag. Existing `run()` untouched. | P2. | Contract tests §5.2 (fake child process). |
| **P4 — `TextInput.tsx`** | New `src/cli/components/TextInput.tsx` (custom, ~85 lines, `useInput` hook, cursor rendering, focus/disabled). | P2 (no runtime dep, but semantically grouped here). | Component tests §5.4. |
| **P5 — `ChatUI.tsx`** | New `src/cli/components/ChatUI.tsx` (~300 lines, state machine, slash-command dispatch, SIGINT handler, `<Static>` history + streaming message + TextInput + status bar). | P3, P4. | Component tests §5.3 using `ink-testing-library` + fake `ChildHandle`. |
| **P6 — agent-handler integration** | `src/attractor/handlers/agent-handler.ts` — new branch for `interactive=true`: call `agent.runInteractive()`, mount ChatUI, await exit reason, flatten digest into `contextUpdates`, return `Outcome`. Legacy `interactive=false` path unchanged. Guard: reject `interactive + jsonSchema` combination. | P5. | Handler integration tests §5.5 (fake agent, controllable fake `ChildHandle`). |
| **P7 — Smoke pipelines** | New files: `pipelines/smoke/chat-only.dot`, `pipelines/smoke/chat-end-to-end.dot`, `pipelines/smoke/schemas/summary.json`. | P6. | Smoke tests 3, 4, 5, 6 (manual). |
| **P8 — `npm run build` + `npm link` verification** | No code changes — just exercise the published artifact end-to-end on a real terminal. | P7. | Smoke tests §5.7 preconditions, then all smoke tests re-run against the linked binary. |

### §6.2 Compatibility guarantees during partial rollout

- **Legacy callers stay on `stdio: "inherit"`.** `plan.ts`, `new.ts`, `meditate-create.ts` continue to use `agent.run()` with `interactive: true, stdio: "inherit"` — they are **not** migrated to `runInteractive()` in this spec. The two code paths coexist in `src/cli/lib/agent.ts`.
- **Non-interactive nodes are unchanged.** The `interactive=false` branch in `agent-handler.ts` is identical to its current form. P0 type widening is pure variance widening (`unknown` accepts anything `string` used to); no existing code breaks.
- **`pipelines/illumination-to-plan.dot` is untouched.** Existing users running that pipeline see no behavior change until a follow-up spec migrates it. This is intentional — Path 1.5 is proven against the dedicated smoke pipelines first.
- **Checkpoint schema is additive-compatible.** Old checkpoints (pre-P0) that stored only string values in `context` continue to parse under the widened `Record<string, unknown>` schema — widening is covariant. New checkpoints (post-P0) with non-string values cannot be read by pre-P0 code, but there is no pre-P0 code in the wild consuming new checkpoints (same-process guarantee).

### §6.3 Rollback strategy per phase

- **P0 is reversible** by reverting the type annotations — no runtime behavior change.
- **P1 is reversible** by reverting the two handler/parser edits.
- **P2–P6 are additive** (all new files or new branches). Reverting = deleting new files / new branches; existing code paths are untouched.
- **P7 is file-only** (new DOT files). Reverting = deleting the files.
- **P8 is build-only** — nothing to roll back.

At no phase boundary is there a "point of no return" where reverting the previous phase is unsafe. Each phase can be committed as a standalone PR if desired.

### §6.4 Definition of done for this spec

All of the following must hold before the spec is considered implemented:

1. `npm test` green including all new unit/contract/component/integration tests from §5.1–§5.6.
2. `npm run build` succeeds with no type errors.
3. `npm link` installs the `ralph` binary.
4. Smoke tests 1, 2, 3, 4a, 4b, 4b-2, 4d, 5 (both success and failure paths), and 6 all pass on a real TTY.
5. `pipelines/illumination-to-plan.dot` still runs unchanged (regression guard).
6. No orphan `claude` processes after any smoke test (`ps aux | grep claude`).
7. This spec is referenced from a follow-up implementation plan per `superpowers:writing-plans`.

---

## Section 7 — Resolved Decisions

All five open questions raised during brainstorming are resolved. This section records the decisions with pointers into the spec where they are applied.

### Q1 — SIGINT scope → **node-only** with double-SIGINT escalation

**Decision:** First Ctrl-C aborts only the current interactive node. The pipeline engine routes via the standard `outcome=fail` edge (or terminates if no such edge exists). A second Ctrl-C during teardown falls through to Node's default handler (full process kill).

**Justification:**

- Matches user mental models from shell REPLs, Claude Code itself, and `git rebase -i` ("Ctrl-C ends this conversation, not my whole job").
- Reuses existing engine failure-routing at `src/attractor/core/engine.ts:222–231, 54–91`. No new types, no new edge semantics, no new Outcome statuses. ~20 lines across 2 files.
- Precedent in `attractor-spec.md §3.7` (failure routing) and `§6.5` (human timeouts handled by graph, not pipeline termination).
- Double-SIGINT provides a clean escape hatch for users whose abort fails to take effect.
- **Applied in:** §4.1 row 3, §4.3.

### Q2 — Turn limit default → **no default** for interactive nodes

**Decision:** Interactive chat nodes have no default `maxIterations`. A pipeline author may still opt in via `max_iterations=N` on the node, but ralph-cli supplies no implicit cap.

**Justification:**

- User observation: "chat sessions with user can be long and context window is getting full way before `max_turns=30` could anyway be reached." A default that never fires is dead code.
- Claude-level `result.stop_reason === "turn_limit"` still surfaces context-window exhaustion gracefully — the user sees a system notice and types `/end`.
- Non-interactive nodes are unaffected — their `maxIterations` semantics carry over.
- **Applied in:** §4.4.

### Q3 — Smoke test 3 vehicle → **minimal DOT file**

**Decision:** Validate ChatUI in isolation via a dedicated `pipelines/smoke/chat-only.dot` checked into the repo. No dev-only `ralph chat <folder>` command.

**Justification:**

- A parallel CLI entry point would be a second codepath that drifts from the real one used in production pipelines. Better to exercise the exact codepath users will hit.
- A minimal DOT file is a permanent regression guard, not throwaway scaffolding.
- **Applied in:** §5.7 Smoke test 3.

### Q4 — Smoke test 5 regression scope → **new simple file**, `illumination-to-plan.dot` untouched

**Decision:** Create a new dedicated end-to-end smoke pipeline (`pipelines/smoke/chat-end-to-end.dot`) for integration testing. Do NOT modify `pipelines/illumination-to-plan.dot` — it stays as a regression baseline. Migration of `illumination-to-plan.dot` to the new mechanism is deferred follow-up work.

**Justification:**

- Minimizes blast radius of Path 1.5 — a working pipeline stays working.
- The dedicated smoke pipeline is small, self-contained, and exercises both the success path (`/end` → summarize) and the failure path (`/abort` → recovery edge). Modifying `illumination-to-plan.dot` would entangle regression and new-feature validation.
- Follow-up spec will migrate `illumination-to-plan.dot` once Path 1.5 is proven in production.
- **Applied in:** §1 Primary user-visible outcome, §5.7 Smoke test 5, §5.7 Smoke test 6, §6.2, §6.4 point 5.

### Q5 — Checkpoint fidelity → **digest only**, no full `Session.history`

**Decision:** Checkpoints store only the flattened `InteractiveSessionDigest` keys. Full `Session.history` is discarded at node completion. Mid-conversation resume of an interactive node is explicitly out of scope for Path 1.5.

**Justification:**

- **Attractor-spec §5.3** explicitly states in-memory LLM sessions cannot be serialized; degrade to `summary:high` on resume. The digest IS the summary:high shape.
- **coding-agent-loop-spec §7.3** defines `SubAgentResult` as opaque (`output`, `success`, `turns_used`). Our digest mirrors this contract.
- Size: digest ~1–3 KB vs full history 40–150 KB. Simplicity: flat key-value checkpoint schema preserved.
- Future-proof: adding `history` field later is a non-breaking additive change; old checkpoints continue parsing.
- All six smoke tests pass with digest-only — no contradictions with the testing plan.
- **Applied in:** §3.1 (`InteractiveSessionDigest`), §4.6, §5.7 Smoke test 6.
