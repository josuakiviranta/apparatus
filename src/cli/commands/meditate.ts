import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { Agent, MCP_CONFIG_GLOB } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";
import { getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets.js";
import { streamEvents } from "../lib/stream-formatter.js";
import * as output from "../lib/output.js";

// ─── PID lock utilities ───────────────────────────────────────────────────────

export function pidPath(projectFolder: string): string {
  return join(projectFolder, ".meditate.pid");
}

export function writePid(projectFolder: string, pid: number): void {
  writeFileSync(pidPath(projectFolder), String(pid));
}

export function readPid(projectFolder: string): number | null {
  const p = pidPath(projectFolder);
  if (!existsSync(p)) return null;
  const n = parseInt(readFileSync(p, "utf8").trim(), 10);
  return isNaN(n) ? null : n;
}

export function removePid(projectFolder: string): void {
  const p = pidPath(projectFolder);
  if (existsSync(p)) unlinkSync(p);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function ensureMeditationDirs(projectFolder: string): void {
  mkdirSync(join(projectFolder, "meditations", "illuminations"), { recursive: true });
}

export function appendMeditateGitignore(projectFolder: string): void {
  const entries = [".meditate.json", ".meditate.log", ".meditate.pid", MCP_CONFIG_GLOB];
  const gitignorePath = join(projectFolder, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split("\n");
  const toAdd = entries.filter((e) => !lines.includes(e));
  if (toAdd.length === 0) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, existing + sep + toAdd.join("\n") + "\n");
}

// ─── Dev/prod detection ──────────────────────────────────────────────────────

function isDevMode(): boolean {
  return typeof __RALPH_PROD__ === "undefined";
}

// ─── Session runner ───────────────────────────────────────────────────────────

export async function runMeditationSession(absPath: string, steer?: string): Promise<void> {
  writePid(absPath, process.pid);

  await output.header({ mode: "meditate", project: absPath, pid: process.pid });

  const config = resolveAgent("meditate");

  // Override MCP command for dev mode (tsx instead of node)
  if (isDevMode()) {
    for (const mcp of config.mcp) {
      if (mcp.command === "node") mcp.command = "tsx";
    }
  }

  const agent = new Agent(config);

  const cleanup = () => {
    agent.kill();
    removePid(absPath);
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  try {
    const result = await agent.run({
      cwd: absPath,
      variables: {
        ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
        PROJECT_ROOT: absPath,
        META_MEDITATIONS_DIR: getMetaMeditationsDir(),
      },
      message: steer,
      onStdout: async (stdout) => {
        await output.stream(streamEvents(stdout, {}));
      },
    });

    if (result.exitCode !== 0) {
      await output.warn(`claude exited with code ${result.exitCode}`);
    }
  } finally {
    process.off("SIGTERM", cleanup);
    process.off("SIGINT", cleanup);
    removePid(absPath);
  }
}

// ─── Command entry point ──────────────────────────────────────────────────────

export async function meditateCommand(projectFolder: string, opts: { steer?: string } = {}): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }
  const runningPid = readPid(absPath);
  if (runningPid !== null && isPidAlive(runningPid)) {
    await output.info(`Meditation session already running (PID ${runningPid}). Skipping.`);
    process.exit(0);
  }
  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);
  await runMeditationSession(absPath, opts.steer);
}
