---
id: spec-2026-04-10-interactive-ink-overlay
type: spec
created: 2026-04-10
updated: 2026-04-10
status: draft
tags: [pipeline, interactive-nodes, ink, agent-handler]
---

# Interactive Chat As A Child Component Of PipelineDisplay

## Problem

Pipeline runs with `interactive=true` nodes currently call `render()` **twice** on the same stdout:

- `pipeline.ts` calls `renderPipelineDisplay()` once at startup to mount `<PipelineDisplay>`.
- `agent-handler.ts` lazy-imports `ink` and calls `render(<ChatUI/>)` a second time inside the interactive branch.

The Ink docs are explicit about this:

> Reusing the same stdout across multiple `render()` calls without unmounting is unsupported. Call `unmount()` first if you need to change the rendering mode or create a fresh instance.
> — [ink readme](https://github.com/vadimdemedes/ink)

The consequence shows up after `/end`: ChatUI unmounts, but the outer `PipelineDisplay` is in an undefined state — its subsequent `<Static>` pushes render but are visually lost. The engine *does* run the downstream nodes (checkpoints at `~/.ralph/runs/chat_end_to_end/` confirm `summarize` and `done` completed with `status: success`), they just don't appear on screen.

## Goal

One `render()` call per pipeline run. `<ChatUI>` mounts as a conditional child of `<PipelineDisplay>` when the engine reaches an interactive node, and unmounts when the user exits. Downstream pipeline output keeps flowing into the same Static tree it always has.

## Non-goals

- Changes to `Agent.runInteractive()`, `Session`, `ChildHandle`, `buildSessionDigest`, or the child-process lifecycle.
- Concurrent interactive nodes (parallel fan-out).
- TTY auto-detection / non-TTY fallback. Out of scope; tracked separately.
- Fix for the interactive-context bug where `Agent.run()` drops the assembled prompt in interactive mode. Out of scope; tracked at `memory/2026-04-13-interactive-pipeline-context-bug.md`. This spec is purely about rendering.

## Preconditions (inherited, not introduced)

These are existing assumptions the rewrite inherits and does not change:

- **`ChatUI` depends on Claude Code's stream-json event shape.** `ChatUI`'s internal state machine transitions on specific events from `child.events` (e.g. `assistant_delta`, `result`). If Claude Code alters its stream-json output, `ChatUI` may stall or misbehave — independent of this spec. The rewrite does not introduce this coupling; it only preserves it.
- **`session.exitReason` starts `undefined`.** `ChatUI` sets it before invoking `onExit`. `buildSessionDigest(session)` already handles `undefined` as the "no clean exit signal" case. If a future change to `ChatUI` fires `onExit` without setting `exitReason`, the digest will reflect that as a degraded outcome — existing behavior, not new.

## Design

This is standard Ink. The canonical pattern for "growing log + dynamic region" is `<Static>` for the log plus regular components for everything else, all under one root. The Ink readme calls this out directly:

> `<Static>` is useful for displaying activity like completed tasks or logs — things that don't change after they're rendered. Gatsby uses it to display a list of generated pages while still displaying a live progress bar.

### Shape

```
pipeline.ts
  └─ renderPipelineDisplay()           // the ONE render() call
       PipelineDisplay
         ├─ <Static items={lines}/>    // append-only pipeline log
         ├─ {chat && <ChatUI {...chat}/>}  // conditional child
         └─ <StatusBox/>

engine.runPipeline(graph, { onInteractiveRequest })
  └─ meta.onInteractiveRequest carried into handler
        └─ AgentHandler.execute (interactive branch):
             const { session, child } = await agent.runInteractive(...)
             await meta.onInteractiveRequest({ session, child, tracePath })
             return buildSessionDigest(session)   // unchanged
```

`onInteractiveRequest` is a callback the pipeline command passes to the engine. Its implementation flips a `chat` state slot on `PipelineDisplay`. When ChatUI calls its `onExit` prop, the slot clears and the promise resolves. The handler then does its existing `buildSessionDigest(session)` work and returns an `Outcome`.

That's the entire design. Nothing exotic. Nothing "overlay-like." Just a conditional child component.

### Why this works (notes on Ink invariants)

- **One render call.** The outer `PipelineDisplay` stays mounted for the whole run. `<ChatUI>` is a React child, not a second Ink instance — so `log-update`, `patchConsole`, the Static reconciler, and cursor tracking all have a single owner.
- **Multiple `useInput` hooks are allowed.** The Ink docs explicitly support this: `useInput` has an `isActive` option "useful when there are multiple `useInput` hooks used at once." There is no "single consumer rule." `PipelineDisplay` doesn't call `useInput` today anyway; only `TextInput` (inside `ChatUI`) does.
- **Static + dynamic siblings are the intended pattern.** The existing status box is already a dynamic sibling of `<Static>` and works fine. Adding `<ChatUI>` as another sibling is the same shape.

### Components

#### `src/cli/components/PipelineDisplay.tsx`

- Add a state slot: `const [chat, setChat] = useState<ChatProps | null>(null);`
- Render `{chat && <ChatUI {...chat}/>}` between `<Static>` and the status box.
- Expose `setChat` through the existing `onReady` callbacks bag as a new field.
- Pass the `setChat` React setter directly — it has a stable reference across renders, so no wrapping is needed.

`ChatProps` is `{ session, child, tracePath, onExit }`. Constructed once per interactive node in `pipeline.ts` (outside render), so its identity is stable and React won't remount `<ChatUI>` on unrelated parent updates.

#### `src/cli/components/ChatUI.tsx`

- Add an optional `tracePath?: string` prop. When present, render a small dim header above the conversation area showing the trace directory. Optional so existing unit tests don't need to change.
- No other changes. The component remains standalone-mountable for its unit tests.

#### `src/attractor/handlers/agent-handler.ts`

- Remove `import React from "react"`, the `InkRenderFn` type, the `render?: InkRenderFn` field on `AgentHandlerDeps`, the `this.render` member, and the constructor wiring for it.
- Inside the `interactive` branch, delete the lazy `await import("ink")` / `await import("../../cli/components/ChatUI.js")` block and the `new Promise(...)` that calls `renderFn!(...)` and schedules `instance.unmount()`.
- Replace it with:

  ```ts
  const onInteractiveRequest = meta.onInteractiveRequest as
    | OnInteractiveRequest
    | undefined;

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

- The callback returns `Promise<void>`. The handler does not consume a returned reason — `session.exitReason` is mutated in place by `ChatUI` and read by the existing `buildSessionDigest(session)` call. Single source of truth.
- Everything after the interactive await — the `Promise.race([child.exited, 5s timeout])` cleanup, `buildSessionDigest`, `contextUpdates` flattening, writing `digest.json`, returning the `Outcome` — stays exactly as-is.

Export from the same file:

```ts
export interface InteractiveRequest {
  session: Session;
  child: ChildHandle;
  tracePath: string;
}

export type OnInteractiveRequest = (req: InteractiveRequest) => Promise<void>;
```

#### `src/attractor/core/engine.ts`

- Add `onInteractiveRequest?: OnInteractiveRequest` to `EngineOptions`.
- Thread it into the meta record at the same place `onStdout` is wired.

#### `src/cli/commands/pipeline.ts`

- Destructure `setChat` from the PipelineDisplay callbacks.
- Pass `onInteractiveRequest` to `runPipeline`:

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

The `handled` flag makes `onExit` idempotent (handles the crash/SIGINT race where ChatUI fires exit twice).

## Error handling

| Scenario | Behavior |
|---|---|
| Non-pipeline callers (`plan`, `implement`) run without `onInteractiveRequest` | No problem — it's optional, and these commands never hit `interactive=true` nodes. |
| Pipeline hits an interactive node but caller forgot to wire `onInteractiveRequest` | Handler kills child, returns `fail` with a clear `failureReason`. |
| `onExit` fired twice (child crash race) | `handled` flag drops the second call. |
| Child crashes during chat | ChatUI's existing crash path fires `onExit` → chat state clears → handler's existing `child.exited` race resolves → `buildSessionDigest` returns `success: false` → handler returns `fail` Outcome. |
| SIGINT during chat | ChatUI's SIGINT handler fires `onExit`; pipeline.ts's SIGINT handler aborts the engine's AbortController. Both idempotent. |
| Multiple interactive nodes in sequence | Each invocation builds a fresh `ChatProps` with its own `handled` closure. React remounts `<ChatUI>` when identity changes between invocations — the desired behavior. |
| `child.exited` never resolves after chat closes | Existing 5-second `Promise.race` SIGKILL fallback in the handler. |

## Testing

**Migrated** (mechanical API change, not behavioral):

- `src/attractor/tests/agent-handler-interactive.test.ts` — replace every `render: stubRender` injected into `new AgentHandler({...})` with an `onInteractiveRequest` stub on the `meta` bag passed to `execute()`. The stub simulates ChatUI: mutate `session.exitReason`, optionally drain `child.events`, then resolve.

  ```ts
  const makeStub = (reason: ExitReason): OnInteractiveRequest =>
    async ({ session, child }) => {
      // Drain events as ChatUI would, so session state is populated
      (async () => {
        try { for await (const _ of child.events) {} } catch {}
      })();
      session.exitReason = reason;
      await child.end();
    };
  ```

  Count to migrate is whatever `grep -c '^  it(' src/attractor/tests/agent-handler-interactive.test.ts` returns; apply the same transform to each.

- `src/cli/components/PipelineDisplay.test.tsx` — add one assertion that the `onReady` callbacks bag includes `setChat: function`.

**New:**

- `src/cli/tests/pipeline-interactive.test.tsx` — integration test using `ink-testing-library`:
  1. Render `PipelineDisplay`.
  2. Push a few Static lines via `push()`.
  3. Call `setChat({ session: fakeSession, child: fakeChild, tracePath: "/tmp/t", onExit })`.
  4. Assert Static content, ChatUI, and status box are all present in the frame.
  5. Invoke the captured `onExit`.
  6. **Regression assertion:** after `setChat(null)`, call `push()` again and assert the new line appears. This proves the original bug is fixed — output is not lost after chat ends.

**Unaffected:**

- `src/cli/tests/ChatUI.test.tsx` — `tracePath` is optional, no changes required.
- `src/attractor/tests/agent-handler.test.ts` — non-interactive path only.
- All scenario/smoke tests, all non-interactive pipeline tests.

**Manual:** `ralph pipeline run pipelines/smoke/chat-end-to-end.dot` → after `/end`, verify `summarize` and `done` output actually appear.

## Implementation order

1. Add `chat` state slot + `setChat` callback to `PipelineDisplay` (no runtime effect yet).
2. Add `OnInteractiveRequest` type + optional `onInteractiveRequest` in `EngineOptions` + meta wiring in `engine.ts`.
3. Add optional `tracePath` prop + header to `ChatUI`.
4. Rewrite the interactive branch of `agent-handler.ts` to call `meta.onInteractiveRequest`, delete Ink imports.
5. Wire the `onInteractiveRequest` callback in `pipeline.ts`.
6. Migrate `agent-handler-interactive.test.ts` to the new stub shape.
7. Add `pipeline-interactive.test.tsx` integration test.
8. Manual smoke-test `chat-end-to-end.dot`.
9. Full test suite.

## Risks

| Risk | Mitigation |
|---|---|
| Removing `AgentHandlerDeps.render` breaks external consumers | Grep confirms only `agent-handler-interactive.test.ts` uses it. ralph-cli is an application, not a library; no external consumers. |
| ChatUI re-mounts on unrelated parent updates | `ChatProps` is constructed once per invocation outside render, so identity is stable. React's reconciler keeps the same instance. |
| Bug A (prompt dropped in interactive `Agent.run()`) reintroduced | Out of scope, same behavior as today. Tracked separately. This spec is render-only. |
| Future handler regresses to a second `render()` call | **Invariant: no handler may call Ink's `render()` directly.** Interactive UI must be mounted as a child of `PipelineDisplay` via `setChat` (or an analogous state slot for future overlays). If a new handler needs its own UI, add a new state slot and a new `onXxxRequest` callback to `EngineOptions` — do not lazy-import `ink` and call `render()`. This rule also precludes extracting the interactive branch of `agent-handler.ts` into a helper that imports `ink` directly. |

## Rollout

Single PR. No migration, no feature flag. The smoke test validates end-to-end.
