import { spawnSync } from "child_process";
import { existsSync, chmodSync } from "fs";
import { resolve } from "path";
import { bootstrapPrompts } from "../lib/prompts";
import { getLoopShPath } from "../lib/assets";

export interface ImplementOptions {
  max?: number;
}

export async function implementCommand(
  projectFolder: string,
  options: ImplementOptions
): Promise<void> {
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

  const loopSh = getLoopShPath();
  if (!existsSync(loopSh)) {
    console.error(`Error: loop.sh not found at ${loopSh}`);
    process.exit(1);
  }

  // Ensure loop.sh is executable
  chmodSync(loopSh, 0o755);

  const promptFile = resolve(absPath, "PROMPT_build.md");
  const args: string[] = [promptFile];
  if (options.max !== undefined) {
    args.push(String(options.max));
  }

  console.log(`Starting implementation loop in ${absPath}...`);
  if (options.max !== undefined) {
    console.log(`Max iterations: ${options.max}`);
  }
  console.log();

  const result = spawnSync(loopSh, args, {
    cwd: absPath,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error("Failed to launch loop.sh:", result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
