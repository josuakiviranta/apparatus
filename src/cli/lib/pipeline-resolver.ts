import { resolve, join, sep } from "path";
import { existsSync } from "fs";
import { resolveBundledPipeline } from "./assets.js";
import { pipelinesDir } from "./ralph-paths.js";

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

export function isNameShorthand(arg: string): boolean {
  if (arg.includes(sep) || arg.includes("/")) return false;
  if (arg.endsWith(".dot")) return false;
  return true;
}

export function getPipelinesDir(project: string): string {
  return pipelinesDir(resolve(project));
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

  // 2. Project-local — flat-form (user-authored pipelines may still use flat layout)
  const projectPath = join(getPipelinesDir(project), `${arg}.dot`);
  if (existsSync(projectPath)) return projectPath;

  // 3. Bundled
  return resolveBundledPipeline(arg);
}
