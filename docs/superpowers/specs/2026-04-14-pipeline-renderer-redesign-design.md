---
id: spec-2026-04-14-pipeline-renderer-redesign
type: spec
created: 2026-04-14
status: draft
tags: [ink, pipeline-display, rendering, yagni, kiss, dry]
supersedes: docs/superpowers/specs/2026-04-10-interactive-ink-overlay-design.md
---

# Pipeline Renderer Redesign — Node Blocks with a Single Static History

## Problem

Running `ralph pipeline run pipelines/smoke/chat-end-to-end.dot` exhibits three persistent rendering bugs:

1. **Three empty border boxes stack at pipeline start** — three top-border lines with no content, no closing borders.
2. **Trace-path header renders mid-chat** — the dim `trace: …` line appears AFTER the assistant's response instead of ABOVE the conversation.
3. **Downstream node output lost after `/end`** — `summarize` and `done` nodes run successfully (confirmed via `checkpoint.json`) but produce no visible terminal output.

Diagnosis (confirmed by parallel code audit + Ink source reading):

- The current `PipelineDisplay.tsx` contains `<Static items={lines}>`.
- The current `ChatUI.tsx` ALSO contains `<Static items={history}>`.
- `ChatUI` is mounted as a conditional child of `PipelineDisplay`, producing a **nested `<Static>` tree**.
- Ink's `<Static>` is implemented as a single absolute-positioned `internal_static` slot per render tree (see `ink/src/components/Static.tsx`). Nesting is structurally unsupported. When the child `<Static>` mounts and unmounts, the parent `<Static>`'s cursor state corrupts and later-appended items never reach the terminal.

A previous fix attempt (Option B: single Ink tree with overlay slot) did not resolve the bugs because the nested `<Static>` remained.

## Goals

1. **Each pipeline node renders as a discrete "block"** in the terminal — a minimalist header separator, a body of streamed lines, and an outcome footer.
2. **Finished blocks freeze permanently** in append-only terminal scrollback; they are never re-rendered, never mutated.
3. **The currently-running node lives in a single live footer** that redraws in place as events stream.
4. **One `<Static>` component in the entire Ink tree.** No nesting. Structurally impossible to reproduce the three observed bugs.
5. **Interactive chat nodes and non-interactive agent nodes follow the same data-flow model** — one component, one state reducer, one event type.
6. **Every agent block displays the absolute path to its Claude Code session transcript file** (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) so a secondary agent can tail it to observe the full conversation.
7. **Apply YAGNI, KISS, DRY, SOLID** — ship less code than the current implementation, with fewer moving parts.

## Non-goals

- No engine refactoring (`src/attractor/core/engine.ts` and all handlers remain untouched).
- No new patterns (EventEmitters, dependency injection containers, etc.).
- No changes to `TextInput.tsx` — it is stable and reused as-is.
- No changes to the checkpoint, daemon, goal-gate, or conditional-branch subsystems.
- No reworking the Claude subprocess spawning logic in `src/cli/lib/{session,agent}.ts`.

## Preconditions

- Ink 6.8.0 API semantics (`<Static>` is append-only; `patchConsole` option exists; reusing the same stdout across multiple `render()` calls is unsupported).
- Claude Code stream-json format: the adapter must be able to extract a `sessionId` from an early event on `child.events` (or from the existing `ChildHandle.sessionId` property).
- `ralph-cli`'s `ChildHandle` shape (`src/cli/lib/agent.ts:39-46`) exposes:
  - `sessionId: string`
  - `events: AsyncGenerator<StreamJsonEvent>` (async iterable)
  - `submit(text: string): Promise<void>` — the supported way to deliver a user message to the running Claude subprocess
  - `end(): Promise<void>` — closes stdin and lets the session exit gracefully
  - `kill(signal?): Promise<void>` — hard kill
  - `exited: Promise<{ code, signal, stderrTail }>`
  - **There is no `child.stdin` property.** All user input flows through `child.submit(text)`.
- The pipeline command already has `logsRoot` in scope and passes `session`/`child` to `onInteractiveRequest`.
- `src/cli/lib/slash-commands.ts` already exists with a `parseSlashCommand` function and its own test file `src/cli/tests/slash-commands.test.ts`. The new design **reuses** it — no new slash-command parser is added.

## Visual design

### Block style (minimalist header, flat body, dim footer)

Each block is rendered by a single pure component (`BlockView` for frozen, `LiveFooter` for in-flight). No nested borders, no box characters, no colored backgrounds. Format:

```
━━ [<index>] <nodeId> · <label> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: <absolute-path-to-session.jsonl>        ← only for agent-kind blocks
<body lines, indented when continuation>
<outcome line — ✓ success / ✗ fail / ✗ abort — with turns/tokens/duration>
```

The trace line is dim. The body is plain text. The outcome line is dim with a single status glyph. One blank line after each frozen block.

### Full-run mockup (interactive chat → summarize → done)

**T0 — pipeline just started, first node beginning:**

```
 chat_end_to_end · main · /Users/josu/Documents/projects/ralph-cli
 nodes: chat → summarize → done

━━ [1] chat · interactive agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⠋ starting · PID 13198 · 0.0s
```

**T1 — Claude is streaming a response:**

```
 chat_end_to_end · main · /Users/josu/Documents/projects/ralph-cli
 nodes: chat → summarize → done

━━ [1] chat · interactive agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/b2f8e9c1-4a7d-4e2a-9f1c-8b3d5e7a1234.jsonl
you: summarize the repo
claude: ralph-cli has 4 layers — attractor for the pipeline engine, CLI for
        the user interface, daemon for background scheduling, and a shared li
  ⠙ streaming · turns: 1 · 19/182 tok · 2.3s
```

**T2 — user is typing their second message (input buffer shows live cursor):**

```
━━ [1] chat · interactive agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/b2f8e9c1-4a7d-4e2a-9f1c-8b3d5e7a1234.jsonl
you: summarize the repo
claude: ralph-cli has 4 layers — attractor for the pipeline engine, CLI for
        the user interface, daemon for background scheduling, and a shared
        lib module. Key entry point is src/cli/index.ts.
  ● awaiting · turns: 1 · 19/164 tok · 4.8s
> what's in src/daemon?█
```

(The first claude turn is complete. The user has submitted it and is now typing a follow-up question in the input widget. No second claude response has streamed yet.)

**T3 — user typed `/end`, chat block just froze, summarize is starting:**

```
 chat_end_to_end · main · /Users/josu/Documents/projects/ralph-cli
 nodes: chat → summarize → done

━━ [1] chat · interactive agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/b2f8e9c1-4a7d-4e2a-9f1c-8b3d5e7a1234.jsonl
you: summarize the repo
claude: ralph-cli has 4 layers — attractor for the pipeline engine, CLI for
        the user interface, daemon for background scheduling, and a shared
        lib module. Key entry point is src/cli/index.ts.
you: what's in src/daemon?
claude: three files — index.ts (entry + socket), scheduler.ts (interval
        queue), runner.ts (child process spawn + lifecycle).
you: /end
✓ ended · turns: 2 · 42/417 tok · 21.3s

━━ [2] summarize · agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⠋ starting · 0.1s
```

Block [1] has just been pushed into `<Static items={frozen}>` — Ink guarantees it will never re-render. Block [2] lives in the live footer.

**T5 — pipeline complete:**

```
 chat_end_to_end · main · /Users/josu/Documents/projects/ralph-cli
 nodes: chat → summarize → done

━━ [1] chat · interactive agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/b2f8e9c1-...jsonl
you: summarize the repo
claude: ralph-cli has 4 layers — …
you: what's in src/daemon?
claude: three files — …
you: /end
✓ ended · turns: 2 · 42/417 tok · 21.3s

━━ [2] summarize · agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/c3a9fb12-...jsonl
Based on the chat session, here is the summary: ralph-cli is organized into
four layers. The attractor package contains the pipeline engine with a hand-
rolled DOT parser, a node-based execution loop, and 10 handler types.
[tool_use: Write specs/chat-summary.md]
✓ success · turns: 3 · 891/634 tok · 8.7s

━━ [3] done · node ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ pipeline completed

◆ chat_end_to_end · all nodes complete · 3/3 · 31.8s total
```

Non-agent nodes (`done` is a plain `node` kind) omit the trace line.

### Error-case mockups

**User abort (Ctrl+C) mid-stream:**

```
━━ [2] summarize · agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/.../c3a9fb12-...jsonl
Based on the chat session, here is the summary: ralph-cli is organized into
four layers. The att
✗ abort · user-interrupt · turns: 0 · 120/48 tok · 1.9s
```

**Claude subprocess crash:**

```
━━ [2] summarize · agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  trace: /Users/josu/.claude/projects/.../c3a9fb12-...jsonl
Based on the chat session …
✗ fail · crash: ENOENT spawn claude · turns: 0 · 0/0 tok · 0.8s
```

## Architecture

### Shape

```
PipelineApp (root — owns state)
├── <Static items={frozen}>          ← never re-renders old items
│   └── BlockView (pure)             ← one finished node as [header · trace? · body · outcome]
└── LiveFooter                       ← re-renders on each stream event
    ├── header line (index, nodeId, label)
    ├── trace line (dim, conditional on tracePath)
    ├── body text (streaming lines, tool calls — growing in place)
    ├── status line (spinner, turn/token stats, elapsed)
    └── TextInput (conditional — only for interactive nodes while awaiting input)
```

**One `<Static>` in the entire tree.** The live footer is a plain `<Box>`. `ChatUI.tsx` is deleted, so there is no second `<Static>` anywhere.

### State model

```ts
type PipelineState = {
  frozen: Block[];        // finished blocks — append-only
  live: LiveBlock | null; // current in-flight block, or null between nodes / at end
};

type BlockKind =
  | "agent"              // non-interactive agent node
  | "interactive-agent"  // interactive=true agent node
  | "tool"               // tool handler
  | "wait-human"         // wait-human handler
  | "conditional"        // conditional branching node
  | "marker";            // plain structural nodes like start / done / exit

type Block = {
  id: string;                  // stable key for <Static>
  nodeId: string;
  label: string;
  kind: BlockKind;
  tracePath?: string;          // absolute path to ~/.claude/projects/<cwd>/<sid>.jsonl; undefined unless kind ∈ {agent, interactive-agent}
  body: BodyLine[];
  outcome: { status: "success" | "fail" | "abort"; reason?: string };
  stats: { turns: number; tokensIn: number; tokensOut: number; durationMs: number };
};

type LiveBlock = {
  id: string;
  nodeId: string;
  label: string;
  kind: BlockKind;
  tracePath?: string;          // populated asynchronously when sessionId arrives
  startedAt: number;
  body: BodyLine[];
  stats: { turns: number; tokensIn: number; tokensOut: number };
  // Interactive-only fields — present only when kind === "interactive-agent"
  child?: ChildHandle;         // reference held so submit handlers can call child.submit() / child.end()
  input?: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (v: string) => void;
  };
  onDone?: () => void;         // resolver for the engine's onInteractiveRequest Promise; called on end
};

type BodyLine =
  | { kind: "text"; role: "you" | "claude" | "system"; text: string }
  | { kind: "tool_use"; name: string; summary: string };
```

### Event model (one reducer, one `emit` entry point)

```ts
type NodeEvent =
  | { kind: "start"; nodeId: string; label: string; blockKind: BlockKind }
  | { kind: "trace-path"; sessionId: string }                      // asynchronously fills in tracePath
  | { kind: "text"; role: "you" | "claude" | "system"; text: string }
  | { kind: "tool_use"; name: string; summary: string }
  | { kind: "interactive-ready"; child: ChildHandle; onDone: () => void }  // wires child + resolver into live
  | { kind: "end"; outcome: Outcome; stats?: Partial<Stats> };     // stats optional — reducer fills from live
```

**Reducer invariants:**

1. Only `start` creates a `live` block. `live` is null before `start` and after `end` until the next `start`.
2. Only `end` moves a block from `live` to `frozen`. Each block moves exactly once.
3. `trace-path`, `text`, `tool_use`, `interactive-ready` only mutate `live`, never `frozen`.
4. `frozen` is append-only. No element in `frozen` is ever mutated.
5. There is exactly one `setState` call per `emit` — one render per event.
6. **On `end`, if `stats` are missing or partial, the reducer fills them in from `live.stats` + `(Date.now() - live.startedAt)`.** This lets the SIGINT listener emit a bare abort event without carrying stats from outside the reducer.
7. **On `end`, if `live.onDone` is set, the reducer returns a new state AND the effect of calling `live.onDone()` is dispatched by `PipelineApp` in a `useEffect` that watches `frozen.length`.** The reducer itself stays pure — it does not call functions. Calling `onDone()` is a side effect that happens after commit (see "Impurity escape hatch" below).

**Impurity escape hatch (documented exception):**

`LiveBlock` stores two non-plain-data references: `child: ChildHandle` and `onDone: () => void`. These are passed through the reducer unchanged — the reducer never calls them. Side effects happen in two controlled places:

1. `PipelineApp` subscribes to `frozen.length` changes via `useEffect`. When a new block is frozen, it checks whether the just-frozen block had a pending `onDone` (tracked via a ref mirroring `live` before freeze) and calls it.
2. The `TextInput.onSubmit` handler wired via `live.input.onSubmit` calls `child.submit()` / `child.end()` / `child.kill()` directly. This handler is defined inside `PipelineApp` and closed over `live.child`.

This keeps the reducer pure-data while still giving the engine its Promise resolution and the input widget its subprocess handle.

## Components

### `src/cli/components/PipelineApp.tsx` (~150 LOC, new)

Root Ink component. Owns `PipelineState` via a single `useReducer`. Exposes imperative callbacks via `onReady` so the adapter in `pipeline.ts` can call `emit()` from outside the React tree.

```ts
export interface PipelineAppCallbacks {
  emit: (event: NodeEvent) => void;
  done: () => void;
}

interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  nodes: string[];                   // header line: "nodes: chat → summarize → done"
  onReady: (cbs: PipelineAppCallbacks) => void;
}

// Render
return (
  <>
    <Static items={frozen}>
      {(block, i) => <BlockView key={block.id} block={block} index={i + 1} />}
    </Static>
    {live && <LiveFooter block={live} index={frozen.length + 1} />}
  </>
);
```

`useEffect([], …)` fires `onReady` exactly once.

Also exports a sibling function:

```ts
export function renderPipelineApp(props: Omit<Props, "onReady">): Promise<{
  callbacks: PipelineAppCallbacks;
  waitUntilExit: () => Promise<void>;
}>;
```

Internally calls Ink's `render()` with `{ patchConsole: false }`. If `!process.stdout.isTTY`, sets `CI=true` in the Ink env so only the final frame is emitted (per Ink's documented non-TTY behavior).

### `src/cli/components/LiveFooter.tsx` (~100 LOC, new)

Pure rendering component. Receives a `LiveBlock` and renders its header/body/input. No internal state (the `TextInput` owns its own local buffer per the existing component).

```tsx
export function LiveFooter({ block, index }: { block: LiveBlock; index: number }) {
  return (
    <Box flexDirection="column">
      <Text>{`━━ [${index}] ${block.nodeId} · ${block.label} ` + "━".repeat(…)}</Text>
      {block.tracePath && <Text dimColor>{`  trace: ${block.tracePath}`}</Text>}
      {block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
      <Text dimColor>{statusLine(block)}</Text>
      {block.input && (
        <Box>
          <Text color="gray">{"> "}</Text>
          <TextInput
            value={block.input.value}
            onChange={block.input.onChange}
            onSubmit={block.input.onSubmit}
          />
        </Box>
      )}
    </Box>
  );
}
```

### `src/cli/components/BlockView.tsx` (~60 LOC, new)

Pure function. Renders one frozen `Block`. Exports `BodyLineView` as a named export so `LiveFooter` can import it (DRY).

```tsx
export function BodyLineView({ line }: { line: BodyLine }) {
  if (line.kind === "text") {
    return <Text><Text bold color={roleColor(line.role)}>{line.role}:</Text> {line.text}</Text>;
  }
  // tool_use
  return <Text dimColor>[tool_use: {line.name}] {line.summary}</Text>;
}

export function BlockView({ block, index }: { block: Block; index: number }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{`━━ [${index}] ${block.nodeId} · ${block.label} ` + "━".repeat(…)}</Text>
      {block.tracePath && <Text dimColor>{`  trace: ${block.tracePath}`}</Text>}
      {block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
      <Text dimColor>{outcomeLine(block)}</Text>
    </Box>
  );
}
```

### `src/cli/components/TextInput.tsx` — unchanged

Existing 115-LOC widget. Stays as-is.

### `src/cli/lib/parseClaudeEvent.ts` (~30 LOC, new)

Pure helper extracted from the current `ChatUI.tsx` stream-json handling. Translates one raw Claude Code event into zero or more `NodeEvent` values.

```ts
export function parseClaudeEvent(raw: ClaudeEvent): NodeEvent[];
```

- `assistant_delta` → `{ kind: "text", role: "claude", text }`
- `tool_use` → `{ kind: "tool_use", name, summary }`
- `result` / `message_stop` → no event; caller tracks turn closure via subsequent events
- `system_init` / whatever event exposes `sessionId` → `{ kind: "trace-path", sessionId }`
- unknown / malformed → `[]`

Unit-testable in isolation with no Ink dependency.

### `src/cli/lib/claudeTracePath.ts` (~15 LOC, new)

```ts
import { homedir } from "os";
import { join } from "path";

export function claudeTracePath(sessionId: string, projectDir: string = process.cwd()): string {
  const encoded = projectDir.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}
```

### `src/cli/lib/pipelineReducer.ts` (~80 LOC, new)

Pure reducer invoked from `PipelineApp`'s `useReducer`. Handles each `NodeEvent` variant per the invariants above. Unit-tested in isolation — no React, no Ink.

```ts
export function pipelineReducer(state: PipelineState, event: NodeEvent): PipelineState;
```

The reducer stores `child` and `onDone` references inside `LiveBlock` but never invokes them — side effects are dispatched by `PipelineApp` (see "Impurity escape hatch" above).

### `src/cli/lib/classifyNode.ts` (~20 LOC, new)

Two tiny helpers used by the adapter in `pipeline.ts`:

```ts
import type { Node } from "../../attractor/types.js";

export function classifyNode(node: Node): BlockKind {
  // Mirrors pipeline.ts's existing shapeToType() but maps to the new BlockKind union.
  // Agent nodes with interactive=true → "interactive-agent"
  // Agent nodes with interactive=false → "agent"
  // tool/wait-human/conditional → same-name BlockKind
  // Everything else (start, exit, done, Mdiamond shapes, etc.) → "marker"
}

export function isInteractive(node: Node): boolean {
  return classifyNode(node) === "interactive-agent";
}
```

Unit-tested via `classifyNode.test.ts` with one case per node kind the engine can produce.

### `src/cli/lib/slash-commands.ts` — already exists, reused

The existing `parseSlashCommand` function in `src/cli/lib/slash-commands.ts` and its existing test file `src/cli/tests/slash-commands.test.ts` are **reused unchanged**. No new slash-command parser is introduced. The `TextInput.onSubmit` handler inside `PipelineApp` imports `parseSlashCommand` and dispatches `/end` → `child.end()`, `/abort` → `child.kill()`, plain text → `child.submit(text)`.

### `src/cli/commands/pipeline.ts` — adapter shim (~20 LOC added)

Thin translation between engine callbacks and `NodeEvent`s:

```ts
const { callbacks, waitUntilExit } = await renderPipelineApp({
  pipelineName, pid, nodes, goal,
});

await runPipeline(graph, {
  onNodeStart: (node) => callbacks.emit({
    kind: "start",
    nodeId: node.id,
    label: node.kind,
    blockKind: classifyNode(node),
  }),

  onStdout: async (stream) => {
    for await (const raw of stream) {
      for (const ev of parseClaudeEvent(raw)) callbacks.emit(ev);
    }
  },

  // Engine contract still passes { session, child, tracePath } — we ignore the legacy tracePath
  // (old ralph-runs directory) in favor of deriving the Claude session transcript path from
  // child.sessionId via the trace-path event. No engine change.
  onInteractiveRequest: ({ child }) => new Promise((resolve) => {
    callbacks.emit({ kind: "interactive-ready", child, onDone: resolve });
    // If the sessionId is already known at handoff time, emit trace-path immediately;
    // otherwise parseClaudeEvent will emit it when system_init arrives.
    if (child.sessionId) {
      callbacks.emit({ kind: "trace-path", sessionId: child.sessionId });
    }
    (async () => {
      try {
        for await (const ev of child.events) {
          for (const nev of parseClaudeEvent(ev)) callbacks.emit(nev);
        }
      } catch (err) {
        callbacks.emit({
          kind: "end",
          outcome: { status: "fail", reason: `crash: ${(err as Error).message}` },
          // stats omitted — reducer fills from live.stats
        });
        // onDone is called by PipelineApp's post-commit effect when the block freezes
      }
    })();
  }),
});

callbacks.done();
await waitUntilExit();
```

The legacy `tracePath` field in `InteractiveRequest` (pointing to the ralph-runs directory) continues to flow through the engine interface — the adapter simply ignores it. No engine change is required. The new trace path (Claude session transcript) is derived entirely inside the adapter + reducer from `child.sessionId`.

### Files deleted

- `src/cli/components/PipelineDisplay.tsx` (108 LOC) — replaced by `PipelineApp.tsx`
- `src/cli/components/ChatUI.tsx` (277 LOC) — dissolved into `LiveFooter.tsx`
- `src/cli/tests/ChatUI.test.tsx` — coverage replaced by `LiveFooter.test.tsx` + `pipelineReducer.test.ts`
- `src/cli/tests/pipeline-interactive.test.tsx` — coverage replaced by `PipelineApp.test.tsx` + the new smoke test

**Files preserved unchanged:**
- `src/cli/components/TextInput.tsx` + `src/cli/tests/TextInput.test.tsx`
- `src/cli/lib/slash-commands.ts` + `src/cli/tests/slash-commands.test.ts`
- All other cli test files

**Net LOC change (component code only):** −385 deleted, +~355 added, net −30. The rewrite is slightly smaller than the current component code while adding `classifyNode.ts` and `pipelineReducer.ts` as new pure modules.

## Data flow

### Event sequence for one interactive agent node

```
engine                          pipeline.ts adapter               PipelineApp (reducer + effects)
  │                                    │                                   │
  │── onNodeStart(chat) ───────────────▶│                                   │
  │                                    │── emit(start) ───────────────────▶│ live = {chat, body:[], stats:{...}}
  │                                    │                                   │
  │── onInteractiveRequest() ──────────▶│                                   │
  │   (engine blocks on Promise)        │── emit(interactive-ready,         │
  │                                    │    child, onDone=resolve) ──────▶│ live.child = child
  │                                    │                                   │ live.onDone = resolve
  │                                    │                                   │ live.input = TextInput binding
  │                                    │                                   │
  │                                    │  [if child.sessionId already set:] │
  │                                    │── emit(trace-path, sessionId) ──▶│ live.tracePath = claudeTracePath(sid)
  │                                    │                                   │
  │                                    │  [user types "hi" — submit        │
  │                                    │   handler inside PipelineApp      │
  │                                    │   closes over live.child]         │
  │                                    │                                   │◀── onSubmit("hi") (via TextInput)
  │                                    │                                   │── calls live.child.submit("hi")
  │                                    │                                   │── (also dispatches {text, "you", "hi"}
  │                                    │                                   │    through the reducer)
  │                                    │                                   │
  │                                    │  [system_init event on stream]    │
  │                                    │── emit(trace-path, sessionId) ──▶│ live.tracePath = compute()
  │                                    │  (idempotent if already set)      │
  │                                    │                                   │
  │                                    │  [claude streams back]            │
  │                                    │── emit(text, "claude", chunk)───▶│ live.body += chunk
  │                                    │                                   │
  │                                    │  [user types "/end"]              │
  │                                    │                                   │◀── onSubmit("/end")
  │                                    │                                   │── parseSlashCommand → "end"
  │                                    │                                   │── live.child.end() (no dispatch)
  │                                    │                                   │
  │                                    │  stream drains (events end)       │
  │                                    │                                   │
  │◀── handler returns ────────────────│── emit(end, outcome) ───────────▶│ reducer: freeze live → frozen[]
  │                                    │  (reducer fills stats from live)  │ live = null
  │                                    │                                   │
  │                                    │                                   │── useEffect sees frozen.length++
  │                                    │                                   │── calls previous live.onDone()
  │                                    │◀──── Promise resolves ─────────────────────────────────────────────┤
  │                                    │                                   │
  │── onNodeStart(summarize) ──────────▶│── emit(start) ──────────────────▶│ live = {summarize, body:[]}
```

One reducer, one setState per event, no nested components, no overlay slots.

## Error handling

**1. Claude subprocess crash mid-stream** — the `for await (ev of child.events)` loop in the adapter is wrapped in `try/catch`. On throw, adapter emits a synthetic `end` event with `{status: "fail", reason: "crash: <message>"}` (no `stats` — reducer fills from `live`). The `onDone` resolver stored on `live` is called by `PipelineApp`'s post-commit `useEffect` when the block freezes, unblocking the engine.

**2. User Ctrl+C** — `pipeline.ts` registers a `SIGINT` listener that:
1. Emits `{ kind: "end", outcome: { status: "abort", reason: "user-interrupt" } }` — **stats omitted**. The reducer auto-fills stats from `live.stats` + `(Date.now() - live.startedAt)` per invariant #6. This keeps the SIGINT listener decoupled from reducer state.
2. The reducer freezes the current `live` block and sets `live = null`.
3. `PipelineApp`'s post-commit effect invokes any pending `live.onDone()` to unblock the engine.
4. The adapter catches the `runPipeline` promise settlement and calls `callbacks.done()` to exit Ink cleanly.

**3. Slash commands (`/end`, `/abort`, `/help`)** — parsing uses the **existing** `src/cli/lib/slash-commands.ts` module (no new parser). That module's `SlashCommand` union is `end | abort | help | unknown | message`. The `TextInput.onSubmit` handler wired via `live.input.onSubmit` inside `PipelineApp` imports `parseSlashCommand` and dispatches:
- `end` → `live.child.end()` (graceful close, no further dispatch)
- `abort` → `live.child.kill()`
- `help` → dispatches a `{kind:"text", role:"system", text: HELP_TEXT}` event through the reducer (shows help inline, no child interaction)
- `unknown` → same as `help` fallback, showing a short "unknown command" system line
- `message` → dispatch `{kind:"text", role:"you", text}` through the reducer, then call `live.child.submit(text)` (the supported method on `ChildHandle` — there is no `child.stdin`)

**4. Non-TTY (CI, piped output)** — detected at `renderPipelineApp()` entry. `renderPipelineApp` passes `{ patchConsole: false }` to Ink; sets `CI=true` if `!process.stdout.isTTY`. Ink emits only the final frame; no ANSI cursor motion in logs.

**5. `patchConsole: false`** — explicit in the `render()` call. No handler code calls `console.log`. Any log-like output goes through `emit({ kind: "text", role: "system", text })`.

**6. Engine-level error** — the adapter's `runPipeline()` call is wrapped in `try/catch`. On throw, emit a synthetic `end` with `fail` outcome, call `done()`, let Ink unmount, then re-throw to stderr.

## Testing strategy

### Layer 1 — Pure-function unit tests (no React, no Ink)

- `parseClaudeEvent.test.ts` — 6-8 cases: `assistant_delta`, `tool_use`, `result`, `system_init` → `trace-path`, `message_stop`, multi-block content, malformed input, empty content.
- `claudeTracePath.test.ts` — 4 cases: Unix absolute path, cwd with nested directories, empty sessionId handling, homedir expansion.
- `classifyNode.test.ts` — one case per `BlockKind`: agent, interactive-agent, tool, wait-human, conditional, marker.
- `pipelineReducer.test.ts` — ~12 scripted scenarios covering every state transition, including:
  - `end` with explicit stats → uses them
  - `end` with omitted stats → reducer fills from `live` (SIGINT case, invariant #6)
  - `interactive-ready` stores `child` + `onDone` on `live` without invoking them
  - crash mid-stream → synthetic `end` freezes block with `live.stats` preserved

**Note on slash-command parsing:** not listed here because it is already covered by the existing `src/cli/tests/slash-commands.test.ts`. This redesign reuses the existing module unchanged.

**Critical regression assertion** (the single test that would have caught all three original bugs):

```ts
it("frozen blocks survive subsequent live updates and state changes", () => {
  let s = reducer(initial, { kind: "start", nodeId: "chat", label: "interactive agent", blockKind: "interactive-agent" });
  s = reducer(s, { kind: "trace-path", sessionId: "sid-a" });
  s = reducer(s, { kind: "text", role: "you", text: "hello" });
  s = reducer(s, { kind: "text", role: "claude", text: "hi there" });
  s = reducer(s, { kind: "end", outcome: { status: "success" }, stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 1200 } });

  // second node starts
  s = reducer(s, { kind: "start", nodeId: "summarize", label: "agent", blockKind: "agent" });
  s = reducer(s, { kind: "text", role: "claude", text: "here is a summary" });

  expect(s.frozen).toHaveLength(1);
  expect(s.frozen[0].nodeId).toBe("chat");
  expect(s.frozen[0].tracePath).toContain("sid-a.jsonl");
  expect(s.frozen[0].body.map(b => b.kind === "text" && b.text)).toEqual(["hello", "hi there"]);
  expect(s.live?.nodeId).toBe("summarize");
  expect(s.live?.body).toHaveLength(1);
});
```

### Layer 2 — Ink component tests (`ink-testing-library`)

- `BlockView.test.tsx` — snapshot each block state that actually produces a visible block: agent success, agent fail, agent abort, interactive-agent ended, marker node (no trace path, no body, just a completion line). 5 snapshots. Each asserts the rendered text contains the expected header, trace-path conditional, body, and outcome line. `tool`, `wait-human`, and `conditional` blocks use the same `BlockView` component so they are covered by the marker + agent tests; dedicated snapshots for those kinds are added only if the visual treatment ever diverges.
- `LiveFooter.test.tsx` — 5 cases: with/without `input`, with/without `tracePath`, with streaming body, with empty body.
- `PipelineApp.test.tsx` — 3 end-to-end React cases using `onReady` to inject events:
  1. Feed `start → text → text → end`, assert one frozen block with combined body
  2. Feed `start → interactive-ready → text (you) → text (claude) → end`, assert frozen block contains both lines
  3. Feed two nodes in sequence, assert two frozen blocks + `live === null`

### Layer 3 — Smoke test (real stdout)

`scenario-tests/rendering/chat-block-freeze.test.ts` — spawns the actual `ralph pipeline run pipelines/smoke/chat-end-to-end.dot` with a scripted stdin, captures real ANSI stdout, asserts:

1. `━━ [1] chat` appears exactly once
2. `✓ ended` appears exactly once (not three times)
3. `━━ [2] summarize` header appears after the chat block
4. Final frame contains `━━ [3] done` and the completion line
5. No `┌───┐` sequence anywhere (the current bug's signature)
6. Matches `/trace: .*\.claude\/projects\/.*\.jsonl/` at least twice (chat + summarize blocks)

### Manual verification gate

Before declaring the rewrite done:

```
$ ralph pipeline run pipelines/smoke/chat-end-to-end.dot
[chat interactively, type /end]
```

Human eyeball check on a real terminal:
- no stacked empty borders
- `trace:` line appears under every agent block's header
- `summarize` block is visible with streaming body
- `done` block is visible with completion marker
- final status line appears below all blocks

## Risks

**1. Long chat transcripts exceed terminal height in the live footer.** Per the approved design decision to keep the entire chat transcript in the live footer until `/end` (Option B), a chat that produces more lines than the terminal's visible rows will have its top lines truncated by Ink's in-place redraw. This is an accepted tradeoff — the alternative (per-turn flush) loses the coherent chat view. Mitigations documented in the implementation plan can include a configurable line cap or a "compact" renderer for long turns; out of scope for this redesign.

**2. `sessionId` extraction depends on stream-json event shape.** If Claude Code changes its event schema (e.g. renames `system_init` or moves `sessionId` under a different key), the `parseClaudeEvent` helper breaks. Mitigated by: the helper is pure, unit-tested, easy to update in one place; failure mode is "no trace line shown" rather than rendering corruption.

**3. Ink 6.8.0 `<Static>` behavior** is relied on heavily. Any upgrade that changes `<Static>` semantics could regress the design. Mitigated by: explicit Ink version pin; smoke test asserts on real stdout.

## Invariants (must not break)

1. Exactly one `<Static>` component in the entire rendered tree.
2. `frozen` is append-only; no element is ever mutated after being pushed.
3. A block moves from `live` to `frozen` exactly once, via the `end` event.
4. `live` is null before the first `start` and after each `end` until the next `start`.
5. The reducer is pure — it takes state + event, returns new state, calls nothing, mutates nothing. Any non-plain-data references (`child`, `onDone`) are passed through unchanged.
6. All reducer state mutation flows through `callbacks.emit(event)`. The only components that read or write `PipelineState` are `PipelineApp` (owns the `useReducer`) and `pipeline.ts` (calls `emit`). Side effects on stored references (`child.submit`, `child.end`, `child.kill`, `onDone()`) happen in two places only: the `TextInput.onSubmit` handler closed over `live.child` inside `PipelineApp`, and a `useEffect` inside `PipelineApp` watching `frozen.length` that dispatches pending `onDone` callbacks.
7. `patchConsole: false` — no handler calls `console.*` directly.
8. No handler imports or calls Ink's `render()` directly. Ink is owned by `renderPipelineApp()` alone.
9. All user input to Claude subprocesses flows through `ChildHandle.submit(text)`. The adapter and `PipelineApp` never touch `child.stdin` (there is no such property on `ChildHandle`).

## Out of scope

- Any engine refactor (onNodeEvent unified callback, EventEmitter patterns).
- Any change to handler files in `src/attractor/handlers/`.
- Any change to the daemon or checkpoint subsystems.
- Any change to `TextInput.tsx`.
- Long-chat scrollback mitigation (accepted tradeoff per Option B).
- Windows path support (current codebase is macOS/Linux only).
