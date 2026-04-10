---
id: spec-2026-04-10-interactive-ink-overlay
type: spec
created: 2026-04-10
status: draft
tags: [pipeline, interactive-nodes, ink, terminal-rendering, agent-handler]
---

# Single Ink Tree for Interactive Pipeline Nodes

## Problem

Pipeline runs with `interactive=true` nodes mount **two concurrent Ink instances** that both claim the same stdout:

- The long-lived outer `PipelineDisplay` (mounted in `pipeline.ts:93` via `renderPipelineDisplay()`) renders pipeline progress via `<Static>` + a dim status box.
- The short-lived inner `ChatUI` (mounted in `agent-handler.ts:126` via a lazy `ink.render()` import) renders the interactive chat.

Ink 6.8.0 uses `log-update` to own a dynamic region of stdout and patches `console.*` (`patchConsole: true` by default). Running two instances concurrently produces:
- Competing `log-update` cursor tracking — each instance thinks it owns the dynamic region.
- Mutually exclusive `patchConsole` — the last instance to unmount restores the *original* console, not the outer instance's intercept.
- A broken handoff when the inner unmounts: the outer's subsequent `<Static>` re-renders for downstream nodes are rendered but visually lost.

### Observed symptom

Running `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`:
- User types `/end` in the interactive `chat` node.
- ChatUI prints `status: ended | turns: 3 | in/out: 3/249`.
- Shell prompt returns immediately with no `summarize` or `done` output.

### Evidence the engine actually ran

Checkpoint files at `~/.ralph/runs/chat_end_to_end/` prove the engine did execute all downstream nodes:
- `completedNodes: ["start", "chat", "summarize", "done"]`
- `summarize/status.json` = `success`, `summarize/raw-output.txt` contains a valid JSON summary.
- Mtimes match the user's session (±0 seconds), so the checkpoint is fresh, not stale.

The engine ran correctly. The rendering was the failure.

## Goals

1. Interactive nodes and pipeline progress render from a **single Ink instance**.
2. `chat-end-to-end.dot` completes visibly end-to-end after `/end`.
3. Chat sessions display a **header with the path to the trace directory** (`<logsRoot>/<node.id>/`).
4. Generic overlay design: a pipeline may have zero, one, or many interactive nodes in sequence.
5. No change to non-interactive pipeline behavior or output.
6. `ChatUI` remains mountable standalone so its unit tests stay simple.

## Non-goals

- No change to child-process lifecycle (`Agent.runInteractive`, `Session`, `ChildHandle`, `buildSessionDigest`).
- No change to `<Static>` layout or the outer status box visual style.
- No attempt to support concurrent interactive nodes (parallel fan-out of chats).

## Design

### Architecture

```
pipeline.ts
  └─ renderPipelineDisplay()        ──► single Ink render root
       PipelineDisplay.tsx
         ├─ <Static items={lines}>                 (append-only history)
         ├─ {overlay && <ChatUI {...overlay}/>}    (dynamic chat slot)
         └─ <StatusBox/>                           (always visible below)

runPipeline(graph, { ..., onInteractiveRequest })
  └─ engine meta bag carries onInteractiveRequest
        └─ AgentHandler.execute → interactive branch:
             agent.runInteractive()    // spawn child, build Session
             await meta.onInteractiveRequest({ session, child, tracePath })
             buildSessionDigest(session) → Outcome
```

**Principle:** the outer `PipelineDisplay` owns the one and only `render()` call for the run. `ChatUI` is mounted as a child component via an `overlay` state slot — never via a second `render()`.

### Data flow

1. Engine reaches an interactive node → builds `meta` with `onInteractiveRequest` field.
2. `AgentHandler.execute()` spawns the child via `agent.runInteractive()` (creates `Session` + `ChildHandle`).
3. Handler calls `await meta.onInteractiveRequest({ session, child, tracePath: nodeDir })`.
4. `pipeline.ts`'s callback sets `overlay` state → React re-renders `PipelineDisplay` with `<ChatUI ...overlay/>` as a sibling of `<Static>` and above the status box.
5. User chats; ChatUI writes to `child.stdin` and reads events from `child.events`.
6. User types `/end` → ChatUI invokes its `onExit(reason)` prop.
7. `pipeline.ts`'s `onExit` sets `overlay = null` (React re-render removes ChatUI, status box + Static remain) and resolves the promise.
8. Handler awaits `child.exited` (5-second race, then SIGKILL), builds the session digest, returns `Outcome`.
9. Engine routes to next edge; pipeline progress continues printing into the already-running Static. All subsequent renders come from the same Ink instance that never unmounted.

### Components

#### `src/cli/components/PipelineDisplay.tsx`

**New imports:**
```ts
import { ChatUI } from "./ChatUI.js";
import type { Session, ExitReason } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";
```

**New exported type:**
```ts
export interface ChatOverlayProps {
  session: Session;
  child: ChildHandle;
  tracePath: string;
  onExit: (reason: ExitReason) => void;
}
```

**New callback exposed via onReady:**
```ts
export interface PipelineDisplayCallbacks {
  push: (line: DisplayLine) => void;
  setStatus: (nodeLabel: string) => void;
  setOverlay: (props: ChatOverlayProps | null) => void;   // NEW
  done: () => void;
}
```

**New state declaration inside the `PipelineDisplay` component function:**
```ts
const [overlay, setOverlay] = useState<ChatOverlayProps | null>(null);
```

The `onReady` effect must expose the `useState` setter **directly** (stable reference across renders — React guarantees this). Do not wrap it in a closure:

```ts
useEffect(() => {
  onReady({
    push: (line) => setLines(prev => [...prev, line]),
    setStatus: (label) => setCurrentNode(label),
    setOverlay,          // NEW — pass the setter directly
    done: () => exit(),
  });
}, []);   // onReady fires exactly once on mount
```

**Render tree:**

```tsx
<>
  <Static items={lines}>
    {(line, i) => <Box key={i}><DisplayLineComponent line={line}/></Box>}
  </Static>
  {overlay && <ChatUI {...overlay}/>}
  <Box borderStyle="single" borderColor="cyan">
    {/* existing status box — retained below overlay per design decision */}
  </Box>
</>
```

The status box is **retained** below the overlay so pipeline progress context stays visible during chat. The overlay object identity is stable across unrelated parent state updates because `pipeline.ts` constructs the `ChatOverlayProps` object exactly once per interactive node invocation (not in render). This prevents accidental `ChatUI` remount when `setLines` or `setCurrentNode` fire.

#### `src/cli/components/ChatUI.tsx`

New required prop:

```ts
interface Props {
  session: Session;
  child: ChildHandle;
  tracePath: string;   // NEW — absolute path to node's trace directory
  onExit: (reason: ExitReason) => void;
}
```

New header rendered above the conversation area:

```tsx
<Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
  <Text dimColor>trace: </Text>
  <Text>{tracePath}</Text>
</Box>
```

No other internal changes. Component remains standalone-mountable for unit tests (tests pass a placeholder `tracePath="/tmp/test-trace"`).

#### `src/attractor/handlers/agent-handler.ts`

**Remove** (anchored by symbol name, not line number, to avoid drift):
- `import React from "react"` statement at the top of the file
- `InkRenderFn` type alias
- `render?: InkRenderFn` field on `AgentHandlerDeps`
- `this.render` member declaration and constructor wiring
- Inside the `if (interactive) { ... }` branch: the lazy Ink import (`await import("ink")`), the lazy ChatUI import (`await import("../../cli/components/ChatUI.js")`), the `new Promise<ExitReason>((resolvePromise) => { ... })` block that calls `renderFn!(React.createElement(ChatUIComponent, ...))` and schedules `instance.unmount()` via `child.exited.finally()`

**Replace** that removed block with:

```ts
// nodeDir is already in scope from earlier in execute():
//   const nodeDir = join(logsRoot, node.id);
// (near the top of the method, before the interactive branch)

const onInteractiveRequest = meta["onInteractiveRequest"] as
  | OnInteractiveRequest
  | undefined;

if (!onInteractiveRequest) {
  try { await child.kill("SIGKILL"); } catch {}
  return {
    status: "fail",
    failureReason: "interactive=true node requires onInteractiveRequest in engine options",
  };
}

await onInteractiveRequest({ session, child, tracePath: nodeDir });
```

The callback returns `Promise<void>`. The handler does **not** consume a returned reason — `session.exitReason` is set in place by `ChatUI` via the mutable `Session` object, and `buildSessionDigest(session)` reads it directly. Deriving truth from `session` (single source) avoids drift between the returned reason and the digest.

**New exported types** (add to `src/attractor/handlers/agent-handler.ts`, or extract to a new `src/attractor/handlers/interactive-request.ts` if preferred):

```ts
import type { Session } from "../../cli/lib/session.js";
import type { ChildHandle } from "../../cli/lib/agent.js";

export interface InteractiveRequest {
  session: Session;
  child: ChildHandle;
  tracePath: string;
}

export type OnInteractiveRequest =
  (req: InteractiveRequest) => Promise<void>;
```

**No `InteractiveResult` type** — the callback resolves with `void` when the overlay has been cleared. The handler's existing `Promise.race([child.exited, 5s timeout])` cleanup runs after the callback returns.

Everything else in the interactive branch (child spawn via `agent.runInteractive()`, the `Promise.race` cleanup, `buildSessionDigest`, `contextUpdates` flattening, writing `digest.json`, returning the `Outcome`) stays exactly as-is.

#### `src/attractor/core/engine.ts`

- Add `onInteractiveRequest?: OnInteractiveRequest` to `EngineOptions`.
- In the meta-record construction site (same place `onStdout` is wired), add:
  ```ts
  onInteractiveRequest: opts.onInteractiveRequest,
  ```

#### `src/cli/commands/pipeline.ts`

Destructure new callback from PipelineDisplay callbacks:
```ts
const { push, setStatus, setOverlay, done } = callbacks;
```

Pass `onInteractiveRequest` to `runPipeline` (callback returns `Promise<void>`):
```ts
onInteractiveRequest: ({ session, child, tracePath }) =>
  new Promise<void>((resolve) => {
    let handled = false;
    // Construct overlayProps object once, outside any render, so its identity
    // stays stable for the duration of the chat (prevents ChatUI remount).
    const overlayProps: ChatOverlayProps = {
      session,
      child,
      tracePath,
      onExit: (_reason) => {
        if (handled) return;
        handled = true;
        setOverlay(null);
        resolve();
      },
    };
    setOverlay(overlayProps);
  }),
```

Re-entrance (loop back to the same interactive node) is safe: each invocation of the outer callback creates a fresh `handled` flag in its own closure, and `setOverlay` always replaces the previous overlay state.

### Error handling

| Scenario | Behavior |
|---|---|
| `onInteractiveRequest` undefined in engine options | Handler kills child, returns `fail` with a clear reason. `EngineOptions.onInteractiveRequest` is `?` (optional) — non-pipeline callers (`plan`, `implement`) that never encounter `interactive=true` nodes are not required to pass a stub. The fail path only triggers if an actual interactive node is reached without the callback. |
| `onExit` called twice (child crash race) | `handled` flag in the pipeline.ts callback closure drops the second call. Overlay cleared once. |
| Child crash during chat | ChatUI's existing crash-detect path sets `exitReason = "child_crash"` → fires `onExit("child_crash")` → overlay clears → handler's existing `child.exited` race resolves → `buildSessionDigest` produces `success: false` → handler returns `fail` Outcome. |
| SIGINT during chat | ChatUI's SIGINT handler fires `onExit("abort")`; pipeline.ts's SIGINT handler aborts the AbortController on the engine. Both are idempotent and scoped via useEffect cleanup / `process.off` respectively. |
| Multiple interactive nodes in sequence | Overlay slot is set and cleared per node. Each `onInteractiveRequest` invocation gets a fresh closure with its own `handled` flag. React remounts ChatUI when the overlay object identity changes between invocations, which is the desired behavior. |
| `child.exited` never resolves after overlay cleared | Existing 5-second `Promise.race` timeout in the handler kills the child forcibly. |

### Testing

**Updated:**

- `src/attractor/tests/agent-handler-interactive.test.ts` — remove `render: stubRender` from every `new AgentHandler(...)` call. Replace with an inline `onInteractiveRequest` stub on the meta bag passed to `execute()`. The stub must preserve equivalent behavior to the removed `stubRender`: it mutates the `Session` object to simulate what `ChatUI` would have done, then resolves.

  **Shared helper** (add to the test file):
  ```ts
  // Stub that simulates ChatUI: set session.exitReason, resolve void
  const makeInteractiveStub = (reason: ExitReason) =>
    (async ({ session, child }) => {
      // Drain events to populate session.history as ChatUI would
      (async () => {
        try { for await (const _ev of child.events) { /* ChatUI would route here */ } } catch {}
      })();
      session.exitReason = reason;
      await child.end();
    }) satisfies OnInteractiveRequest;
  ```

  **Usage per test** — tests that assert `status: "success"` pass `makeInteractiveStub("user_end")`; tests that assert `status: "fail"` pass `makeInteractiveStub("abort")`. The `baseMeta(tmp, tmp)` helper gains a third optional parameter for the stub, or each test spreads it inline:
  ```ts
  const meta = { ...baseMeta(tmp, tmp), onInteractiveRequest: makeInteractiveStub("user_end") };
  ```

  Test-by-test migration: the "flattens digest into contextUpdates" test needs the stub to populate enough session state that `buildSessionDigest` returns a non-empty output. If the current `stubRender` pushes specific `session.history` entries, the new stub must do the same — copy those mutations into the stub body.

  Exact test count to migrate: verify via `grep -c '^  it(' src/attractor/tests/agent-handler-interactive.test.ts` before starting. Spec assumes ~6 but any number should be migrated the same way.

- `src/cli/components/PipelineDisplay.test.tsx` — assert `setOverlay` is present in the `onReady` callbacks shape. Add one test: "onReady exposes setOverlay callback" that constructs the display, captures `onReady` args, asserts `typeof cbs.setOverlay === "function"`.

- `src/cli/tests/ChatUI.test.tsx` — add `tracePath="/tmp/test-trace"` to every `<ChatUI ... />` render. Mechanical change, no assertion updates. Exact count: verify via `grep -c '<ChatUI' src/cli/tests/ChatUI.test.tsx` before starting.

**Unaffected:**
- `src/attractor/tests/agent-handler.test.ts` — non-interactive path only, uses `mockRunInteractive` mock; no `render` coupling.
- `src/cli/tests/TextInput.test.tsx` — standalone component test.
- Scenario/smoke tests — operate on .dot files, not component internals.
- All non-interactive pipeline tests.

**New:**
- `src/cli/tests/pipeline-interactive.test.tsx` — integration test using `ink-testing-library` (already used by existing `PipelineDisplay.test.tsx`):
  1. Render `PipelineDisplay` via the existing `renderPipelineDisplay()` helper pattern.
  2. Push some Static lines to simulate pipeline progress (e.g. `push({kind:"step", text:"[start]"})`).
  3. Invoke `setOverlay({ session: fakeSession, child: fakeChild, tracePath: "/tmp/t", onExit })`.
  4. Assert `<Static>` content still present, ChatUI rendered as child, trace path header visible containing `/tmp/t`.
  5. Simulate exit: invoke the captured `onExit("user_end")`.
  6. **Post-fix regression assertion:** after `setOverlay(null)`, push a new `DisplayLine` via `push()` and assert it appears in the rendered output. This directly proves the bug is fixed — subsequent pipeline output is not lost after chat ends.
  7. Assert the status box is still visible.

- Manual smoke test: `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`, verify `summarize` and `done` outputs appear after `/end`.

## Implementation order

1. Extend `PipelineDisplay` with `overlay` state + `setOverlay` callback (no runtime effect yet).
2. Add `OnInteractiveRequest` type and `onInteractiveRequest` to `EngineOptions` + meta construction in `engine.ts`.
3. Add `tracePath` prop + header to `ChatUI` (update its unit tests in the same step).
4. Refactor `agent-handler.ts` interactive branch: remove Ink imports, add `onInteractiveRequest` call.
5. Wire `onInteractiveRequest` callback in `pipeline.ts`.
6. Update `agent-handler-interactive.test.ts` (6 tests) and `PipelineDisplay.test.tsx` (3 tests).
7. Add `pipeline-interactive.test.tsx` integration test.
8. Manual smoke test via `chat-end-to-end.dot`.
9. Run full test suite to catch regressions.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `<Static>` + dynamic overlay layout bugs | Ink 6 explicitly supports Static siblings with dynamic components (the existing status box is already a dynamic sibling). Low risk. |
| Ink re-renders ChatUI on every parent state change | ChatUI's props are stable (session, child, tracePath, onExit are set once per interactive node). React reconciler won't remount. |
| SIGINT handler duplication (ChatUI + pipeline.ts) | Both are idempotent and scoped via useEffect cleanup / process.off. Verified in ChatUI source. |
| TextInput stdin single-consumer rule | `useInput` is called only by TextInput (inside ChatUI). `PipelineDisplay` does not call `useInput` or `useStdin`. Confirmed by source read. |
| Breaking external consumers of `AgentHandlerDeps.render` | Field is internal-only (used only by tests). Removal is safe. |

## Rollout

Single PR. No migration. Smoke-test validates the fix end-to-end.

**Backward compatibility:**
- `AgentHandlerDeps.render` is removed. Grepped the codebase: only `src/attractor/tests/agent-handler-interactive.test.ts` consumes this field. No production callers. The exported `AgentHandlerDeps` type changes shape but has no external consumers (ralph-cli is an application, not a library); removing the field without a deprecation cycle is safe.
- `EngineOptions.onInteractiveRequest` is a new optional field. Non-additive only — no existing caller needs updating.
- `PipelineDisplayCallbacks.setOverlay` is a new required field on the callbacks object. `PipelineDisplay.test.tsx` needs a minor update to assert its presence; no production callers outside `pipeline.ts`.

If the user later wants the outer status box hidden during chat (instead of retained), that's a one-line conditional in `PipelineDisplay.tsx` — not in scope for this spec.

## Alternatives considered (brief)

- **Prop-based `overlay` on `PipelineDisplay` instead of `onReady` callback slot.** Rejected: `pipeline.ts` lives outside React and cannot re-render `PipelineDisplay` with new props. The existing `onReady` pattern exposes React setters directly and is the idiomatic way to bridge non-React caller code into Ink state.
- **Option A (plain stdout for outer) / Option C (pause-resume outer Ink).** Option A sacrifices the live status box; Option C requires fragile Ink remount semantics. Option B (this spec) preserves the status box, keeps the single-render-root invariant, and produces the smallest diff in `pipeline.ts` and `engine.ts`.
