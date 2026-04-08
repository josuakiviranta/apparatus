---
date: 2026-04-08
description: The `renderOnce` timing bug can be fixed entirely within `output.ts` by wrapping the element in a self-exiting shell component — no changes to any of the six one-shot UI components are required, making it a 5-line patch that unblocks the entire Ink migration correctness story.
---

## Core Idea

Illumination 0900 correctly identified that `renderOnce` uses `setTimeout(0)` as a timing stand-in for a real Ink lifecycle signal, and proposed fixing it by adding `useEffect(() => { exit(); }, [])` to each of the six one-shot components (`Step`, `Info`, `Warn`, `Error`, `Success`, `Header`). That approach is correct but unnecessarily broad. The fix can live entirely in `renderOnce` itself by wrapping the passed element in an anonymous `SelfClosing` shell:

```typescript
async function renderOnce(el: React.ReactElement): Promise<void> {
  const SelfClosing = () => {
    const { exit } = useApp();
    useEffect(() => { exit(); }, []);
    return el as React.ReactElement;
  };
  const { waitUntilExit } = render(React.createElement(SelfClosing));
  await waitUntilExit();
}
```

`SelfClosing` calls `exit()` via `useApp()` in a `useEffect` with empty deps. `useEffect` is guaranteed by React to run after the commit phase — after the frame has been written to the terminal. So `exit()` fires after Ink has flushed, `waitUntilExit()` resolves, and the function returns. No `setTimeout`. No timing assumption. No `unmount()` called early.

## Why It Matters

The six one-shot components are pure display components. They have no knowledge of how they are rendered or when they should exit. That knowledge belongs to the orchestration layer — `renderOnce` — not to the components. Illumination 0900's proposal would push lifecycle management into the display layer: each component would need to know about `useApp()` and call `exit()`. The wrapper approach keeps the separation: components describe what to show, `renderOnce` describes when to stop showing it.

This matters practically because:

1. `ui.test.tsx` tests the six components via `ink-testing-library`. Those tests pass `lastFrame()` to assert the rendered output. Self-exiting components would need test adjustments (the component would exit before `lastFrame()` is called in some timing scenarios). The wrapper approach requires no test changes — the components remain stateless and testable as before.

2. The fix touches one function in one file (`output.ts`) instead of six component definitions plus their tests. The blast radius is minimal.

3. `StreamOutput` and `SpinnerLine` already use `exit()` via `useApp()` internally because they control async lifecycles. Adding `exit()` to `Step` would make it look like it has a similar lifecycle — which it doesn't. The distinction is meaningful: stateful components exit themselves, stateless components are exited by their host. The wrapper preserves that distinction.

The `renderOnce` fix is the foundational patch for the Ink migration. Every `output.step`, `output.info`, `output.warn`, `output.error`, `output.success`, and `output.header` call in the half-migrated commands (`meditate.ts`, `plan.ts`, `new.ts`, `run-scenarios.ts`) uses `renderOnce`. Until it's correct, every Ink-raw-Ink sequence in those commands runs on an untested timing assumption.

## Revised Implementation Steps

1. **Patch `renderOnce` in `src/cli/lib/output.ts`** with the `SelfClosing` wrapper above. Add `useEffect` to the imports from `react`. Remove the `setTimeout` and `inst.unmount()` lines. Replace with `const { waitUntilExit } = render(...); await waitUntilExit();`.

2. **Add a stdout-capture smoke test to `src/cli/tests/output.test.ts`.** The existing tests assert "resolves without throwing." Add one test that spies on `process.stdout.write` and asserts that calling `output.step("hello")` emits a buffer containing `"hello"`. This closes the gap between "function resolves" and "text reached stdout."

3. **Commit this patch alone, before any streaming migration.** The commit should be `fix: renderOnce uses self-closing wrapper instead of setTimeout`. Every subsequent commit in the streaming migration inherits correct Ink behavior.

4. **Then proceed with the streaming migration** for `meditate.ts`, `plan.ts`, and `new.ts` using the `sessionStream` closure-mutation pattern from `loop.ts`. For functions that must return metadata (session_id), capture it in a variable closed over by the generator, and read it after `output.stream()` resolves — the generator has exhausted at that point and the variable is populated.

5. **Do not change `Step`, `Info`, `Warn`, `Error`, `Success`, or `Header` in `ui.tsx`.** They are correct as pure display components. The lifecycle fix is in `renderOnce`, not in them.
