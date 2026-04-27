#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = process.cwd();
const illumDir = path.join(projectRoot, "meditations", "illuminations");
const archivedDir = path.join(projectRoot, "meditations", "archived-illuminations");
const implementedDir = path.join(projectRoot, "meditations", "implemented-illuminations");

// Precondition: clean tree
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("Working tree must be clean. git status --porcelain output:");
  console.error(dirty);
  process.exit(1);
}

if (!fs.existsSync(illumDir)) {
  console.error(`No source dir at ${illumDir}; nothing to migrate.`);
  process.exit(0);
}

fs.mkdirSync(archivedDir, { recursive: true });
fs.mkdirSync(implementedDir, { recursive: true });

const files = fs.readdirSync(illumDir).filter((f) => f.endsWith(".md"));
let moved = { open: 0, dispatched: 0, implemented: 0, archived: 0, superseded: 0, other: 0 };

for (const filename of files) {
  const srcPath = path.join(illumDir, filename);
  const raw = fs.readFileSync(srcPath, "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    // No frontmatter at all (rare — e.g. a hand-written review note). MCP `listIlluminations`
    // already treats this as `open`. Leave in place and count under `open`.
    moved.open++;
    continue;
  }
  const fmBlock = fmMatch[1];
  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  // Frontmatter present but no status line → treat as open (matches MCP behavior at illumination-server.ts:343).
  const status = statusMatch ? statusMatch[1].trim() : "open";

  if (status === "open" || status === "dispatched") {
    moved[status]++;
    continue;
  }

  if (status === "implemented") {
    execFileSync("git", ["mv", srcPath, path.join(implementedDir, filename)]);
    moved.implemented++;
    continue;
  }

  if (status === "archived") {
    execFileSync("git", ["mv", srcPath, path.join(archivedDir, filename)]);
    moved.archived++;
    continue;
  }

  if (status === "superseded") {
    // Re-stamp: status -> archived, copy superseded_by into archive_reason.
    const supersededByMatch = fmBlock.match(/^superseded_by:\s*(.+)$/m);
    const supersededBy = supersededByMatch ? supersededByMatch[1].trim() : "(unknown)";
    let newFm = fmBlock
      .replace(/^status:\s*.+$/m, "status: archived")
      .replace(/^superseded_by:.*\n?/m, "")
      .replace(/^superseded_at:.*\n?/m, "");
    const today = new Date().toISOString().slice(0, 10);
    newFm += `\narchived_at: ${today}\narchive_reason: superseded by ${supersededBy}`;
    const body = raw.slice(fmMatch[0].length);
    const updated = `---\n${newFm}\n---\n${body}`;
    fs.writeFileSync(srcPath, updated);
    // git mv stages the rename and picks up the on-disk content modification atomically.
    execFileSync("git", ["mv", srcPath, path.join(archivedDir, filename)]);
    moved.superseded++;
    continue;
  }

  console.error(`UNKNOWN status "${status}" in ${filename}; aborting.`);
  process.exit(1);
}

console.log("Migration summary:");
for (const [k, v] of Object.entries(moved)) console.log(`  ${k}: ${v}`);
console.log("\nReview with: git status && git diff --stat");
console.log("Commit with: git commit -m 'chore(meditations): split illuminations directory by status (backfill)'");
