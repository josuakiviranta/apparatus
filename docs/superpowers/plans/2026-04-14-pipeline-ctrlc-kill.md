---
status: implemented
---

# Pipeline Ctrl+C Kill Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ctrl+C immediately kill the running claude child process instead of waiting for it to finish naturally.

**Architecture:** `agent.run()` accepts an `AbortSignal` but never listens for its `abort` event to kill the child. The child is spawned with `detached: true` (own process group), so it doesn't receive the terminal's SIGINT. Fix: add a one-time `abort` listener right after the child is spawned that calls `child.kill("SIGTERM")` and escalates to SIGKILL after 3 s.

**Tech Stack:** Node.js `child_process`, `AbortSignal` event API

---

## Chunk 1: Wire abort signal to kill child in `agent.run()`

### Task 1: Kill child on abort in `agent.run()`

**Files:**
- Modify: `src/cli/lib/agent.ts:190-191` (after child is spawned)
- Test: `src/cli/tests/agent.test.ts` (existing test file, add new test)

- [ ] **Step 1: Read the test file to understand existing patterns**

```bash
grep -n "abort\|signal\|kill\|SIGTERM\|SIGKILL" src/cli/tests/agent.test.ts | head -40
```

- [ ] **Step 2: Write a failing test for abort-kills-child**

In `src/cli/tests/agent.test.ts`, add:

```typescript
it("kills child process when abort signal fires during run", async () => {
  // Arrange: spawn a child that sleeps forever
  const ac = new AbortController();
  // Use a real agent config but override the command to sleep
  // We can use a mock via vi.spyOn on spawn, or test via the
  // AbortController wiring directly.
  //
  // Minimal approach: spy on child.kill and verify it's called on abort.
  const fakeChild = {
    kill: vi.fn(),
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") {
        // Resolve after kill is called
        setTimeout(() => cb(0), 50);
      }
    }),
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: null,
  };
  vi.spyOn(childProcess, "spawn").mockReturnValue(fakeChild as any);

  const agent = new Agent({
    name: "test",
    description: "",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "hello",
  });

  const runPromise = agent.run({ cwd: "/tmp", signal: ac.signal, interactive: false });

  // Act: abort after a tick
  await new Promise((r) => setImmediate(r));
  ac.abort();

  await runPromise;

  // Assert: child.kill was called
  expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx vitest run src/cli/tests/agent.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM")` fails (kill never called)

- [ ] **Step 4: Implement the fix in `agent.run()`**

In `src/cli/lib/agent.ts`, after line 191 (`this._child = child;`), add:

```typescript
      // Kill child immediately when the caller aborts (e.g. Ctrl+C).
      // The child is spawned with detached:true so it won't receive the
      // terminal's SIGINT — we must kill it explicitly.
      if (options.signal) {
        const onAbort = () => {
          child.kill("SIGTERM");
          setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
        };
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx vitest run src/cli/tests/agent.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 6: Run the full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: no regressions

- [ ] **Step 7: Build and smoke-test manually**

```bash
npm run build
ralph pipeline run pipelines/illumination-to-plan.dot
# Press Ctrl+C once — should terminate within ~1s
```

- [ ] **Step 8: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent.test.ts
git commit -m "fix(pipeline): kill detached child process immediately on Ctrl+C abort"
```
