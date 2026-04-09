---
date: 2026-04-09
description: ConsoleInterviewer.ask() hangs indefinitely when stdin is not a TTY — rl.question() never calls its callback on EOF — so any pipeline with a wait.human node freezes silently in non-interactive contexts, and Ctrl-C cannot interrupt it because the AbortSignal is never checked inside the blocked promise.
---

## Core Idea

`ConsoleInterviewer.ask()` calls `readline.createInterface({ input: process.stdin })` and then `rl.question(prompt, callback)`. When stdin is not an interactive TTY — CI, cron, scripted pipeline runs, piped input — Node.js readline fires a `'close'` event on the interface when stdin reaches EOF, but does **not** call pending `rl.question` callbacks. The promise in `ask()` never resolves. The engine is suspended inside `WaitHumanHandler.execute()`, which is awaiting that promise. The main loop never gets another iteration. `opts.signal?.aborted` is never checked again. `process.on("SIGINT", ...)` fires and calls `ac.abort()` when the user presses Ctrl-C, but no one is checking `ac.signal.aborted` — the only live code is the unresolved `rl.question` callback, which readline may additionally suppress from SIGINT by pausing the stream. The process becomes impossible to interrupt without `kill -9`.

## Why It Matters

`wait.human` nodes exist precisely to insert human oversight into autonomous pipelines. The entire point is to pause an otherwise-automated run and require a deliberate human decision before proceeding. But the `ConsoleInterviewer` — the only production implementation of `Interviewer` — has no behavior contract for the non-interactive case. It provides the human gate only when a human is literally present at a terminal. The moment the pipeline runs anywhere else, the gate becomes a permanent hang.

Three compounding factors make this invisible:

1. **The scenario test for `gate_test.dot` only runs interactively.** `test-attractor-pipeline.sh` inherits stdin from the calling shell. When run by a developer at a terminal, stdin IS a TTY and the prompt appears. The test results in `scenario-runs/` were produced this way. In CI, the same test would freeze at the `check` node and never return.

2. **The abort signal does not race against the readline promise.** `WaitHumanHandler.execute()` receives `signal` via `meta["signal"]` but does not use it. There is no `Promise.race([interviewer.ask(q), abortPromise])` pattern. The engine's abort path requires that each handler return — but this handler never returns when no TTY is present.

3. **The `every-action-needs-an-escape` meditation applies directly.** "Long-running processes with no way to abort. Agents build the entry because that's what you asked for. The exit is implicit to you and invisible to them." The pipeline design spec describes `wait.human` as a tool for human oversight — it describes the entry. The non-interactive exit was implicit and was never specified. The implementation reflects this: there is an entry path (the question prompt) and no exit path for the case where no human is present.

The `QueueInterviewer` in tests sidesteps this entirely by never touching stdin. The test suite validates that the handler returns and routes correctly given a pre-supplied answer — but never validates behavior when no answer can arrive.

## Revised Implementation Steps

1. **Thread the AbortSignal into `WaitHumanHandler.execute()`.** The `meta` record already carries `signal`. Create an abort promise and race it against the interviewer question:
   ```ts
   async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
     const signal = meta["signal"] as AbortSignal | undefined;
     const abortPromise = new Promise<never>((_, reject) => {
       signal?.addEventListener("abort", () => reject(new Error("Aborted")));
     });
     try {
       const answer = await Promise.race([
         this.interviewer.ask({ ... }),
         abortPromise,
       ]);
       return { status: "success", preferredLabel: answer.value };
     } catch {
       return { status: "fail", failureReason: "Aborted" };
     }
   }
   ```
   This makes Ctrl-C work at a human gate without requiring readline to resolve.

2. **Add non-interactive detection to `ConsoleInterviewer`.** Before creating the readline interface, check `process.stdin.isTTY`. If false, reject immediately with a clear error:
   ```ts
   async ask(q: Question): Promise<Answer> {
     if (!process.stdin.isTTY) {
       throw new Error(
         `wait.human node "${q.prompt}" requires interactive input, ` +
         `but stdin is not a terminal. Use --interviewer=auto-approve to skip, ` +
         `or run interactively.`
       );
     }
     // ... readline setup
   }
   ```
   A thrown error propagates through the race and is caught by the handler, which returns `{ status: "fail", failureReason: "..." }`. The pipeline fails with a clear diagnostic instead of hanging.

3. **Add `--interviewer` flag to `ralph pipeline run`.** Expose the interviewer selection at the CLI level:
   - `--interviewer=console` (default): uses `ConsoleInterviewer`, requires TTY
   - `--interviewer=auto-approve`: uses `AutoApproveInterviewer`, silently accepts first option

   This makes the non-interactive case explicit and intentional rather than a silent hang. Operators running pipelines in automation can add `--interviewer=auto-approve` to opt in to unattended execution of human gates.

4. **Fix the `gate_test.dot` scenario test.** The scenario test is currently valid only when run interactively. Either:
   - Add `--interviewer=auto-approve` to the scenario run command (makes it always pass without human input, tests routing but not the gate UI)
   - Or annotate the scenario as "interactive only" and exclude it from CI

5. **Add a unit test for non-interactive ConsoleInterviewer.** In a test, pipe a mock readable stream as stdin (not a TTY), call `interviewer.ask(...)`, and assert it rejects immediately with the non-TTY diagnostic. This is the test that would have caught this bug before it shipped.
