import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { MCP_CONFIG_GLOB } from "./agent.js";
import { illuminationsDir } from "./apparat-paths.js";

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
  mkdirSync(illuminationsDir(projectFolder), { recursive: true });
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
