import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { spawnSync, spawn } from "child_process";
import { getKickoffPromptPath, getPromptPath } from "../lib/assets";

const BRAINSTORM_TRIGGER = `\
Study specs/*.md and src/* in parallel using subagents to understand the project. \
Then invoke the Skill tool with skill name "superpowers:brainstorming".`;

export async function newCommand(projectName: string): Promise<void> {
  const targetPath = resolve(process.cwd(), projectName);

  if (existsSync(targetPath)) {
    console.error(`Error: directory already exists: ${targetPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  console.log(`Creating project: ${projectName}`);
  scaffoldProject(targetPath, projectName);

  console.log("Initializing git repository...");
  const gitResult = spawnSync("git", ["init", "-b", "main"], {
    cwd: targetPath,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (gitResult.status !== 0) {
    console.error("Error: git init failed");
    process.exit(1);
  }

  console.log("\nStarting project kickoff session...\n");
  const sessionId = await runKickoffSession(targetPath, projectName);

  console.log("\n\nKickoff complete. Opening interactive session...\n");
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

async function runKickoffSession(cwd: string, projectName: string): Promise<string | null> {
  const promptTemplate = readFileSync(getKickoffPromptPath(), "utf8");
  const prompt = buildKickoffPrompt(promptTemplate, projectName);

  return new Promise((resolve) => {
    let sessionId: string | null = null;
    let buffer = "";

    const child = spawn(
      "claude",
      ["-p", prompt, "--output-format", "stream-json", "--dangerously-skip-permissions"],
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
