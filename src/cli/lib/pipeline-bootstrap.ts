import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { basename, dirname, join } from "path";
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

/**
 * Shape signals that mark a folder as "apparat-shaped" for orient-before-write
 * preflight. Order is irrelevant — any single signal is sufficient.
 */
const SHAPE_SIGNALS = ["VISION.md", "CONTEXT.md", ".apparat", ".git"];

export class ApparatShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApparatShapeError";
  }
}

/**
 * Refuse paths that are not apparat-shaped, before any side effect runs.
 * Hard-refuse `basename === ".apparat"` (a typo / autocomplete slip pointed at
 * the project's internal folder). Otherwise require at least one shape signal:
 * VISION.md, CONTEXT.md, .apparat/, or .git/.
 */
export function assertApparatShape(absPath: string): void {
  if (basename(absPath) === ".apparat") {
    throw new ApparatShapeError(
      `${absPath} is an apparat-internal folder — did you mean ${dirname(absPath)}?`,
    );
  }
  const hasSignal = SHAPE_SIGNALS.some((s) => existsSync(join(absPath, s)));
  if (!hasSignal) {
    throw new ApparatShapeError(
      `${absPath} does not look like an apparat-shaped project root ` +
      `(no VISION.md / CONTEXT.md / .apparat/ / .git/). ` +
      `Did you mean its parent?`,
    );
  }
}
