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
