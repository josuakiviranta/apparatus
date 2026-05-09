import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { newRunId, runsDir } from "../cli/lib/apparat-paths.js";
import { resolveProjectFromArgs, injectRunArgs } from "./runner-args.js";
import { createRun, appendLogLine, closeRun, getPidFilePath } from "./state";
import type { Task } from "./state";

export function getRalphCliPath(): { command: string; args: string[]; shell: boolean } {
  // Allow test override
  const testCmd = process.env.APPARAT_TEST_CMD;
  if (testCmd) {
    // Return as shell command to preserve quoting (e.g. node -e "process.exit(1)")
    return { command: testCmd, args: [], shell: true };
  }
  if (typeof __APPARAT_PROD__ !== "undefined") {
    // production: dist/daemon/ -> dist/cli/index.js
    return { command: process.execPath, args: [join(__dirname, "..", "cli", "index.js")], shell: false };
  }
  // dev mode: src/daemon -> src/cli/index.ts
  return { command: "tsx", args: [join(__dirname, "..", "cli", "index.ts")], shell: false };
}

export function isSessionRunning(task: Task): boolean {
  const pidPath = getPidFilePath(task.id);
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
  const pidPath = getPidFilePath(task.id);
  if (!existsSync(pidPath)) return false;
  const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
    try { unlinkSync(pidPath); } catch {}
    return true;
  } catch {
    return false;
  }
}

export async function runTask(task: Task): Promise<{ runId: string; exitCode: number }> {
  const runId = newRunId();
  const startedAt = Date.now();
  createRun(task.id, runId, startedAt);
  appendLogLine(task.id, runId, { ts: startedAt, stream: "system", content: "Session started" });

  const cliPath = getRalphCliPath();

  // For `pipeline run` tasks with --project, route the engine trace into the
  // project-local tree so we collapse onto the existing JsonlPipelineTracer
  // seam rather than maintaining a parallel home-global stream.
  const projectRoot =
    task.command === "pipeline" && task.args[0] === "run"
      ? resolveProjectFromArgs(task.args)
      : null;

  let augmentedArgs = task.args;
  let logsRoot: string | null = null;
  if (projectRoot) {
    logsRoot = join(runsDir(projectRoot), runId);
    augmentedArgs = injectRunArgs(task.args, runId, logsRoot);
  }

  if (logsRoot) {
    appendLogLine(task.id, runId, {
      ts: startedAt,
      stream: "system",
      content: `Engine trace: ${join(logsRoot, "pipeline.jsonl")}`,
    });
  }

  // In test mode, the test command replaces the entire invocation (no task args appended).
  const fullArgs = cliPath.shell ? [] : [...cliPath.args, task.command, ...augmentedArgs];

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

    const pidPath = getPidFilePath(task.id);
    if (child.pid) {
      writeFileSync(pidPath, String(child.pid));
    }

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
      try { unlinkSync(pidPath); } catch {}
      const exitCode = code ?? 1;
      const endedAt = Date.now();
      if (logsRoot && projectRoot) {
        appendLogLine(task.id, runId, {
          ts: endedAt,
          stream: "system",
          content: `→ apparat pipeline trace ${runId} --project ${projectRoot}`,
        });
      }
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
