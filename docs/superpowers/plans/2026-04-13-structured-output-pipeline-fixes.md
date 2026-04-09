# Structured Output & Pipeline Display Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three chained bugs that cause `ralph pipeline run` with structured-output nodes to silently exit with no output.

**Architecture:** Three targeted fixes — (1) unwrap Claude CLI's `--output-format json` response wrapper before parsing schema output, (2) await readline close to prevent data loss race, (3) yield a macrotask before Ink unmount to flush final render.

**Tech Stack:** TypeScript, vitest, Ink (React)

**Spec:** `docs/superpowers/specs/2026-04-13-structured-output-pipeline-fixes-design.md`

---

## Chunk 1: Fix structured output unwrapping

### Task 1: Add test for Claude CLI wrapper format

**Files:**
- Modify: `src/attractor/tests/agent-handler.test.ts`

- [ ] **Step 1: Write failing test — object wrapper format**

Add after the existing "merges parsed JSON output into contextUpdates" test (line 344):

```typescript
it("unwraps Claude CLI --output-format json wrapper before parsing", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" }, path: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  // Simulate Claude CLI --output-format json wrapper
  const innerJson = JSON.stringify({ verdict: "true", path: "/foo.md" });
  const wrapper = JSON.stringify({ type: "result", subtype: "success", result: innerJson, session_id: "s1" });
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null, output: wrapper });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["verdict"]).toBe("true");
    expect(outcome.contextUpdates?.["path"]).toBe("/foo.md");
    // Should NOT have numeric keys from iterating wrapper
    expect(outcome.contextUpdates?.["0"]).toBeUndefined();
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing test — array wrapper format**

Add after the previous test:

```typescript
it("unwraps Claude CLI array response format before parsing", async () => {
  const schema = JSON.stringify({ type: "object", properties: { preferred_label: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-test-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  // Simulate Claude CLI returning an array of message objects
  const innerJson = JSON.stringify({ preferred_label: "false" });
  const arrayOutput = JSON.stringify([
    { type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } },
    { type: "result", subtype: "success", result: innerJson, session_id: "s2" },
  ]);
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s2", stdout: null, output: arrayOutput });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(outcome.status).toBe("success");
    expect(outcome.preferredLabel).toBe("false");
    expect(outcome.contextUpdates?.["0"]).toBeUndefined();
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts`
Expected: 2 new tests FAIL (wrapper keys leak into contextUpdates as numeric keys / `[object Object]`)

### Task 2: Implement structured output unwrapping

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts:114-129`

- [ ] **Step 4: Replace the structured output parsing block**

Replace lines 114-129 in `agent-handler.ts`:

```typescript
    if (jsonSchema && lastResult?.output) {
      try {
        const raw = JSON.parse(lastResult.output.trim());
        // Claude CLI --output-format json wraps the response.
        // Handle object wrapper ({type:"result", result:"..."}) and array format.
        const wrapper = Array.isArray(raw)
          ? raw.find((item: any) => item?.type === "result") ?? raw[raw.length - 1]
          : raw;
        const resultText = typeof wrapper === "object" && wrapper !== null && "result" in wrapper
          ? wrapper.result
          : lastResult.output.trim();
        const parsed = typeof resultText === "string" ? JSON.parse(resultText) : resultText;

        for (const [key, value] of Object.entries(parsed)) {
          structuredUpdates[key] = String(value);
        }
        if (parsed.preferred_label != null) {
          preferredLabel = String(parsed.preferred_label);
        }
      } catch (err) {
        return {
          status: "fail",
          failureReason: `Structured output parsing failed: ${(err as Error).message}`,
        };
      }
    }
```

- [ ] **Step 5: Run all agent-handler tests**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts`
Expected: ALL tests pass, including the 2 new wrapper tests AND the 3 existing structured output tests (direct JSON format still works via fallback path)

- [ ] **Step 6: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler.test.ts
git commit -m "fix: unwrap Claude CLI response wrapper in structured output parsing"
```

---

## Chunk 2: Fix readline/close race condition

### Task 3: Add test for readline completion

**Files:**
- Modify: `src/cli/tests/agent.test.ts`

- [ ] **Step 7: Write failing test for readline race**

Add a new `describe("Agent.run readline completion")` block at the end of the file:

```typescript
describe("Agent.run readline completion", () => {
  it("captures all output lines before returning", async () => {
    // This test verifies that agent.run() awaits readline close
    // before returning capturedOutput, preventing data loss from
    // the child.close firing before readline finishes processing.
    const { Readable } = await import("node:stream");
    const { EventEmitter } = await import("node:events");
    const childProcess = await import("node:child_process");

    const config: AgentConfig = {
      name: "test",
      description: "test",
      model: "opus",
      permissionMode: "dangerouslySkipPermissions",
      tools: [],
      mcp: [],
      prompt: "test prompt",
      jsonSchema: '{"type":"object"}',
    };

    // Create a mock child process that emits lines then closes
    const mockStdout = new Readable({ read() {} });
    const mockChild = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: mockStdout,
      stderr: null,
    });

    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue(mockChild as any);

    const agent = new Agent(config);
    const runPromise = agent.run({ cwd: "/tmp" });

    // Push data then close — simulate child exiting
    mockStdout.push('{"result":"{\\"answer\\":\\"42\\"}", "session_id":"s1"}\n');
    mockStdout.push(null); // EOF
    // Emit close after a tick to simulate real child process timing
    setTimeout(() => mockChild.emit("close", 0), 5);

    const result = await runPromise;
    expect(result.output).toContain('"result"');
    expect(result.output!.trim().length).toBeGreaterThan(0);

    spawnSpy.mockRestore();
  });
});
```

- [ ] **Step 8: Run test to verify current behavior**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: Test may pass or fail depending on timing — this establishes a regression guard. The important thing is the implementation fix prevents the race.

### Task 4: Implement readline await

**Files:**
- Modify: `src/cli/lib/agent.ts:195-229`

- [ ] **Step 9: Add readline close await**

In `src/cli/lib/agent.ts`, modify the jsonSchema branch (lines 195-210). After creating the readline interface, create a close promise and await it before returning:

Replace lines 195-210:

```typescript
      if (this.config.jsonSchema && !isInteractive && child.stdout) {
        // Structured output: buffer stdout for JSON parsing.
        // Skip onStdout — structured nodes produce a single JSON blob, not a stream.
        const rl = readline.createInterface({ input: child.stdout });
        const rlDone = new Promise<void>((resolve) => rl.on("close", resolve));
        rl.on("line", (line) => {
          capturedOutput += line + "\n";
          try {
            const parsed = JSON.parse(line);
            if (parsed.session_id && !sessionId) {
              sessionId = parsed.session_id;
              options.onSessionId?.(sessionId!);
            }
          } catch {
            // Not JSON line, still captured
          }
        });
        // Ensure all buffered lines are processed before returning
        await rlDone;
```

Then update line 229 — `closePromise` is still awaited after the branches, so the flow is: `rlDone` resolves when stdout EOF is processed, then `closePromise` resolves when child exits. Both are awaited. No other changes needed.

- [ ] **Step 10: Run agent tests**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: ALL tests pass

- [ ] **Step 11: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent.test.ts
git commit -m "fix: await readline close before returning structured output"
```

---

## Chunk 3: Fix Ink render race on pipeline exit

### Task 5: Add macrotask yield before Ink unmount

**Files:**
- Modify: `src/cli/commands/pipeline.ts:144-149`

- [ ] **Step 12: Add setTimeout(0) before done()**

Replace the `finally` block (lines 144-149) in `pipeline.ts`:

```typescript
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    // Yield one macrotask to let Ink flush the final render (matches output.ts renderOnce pattern)
    await new Promise(resolve => setTimeout(resolve, 0));
    done();
    await waitUntilExit();
  }
```

- [ ] **Step 13: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass. No existing tests should break.

- [ ] **Step 14: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "fix: yield macrotask before Ink unmount to flush final pipeline message"
```

### Task 6: Manual smoke test

- [ ] **Step 15: Build and run the pipeline**

```bash
npm run build
ralph pipeline run illumination-to-plan --project .
```

Expected:
- Verifier node runs (no streaming output — this is expected for json nodes)
- Pipeline routes correctly based on `preferred_label` from structured output
- Final success/fail message renders before the display unmounts
- No `[object Object]` in context updates
