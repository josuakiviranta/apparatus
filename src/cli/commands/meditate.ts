import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "fs";
import { join, resolve, basename } from "path";
import { spawnSync, spawn } from "child_process";
import { getMeditationPromptPath, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeditationSentinel {
  every: number;
  until?: string;
  cronId: string;
}

export interface MeditateOptions {
  every?: number;
  until?: string;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

export function cronId(projectFolder: string): string {
  return `ralph-meditate-${basename(projectFolder)}`;
}

export function buildCronExpression(every: number): string {
  return `*/${every} * * * *`;
}

export function isCleanInterval(every: number): boolean {
  return [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60].includes(every);
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function buildCronLine(projectFolder: string, every: number): string {
  const logPath = join(projectFolder, ".meditate.log");
  return `${buildCronExpression(every)} /bin/bash -c 'ralph meditate ${shellEscape(projectFolder)} &>> ${shellEscape(logPath)}'`;
}

export function insertCronEntry(crontab: string, cronLine: string, anchor: string): string {
  if (crontab.includes(anchor)) return crontab;
  const sep = crontab.length > 0 && !crontab.endsWith("\n") ? "\n" : "";
  return crontab + sep + cronLine + "\n" + anchor + "\n";
}

export function deleteCronEntry(crontab: string, anchor: string): string {
  const lines = crontab.split("\n");
  const anchorIdx = lines.findIndex((l) => l === anchor);
  if (anchorIdx === -1) return crontab;
  const removeFrom = anchorIdx > 0 ? anchorIdx - 1 : anchorIdx;
  const count = anchorIdx > 0 ? 2 : 1;
  lines.splice(removeFrom, count);
  return lines.join("\n");
}

// ─── Filesystem utilities ────────────────────────────────────────────────────

export function readSentinel(projectFolder: string): MeditationSentinel | null {
  const p = join(projectFolder, ".meditate.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as MeditationSentinel;
  } catch {
    console.error(`Warning: corrupt .meditate.json in ${projectFolder}, ignoring`);
    return null;
  }
}

export function writeSentinel(projectFolder: string, sentinel: MeditationSentinel): void {
  writeFileSync(join(projectFolder, ".meditate.json"), JSON.stringify(sentinel, null, 2) + "\n");
}

export function removeSentinel(projectFolder: string): void {
  const p = join(projectFolder, ".meditate.json");
  if (existsSync(p)) unlinkSync(p);
}

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

// ─── Cron management ─────────────────────────────────────────────────────────

function readCurrentCrontab(): string {
  const result = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  // exit code 1 with no crontab is normal on some systems
  return result.status === 0 ? result.stdout : "";
}

function writeCurrentCrontab(content: string): void {
  spawnSync("crontab", ["-"], { input: content, encoding: "utf8" });
}

function addCronEntry(projectFolder: string, every: number, id: string): void {
  const anchor = `# ${id}`;
  const cronLine = buildCronLine(projectFolder, every);
  const updated = insertCronEntry(readCurrentCrontab(), cronLine, anchor);
  writeCurrentCrontab(updated);
}

function removeCronEntry(id: string): void {
  const anchor = `# ${id}`;
  const updated = deleteCronEntry(readCurrentCrontab(), anchor);
  writeCurrentCrontab(updated);
}

// ─── MCP config management ────────────────────────────────────────────────────

function isDevMode(): boolean {
  return basename(__dirname) !== "dist";
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

// ─── Command entry points ─────────────────────────────────────────────────────

export async function meditateStop(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);

  // 1. Remove cron entry and sentinel
  const sentinel = readSentinel(absPath);
  if (sentinel) {
    removeCronEntry(sentinel.cronId);
    removeSentinel(absPath);
  }

  // 2. Send SIGTERM to running session if alive
  const pid = readPid(absPath);
  if (pid !== null && isPidAlive(pid)) {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to meditation session (PID ${pid}).`);
  }

  // 3. Remove PID file regardless
  if (pid !== null) {
    removePid(absPath);
  }

  // 4. Clean up orphaned MCP config files
  const { readdirSync } = await import("fs");
  try {
    const files = readdirSync(absPath);
    for (const f of files) {
      if (/^\.mcp\.ralph-\d+\.json$/.test(f)) {
        cleanupMcpConfig(join(absPath, f));
      }
    }
  } catch {
    // folder may not exist or be readable — ignore
  }

  if (sentinel || pid !== null) {
    console.log("Meditation stopped.");
  } else {
    console.log("No active meditation schedule or session found.");
  }
}

export async function meditateStatus(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  const sentinel = readSentinel(absPath);
  const pid = readPid(absPath);
  const sessionRunning = pid !== null && isPidAlive(pid);

  if (!sentinel && !sessionRunning) {
    console.log("No active meditation schedule or session.");
    return;
  }

  if (sentinel) {
    console.log(`Project:  ${absPath}`);
    console.log(`Interval: every ${sentinel.every} minutes`);
    console.log(`Until:    ${sentinel.until ?? "no end time set"}`);
    console.log(`Cron ID:  ${sentinel.cronId}`);
  }

  if (sessionRunning) {
    if (!sentinel) {
      console.log(`Project:  ${absPath}`);
      console.log(`Session:  running (PID ${pid}) — manual one-shot, no cron schedule`);
    } else {
      console.log(`Session:  running (PID ${pid})`);
    }
  } else {
    console.log(`Session:  idle`);
  }
}

export async function meditateCommand(
  projectFolder: string,
  options: MeditateOptions
): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  // Check for claude CLI
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // Check end-time expiry for scheduled runs
  const sentinel = readSentinel(absPath);
  if (sentinel?.until) {
    const until = new Date(sentinel.until).getTime();
    if (Date.now() >= until) {
      console.log("Meditation schedule has expired. Removing schedule.");
      removeCronEntry(sentinel.cronId);
      removeSentinel(absPath);
      process.exit(0);
    }
  }

  // Prevent concurrent sessions: skip if a ralph meditate process is already running
  const runningPid = readPid(absPath);
  if (runningPid !== null && isPidAlive(runningPid)) {
    console.log(`Meditation session already running (PID ${runningPid}). Skipping.`);
    process.exit(0);
  }

  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);

  if (options.every !== undefined) {
    if (!isCleanInterval(options.every)) {
      console.warn(
        `Warning: ${options.every} min does not divide 60 evenly. ` +
        `Cron resets hourly — prefer: 1, 2, 5, 10, 15, 20, 30, or 60.`
      );
    }
    const id = cronId(absPath);
    writeSentinel(absPath, {
      every: options.every,
      ...(options.until ? { until: options.until } : {}),
      cronId: id,
    });
    addCronEntry(absPath, options.every, id);
    console.log(`Scheduled: every ${options.every} min${options.until ? `, until ${options.until}` : ""}`);
  }

  await runMeditationSession(absPath);
}
