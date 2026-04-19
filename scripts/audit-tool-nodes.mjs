#!/usr/bin/env node
// scripts/audit-tool-nodes.mjs
// Walk pipelines/**/*.dot, list tool nodes + their tool_command or script_file.
// Suggests cwd value based on prefix patterns. Dev-only, not shipped.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function findDotFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findDotFiles(full));
    } else if (entry.endsWith(".dot")) {
      results.push(full);
    }
  }
  return results;
}

const files = findDotFiles("pipelines");
for (const file of files) {
  const src = readFileSync(file, "utf8");
  // crude regex — matches tool-type nodes
  const re = /^\s*(\w+)\s*\[[^\]]*type\s*=\s*"tool"[^\]]*\]/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const nodeId = m[1];
    const lineNum = src.slice(0, m.index).split("\n").length;
    const hasCwd = /cwd\s*=/.test(m[0]);
    const hasCdProject = /cd\s+\$project\s*&&/.test(m[0]);
    const hasTmux = /tmux new-window\s+-c\s+"?\$project"?/.test(m[0]);
    const suggestion = hasCdProject || hasTmux ? '$project' :
                       hasCwd ? '(already set)' : '<manual review>';
    console.log(`${file}:${lineNum} ${nodeId} suggest cwd="${suggestion}"`);
  }
}
