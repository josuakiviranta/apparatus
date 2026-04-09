---
date: 2026-04-08
description: pipelineCreateCommand is the fourth implementation of the two-phase Claude session pattern and has already dropped the 'which claude' preflight guard, meaning a missing Claude binary produces an unhandled spawn error instead of a clear diagnostic.
---

## Core Idea

`pipelineCreateCommand` in `src/cli/commands/pipeline.ts` is the fourth file to implement the two-phase kickoff pattern (non-interactive `--output-format stream-json` spawn → session ID capture → interactive `--resume`). The April 5 illumination (`2026-04-05T1530`) recommended extracting `lib/claude-session.ts` at the three-command threshold. That extraction never happened. The fourth copy arrived via the pipeline authoring spec, and it has already drifted: it is missing the `which claude` preflight guard that `plan.ts` and `meditate-create.ts` both run. If Claude is not installed, `plan` and `meditate create` print `"Error: claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code"` and exit cleanly. `pipeline create` throws an unhandled spawn error with no diagnostic.

## Why It Matters

The pipeline authoring design spec (`2026-04-11-pipeline-workflow-authoring-design.md`) said the `create` session uses "the same two-phase mechanism as `plan.ts`." This was written as an instruction to duplicate, not to extract. When the implementation followed the spec, the developer copied the structural shape of `plan.ts` but not its preflight behavior — a gap invisible from the spec. The `which claude` guard is not in the spec; it's in the code. Specs don't carry code-level safety behaviors across feature boundaries. Only a shared abstraction does.

There are now three concrete divergences between `pipelineCreateCommand` and the pattern established by `plan.ts` and `meditate-create.ts`:

1. **No `which claude` check** — missing preflight; spawn error on missing binary instead of user-facing message
2. **No `output.header` call** — the other two commands print a structured header (mode, project, branch, PID) before the kickoff; `pipeline create` prints two `output.step` lines instead, with no branch or PID
3. **No trace path log** — after session ID capture, `plan.ts` and `meditate-create.ts` print `trace: ~/.claude/projects/.../<sessionId>.jsonl`; `pipeline create` does not

Items 2 and 3 may be intentional omissions; item 1 is a regression. But all three are invisible without a shared abstraction to enforce consistency.

The `gene-transfusion` lens predicts this exactly: the transfusion loop was never closed. The internal exemplar (`plan.ts`) was not turned into the abstraction — it remained a file to copy from. Every copy inherits what the copier noticed and drops what the copier missed. The test suite offers no protection: `streamEvents` is mocked as a no-op generator in all four command tests, so `sessionId` is always `null` in test runs, and neither the session ID handoff nor the resume args are ever verified.

## Revised Implementation Steps

1. **Fix the immediate regression.** Add the `which claude` guard to `pipelineCreateCommand` in `src/cli/commands/pipeline.ts` before the prompt read. Copy the pattern from `meditateCreateCommand` verbatim — this is a one-time fix, not an abstraction:
   ```ts
   const which = spawnSync("which", ["claude"], { encoding: "utf8" });
   if (which.status !== 0) {
     await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
     process.exit(1);
   }
   ```

2. **Create `src/cli/lib/claude-session.ts`** with a single exported function that encapsulates: the `--output-format stream-json` spawn, the `streamEvents` consumption, the session ID capture, and the `--resume` interactive spawn. Signature (at minimum):
   ```ts
   export async function runTwoPhaseSession(opts: {
     cwd: string;
     kickoffArgs: string[];
   }): Promise<void>
   ```

3. **Write tests for `runTwoPhaseSession` first.** The test must verify that when `streamEvents` emits a session ID, the second spawn receives `--resume <id>`. This is the contract that all four command tests currently skip. Mock the `claude` binary via env override or inject the spawn function as a dependency.

4. **Migrate all four callers** — `plan.ts`, `meditate-create.ts`, `new.ts`, `pipeline.ts` — to call `runTwoPhaseSession`. The `which claude` check, the trace path log, and the `--resume` construction should move into the shared function. Per-command differences (the kickoff trigger, the `output.header` call) remain in each command file.

5. **Add `ralph-engine-test-*/` to `.gitignore`.** The leaked `ralph-engine-test-5zoWIW/` directory (69KB checkpoint from the `completedNodes` bag bug) is still untracked. This is orthogonal to the session extraction but has been pending since the April 12 0900 illumination. Do it in the same commit as the `which claude` fix — both are one-liners.
