import { existsSync, rmSync } from "fs";
import { join } from "path";
import React from "react";
import { render } from "ink";
import { listEntries, formatSize, type Entry } from "../lib/sweep-fs.js";
import { SweepSelector } from "../components/SweepSelector.js";

export interface SweepOptions {
  dryRun?: boolean;
}

export async function sweepCommand(
  projectFolder: string,
  opts: SweepOptions,
): Promise<void> {
  const apparatDir = join(projectFolder, ".apparat");
  if (!existsSync(apparatDir)) {
    process.stderr.write(`apparat sweep: no .apparat/ found at ${projectFolder}\n`);
    process.exit(1);
    return;
  }

  const entries = listEntries(apparatDir);
  printList(projectFolder, entries);

  if (opts.dryRun) {
    process.exit(0);
    return;
  }

  // Non-TTY policy mirrored from src/cli/commands/pipeline/show.ts:99.
  // The Ink mount requires a TTY; without one we surface the list (already
  // printed above), write a one-line hint, and exit 0 — read-only.
  if (!process.stdout.isTTY) {
    process.stderr.write(
      "apparat sweep: interactive selection requires a TTY; pass --dry-run for non-interactive listing.\n",
    );
    process.exit(0);
    return;
  }

  await new Promise<void>((resolve) => {
    const app = render(
      React.createElement(SweepSelector, {
        entries,
        onSubmit: (selected: Entry[]) => {
          for (const e of selected) {
            rmSync(join(apparatDir, e.relPath), { recursive: true, force: true });
          }
          const totalBytes = selected.reduce((a, e) => a + e.size, 0);
          app.unmount();
          process.stdout.write(
            `Removed ${selected.length} entries totalling ${formatSize(totalBytes)}.\n`,
          );
          resolve();
        },
        onCancel: () => {
          app.unmount();
          process.stdout.write("Cancelled — no entries removed.\n");
          resolve();
        },
      }),
    );
  });

  process.exit(0);
}

function printList(projectFolder: string, entries: Entry[]): void {
  const totalBytes = entries.reduce((a, e) => a + e.size, 0);
  process.stdout.write(
    `.apparat/ contents at ${projectFolder}/.apparat (total ${formatSize(totalBytes)})\n\n`,
  );
  const widthRel = Math.max(20, ...entries.map((e) => e.relPath.length)) + 2;
  for (const e of entries) {
    const sel = e.tag === "scratch" ? "[x]" : "[ ]";
    const rel = e.relPath.padEnd(widthRel, " ");
    const size = formatSize(e.size).padStart(8, " ");
    process.stdout.write(`  ${sel} ${rel} ${size}  [${e.tag}]\n`);
  }
  process.stdout.write("\n");
}
