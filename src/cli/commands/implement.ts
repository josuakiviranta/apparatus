import { existsSync } from "fs";
import { resolve } from "path";
import { bootstrapPrompts } from "../lib/prompts.js";
import { pipelineRunCommand } from "./pipeline.js";
import * as output from "../lib/output.js";

export interface ImplementOptions {
  max?: number;
  model?: string;
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

  const bootstrap = await bootstrapPrompts(absPath);
  if (bootstrap.needsSetup) {
    await output.info(`\nInjected default prompts into ${absPath}:`);
    bootstrap.injected.forEach((f) => console.log(`  + ${f}`));
    console.log(`  + Added entries to .gitignore`);
    console.log("\nReview and customize these prompts, then re-run your command.\n");
    process.exit(0);
  }

  await pipelineRunCommand("implement", {
    project: absPath,
    variables: {
      max_iterations: String(options.max ?? 0),  // 0 = unlimited
      ...(options.model ? { llm_model: options.model } : {}),
    },
  });
}
