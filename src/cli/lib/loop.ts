import { spawnSync, spawn } from "child_process";
import { existsSync, createReadStream } from "fs";
import readline from "readline";
import * as output from "./output.js";
import { processLine, initialState, flushState } from "./stream-formatter.js";
import type { StreamEvent } from "./stream-formatter.js";

export interface LoopOptions {
  promptFile: string; // absolute path to PROMPT_build.md
  cwd: string;        // project folder (claude cwd + git ops)
  max?: number;       // max iterations; undefined = unlimited
  model?: string;     // passed to --model flag; defaults to "opus"
}

export async function runLoop(options: LoopOptions): Promise<void> {
  const { promptFile, cwd, max, model = "opus" } = options;

  // Pre-flight: prompt file
  if (!existsSync(promptFile)) {
    await output.error(`Prompt file not found: ${promptFile}`);
    process.exit(1);
  }

  // Pre-flight: claude CLI
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("claude CLI not found. Install: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // Capture branch once before loop
  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
  });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "implement", project: cwd, branch, pid: process.pid });

  let iteration = 0;
  let currentPid: number | undefined;

  const killCurrent = () => {
    if (currentPid !== undefined) {
      try {
        process.kill(-currentPid, "SIGTERM");
      } catch {}
    }
  };

  const onSignal = () => {
    killCurrent();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    while (true) {
      if (max !== undefined && iteration >= max) {
        await output.info(`Reached max iterations: ${max}`);
        break;
      }

      // Spawn claude
      const child = spawn(
        "claude",
        [
          "-p",
          "--dangerously-skip-permissions",
          "--output-format=stream-json",
          "--model",
          model,
        ],
        {
          cwd,
          stdio: ["pipe", "pipe", "inherit"],
          detached: true,
        }
      );

      currentPid = child.pid;

      // Track exit code
      let exitCode = 0;
      const exitPromise = new Promise<void>((resolve) => {
        child.on("exit", (code) => {
          exitCode = code ?? 0;
          resolve();
        });
      });

      // Stream session output through output.stream (Ink-based)
      async function* sessionStream(): AsyncGenerator<StreamEvent> {
        const readStream = createReadStream(promptFile);
        readStream.pipe(child.stdin as NodeJS.WritableStream);

        const rl = readline.createInterface({
          input: child.stdout as NodeJS.ReadableStream,
          crlfDelay: Infinity,
        });

        let state = initialState();
        for await (const line of rl) {
          const { events, nextState } = processLine(line, state);
          state = nextState;
          for (const e of events) yield e;
        }

        for (const e of flushState(state)) yield e;
      }

      await output.stream(sessionStream());
      await exitPromise;

      currentPid = undefined;

      if (exitCode !== 0) {
        await output.warn(`claude exited with code ${exitCode}`);
      }

      // Git push (retry with -u on failure, matching loop.sh behavior)
      const push = spawnSync("git", ["push", "origin", branch], {
        cwd,
        encoding: "utf8",
      });
      if (push.status !== 0) {
        const retry = spawnSync("git", ["push", "-u", "origin", branch], {
          cwd,
          encoding: "utf8",
        });
        if (retry.status !== 0) {
          await output.warn(`git push failed: ${retry.stderr ?? "unknown error"}`);
        }
      }

      iteration++;
      await output.step(`LOOP ${iteration}`);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
