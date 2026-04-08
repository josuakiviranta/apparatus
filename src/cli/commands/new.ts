import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { spawnSync, spawn } from "child_process";
import { getKickoffPromptPath, getPromptPath } from "../lib/assets";
import * as output from "../lib/output.js";
import { streamEvents } from "../lib/stream-formatter.js";

const BRAINSTORM_TRIGGER = `\
Study specs/*.md and src/* in parallel using subagents to understand the project. \
Then invoke the Skill tool with skill name "superpowers:brainstorming".`;

function buildTracePath(projectPath: string, sessionId: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return `${process.env.HOME ?? "~"}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}

export async function newCommand(projectName: string): Promise<void> {
  const targetPath = resolve(process.cwd(), projectName);

  if (existsSync(targetPath)) {
    await output.error(`Error: directory already exists: ${targetPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  await output.step(`Creating project: ${projectName}`);
  scaffoldProject(targetPath, projectName);

  await output.step("Initializing git repository...");
  const gitResult = spawnSync("git", ["init", "-b", "main"], {
    cwd: targetPath,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (gitResult.status !== 0) {
    await output.error("Error: git init failed");
    process.exit(1);
  }

  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: targetPath, encoding: "utf8" });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "new", project: targetPath, branch, pid: process.pid });

  const promptTemplate = readFileSync(getKickoffPromptPath(), "utf8");
  const prompt = buildKickoffPrompt(promptTemplate, projectName);

  let sessionId: string | null = null;

  const child = spawn(
    "claude",
    ["-p", prompt, "--output-format", "stream-json", "--dangerously-skip-permissions"],
    { cwd: targetPath, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );

  const exitPromise = new Promise<void>(res => child.on("close", () => res()));

  await output.stream(
    streamEvents(child.stdout as NodeJS.ReadableStream, {
      onSessionId: id => { sessionId = id; },
    })
  );
  await exitPromise;

  if (sessionId) {
    await output.info(`trace: ${buildTracePath(targetPath, sessionId)}`);
  }
  await output.step("━━━ Launching interactive session ━━━");

  const resumeArgs = [
    "--dangerously-skip-permissions",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const result = spawnSync("claude", resumeArgs, {
    cwd: targetPath,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

export function scaffoldProject(targetPath: string, _projectName: string): void {
  mkdirSync(targetPath, { recursive: true });
  mkdirSync(join(targetPath, "specs"), { recursive: true });
  mkdirSync(join(targetPath, "src"), { recursive: true });
  mkdirSync(join(targetPath, "scenario-tests"), { recursive: true });
  mkdirSync(join(targetPath, "scenario-runs"), { recursive: true });

  const emptyFiles = ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "README.md"];
  for (const f of emptyFiles) {
    writeFileSync(join(targetPath, f), "");
  }

  copyFileSync(getPromptPath("plan"), join(targetPath, "PROMPT_plan.md"));
  copyFileSync(getPromptPath("build"), join(targetPath, "PROMPT_build.md"));

  writeFileSync(
    join(targetPath, ".gitignore"),
    [
      "PROMPT_plan.md",
      "PROMPT_build.md",
      "IMPLEMENTATION_PLAN.md",
      "scenario-runs/",
    ].join("\n") + "\n"
  );
}

export function buildKickoffPrompt(template: string, projectName: string): string {
  const substituted = template.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
  return `${substituted}\n\n${BRAINSTORM_TRIGGER}`;
}
