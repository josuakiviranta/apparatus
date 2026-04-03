import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve, basename } from "path";
import { spawnSync, spawn } from "child_process";
import { getMeditationPromptPath } from "../lib/assets";

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

export function buildCronLine(projectFolder: string, every: number): string {
  const logPath = join(projectFolder, ".meditate.log");
  return `${buildCronExpression(every)} /bin/bash -c 'ralph meditate ${projectFolder} &>> ${logPath}'`;
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
  return JSON.parse(readFileSync(p, "utf8")) as MeditationSentinel;
}

export function writeSentinel(projectFolder: string, sentinel: MeditationSentinel): void {
  writeFileSync(join(projectFolder, ".meditate.json"), JSON.stringify(sentinel, null, 2) + "\n");
}

export function removeSentinel(projectFolder: string): void {
  const p = join(projectFolder, ".meditate.json");
  if (existsSync(p)) unlinkSync(p);
}

export function ensureMeditationDirs(projectFolder: string): void {
  mkdirSync(join(projectFolder, "meditations", "illuminations"), { recursive: true });
}

export function appendMeditateGitignore(projectFolder: string): void {
  const entries = [".meditate.json", ".meditate.log"];
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

// ─── Session runner ───────────────────────────────────────────────────────────

async function runMeditationSession(absPath: string): Promise<void> {
  const illuminationsPath = resolve(join(absPath, "meditations", "illuminations"));
  const prompt = readFileSync(getMeditationPromptPath(), "utf8");

  const border = "\u2501".repeat(40);
  console.log(border);
  console.log(`Mode:    meditate`);
  console.log(`Project: ${absPath}`);
  console.log(`PID:     ${process.pid} (kill ${process.pid} to stop)`);
  console.log(border);
  console.log();

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read",
    "--allowedTools", `Write(${illuminationsPath}/**)`,
    "--add-dir", absPath,
    "-p", prompt,
  ];

  const child = spawn("claude", args, {
    cwd: absPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

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
            } else if (block.type === "thinking") {
              process.stdout.write(block.thinking);
            } else if (block.type === "tool_use" && block.name === "Read") {
              process.stdout.write(`\n\u2192 [tool] Read: ${block.input?.file_path}\n`);
            } else if (block.type === "tool_use") {
              process.stdout.write(`\n\u2192 [tool] ${block.name}\n`);
            }
          }
        }
      } catch {}
    }
  });

  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  await new Promise<void>((res) => child.on("close", res));
}

// ─── Command entry points ─────────────────────────────────────────────────────

export async function meditateStop(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  const sentinel = readSentinel(absPath);
  if (!sentinel) {
    console.log("No active meditation schedule found.");
    return;
  }
  removeCronEntry(sentinel.cronId);
  removeSentinel(absPath);
  console.log(`Meditation schedule stopped for ${absPath}`);
}

export async function meditateStatus(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  const sentinel = readSentinel(absPath);
  if (!sentinel) {
    console.log("No active meditation schedule.");
    return;
  }
  console.log(`Project:  ${absPath}`);
  console.log(`Interval: every ${sentinel.every} minutes`);
  console.log(`Until:    ${sentinel.until ?? "no end time set"}`);
  console.log(`Cron ID:  ${sentinel.cronId}`);
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
