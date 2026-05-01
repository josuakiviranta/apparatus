import { existsSync } from "fs";
import { resolve } from "path";
import { pipelineRunCommand } from "./pipeline.js";
import * as output from "../lib/output.js";

export interface ImplementOptions {
  max?: number;
  model?: string;
  scenarios?: string;
}

export async function implementCommand(
  projectFolder: string,
  options: ImplementOptions
): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  if (options.scenarios && !process.env.TMUX) {
    await output.error(
      "Error: --scenarios requires running inside a tmux session. Start tmux first, then re-run.",
    );
    process.exit(1);
  }

  await pipelineRunCommand("implement", {
    project: absPath,
    variables: {
      scenarios_dir: options.scenarios ?? "",
      max_iterations: String(options.max ?? 0),
      ...(options.model ? { llm_model: options.model } : {}),
    },
  });
}
