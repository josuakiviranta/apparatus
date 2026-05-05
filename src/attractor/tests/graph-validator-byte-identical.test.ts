import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

/**
 * Byte-equivalence oracle for Chunk 1 of the parser/validator extract.
 *
 * Iterates every .dot fixture available in the repo and snapshots the
 * full Diagnostic[] output of `validateGraph(parseDot(src), dotDir)`.
 *
 * Snapshots are recorded BEFORE the move (test importing from graph.js)
 * and re-asserted AFTER the move (import switched to graph-validator.js).
 * If the snapshot diff is empty, the move is byte-identical.
 */
function findDotFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".dot")) out.push(full);
    }
  }
  walk(root);
  return out.sort();
}

const REPO_ROOTS = [
  "src/attractor/tests/fixtures",
  "src/cli/pipelines",
];

const dotFiles: string[] = [];
for (const root of REPO_ROOTS) {
  dotFiles.push(...findDotFiles(root));
}

describe("graph-validator byte-identical (Chunk 1 oracle)", () => {
  if (dotFiles.length === 0) {
    it.skip("no .dot fixtures discovered — skipping snapshot oracle", () => {});
    return;
  }

  for (const dotPath of dotFiles) {
    it(`pins diagnostics for ${dotPath}`, () => {
      const src = readFileSync(dotPath, "utf8");
      const graph = parseDot(src);
      const diags = validateGraph(graph, dirname(dotPath));
      // Strip absolute paths in messages so snapshots stay stable across machines.
      const cwd = process.cwd();
      const normalized = diags.map(d => ({
        ...d,
        message: d.message.split(cwd).join("<CWD>"),
      }));
      expect(normalized).toMatchSnapshot();
    });
  }
});
