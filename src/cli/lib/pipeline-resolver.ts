import { resolve, join, sep } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { getBundledPipelinePath } from "./assets.js";

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

export function isNameShorthand(arg: string): boolean {
  if (arg.includes(sep) || arg.includes("/")) return false;
  if (arg.endsWith(".dot")) return false;
  return true;
}

export function getPipelinesDir(project: string): string {
  return join(resolve(project), "pipelines");
}

export function resolvePipelineArg(arg: string, project: string): string {
  if (!isNameShorthand(arg)) {
    return resolve(arg);
  }
  if (!VALID_NAME.test(arg)) {
    throw new Error(
      `Invalid pipeline name "${arg}": only letters, numbers, hyphens, and underscores are allowed`
    );
  }

  // 1. Project-local — folder-form (Decision 1: per-pipeline folder = SSoT)
  const projectFolderPath = join(getPipelinesDir(project), arg, "pipeline.dot");
  if (existsSync(projectFolderPath)) return projectFolderPath;

  // 2. Project-local — flat-form (back-compat until Chunk 4 finishes migrating every pipeline)
  const projectPath = join(getPipelinesDir(project), `${arg}.dot`);
  if (existsSync(projectPath)) return projectPath;

  // 3. User home — folder-form
  const userFolderPath = join(homedir(), ".ralph", "pipelines", arg, "pipeline.dot");
  if (existsSync(userFolderPath)) return userFolderPath;

  // 4. User home — flat-form
  const userPath = join(homedir(), ".ralph", "pipelines", `${arg}.dot`);
  if (existsSync(userPath)) return userPath;

  // 5. Bundled
  return getBundledPipelinePath(arg);
}
