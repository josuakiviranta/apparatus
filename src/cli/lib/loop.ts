import { spawnSync, spawn } from "child_process";
import { existsSync, createReadStream } from "fs";
import * as output from "./output.js";
import { streamEvents } from "./stream-formatter.js";

export interface LoopOptions {
  promptFile: string; // absolute path to PROMPT_build.md
  cwd: string;        // project folder (claude cwd + git ops)
  max?: number;       // max iterations; undefined = unlimited
  model?: string;     // passed to --model flag; defaults to "opus"
  signal?: AbortSignal;
  onSessionId?: (id: string) => void;
}

export interface LoopResult {
  success: boolean;
  iterations: number;
  sessionId?: string;
  exitReason: "completed" | "maxReached" | "aborted" | "error";
  errorMessage?: string;
}

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const { promptFile, cwd, max, model = "opus", signal, onSessionId } = options;

  // Pre-flight: prompt file
  if (!existsSync(promptFile)) {
    await output.error(`Prompt file not found: ${promptFile}`);
    throw new Error(`Prompt file not found: ${promptFile}`);
  }

  // Pre-flight: claude CLI
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("claude CLI not found. Install: npm install -g @anthropic-ai/claude-code");
    throw new Error("claude CLI not found");
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
  let capturedSessionId: string | undefined;

  const killCurrent = () => {
    if (currentPid !== undefined) {
      try {
        process.kill(-currentPid, "SIGTERM");
      } catch {}
    }
  };

  if (signal?.aborted) {
    return { success: false, iterations: 0, exitReason: "aborted" };
  }

  const abortListener = () => { killCurrent(); };
  signal?.addEventListener("abort", abortListener);

  try {
    while (true) {
      if (signal?.aborted) {
        return { success: false, iterations: iteration, sessionId: capturedSessionId, exitReason: "aborted" };
      }

      if (max !== undefined && iteration >= max) {
        await output.info(`Reached max iterations: ${max}`);
        return { success: true, iterations: iteration, sessionId: capturedSessionId, exitReason: "maxReached" };
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

      // Pipe prompt into claude stdin, stream output through formatter
      const readStream = createReadStream(promptFile);
      readStream.pipe(child.stdin as NodeJS.WritableStream);

      await output.stream(streamEvents(child.stdout as NodeJS.ReadableStream, {
        onSessionId: (id) => {
          capturedSessionId = id;
          onSessionId?.(id);
        },
      }));
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
    signal?.removeEventListener("abort", abortListener);
  }
}
