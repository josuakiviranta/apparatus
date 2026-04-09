import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";
import { streamEvents } from "../lib/stream-formatter.js";
import * as output from "../lib/output.js";

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

  const config = resolveAgent("plan");
  const agent = new Agent(config);

  // Phase 1: non-interactive kickoff
  let sessionId: string | null = null;
  await agent.run({
    cwd: absPath,
    onStdout: async (stdout) => {
      await output.stream(streamEvents(stdout, {
        onSessionId: (id) => { sessionId = id; },
      }));
    },
  });

  if (sessionId) {
    await output.info(`trace: ${buildTracePath(absPath, sessionId)}`);
  }
  await output.step("━━━ Launching interactive session ━━━");

  // Phase 2: interactive resume
  const resumeResult = await agent.run({
    cwd: absPath,
    resume: sessionId ?? undefined,
    interactive: true,
  });

  process.exit(resumeResult.exitCode);
}
