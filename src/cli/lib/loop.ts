import { spawnSync, spawn } from "child_process";
import { existsSync, createReadStream } from "fs";
import readline from "readline";
import {
  intro,
  outro,
  cancel,
  spinner,
  log,
  note,
  stream,
} from "@clack/prompts";
import { processLine, initialState, flushState } from "./stream-formatter.js";

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
    cancel(`Prompt file not found: ${promptFile}`);
    process.exit(1);
  }

  // Pre-flight: claude CLI
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    cancel("claude CLI not found. Install: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // Capture branch once before loop
  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
  });
  const branch = branchResult.stdout.trim() || "main";

  intro(`ralph implement  |  branch: ${branch}  |  prompt: ${promptFile}`);
  log.step(`PID: ${process.pid}  (Ctrl+C or: kill ${process.pid})`);

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
    outro("Stopped.");
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    while (true) {
      if (max !== undefined && iteration >= max) {
        outro(`Reached max iterations: ${max}`);
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

      // Stream session output through clack
      async function* sessionStream(): AsyncGenerator<string> {
        const readStream = createReadStream(promptFile);
        readStream.pipe(child.stdin as NodeJS.WritableStream);

        const rl = readline.createInterface({
          input: child.stdout as NodeJS.ReadableStream,
          crlfDelay: Infinity,
        });

        let state = initialState();
        for await (const line of rl) {
          const { output, nextState } = processLine(line, state);
          state = nextState;
          if (output) yield output;
        }

        const flush = flushState(state);
        if (flush) yield flush;
      }

      await stream.message(sessionStream());
      await exitPromise;

      currentPid = undefined;

      if (exitCode !== 0) {
        log.warn(`claude exited with code ${exitCode}`);
      }

      // Git push (retry with -u on failure, matching loop.sh behavior)
      const s = spinner();
      s.start("git push...");
      const push = spawnSync("git", ["push", "origin", branch], {
        cwd,
        encoding: "utf8",
      });
      if (push.status !== 0) {
        s.stop("git push failed, retrying with -u...");
        const retry = spawnSync("git", ["push", "-u", "origin", branch], {
          cwd,
          encoding: "utf8",
        });
        if (retry.status !== 0) {
          log.warn(`git push failed: ${retry.stderr ?? "unknown error"}`);
        } else {
          log.step("git push done (set upstream)");
        }
      } else {
        s.stop("git push done");
      }

      iteration++;
      note(`LOOP ${iteration}`, "");
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
