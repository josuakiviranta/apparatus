# Help Text Redesign Implementation Plan

> **All chunks implemented and verified in tag 0.0.23.**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `ralph --help` self-sufficient — a new user can read it and know how to run any ralph feature.

**Architecture:** Pure text changes in two files. `program.ts` gets improved `.description()` strings and a `.addHelpText('after', ...)` workflow block on the root program and each top-level command. `heartbeat.ts` gets the same treatment for all eight subcommands. No new files, no new abstractions.

**Tech Stack:** Commander.js `.description()`, `.addHelpText('after', string)`. Tests via Vitest + `createProgram()` introspection.

---

## Chunk 1: Update `program.ts` — descriptions + root afterText

**Spec:** `docs/superpowers/specs/2026-04-07-help-text-design.md`

### Files
- Modify: `src/cli/program.ts`
- Modify: `src/cli/tests/cli-commands.test.ts`

---

### Task 1: Update tests that assert old descriptions

Two existing tests in `cli-commands.test.ts` hard-code the old description strings. Update them to assert the new values so they fail before the implementation change and pass after.

**Files:**
- Modify: `src/cli/tests/cli-commands.test.ts:33-50`

- [x] **Step 1.1: Update meditate description test (line 37)**

Change:
```typescript
expect(meditateCmd!.description()).toBe("Meditation commands");
```
To:
```typescript
expect(meditateCmd!.description()).toBe("Run a restricted Claude session that writes insights to meditations/illuminations/");
```

- [x] **Step 1.2: Update meditate create description test (line 49)**

Change:
```typescript
expect(createCmd!.description()).toBe("Create a new meditation script");
```
To:
```typescript
expect(createCmd!.description()).toBe("Create a new meditation script with a guided Claude session");
```

- [x] **Step 1.3: Run tests to verify they now fail**

```bash
npm test -- --run src/cli/tests/cli-commands.test.ts
```

Expected: 2 failures on the description assertions. All other tests still pass.

---

### Task 2: Update `program.ts` descriptions and add afterText

**Files:**
- Modify: `src/cli/program.ts`

- [x] **Step 2.1: Update root program description and add workflow afterText**

In `createProgram()`, after `.version("0.1.0")`, add:

```typescript
program
  .addHelpText(
    "after",
    `
Getting started (typical workflow):
  ralph new my-app                        Scaffold a new project in ./my-app/
  ralph plan my-app                       Open an interactive planning session
  ralph implement my-app                  Run the agentic build loop (Ctrl-C to stop)
  ralph implement my-app --max 3          Run at most 3 iterations
  ralph run-scenarios my-app              Discover and run scenario tests

Background scheduling (heartbeat):
  ralph heartbeat meditate my-app --every 30        Run meditate on my-app every 30 min
  ralph heartbeat list                              Show all scheduled tasks
  ralph heartbeat logs meditate:my-app --follow     Stream live logs for a task
  ralph heartbeat watch                             Live TUI dashboard
  ralph heartbeat pause meditate:my-app             Suspend scheduling without removing
  ralph heartbeat resume meditate:my-app            Re-enable a paused task
  ralph heartbeat stop meditate:my-app              Remove task and kill any running session

Meditation (restricted insight sessions):
  ralph meditate my-app                   Run a one-shot meditation session
  ralph meditate create my-app            Create a new meditation script`
  );
```

- [x] **Step 2.2: Update `plan` command**

Change:
```typescript
.description("Open an interactive Claude planning session")
```
To:
```typescript
.description("Open an interactive Claude session to write specs, README, and build prompts")
.addHelpText("after", "\nExamples:\n  ralph plan my-app\n")
```

- [x] **Step 2.3: Update `implement` command**

Change:
```typescript
.description("Run the agentic implementation loop")
```
To:
```typescript
.description("Run the agentic build loop — Claude reads prompts, writes code, commits, and pushes")
.addHelpText("after", "\nExamples:\n  ralph implement my-app\n  ralph implement my-app --max 5\n")
```

- [x] **Step 2.4: Update `new` command**

Change:
```typescript
.description("Scaffold a new project and launch a kickoff session")
```
To:
```typescript
.description("Create a new project folder with prompts, specs/, and a guided Claude kickoff session")
.addHelpText("after", "\nExamples:\n  ralph new my-app\n")
```

- [x] **Step 2.5: Update `meditate` parent command**

Change:
```typescript
.description("Meditation commands")
```
To:
```typescript
.description("Run a restricted Claude session that writes insights to meditations/illuminations/")
.addHelpText("after", "\nExamples:\n  ralph meditate my-app\n")
```

- [x] **Step 2.6: Update `meditate create` subcommand**

Change:
```typescript
.description("Create a new meditation script")
```
To:
```typescript
.description("Create a new meditation script with a guided Claude session")
.addHelpText("after", "\nExamples:\n  ralph meditate create my-app\n")
```

- [x] **Step 2.7: Update `run-scenarios` command**

Change:
```typescript
.description("Discover and run scenario tests, writing actionable reports")
```
To:
```typescript
.description("Discover scenario-tests/*.md files, run them with Claude, and write reports to scenario-runs/")
.addHelpText("after", "\nExamples:\n  ralph run-scenarios my-app\n  ralph run-scenarios my-app --all\n")
```

- [x] **Step 2.8: Run tests to verify they pass**

```bash
npm test -- --run src/cli/tests/cli-commands.test.ts
```

Expected: all tests pass.

- [x] **Step 2.9: Smoke-check the output**

```bash
node dist/cli/index.js --help
```

Expected: root help shows the "Getting started" and "Background scheduling" sections below the command list.

If `dist/` is stale, run `npm run build` first.

- [x] **Step 2.10: Commit**

```bash
git add src/cli/program.ts src/cli/tests/cli-commands.test.ts
git commit -m "feat: improve program.ts help text — descriptions and workflow afterText"
```

---

## Chunk 2: Update `heartbeat.ts` — subcommand descriptions + afterText

**Spec:** `docs/superpowers/specs/2026-04-07-help-text-design.md`

### Files
- Modify: `src/cli/commands/heartbeat.ts`

---

### Task 3: Update heartbeat subcommand descriptions and add examples

**Files:**
- Modify: `src/cli/commands/heartbeat.ts`

- [x] **Step 3.1: Update `heartbeat` group description**

In `registerHeartbeatCommand()`:

Change:
```typescript
.description("Manage background scheduled tasks")
```
To:
```typescript
.description("Manage background scheduled tasks (daemon-backed; persists across terminal sessions)")
.addHelpText("after", `
Examples:
  ralph heartbeat list
  ralph heartbeat watch`)
```

- [x] **Step 3.2: Update `heartbeat meditate` subcommand**

Change:
```typescript
.description("Run meditate on a project folder on a heartbeat schedule")
```
To:
```typescript
.description("Schedule meditate to run on a project folder at a fixed interval")
.addHelpText("after", "\nExamples:\n  ralph heartbeat meditate my-app --every 30\n")
```

- [x] **Step 3.3: Update `heartbeat list` subcommand**

Change:
```typescript
.description("List all registered heartbeat tasks")
```
To:
```typescript
.description("List all registered tasks with their status and last run time")
```

- [x] **Step 3.4: Update `heartbeat stop` subcommand**

Change:
```typescript
.description("Remove task and kill any running session")
```
To:
```typescript
.description("Remove a task from the schedule and kill any running session")
.addHelpText("after", "\nExamples:\n  ralph heartbeat stop meditate:my-app\n")
```

- [x] **Step 3.5: Update `heartbeat pause` subcommand**

Change:
```typescript
.description("Suspend scheduling without removing the task")
```
To:
```typescript
.description("Suspend scheduling for a task without removing it")
.addHelpText("after", "\nExamples:\n  ralph heartbeat pause meditate:my-app\n")
```

- [x] **Step 3.6: Update `heartbeat resume` subcommand**

Change:
```typescript
.description("Re-enable scheduling for a paused task")
```
To:
```typescript
.description("Re-enable scheduling for a paused task")
.addHelpText("after", "\nExamples:\n  ralph heartbeat resume meditate:my-app\n")
```

- [x] **Step 3.7: Update `heartbeat kill` subcommand**

Change:
```typescript
.description("Kill running session only — schedule stays")
```
To:
```typescript
.description("Kill the currently running session for a task; schedule is preserved")
.addHelpText("after", "\nExamples:\n  ralph heartbeat kill meditate:my-app\n")
```

- [x] **Step 3.8: Update `heartbeat logs` subcommand**

Change:
```typescript
.description("Print logs for a task")
```
To:
```typescript
.description("Print logs for a task; use --follow to stream live output")
.addHelpText("after", "\nExamples:\n  ralph heartbeat logs meditate:my-app\n  ralph heartbeat logs meditate:my-app --follow\n")
```

- [x] **Step 3.9: Update `heartbeat watch` subcommand**

Change:
```typescript
.description("Live TUI: all tasks + streaming output")
```
To:
```typescript
.description("Open a live TUI dashboard showing all tasks and streaming output")
```

- [x] **Step 3.10: Run full test suite**

```bash
npm test -- --run
```

Expected: all tests pass. (No heartbeat description tests exist yet — this step confirms nothing regressed.)

- [x] **Step 3.11: Smoke-check heartbeat help**

```bash
node dist/cli/index.js heartbeat --help
node dist/cli/index.js heartbeat meditate --help
node dist/cli/index.js heartbeat logs --help
```

Build first if needed: `npm run build`

Expected:
- `heartbeat --help` shows new group description + "Examples:" block
- `heartbeat meditate --help` shows example with `--every 30`
- `heartbeat logs --help` shows two examples (with and without `--follow`)

- [x] **Step 3.12: Commit**

```bash
git add src/cli/commands/heartbeat.ts
git commit -m "feat: improve heartbeat.ts help text — descriptions and per-subcommand examples"
```
