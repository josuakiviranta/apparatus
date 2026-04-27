import { existsSync } from "fs";
import { resolve } from "path";
import * as output from "../lib/output.js";
import { resolveBundledTemplate } from "../lib/assets.js";
import * as self from "./pipeline.js";

export async function meditateCreateCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
    return;
  }
  const dotFile = resolveBundledTemplate("meditate-create");
  return self.pipelineRunCommand(dotFile, { project: absPath });
}
