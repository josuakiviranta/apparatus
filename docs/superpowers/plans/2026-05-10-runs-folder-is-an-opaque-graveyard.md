# Deepen `pipeline list` into a Zoom-In Surface Over `.apparat/runs/` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three-piece change set from `docs/superpowers/specs/2026-05-10-runs-folder-is-an-opaque-graveyard-design.md` — slug-prefixed runIds, per-pipeline GC, and a `pipeline list <name>` Layer-2 recent-runs table — so `<project>/.apparat/runs/` becomes a self-describing, zoom-in surface.

**Architecture:** Introduce one new pure I/O library (`src/cli/lib/runs-index.ts`) that parses each run dir's `pipeline.jsonl` once and produces `RunSummary` rows; consume it from both the GC (per-pipeline bucketing with a stricter crash-at-start bucket) and the Layer-2 list rendering (one verb, two zoom levels). Compose runIds as `<pipeline-slug>-<uuid8>` while keeping the no-arg `newRunId()` shape and bare-id directories fully back-compat through `pipeline trace` and `--resume`.

**Tech Stack:** TypeScript, Node.js (`fs`, `path`, `crypto`), vitest, Commander.js, Ink (untouched here). No new runtime dependencies. No `.dot`-schema, tracer-schema, IPC, or Ink change.

---

## Source-of-truth references

- Design doc: `docs/superpowers/specs/2026-05-10-runs-folder-is-an-opaque-graveyard-design.md`
- Originating illumination: `.apparat/meditations/illuminations/2026-05-07T2312-runs-folder-is-an-opaque-graveyard.md`
- Anchors verified at plan-write time:
  - `src/cli/lib/apparat-paths.ts:42-44` — `newRunId()` truncates UUID to 8 chars, no slug
  - `src/cli/commands/pipeline/runs-gc.ts:52-67` — `gcOldRuns(runsRoot, keep)` flat-by-mtime
  - `src/cli/commands/pipeline/runs-gc.ts:12-45` — `resolveResumeLogsRoot` (preserved unchanged)
  - `src/cli/commands/pipeline/run.ts:30,129-133` — imports + call sites for `newRunId` + `gcOldRuns`
  - `src/cli/commands/pipeline/list.ts:13-33` — Layer-1 body to preserve verbatim
  - `src/cli/commands/pipeline/list.ts:11` — `NAME_COL = 34` (out of scope to change)
  - `src/cli/commands/pipeline/trace.ts:11` — `tracePath = join(runDir(project, runId), "pipeline.jsonl")` (back-compat works for both shapes via path.join)
  - `src/cli/program.ts:173-186` — `pipeline list` commander registration
  - `src/cli/commands/pipeline.ts:19` — barrel re-export `gcOldRuns, resolveResumeLogsRoot` from `./pipeline/runs-gc.js`
  - `src/cli/tests/pipeline-runs-gc.test.ts:5` — test imports `gcOldRuns` from `../commands/pipeline.js` (the barrel)
  - `src/cli/tests/apparat-paths.test.ts:54-65` — runId regex `/^[0-9a-f]{8}$/`
  - `src/cli/tests/pipeline.test.ts:179-181` — logsRoot regex `/\.apparat[\\\/]runs[\\\/][0-9a-f]{8}$/`
  - `src/attractor/tracer/jsonl-pipeline-tracer.ts:12-24,51-58` — `pipeline-start` (carries `pipelineName`+`timestamp`) and `pipeline-end` (`outcome`+`timestamp`) — fields used unchanged
  - `src/daemon/runner.ts:55` — daemon-side `newRunId()` no-arg call site (back-compat path stays)
  - `src/cli/skills/apparatus/pipelines.md:17,489` — workflow + retention docs
  - `README.md:97,102` — list + trace one-liners

> **Heads-up on stale references in the design doc.** §3.5 of the design says “`graph.name` is in scope by `:129`” of `run.ts`. The plan-author verified at write time that `loaded.graph` is bound at `:56` and stays in scope through `:129`, so `loaded.graph.name` is the correct expression. Treat the design doc as authoritative for *intent*; ground exact symbols against the live source you read at execution time.

---

## File map (planned)

| Bucket | File | Treatment |
|---|---|---|
| New lib | `src/cli/lib/runs-index.ts` | **New** — `RunSummary`, `listAllRuns`, `listRunsForPipeline` |
| Path module | `src/cli/lib/apparat-paths.ts` | Edit — `newRunId(pipelineName?)` + `slugify` helper |
| GC | `src/cli/commands/pipeline/runs-gc.ts` | Edit — delete `gcOldRuns`, add `gcOldRunsPerPipeline`; preserve `resolveResumeLogsRoot` byte-for-byte |
| Barrel | `src/cli/commands/pipeline.ts` | Edit — drop `gcOldRuns` re-export, add `gcOldRunsPerPipeline` re-export |
| Run command | `src/cli/commands/pipeline/run.ts` | Edit — `newRunId(loaded.graph.name)`, switch GC import + call to per-pipeline |
| List command | `src/cli/commands/pipeline/list.ts` | Edit — accept optional `name`; render runs table when supplied |
| Commander wiring | `src/cli/program.ts` | Edit — `.command("list [name]")`, help text, `.action((name, opts) => …)` |
| New tests | `src/cli/tests/runs-index.test.ts` | **New** — JSONL-fixture parsing |
| New tests | `src/cli/tests/runs-gc-per-pipeline.test.ts` | **New** — per-pipeline + crash bucket retention |
| New tests | `src/cli/tests/apparat-paths-slug-format.test.ts` | **New** — slug rule edge cases |
| New tests | `src/cli/tests/pipeline-trace-runid-compat.test.ts` | **New** — both shapes via `pipeline trace` |
| New tests | `src/cli/tests/pipeline-list-layer2.test.ts` | **New** — Layer-2 table rendering |
| Edited tests | `src/cli/tests/apparat-paths.test.ts` | Edit — slug regex + back-compat assertions |
| Edited tests | `src/cli/tests/pipeline-runs-gc.test.ts` | Rewrite — against `gcOldRunsPerPipeline` |
| Edited tests | `src/cli/tests/pipeline.test.ts` | Edit — logsRoot regex accepts slug prefix |
| Edited tests | `src/cli/tests/pipeline-run-runid.test.ts` | Edit — exercise both shapes |
| Existing tests | `src/cli/tests/pipeline-trace-command-validation.test.ts` | Verify-no-change — uses literal runIds, not regex |
| Doc — README | `README.md` | Edit `:97,:102` |
| Doc — skill | `src/cli/skills/apparatus/pipelines.md` | Edit `:17,:484-509` |

> **Daemon untouched this cycle.** `src/daemon/runner.ts:55` keeps `newRunId()` (no arg) — back-compat shape returns the bare 8-char id. Slug-side waits for `2026-05-09-two-run-homes-no-cross-project-view-design.md` (currently `Status: draft`). Layer-2 reader tolerates both dir-name shapes today (it parses `pipelineName` from JSONL, not the dir name).

---

## Chunk 1: `runs-index.ts` foundation (TDD, no behaviour change)

Adds the parser everything else consumes. Lands first because GC (Chunk 3) and Layer-2 list (Chunk 4) both import from it. No caller wired yet, so this chunk ships a green-field library + its own test file with zero impact on any other surface.

### Task 1.1: `RunSummary` type + `listAllRuns` happy-path test

**Files:**
- Create: `src/cli/tests/runs-index.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/runs-index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listAllRuns, listRunsForPipeline, type RunSummary } from "../lib/runs-index.js";

function writeRun(
  root: string,
  runId: string,
  events: Array<Record<string, unknown>>,
): string {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  if (events.length > 0) {
    writeFileSync(
      join(dir, "pipeline.jsonl"),
      events.map(e => JSON.stringify(e)).join("\n") + "\n",
    );
  }
  return dir;
}

describe("listAllRuns", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "apparat-runs-idx-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("parses pipeline-start + pipeline-end into a success RunSummary", () => {
    writeRun(root, "meditate-aaaaaaaa", [
      { kind: "pipeline-start", runId: "meditate-aaaaaaaa", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:30:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-aaaaaaaa", outcome: "success", timestamp: "2026-05-09T19:30:12.400Z" },
    ]);
    const runs = listAllRuns(root);
    expect(runs).toHaveLength(1);
    const r: RunSummary = runs[0];
    expect(r.runId).toBe("meditate-aaaaaaaa");
    expect(r.pipelineName).toBe("meditate");
    expect(r.startedAt).toBe("2026-05-09T19:30:00.000Z");
    expect(r.outcome).toBe("success");
    expect(r.durationMs).toBe(12400);
    expect(r.failedNodeId).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/runs-index.test.ts`
Expected: FAIL with module-resolution error: `Failed to resolve import "../lib/runs-index.js"` (the lib does not exist yet).

- [x] **Step 3: Write minimal implementation**

Create `src/cli/lib/runs-index.ts`:

```ts
import { existsSync, readdirSync, readFileSync, lstatSync } from "fs";
import { join } from "path";

export interface RunSummary {
  runId: string;
  pipelineName: string | null;
  startedAt: string | null;
  outcome: "success" | "failure" | "in-progress" | "crashed";
  durationMs: number | null;
  failedNodeId: string | null;
}

interface ParsedEvents {
  start: { pipelineName?: string; timestamp?: string } | null;
  end: { outcome?: string; timestamp?: string } | null;
  lastFailedNodeId: string | null;
}

function parseJsonl(tracePath: string): ParsedEvents {
  let text: string;
  try { text = readFileSync(tracePath, "utf8"); }
  catch { return { start: null, end: null, lastFailedNodeId: null }; }
  let start: ParsedEvents["start"] = null;
  let end: ParsedEvents["end"] = null;
  let lastFailedNodeId: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line) as Record<string, unknown>; }
    catch { continue; }
    if (ev.kind === "pipeline-start" && start === null) {
      start = {
        pipelineName: typeof ev.pipelineName === "string" ? ev.pipelineName : undefined,
        timestamp: typeof ev.timestamp === "string" ? ev.timestamp : undefined,
      };
    } else if (ev.kind === "pipeline-end") {
      end = {
        outcome: typeof ev.outcome === "string" ? ev.outcome : undefined,
        timestamp: typeof ev.timestamp === "string" ? ev.timestamp : undefined,
      };
    } else if (ev.kind === "node-end" && ev.success === false && typeof ev.nodeId === "string") {
      lastFailedNodeId = ev.nodeId;
    }
  }
  return { start, end, lastFailedNodeId };
}

function summarize(runId: string, runDir: string): RunSummary {
  const tracePath = join(runDir, "pipeline.jsonl");
  if (!existsSync(tracePath)) {
    return { runId, pipelineName: null, startedAt: null, outcome: "crashed", durationMs: null, failedNodeId: null };
  }
  const { start, end, lastFailedNodeId } = parseJsonl(tracePath);
  if (!start) {
    return { runId, pipelineName: null, startedAt: null, outcome: "crashed", durationMs: null, failedNodeId: null };
  }
  const startedAt = start.timestamp ?? null;
  const pipelineName = start.pipelineName ?? null;
  if (!end) {
    return { runId, pipelineName, startedAt, outcome: "in-progress", durationMs: null, failedNodeId: null };
  }
  const outcome: RunSummary["outcome"] = end.outcome === "failure" ? "failure" : "success";
  const durationMs = startedAt && end.timestamp
    ? Math.max(0, Date.parse(end.timestamp) - Date.parse(startedAt))
    : null;
  return {
    runId,
    pipelineName,
    startedAt,
    outcome,
    durationMs,
    failedNodeId: outcome === "failure" ? lastFailedNodeId : null,
  };
}

export function listAllRuns(runsRoot: string): RunSummary[] {
  if (!existsSync(runsRoot)) return [];
  const out: RunSummary[] = [];
  for (const name of readdirSync(runsRoot)) {
    const dir = join(runsRoot, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
    } catch { continue; }
    out.push(summarize(name, dir));
  }
  // Newest first by startedAt; nulls (crashed-at-start) sort last.
  out.sort((a, b) => {
    if (a.startedAt === b.startedAt) return 0;
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });
  return out;
}

export function listRunsForPipeline(runsRoot: string, pipelineName: string): RunSummary[] {
  return listAllRuns(runsRoot).filter(r => r.pipelineName === pipelineName);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/runs-index.test.ts`
Expected: PASS, 1 test.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/runs-index.ts src/cli/tests/runs-index.test.ts
git commit -m "feat(runs-index): scaffold listAllRuns parser with success-summary test"
```

### Task 1.2: Crash, in-progress, and failure-with-failedNodeId cases

**Files:**
- Modify: `src/cli/tests/runs-index.test.ts`
- (Implementation already covers these — these tests pin behaviour.)

- [x] **Step 1: Append failing tests**

Add to the existing `describe("listAllRuns", …)` block in `src/cli/tests/runs-index.test.ts`:

```ts
  it("classifies a dir with no pipeline.jsonl as crashed (pipelineName null)", () => {
    mkdirSync(join(root, "crashed-1"), { recursive: true });
    const runs = listAllRuns(root);
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("crashed");
    expect(runs[0].pipelineName).toBeNull();
    expect(runs[0].startedAt).toBeNull();
  });

  it("classifies pipeline-start without pipeline-end as in-progress", () => {
    writeRun(root, "meditate-bbbbbbbb", [
      { kind: "pipeline-start", runId: "meditate-bbbbbbbb", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:30:00.000Z" },
      { kind: "node-start", nodeReceiveId: "n-1", nodeId: "n", nodeKind: "agent", timestamp: "T1", contextSnapshot: {} },
    ]);
    const runs = listAllRuns(root);
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("in-progress");
    expect(runs[0].durationMs).toBeNull();
    expect(runs[0].failedNodeId).toBeNull();
  });

  it("populates failedNodeId from the last failed node-end on a failure run", () => {
    writeRun(root, "meditate-cccccccc", [
      { kind: "pipeline-start", runId: "meditate-cccccccc", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "node-end", nodeReceiveId: "ok-1", nodeId: "ok-node", success: true, contextUpdates: {} },
      { kind: "node-end", nodeReceiveId: "bad-1", nodeId: "classifier", success: false, contextUpdates: {} },
      { kind: "pipeline-end", runId: "meditate-cccccccc", outcome: "failure", timestamp: "2026-05-09T19:00:04.100Z" },
    ]);
    const runs = listAllRuns(root);
    expect(runs[0].outcome).toBe("failure");
    expect(runs[0].failedNodeId).toBe("classifier");
    expect(runs[0].durationMs).toBe(4100);
  });

  it("sorts newest-first by startedAt and pushes crashed entries to the end", () => {
    writeRun(root, "meditate-1", [
      { kind: "pipeline-start", runId: "meditate-1", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T18:00:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-1", outcome: "success", timestamp: "2026-05-09T18:00:01.000Z" },
    ]);
    writeRun(root, "meditate-2", [
      { kind: "pipeline-start", runId: "meditate-2", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-2", outcome: "success", timestamp: "2026-05-09T19:00:01.000Z" },
    ]);
    mkdirSync(join(root, "crashed-1"), { recursive: true });
    const ids = listAllRuns(root).map(r => r.runId);
    expect(ids).toEqual(["meditate-2", "meditate-1", "crashed-1"]);
  });

  it("ignores non-directory entries", () => {
    writeFileSync(join(root, "stray.txt"), "x");
    expect(listAllRuns(root)).toEqual([]);
  });

  it("returns [] when runsRoot does not exist", () => {
    expect(listAllRuns(join(root, "missing"))).toEqual([]);
  });
});

describe("listRunsForPipeline", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "apparat-runs-idx-filter-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("filters to runs whose JSONL pipelineName matches", () => {
    writeRun(root, "meditate-1", [
      { kind: "pipeline-start", runId: "meditate-1", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-1", outcome: "success", timestamp: "2026-05-09T19:00:01.000Z" },
    ]);
    writeRun(root, "janitor-1", [
      { kind: "pipeline-start", runId: "janitor-1", pipelineName: "janitor", goal: "g", nodes: [], timestamp: "2026-05-09T19:30:00.000Z" },
      { kind: "pipeline-end", runId: "janitor-1", outcome: "success", timestamp: "2026-05-09T19:30:01.000Z" },
    ]);
    expect(listRunsForPipeline(root, "meditate").map(r => r.runId)).toEqual(["meditate-1"]);
    expect(listRunsForPipeline(root, "janitor").map(r => r.runId)).toEqual(["janitor-1"]);
    expect(listRunsForPipeline(root, "unknown")).toEqual([]);
  });

  it("matches old bare-id directories whose JSONL still carries pipelineName", () => {
    writeRun(root, "deadbeef", [
      { kind: "pipeline-start", runId: "deadbeef", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "pipeline-end", runId: "deadbeef", outcome: "success", timestamp: "2026-05-09T19:00:01.000Z" },
    ]);
    expect(listRunsForPipeline(root, "meditate").map(r => r.runId)).toEqual(["deadbeef"]);
  });
});
```

- [x] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/runs-index.test.ts`
Expected: PASS — all tests in the file (one happy-path from Task 1.1 plus six new `listAllRuns` cases plus two `listRunsForPipeline` cases).

- [x] **Step 3: Commit**

```bash
git add src/cli/tests/runs-index.test.ts
git commit -m "test(runs-index): pin crash/in-progress/failure/sort/filter cases"
```

### Verification targets

- Smokes: None (Chunk 1 ships a green-field lib with no caller; the project has no `pipelines/smoke/*.dot` directory at plan-write time).
- Manual exercises: None (no CLI surface change yet).
- Lint: `npx vitest run src/cli/tests/runs-index.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: `src/cli/lib/` (new lib only).

---

## Chunk 2: Slug-prefixed runId with back-compat

Widens `newRunId(pipelineName?)` to return `<slug>-<uuid8>` when given a name; keeps no-arg behaviour byte-identical for the daemon (which still calls `newRunId()` until the two-run-homes spec ships). Wires the interactive `pipeline run` call site to pass `loaded.graph.name`. Updates the two existing tests whose regex locks on the bare-id shape and adds a slug-edge-case test file plus a runId-back-compat test through `pipeline trace`.

### Task 2.1: `slugify` + slug-aware `newRunId` (TDD)

**Files:**
- Create: `src/cli/tests/apparat-paths-slug-format.test.ts`
- Modify: `src/cli/lib/apparat-paths.ts`

- [x] **Step 1: Write the failing test**

Create `src/cli/tests/apparat-paths-slug-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { newRunId } from "../lib/apparat-paths.js";

describe("newRunId(pipelineName) slug shape", () => {
  it("returns <slug>-<uuid8> when given a simple name", () => {
    expect(newRunId("meditate")).toMatch(/^meditate-[0-9a-f]{8}$/);
  });

  it("preserves hyphens in compound names", () => {
    expect(newRunId("illumination-to-implementation"))
      .toMatch(/^illumination-to-implementation-[0-9a-f]{8}$/);
  });

  it("lower-cases and collapses runs of non-alphanumeric chars to a single dash", () => {
    expect(newRunId("My Pipeline!")).toMatch(/^my-pipeline-[0-9a-f]{8}$/);
    expect(newRunId("Foo___Bar  Baz")).toMatch(/^foo-bar-baz-[0-9a-f]{8}$/);
  });

  it("trims leading/trailing dashes from slug", () => {
    expect(newRunId("--weird--")).toMatch(/^weird-[0-9a-f]{8}$/);
  });

  it("caps slug length at 40 chars before the dash+uuid8", () => {
    const long = "a".repeat(80);
    const id = newRunId(long);
    const slug = id.slice(0, id.length - 9); // strip "-<8hex>"
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(id).toMatch(/^a{1,40}-[0-9a-f]{8}$/);
  });

  it("falls back to bare uuid8 when slug would be empty (e.g. only special chars)", () => {
    expect(newRunId("!!!")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns a different id on each call (collision-resistant)", () => {
    expect(newRunId("x")).not.toBe(newRunId("x"));
  });
});

describe("newRunId() — no-arg back-compat", () => {
  it("returns the bare 8-char hex shape (daemon-side path)", () => {
    expect(newRunId()).toMatch(/^[0-9a-f]{8}$/);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/apparat-paths-slug-format.test.ts`
Expected: FAIL — `newRunId` currently takes no args; the slug-shape assertions fail with `expected "5836ed5f" to match /^meditate-[0-9a-f]{8}$/`.

- [x] **Step 3: Implement slug-aware `newRunId`**

Edit `src/cli/lib/apparat-paths.ts`. Replace the existing `newRunId` block (`:37-44`) with:

```ts
function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Canonical runId shape used by interactive runs (src/cli/commands/pipeline/run.ts)
 * and the daemon (src/daemon/runner.ts).
 *
 *   newRunId("meditate") → "meditate-<8hex>"   ← slug-prefixed (preferred)
 *   newRunId()           → "<8hex>"            ← bare back-compat (daemon path)
 *
 * Slug rule: lower-case, runs of non-alphanumeric chars collapse to "-",
 * leading/trailing dashes trimmed, capped at 40 chars. Empty slug (e.g. all
 * special chars) falls back to the bare uuid8 shape.
 */
export function newRunId(pipelineName?: string): string {
  const uuid8 = randomUUID().slice(0, 8);
  if (!pipelineName) return uuid8;
  const slug = slugify(pipelineName);
  if (slug.length === 0) return uuid8;
  return `${slug}-${uuid8}`;
}
```

- [x] **Step 4: Run slug-format test to verify it passes**

Run: `npx vitest run src/cli/tests/apparat-paths-slug-format.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/apparat-paths.ts src/cli/tests/apparat-paths-slug-format.test.ts
git commit -m "feat(apparat-paths): newRunId(pipelineName?) returns slug-prefixed runId"
```

### Task 2.2: Update existing `apparat-paths.test.ts` to cover both shapes

**Files:**
- Modify: `src/cli/tests/apparat-paths.test.ts`

- [x] **Step 1: Replace the `describe("newRunId", …)` block (`:54-65`)**

Edit `src/cli/tests/apparat-paths.test.ts`. Replace lines 54-65 with:

```ts
describe("newRunId", () => {
  it("returns an 8-char hex slice when no pipelineName provided (back-compat)", () => {
    const id = newRunId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns <slug>-<uuid8> when pipelineName provided", () => {
    expect(newRunId("meditate")).toMatch(/^meditate-[0-9a-f]{8}$/);
  });

  it("returns a different id on each call (collision-resistant for solo dev tooling)", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
  });
});
```

- [x] **Step 2: Run the file to verify it passes**

Run: `npx vitest run src/cli/tests/apparat-paths.test.ts`
Expected: PASS, all 11 tests (8 existing path-helper tests + 3 newRunId).

- [x] **Step 3: Commit**

```bash
git add src/cli/tests/apparat-paths.test.ts
git commit -m "test(apparat-paths): cover slug + bare runId shapes"
```

### Task 2.3: Wire interactive `pipeline run` to pass `graph.name`

**Files:**
- Modify: `src/cli/commands/pipeline/run.ts`
- Modify: `src/cli/tests/pipeline.test.ts`
- Modify: `src/cli/tests/pipeline-run-runid.test.ts`

- [x] **Step 1: Update the `pipeline.test.ts` regex first (TDD)**

Edit `src/cli/tests/pipeline.test.ts:179-181`. Replace:

```ts
    expect(opts.logsRoot).toMatch(
      new RegExp(`\\.apparat[\\\\/]runs[\\\\/][0-9a-f]{8}$`),
    );
```

with:

```ts
    // After slug-prefixing, runId is `<pipeline-slug>-<uuid8>`. The dot test fixture
    // is parsed as `digraph my_pipeline { … }` (the legacy underscored slug); the
    // slugify rule lower-cases and collapses non-alphanumerics, yielding `my-pipeline`.
    expect(opts.logsRoot).toMatch(
      new RegExp(`\\.apparat[\\\\/]runs[\\\\/][a-z0-9-]+-[0-9a-f]{8}$`),
    );
```

(The neighbouring `expect(opts.logsRoot).not.toMatch(/\d{4}-\d{2}-\d{2}T/);` line stays.)

- [x] **Step 2: Run the test to confirm it fails as expected (still bare-id)**

Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "places logsRoot under <project>/.apparat/runs/<runId> when none provided"`
Expected: FAIL — current `newRunId()` is still called without an arg from `run.ts`, so logsRoot is bare-8-char and does not match `[a-z0-9-]+-[0-9a-f]{8}$`.

- [x] **Step 3: Wire `loaded.graph.name` into `newRunId` in `run.ts`**

Edit `src/cli/commands/pipeline/run.ts:129`. Replace:

```ts
  const runId = opts.runId ?? newRunId();
```

with:

```ts
  const runId = opts.runId ?? newRunId(loaded.graph.name);
```

(`loaded.graph` is bound at `:56` and stays in scope. Verified by reading the file.)

- [x] **Step 4: Run the failing test to verify green**

Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "places logsRoot under <project>/.apparat/runs/<runId> when none provided"`
Expected: PASS.

- [x] **Step 5: Verify the rest of `pipeline.test.ts` still passes**

Run: `npx vitest run src/cli/tests/pipeline.test.ts`
Expected: PASS for the full file. If any other regex anywhere in the file locks on `[0-9a-f]{8}$`, update it analogously and note the change in the commit message.

- [x] **Step 6: Update `pipeline-run-runid.test.ts` to add a slug-shape assertion**

Edit `src/cli/tests/pipeline-run-runid.test.ts`. Add `readdirSync` to the existing `import` from `"fs"` at the top of the file (currently `import { mkdtempSync, writeFileSync, existsSync } from "fs";` — make it `import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "fs";`). Then append a new test inside the file (after line 52, before the file ends):

```ts
describe("pipelineRunCommand allocates a slug-prefixed runId by default", () => {
  it("creates <project>/.apparat/runs/<pipeline-slug>-<8hex>/pipeline.jsonl", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-slug-runid-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph janitor { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project });
    } catch {} finally { exitSpy.mockRestore(); }

    const runsRoot = join(project, ".apparat", "runs");
    const dirs = readdirSync(runsRoot);
    expect(dirs.length).toBe(1);
    expect(dirs[0]).toMatch(/^janitor-[0-9a-f]{8}$/);
    rmSync(project, { recursive: true, force: true });
  });
});
```

(The existing `--run-id deadbeef` override test still passes because the override path still wins via `opts.runId ??`.)

- [x] **Step 7: Run the file to confirm both blocks pass**

Run: `npx vitest run src/cli/tests/pipeline-run-runid.test.ts`
Expected: PASS — both the project-registry test, the `--run-id` override test, and the new slug-shape test.

- [x] **Step 8: Confirm `pipeline-trace-command-validation.test.ts` is unaffected**

Run: `npx vitest run src/cli/tests/pipeline-trace-command-validation.test.ts`
Expected: PASS unchanged. The file uses literal runIds (`r1`, `r2`, `r3`) and never asserts a regex; no edit required. Verified at plan-write time by reading the file.

- [x] **Step 9: Commit**

```bash
git add src/cli/commands/pipeline/run.ts src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-run-runid.test.ts
git commit -m "feat(pipeline-run): slug-prefixed runId via newRunId(graph.name)"
```

### Task 2.4: Pin back-compat — `pipeline trace` accepts both shapes

**Files:**
- Create: `src/cli/tests/pipeline-trace-runid-compat.test.ts`

`pipeline trace` already works with both shapes because `runDir(project, runId)` is `path.join` (verified at `src/cli/commands/pipeline/trace.ts:11`). This test pins that contract so a future refactor can't silently break bare-id back-compat.

- [ ] **Step 1: Write the regression-pin test**

Create `src/cli/tests/pipeline-trace-runid-compat.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { runDir } from "../lib/apparat-paths.js";

describe("pipeline trace accepts both runId shapes", () => {
  const logs: string[] = [];
  const origLog = console.log;
  beforeEach(() => { logs.length = 0; });
  beforeAll(() => { console.log = (...a: unknown[]) => logs.push(a.map(String).join(" ")); });
  afterAll(() => { console.log = origLog; });

  function seedTrace(projectRoot: string, runId: string): void {
    const traceDir = runDir(projectRoot, runId);
    mkdirSync(traceDir, { recursive: true });
    const lines = [
      { kind: "pipeline-start", runId, pipelineName: "meditate", goal: "g", nodes: ["start","done"], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "node-start", nodeReceiveId: "done-1", nodeId: "done", nodeKind: "marker", timestamp: "2026-05-09T19:00:01.000Z", contextSnapshot: {} },
      { kind: "node-end", nodeReceiveId: "done-1", nodeId: "done", success: true, contextUpdates: {} },
      { kind: "pipeline-end", runId, outcome: "success", timestamp: "2026-05-09T19:00:02.000Z" },
    ];
    writeFileSync(join(traceDir, "pipeline.jsonl"), lines.map(l => JSON.stringify(l)).join("\n"));
  }

  it("renders a slug-prefixed runId", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-trace-compat-"));
    seedTrace(project, "meditate-aaaaaaaa");
    await pipelineTraceCommand("meditate-aaaaaaaa", { project });
    const out = logs.join("\n");
    expect(out).toMatch(/run:\s+meditate-aaaaaaaa/);
    expect(out).toMatch(/outcome: success/);
  });

  it("renders a bare 8-char runId (back-compat for old run dirs)", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-trace-compat-"));
    seedTrace(project, "deadbeef");
    await pipelineTraceCommand("deadbeef", { project });
    const out = logs.join("\n");
    expect(out).toMatch(/run:\s+deadbeef/);
    expect(out).toMatch(/outcome: success/);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/cli/tests/pipeline-trace-runid-compat.test.ts`
Expected: PASS, 2 tests. (The implementation is unchanged; this test pins existing behaviour.)

- [ ] **Step 3: Verify global build is still green**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/cli/tests/pipeline-trace-runid-compat.test.ts
git commit -m "test(pipeline-trace): pin back-compat for slug + bare runId shapes"
```

### Verification targets

- Smokes: None (no `pipelines/smoke/` folder in repo at plan-write time).
- Manual exercises: `apparat pipeline run <some-bundled-pipeline> --project /tmp/x` and confirm the on-disk dir name matches `<pipeline-slug>-<8hex>`; then `apparat pipeline trace <slug>-<uuid8> --project /tmp/x` round-trips.
- Lint: `npx vitest run src/cli/tests/apparat-paths.test.ts src/cli/tests/apparat-paths-slug-format.test.ts src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-run-runid.test.ts src/cli/tests/pipeline-trace-runid-compat.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: `src/cli/lib/apparat-paths.ts` (runId composition), `src/cli/commands/pipeline/run.ts` (interactive call site), `pipeline trace` back-compat surface.

---

## Chunk 3: Per-pipeline GC (`gcOldRunsPerPipeline`)

Replaces the flat `gcOldRuns(runsRoot, keep)` with `gcOldRunsPerPipeline(runsRoot, retention)`. Buckets by pipeline name from JSONL parse (re-uses `listAllRuns` from Chunk 1), keeps the newest K per bucket. Crash-at-start dirs (no `pipeline.jsonl` or no `pipeline-start` line) bucket separately at K=5 so a noisy crash loop cannot evict useful history. Caller in `run.ts` switches to the new helper. The barrel export updates so the moved/renamed symbol is reachable from `../commands/pipeline.js`.

### Task 3.1: New per-pipeline GC tests (TDD against the new signature)

**Files:**
- Create: `src/cli/tests/runs-gc-per-pipeline.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/cli/tests/runs-gc-per-pipeline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gcOldRunsPerPipeline } from "../commands/pipeline.js";

function writeRun(
  root: string,
  runId: string,
  events: Array<Record<string, unknown>> | "no-jsonl",
): string {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  if (events !== "no-jsonl") {
    writeFileSync(
      join(dir, "pipeline.jsonl"),
      events.map(e => JSON.stringify(e)).join("\n") + "\n",
    );
  }
  return dir;
}

function meditateRun(runId: string, ts: string): Array<Record<string, unknown>> {
  return [
    { kind: "pipeline-start", runId, pipelineName: "meditate", goal: "g", nodes: [], timestamp: ts },
    { kind: "pipeline-end", runId, outcome: "success", timestamp: ts },
  ];
}
function janitorRun(runId: string, ts: string): Array<Record<string, unknown>> {
  return [
    { kind: "pipeline-start", runId, pipelineName: "janitor", goal: "g", nodes: [], timestamp: ts },
    { kind: "pipeline-end", runId, outcome: "success", timestamp: ts },
  ];
}

describe("gcOldRunsPerPipeline", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "apparat-gc-pp-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("is a no-op when fewer than perPipelineKeep runs exist", () => {
    writeRun(root, "meditate-1", meditateRun("meditate-1", "2026-05-09T18:00:00.000Z"));
    writeRun(root, "meditate-2", meditateRun("meditate-2", "2026-05-09T18:00:01.000Z"));
    gcOldRunsPerPipeline(root, { perPipelineKeep: 5, crashAtStartKeep: 5 });
    expect(existsSync(join(root, "meditate-1"))).toBe(true);
    expect(existsSync(join(root, "meditate-2"))).toBe(true);
  });

  it("keeps the newest K per pipeline, deletes the rest of that bucket", () => {
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-09T18:00:0${i}.000Z`;
      writeRun(root, `meditate-${i}`, meditateRun(`meditate-${i}`, ts));
    }
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-09T19:00:0${i}.000Z`;
      writeRun(root, `janitor-${i}`, janitorRun(`janitor-${i}`, ts));
    }
    gcOldRunsPerPipeline(root, { perPipelineKeep: 2, crashAtStartKeep: 5 });
    // Survivors: 2 newest meditate (3,4) + 2 newest janitor (1,2). Deleted: meditate-0,1,2 + janitor-0.
    expect(existsSync(join(root, "meditate-3"))).toBe(true);
    expect(existsSync(join(root, "meditate-4"))).toBe(true);
    expect(existsSync(join(root, "meditate-0"))).toBe(false);
    expect(existsSync(join(root, "meditate-1"))).toBe(false);
    expect(existsSync(join(root, "meditate-2"))).toBe(false);
    expect(existsSync(join(root, "janitor-1"))).toBe(true);
    expect(existsSync(join(root, "janitor-2"))).toBe(true);
    expect(existsSync(join(root, "janitor-0"))).toBe(false);
  });

  it("buckets crash-at-start dirs (no pipeline.jsonl) separately from named buckets", () => {
    // 3 named meditate runs, K=2 → 1 deleted from meditate bucket
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-09T18:00:0${i}.000Z`;
      writeRun(root, `meditate-${i}`, meditateRun(`meditate-${i}`, ts));
    }
    // 7 crash-at-start dirs, crashAtStartKeep=5 → 2 deleted from crash bucket
    for (let i = 0; i < 7; i++) {
      writeRun(root, `crash-${i}`, "no-jsonl");
    }
    gcOldRunsPerPipeline(root, { perPipelineKeep: 2, crashAtStartKeep: 5 });
    expect(existsSync(join(root, "meditate-2"))).toBe(true);
    expect(existsSync(join(root, "meditate-1"))).toBe(true);
    expect(existsSync(join(root, "meditate-0"))).toBe(false);
    // Crash bucket retention is mtime-ordered (no startedAt). Just verify count after GC = 5.
    const crashSurvivors = ["crash-0","crash-1","crash-2","crash-3","crash-4","crash-5","crash-6"]
      .filter(n => existsSync(join(root, n)));
    expect(crashSurvivors.length).toBe(5);
  });

  it("buckets dirs whose pipeline.jsonl exists but has no pipeline-start as crashed", () => {
    writeRun(root, "broken-1", [{ kind: "node-start", nodeReceiveId: "x" }]);
    writeRun(root, "broken-2", [{ kind: "node-start", nodeReceiveId: "y" }]);
    writeRun(root, "broken-3", [{ kind: "node-start", nodeReceiveId: "z" }]);
    gcOldRunsPerPipeline(root, { perPipelineKeep: 10, crashAtStartKeep: 2 });
    // 3 crash dirs, K=2 → 1 deleted
    const survivors = ["broken-1","broken-2","broken-3"].filter(n => existsSync(join(root, n)));
    expect(survivors.length).toBe(2);
  });

  it("returns silently if root does not exist", () => {
    expect(() => gcOldRunsPerPipeline(join(root, "missing"), { perPipelineKeep: 5, crashAtStartKeep: 5 })).not.toThrow();
  });

  it("ignores non-directory entries in the runs root", () => {
    writeFileSync(join(root, "stray.txt"), "x");
    writeRun(root, "meditate-1", meditateRun("meditate-1", "2026-05-09T18:00:00.000Z"));
    expect(() => gcOldRunsPerPipeline(root, { perPipelineKeep: 5, crashAtStartKeep: 5 })).not.toThrow();
    expect(existsSync(join(root, "stray.txt"))).toBe(true);
  });

  it("preserves bare-id legacy dirs whose JSONL still carries pipelineName", () => {
    // Old (pre-slug) dir name + JSONL identifies the bucket.
    writeRun(root, "deadbeef", meditateRun("deadbeef", "2026-05-09T18:00:00.000Z"));
    writeRun(root, "feedface", meditateRun("feedface", "2026-05-09T18:00:01.000Z"));
    writeRun(root, "meditate-1", meditateRun("meditate-1", "2026-05-09T18:00:02.000Z"));
    gcOldRunsPerPipeline(root, { perPipelineKeep: 2, crashAtStartKeep: 5 });
    // 3 in meditate bucket, K=2 → oldest (deadbeef) deleted.
    expect(existsSync(join(root, "deadbeef"))).toBe(false);
    expect(existsSync(join(root, "feedface"))).toBe(true);
    expect(existsSync(join(root, "meditate-1"))).toBe(true);
  });

  it("respects APPARAT_RUNS_KEEP + APPARAT_CRASH_AT_START_KEEP via the run command's caller plumbing", async () => {
    // This pin guards the env → retention seam. The unit-level retention is covered
    // above; here we only assert that pipelineRunCommand reads the env vars and
    // hands them to gcOldRunsPerPipeline (regression for the run.ts wiring done in
    // Task 3.2 Step 4).
    const { pipelineRunCommand } = await import("../commands/pipeline/run.js");
    const project = root; // reuse the temp root as a project
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph meditate { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );

    // Seed 3 prior meditate runs (older mtimes) so there is something to evict.
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-08T18:00:0${i}.000Z`;
      writeRun(root, `meditate-old-${i}`, meditateRun(`meditate-old-${i}`, ts));
    }
    const orig = process.env.APPARAT_RUNS_KEEP;
    process.env.APPARAT_RUNS_KEEP = "1";
    try {
      // pipelineRunCommand exits via process.exit on TUI completion; capture the throw.
      const { default: vi } = await import("vitest").then(m => ({ default: m.vi }));
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
      try {
        await pipelineRunCommand(dotFile, { project });
      } catch {} finally { exitSpy.mockRestore(); }
    } finally {
      if (orig === undefined) delete process.env.APPARAT_RUNS_KEEP;
      else process.env.APPARAT_RUNS_KEEP = orig;
    }
    // After GC with K=1, exactly 1 meditate dir survives (the new one). The 3 older
    // meditate-old-* dirs have all been pruned.
    const survivors = ["meditate-old-0","meditate-old-1","meditate-old-2"]
      .filter(n => existsSync(join(root, n)));
    expect(survivors.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts`
Expected: FAIL — `gcOldRunsPerPipeline` does not exist (`SyntaxError: The requested module '../commands/pipeline.js' does not provide an export named 'gcOldRunsPerPipeline'`).

- [ ] **Step 3: Add `gcOldRunsPerPipeline` to `runs-gc.ts` (do NOT delete `gcOldRuns` yet)**

Edit `src/cli/commands/pipeline/runs-gc.ts`. Keep the file's existing `resolveResumeLogsRoot` block (`:1-45`) byte-for-byte **and** keep the existing `gcOldRuns` block (`:47-67`) intact for now — Task 3.2 deletes it atomically with the caller + barrel switch so no commit between 3.1 and 3.2 leaves the barrel re-exporting a missing symbol. Append below the existing `gcOldRuns` block:

```ts
import { listAllRuns } from "../../lib/runs-index.js";

export interface GcRetention {
  /** Keep the newest K runs per known pipelineName. Default 10. */
  perPipelineKeep: number;
  /** Keep the newest K crash-at-start dirs (no pipeline.jsonl or no pipeline-start). Default 5. */
  crashAtStartKeep: number;
}

const CRASH_BUCKET_KEY = "__crash_at_start__";

/**
 * Garbage-collect a project's runs directory by bucketing entries on
 * pipelineName (read from each run's pipeline.jsonl) and keeping the newest
 * `perPipelineKeep` per known pipeline plus the newest `crashAtStartKeep`
 * for crash-at-start dirs (no JSONL or no pipeline-start line).
 *
 * Replaces the previous flat-by-mtime `gcOldRuns(runsRoot, keep)`. The crash
 * bucket exists so a noisy crash loop cannot evict last week's only useful
 * named-pipeline run.
 */
export function gcOldRunsPerPipeline(runsRoot: string, retention: GcRetention): void {
  if (!existsSync(runsRoot)) return;
  const summaries = listAllRuns(runsRoot); // sorted newest-first by startedAt; nulls last

  const buckets = new Map<string, typeof summaries>();
  for (const s of summaries) {
    const key = s.pipelineName ?? CRASH_BUCKET_KEY;
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }

  for (const [key, arr] of buckets) {
    // Within a known-pipeline bucket arr is already startedAt-desc (listAllRuns sort).
    // For the crash bucket startedAt is null for all → fall back to mtime-desc.
    let ordered = arr;
    if (key === CRASH_BUCKET_KEY) {
      ordered = [...arr].sort((a, b) => {
        const ma = safeMtime(join(runsRoot, a.runId));
        const mb = safeMtime(join(runsRoot, b.runId));
        return mb - ma;
      });
    }
    const keep = key === CRASH_BUCKET_KEY ? retention.crashAtStartKeep : retention.perPipelineKeep;
    for (const e of ordered.slice(keep)) {
      rmSync(join(runsRoot, e.runId), { recursive: true, force: true });
    }
  }
}

function safeMtime(path: string): number {
  try { return lstatSync(path).mtimeMs; } catch { return 0; }
}
```

(Adjust the file's existing `import` line at the top to drop unused symbols if needed — the existing imports `existsSync, readdirSync, rmSync, lstatSync` from `"fs"` and `join` from `"path"` are all still consumed; `readdirSync` only by `resolveResumeLogsRoot`.)

- [ ] **Step 4: Verify the new tests pass**

Run: `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit (intermediate; barrel + caller wiring next)**

```bash
git add src/cli/commands/pipeline/runs-gc.ts src/cli/tests/runs-gc-per-pipeline.test.ts
git commit -m "feat(runs-gc): add gcOldRunsPerPipeline with per-pipeline + crash buckets"
```

### Task 3.2: Delete `gcOldRuns` and switch the caller + barrel

**Files:**
- Modify: `src/cli/commands/pipeline/runs-gc.ts` (delete `gcOldRuns` export)
- Modify: `src/cli/commands/pipeline.ts` (drop `gcOldRuns` re-export, add `gcOldRunsPerPipeline`)
- Modify: `src/cli/commands/pipeline/run.ts` (call site)
- Rewrite: `src/cli/tests/pipeline-runs-gc.test.ts`

- [ ] **Step 1: Rewrite the legacy test against the new helper**

Replace the entire contents of `src/cli/tests/pipeline-runs-gc.test.ts` with:

```ts
// Compat shim: `gcOldRuns` was replaced by `gcOldRunsPerPipeline` in
// docs/superpowers/specs/2026-05-10-runs-folder-is-an-opaque-graveyard-design.md.
// This file's per-pipeline coverage lives in runs-gc-per-pipeline.test.ts;
// here we only pin the env-var → retention plumbing the run command does.
import { describe, it, expect } from "vitest";

describe("gcOldRuns is removed in favour of gcOldRunsPerPipeline", () => {
  it("does not export the old name from the barrel", async () => {
    const mod = await import("../commands/pipeline.js") as Record<string, unknown>;
    expect(mod.gcOldRuns).toBeUndefined();
    expect(typeof mod.gcOldRunsPerPipeline).toBe("function");
  });
});
```

(The per-bucket retention behaviour is fully covered by `runs-gc-per-pipeline.test.ts` from Task 3.1; rewriting this file as a barrel-presence check keeps the rename auditable in `git log` without duplicating coverage.)

- [ ] **Step 2: Update the barrel export**

Edit `src/cli/commands/pipeline.ts:19`. Replace:

```ts
export { gcOldRuns, resolveResumeLogsRoot } from "./pipeline/runs-gc.js";
```

with:

```ts
export { gcOldRunsPerPipeline, resolveResumeLogsRoot } from "./pipeline/runs-gc.js";
```

- [ ] **Step 3: Delete `gcOldRuns` from `runs-gc.ts`**

Edit `src/cli/commands/pipeline/runs-gc.ts`. Remove the `export function gcOldRuns(runsRoot, keep)` block (the original `:47-67`, including its leading docblock). The file should now export only `resolveResumeLogsRoot`, `gcOldRunsPerPipeline`, and `GcRetention`. Steps 2 (barrel update), 3 (delete), and 4 (caller switch) all live in the same commit at Step 8 so the build stays green between commits.

- [ ] **Step 4: Switch the caller in `run.ts`**

Edit `src/cli/commands/pipeline/run.ts`. At line 30, replace:

```ts
import { gcOldRuns, resolveResumeLogsRoot } from "./runs-gc.js";
```

with:

```ts
import { gcOldRunsPerPipeline, resolveResumeLogsRoot } from "./runs-gc.js";
```

At lines 131-134, replace:

```ts
  if (!opts.resume) {
    const keep = Number(process.env.APPARAT_RUNS_KEEP ?? "50");
    gcOldRuns(runsRoot, Number.isFinite(keep) && keep > 0 ? keep : 50);
  }
```

with:

```ts
  if (!opts.resume) {
    const perPipelineKeep = positiveIntEnv("APPARAT_RUNS_KEEP", 10);
    const crashAtStartKeep = positiveIntEnv("APPARAT_CRASH_AT_START_KEEP", 5);
    gcOldRunsPerPipeline(runsRoot, { perPipelineKeep, crashAtStartKeep });
  }
```

Add this helper at the very end of `src/cli/commands/pipeline/run.ts` (after the closing `}` of `pipelineRunCommand`, at module scope, file-EOF):

```ts
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
```

- [ ] **Step 5: Run the full test sweep**

Run: `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts src/cli/tests/pipeline-runs-gc.test.ts src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-run-runid.test.ts src/cli/tests/runs-index.test.ts`
Expected: PASS for all five files.

- [ ] **Step 6: Confirm no orphan callers**

Run: `npx tsc --noEmit`
Expected: clean. (`gcOldRuns` is removed; if any caller you missed still references it, tsc reports the import error.)

- [ ] **Step 7: Confirm grep invariants from §10.1 of the design**

Manually:

```bash
git grep -nE 'gcOldRuns\b' -- src
```
Expected: zero matches (the legacy export is fully gone).

```bash
git grep -nE 'gcOldRunsPerPipeline\b' -- src
```
Expected: matches in `runs-gc.ts`, `pipeline.ts` (barrel), `run.ts` (call site), and the two test files (`runs-gc-per-pipeline.test.ts`, `pipeline-runs-gc.test.ts`).

```bash
git grep -nE 'randomUUID\(\)\.slice\(0, 8\)' -- src
```
Expected: exactly one match — inside `newRunId` in `apparat-paths.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/pipeline/runs-gc.ts src/cli/commands/pipeline.ts src/cli/commands/pipeline/run.ts src/cli/tests/pipeline-runs-gc.test.ts
git commit -m "refactor(runs-gc): drop flat gcOldRuns, switch run command to per-pipeline buckets"
```

### Verification targets

- Smokes: None (no `pipelines/smoke/` folder in repo).
- Manual exercises: From a scratch project, run a bundled pipeline twice (e.g. `apparat pipeline run meditate --project /tmp/x`), set `APPARAT_RUNS_KEEP=1`, run a third time, and confirm only one meditate dir survives. Synthesise two crash-at-start dirs (`mkdir /tmp/x/.apparat/runs/crash-{1,2}`) with `APPARAT_CRASH_AT_START_KEEP=1`, run any pipeline once more, and confirm crash dirs collapse to 1.
- Lint: `npx vitest run src/cli/tests/runs-gc-per-pipeline.test.ts src/cli/tests/pipeline-runs-gc.test.ts src/cli/tests/pipeline-run-runid.test.ts src/cli/tests/pipeline.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: `src/cli/commands/pipeline/runs-gc.ts`, `src/cli/commands/pipeline.ts` (barrel), `src/cli/commands/pipeline/run.ts` (caller), `APPARAT_RUNS_KEEP` env-var semantics (now per-pipeline, plus new `APPARAT_CRASH_AT_START_KEEP`).

---

## Chunk 4: Layer-2 `pipeline list <name>` rendering

Widens `pipelineListCommand` to take an optional `name`; preserves Layer-1 rendering byte-for-byte. With a name supplied, prints the same Local/Bundled section structure (the matched row appears under whichever section it belongs to; the empty side prints `(none for this name — see apparat pipeline list for the full roster)` per design §9.1 default), then nests a recent-runs sub-table under the matched row. Each row prints `→ apparat pipeline trace <runId>` for copy-paste drill-in.

### Task 4.1: Layer-1 regression-pin (preserve verbatim)

**Files:**
- Create: `src/cli/tests/pipeline-list-layer2.test.ts`

- [ ] **Step 1: Write the Layer-1 regression test FIRST (it must pass before any list.ts edit)**

Create `src/cli/tests/pipeline-list-layer2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineListCommand } from "../commands/pipeline/list.js";

const logs: string[] = [];
const origLog = console.log;
const origInfo = console.info;
beforeAll(() => {
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.info = console.log;
});
afterAll(() => { console.log = origLog; console.info = origInfo; });
beforeEach(() => { logs.length = 0; });

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), "apparat-list-layer2-"));
  // Layer-1 fixture: one local pipeline.
  const pipelinesDir = join(project, ".apparat", "pipelines", "meditate");
  mkdirSync(pipelinesDir, { recursive: true });
  writeFileSync(
    join(pipelinesDir, "pipeline.dot"),
    'digraph meditate { goal="Generate illuminations"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
  );
  return project;
}

describe("pipeline list — Layer 1 (no positional)", () => {
  it("renders the Local + Bundled section headers and the meditate row unchanged", async () => {
    const project = makeProject();
    await pipelineListCommand({ project });
    const out = logs.join("\n");
    expect(out).toMatch(/Local pipelines:/);
    expect(out).toMatch(/Bundled pipelines:/);
    expect(out).toMatch(/meditate\s+"Generate illuminations"/);
    rmSync(project, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to confirm Layer-1 baseline is captured (current code already prints this)**

Run: `npx vitest run src/cli/tests/pipeline-list-layer2.test.ts`
Expected: PASS for the Layer-1 case (the existing `pipelineListCommand` already does this; the regression-pin protects it from drift).

- [ ] **Step 3: Commit the regression-pin alone**

```bash
git add src/cli/tests/pipeline-list-layer2.test.ts
git commit -m "test(pipeline-list): regression-pin Layer-1 output before adding Layer 2"
```

### Task 4.2: Layer-2 happy-path test (failing)

**Files:**
- Modify: `src/cli/tests/pipeline-list-layer2.test.ts`

- [ ] **Step 1: Append failing Layer-2 tests**

Edit `src/cli/tests/pipeline-list-layer2.test.ts`. Append after the Layer-1 describe block (still inside the same file):

```ts
function seedRun(project: string, runId: string, pipelineName: string, opts: {
  outcome?: "success" | "failure";
  failedNodeId?: string;
  startedAt?: string;
  endedAt?: string;
}): void {
  const dir = join(project, ".apparat", "runs", runId);
  mkdirSync(dir, { recursive: true });
  const startedAt = opts.startedAt ?? "2026-05-09T19:30:00.000Z";
  const endedAt = opts.endedAt ?? "2026-05-09T19:30:12.400Z";
  const events: Array<Record<string, unknown>> = [
    { kind: "pipeline-start", runId, pipelineName, goal: "g", nodes: [], timestamp: startedAt },
  ];
  if (opts.outcome === "failure") {
    events.push({ kind: "node-end", nodeReceiveId: "x-1", nodeId: opts.failedNodeId ?? "classifier", success: false, contextUpdates: {} });
    events.push({ kind: "pipeline-end", runId, outcome: "failure", timestamp: endedAt });
  } else if (opts.outcome === "success") {
    events.push({ kind: "pipeline-end", runId, outcome: "success", timestamp: endedAt });
  }
  // outcome undefined → in-progress (omit pipeline-end).
  writeFileSync(join(dir, "pipeline.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

describe("pipeline list <name> — Layer 2 (positional)", () => {
  it("renders a recent-runs sub-table newest-first with outcome glyphs and trace hints", async () => {
    const project = makeProject();
    seedRun(project, "meditate-aaaaaaaa", "meditate", { outcome: "success", startedAt: "2026-05-09T19:30:00.000Z", endedAt: "2026-05-09T19:30:12.400Z" });
    seedRun(project, "meditate-bbbbbbbb", "meditate", { outcome: "failure", failedNodeId: "classifier", startedAt: "2026-05-09T18:12:00.000Z", endedAt: "2026-05-09T18:12:04.100Z" });
    seedRun(project, "meditate-cccccccc", "meditate", { startedAt: "2026-05-09T20:00:00.000Z" }); // in-progress

    await pipelineListCommand({ project, name: "meditate" });

    const out = logs.join("\n");
    expect(out).toMatch(/Local pipelines:/);
    expect(out).toMatch(/meditate\s+"Generate illuminations"/);
    expect(out).toMatch(/recent runs:/);
    // Newest in-progress on top.
    const idx = (s: string) => out.indexOf(s);
    expect(idx("meditate-cccccccc")).toBeGreaterThan(-1);
    expect(idx("meditate-cccccccc")).toBeLessThan(idx("meditate-aaaaaaaa"));
    expect(idx("meditate-aaaaaaaa")).toBeLessThan(idx("meditate-bbbbbbbb"));
    // Outcome glyphs.
    expect(out).toMatch(/✓\s+meditate-aaaaaaaa/);
    expect(out).toMatch(/✗\s+meditate-bbbbbbbb/);
    expect(out).toMatch(/…\s+meditate-cccccccc/);
    // Failed-node tail on the failure row.
    expect(out).toMatch(/failed at: classifier/);
    // Copy-paste trace hint on every row.
    expect(out).toMatch(/→ apparat pipeline trace meditate-aaaaaaaa/);
    expect(out).toMatch(/→ apparat pipeline trace meditate-bbbbbbbb/);
    expect(out).toMatch(/→ apparat pipeline trace meditate-cccccccc/);
    rmSync(project, { recursive: true, force: true });
  });

  it("prints `recent runs: (none)` when no runs exist for the named pipeline", async () => {
    const project = makeProject();
    await pipelineListCommand({ project, name: "meditate" });
    const out = logs.join("\n");
    expect(out).toMatch(/recent runs:\s*\(none\)/);
    rmSync(project, { recursive: true, force: true });
  });

  it("exits 1 when the pipeline name is unknown", async () => {
    const project = makeProject();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    const errs: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => {
      errs.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
      return true;
    }) as any);
    try {
      await expect(pipelineListCommand({ project, name: "no-such-pipeline" })).rejects.toThrow(/exit:1/);
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(errs.join("")).toMatch(/pipeline not found: no-such-pipeline/);
    rmSync(project, { recursive: true, force: true });
  });

  it("matches old bare-id directories whose JSONL still carries pipelineName=meditate", async () => {
    const project = makeProject();
    seedRun(project, "deadbeef", "meditate", { outcome: "success", startedAt: "2026-05-09T17:00:00.000Z", endedAt: "2026-05-09T17:00:01.000Z" });
    await pipelineListCommand({ project, name: "meditate" });
    const out = logs.join("\n");
    expect(out).toMatch(/✓\s+deadbeef/);
    expect(out).toMatch(/→ apparat pipeline trace deadbeef/);
    rmSync(project, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the file to confirm Layer-2 cases fail**

Run: `npx vitest run src/cli/tests/pipeline-list-layer2.test.ts`
Expected: Layer-1 case PASS, four Layer-2 cases FAIL — `pipelineListCommand` does not yet accept `name`.

- [ ] **Step 3: Implement Layer 2 in `list.ts`**

Edit `src/cli/commands/pipeline/list.ts`. Replace the entire file body with:

```ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDot } from "../../../attractor/core/graph.js";
import { listAllPipelines, type PipelineEntry } from "../../lib/pipeline-resolver.js";
import { runsDir } from "../../lib/apparat-paths.js";
import { listRunsForPipeline, type RunSummary } from "../../lib/runs-index.js";
import * as output from "../../lib/output.js";

export interface PipelineListOptions {
  project?: string;
  /** Layer-2 zoom: when supplied, render the named pipeline's recent-runs table. */
  name?: string;
}

const NAME_COL = 34;

export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const entries = listAllPipelines(project);

  if (opts.name !== undefined) {
    const matched = entries.find(e => e.name === opts.name);
    if (!matched) {
      process.stderr.write(`pipeline not found: ${opts.name} (apparat pipeline list to see roster)\n`);
      process.exit(1);
      return;
    }
    await renderLayer2(entries, matched, runsDir(project), opts.name);
    return;
  }

  const local = entries.filter(e => e.origin !== "bundled");
  const bundled = entries.filter(e => e.origin === "bundled");

  await output.info("Local pipelines:");
  if (local.length === 0) {
    await output.info("  (none)");
  } else {
    for (const e of local) await renderEntry(e);
  }
  await output.info("");
  await output.info("Bundled pipelines:");
  if (bundled.length === 0) {
    await output.info("  (none)");
  } else {
    for (const e of bundled) await renderEntry(e);
  }
}

async function renderLayer2(
  _all: PipelineEntry[],
  matched: PipelineEntry,
  runsRoot: string,
  name: string,
): Promise<void> {
  const matchedIsLocal = matched.origin !== "bundled";
  const ghostLine = "  (none for this name — see `apparat pipeline list` for the full roster)";

  await output.info("Local pipelines:");
  if (matchedIsLocal) {
    await renderEntry(matched);
    await renderRunsTable(listRunsForPipeline(runsRoot, name));
  } else {
    await output.info(ghostLine);
  }
  await output.info("");
  await output.info("Bundled pipelines:");
  if (!matchedIsLocal) {
    await renderEntry(matched);
    await renderRunsTable(listRunsForPipeline(runsRoot, name));
  } else {
    await output.info(ghostLine);
  }
}

async function renderRunsTable(runs: RunSummary[]): Promise<void> {
  await output.info("");
  await output.info("  recent runs:");
  if (runs.length === 0) {
    await output.info("    (none)");
    return;
  }
  for (const r of runs) {
    const glyph = r.outcome === "success" ? "✓"
      : r.outcome === "failure" ? "✗"
      : r.outcome === "in-progress" ? "…"
      : "·"; // crashed
    const ts = r.startedAt ?? "(unknown start)";
    const dur = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
    const tail = r.outcome === "failure" && r.failedNodeId ? `   failed at: ${r.failedNodeId}` : "";
    await output.info(`    ${glyph}  ${r.runId.padEnd(28)} ${ts}   ${dur}${tail}`);
    await output.info(`       → apparat pipeline trace ${r.runId}`);
  }
}

async function renderEntry(e: PipelineEntry): Promise<void> {
  let goal = "(no goal defined)";
  let requires: string[] | undefined;
  try {
    const graph = parseDot(readFileSync(e.absPath, "utf8"));
    if (graph.goal) goal = `"${graph.goal}"`;
    if (graph.inputs && graph.inputs.length > 0) requires = graph.inputs;
  } catch {
    goal = "(unreadable)";
  }
  const tag =
      e.shadowedBundled ? " (forked → local)"
    : e.hasFork         ? " (shadowed by local)"
    : "";
  await output.info(`  ${(e.name + tag).padEnd(NAME_COL)} ${goal}`);
  if (requires) {
    await output.info(`  ${"".padEnd(NAME_COL)} requires: ${requires.join(", ")}`);
  }
}
```

> **Note on the ghost-section block:** per design §9.1 we honour Layer-1's "always print both headers" lock — the unmatched side always renders the `ghostLine`. The unrelated section's roster size is intentionally irrelevant to the rendering. If a future cycle picks option 3 from §9.1 (omit the empty section) only the `else` arm needs to change.

- [ ] **Step 4: Run the Layer-2 file**

Run: `npx vitest run src/cli/tests/pipeline-list-layer2.test.ts`
Expected: PASS, all five tests.

- [ ] **Step 5: Confirm no other test-file regression**

Run: `npx vitest run`
Expected: PASS — the entire suite. (If any pre-existing snapshot of `pipeline list` output asserts the old shape, this is the moment to update it; verify with `npx vitest run` and adjust.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline/list.ts src/cli/tests/pipeline-list-layer2.test.ts
git commit -m "feat(pipeline-list): Layer-2 recent-runs table for `pipeline list <name>`"
```

### Task 4.3: Wire commander for the optional positional

**Files:**
- Modify: `src/cli/program.ts`

- [ ] **Step 1: Update the `pipeline list` registration**

Edit `src/cli/program.ts`. Replace the block at `:173-186` with:

```ts
  pipeline
    .command("list [name]")
    .description("List pipelines (no arg) or recent runs of one pipeline")
    .addHelpText("after", `
Examples:
  apparat pipeline list                       # all pipelines (Layer 1)
  apparat pipeline list meditate              # recent runs of 'meditate' (Layer 2)
  apparat pipeline list meditate --project my-app

Scans <project>/.apparat/pipelines/<name>/ and the bundled fallback. With a
positional <name>, also prints the most recent runs from
<project>/.apparat/runs/, capped by APPARAT_RUNS_KEEP (default 10 per pipeline).
`)
    .option("--project <folder>", "Project folder (defaults to cwd)")
    .action(async (name: string | undefined, opts: { project?: string }) => {
      await pipelineListCommand({ ...opts, name });
    });
```

- [ ] **Step 2: Verify commander still parses cleanly**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: PASS — the full suite.

- [ ] **Step 3: Manual exercise (do this once before commit)**

```bash
node dist/cli/index.js pipeline list --help
```
Expected output contains both `apparat pipeline list                       # all pipelines (Layer 1)` and `apparat pipeline list meditate              # recent runs of 'meditate' (Layer 2)`.

(Skip this step if the dist/ build is stale; the intent is to confirm the help text rendered as written. The tsc + vitest sweeps already prove the code path.)

- [ ] **Step 4: Commit**

```bash
git add src/cli/program.ts
git commit -m "feat(cli): wire `pipeline list [name]` positional to Layer-2 zoom"
```

### Verification targets

- Smokes: None (no `pipelines/smoke/` folder in repo).
- Manual exercises:
  1. `apparat pipeline list --project /tmp/x` — output byte-identical to before this PR.
  2. `apparat pipeline list meditate --project /tmp/x` after running `meditate` twice — recent-runs table shows two rows newest-first, each with `→ apparat pipeline trace …`.
  3. `apparat pipeline list bogus --project /tmp/x` — exit 1, stderr `pipeline not found: bogus (apparat pipeline list to see roster)`.
  4. `apparat pipeline list meditate --project /tmp/empty` — `recent runs: (none)`.
- Lint: `npx vitest run src/cli/tests/pipeline-list-layer2.test.ts` and `npx tsc --noEmit` and `npx vitest run`.
- Surfaces touched: `src/cli/commands/pipeline/list.ts`, `src/cli/program.ts` (commander), Layer-2 reader (`src/cli/lib/runs-index.ts` consumer).

---

## Chunk 5: Documentation updates

`README.md` and `src/cli/skills/apparatus/pipelines.md` are the user-facing surfaces that mention `pipeline list`, the runId shape, and the retention policy. Update them so the docs and behaviour stop disagreeing.

### Task 5.1: README — list + trace one-liners

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `:97`**

Edit `README.md`. Replace the line at `:97` and the paragraph that follows:

```bash
apparat pipeline list <project-folder>
```
List runnable pipelines for the project — both bundled (e.g. `implement`, `janitor`, `meditate`) and project-local under `<project>/.apparat/pipelines/`. Forked bundled pipelines are tagged on both rows.

with:

```bash
apparat pipeline list [<name>] --project <folder>
```
Without `<name>`: list runnable pipelines for the project — both bundled (e.g. `implement`, `janitor`, `meditate`) and project-local under `<project>/.apparat/pipelines/`. Forked bundled pipelines are tagged on both rows. With `<name>`: zoom into one pipeline and print its recent runs from `<project>/.apparat/runs/` newest-first (capped by `APPARAT_RUNS_KEEP`, default 10 per pipeline). Each row prints `→ apparat pipeline trace <runId>` for copy-paste drill-in.

- [ ] **Step 2: Update `:102`**

Replace the line at `:102` and the paragraph that follows:

```bash
apparat pipeline trace <runId> [--node-receive <nodeId>] [--full]
```
Inspect the context and trace logs for a completed pipeline run. `--node-receive` filters to a specific node execution; `--full` shows the raw JSONL trace.

with:

```bash
apparat pipeline trace <runId> [--node-receive <nodeId>] [--full]
```
Inspect the context and trace logs for a completed pipeline run. `<runId>` accepts both the slug-prefixed shape (`meditate-2f8a91c3`, the new default) and the bare 8-char shape (`2f8a91c3`, used by older runs and daemon-spawned tasks). `--node-receive` filters to a specific node execution; `--full` shows the raw JSONL trace.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document `pipeline list <name>` zoom + slug-prefixed runId"
```

### Task 5.2: Pipelines skill — workflow + retention paragraph

**Files:**
- Modify: `src/cli/skills/apparatus/pipelines.md`

- [ ] **Step 1: Update workflow step 7 (`:17`)**

Replace the line at `:17`:

```
7. **Inspect on failure** — `apparat pipeline trace <runId>` to read the per-node context + trace logs from `<project>/.apparat/runs/<runId>/`.
```

with:

```
7. **Inspect on failure** — `apparat pipeline trace <runId>` to read the per-node context + trace logs from `<project>/.apparat/runs/<runId>/`. For a chronological table of recent runs of one pipeline, use `apparat pipeline list <name>`.
```

- [ ] **Step 2: Update the Resume paragraph (`:489`)**

Replace the line at `:489`:

```
Older runs are pruned to the last 50 per project (override with env `APPARAT_RUNS_KEEP=N`).
```

with:

```
Older runs are pruned to the last 10 per pipeline (override with env `APPARAT_RUNS_KEEP=N`). Runs that crashed before writing a `pipeline-start` event are bucketed separately and pruned to the last 5 (override with env `APPARAT_CRASH_AT_START_KEEP=N`) so a noisy crash loop cannot evict useful named-pipeline history.
```

- [ ] **Step 3: Update the Trace section (`:493-501`)**

Locate the existing `### Trace` heading (around `:493`) by content rather than by line number — earlier chunks do not edit this file, so anchors stay valid, but use a Read+Edit pair against verbatim text rather than a blind line-number patch. After the existing `apparat pipeline trace …` code-fence and the sentence ending `… dumps the raw \`pipeline.jsonl\`.`, append a new paragraph:

```
Run IDs are composed as `<pipeline-slug>-<8hex>` (e.g. `meditate-2f8a91c3`) so `<project>/.apparat/runs/` is self-describing on disk. Both `pipeline trace` and `pipeline run --resume` accept the slug-prefixed shape and the legacy bare 8-char shape, so older run dirs remain readable and resumable. To list a pipeline's recent runs without remembering a runId, run `apparat pipeline list <name>` — each row prints a copy-pasteable `→ apparat pipeline trace <runId>` line.
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/skills/apparatus/pipelines.md
git commit -m "docs(skill-pipelines): update list/trace/retention for slug runId + Layer-2 zoom"
```

### Task 5.3: Final cross-cutting verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-suite test sweep**

Run: `npx vitest run`
Expected: PASS — entire suite green.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Grep invariants from design §10.1**

```bash
git grep -nE 'gcOldRuns\b' -- src
```
Expected: zero matches.

```bash
git grep -nE 'listRunsForPipeline|listAllRuns' -- src
```
Expected: matches in `src/cli/lib/runs-index.ts`, `src/cli/commands/pipeline/list.ts`, `src/cli/commands/pipeline/runs-gc.ts`, plus the test files (`runs-index.test.ts`, `runs-gc-per-pipeline.test.ts`).

```bash
git grep -nE 'randomUUID\(\)\.slice\(0, 8\)' -- src
```
Expected: exactly one match — `src/cli/lib/apparat-paths.ts` inside `newRunId`.

- [ ] **Step 4: No commit** (this task is verification-only). If any check fails, fix in the chunk it belongs to and re-run.

### Verification targets

- Smokes: None.
- Manual exercises: `node dist/cli/index.js pipeline --help` and confirm the `list [name]` line appears in the auto-generated subcommand summary.
- Lint: `npx vitest run` and `npx tsc --noEmit`.
- Surfaces touched: `README.md`, `src/cli/skills/apparatus/pipelines.md`.

---

## Open questions (mirrored from design §9 — implementer's call)

- **§9.1 ghost-section formatting.** This plan defaults to printing the line `(none for this name — see apparat pipeline list for the full roster)` under the empty section's header (option 1 from the design). The implementer may switch to option 3 (omit the empty section entirely) by editing the relevant arm of `renderLayer2` and updating the Layer-1 regression test if the section header set ever differs.
- **§9.2 `failed at: <node>` polish.** This plan ships the `failed at:` tail (the parse cost is one extra line per failed run; `runs-index.ts` already does the JSONL pass anyway). If the implementer wants a smaller first-cut, drop the `tail` clause in `renderRunsTable` and the corresponding `failed at: classifier` assertion in `pipeline-list-layer2.test.ts`.
- **§9.3 `runs-table.ts` extraction.** Default keeps the renderer inside `list.ts`. Extract to `src/cli/lib/runs-table.ts` only if the renderer grows past ~50 LOC during implementation.

## Notes for the executing session

- The five chunks are sequenced so each one ships a green test sweep on its own. Chunk 1 has no caller yet (lib only); Chunks 2 and 3 are independent in terms of tests and could swap order, but Chunk 3 imports from `runs-index.ts` (Chunk 1) so Chunk 1 must land first; Chunk 4 imports from `runs-index.ts` (Chunk 1) and from the slug-prefixed runId (Chunk 2) for assertion consistency. Chunk 5 is docs-only.
- Per design §7.8, single-PR is the default. If review bandwidth pushes for splitting, the natural seam is PR1=Chunk 1, PR2=Chunks 2+3, PR3=Chunks 4+5.
- This plan does **not** touch the daemon's `runTask` (`src/daemon/runner.ts:54-138`). Slug-side daemon runs wait for `2026-05-09-two-run-homes-no-cross-project-view-design.md` to ship and `injectRunArgs` to learn the pipeline name. Layer-2 already tolerates daemon-side bare-id dirs because it parses `pipelineName` from JSONL, not the dir name (Task 1.2 pins this in `runs-index.test.ts`).
- This plan does **not** touch the failure-footer renderer (`src/cli/lib/failure-handoff.ts`). The illumination's step 5 ("previous runs hint in failure footer") is deferred onto `2026-05-09-pipeline-failure-handoff-is-shallow-design.md` per the round-1 chat lock.
