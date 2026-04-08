import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getMeditateCreatePromptPath } from "../lib/assets";
import * as output from "../lib/output.js";
import { streamEvents } from "../lib/stream-formatter.js";

function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}

export function buildMeditateCreateKickoffArgs(promptText: string): string[] {
  return ["-p", promptText, "--output-format", "stream-json", "--dangerously-skip-permissions"];
}

export async function meditateCreateCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
    return;
  }
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
    return;
  }

  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: absPath, encoding: "utf8" });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "meditate", project: absPath, branch, pid: process.pid });

  const promptPath = getMeditateCreatePromptPath();
  const promptText = readFileSync(promptPath, "utf8");
  const args = buildMeditateCreateKickoffArgs(promptText);

  let sessionId: string | null = null;

  const child = spawn("claude", args, {
    cwd: absPath,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const exitPromise = new Promise<void>(res => child.on("close", () => res()));

  await output.stream(
    streamEvents(child.stdout as NodeJS.ReadableStream, {
      onSessionId: id => { sessionId = id; },
    })
  );
  await exitPromise;

  if (sessionId) {
    await output.info(`trace: ${buildTracePath(absPath, sessionId)}`);
  }
  await output.step("━━━ Launching interactive session ━━━");

  const resumeArgs = ["--dangerously-skip-permissions", ...(sessionId ? ["--resume", sessionId] : [])];
  const result = spawnSync("claude", resumeArgs, { cwd: absPath, stdio: "inherit", env: process.env });
  process.exit(result.status ?? 0);
}
