import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getApparatHome } from "../../daemon/state.js";

export interface ProjectEntry {
  path: string;       // absolute path
  lastSeen: number;   // epoch ms
}

const PROJECTS_FILE = "projects.json";

export function projectsFilePath(): string {
  return join(getApparatHome(), PROJECTS_FILE);
}

export function readProjects(): ProjectEntry[] {
  const p = projectsFilePath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProjectEntry[];
  } catch {
    return [];
  }
}

/**
 * Idempotent: insert when absent, refresh `lastSeen` when present.
 * Never throws — operator-state index is best-effort and must not fail the caller.
 */
export function recordProject(absPath: string): void {
  try {
    mkdirSync(getApparatHome(), { recursive: true });
    const list = readProjects();
    const idx = list.findIndex((e) => e.path === absPath);
    const now = Date.now();
    if (idx === -1) list.push({ path: absPath, lastSeen: now });
    else list[idx] = { ...list[idx], lastSeen: now };
    writeFileSync(projectsFilePath(), JSON.stringify(list, null, 2) + "\n");
  } catch {
    // Best-effort. Swallow.
  }
}
