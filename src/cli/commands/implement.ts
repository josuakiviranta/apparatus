import { existsSync } from "fs";
import { resolve } from "path";
import { bootstrapPrompts } from "../lib/prompts";
import { runLoop } from "../lib/loop.js";

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

  const promptFile = resolve(absPath, "PROMPT_build.md");

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await runLoop({ promptFile, cwd: absPath, max: options.max, signal: ac.signal });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  process.exit(0);
}
