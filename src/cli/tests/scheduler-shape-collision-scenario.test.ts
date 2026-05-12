import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(
  __dirname,
  "../../../.apparat/scenarios/scheduler-shape-collision",
);
const FIXTURE_PLAN = resolve(SCENARIO_DIR, "chunked-plan.md");
const SCENARIO_DOT = resolve(SCENARIO_DIR, "pipeline.dot");

// Mirror of the regex from
// .apparat/pipelines/parallel-illumination-to-implementation/plan-scheduler.md:30
const FILES_RE = /^\s*-\s+(?:Create|Modify|Test):\s+`([^`]+)`/gm;
const CHUNK_RE = /^##\s+Chunk\s+(\d+):\s+(.+)$/gm;

type Chunk = { id: string; files: Set<string> };

function parseChunks(plan: string): Chunk[] {
  const headings: Array<{ idx: number; n: number }> = [];
  let m: RegExpExecArray | null;
  CHUNK_RE.lastIndex = 0;
  while ((m = CHUNK_RE.exec(plan)) !== null) {
    headings.push({ idx: m.index, n: Number(m[1]) });
  }
  const out: Chunk[] = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].idx;
    const end = i + 1 < headings.length ? headings[i + 1].idx : plan.length;
    const body = plan.slice(start, end);
    const files = new Set<string>();
    let fm: RegExpExecArray | null;
    const re = new RegExp(FILES_RE.source, "gm");
    while ((fm = re.exec(body)) !== null) {
      files.add(fm[1]);
    }
    out.push({ id: `c${headings[i].n}`, files });
  }
  return out;
}

function dependsOn(chunks: Chunk[]): Record<string, string[]> {
  const deps: Record<string, string[]> = {};
  for (let i = 0; i < chunks.length; i++) {
    const b = chunks[i];
    const acc: string[] = [];
    for (let j = 0; j < i; j++) {
      const a = chunks[j];
      let overlaps = false;
      for (const f of a.files) {
        if (b.files.has(f)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) acc.push(a.id);
    }
    deps[b.id] = acc;
  }
  return deps;
}

describe("scenario: scheduler-shape-collision", () => {
  it("fixture chunked-plan.md exists and contains the propagation line", () => {
    expect(existsSync(FIXTURE_PLAN)).toBe(true);
    const text = readFileSync(FIXTURE_PLAN, "utf8");
    expect(text).toMatch(
      /plan_writer\.under_declared_shape_consumer_suspected:\s+c2\s+->\s+src\/lib\/shared-thing\.ts/,
    );
  });

  it("scenario pipeline.dot exists and freezes the contract shape", () => {
    expect(existsSync(SCENARIO_DOT)).toBe(true);
    const dot = readFileSync(SCENARIO_DOT, "utf8");
    expect(dot).toMatch(/digraph\s+"scheduler-shape-collision"/);
    expect(dot).toMatch(/goal=/);
  });

  it("literal-overlap algorithm emits c2.depends_on === ['c1'] over the fixture plan", () => {
    const plan = readFileSync(FIXTURE_PLAN, "utf8");
    const chunks = parseChunks(plan);
    expect(chunks.map((c) => c.id)).toEqual(["c1", "c2"]);

    // c1 modifies the shared symbol's defining file.
    expect(chunks[0].files.has("src/lib/shared-thing.ts")).toBe(true);
    // c2 is the consumer; its Modify: declaration now lists the same path
    // because plan_writer's propagation step fired.
    expect(chunks[1].files.has("src/lib/shared-thing.ts")).toBe(true);

    const deps = dependsOn(chunks);
    expect(deps).toEqual({ c1: [], c2: ["c1"] });
  });

  it("removing the propagated Modify: entry yields c2.depends_on === [] (negative control)", () => {
    const plan = readFileSync(FIXTURE_PLAN, "utf8");
    // Strip ONLY the propagated line — c2's own Create/Test lines remain.
    const stripped = plan.replace(
      /^- Modify: `src\/lib\/shared-thing\.ts`\s*\n/gm,
      (match, offset, full) => {
        // Keep c1's Modify of shared-thing.ts; drop c2's.
        const c2HeadingIdx = full.indexOf("## Chunk 2:");
        return offset > c2HeadingIdx ? "" : match;
      },
    );
    const chunks = parseChunks(stripped);
    expect(chunks[1].files.has("src/lib/shared-thing.ts")).toBe(false);
    const deps = dependsOn(chunks);
    expect(deps.c2).toEqual([]);
  });
});
