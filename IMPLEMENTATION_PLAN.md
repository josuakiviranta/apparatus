# Structured Interactive Handoff (Path 1.5) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate file-based conversation handoff between interactive pipeline nodes and downstream nodes by widening `Outcome.contextUpdates` to `Record<string, unknown>`, spawning Claude Code CLI as a long-lived bidirectional stream-json subprocess, and rendering the conversation via a host-owned Ink UI that keeps full conversation history in ralph's memory.

**Architecture:** Two code paths coexist in `src/cli/lib/agent.ts`: legacy `run()` unchanged, plus a new `runInteractive()` returning a `ChildHandle` over an `AsyncIterable<StreamJsonEvent>`. A new `Session` class owns the conversation history; `ChatUI.tsx` (Ink) renders it and drives slash commands; `agent-handler.ts` gains an `interactive=true` branch that mounts ChatUI, awaits exit, flattens a `SubAgentResult`-shaped digest into `contextUpdates`.

**Tech Stack:** TypeScript, Node 18+, Ink 6.8.0, React 19, vitest, ink-testing-library. Claude Code CLI 2.1.69+ for `--input-format stream-json --output-format stream-json --verbose --append-system-prompt --session-id`.

**Spec:** `docs/superpowers/specs/2026-04-10-path1-structured-interactive-handoff-design.md`

---

## Chunks Overview

| Chunk | Phase | Scope |
|---|---|---|
| 1 | P0 | Type widening: `Outcome.contextUpdates` + checkpoint + context merge + coercion at 3 call sites |
| 2 | P1 | Bug B.1 (`wait-human.ts` label expansion) + Bug B.2 (`graph.ts` unescape in `parseAttrs`) |
| 3 | P2 | New `session.ts`, `slash-commands.ts`, `stream-json-input.ts` + unit tests |
| 4 | P3 | `agent.runInteractive()` + typed raw-event iterator + contract tests |
| 5 | P4 + P5 | `TextInput.tsx` + `ChatUI.tsx` + component tests |
| 6 | P6 | `agent-handler.ts` interactive branch + handler integration tests |
| 7 | P7 + P8 | Smoke pipelines + manual verification checklist |

All tasks use `- [ ]` checkboxes. Each task is TDD: write failing test → verify failure → implement minimal code → verify passing → commit.

---

## Conventions Used In This Plan

- **File paths** are absolute from repo root (e.g. `src/cli/lib/session.ts`).
- **Line references** match the state captured at spec approval. If the plan says `engine.ts:196` but the executor finds the line has shifted by a few due to earlier chunks, the executor updates the reference and proceeds — the surrounding context string is the source of truth.
- **Commands** assume `cwd = /Users/josu/Documents/projects/ralph-cli` unless noted.
- **Commit messages** use Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`). One logical change per commit.
- **Test command** is `npm test` for the whole suite, or `npx vitest run <pattern>` for a targeted file.
- **Skill references:** `@superpowers:test-driven-development` for every test-first step, `@superpowers:verification-before-completion` before claiming chunk done.

---

## Chunk 1: P0 — Type Widening (`Outcome.contextUpdates` to `unknown`) ✅ COMPLETE

All tasks complete.

---

## Chunk 2: P1 — Bug Rollups (wait-human label expansion + DOT unescape) ✅ COMPLETE

All tasks complete.

---

## Chunk 3: P2 — Session Primitive + Slash Commands + Stream-JSON Input ✅ COMPLETE

All tasks complete.

---

## Chunk 4: P3 — `agent.runInteractive()` + Typed Raw-Event Iterator ✅ COMPLETE

All tasks complete.

---

## Chunk 5: P4 + P5 — TextInput + ChatUI Ink Components ✅ COMPLETE

**Goal:** Create two Ink components under `src/cli/components/`:

1. `TextInput.tsx` — ~85-line custom text input with cursor rendering, `useInput` hook, disable/focus support.
2. `ChatUI.tsx` — ~300-line chat renderer: consumes a `ChildHandle.events` iterator, owns a state machine (`streaming | awaiting | ended`), dispatches slash commands, handles SIGINT, resolves an `onExit(reason)` callback when the session ends.

All behavior is unit-testable via `ink-testing-library`.

**Verification after chunk:**
- [x] TextInput tests pass.
- [x] ChatUI tests pass against a fake `ChildHandle`.
- [x] `npm run build` succeeds.

### Task 5.1: Create `src/cli/components/TextInput.tsx`

**Files:**
- Create: `src/cli/components/TextInput.tsx`
- Test: `src/cli/tests/TextInput.test.tsx`

- [x] **Step 1: Verify `src/cli/components/` exists (create if missing)**

Run: `ls src/cli/components/ 2>/dev/null || mkdir -p src/cli/components`

- [x] **Step 2: Write the failing test**

Create `src/cli/tests/TextInput.test.tsx`:

```tsx
import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { TextInput } from "../components/TextInput.js";

function Harness({
  initial = "",
  disabled = false,
  placeholder = "",
  onSubmit = () => {},
}: {
  initial?: string;
  disabled?: boolean;
  placeholder?: string;
  onSubmit?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

describe("TextInput", () => {
  it("shows placeholder when value is empty", () => {
    const { lastFrame } = render(<Harness placeholder="type here" />);
    expect(lastFrame()).toContain("type here");
  });

  it("appends printable characters and moves cursor", () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write("h");
    stdin.write("i");
    expect(lastFrame()).toContain("hi");
  });

  it("backspace deletes the previous character", () => {
    const { stdin, lastFrame } = render(<Harness initial="hello" />);
    stdin.write("\u0008"); // backspace
    expect(lastFrame()).toContain("hell");
  });

  it("Enter calls onSubmit with current value", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness initial="submit me" onSubmit={onSubmit} />);
    stdin.write("\r"); // enter
    expect(onSubmit).toHaveBeenCalledWith("submit me");
  });

  it("disabled ignores keystrokes", () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness disabled onSubmit={onSubmit} />);
    stdin.write("x");
    stdin.write("\r");
    expect(onSubmit).not.toHaveBeenCalled();
    // Placeholder/value unchanged
  });

  it("left/right arrows move the cursor within bounds", () => {
    const { stdin, lastFrame } = render(<Harness initial="abc" />);
    // Cursor starts at end; left 1 → between b and c
    stdin.write("\u001b[D"); // left arrow
    stdin.write("X");
    expect(lastFrame()).toContain("abXc");
  });
});
```

- [x] **Step 3: Run, verify fail (component missing)**

Run: `npx vitest run src/cli/tests/TextInput.test.tsx`
Expected: import fails.

- [x] **Step 4: Create `src/cli/components/TextInput.tsx`**

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

- [x] **Step 5: Run, verify pass**

Run: `npx vitest run src/cli/tests/TextInput.test.tsx`
Expected: all tests pass. If ink-testing-library's `stdin.write` does not translate `\u0008` to backspace, use the raw Ink key sequence — check the existing Ink component tests in the repo (`src/cli/tests/` likely has prior art) for the exact sequence used.

- [x] **Step 6: Commit**

```bash
git add src/cli/components/TextInput.tsx src/cli/tests/TextInput.test.tsx
git commit -m "feat(components): add TextInput Ink component"
```

### Task 5.2: Create `src/cli/components/ChatUI.tsx`

**Files:**
- Create: `src/cli/components/ChatUI.tsx`
- Create: `src/cli/tests/helpers/fake-child-handle.ts`
- Test: `src/cli/tests/ChatUI.test.tsx`

**Prerequisites from earlier chunks** (if any symbol below is missing, stop and re-run the earlier chunk first):
- From Chunk 3 `src/cli/lib/session.ts`: `Session`, `Turn` (with `role: "user" | "assistant" | "tool_result" | "system"`), `Usage`, `ToolCall`, `ExitReason` (including `"child_crash"`, `"turn_limit"`).
- From Chunk 3 `src/cli/lib/slash-commands.ts`: `parseSlashCommand`, `HELP_TEXT` (must contain the literal strings `/end`, `/abort`, `/help`).
- From Chunk 4 `src/cli/lib/agent.ts`: `ChildHandle` interface with `events: AsyncIterable<StreamJsonEvent>`, `submit`, `end`, `kill`, `sessionId`, `exited`.
- From Chunk 4 `src/cli/lib/stream-formatter.ts`: `StreamJsonEvent` union including `assistant_delta`, `tool_use`, `tool_result`, `result`, `parse_error`, `system`.

**Design note:** ChatUI is the largest new file (~260 lines). It has a single responsibility — render the chat and drive the session state machine. Splitting it further (e.g., TurnView into its own file) would not help: the sub-components are tiny and only used here.

**Static component note:** Ink's `<Static>` is append-only — it renders newly appended items exactly once and never re-renders existing items. This is intentional for chat history: each turn is immutable once committed. Do NOT mutate existing turns in `session.history`; always `push` new turns and pass a shallow-copied array to `setHistory` so React detects the change.

- [x] **Step 1: Define the fake `ChildHandle` helper that the tests will use**

Create `src/cli/tests/helpers/fake-child-handle.ts`:

```ts
import type { ChildHandle } from "../../lib/agent.js";
import type { StreamJsonEvent } from "../../lib/stream-formatter.js";

export interface FakeChildHandleController {
  handle: ChildHandle;
  emit(event: StreamJsonEvent): void;
  endStream(): void;
  submitted: string[];
  endCalled: boolean;
  killSignal: NodeJS.Signals | null;
  exitWith(code: number | null): void;
}

export function createFakeChildHandle(sessionId = "fake-uuid"): FakeChildHandleController {
  const submitted: string[] = [];
  let endCalled = false;
  let killSignal: NodeJS.Signals | null = null;
  let resolveExit: (r: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
    resolveExit = res;
  });

  // Pending deliveries + pending awaiters for the async iterator
  const pending: StreamJsonEvent[] = [];
  const awaiters: Array<(v: IteratorResult<StreamJsonEvent>) => void> = [];
  let streamEnded = false;

  const events: AsyncIterable<StreamJsonEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<StreamJsonEvent>> {
          if (pending.length > 0) {
            return Promise.resolve({ value: pending.shift()!, done: false });
          }
          if (streamEnded) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise((resolve) => {
            awaiters.push(resolve);
          });
        },
      };
    },
  };

  const controller: FakeChildHandleController = {
    handle: {
      events,
      submit: async (text: string) => {
        submitted.push(text);
      },
      end: async () => {
        endCalled = true;
        resolveExit!({ code: 0, signal: null });
      },
      kill: async (sig: NodeJS.Signals = "SIGTERM") => {
        killSignal = sig;
        resolveExit!({ code: null, signal: sig });
      },
      sessionId,
      exited,
    },
    emit(event) {
      if (awaiters.length > 0) {
        awaiters.shift()!({ value: event, done: false });
      } else {
        pending.push(event);
      }
    },
    endStream() {
      streamEnded = true;
      while (awaiters.length > 0) {
        awaiters.shift()!({ value: undefined as any, done: true });
      }
    },
    get submitted() { return submitted; },
    get endCalled() { return endCalled; },
    get killSignal() { return killSignal; },
    exitWith(code) {
      resolveExit!({ code, signal: null });
    },
  };

  return controller;
}
```

- [x] **Step 2: Write ChatUI tests**

Create `src/cli/tests/ChatUI.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ChatUI } from "../components/ChatUI.js";
import { Session } from "../lib/session.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

function waitForFrames(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ChatUI", () => {
  // Belt-and-suspenders: ChatUI registers a SIGINT handler via process.once
  // in useEffect and cleans up on unmount. In case a test forgets to unmount,
  // strip any leftover listeners between tests so handlers don't leak.
  afterEach(() => {
    process.removeAllListeners("SIGINT");
  });

  it("starts in streaming status and shows placeholder for empty history", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { lastFrame, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    await waitForFrames();
    // Placeholder present in the TextInput area
    expect(lastFrame()).toMatch(/Type a message|\/end|\/help/);
    unmount();
  });

  it("transitions to awaiting after first result event", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { lastFrame, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );

    ctrl.emit({ type: "assistant_delta", textDelta: "Hi there" });
    ctrl.emit({
      type: "result",
      stopReason: "end_turn",
      text: "Hi there",
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: {},
    });
    await waitForFrames();
    // Session.history now has the assistant turn
    expect(session.history.some((t) => t.role === "assistant")).toBe(true);
    unmount();
  });

  it("dispatches /help locally and does not call submit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    // Move to awaiting
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/help".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.some((t) => t.role === "system" && t.text.includes("/end"))).toBe(true);
    unmount();
  });

  it("dispatches /end by calling child.end and onExit('user_end')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/end".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.endCalled).toBe(true);
    expect(onExit).toHaveBeenCalledWith("user_end");
    expect(session.exitReason).toBe("user_end");
    unmount();
  });

  it("dispatches /abort by calling child.kill and onExit('abort')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/abort".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.killSignal).toBe("SIGTERM");
    expect(onExit).toHaveBeenCalledWith("abort");
    expect(session.exitReason).toBe("abort");
    unmount();
  });

  it("unknown slash command adds a system notice without calling submit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/foo".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.some((t) => t.role === "system" && t.text.includes("Unknown command"))).toBe(true);
    unmount();
  });

  it("regular message pushes user turn, calls submit, transitions back to streaming", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "hi", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "hello".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toEqual(["hello"]);
    expect(session.history.filter((t) => t.role === "user")).toHaveLength(1);
    unmount();
  });

  it("empty submit (whitespace) is a no-op", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "   ".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.filter((t) => t.role === "user")).toHaveLength(0);
    unmount();
  });

  it("turn_limit result transitions to ended with exitReason=turn_limit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result",
      stopReason: "turn_limit",
      text: "capped",
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: {},
    });
    await waitForFrames();
    expect(session.exitReason).toBe("turn_limit");
    expect(onExit).toHaveBeenCalledWith("turn_limit");
    unmount();
  });

  it("parse_error adds system notice but keeps session alive", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({ type: "parse_error", rawLine: "not json", error: "Unexpected token" });
    await waitForFrames();
    expect(session.history.some((t) => t.role === "system" && t.text.includes("parse"))).toBe(true);
    expect(session.exitReason).toBeUndefined();
    unmount();
  });

  it("child_crash (non-zero exit) sets exitReason and calls onExit('child_crash')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.exitWith(1);
    await waitForFrames();
    expect(session.exitReason).toBe("child_crash");
    expect(onExit).toHaveBeenCalledWith("child_crash");
    expect(session.history.some((t) => t.role === "system" && t.text.includes("exited with code 1"))).toBe(true);
    unmount();
  });

  it("events iterator termination (endStream) is handled without crashing", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    // Deliver one result, then terminate the events stream.
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "hi",
      usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();
    ctrl.endStream();
    await waitForFrames();
    // No state change — session stays alive until explicit exit.
    expect(session.exitReason).toBeUndefined();
    unmount();
  });
});
```

- [x] **Step 3: Run, verify fail**

Run: `npx vitest run src/cli/tests/ChatUI.test.tsx`
Expected: module not found.

- [x] **Step 4: Create `src/cli/components/ChatUI.tsx`**

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { Box, Static, Text } from "ink";
import type { Session, Turn, Usage, ExitReason, ToolCall } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";
import { parseSlashCommand, HELP_TEXT } from "../lib/slash-commands.js";
import { TextInput } from "./TextInput.js";

type Status = "streaming" | "awaiting" | "ended";

interface Props {
  session: Session;
  child: ChildHandle;
  onExit: (reason: ExitReason) => void;
}

export function ChatUI({ session, child, onExit }: Props) {
  const [history, setHistory] = useState<Turn[]>(() => [...session.history]);
  const [streamingText, setStreamingText] = useState("");
  const [inputBuffer, setInputBuffer] = useState("");
  const [status, setStatus] = useState<Status>("streaming");
  const [lastUsage, setLastUsage] = useState<Usage | undefined>();

  // Accumulate per-turn deltas and tool calls for the in-flight assistant turn
  const pendingText = useRef<string>("");
  const pendingToolCalls = useRef<ToolCall[]>([]);

  // Consume child events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        for await (const ev of child.events) {
          if (cancelled) break;

          if (ev.type === "assistant_delta") {
            pendingText.current += ev.textDelta;
            setStreamingText(pendingText.current);
          } else if (ev.type === "tool_use") {
            pendingToolCalls.current.push(ev.toolCall);
          } else if (ev.type === "result") {
            // Narrow stopReason to the literal union Turn["stopReason"] understands.
            // Anything not recognised falls back to "end_turn" (benign;
            // session stays alive, user can keep typing).
            const stop: "end_turn" | "turn_limit" | "abort" | "error" =
              ev.stopReason === "turn_limit" ? "turn_limit"
              : ev.stopReason === "abort" ? "abort"
              : ev.stopReason === "error" ? "error"
              : "end_turn";
            const assistantTurn: Turn = {
              role: "assistant",
              text: pendingText.current || ev.text,
              toolCalls: pendingToolCalls.current.slice(),
              usage: ev.usage,
              stopReason: stop,
              at: Date.now(),
            };
            session.history.push(assistantTurn);
            setHistory([...session.history]);
            setStreamingText("");
            setLastUsage(ev.usage);
            pendingText.current = "";
            pendingToolCalls.current.length = 0;

            if (ev.stopReason === "turn_limit") {
              setStatus("ended");
              session.exitReason = "turn_limit";
              onExit("turn_limit");
            } else {
              setStatus("awaiting");
            }
          } else if (ev.type === "parse_error") {
            session.history.push({
              role: "system",
              text: `stream-json parse error: ${ev.error} (line: ${ev.rawLine.slice(0, 80)})`,
              at: Date.now(),
            });
            setHistory([...session.history]);
          } else if (ev.type === "tool_result") {
            session.history.push({
              role: "tool_result",
              toolCallId: ev.toolCallId,
              content: ev.content,
              isError: ev.isError,
              at: Date.now(),
            });
            setHistory([...session.history]);
          }
          // system events ignored for UI (already captured in session id on handle)
        }
      } catch (err) {
        session.history.push({
          role: "system",
          text: `event stream error: ${(err as Error).message}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
      }
    })();
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // Detect child crash
  useEffect(() => {
    let cancelled = false;
    child.exited.then((res) => {
      if (cancelled) return;
      if (session.exitReason !== undefined) return; // already ended via /end or /abort
      if (res.code !== 0 && res.code !== null) {
        session.exitReason = "child_crash";
        setStatus("ended");
        session.history.push({
          role: "system",
          text: `Child process exited with code ${res.code}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        onExit("child_crash");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // SIGINT — node-scoped, first press aborts
  useEffect(() => {
    const handler = () => {
      if (session.exitReason !== undefined) return;
      session.exitReason = "abort";
      setStatus("ended");
      child.kill("SIGTERM").finally(() => onExit("abort"));
    };
    process.once("SIGINT", handler);
    return () => {
      process.removeListener("SIGINT", handler);
    };
  }, [child, session, onExit]);

  const handleSubmit = useCallback(
    async (raw: string) => {
      setInputBuffer("");
      const parsed = parseSlashCommand(raw);

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
        try { await child.end(); } catch {}
        onExit("user_end");
        return;
      }
      if (parsed.kind === "abort") {
        setStatus("ended");
        session.exitReason = "abort";
        try { await child.kill("SIGTERM"); } catch {}
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
        setStatus("awaiting");
      }
    },
    [child, session, onExit],
  );

  return (
    <Box flexDirection="column">
      <Static items={history.map((turn, i) => ({ turn, key: `${turn.at}-${i}` }))}>
        {(item) => <TurnView key={item.key} turn={item.turn} />}
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

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color="green">you: </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "assistant") {
    return (
      <Box marginTop={1}>
        <Text color="cyan">claude: </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "system") {
    return (
      <Box marginTop={1}>
        <Text dimColor>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "tool_result") {
    return (
      <Box marginTop={1}>
        <Text color={turn.isError ? "red" : "yellow"} dimColor>
          [tool result {turn.isError ? "(error) " : ""}{turn.toolCallId}]
        </Text>
      </Box>
    );
  }
  return null;
}

function StatusBar({
  status,
  turnsUsed,
  usage,
}: {
  status: Status;
  turnsUsed: number;
  usage?: Usage;
}) {
  const parts = [`status: ${status}`, `turns: ${turnsUsed}`];
  if (usage) parts.push(`in/out: ${usage.inputTokens}/${usage.outputTokens}`);
  return (
    <Box marginTop={1}>
      <Text dimColor>{parts.join("  |  ")}</Text>
    </Box>
  );
}
```

- [x] **Step 5: Run the tests, verify pass**

Run: `npx vitest run src/cli/tests/ChatUI.test.tsx`
Expected: all tests pass. If a test is flaky due to Ink async scheduling, bump `waitForFrames` to 100ms — but do NOT add `setTimeout` loops in the component itself; the test is the thing that flexes for Ink's async.

- [x] **Step 6: Full suite + build**

Run: `npm test && npm run build`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add src/cli/components/ChatUI.tsx src/cli/tests/ChatUI.test.tsx src/cli/tests/helpers/fake-child-handle.ts
git commit -m "feat(components): add ChatUI Ink component with state machine + slash commands"
```

### Task 5.3: Chunk 5 verification gate

- [x] **Step 1: Full suite**

Run: `npm test && npm run build`
Expected: all green.

**Implementation notes:**
- TextInput uses internal state + refs to handle batched keystrokes from ink-testing-library (stdin writes are synchronous but Ink renders asynchronously).
- ChildHandle.exited promise was added to agent.ts to support ChatUI's child crash detection.
- Tests require `await delay()` after stdin.write for Ink to flush renders.

---

## Chunk 6: P6 — `agent-handler.ts` Interactive Branch ✅ COMPLETE

**Goal:** Add an `interactive=true` branch to `src/attractor/handlers/agent-handler.ts` that:

1. Creates a host-assigned `Session` (`crypto.randomUUID()`).
2. Calls `agent.runInteractive()` with the combined `preamble + expandedPrompt` as `systemPrompt`.
3. Mounts `ChatUI` via Ink's `render()` and awaits a promise resolved by `onExit`.
4. Flattens `buildSessionDigest()` into `contextUpdates` keys prefixed by `node.id`.
5. Returns an `Outcome` with `status=success` if `digest.success`, `failure` otherwise.
6. Guards: rejects `interactive=true` combined with `jsonSchemaFile` (the two are mutually exclusive — structured output needs a single batched response, interactive needs a live stream).

Legacy `interactive=false` path is untouched.

**Verification after chunk:**
- [x] Existing `agent-handler` tests still pass (19 tests).
- [x] New handler integration test file passes (6 tests) using a fake `Agent` that returns a controllable fake `ChildHandle`.
- [x] `npm run build` succeeds.

**Implementation notes:**
- `AgentHandlerDeps` extended with optional `render?: InkRenderFn` for test injection.
- Interactive branch inserted before the legacy retry loop; when `interactive=true`, the handler returns early without ever calling `agent.run()`.
- Legacy `agent.run()` call simplified — removed dead `interactive ? undefined : onStdout` conditional since interactive nodes never reach the loop.
- Existing test "passes interactive:true to agent.run()" updated to verify `agent.run()` is NOT called for interactive nodes (interactive branch calls `runInteractive()` instead).
- `child.exited` awaited with 5s timeout + SIGKILL fallback for cleanup.

All tasks complete.

**Additional fixes during Chunk 7:**
- Fixed type error in `src/attractor/handlers/parallel.ts:17` — `ctx.values` returns `unknown` after Chunk 1 widening; added `String()` coercion for `JSON.parse`.
- Added explicit `interactive` and `jsonSchemaFile` properties to `Node` interface in `src/attractor/types.ts` for type safety.
- Corrected smoke pipeline DOT syntax: ralph-cli uses `shape=Mdiamond`/`shape=Msquare` for entry/exit nodes and `agent="implement"` for agent nodes (not `kind=` attributes).

---

## Chunk 7: P7 + P8 — Smoke Pipelines + Manual Verification

**Goal:** Create three new files under `pipelines/smoke/` — `chat-only.dot`, `chat-end-to-end.dot`, `schemas/summary.json` — then execute the full manual smoke test matrix from spec §5.7. This chunk is the **definition of done** for the spec.

**`pipelines/illumination-to-plan.dot` is NOT modified** in this chunk (Q4 from spec §7).

### Task 7.1: Create `pipelines/smoke/chat-only.dot`

**Files:**
- Create: `pipelines/smoke/chat-only.dot`

- [x] **Step 1: Write the file**

```
digraph chat_only {
  start [kind=entry];
  chat  [kind=agent, interactive=true, prompt="You are a helpful assistant. Introduce yourself in one sentence, then ask the user what they want to talk about."];
  done  [kind=exit];
  start -> chat;
  chat  -> done;
}
```

- [x] **Step 2: Validate it parses**

Run: `ralph pipeline validate pipelines/smoke/chat-only.dot` (or whatever validate subcommand exists; `ralph pipeline list pipelines/smoke/` otherwise)
Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add pipelines/smoke/chat-only.dot
git commit -m "feat(pipelines): add chat-only smoke pipeline for ChatUI isolation testing"
```

### Task 7.2: Create `pipelines/smoke/chat-end-to-end.dot` + schema

**Files:**
- Create: `pipelines/smoke/chat-end-to-end.dot`
- Create: `pipelines/smoke/schemas/summary.json`

- [x] **Step 1: Write the schema file**

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

- [x] **Step 2: Write the DOT file**

Create `pipelines/smoke/chat-end-to-end.dot`:

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
    prompt="Summarize this chat into a single sentence. Input:\n\n$chat.output",
    json_schema_file="pipelines/smoke/schemas/summary.json"
  ];

  recovery [
    kind=agent,
    interactive=false,
    prompt="The interactive chat was aborted. Write a one-line note saying the user aborted early. Partial output (may be empty): $chat.output"
  ];

  done [kind=exit];

  start     -> chat;
  chat      -> summarize [condition="outcome=success"];
  chat      -> recovery  [condition="outcome=fail"];
  summarize -> done;
  recovery  -> done;
}
```

**Note on variable syntax:** ralph-cli's `expandVariables` uses `$key` (single-dollar) per `src/attractor/transforms/variable-expansion.ts:8`. The spec text uses `${chat.output}` in prose but this plan uses the actual working syntax `$chat.output`.

- [x] **Step 3: Validate it parses**

Run: `ralph pipeline validate pipelines/smoke/chat-end-to-end.dot`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add pipelines/smoke/chat-end-to-end.dot pipelines/smoke/schemas/summary.json
git commit -m "feat(pipelines): add chat-end-to-end smoke pipeline with success/recovery paths"
```

### Task 7.3: Build, link, and run the manual smoke test matrix

This task cannot be automated. The executor (human or agent with TTY access) must run each test and check each box. Each failed test is a **blocker** until fixed.

- [x] **Step 1: Build + link**

Run:

```bash
cd /Users/josu/Documents/projects/ralph-cli
npm install
npm run build
npm link
which ralph     # expect /Users/josu/.npm-global/bin/ralph or similar
ralph --version
claude --version  # must be 2.1.69 or newer
```

- [x] **Step 2: Smoke test 1 — `npm test`**

Run: `npm test`
Expected: all unit, contract, component, integration tests pass.

- [ ] **Step 3: Smoke test 2 — Non-interactive regression**

Run: in a scratch project folder, `ralph <folder> plan` (exits cleanly via stdio:inherit two-phase) and `ralph <folder> implement --max 1` (single iteration).
Expected: both commands behave identically to pre-change.

- [ ] **Step 4: Smoke test 3 — ChatUI standalone (`chat-only.dot`)**

Run: `ralph pipeline run pipelines/smoke/chat-only.dot`

Manual checklist:

- [ ] Ink ChatUI appears after pipeline banner
- [ ] Claude's introduction streams in visible chunks
- [ ] Status transitions to "awaiting" after the first `result` event
- [ ] TextInput accepts typed characters, shows cursor, shows placeholder when empty
- [ ] `/help` renders HELP_TEXT without a round-trip
- [ ] Regular message round-trips (user → assistant)
- [ ] `/end` unmounts cleanly; terminal returns to normal
- [ ] Pipeline engine logs show `chat.output` contains the last assistant message
- [ ] `logs/chat/digest.json` (or equivalent) exists and matches the digest shape
- [ ] Checkpoint file has flat-keyed entries (`chat.output`, `chat.success`, `chat.turnsUsed`, `chat.sessionId`, `chat.exitReason`, `chat.digest`)
- [ ] `ps aux | grep claude` shows no orphan process

- [ ] **Step 5: Smoke test 4 — Abort paths**

- **4a — `/abort`:** Run `chat-only.dot`, type `/abort` mid-chat.
  - [ ] SIGTERM delivered, Ink unmounts, `exitReason=abort`, pipeline exits with failure (`chat-only.dot` has no recovery edge).
- **4b — single Ctrl-C:** Run `chat-only.dot`, press Ctrl-C once.
  - [ ] ChatUI unmounts, pipeline fails, parent shell returns to prompt without hang.
- **4b-2 — double Ctrl-C:** Run `chat-only.dot`, press Ctrl-C twice in rapid succession.
  - [ ] Double-SIGINT escalates via Node default handler, whole process tree killed, parent shell returns with non-zero exit.
- **4c — child crash (REQUIRED):** Run `chat-only.dot`, from another terminal run `pgrep -f "claude.*stream-json"` and then `kill -9 <pid>` on the child claude process.
  - [ ] ChatUI detects exit, reports `child_crash`, pipeline fails cleanly.
  - Promoted from optional: this is the only manual coverage of the `child_crash` exit reason path (spec §4.1), which would otherwise regress silently. If reproduction is flaky on a fast machine, increase chat latency by asking Claude for a long response before killing.
- **4d — abort with recovery edge:** Run `chat-end-to-end.dot`, type `/abort` during the chat.
  - [ ] Pipeline follows `outcome=fail` edge to `recovery`, completes, reaches `done` with overall `status=success`.

- [ ] **Step 6: Smoke test 5 — End-to-end success path (`chat-end-to-end.dot`)**

Run: `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`

Manual checklist:

- [ ] Pipeline enters `chat` node, ChatUI appears
- [ ] Claude asks one question
- [ ] User answers, gets acknowledgement, types `/end`
- [ ] Ink unmounts cleanly
- [ ] Pipeline advances to `summarize` (non-interactive)
- [ ] `summarize` produces a JSON object matching `schemas/summary.json`, populated with content derived from `$chat.output`
- [ ] Pipeline reaches `done` with `status=success`
- [ ] `meditations/.triage/chat-notes.md` does NOT exist at any point (verify: `ls meditations/.triage/ 2>&1 | grep chat-notes` returns nothing)
- [ ] Checkpoint contains `chat.output`, `chat.success=true`, `chat.exitReason=user_end`, `chat.turnsUsed>0`, `summarize.structured_output.summary` (or equivalent per current structured-output key naming)

- [ ] **Step 7: Smoke test 6 — Checkpoint resume**

Run: `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`

1. Complete `chat` with `/end` (success path)
2. While `summarize` is running, press Ctrl-C at the shell level (between nodes, not inside ChatUI)
3. Run: `ralph pipeline resume` (or the equivalent resume invocation)

Manual checklist:

- [ ] Resume does NOT re-launch ChatUI (interactive node already in `completedNodes`)
- [ ] Resume picks up at `summarize` with `$chat.output` still populated from restored context
- [ ] Resume reaches `done` successfully
- [ ] Inspection of checkpoint file: `chat.output`, `chat.success`, `chat.exitReason`, `chat.turnsUsed` are flat primitives — NO nested `Session.history` array

- [ ] **Step 8: Regression — illumination-to-plan.dot still works**

Run: `ralph pipeline run pipelines/illumination-to-plan.dot` (or whatever the existing invocation is)
Expected: same behavior as before this spec. It still uses its file-based handoff; it is the untouched regression baseline per Q4.

- [ ] **Step 9: No orphan processes**

Run: `ps aux | grep -i claude | grep -v grep`
Expected: empty (or only the currently-running ralph process, if any).

### Task 7.4: Chunk 7 final verification gate (definition of done)

- [ ] **Step 1: All six smoke test groups (1, 2, 3, 4a/4b/4b-2/4d, 5, 6) are green**
- [x] **Step 2: `npm test` green** (538/538 pass, 45 test files)
- [x] **Step 3: `npm run build` succeeds** (zero type errors, build clean)
- [ ] **Step 4: `pipelines/illumination-to-plan.dot` runs unchanged**
- [ ] **Step 5: No orphan `claude` processes after any smoke test**
- [ ] **Step 6: Commit the smoke test outcome notes (if any changes were made during debugging)**

```bash
git add -A
git commit -m "chore: smoke test verification for Path 1.5"
```

- [ ] **Step 7: Mark spec complete**

The spec is implemented when all seven chunks have their verification gates green. Invoke `@superpowers:verification-before-completion` to confirm evidence before declaring done.

**Code Audit Notes (2026-04-10):**
- All 7 agent-handler interactive branch requirements verified (Session+UUID, runInteractive, ChatUI mount, digest flattening, Outcome mapping, jsonSchemaFile guard, exited timeout+SIGKILL)
- DOT parser fully supports all smoke pipeline attributes (interactive, json_schema_file, condition=outcome, $chat.output variable expansion)
- No TODOs, FIXMEs, stubs, or placeholder implementations in src/
- Both smoke pipelines validate successfully (chat-only: 3 nodes/2 edges, chat-end-to-end: 5 nodes/5 edges)
- Minor observations (non-blocking): TextInput forward-delete behaves like backspace; ChatUI onExit ref is stable in practice since Ink renders once

---

## Plan Summary

| Chunk | Phase | Files touched |
|---|---|---|
| 1 | P0 Type widening | `types.ts`, `engine.ts`, `conditions.ts`, `preamble.ts`, `variable-expansion.ts`, `checkpoint.ts` + tests |
| 2 | P1 Bug rollups | `wait-human.ts`, `graph.ts` + tests |
| 3 | P2 New primitives | `session.ts`, `slash-commands.ts`, `stream-json-input.ts` + tests |
| 4 | P3 runInteractive | `agent.ts` (add methods), `stream-formatter.ts` (add parser) + tests |
| 5 | P4+P5 Components | `TextInput.tsx`, `ChatUI.tsx` + tests + helper |
| 6 | P6 Handler branch | `agent-handler.ts` + integration tests |
| 7 | P7+P8 Smoke | `pipelines/smoke/chat-only.dot`, `pipelines/smoke/chat-end-to-end.dot`, `pipelines/smoke/schemas/summary.json` + manual verification |

**All existing code paths are preserved:** `Agent.run()`, `plan.ts`, `new.ts`, `meditate-create.ts`, `streamEvents()` (the high-level formatter), and `pipelines/illumination-to-plan.dot` are untouched.

