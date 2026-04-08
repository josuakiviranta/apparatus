import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { randomUUID } from "crypto";
import { createRun, appendLogLine, closeRun } from "./state";
import type { Task } from "./state";

export function getRalphCliPath(): { command: string; args: string[]; shell: boolean } {
  // Allow test override
  const testCmd = process.env.RALPH_TEST_CMD;
  if (testCmd) {
    // Return as shell command to preserve quoting (e.g. node -e "process.exit(1)")
    return { command: testCmd, args: [], shell: true };
  }
  if (typeof __RALPH_PROD__ !== "undefined") {
    // production: dist/daemon/ -> dist/cli/index.js
    return { command: process.execPath, args: [join(__dirname, "..", "cli", "index.js")], shell: false };
  }
  // dev mode: src/daemon -> src/cli/index.ts
  return { command: "tsx", args: [join(__dirname, "..", "cli", "index.ts")], shell: false };
}

// PID file lives inside the project folder -- matches meditate.ts convention.
// task.args[0] is always the absolute project folder path.
function getPidPath(projectFolder: string): string {
  return join(projectFolder, ".meditate.pid");
}

export function isSessionRunning(task: Task): boolean {
  const pidPath = getPidPath(task.args[0]);
  if (!existsSync(pidPath)) return false;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killSession(task: Task): boolean {
  const pidPath = getPidPath(task.args[0]);
  if (!existsSync(pidPath)) return false;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export async function runTask(task: Task): Promise<{ runId: string; exitCode: number }> {
  const runId = randomUUID();
  const startedAt = Date.now();
  createRun(task.id, runId, startedAt);
  appendLogLine(task.id, runId, { ts: startedAt, stream: "system", content: "Session started" });

  const cliPath = getRalphCliPath();
  // In test mode, the test command replaces the entire invocation (no task args appended).
  const fullArgs = cliPath.shell ? [] : [...cliPath.args, task.command, ...task.args];

  // Strip Claude Code session markers so spawned `claude` processes aren't
  // blocked by the "nested session" guard.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise((resolve) => {
    const child = spawn(cliPath.command, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: cliPath.shell,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        appendLogLine(task.id, runId, { ts: Date.now(), stream: "stdout", content: line });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        appendLogLine(task.id, runId, { ts: Date.now(), stream: "stderr", content: line });
      }
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const endedAt = Date.now();
      appendLogLine(task.id, runId, {
        ts: endedAt,
        stream: "system",
        content: `Session ended (exit ${exitCode})`,
      });
      closeRun(task.id, runId, endedAt, exitCode);
      resolve({ runId, exitCode });
    });
  });
}
