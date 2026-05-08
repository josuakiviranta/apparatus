import { resolve, join, sep } from "path";
import { existsSync, readdirSync, lstatSync } from "fs";
import { resolveBundledPipeline, getBundledPipelinesDir } from "./assets.js";
import { pipelinesDir } from "./apparat-paths.js";

const VALID_NAME = /^[a-zA-Z0-9_-]+$/;

export function isNameShorthand(arg: string): boolean {
  if (arg.includes(sep) || arg.includes("/")) return false;
  if (arg.endsWith(".dot")) return false;
  return true;
}

export function getPipelinesDir(project: string): string {
  return pipelinesDir(resolve(project));
}

export function resolvePipelineArg(arg: string, project: string): string {
  if (!isNameShorthand(arg)) {
    return resolve(arg);
  }
  if (!VALID_NAME.test(arg)) {
    throw new Error(
      `Invalid pipeline name "${arg}": only letters, numbers, hyphens, and underscores are allowed`
    );
  }

  // 1. Project-local — folder-form (Decision 1: per-pipeline folder = SSoT)
  const projectFolderPath = join(getPipelinesDir(project), arg, "pipeline.dot");
  if (existsSync(projectFolderPath)) return projectFolderPath;

  // 2. Project-local — flat-form (user-authored pipelines may still use flat layout)
  const projectPath = join(getPipelinesDir(project), `${arg}.dot`);
  if (existsSync(projectPath)) return projectPath;

  // 3. Bundled
  return resolveBundledPipeline(arg);
}

// ─── Discovery seam shared by `pipeline list` and the parity test ────────
//
// Walk order MUST mirror resolvePipelineArg above: local-folder, then
// local-flat, then bundled. The parity test in pipeline-list-resolver-parity
// fails the suite if the two surfaces drift.

export type PipelineOrigin = "local-folder" | "local-flat" | "bundled";

export interface PipelineEntry {
  name: string;
  origin: PipelineOrigin;
  absPath: string;
  hasFork?: boolean;          // bundled entries: a local copy shadows this name
  shadowedBundled?: boolean;  // local entries: a bundled name is being shadowed
}

function isDir(p: string): boolean {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
}

function isFile(p: string): boolean {
  try { return lstatSync(p).isFile(); } catch { return false; }
}

function walkLocal(project: string): PipelineEntry[] {
  const dir = getPipelinesDir(project);
  if (!existsSync(dir)) return [];

  const folderEntries: PipelineEntry[] = [];
  const flatEntries: PipelineEntry[] = [];
  const folderNames = new Set<string>();

  let children: string[];
  try { children = readdirSync(dir); } catch { return []; }

  // First pass: folder-form (preferred over flat, mirroring resolvePipelineArg)
  for (const child of children) {
    if (!VALID_NAME.test(child)) continue;
    const childPath = join(dir, child);
    if (!isDir(childPath)) continue;
    const dot = join(childPath, "pipeline.dot");
    if (!isFile(dot)) continue;
    folderEntries.push({ name: child, origin: "local-folder", absPath: dot });
    folderNames.add(child);
  }

  // Second pass: flat-form, suppressed when a folder of the same name exists
  for (const child of children) {
    if (!child.endsWith(".dot")) continue;
    const stem = child.slice(0, -".dot".length);
    if (!VALID_NAME.test(stem)) continue;
    if (folderNames.has(stem)) continue;
    const filePath = join(dir, child);
    if (!isFile(filePath)) continue;
    flatEntries.push({ name: stem, origin: "local-flat", absPath: filePath });
  }

  return [...folderEntries, ...flatEntries];
}

function walkBundled(): PipelineEntry[] {
  const dir = getBundledPipelinesDir();
  if (!existsSync(dir)) return [];

  const entries: PipelineEntry[] = [];
  let children: string[];
  try { children = readdirSync(dir); } catch { return []; }
  for (const child of children) {
    if (!VALID_NAME.test(child)) continue;
    const childPath = join(dir, child);
    if (!isDir(childPath)) continue;
    const dot = join(childPath, "pipeline.dot");
    if (!isFile(dot)) continue;
    entries.push({ name: child, origin: "bundled", absPath: dot });
  }
  return entries;
}

export function listAllPipelines(project: string): PipelineEntry[] {
  const local = walkLocal(resolve(project));
  const bundled = walkBundled();

  const localNames = new Set(local.map(e => e.name));
  for (const b of bundled) {
    if (localNames.has(b.name)) b.hasFork = true;
  }
  const bundledNames = new Set(bundled.map(e => e.name));
  for (const l of local) {
    if (bundledNames.has(l.name)) l.shadowedBundled = true;
  }

  local.sort((a, b) => a.name.localeCompare(b.name));
  bundled.sort((a, b) => a.name.localeCompare(b.name));

  return [...local, ...bundled];
}
