import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getMeditateCreatePromptPath } from "../lib/assets";

export function buildMeditateCreateKickoffArgs(promptText: string): string[] {
  return ["-p", promptText, "--output-format", "stream-json", "--dangerously-skip-permissions"];
}

export async function meditateCreateCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
    return;
  }
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
    return;
  }
  const promptPath = getMeditateCreatePromptPath();
  const promptText = readFileSync(promptPath, "utf8");

  console.log(`Starting meditation session in ${absPath}...`);
  console.log(`Reading your meditations — this may take a moment...\n`);
  const sessionId = await runMeditateCreateKickoff(absPath, promptText);
  console.log("\n\nReady. Opening interactive session...\n");
  const resumeArgs = ["--dangerously-skip-permissions", ...(sessionId ? ["--resume", sessionId] : [])];
  const result = spawnSync("claude", resumeArgs, { cwd: absPath, stdio: "inherit", env: process.env });
  process.exit(result.status ?? 0);
}

async function runMeditateCreateKickoff(cwd: string, promptText: string): Promise<string | null> {
  return new Promise((resolve) => {
    let sessionId: string | null = null;
    let buffer = "";
    const args = buildMeditateCreateKickoffArgs(promptText);
    const child = spawn("claude", args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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
              else if (block.type === "tool_use") process.stdout.write(`\n→ [tool] ${block.name}\n`);
            }
          }
        } catch {}
      }
    });
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("close", () => resolve(sessionId));
  });
}
