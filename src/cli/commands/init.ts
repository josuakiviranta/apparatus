// src/cli/commands/init.ts
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  ralphDir,
  pipelinesDir,
  illuminationsDir,
  stimuliDir,
  memoryDir,
  docsAdrDir,
} from "../lib/ralph-paths.js";
import { join } from "node:path";

export async function initCommand(projectRoot: string): Promise<void> {
  const dirs = [
    ralphDir(projectRoot),
    pipelinesDir(projectRoot),
    illuminationsDir(projectRoot),
    stimuliDir(projectRoot),
    memoryDir(projectRoot),
    docsAdrDir(projectRoot),
  ];
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
  }

  const visionPath = join(ralphDir(projectRoot), "VISION.md");
  if (!existsSync(visionPath)) {
    writeFileSync(visionPath, "# Vision\n\n_Describe what this project is and why it exists._\n");
  }

  const contextPath = join(ralphDir(projectRoot), "CONTEXT.md");
  if (!existsSync(contextPath)) {
    writeFileSync(contextPath, "# Domain Language\n\n## Glossary\n\n_Define the terms specific to this project's domain._\n");
  }

  const readmePath = join(projectRoot, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, "# Project\n\n_Top-level entry point for human readers._\n");
  }

  appendGitignoreLine(projectRoot, ".ralph/runs/");

  if (!existsSync(join(projectRoot, ".git"))) {
    try {
      execSync(`git -C "${projectRoot}" init -b main`, { stdio: "ignore" });
    } catch {
      // git unavailable — non-fatal; user can run git init manually
    }
  }
}

function appendGitignoreLine(projectRoot: string, line: string): void {
  const path = join(projectRoot, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  // Match against trimmed-whole-line equality. This intentionally does NOT
  // dedupe near-variants like "/.ralph/runs/" or ".ralph/runs" (no trailing
  // slash) — those are distinct gitignore patterns; user owns reconciliation.
  const already = existing.split("\n").some((l) => l.trim() === line);
  if (already) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(path, `${sep}${line}\n`);
}
