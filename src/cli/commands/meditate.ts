import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { MCP_CONFIG_GLOB } from "../lib/agent.js";
import { resolveBundledTemplate } from "../lib/assets.js";
import * as output from "../lib/output.js";
import * as self from "./pipeline.js";

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
  mkdirSync(join(projectFolder, "meditations", "archived-illuminations"), { recursive: true });
  mkdirSync(join(projectFolder, "meditations", "implemented-illuminations"), { recursive: true });
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

// ─── Command entry point ──────────────────────────────────────────────────────

export async function meditateCommand(
  projectFolder: string,
  opts: { variables?: Record<string, string> } = {},
): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  const runningPid = readPid(absPath);
  if (runningPid !== null && isPidAlive(runningPid)) {
    await output.info(`Meditation session already running (PID ${runningPid}). Skipping.`);
    process.exit(0);
  }
  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);
  writePid(absPath, process.pid);
  try {
    const dotFile = resolveBundledTemplate("meditate");
    return await self.pipelineRunCommand(dotFile, {
      project: absPath,
      variables: { steer: opts.variables?.steer ?? "" },
    });
  } finally {
    removePid(absPath);
  }
}
