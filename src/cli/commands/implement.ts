import { existsSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";
import { bootstrapPrompts } from "../lib/prompts.js";
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";
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

  // Bootstrap: inject default prompts if missing
  const bootstrap = await bootstrapPrompts(absPath);
  if (bootstrap.needsSetup) {
    await output.info(`\nInjected default prompts into ${absPath}:`);
    bootstrap.injected.forEach((f) => console.log(`  + ${f}`));
    console.log(`  + Added entries to .gitignore`);
    console.log(
      "\nReview and customize these prompts, then re-run your command.\n"
    );
    process.exit(0);
  }

  const config = resolveAgent("implement");
  if (options.model) config.model = options.model;

  const agent = new Agent(config);
  const ac = new AbortController();

  const onSignal = () => {
    ac.abort();
    agent.kill();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  // Capture branch for git push
  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd: absPath,
    encoding: "utf8",
  });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "implement", project: absPath, branch, pid: process.pid });

  let iteration = 0;

  try {
    while (true) {
      if (ac.signal.aborted) {
        await output.warn("Aborted.");
        break;
      }

      if (options.max && iteration >= options.max) {
        await output.info(`Reached max iterations: ${options.max}`);
        break;
      }

      const result = await agent.run({
        cwd: absPath,
        signal: ac.signal,
      });

      if (ac.signal.aborted) break;

      if (result.exitCode !== 0) {
        await output.warn(`Claude exited with code ${result.exitCode}`);
      }

      // Git push (with retry, matching prior loop.ts behavior)
      const push = spawnSync("git", ["push", "origin", branch], {
        cwd: absPath,
        encoding: "utf8",
      });
      if (push.status !== 0) {
        const retry = spawnSync("git", ["push", "-u", "origin", branch], {
          cwd: absPath,
          encoding: "utf8",
        });
        if (retry.status !== 0) {
          await output.warn(`git push failed: ${retry.stderr ?? "unknown error"}`);
        }
      }

      iteration++;
      await output.step(`LOOP ${iteration}`);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  process.exit(0);
}
