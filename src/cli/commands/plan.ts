import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import * as output from "../lib/output.js";
import { streamEvents } from "../lib/stream-formatter.js";

const BRAINSTORM_TRIGGER = `\
Study specs/*.md and src/* in parallel using subagents to understand the project. \
Then invoke the Skill tool with skill name "superpowers:brainstorming".`;

function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}

export async function planCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: absPath, encoding: "utf8" });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "plan", project: absPath, branch, pid: process.pid });

  let sessionId: string | null = null;

  const child = spawn(
    "claude",
    ["-p", BRAINSTORM_TRIGGER, "--output-format", "stream-json", "--dangerously-skip-permissions"],
    { cwd: absPath, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );

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
