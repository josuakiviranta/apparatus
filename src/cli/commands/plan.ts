import { existsSync } from "fs";
import { resolve } from "path";
import * as output from "../lib/output.js";
import { resolveBundledTemplate } from "../lib/assets.js";
import * as self from "../commands/pipeline.js";

export async function planCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  const dotFile = resolveBundledTemplate("plan");
  return self.pipelineRunCommand(dotFile, { project: absPath });
}
