---
status: implemented
---

# Pipeline Refine Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ralph pipeline refine <name>` so users can iterate on an existing pipeline `.dot` file with the same agent-assisted two-phase Claude session that `pipeline create` uses for new pipelines, and surface the command in the `pipeline create` conflict message.

**Architecture:** `pipelineRefineCommand` lives next to `pipelineCreateCommand` in `src/cli/commands/pipeline.ts` and reuses everything `create` already uses: name resolution (`resolvePipelineArg`), prompt composition (`composeCreatePrompt`), the non-interactive → resume two-phase `spawn`/`spawnSync` flow, and post-session `pipelineValidateCommand`. The only meaningful deltas vs. `create` are: (a) the conflict check is inverted (must exist, not must be absent), and (b) the trigger string wraps the existing `.dot` content in a fenced block and frames the session as an edit. `pipelineCreateCommand`'s conflict message is updated to surface `refine`. Registration in `src/cli/program.ts` mirrors the other four subcommands. No new bundled prompt asset.

**Tech Stack:** TypeScript, Node.js, Vitest, Commander. Key files: `src/cli/commands/pipeline.ts`, `src/cli/program.ts`, `src/cli/tests/pipeline.test.ts`, `README.md`.

**Design doc:** `docs/superpowers/specs/2026-04-16-pipeline-refine-command-design.md`

---

## Chunk 1: Update `pipelineCreateCommand` conflict message

**Files:**
- Modify: `src/cli/commands/pipeline.ts:488-492`
- Modify: `src/cli/tests/pipeline.test.ts:287-294` (existing "errors if pipelines/name.dot already exists" test)

Pure message-text change. The existing test already asserts `"already exists"` substring — we tighten it to also assert the new `refine` hint. No behavior change, no new code paths.

- [ ] **Step 1: Update the existing conflict-check assertion in pipeline.test.ts**

  Find the test at `src/cli/tests/pipeline.test.ts:287-294`:

  ```typescript
  it("errors if pipelines/name.dot already exists", async () => {
    mkdirSync(join(dir, "pipelines"));
    writeFileSync(join(dir, "pipelines", "review.dot"), VALID_DOT);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineCreateCommand("review", { project: dir })).rejects.toThrow();
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    exitSpy.mockRestore();
  });
  ```

  Replace the single `expect(out.error)` line with two assertions — one for the existing substring and one for the new `refine` hint:

  ```typescript
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(out.error).toHaveBeenCalledWith(expect.stringContaining("ralph pipeline refine review"));
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "errors if pipelines/name.dot already exists"`
  Expected: FAIL — current code still says `"Delete or rename it before running create."`, does not mention `refine`.

- [ ] **Step 3: Update the conflict-check message in `pipelineCreateCommand`**

  In `src/cli/commands/pipeline.ts`, find lines 488-492:

  ```typescript
  // Conflict check
  if (existsSync(dotPath)) {
    await output.error(`Pipeline already exists: ${dotPath}\nDelete or rename it before running create.`);
    process.exit(1);
  }
  ```

  Replace with:

  ```typescript
  // Conflict check
  if (existsSync(dotPath)) {
    await output.error(
      `Pipeline already exists: ${dotPath}\n` +
        `Use 'ralph pipeline refine ${name}' to modify it, ` +
        `or delete the file first to start over.`,
    );
    process.exit(1);
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "errors if pipelines/name.dot already exists"`
  Expected: PASS.

- [ ] **Step 5: Run full pipeline test file to confirm no regression**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts`
  Expected: all tests pass (17 tests in that file today).

- [ ] **Step 6: Commit**

  ```bash
  git add src/cli/commands/pipeline.ts src/cli/tests/pipeline.test.ts
  git commit -m "feat(pipeline): surface refine in create conflict message"
  ```

---

## Chunk 2: Implement `pipelineRefineCommand`

**Files:**
- Modify: `src/cli/commands/pipeline.ts` (append new exported function after `pipelineCreateCommand`, around line 553)
- Modify: `src/cli/tests/pipeline.test.ts` (append new `describe("pipelineRefineCommand", ...)` block after the existing `pipelineCreateCommand` describe at line 321)

The new command mirrors `pipelineCreateCommand` closely. Work through the tests first, then write one function that satisfies all of them.

- [ ] **Step 1: Write failing tests for `pipelineRefineCommand`**

  Append to `src/cli/tests/pipeline.test.ts` (after line 321, before the closing brace of the last describe — `refine` gets its own top-level `describe` block):

  ```typescript
  describe("pipelineRefineCommand", () => {
    let dir: string;
    beforeEach(() => {
      vi.clearAllMocks();
      dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-refine-"));
      // Default spawnSync: treat `which claude` as present and any spawnSync call as success
      (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({ status: 0 }));
    });
    afterEach(() => { rmSync(dir, { recursive: true }); });

    it("errors if claude CLI not found", async () => {
      (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({ status: 1 });
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
      await expect(
        pipelineRefineCommand("review", { project: dir }),
      ).rejects.toThrow();
      expect(out.error).toHaveBeenCalledWith(expect.stringContaining("claude CLI not found"));
      exitSpy.mockRestore();
    });

    it("errors when pipeline does not exist and points at create", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
      await expect(
        pipelineRefineCommand("review", { project: dir }),
      ).rejects.toThrow();
      expect(out.error).toHaveBeenCalledWith(expect.stringContaining("Pipeline not found"));
      expect(out.error).toHaveBeenCalledWith(expect.stringContaining("ralph pipeline create review"));
      exitSpy.mockRestore();
    });

    it("errors on invalid pipeline name", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
      await expect(
        pipelineRefineCommand("bad name!", { project: dir }),
      ).rejects.toThrow();
      expect(out.error).toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it("injects existing .dot content verbatim into the kickoff trigger", async () => {
      mkdirSync(join(dir, "pipelines"));
      const dotPath = join(dir, "pipelines", "review.dot");
      writeFileSync(dotPath, VALID_DOT);
      (composeCreatePrompt as ReturnType<typeof vi.fn>).mockReturnValue("# Base prompt");

      const spawnMock = childProcess.spawn as ReturnType<typeof vi.fn>;
      spawnMock.mockClear();

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
      await expect(
        pipelineRefineCommand("review", { project: dir }),
      ).rejects.toThrow("exit");
      exitSpy.mockRestore();

      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0][1] as string[];
      // args = ["-p", trigger, "--output-format", ...]
      const trigger = args[1];
      expect(trigger).toContain("# Base prompt");
      expect(trigger).toContain("Here is the current pipeline");
      expect(trigger).toContain("```dot");
      expect(trigger).toContain(VALID_DOT);
      expect(trigger).toContain(dotPath);
    });

    it("runs validate after a clean session exit", async () => {
      mkdirSync(join(dir, "pipelines"));
      const dotPath = join(dir, "pipelines", "review.dot");
      writeFileSync(dotPath, VALID_DOT);

      // spawnSync: first call is `which claude` → 0, second is the interactive resume → 0
      (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => ({ status: 0 }));

      // process.exit is called at the end with the validation exit code
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      });
      await expect(
        pipelineRefineCommand("review", { project: dir }),
      ).rejects.toThrow("exit:0");
      // The validate call logs success via out.success
      expect(out.success).toHaveBeenCalledWith(expect.stringContaining("Pipeline valid"));
      exitSpy.mockRestore();
    });

    it("warns and exits non-zero if the file is gone after a clean session", async () => {
      mkdirSync(join(dir, "pipelines"));
      const dotPath = join(dir, "pipelines", "review.dot");
      writeFileSync(dotPath, VALID_DOT);

      // spawnSync returns 0 for which, and for the interactive resume deletes the file
      (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === "claude") rmSync(dotPath);
        return { status: 0 };
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      });
      await expect(
        pipelineRefineCommand("review", { project: dir }),
      ).rejects.toThrow("exit:1");
      expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("was removed"));
      exitSpy.mockRestore();
    });

    it("exits non-zero without validating when claude resume returns non-zero", async () => {
      mkdirSync(join(dir, "pipelines"));
      const dotPath = join(dir, "pipelines", "review.dot");
      writeFileSync(dotPath, VALID_DOT);

      // spawnSync: `which claude` → 0, interactive resume → 2 (aborted)
      let nthCall = 0;
      (childProcess.spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        nthCall += 1;
        return nthCall === 1 ? { status: 0 } : { status: 2 };
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      });
      await expect(
        pipelineRefineCommand("review", { project: dir }),
      ).rejects.toThrow("exit:2");
      // validate should NOT have run
      expect(out.success).not.toHaveBeenCalledWith(expect.stringContaining("Pipeline valid"));
      exitSpy.mockRestore();
    });
  });
  ```

  Also update the import line at `src/cli/tests/pipeline.test.ts:52` to add `pipelineRefineCommand` to the named imports from `"../commands/pipeline.js"`:

  ```typescript
  import {
    pipelineRunCommand,
    pipelineValidateCommand,
    pipelineListCommand,
    pipelineCreateCommand,
    pipelineRefineCommand,
  } from "../commands/pipeline.js";
  ```

- [ ] **Step 2: Run tests to confirm failure**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t pipelineRefineCommand`
  Expected: FAIL — `pipelineRefineCommand` is not exported from `../commands/pipeline.js`.

- [ ] **Step 3: Implement `pipelineRefineCommand`**

  Open `src/cli/commands/pipeline.ts`. At the end of the file (after the closing brace of `pipelineCreateCommand` at line 552), append:

  ```typescript
  export interface PipelineRefineOptions {
    project?: string;
  }

  export async function pipelineRefineCommand(name: string, opts: PipelineRefineOptions = {}): Promise<void> {
    const which = spawnSync("which", ["claude"], { encoding: "utf8" });
    if (which.status !== 0) {
      await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
      process.exit(1);
    }

    const project = resolve(opts.project ?? process.cwd());
    const pipelinesDir = getPipelinesDir(project);
    const dotPath = join(pipelinesDir, `${name}.dot`);

    // Validate name via resolvePipelineArg (same rules as create)
    try {
      resolvePipelineArg(name, project);
    } catch (err) {
      await output.error((err as Error).message);
      process.exit(1);
    }

    // Must exist (inverse of create's conflict check)
    if (!existsSync(dotPath)) {
      await output.error(
        `Pipeline not found: ${dotPath}\n` +
          `Use 'ralph pipeline create ${name}' to create it.`,
      );
      process.exit(1);
    }

    const existingContent = readFileSync(dotPath, "utf8");
    const relativePath = dotPath.startsWith(project + "/") ? dotPath.slice(project.length + 1) : dotPath;

    const basePrompt = composeCreatePrompt(project);
    const refineFraming =
      `Here is the current pipeline workflow at ${relativePath}:\n\n` +
      "```dot\n" +
      existingContent +
      (existingContent.endsWith("\n") ? "" : "\n") +
      "```\n\n" +
      `The user wants to refine it. Discuss what they want to change, propose targeted edits ` +
      `to the existing graph (do not redesign from scratch), then write the updated version back ` +
      `to ${dotPath}. Preserve node IDs and edge labels that the user does not explicitly want ` +
      `changed — downstream tooling routes on edge labels.`;

    const trigger = `${basePrompt}\n\n---\n${refineFraming}`;

    await output.step(`Refining pipeline: ${name}`);
    await output.step(`Target: ${dotPath}`);

    // Phase 1: non-interactive kickoff to obtain session ID
    let sessionId: string | null = null;
    const child = spawn(
      "claude",
      ["-p", trigger, "--output-format", "stream-json", "--dangerously-skip-permissions"],
      { cwd: project, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exitPromise = new Promise<void>((res) => child.on("close", () => res()));
    await output.stream(
      streamEvents(child.stdout as NodeJS.ReadableStream, {
        onSessionId: (id) => { sessionId = id; },
      }),
    );
    await exitPromise;

    // Phase 2: interactive resume
    await output.step("━━━ Launching interactive session ━━━");
    const resumeArgs = [
      "--dangerously-skip-permissions",
      ...(sessionId ? ["--resume", sessionId] : []),
    ];
    const result = spawnSync("claude", resumeArgs, {
      cwd: project,
      stdio: "inherit",
      env: process.env,
    });

    // Non-zero claude exit → skip validate, propagate status
    if ((result.status ?? 1) !== 0) {
      process.exit(result.status ?? 1);
    }

    if (!existsSync(dotPath)) {
      await output.warn(`Session ended but ${dotPath} was removed.`);
      process.exit(1);
    }

    await output.step("Validating pipeline...");
    const exitCode = await pipelineValidateCommand(dotPath);
    process.exit(exitCode);
  }
  ```

- [ ] **Step 4: Run tests to confirm passing**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t pipelineRefineCommand`
  Expected: all 6 refine tests pass.

- [ ] **Step 5: Run full test file to confirm no regression**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts`
  Expected: all tests pass.

- [ ] **Step 6: TypeScript sanity check**

  Run: `npm run build`
  Expected: build succeeds, no TS errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/cli/commands/pipeline.ts src/cli/tests/pipeline.test.ts
  git commit -m "feat(pipeline): add refine command for agent-assisted iteration"
  ```

---

## Chunk 3: Register `pipeline refine` subcommand in Commander

**Files:**
- Modify: `src/cli/program.ts:9` (imports)
- Modify: `src/cli/program.ts:187-201` (register new `pipeline refine` subcommand after `pipeline create`)
- Modify: `src/cli/program.ts:43-50` (add `refine` to the top-level `Pipeline engine` help block)

Wire the command into the CLI so `ralph pipeline refine <name>` actually dispatches.

- [ ] **Step 1: Add `pipelineRefineCommand` to the imports**

  At `src/cli/program.ts:9`, replace:

  ```typescript
  import { pipelineRunCommand, pipelineValidateCommand, pipelineCreateCommand, pipelineListCommand, pipelineTraceCommand } from "./commands/pipeline";
  ```

  with:

  ```typescript
  import {
    pipelineRunCommand,
    pipelineValidateCommand,
    pipelineCreateCommand,
    pipelineRefineCommand,
    pipelineListCommand,
    pipelineTraceCommand,
  } from "./commands/pipeline";
  ```

- [ ] **Step 2: Register the `pipeline refine` subcommand**

  In `src/cli/program.ts`, immediately after the `pipeline.command("create <name>") ... .action(...)` block (ends around line 201), insert a new block:

  ```typescript
  pipeline
    .command("refine <name>")
    .description("Refine an existing pipeline with an interactive Claude session")
    .addHelpText("after", `
Examples:
  ralph pipeline refine review --project my-app
  ralph pipeline refine deploy

Loads <project>/pipelines/<name>.dot, opens an agent-assisted Claude session
with the existing graph injected, then validates the edited file on exit.
Use this for every change to an existing pipeline — hand-editing the .dot file
bypasses the scheme guidance and validation loop.
`)
    .option("--project <folder>", "Project folder (pipelines/ lives here, defaults to cwd)")
    .action(async (name: string, opts: { project?: string }) => {
      await pipelineRefineCommand(name, opts);
    });
  ```

- [ ] **Step 3: Add a `pipeline refine` line to the top-level help block**

  In `src/cli/program.ts`, inside the `Pipeline engine (DOT-graph workflows):` help block (around lines 43-50), add a `refine` line between the `create` and `list` entries. Replace:

  ```
  Pipeline engine (DOT-graph workflows):
    ralph pipeline create review --project my-app    Create a new workflow with Claude
    ralph pipeline list --project my-app             List workflows in a project
  ```

  with:

  ```
  Pipeline engine (DOT-graph workflows):
    ralph pipeline create review --project my-app    Create a new workflow with Claude
    ralph pipeline refine review --project my-app    Refine an existing workflow with Claude
    ralph pipeline list --project my-app             List workflows in a project
  ```

- [ ] **Step 4: Build and smoke-check help text**

  Run: `npm run build && node dist/cli/index.js pipeline --help`
  Expected: `refine <name>` appears in the pipeline subcommand list.

  Run: `node dist/cli/index.js pipeline refine --help`
  Expected: shows the example block and `--project <folder>` option.

- [ ] **Step 5: Run full test suite**

  Run: `npx vitest run`
  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add src/cli/program.ts
  git commit -m "feat(cli): register pipeline refine subcommand"
  ```

---

## Chunk 4: README entry for `pipeline refine`

**Files:**
- Modify: `README.md:64-82` (pipeline subcommand block)

Document the new command so users discover it without hunting through `--help`.

- [ ] **Step 1: Add `pipeline refine` after `pipeline create` in README**

  In `README.md`, find the block at lines 69-72:

  ```bash
  ralph pipeline create <project-folder>
  ```
  Open an interactive Claude session to author a new pipeline. Available local agents (`.ralph/agents/*.md`) are automatically injected into the authoring prompt.

  Immediately after it (before the `pipeline list` block), insert:

  ```markdown
  ```bash
  ralph pipeline refine <name> [--project <folder>]
  ```
  Open an interactive Claude session to iterate on an existing `<project>/pipelines/<name>.dot`. The current graph is injected into the session so the agent can propose targeted edits rather than redesigning from scratch. Use this for every change to an existing pipeline — hand-editing the `.dot` file bypasses the scheme guidance and the post-session validate step. `create` is for new workflows; `refine` is for every subsequent change.
  ```

- [ ] **Step 2: Visual check**

  Run: `sed -n '60,90p' README.md`
  Expected: `ralph pipeline create` → `ralph pipeline refine` → `ralph pipeline list` appear in that order, each with its own fenced code block + prose description.

- [ ] **Step 3: Commit**

  ```bash
  git add README.md
  git commit -m "docs(readme): document pipeline refine command"
  ```

---

## Post-completion

After all 4 chunks pass:

1. Run full test suite: `npx vitest run` — all green.
2. Rebuild: `npm run build` — clean.
3. End-to-end smoke against a real pipeline (only if claude CLI is available locally):
   ```bash
   ralph pipeline refine illumination-to-implementation --project .
   ```
   Expected: interactive Claude session opens with the existing `.dot` content visible in the first assistant turn; on exit, `Validating pipeline...` runs and prints a result.
4. Confirm the source illumination still exists:
   ```bash
   ls meditations/illuminations/2026-04-15T1000-pipeline-create-has-no-iteration-workflow.md
   ```
   Fail loudly if absent before proceeding.
5. Mark the illumination dispatched via `mcp__illumination__mark_dispatched` with `filename="2026-04-15T1000-pipeline-create-has-no-iteration-workflow.md"` and `plan_path="docs/superpowers/plans/2026-04-16-pipeline-refine-command.md"`.
