import { existsSync } from "fs";
import { resolve } from "path";
import { pipelineRunCommand } from "./pipeline.js";
import * as output from "../lib/output.js";

export async function implementCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  await pipelineRunCommand("implement", { project: absPath });
}
