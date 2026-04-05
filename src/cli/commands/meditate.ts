import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { spawnSync, spawn } from "child_process";
import { getMeditationPromptPath, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";

// ─── PID lock utilities ───────────────────────────────────────────────────────

export function pidPath(projectFolder: string): string {
  return join(projectFolder, ".meditate.pid");
}

export function writePid(projectFolder: string, pid: number): void {
  writeFileSync(pidPath(projectFolder), String(pid));
}

export function readPid(projectFolder: string): number | null {
  const p = pidPath(projectFolder);
  if (!existsSync(p)) return null;
  const n = parseInt(readFileSync(p, "utf8").trim(), 10);
  return isNaN(n) ? null : n;
}

export function removePid(projectFolder: string): void {
  const p = pidPath(projectFolder);
  if (existsSync(p)) unlinkSync(p);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function ensureMeditationDirs(projectFolder: string): void {
  mkdirSync(join(projectFolder, "meditations", "illuminations"), { recursive: true });
}

export function appendMeditateGitignore(projectFolder: string): void {
  const entries = [".meditate.json", ".meditate.log", ".meditate.pid", ".mcp.ralph-*.json"];
  const gitignorePath = join(projectFolder, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split("\n");
  const toAdd = entries.filter((e) => !lines.includes(e));
  if (toAdd.length === 0) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, existing + sep + toAdd.join("\n") + "\n");
}

// ─── MCP config management ────────────────────────────────────────────────────

function isDevMode(): boolean {
  return typeof __RALPH_PROD__ === "undefined";
}

export function writeMcpConfig(projectRoot: string): string {
  const configPath = join(projectRoot, `.mcp.ralph-${process.pid}.json`);
  const serverPath = getIlluminationServerPath();
  const command = isDevMode() ? "tsx" : "node";
  const config = {
    mcpServers: {
      illumination: {
        type: "stdio",
        command,
        args: [serverPath, projectRoot, getMetaMeditationsDir()],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}

export function cleanupMcpConfig(configPath: string): void {
  rmSync(configPath, { force: true });
}

// ─── Session runner ───────────────────────────────────────────────────────────

export function buildMeditationArgs(
  absPath: string,
  promptText: string,
  mcpConfigPath: string
): string[] {
  return [
    "--print",
    "--output-format", "stream-json",
    "--permission-mode", "dontAsk",
    "--allowedTools", "mcp__illumination__read_file",
    "--allowedTools", "mcp__illumination__glob_files",
    "--allowedTools", "mcp__illumination__project_tree",
    "--allowedTools", "mcp__illumination__write_illumination",
    "--allowedTools", "mcp__illumination__list_meta_meditations",
    "--allowedTools", "mcp__illumination__read_meta_meditation",
    "--mcp-config", mcpConfigPath,
    "--add-dir", absPath,
    "-p", promptText,
  ];
}

async function runMeditationSession(absPath: string): Promise<void> {
  writePid(absPath, process.pid);

  const prompt = readFileSync(getMeditationPromptPath(), "utf8");
  const mcpConfigPath = writeMcpConfig(absPath);

  const border = "\u2501".repeat(40);
  console.log(border);
  console.log(`Mode:    meditate`);
  console.log(`Project: ${absPath}`);
  console.log(`PID:     ${process.pid} (ralph meditate kill <folder> to stop)`);
  console.log(border);
  console.log();

  const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);

  const child = spawn("claude", args, {
    cwd: absPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const cleanup = () => {
    child.kill("SIGTERM");
    removePid(absPath);
    cleanupMcpConfig(mcpConfigPath);
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "assistant") {
          for (const block of (msg.message?.content ?? [])) {
            if (block.type === "text") {
              process.stdout.write(block.text);
            }
          }
        }
      } catch {}
    }
  });

  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  await new Promise<void>((res) => child.on("close", () => {
    try { cleanupMcpConfig(mcpConfigPath); } catch {}
    res();
  }));

  process.off("SIGTERM", cleanup);
  process.off("SIGINT", cleanup);
  removePid(absPath);
}

// ─── Command entry point ──────────────────────────────────────────────────────

export async function meditateCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }
  const runningPid = readPid(absPath);
  if (runningPid !== null && isPidAlive(runningPid)) {
    console.log(`Meditation session already running (PID ${runningPid}). Skipping.`);
    process.exit(0);
  }
  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);
  await runMeditationSession(absPath);
}
