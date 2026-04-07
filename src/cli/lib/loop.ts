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
} from "@clack/prompts";
import { processLine, initialState } from "./stream-formatter.js";

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

      // Feed prompt file into stdin
      const readStream = createReadStream(promptFile);
      readStream.pipe(child.stdin as NodeJS.WritableStream);

      // Track exit code
      let exitCode = 0;
      const exitPromise = new Promise<void>((resolve) => {
        child.on("exit", (code) => {
          exitCode = code ?? 0;
          resolve();
        });
      });

      // Process stdout line-by-line through stream-formatter
      const rl = readline.createInterface({
        input: child.stdout as NodeJS.ReadableStream,
        crlfDelay: Infinity,
      });
      let state = initialState();
      rl.on("line", (line) => {
        const { output, nextState } = processLine(line, state);
        state = nextState;
        if (output) process.stdout.write(output);
      });
      await new Promise<void>((resolve) => rl.on("close", resolve));
      await exitPromise;

      currentPid = undefined;

      if (exitCode !== 0) {
        log.warn(`claude exited with code ${exitCode}`);
      }

      // Git push
      const s = spinner();
      s.start("git push...");
      const push = spawnSync("git", ["push", "origin", branch], {
        cwd,
        encoding: "utf8",
      });
      if (push.status !== 0) {
        s.stop("git push failed");
        log.warn(`git push failed: ${push.stderr ?? "unknown error"}`);
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
