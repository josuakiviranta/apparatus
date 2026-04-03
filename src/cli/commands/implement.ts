import { spawnSync, spawn } from "child_process";
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

  const child = spawn(loopSh, args, {
    cwd: absPath,
    stdio: "inherit",
    env: process.env,
    detached: true, // own process group — so we can kill only ralph's subtree
  });

  if (!child.pid) {
    console.error("Failed to launch loop.sh");
    process.exit(1);
  }

  console.log(`Starting implementation loop in ${absPath}...`);
  if (options.max !== undefined) {
    console.log(`Max iterations: ${options.max}`);
  }
  console.log(`PID: ${child.pid}  (Ctrl+C or: kill ${child.pid})`);
  console.log();

  const killGroup = () => {
    try { process.kill(-child.pid!, "SIGTERM"); } catch {}
  };

  process.on("SIGINT", killGroup);
  process.on("SIGTERM", killGroup);

  await new Promise<void>((resolve) => child.on("exit", resolve));
  process.exit(0);
}
