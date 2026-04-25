---
status: implemented
---

# Interactive Ink Overlay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pipeline runs with `interactive=true` nodes render from a single Ink tree so downstream pipeline output (e.g. `summarize`, `done`) is not visually lost after the user exits an interactive chat.

**Architecture:** The root cause is that `agent-handler.ts` calls `ink.render(<ChatUI/>)` while `pipeline.ts` has already called `render(<PipelineDisplay/>)` — two renders on the same stdout, which the Ink docs explicitly say is unsupported. Fix: `PipelineDisplay` gains a `chat` state slot and renders `<ChatUI>` as a conditional child. The handler signals "time to chat" through a new `onInteractiveRequest` callback threaded via `EngineOptions` → handler `meta`. `pipeline.ts` wires that callback to `setChat`, and the handler no longer imports Ink at all.

**Tech Stack:** TypeScript, Ink 6 (React for terminals), Vitest, `ink-testing-library`, commander, tsup.

**Spec:** `docs/superpowers/specs/2026-04-10-interactive-ink-overlay-design.md`

**Ground-truth file state (captured 2026-04-10):**
- `Session` constructor: `new Session(id: string)` — `exitReason` starts `undefined`.
- `buildSessionDigest` already falls back to `"user_end"` when `session.exitReason` is undefined, so no initialization change is needed.
- `agent-handler-interactive.test.ts` has **6** `it(...)` cases total, of which **4** use `render: stubRender` (the ones that actually reach the Ink render path). The other 2 return early before the render path and do not use the stub — leave them alone. Migrate only the 4.
- `ChatUI.test.tsx` has **5** `<ChatUI ...>` usages. `tracePath` is optional → **zero migrations**.
- `PipelineDisplay.test.tsx` has **5** `it(...)` cases. One test asserts on `onReady` callback shape — extend it to include `setChat`.
- `git diff src/cli/lib/agent.ts` is empty even though git status shows `M`. Treat `agent.ts` as already clean; do not touch it.
- Handler `meta` is typed as `Record<string, unknown>` (structural, not a named interface). Adding `onInteractiveRequest` to it is additive and requires no type interface update.
- `git status` also shows `M src/cli/components/ChatUI.tsx` and `M src/cli/tests/helpers/fake-child-handle.ts` and `?? src/cli/agents/chat.md`. **Pre-flight:** inspect these before starting. If they contain in-progress work related to this spec, keep them; if they're stale, `git stash` first. The plan does not assume their contents.

**Chunk ordering is strict.** Chunk 2 depends on types and the state slot from Chunk 1. Chunk 3 depends on both Chunk 1 (`ChatProps`, `setChat` in `PipelineDisplayCallbacks`) and Chunk 2 (handler rewrite, ChatUI `tracePath` prop). Do not execute chunks out of order.

---

## Chunk 1: Type surface + engine plumbing (no behavior change)

**Outcome:** New types and state slots are in place. Overlay is always `null` because nobody sets it yet. Existing tests still pass. No user-visible change.

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts` (add exports)
- Modify: `src/attractor/core/engine.ts` (extend `EngineOptions` + meta)
- Modify: `src/cli/components/PipelineDisplay.tsx` (add `setChat` state slot)
- Modify: `src/cli/components/PipelineDisplay.test.tsx` (assert `setChat` in callbacks shape)

### Task 1.1: Export `InteractiveRequest` and `OnInteractiveRequest` types

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts`

- [ ] **Step 1: Add type exports near the top of the file, after existing imports**

Add to `src/attractor/handlers/agent-handler.ts` (after the existing imports, before `AgentHandlerDeps`):

```ts
import type { Session } from "../../cli/lib/session.js";
import type { ChildHandle } from "../../cli/lib/agent.js";

export interface InteractiveRequest {
  session: Session;
  child: ChildHandle;
  tracePath: string;
}

export type OnInteractiveRequest = (req: InteractiveRequest) => Promise<void>;
```

If `Session` or `ChildHandle` are already imported at the top of the file, do not duplicate the import — extend the existing import statement.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts
git commit -m "feat(agent-handler): export InteractiveRequest + OnInteractiveRequest types"
```

### Task 1.2: Add `onInteractiveRequest` to `EngineOptions` and thread into handler meta

**Files:**
- Modify: `src/attractor/core/engine.ts`

- [ ] **Step 1: Extend `EngineOptions` interface**

In `src/attractor/core/engine.ts`, locate `EngineOptions` and add a new optional field at the end:

```ts
import type { OnInteractiveRequest } from "../handlers/agent-handler.js";

export interface EngineOptions {
  logsRoot: string;
  cwd: string;
  interviewer: Interviewer;
  signal?: AbortSignal;
  project?: string;
  resume?: boolean;
  onNodeStart?: (node: Node) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;   // NEW
}
```

- [ ] **Step 2: Thread `onInteractiveRequest` into the handler meta bag**

Find the place in `runPipeline` where `handler.execute(node, ctx, { ...meta })` is called. Add `onInteractiveRequest: opts.onInteractiveRequest,` to the meta object literal alongside the existing `onStdout: opts.onStdout` wiring.

**No type interface to update.** `handler.execute(node, ctx, meta)` takes `meta: Record<string, unknown>` — structurally typed, not a named interface. Adding an optional field is purely additive at runtime and accepted by the type system without any declaration change. Do not hunt for a named `HandlerMeta` interface; it does not exist. Do not touch `src/attractor/core/handler.ts` for this step.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run existing engine tests**

Run: `npx vitest run src/attractor/tests/`
Expected: all existing tests still pass — we added only an optional field.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/engine.ts
git commit -m "feat(engine): plumb optional onInteractiveRequest through EngineOptions + meta"
```

### Task 1.3: Add `chat` state slot + `setChat` callback to PipelineDisplay

**Files:**
- Modify: `src/cli/components/PipelineDisplay.tsx`

This task is **state slot only** — no JSX rendering of ChatUI yet. That lands in Chunk 3. The slot exists so callers can already wire it without runtime effect.

- [ ] **Step 1: Write the failing test**

Edit the PipelineDisplay test file. Find the existing onReady test (which already has an await for useEffect). Keep that wait and extend its assertions inside the same test body:

```tsx
expect(cbs).not.toBeNull();
expect(typeof cbs!.push).toBe("function");
expect(typeof cbs!.setStatus).toBe("function");
expect(typeof cbs!.done).toBe("function");
expect(typeof cbs!.setChat).toBe("function");   // NEW
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/cli/components/PipelineDisplay.test.tsx`
Expected: FAIL with `expected undefined to be "function"` on the `setChat` line (or a TypeScript error if `setChat` isn't in the interface yet).

- [ ] **Step 3: Define `ChatProps` type and add `setChat` to `PipelineDisplayCallbacks`**

In `src/cli/components/PipelineDisplay.tsx`, add imports and a new exported type near the top (after existing imports):

```ts
import type { Session, ExitReason } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";

export interface ChatProps {
  session: Session;
  child: ChildHandle;
  tracePath: string;
  onExit: (reason: ExitReason) => void;
}
```

Extend `PipelineDisplayCallbacks`:

```ts
export interface PipelineDisplayCallbacks {
  push: (line: DisplayLine) => void;
  setStatus: (nodeLabel: string) => void;
  setChat: (props: ChatProps | null) => void;   // NEW
  done: () => void;
}
```

- [ ] **Step 4: Add `chat` state + expose setter via `onReady`**

Inside the `PipelineDisplay` function component, add a new `useState` call next to the existing ones:

```tsx
const [chat, setChat] = useState<ChatProps | null>(null);
```

Extend the `onReady` effect to pass `setChat`:

```tsx
useEffect(() => {
  onReady({
    push: (line) => setLines((prev) => [...prev, line]),
    setStatus: (nodeLabel) => setCurrentNode(nodeLabel),
    setChat,   // NEW — stable reference from useState, pass directly
    done: () => exit(),
  });
}, [onReady, exit]);
```

Do **not** wrap `setChat` in a closure. React's `useState` setter is guaranteed stable across renders, and wrapping it would create a new function identity each render — potentially triggering the `onReady` effect if the dependency array were to include it.

Prefix the unused `chat` variable with `_` if your ESLint config flags it (`const [_chat, setChat] = useState...`) — it becomes used in Chunk 3.

- [ ] **Step 5: Run test — expect pass**

Run: `npx vitest run src/cli/components/PipelineDisplay.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run full test suite — expect no regressions**

Run: `npx vitest run`
Expected: same pass count as before this chunk.

- [ ] **Step 7: Commit**

```bash
git add src/cli/components/PipelineDisplay.tsx src/cli/components/PipelineDisplay.test.tsx
git commit -m "feat(PipelineDisplay): add chat state slot + setChat callback (no runtime effect yet)"
```

---

## Chunk 2: ChatUI `tracePath` + handler rewrite + test migration

**Outcome:** `agent-handler.ts` no longer imports Ink. Interactive branch calls `meta.onInteractiveRequest` and trusts the caller to drive the UI. Tests pass with migrated stubs. `chat-end-to-end.dot` still breaks at runtime because Chunk 3 hasn't wired `pipeline.ts` yet — that's expected.

**Files:**
- Modify: `src/cli/components/ChatUI.tsx` (add optional `tracePath` prop + header)
- Modify: `src/attractor/handlers/agent-handler.ts` (rewrite interactive branch)
- Modify: `src/attractor/tests/agent-handler-interactive.test.ts` (migrate 4 tests)

### Task 2.1: Add optional `tracePath` prop + header to ChatUI

**Files:**
- Modify: `src/cli/components/ChatUI.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/cli/tests/ChatUI.test.tsx`:

```tsx
it("renders the trace path header when tracePath is provided", () => {
  const session = new Session("test-id");
  const ctrl = createFakeChildHandle();
  const { lastFrame, unmount } = render(
    <ChatUI
      session={session}
      child={ctrl.handle}
      onExit={() => {}}
      tracePath="/tmp/trace/chat-node"
    />,
  );
  expect(lastFrame()).toContain("/tmp/trace/chat-node");
  unmount();
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/cli/tests/ChatUI.test.tsx`
Expected: FAIL — either TypeScript complains about an unknown `tracePath` prop, or the frame does not contain the path.

- [ ] **Step 3: Add optional prop + header**

In `src/cli/components/ChatUI.tsx`, extend the `Props` interface:

```ts
interface Props {
  session: Session;
  child: ChildHandle;
  onExit: (reason: ExitReason) => void;
  tracePath?: string;   // NEW
}
```

Destructure `tracePath` from props. At the **top** of the returned `<Box flexDirection="column">`, add:

```tsx
{tracePath && (
  <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
    <Text dimColor>trace: </Text>
    <Text>{tracePath}</Text>
  </Box>
)}
```

The header must render **before** the `<Static>` element so it appears above the conversation history.

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/cli/tests/ChatUI.test.tsx`
Expected: PASS. All 5 existing `<ChatUI ...>` tests must still pass — the new prop is optional.

- [ ] **Step 5: Commit**

```bash
git add src/cli/components/ChatUI.tsx src/cli/tests/ChatUI.test.tsx
git commit -m "feat(ChatUI): add optional tracePath prop + trace header"
```

### Task 2.2: Migrate `agent-handler-interactive.test.ts` to use `onInteractiveRequest` stub

This task migrates tests **before** rewriting the handler so we can watch them fail, then go green when the handler rewrite lands. This is inverted TDD: the test migration itself is the "new test," the handler rewrite is the "implementation."

**Files:**
- Modify: `src/attractor/tests/agent-handler-interactive.test.ts`

- [ ] **Step 1: Add a shared stub factory near the top of the test file**

After the existing imports and helpers (`baseMeta`, etc.), add:

```ts
import type { OnInteractiveRequest } from "../handlers/agent-handler.js";
import type { ExitReason } from "../../cli/lib/session.js";

const makeInteractiveStub = (reason: ExitReason): OnInteractiveRequest =>
  async ({ session, child }) => {
    // Drain events in the background, as ChatUI would
    void (async () => {
      try {
        for await (const _ev of child.events) {
          /* consume */
        }
      } catch {
        /* stream may close abruptly in fakes */
      }
    })();
    session.exitReason = reason;
    await child.end();
  };
```

- [ ] **Step 2: Update `baseMeta` to accept an optional interactive stub**

Extend the helper:

```ts
const baseMeta = (
  cwd: string,
  logsRoot: string,
  onInteractiveRequest?: OnInteractiveRequest,
) => ({
  cwd,
  logsRoot,
  completedNodes: [] as string[],
  nodeRetries: {},
  outgoingLabels: [] as string[],
  onInteractiveRequest,
});
```

- [ ] **Step 3: Migrate each of the 4 tests that use `render: stubRender`**

Only the tests that currently have a local `const stubRender: InkRenderFn = ...;` declaration and pass `render: stubRender` to `new AgentHandler({ ... })` need migration. The other 2 tests in the file return early from the handler (before the Ink render path) and do not need changes — leave them alone.

For each of the 4 migrating tests:

1. Delete the local `const stubRender: InkRenderFn = ...;` declaration.
2. In `new AgentHandler({ ... })`, remove the `render: stubRender` field. The constructor now takes only `resolveAgent` and `createAgent`.
3. In the call to `handler.execute(node, ctx, baseMeta(tmp, tmp))`, pass a third arg: `baseMeta(tmp, tmp, makeInteractiveStub(REASON))`.

Pick `REASON` per test by reading the test's assertions:
- If the test asserts `status: "success"` or `success: true` → use `"user_end"`.
- If the test asserts `status: "fail"` or `success: false` via the abort path → use `"abort"`.
- If the test doesn't assert on status at all (e.g., only checks that `prompt.md` was written to `nodeDir`) → use `"user_end"` as the default.

If a test's assertions depend on specific `session.history` entries that the shared stub doesn't populate, define an inline stub for that test instead of using the shared factory. Do not over-generalize `makeInteractiveStub`.

- [ ] **Step 4: Remove `InkRenderFn` import**

Delete `import type { InkRenderFn } from "../handlers/agent-handler.js";` (or equivalent) if no longer used. The linter will flag it after the migration.

- [ ] **Step 5: Run the migrated tests — expect failure**

Run: `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts`
Expected: FAIL. The handler hasn't been rewritten yet, so it still tries to call `renderFn!(...)` which is now `undefined`. Errors will mention `renderFn` or `render` being undefined.

This failure is the gate. Do not proceed to Task 2.3 until the tests fail at runtime for the right reason.

- [ ] **Step 6: Do not commit yet — repo is intentionally broken**

The repo is in a broken state from the end of Step 5 through the end of Task 2.3. Do not run the full test suite in between — you will see cascading failures that are expected. The next commit lands only at the end of Task 2.3. If you must pause work here, stash the changes; do not commit.

### Task 2.3: Rewrite `agent-handler.ts` interactive branch

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts`

- [ ] **Step 1: Remove Ink-related imports and type**

Delete from `src/attractor/handlers/agent-handler.ts`:

- `import React from "react";`
- The `InkRenderFn` type alias declaration
- The `render?: InkRenderFn` field on `AgentHandlerDeps`
- The `this.render` (or equivalent) member declaration and constructor wiring
- Any import of `ChatUI` if one exists at the top (the lazy import inside `execute()` will also be deleted in Step 2)

`AgentHandlerDeps` should end up as:

```ts
export interface AgentHandlerDeps {
  resolveAgent?: (name: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}
```

- [ ] **Step 2: Rewrite the interactive branch**

In `execute()`, locate the `if (interactive) { ... }` block. Replace the `await new Promise<ExitReason>((resolvePromise) => { ... })` block — the one that constructs `React.createElement(ChatUIComponent, ...)` and schedules `instance.unmount()` — with:

```ts
const onInteractiveRequest = meta.onInteractiveRequest;

if (!onInteractiveRequest) {
  try { await child.kill("SIGKILL"); } catch {}
  return {
    status: "fail",
    failureReason:
      "interactive=true node requires onInteractiveRequest in engine options",
  };
}

await onInteractiveRequest({ session, child, tracePath: nodeDir });
```

Also delete, within the interactive branch:
- `await import("ink")` (or any lazy `import` of ink)
- `await import("../../cli/components/ChatUI.js")` (or similar)
- Any reference to `renderFn`, `ChatUIComponent`, `instance.unmount()`

**Leave untouched:**
- The child spawn via `agent.runInteractive(...)`
- The `Promise.race([child.exited, 5s timeout])` cleanup that follows
- `buildSessionDigest(session)` and `contextUpdates` flattening
- Writing `digest.json` to `nodeDir`
- The final `return { status, contextUpdates }`

- [ ] **Step 3: Run migrated interactive tests — expect pass**

Run: `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 4: Run full test suite — expect no regressions**

Run: `npx vitest run`
Expected: same pass count as before Chunk 2 started. Note in particular that `agent-handler.test.ts` (non-interactive path) should be unaffected.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

ChatUI changes from Task 2.1 are already committed separately. This commit only covers the handler rewrite and the test migration:

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-interactive.test.ts
git commit -m "refactor(agent-handler): replace direct Ink render with onInteractiveRequest callback

- Remove React/Ink imports from agent-handler; interactive branch now
  calls meta.onInteractiveRequest and lets the caller drive the UI.
- Remove render: InkRenderFn field from AgentHandlerDeps.
- Migrate the 4 agent-handler-interactive tests that used stubRender
  to use a stub onInteractiveRequest that mutates session.exitReason
  directly. The 2 tests that did not use stubRender are unchanged."
```

- [ ] **Step 7: Positive verification — no Ink imports remain in `src/attractor/`**

Run: `grep -rn "from 'ink'\|from \"ink\"" src/attractor/`
Expected: zero matches. If any match, fix before proceeding.

---

## Chunk 3: Wire pipeline.ts, render ChatUI, add integration test, smoke-test

**Prerequisites from earlier chunks:**
- `PipelineDisplayCallbacks` includes `setChat` (from Chunk 1 Task 1.3).
- `ChatProps` type is exported from `src/cli/components/PipelineDisplay.tsx` (from Chunk 1 Task 1.3).
- `EngineOptions` includes optional `onInteractiveRequest` (from Chunk 1 Task 1.2).
- `agent-handler.ts` interactive branch calls `meta.onInteractiveRequest` and has no Ink imports (from Chunk 2 Task 2.3).
- `ChatUI` accepts an optional `tracePath` prop and renders a header (from Chunk 2 Task 2.1).

Do not start this chunk until all of the above are landed and committed.

**Outcome:** Interactive nodes in pipelines actually render chat, chat exits cleanly, downstream nodes' output appears on screen. `chat-end-to-end.dot` smoke test passes manually.

**Files:**
- Modify: `src/cli/components/PipelineDisplay.tsx` (render `<ChatUI>` conditionally)
- Modify: `src/cli/commands/pipeline.ts` (wire `onInteractiveRequest`)
- Create: `src/cli/tests/pipeline-interactive.test.tsx`

### Task 3.1: Render `<ChatUI>` as a conditional child of `PipelineDisplay`

**Files:**
- Modify: `src/cli/components/PipelineDisplay.tsx`

- [ ] **Step 1: Import ChatUI**

Add near the other component imports in `src/cli/components/PipelineDisplay.tsx`:

```ts
import { ChatUI } from "./ChatUI.js";
```

- [ ] **Step 2: Render the conditional child**

In the JSX returned from `PipelineDisplay`, insert `<ChatUI>` between the `<Static>` and the existing status box. The tree should read, top to bottom:

```tsx
return (
  <>
    <Static items={lines}>
      {(line, i) => <Box key={i}>{/* existing line renderer */}</Box>}
    </Static>
    {chat && (
      <ChatUI
        session={chat.session}
        child={chat.child}
        tracePath={chat.tracePath}
        onExit={chat.onExit}
      />
    )}
    {/* existing status box unchanged */}
  </>
);
```

Rename the `_chat` variable destructured from `useState` back to `chat` now that it's used.

- [ ] **Step 3: Run existing PipelineDisplay tests**

Run: `npx vitest run src/cli/components/PipelineDisplay.test.tsx`
Expected: PASS. The existing tests don't invoke `setChat`, so the `chat` slot stays null and `<ChatUI>` is not rendered.

- [ ] **Step 4: Commit**

```bash
git add src/cli/components/PipelineDisplay.tsx
git commit -m "feat(PipelineDisplay): render ChatUI as conditional child when chat slot is set"
```

### Task 3.2: Wire `onInteractiveRequest` in `pipeline.ts`

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [ ] **Step 1: Destructure `setChat` from callbacks**

Update the destructuring to include `setChat`:

```ts
const { push, setStatus, setChat, done } = callbacks;
```

- [ ] **Step 2: Pass `onInteractiveRequest` to `runPipeline`**

In the `runPipeline(graph, { ... })` options object, add:

```ts
onInteractiveRequest: ({ session, child, tracePath }) =>
  new Promise<void>((resolve) => {
    let handled = false;
    const props: ChatProps = {
      session,
      child,
      tracePath,
      onExit: () => {
        if (handled) return;
        handled = true;
        setChat(null);
        resolve();
      },
    };
    setChat(props);
  }),
```

Add the `ChatProps` import at the top of `pipeline.ts`:

```ts
import type { ChatProps } from "../components/PipelineDisplay.js";
```

The `handled` flag closes over each invocation; sequential interactive nodes each get their own fresh closure. This is intentional.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "feat(pipeline): wire onInteractiveRequest to PipelineDisplay chat slot"
```

### Task 3.3: Integration test for the overlay regression

**Files:**
- Create: `src/cli/tests/pipeline-interactive.test.tsx`

This test is the regression gate for the bug the spec fixes. It must assert that pipeline output pushed **after** chat ends still reaches the rendered frame.

**API note:** The test uses `ink-testing-library`'s `render()`, which is a test double that renders to an in-memory stdout and does **not** conflict with `ink`'s real `render()`. `renderPipelineDisplay()` (the production helper) uses real Ink; this test bypasses it and mounts `<PipelineDisplay>` directly via the test library. That's the intended pattern — same as the existing `PipelineDisplay.test.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/cli/tests/pipeline-interactive.test.tsx`:

```tsx
import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import {
  PipelineDisplay,
  type PipelineDisplayCallbacks,
  type ChatProps,
} from "../components/PipelineDisplay.js";
import { Session } from "../lib/session.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

describe("PipelineDisplay interactive chat overlay", () => {
  it("shows chat, hides it on exit, and keeps rendering new lines afterwards", async () => {
    let cbs: PipelineDisplayCallbacks | null = null;

    const { lastFrame, unmount } = render(
      <PipelineDisplay
        pipelineName="test-pipeline"
        pid={1234}
        onReady={(callbacks) => {
          cbs = callbacks;
        }}
      />,
    );

    // Wait one microtask for useEffect to fire onReady
    await Promise.resolve();
    expect(cbs).not.toBeNull();

    // Push a line before chat starts
    cbs!.push({ kind: "info", text: "before-chat-line" });
    expect(lastFrame()).toContain("before-chat-line");

    // Mount chat overlay
    const session = new Session("test-session");
    const ctrl = createFakeChildHandle();
    let exitCalled = false;
    const chatProps: ChatProps = {
      session,
      child: ctrl.handle,
      tracePath: "/tmp/trace/test-node",
      onExit: () => {
        exitCalled = true;
      },
    };
    cbs!.setChat(chatProps);

    // Chat header should appear
    expect(lastFrame()).toContain("/tmp/trace/test-node");
    // Prior Static content is still there
    expect(lastFrame()).toContain("before-chat-line");

    // Close chat
    cbs!.setChat(null);

    // Regression assertion: new pipeline output after chat ends MUST appear
    cbs!.push({ kind: "info", text: "after-chat-line" });
    expect(lastFrame()).toContain("after-chat-line");
    // Old content persists
    expect(lastFrame()).toContain("before-chat-line");
    // Header is gone
    expect(lastFrame()).not.toContain("/tmp/trace/test-node");

    unmount();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/cli/tests/pipeline-interactive.test.tsx`
Expected: PASS. If it fails, the most likely causes are (a) `setChat` isn't stable and triggers a Static remount, or (b) the `chat` slot wasn't added to the render tree in Task 3.1. Debug accordingly before moving on.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new file.

- [ ] **Step 4: Commit**

```bash
git add src/cli/tests/pipeline-interactive.test.tsx
git commit -m "test(pipeline): add regression test for overlay exit + subsequent output"
```

### Task 3.4: Manual smoke test via `chat-end-to-end.dot`

This task is manual and does not have an automated assertion step. Follow it carefully.

- [ ] **Step 1: Rebuild and re-link (if necessary)**

Run: `npm run build`
Expected: clean build. If `ralph` is globally linked, no re-link needed.

- [ ] **Step 2: Clean any prior checkpoint for the pipeline**

Run: `rm -rf ~/.ralph/runs/chat_end_to_end/`
Expected: directory removed (or did not exist).

- [ ] **Step 3: Run the smoke pipeline interactively**

Run: `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`

Expected flow:
1. Pipeline prints the `[start]` node.
2. Chat UI mounts. The header shows a trace path under `~/.ralph/runs/chat_end_to_end/chat/`.
3. Claude asks one question. You type an answer and hit enter.
4. Claude acknowledges. You type `/end`.
5. Chat UI unmounts.
6. **Crucially:** the `summarize` node's output appears on screen, followed by `[done]`.
7. Shell prompt returns.

- [ ] **Step 4: If any downstream node's output is missing**

Debug before proceeding. Check:
- `~/.ralph/runs/chat_end_to_end/` checkpoints — did the engine actually run those nodes? If yes, the render is broken.
- Are there two `render()` calls somewhere? Grep: `grep -rn "from 'ink'" src/attractor/ src/cli/commands/` should show zero Ink imports in `src/attractor/`.
- Did `setChat(null)` get called? Add a temporary `console.error` in pipeline.ts's `onExit` to confirm.

Do NOT move on until the smoke flow is visually clean.

- [ ] **Step 5: Verify the `abort` path**

Run: `rm -rf ~/.ralph/runs/chat_end_to_end/ && ralph pipeline run pipelines/smoke/chat-end-to-end.dot`

When Claude asks the question, press **Ctrl+C** instead of typing. Expected: ChatUI unmounts, the `recovery` node runs and its one-line abort note appears, then `[done]`, then shell prompt.

- [ ] **Step 6: No commit — nothing changed on disk**

This task is purely verification. If you had to fix code to make the smoke test pass, those fixes get their own commits earlier in the plan, not stapled here.

### Task 3.5: Final full-suite verification

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: all tests pass, including `pipeline-interactive.test.tsx` and the migrated `agent-handler-interactive.test.ts`.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Check git status**

Run: `git status`

Expected: working tree clean modulo the files that were already dirty at plan start. Specifically:
- `pipelines/smoke/chat-end-to-end.dot` — pre-existing.
- `pipelines/smoke/chat-only.dot` — pre-existing.
- `src/cli/tests/helpers/fake-child-handle.ts` — pre-existing (the plan's new test imports from it but does not modify it; if it does show as modified by you during execution, investigate before proceeding).
- `src/cli/lib/agent.ts` — pre-existing (`git diff` is empty). Do not touch.
- `src/cli/agents/chat.md` — pre-existing untracked file.
- `src/cli/components/ChatUI.tsx` — this was dirty at plan start. If you stashed it during the pre-flight, that stash is separate work; decide separately whether to restore it. The plan's changes to `ChatUI.tsx` (adding optional `tracePath`) are already committed at this point via Task 2.1, so the file should not show as modified unless the stashed work reintroduced differences.

None of the files this plan committed (`src/attractor/handlers/agent-handler.ts`, `src/attractor/core/engine.ts`, `src/cli/components/PipelineDisplay.tsx`, `src/cli/components/PipelineDisplay.test.tsx`, `src/cli/components/ChatUI.tsx`, `src/cli/tests/ChatUI.test.tsx`, `src/attractor/tests/agent-handler-interactive.test.ts`, `src/cli/commands/pipeline.ts`, `src/cli/tests/pipeline-interactive.test.tsx`) should show as modified.

- [ ] **Step 4: No further commits**

All work is landed. Plan complete.

---

## Risks already mitigated in the plan

| Risk | Mitigation in plan |
|---|---|
| TDD inversion for test migration (Task 2.2) leaves repo broken mid-chunk | Tasks 2.2 and 2.3 share a single commit at the end of 2.3. The only person exposed to the broken state is the executor. |
| `setChat` stability causes spurious re-renders | Task 1.3 passes the `useState` setter directly without a closure wrapper; React guarantees stability. |
| Handler meta type mismatch (hidden type hole via `as` cast) | Task 1.2 adds `onInteractiveRequest` to the typed meta interface, not as an untyped `Record` lookup. |
| `tracePath` migration flood in `ChatUI.test.tsx` | Task 2.1 makes the prop optional. Zero migrations. Verified: 5 existing `<ChatUI ...>` usages, all safe. |
| Lazy-importing Ink again in a future refactor | Spec Risks table forbids handlers from calling `render()` directly. Chunk 2 Step 1 (Task 2.3) removes the last Ink import from `src/attractor/`. A lint rule to enforce "no `from \"ink\"`" in `src/attractor/` is left as a follow-up, not in scope. |

## Out-of-scope follow-ups (do not attempt in this plan)

- Bug A: `Agent.run()` drops the assembled prompt in interactive mode. Tracked at `memory/2026-04-13-interactive-pipeline-context-bug.md`. The smoke test's chat node will run with whatever context it currently has — unchanged by this plan.
- TTY auto-detection / non-TTY fallback for interactive nodes in CI.
- Lint rule forbidding `import ... from "ink"` in `src/attractor/`.
- Dropping the status box during chat (currently retained — consistent with the spec).
