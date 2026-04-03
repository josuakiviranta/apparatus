import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { bootstrapPrompts } from "../lib/prompts";

export async function planCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  // Bootstrap: inject default prompts if missing
  const bootstrap = await bootstrapPrompts(absPath);
  if (bootstrap.needsSetup) {
    console.log(`\nInjected default prompts into ${absPath}:`);
    bootstrap.injected.forEach((f) => console.log(`  + ${f}`));
    console.log(`  + Added entries to .gitignore`);
    console.log(
      "\nReview and customize these prompts, then re-run your command.\n"
    );
    process.exit(0);
  }

  // Check that claude is available
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  // Read the plan prompt to inject as system prompt
  const promptContent = readFileSync(
    join(absPath, "PROMPT_plan.md"),
    "utf8"
  );

  console.log(`Starting planning session in ${absPath}...\n`);

  const result = spawnSync(
    "claude",
    ["--append-system-prompt", promptContent],
    {
      cwd: absPath,
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.error) {
    console.error("Failed to launch claude:", result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
