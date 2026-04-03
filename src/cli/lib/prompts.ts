import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "fs";
import { join } from "path";
import { getPromptPath } from "./assets";

export interface BootstrapResult {
  needsSetup: boolean;
  injected: string[];
}

const PROMPT_FILES = ["PROMPT_plan.md", "PROMPT_build.md"] as const;
type PromptFile = (typeof PROMPT_FILES)[number];

function promptType(filename: PromptFile): "plan" | "build" {
  return filename === "PROMPT_plan.md" ? "plan" : "build";
}

function appendToGitignore(projectFolder: string, entries: string[]): void {
  const gitignorePath = join(projectFolder, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
    : "";

  const lines = existing.split("\n");
  const toAdd = entries.filter((e) => !lines.includes(e));

  if (toAdd.length === 0) return;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, existing + separator + toAdd.join("\n") + "\n");
}

export async function bootstrapPrompts(
  projectFolder: string
): Promise<BootstrapResult> {
  if (!existsSync(projectFolder)) {
    throw new Error(`Project folder does not exist: ${projectFolder}`);
  }

  const injected: string[] = [];

  for (const filename of PROMPT_FILES) {
    const dest = join(projectFolder, filename);
    if (!existsSync(dest)) {
      const src = getPromptPath(promptType(filename));
      copyFileSync(src, dest);
      injected.push(filename);
    }
  }

  if (injected.length > 0) {
    appendToGitignore(projectFolder, injected);
  }

  return {
    needsSetup: injected.length > 0,
    injected,
  };
}
