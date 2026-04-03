import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const BRAINSTORM_TRIGGER = `\
Study specs/*.md and src/* in parallel using subagents to understand the project. \
Then invoke the Skill tool with skill name "superpowers:brainstorming".`;

export async function planCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  console.log(`Starting brainstorm session in ${absPath}...`);
  console.log(`Brainstorming in progress — this may take a moment...\n`);

  // Phase 1: kick off brainstorming non-interactively, stream output to user
  const sessionId = await runBrainstormKickoff(absPath);

  // Phase 2: resume the same session interactively
  console.log("\n\nBrainstorm complete. Opening interactive session...\n");

  const resumeArgs = [
    "--dangerously-skip-permissions",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const result = spawnSync("claude", resumeArgs, {
    cwd: absPath,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

async function runBrainstormKickoff(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let sessionId: string | null = null;
    let buffer = "";

    const child = spawn(
      "claude",
      ["-p", BRAINSTORM_TRIGGER, "--output-format", "stream-json", "--dangerously-skip-permissions"],
      { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.session_id && !sessionId) sessionId = msg.session_id;
          if (msg.type === "assistant") {
            for (const block of msg.message?.content ?? []) {
              if (block.type === "text") process.stdout.write(block.text);
              else if (block.type === "tool_use")
                process.stdout.write(`\n→ [tool] ${block.name}\n`);
            }
          }
        } catch {}
      }
    });

    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("close", () => resolve(sessionId));
  });
}
