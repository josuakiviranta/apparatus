import { resolve, join, sep } from "path";

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
    throw new Error(`Invalid pipeline name "${arg}": only letters, numbers, hyphens, and underscores are allowed`);
  }
  return join(getPipelinesDir(project), `${arg}.dot`);
}
