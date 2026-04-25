---
status: implemented
---

# Source-Location Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `ralph pipeline validate` to surface `file:line:col` + source-frame carets on every diagnostic by cashing in the `@ts-graphviz/ast` location data that has been collected but unused since v0.1.28.

**Architecture:** Add optional `SourceLocation` to `Node`, `Edge`, and `Diagnostic`. Capture per-attribute and per-edge locations in `parseDotV2`. Wrap `parseAST` errors in a typed `DotSyntaxError`. Validator emits `location` on every locatable diagnostic. CLI renders `relpath:line:col` header plus a pure `renderCodeFrame` function. Zero runtime impact on pipeline execution — validator-only.

**Tech Stack:** TypeScript, `@ts-graphviz/ast ^3.0.6` (already installed), zod (already installed), vitest.

**Spec:** `docs/superpowers/specs/2026-04-20-source-location-diagnostics-design.md`

---

## File map

### Create
- `src/attractor/core/dot-syntax.ts` — `DotSyntaxError` class
- `src/cli/lib/code-frame.ts` — pure `renderCodeFrame` function
- `src/attractor/tests/dot-syntax.test.ts` — PEG-error wrapping
- `src/cli/tests/code-frame.test.ts` — pure renderer unit tests

### Modify
- `src/attractor/types.ts` — add `SourceLocation`, extend `Node`, `Edge`, `Diagnostic`
- `src/attractor/core/graph-ast.ts` — capture per-attr + per-edge + per-node locations; wrap `parseAST`
- `src/attractor/core/schemas.ts` — strip new parser metadata; one diag per unknown key w/ `location`
- `src/attractor/core/graph.ts` — edge & node rules set `location`
- `src/cli/commands/pipeline.ts` — syntax-error catch; header prefix; code-frame call
- `src/attractor/tests/graph-ast.test.ts` — assert locations
- `src/attractor/tests/dual-parser.test.ts` — strip new metadata for equality
- `src/attractor/tests/graph.test.ts` — edge/node diags carry `location`
- `src/attractor/tests/schemas.test.ts` — per-key diag + location
- `src/cli/tests/pipeline.test.ts` (or add new) — end-to-end snapshot

---

## Chunk 1: Data model + parser location capture

Goal: every `Node` and `Edge` returned by `parseDotV2` carries `sourceLocation` and `attrLocations`. Legacy `sourceLine` preserved. Strict schemas strip the new fields. No CLI-visible change yet.

### Task 1.1: Add `SourceLocation` type and extend public interfaces

**Files:**
- Modify: `src/attractor/types.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/attractor/tests/graph-ast.test.ts`:

```ts
it("records sourceLocation with line + column on each node", () => {
  const dot = `digraph g {\n  start [shape="Mdiamond"];\n  done  [shape="Msquare"];\n}`;
  const g = parseDotV2(dot);
  const start = g.nodes.get("start");
  expect(start?.sourceLocation).toEqual({
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: expect.any(Number),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts -t "sourceLocation"`
Expected: FAIL — field does not exist.

- [ ] **Step 3: Add `SourceLocation` + extend interfaces**

Edit `src/attractor/types.ts`:

```ts
export interface SourceLocation {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}
```

Add to `Node`:

```ts
  sourceLocation?: SourceLocation;
  attrLocations?: Record<string, SourceLocation>;
```

Add to `Edge`:

```ts
  sourceLocation?: SourceLocation;
  attrLocations?: Record<string, SourceLocation>;
```

Add to `Diagnostic`:

```ts
  location?: SourceLocation;
```

Keep `sourceLine?: number` in `Node` with a JSDoc `@deprecated Use sourceLocation.line`.

- [ ] **Step 4: Run test — expect FAIL still (parser hasn't been updated)**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts -t "sourceLocation"`
Expected: FAIL — `sourceLocation` is undefined.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/types.ts src/attractor/tests/graph-ast.test.ts
git commit -m "feat(types): add SourceLocation + per-attribute/per-edge location fields"
```

### Task 1.2: Capture per-node `sourceLocation` in `parseDotV2`

**Files:**
- Modify: `src/attractor/core/graph-ast.ts:68-76`

- [ ] **Step 1: Make the Task 1.1 test pass**

In the `Node` case of `walk()`, replace the current `sourceLine` assignment with:

```ts
const loc = child.location;
const sourceLocation: SourceLocation | undefined = loc
  ? {
      line: loc.start.line,
      column: loc.start.column,
      endLine: loc.end?.line,
      endColumn: loc.end?.column,
    }
  : undefined;
nodes.set(id, {
  id,
  ...attrs,
  sourceLine: loc?.start.line,
  sourceLocation,
} as Node);
```

Import `SourceLocation` from `../types.js`.

- [ ] **Step 2: Run test — expect PASS**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts -t "sourceLocation"`
Expected: PASS.

- [ ] **Step 3: Run whole graph-ast suite + dual-parser to catch regressions**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts src/attractor/tests/dual-parser.test.ts`
Expected: dual-parser FAILS because new field isn't stripped. That's the next task.

- [ ] **Step 4: Commit**

```bash
git add src/attractor/core/graph-ast.ts
git commit -m "feat(parser): populate Node.sourceLocation from AST"
```

### Task 1.3: Strip new parser metadata in dual-parser equality check

**Files:**
- Modify: `src/attractor/tests/dual-parser.test.ts:28`

- [ ] **Step 1: Extend the strip**

Current line:

```ts
const { sourceLine, ...rest } = n;
```

Change to:

```ts
const { sourceLine, sourceLocation, attrLocations, ...rest } = n;
```

(Same `_unused` pattern — destructure to discard.)

- [ ] **Step 2: Run test**

Run: `npx vitest run src/attractor/tests/dual-parser.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/dual-parser.test.ts
git commit -m "test(dual-parser): strip sourceLocation/attrLocations in equality check"
```

### Task 1.4: Capture per-attribute `attrLocations`

**Files:**
- Modify: `src/attractor/core/graph-ast.ts:16-25` (`readAttrs`)
- Modify: `src/attractor/core/graph-ast.ts` node + edge cases

- [ ] **Step 1: Write the failing test**

Add to `src/attractor/tests/graph-ast.test.ts`:

```ts
it("records attrLocations keyed by camelCase attr name", () => {
  const dot = `digraph g {\n  start [shape="Mdiamond"];\n  worker [\n    type="tool",\n    cwd="$project",\n    tool_command="echo hi"\n  ];\n  done [shape="Msquare"];\n  start -> worker -> done;\n}`;
  const g = parseDotV2(dot);
  const worker = g.nodes.get("worker");
  expect(worker?.attrLocations?.type?.line).toBe(4);
  expect(worker?.attrLocations?.cwd?.line).toBe(5);
  expect(worker?.attrLocations?.toolCommand?.line).toBe(6);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts -t "attrLocations"`
Expected: FAIL.

- [ ] **Step 3: Rewrite `readAttrs` to emit locations**

Change return type to `{ attrs: AttrMap; locations: Record<string, SourceLocation> }`. For each `Attribute` child, record `locations[toCamel(c.key.value)] = { line, column, endLine, endColumn }` from `c.location`.

Update callers:

- `AttributeList`: ignore locations (defaults apply to future nodes, not positional).
- `Node` case: `const { attrs: selfAttrs, locations: selfLocs } = readAttrs(child.children); const merged = { ...nodeDefaults, ...selfAttrs }; nodes.set(id, { id, ...merged, sourceLine: loc?.start.line, sourceLocation, attrLocations: selfLocs });` — note only the node's own attrs get locations (defaults do not).
- `Edge` case: same pattern — `attrLocations` reflects only the edge-local attrs.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts -t "attrLocations"`
Expected: PASS.

- [ ] **Step 5: Run full attractor suite**

Run: `npx vitest run src/attractor`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/graph-ast.ts src/attractor/tests/graph-ast.test.ts
git commit -m "feat(parser): capture per-attribute sourceLocations"
```

### Task 1.5: Capture edge locations

**Files:**
- Modify: `src/attractor/core/graph-ast.ts` `Edge` case

- [ ] **Step 1: Write the failing test**

Add to `src/attractor/tests/graph-ast.test.ts`:

```ts
it("records sourceLocation on each edge", () => {
  const dot = `digraph g {\n  start [shape="Mdiamond"];\n  done [shape="Msquare"];\n  start -> done [label="go"];\n}`;
  const g = parseDotV2(dot);
  expect(g.edges[0].sourceLocation?.line).toBe(4);
  expect(g.edges[0].attrLocations?.label?.line).toBe(4);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts -t "sourceLocation on each edge"`
Expected: FAIL.

- [ ] **Step 3: Populate edge locations**

In the `Edge` case, for each emitted edge (the chain `targets[i] -> targets[i+1]`), attach:

```ts
const edgeLoc = child.location;
edges.push({
  from: targets[i],
  to: targets[i + 1],
  ...edgeAttrs,
  sourceLocation: edgeLoc ? {
    line: edgeLoc.start.line, column: edgeLoc.start.column,
    endLine: edgeLoc.end?.line, endColumn: edgeLoc.end?.column,
  } : undefined,
  attrLocations: edgeLocs,
} as Edge);
```

- [ ] **Step 4: Run full attractor suite**

Run: `npx vitest run src/attractor`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/graph-ast.ts src/attractor/tests/graph-ast.test.ts
git commit -m "feat(parser): capture Edge.sourceLocation + attrLocations"
```

### Task 1.6: Strip new metadata in `validateNode`

**Files:**
- Modify: `src/attractor/core/schemas.ts:137`

- [ ] **Step 1: Extend strip**

```ts
const {
  sourceLine: _sl,
  sourceLocation: _slo,
  attrLocations: _al,
  ...nodeForValidation
} = node as Node & { sourceLocation?: unknown; attrLocations?: unknown };
```

- [ ] **Step 2: Run all validator tests**

Run: `npx vitest run src/attractor`
Expected: green. If a strict-schema test flags an "unrecognized key" for `sourceLocation` or `attrLocations`, the strip is wrong — fix before moving on.

- [ ] **Step 3: Confirm `applyStylesheet` preserves locations**

Add to `src/attractor/tests/dot-common.test.ts` (create if missing):

```ts
it("applyStylesheet preserves sourceLocation and attrLocations", () => {
  const node = { id: "x", sourceLocation: { line: 5, column: 1 }, attrLocations: { shape: { line: 5, column: 3 } } } as any;
  const result = applyStylesheet(node, [{ selector: { class: null, id: "x" }, attrs: { extra: "hi" } }]);
  expect(result.sourceLocation).toEqual(node.sourceLocation);
  expect(result.attrLocations).toEqual(node.attrLocations);
});
```

Run: `npx vitest run src/attractor/tests/dot-common.test.ts`
Expected: PASS (spread preserves them naturally; test pins the invariant).

- [ ] **Step 4: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/dot-common.test.ts
git commit -m "fix(schemas): strip sourceLocation/attrLocations before strict parse"
```

---

## Chunk 2: Syntax-error wrapping

Goal: malformed DOT raises a typed `DotSyntaxError` with `location`. No CLI wiring yet.

### Task 2.1: Create `DotSyntaxError`

**Files:**
- Create: `src/attractor/core/dot-syntax.ts`

- [ ] **Step 1: Write class**

```ts
import type { SourceLocation } from "../types.js";

export class DotSyntaxError extends Error {
  readonly location: SourceLocation;
  constructor(message: string, location: SourceLocation) {
    super(message);
    this.name = "DotSyntaxError";
    this.location = location;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/attractor/core/dot-syntax.ts
git commit -m "feat(parser): add DotSyntaxError for wrapped PEG errors"
```

### Task 2.2: Wrap `parseAST` call in `parseDotV2`

**Files:**
- Modify: `src/attractor/core/graph-ast.ts` (the `parseAST(normalized)` line)
- Create: `src/attractor/tests/dot-syntax.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseDotV2 } from "../core/graph-ast.js";
import { DotSyntaxError } from "../core/dot-syntax.js";

describe("parseDotV2 syntax errors", () => {
  it("wraps PEG syntax errors with location", () => {
    const bad = `digraph g {\n  start [shape="Mdiamond"\n  done\n}`;
    let err: unknown;
    try { parseDotV2(bad); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DotSyntaxError);
    const dse = err as DotSyntaxError;
    expect(dse.location.line).toBeGreaterThanOrEqual(2);
    expect(dse.location.column).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (raw PEG error bubbles up)

Run: `npx vitest run src/attractor/tests/dot-syntax.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add try/catch around `parseAST`**

```ts
let ast;
try { ast = parseAST(normalized); }
catch (e: any) {
  if (e && e.location && typeof e.location?.start?.line === "number") {
    throw new DotSyntaxError(e.message ?? "DOT syntax error", {
      line: e.location.start.line,
      column: e.location.start.column,
      endLine: e.location.end?.line,
      endColumn: e.location.end?.column,
    });
  }
  throw e;
}
```

Import `DotSyntaxError` at top of file.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run src/attractor/tests/dot-syntax.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full attractor suite**

Run: `npx vitest run src/attractor`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/graph-ast.ts src/attractor/tests/dot-syntax.test.ts
git commit -m "feat(parser): throw DotSyntaxError with location on PEG failure"
```

---

## Chunk 3: Attach `location` to validator diagnostics

Goal: every zod + edge + node-level diagnostic carries `location` when one is available. Unrecognized-keys splits into one diagnostic per key.

### Task 3.1: Split unrecognized-keys per key + attach attr-location

**Files:**
- Modify: `src/attractor/core/schemas.ts:140-161` (`validateNode`)
- Modify: `src/attractor/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/attractor/tests/schemas.test.ts`:

```ts
it("emits one diagnostic per unknown key with attr-level location", () => {
  const node = {
    id: "x", type: "tool", cwd: "$project", toolCommand: "echo",
    badOne: 1, badTwo: 2,
    sourceLocation: { line: 10, column: 1 },
    attrLocations: {
      badOne: { line: 12, column: 3 },
      badTwo: { line: 13, column: 3 },
    },
  } as any;
  const diags = validateNode(node);
  expect(diags).toHaveLength(2);
  const locs = diags.map(d => d.location?.line).sort();
  expect(locs).toEqual([12, 13]);
  for (const d of diags) {
    expect(d.hint).toContain("Allowed keys for kind=tool");
  }
});
```

- [ ] **Step 2: Run — expect FAIL** (today emits one combined diagnostic)

Run: `npx vitest run src/attractor/tests/schemas.test.ts -t "per unknown key"`
Expected: FAIL.

- [ ] **Step 3: Update `validateNode`**

In the `result.error.issues.map` branch, handle `unrecognized_keys` specially: emit one diagnostic per key. For other codes, attach `location` using `issue.path[0]` lookup or node-level fallback.

```ts
if (result.success) return [];
const diags: Diagnostic[] = [];
for (const issue of result.error.issues) {
  if (issue.code === "unrecognized_keys") {
    const keys = (issue as { keys?: string[] }).keys ?? [];
    for (const key of keys) {
      const snake = camelToSnake(key);
      diags.push({
        rule: "schema_error",
        severity: "error",
        message: `[${node.id}]: unrecognized key '${snake}'`,
        hint: formatAllowedAttrs(kind),
        location: node.attrLocations?.[key] ?? node.sourceLocation,
      });
    }
    continue;
  }
  const path = issue.path.join(".");
  const loc = path ? camelToSnake(path) : "node";
  const firstPath = typeof issue.path[0] === "string" ? issue.path[0] : undefined;
  diags.push({
    rule: "schema_error",
    severity: "error",
    message: `[${node.id}] ${loc}: ${issue.message}`,
    location: (firstPath && node.attrLocations?.[firstPath]) ?? node.sourceLocation,
  });
}
return diags;
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: all green. Update any prior test that expected a single combined diagnostic — now one per key.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(validator): emit one diagnostic per unknown key with attr-level location"
```

### Task 3.2: Attach `location` to edge-rule diagnostics

**Files:**
- Modify: `src/attractor/core/graph.ts` (`edge_target_exists`, `edge_source_exists`, `condition_syntax`)
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("edge_target_exists carries edge sourceLocation", () => {
  const dot = `digraph g {\n  start [shape="Mdiamond"];\n  done [shape="Msquare"];\n  start -> missing;\n}`;
  const g = parseDot(dot);
  const diags = validateGraph(g);
  const d = diags.find(x => x.rule === "edge_target_exists");
  expect(d?.location?.line).toBe(4);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "edge_target_exists"`
Expected: FAIL.

- [ ] **Step 3: Attach `location` in edge-rule branches**

In `validateGraph` for each relevant `diags.push({...})` inside edge loops, add `location: e.sourceLocation`.

- [ ] **Step 4: Run full graph tests — expect green**

Run: `npx vitest run src/attractor/tests/graph.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat(validator): attach sourceLocation to edge-rule diagnostics"
```

### Task 3.3: Attach `location` to node-level diagnostics

**Files:**
- Modify: `src/attractor/core/graph.ts` (reachability, reaches_exit, start_no_incoming, exit_no_outgoing, variable_coverage, portability_heuristic, script_command_conflict, unsupported_script_extension, script_file_exists, inline_script_smell, type_known, type_unsupported)
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Write one representative failing test**

```ts
it("reachability diagnostic carries node sourceLocation", () => {
  const dot = `digraph g {\n  start [shape="Mdiamond"];\n  done [shape="Msquare"];\n  orphan [shape="box"];\n  start -> done;\n}`;
  const g = parseDot(dot);
  const diags = validateGraph(g);
  const d = diags.find(x => x.rule === "reachability");
  expect(d?.location?.line).toBe(4);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Wire `location: node.sourceLocation` at each node-rule `diags.push` call site**

Leave cardinality rules (`start_node`, `terminal_node`) without `location` — they do not bind to one node.

- [ ] **Step 4: Run full attractor suite**

Run: `npx vitest run src/attractor`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat(validator): attach sourceLocation to node-level diagnostics"
```

---

## Chunk 4: CLI renderer — header + code frame

Goal: `pipelineValidateCommand` prints `relpath:line:col` prefix and a source-frame caret for every diagnostic that has `location`. Syntax errors route through the same renderer.

### Task 4.1: `renderCodeFrame` pure function

**Files:**
- Create: `src/cli/lib/code-frame.ts`
- Create: `src/cli/tests/code-frame.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { renderCodeFrame } from "../lib/code-frame.js";

describe("renderCodeFrame", () => {
  const src = ["line1", "line2 bad", "line3", "line4"].join("\n");

  it("renders N lines before and after, gutter with numbers", () => {
    const out = renderCodeFrame(src, { line: 2, column: 7 }, { context: 1, color: false });
    expect(out).toContain("1 |");
    expect(out).toContain("2 |");
    expect(out).toContain("3 |");
    expect(out).not.toContain("4 |");
  });

  it("emits caret under the offending column", () => {
    const out = renderCodeFrame(src, { line: 2, column: 7 }, { context: 0, color: false });
    const lines = out.split("\n");
    const caretLine = lines.find(l => l.includes("^"));
    expect(caretLine).toBeDefined();
    const caretIdx = caretLine!.indexOf("^");
    const prevLine = lines[lines.indexOf(caretLine!) - 1];
    expect(prevLine.charAt(caretIdx)).toBe("b");
  });

  it("spans caret across endColumn when provided", () => {
    const out = renderCodeFrame(src, { line: 2, column: 7, endLine: 2, endColumn: 10 }, { context: 0, color: false });
    expect(out).toMatch(/\^{3}/);
  });

  it("clamps lines past EOF", () => {
    const out = renderCodeFrame(src, { line: 99, column: 1 }, { context: 0, color: false });
    expect(out).not.toContain("undefined");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `npx vitest run src/cli/tests/code-frame.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement renderer**

```ts
import type { SourceLocation } from "../../attractor/types.js";

interface Opts { context?: number; color?: boolean }

export function renderCodeFrame(source: string, loc: SourceLocation, opts: Opts = {}): string {
  const lines = source.split("\n");
  const context = opts.context ?? 2;
  const target = Math.min(loc.line, lines.length);
  const first = Math.max(1, target - context);
  const last  = Math.min(lines.length, target + context);
  const width = String(last).length;
  const out: string[] = [];
  for (let n = first; n <= last; n++) {
    const prefix = n === target ? "›" : " ";
    out.push(`${prefix} ${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
    if (n === target) {
      const col = Math.max(1, loc.column);
      const end = loc.endLine === loc.line && loc.endColumn ? loc.endColumn : col + 1;
      const span = Math.max(1, end - col);
      const gutter = `  ${" ".repeat(width)} | `;
      out.push(gutter + " ".repeat(col - 1) + "^".repeat(span));
    }
  }
  return out.join("\n");
}
```

(Ignore `opts.color` for now — no colors. Add later if needed.)

- [ ] **Step 4: Run tests — expect PASS**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/code-frame.test.ts`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/code-frame.ts src/cli/tests/code-frame.test.ts
git commit -m "feat(cli): add renderCodeFrame pure renderer"
```

### Task 4.2: Wire header + code-frame into `pipelineValidateCommand`

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [ ] **Step 1: Write the failing end-to-end test**

Add to `src/cli/tests/pipeline-validate.test.ts` (create if missing):

```ts
import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pipelineValidateCommand } from "../commands/pipeline.js";

describe("pipelineValidateCommand source frames", () => {
  it("prints relpath:line:col and a code frame for schema errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-val-"));
    const file = join(dir, "bad.dot");
    writeFileSync(file,
      `digraph g {\n  start [shape="Mdiamond"];\n  done [shape="Msquare"];\n  worker [type="tool",\n          cwd="$project",\n          bad_key="oops",\n          tool_command="echo"];\n  start -> worker -> done;\n}`,
    );
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m: string) => { errors.push(m); });
    await pipelineValidateCommand(file);
    const all = errors.join("\n");
    expect(all).toMatch(/bad\.dot:6:\d+/);
    expect(all).toContain("bad_key");
    expect(all).toContain("^");
  });
});
```

NOTE: adapt the stdout-capture strategy to whatever pattern existing `pipeline.test.ts` uses.

- [ ] **Step 2: Run — expect FAIL**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `pipelineValidateCommand`**

Before the diagnostic-emit loops, compute:

```ts
import { relative } from "path";
import { renderCodeFrame } from "../lib/code-frame.js";
// …
const relPath = relative(process.cwd(), absPath) || absPath;
```

Replace the `for (const w of warnings) { … }` and `for (const e of errors) { … }` blocks with a unified helper:

```ts
function formatDiag(d: Diagnostic): string {
  const loc = d.location ? `${relPath}:${d.location.line}:${d.location.column} ` : "";
  const hint = d.hint ? `\n${indentHint(d.hint)}` : "";
  const frame = d.location ? `\n${indentHint(renderCodeFrame(src, d.location, { context: 2, color: false }))}` : "";
  return `${loc}[${d.rule}] ${d.message}${hint}${frame}`;
}
for (const w of warnings) await output.warn(formatDiag(w));
for (const e of errors)   await output.error(formatDiag(e));
```

- [ ] **Step 4: Run the e2e test — expect PASS**

Run: `FORCE_COLOR=0 npx vitest run src/cli/tests/pipeline-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Smoke-check against a real pipeline**

Run: `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot`

Expected: exits 0 today (clean pipeline). Then temporarily add `bad_key="x"` to a node → expect `pipelines/illumination-to-implementation.dot:<line>:<col>` + caret. Revert the edit before committing.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/pipeline-validate.test.ts
git commit -m "feat(cli): render relpath:line:col + code frame for validate diagnostics"
```

### Task 4.3: Route syntax errors through the renderer

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("prints a [syntax] diagnostic with code frame for malformed DOT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ralph-val-"));
  const file = join(dir, "broken.dot");
  writeFileSync(file, `digraph g {\n  start [shape="Mdiamond"\n  done\n}`);
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((m: string) => { errors.push(m); });
  const code = await pipelineValidateCommand(file);
  expect(code).toBe(1);
  const all = errors.join("\n");
  expect(all).toMatch(/broken\.dot:\d+:\d+/);
  expect(all).toContain("[syntax]");
});
```

- [ ] **Step 2: Run — expect FAIL** (raw PEG error leaks)

- [ ] **Step 3: Catch `DotSyntaxError` around `parseDot`**

```ts
import { DotSyntaxError } from "../../attractor/core/dot-syntax.js";
// …
let graph: Graph;
try { graph = parseDot(src); }
catch (e) {
  if (e instanceof DotSyntaxError) {
    const diag: Diagnostic = {
      rule: "syntax",
      severity: "error",
      message: e.message,
      location: e.location,
    };
    await output.error(formatDiag(diag));
    return 1;
  }
  throw e;
}
```

Hoist `formatDiag` above the try/catch so both paths use it.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Run full CLI suite**

Run: `FORCE_COLOR=0 npx vitest run src/cli`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/pipeline-validate.test.ts
git commit -m "feat(cli): emit [syntax] diagnostic with code frame on malformed DOT"
```

---

## Chunk 5: Docs + version bump

### Task 5.1: Update design-spec status + cross-link

**Files:**
- Modify: `docs/superpowers/specs/2026-04-20-source-location-diagnostics-design.md` (flip status: design → shipped, add "shipped in v0.1.30")
- Modify: `docs/superpowers/specs/2026-04-20-dot-parser-ast-migration-design.md` (cross-link "cashes in" to this spec)

- [ ] **Step 1: Flip status** in the header: `status: shipped` + add shipping commit SHA.

- [ ] **Step 2: Add one-line back-reference** in the parser-migration spec under its success-criteria or trailing section.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-20-source-location-diagnostics-design.md docs/superpowers/specs/2026-04-20-dot-parser-ast-migration-design.md
git commit -m "docs: mark source-location spec shipped; cross-link from parser spec"
```

### Task 5.2: Verify full suite + version bump

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all green. If failing, fix before continuing.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 3: Bump version**

Edit `package.json`: `"version": "0.1.29"` → `"0.1.30"`.

- [ ] **Step 4: Commit and tag**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.1.30"
git tag v0.1.30
```

### Task 5.3: Write memory note

- [ ] **Step 1: Write** `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/2026-04-20-source-location-diagnostics-shipped.md` (project type memory, "Why" + "How to apply" lines).

- [ ] **Step 2: Append index entry** to `MEMORY.md`.

---

## Chunk 6: End-to-end verification across `pipelines/smoke/*.dot`

Goal: confirm the changes do not regress any existing smoke pipeline — validate-clean on all 14 dots, validate-with-error on a fixture, validate-syntax-error on a fixture, and runtime smoke via the tmux-drive harness on 2–3 representative dots to prove parser changes still produce a runnable graph.

**Prerequisites:**
- `npm run build` must have been run since the last code edit (Chunk 5 bumped version; the built `dist/` binary is what `ralph` resolves via `npm link`).
- Read `docs/harness/tmux-drive.md` *first* and source the bash block inside. All `start_run`, `wait_stable`, `capture`, `cleanup_run` helpers come from there. Do not invent tmux incantations — the document already accounts for nanosecond timing, atomic JSON updates, orphan recovery, focus.
- Work inside a fresh project sandbox (e.g. `~/tmp/ralph-smoke-<ts>/`) — the smoke dots use `$project` and should not touch the ralph-cli repo itself.

### Task 6.1: Validate-clean matrix across all smoke dots

**Files:**
- Read only: `pipelines/smoke/*.dot`

- [ ] **Step 1: Prepare sandbox**

```bash
SANDBOX=$(mktemp -d -t ralph-smoke-XXXXXX)
cd "$SANDBOX" && git init -q -b main
echo "# smoke sandbox" > README.md && git add . && git commit -q -m "init"
cd /Users/josu/Documents/projects/ralph-cli
```

- [ ] **Step 2: Run the matrix**

```bash
for f in pipelines/smoke/*.dot; do
  echo "=== $f ==="
  node dist/cli/index.js pipeline validate "$f" --project "$SANDBOX" && echo "  OK" || echo "  FAIL"
done
```

Expected: every pipeline prints `Pipeline valid (N nodes, M edges)` → `OK`. Zero `FAIL`.

(Note: `missing-caller-var.dot` is intentionally a negative-case fixture. If a pre-change run of this matrix showed it failing, preserve that — the goal is that post-change outcomes match pre-change outcomes, not that every dot passes.)

- [ ] **Step 3: Back-compat check — legacy `sourceLine` still populates**

```bash
node -e '
  const { parseDot } = require("./dist/attractor/core/graph.js");
  const fs = require("fs");
  const g = parseDot(fs.readFileSync("pipelines/smoke/tool.dot", "utf8"));
  const first = [...g.nodes.values()][0];
  if (typeof first.sourceLine !== "number") { console.error("FAIL sourceLine gone"); process.exit(1); }
  if (!first.sourceLocation || first.sourceLocation.line !== first.sourceLine) { console.error("FAIL mismatch"); process.exit(1); }
  console.log("OK sourceLine=" + first.sourceLine + " matches sourceLocation.line");
'
```

Expected: `OK sourceLine=N matches sourceLocation.line`. Guards the `@deprecated` back-compat field promise.

- [ ] **Step 4: Interpret failures**

If a pipeline that passed pre-change now fails, the change introduced a regression. Most likely cause: per-key-split of unrecognized-keys exposing a pre-existing issue that was previously collapsed into a single diagnostic. Verify by checking pre-change output (`git stash && rebuild && rerun`) before treating as a real regression.

- [ ] **Step 5: Record matrix output** to `~/.ralph/harness/validate-matrix-<ts>.txt` for the reviewer.

- [ ] **Step 6: Commit nothing** — this is a verification gate, not a code change.

### Task 6.2: Validate-with-schema-error fixture (includes multi-line-attr regression)

**Files:**
- Temporary fixture — do NOT commit edits to `pipelines/smoke/*.dot`.

- [ ] **Step 1: Prepare fixture with cleanup trap**

```bash
FIXTURE=$(mktemp -t ralph-smoke-bad.XXXXXX).dot
OUT=$(mktemp -t ralph-smoke-bad.XXXXXX).out
trap 'rm -f "$FIXTURE" "$OUT"' EXIT
cp pipelines/smoke/tool.dot "$FIXTURE"
```

- [ ] **Step 2: Inject a multi-line attr BEFORE the bad key, then the bad key**

This exercises spec §10 risk: multi-line quoted values must not shift subsequent line numbers. Edit `$FIXTURE`: on the first `type="tool"` node's attribute block, add these two lines *in order*:

```
          label="first\nsecond\nthird",
          bad_key="oops",
```

Note the 1-based source line where `bad_key="oops"` lives (call it `L`). Because `parseDotV2` pre-collapses newlines **inside** the quoted `label=` value, the reported line for `bad_key` must equal the *source* line, not a post-collapse offset.

- [ ] **Step 3: Run validate against the sandbox project**

```bash
node dist/cli/index.js pipeline validate "$FIXTURE" --project "$SANDBOX" 2>&1 | tee "$OUT"
```

- [ ] **Step 4: Assert on output**

Required substrings in `$OUT`:

- `$FIXTURE:<L>:` — the **source** line of `bad_key="oops"`, colon, column. Hard-coded `:<L>:` check, not a wildcard.
- `[schema_error]` — rule name.
- `unrecognized key 'bad_key'` — snake_case key name (per `feedback-validator-vocabulary.md`).
- `Allowed keys for kind=tool:` — hint block.
- A line containing `^` under the `bad_key` token.

Do not assert on the `label` line — it is valid on agent nodes only (`label` on tool may produce its own diagnostic; that's fine and orthogonal).

Fail the task if the `:<L>:` substring is missing — that means multi-line collapse leaked into positions.

- [ ] **Step 5: Cleanup**

Trap handles it automatically on shell exit; no manual rm required.

### Task 6.3: Validate-with-syntax-error fixture

- [ ] **Step 1: Prepare fixture with cleanup trap**

```bash
FIXTURE=$(mktemp -t ralph-smoke-syntax.XXXXXX).dot
OUT=$(mktemp -t ralph-smoke-syntax.XXXXXX).out
trap 'rm -f "$FIXTURE" "$OUT"' EXIT
cp pipelines/smoke/tool.dot "$FIXTURE"
```

- [ ] **Step 2: Break the dot**

Edit `$FIXTURE`: pick any node's attribute block and delete the closing `]`. Record the line number of the deleted bracket (call it `L`).

- [ ] **Step 3: Run validate**

```bash
node dist/cli/index.js pipeline validate "$FIXTURE" --project "$SANDBOX"; echo "exit=$?" > "$OUT"
node dist/cli/index.js pipeline validate "$FIXTURE" --project "$SANDBOX" 2>&1 >> "$OUT"
```

- [ ] **Step 4: Assert on output**

- Exit code recorded in `$OUT` is `1`.
- Output contains `[syntax]`.
- Output contains `$FIXTURE:<line>:<col>` where line is at or near `L`.
- Output does **not** contain `node_modules/@ts-graphviz` (no stack trace leak).
- Output contains at least one `^` caret.

- [ ] **Step 5: Cleanup** — trap handles it.

### Task 6.4: Runtime smoke via tmux-drive harness (agent-free dots only)

Goal: confirm that parser changes (new fields on `Node`/`Edge`, `applyStylesheet` preservation) did not break the runtime. **Only agent-free smoke dots are acceptable here** — agent nodes require a live Claude API session, introduce non-determinism, and are the wrong tool for a parser-regression smoke. `Grep "agent="` across `pipelines/smoke/*.dot` confirms 9 of 14 dots spawn agents. Usable candidates:

- `pipelines/smoke/tool.dot` — pure tool handler, minimum path.
- `pipelines/smoke/tool-runtime-vars.dot` — multi-node tool chain that exercises `$tool.output` propagation and multiple attribute-heavy nodes.
- `pipelines/smoke/store.dot` — `store` handler node, exercises a different handler type than `tool` to widen coverage.

**Conditional-edge coverage is left to the unit test at Task 3.2** (graph.test.ts `edge_target_exists` carries edge sourceLocation). There is no agent-free conditional smoke dot; adding runtime coverage for edge-condition routing is out of scope for this change.

**Success detection:** `pipeline run` does not emit a "pipeline complete" banner. It exits silently on success and prints `✗ pipeline failed at node …` to stderr on failure (`src/cli/commands/pipeline.ts:488`). The smoke assertion is therefore **negative**: after `wait_stable`, the capture must not contain `✗ pipeline failed`, and the run's JSONL trace must record that the exit (`Msquare`) node completed.

**Setup (do once before the three sub-tasks below):**

- [ ] **Step 0: Read harness doc + source the helper block**

```bash
$EDITOR /Users/josu/Documents/projects/ralph-cli/docs/harness/tmux-drive.md   # or: cat
# then source the full fenced bash block in your current shell so start_run, wait_stable, capture, cleanup_run are defined
```

Verify:
```bash
type start_run wait_stable capture cleanup_run
```
Expected: all four print `is a function`.

- [ ] **Step 0b: Reuse the `$SANDBOX` from Task 6.1**

If Chunk 6 is running end-to-end in one shell, `$SANDBOX` is already initialised. Otherwise:

```bash
SANDBOX=$(mktemp -d -t ralph-smoke-XXXXXX)
cd "$SANDBOX" && git init -q -b main
echo "# smoke sandbox" > README.md && git add . && git commit -q -m "init"
cd /Users/josu/Documents/projects/ralph-cli
```

Referenced as `$SANDBOX` in each sub-task below. Final step of Chunk 6 removes it (`rm -rf "$SANDBOX"`).

**Shared assertion helper** (paste once per shell):

```bash
assert_smoke_success() {
  local capture_file=$1
  if grep -F "✗ pipeline failed" "$capture_file"; then
    echo "FAIL: failure marker found in $capture_file"; return 1
  fi
  # Find the most-recent run's jsonl and confirm pipeline-end success.
  # Tracer schema (src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58):
  #   onPipelineEnd writes {"kind":"pipeline-end","runId":"...","outcome":"success"}
  local jsonl
  jsonl=$(ls -1t "$HOME/.ralph/runs"/*/pipeline.jsonl 2>/dev/null | head -1)
  if [ -z "$jsonl" ]; then echo "FAIL: no pipeline.jsonl found"; return 1; fi
  if ! grep -Fq '"kind":"pipeline-end"' "$jsonl"; then
    echo "FAIL: pipeline-end event missing in $jsonl"; return 1
  fi
  if ! grep -Fq '"outcome":"success"' "$jsonl"; then
    echo "FAIL: pipeline-end outcome was not success in $jsonl"; return 1
  fi
  echo "OK: pipeline-end success recorded in $jsonl"
}
```

#### Task 6.4.a: `tool.dot`

- [ ] **Step 1: Start the run**

```bash
start_run "node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js pipeline run /Users/josu/Documents/projects/ralph-cli/pipelines/smoke/tool.dot --project '$SANDBOX'" "smoke-tool"
```

- [ ] **Step 2: Wait for stability**

```bash
wait_stable 60000
```
Expected: returns 0 within 60s. (30s was too tight for cold-start subprocesses per reviewer.)

- [ ] **Step 3: Capture and assert**

```bash
capture "final"
assert_smoke_success "$RUN_DIR/captures/final.txt"
```
Expected: `OK: no failure marker, exit-node reached ...`.

- [ ] **Step 4: Cleanup**

```bash
cleanup_run
```

#### Task 6.4.b: `tool-runtime-vars.dot`

Multi-node tool chain; exercises attribute-heavy nodes after the parser change.

- [ ] Repeat the 4 steps from 6.4.a with:
  - `start_run "node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js pipeline run /Users/josu/Documents/projects/ralph-cli/pipelines/smoke/tool-runtime-vars.dot --project '$SANDBOX'" "smoke-tool-runtime-vars"`

#### Task 6.4.c: `store.dot`

Different handler kind (`store`); broadens coverage beyond `tool`.

- [ ] Repeat the 4 steps from 6.4.a with:
  - `start_run "node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js pipeline run /Users/josu/Documents/projects/ralph-cli/pipelines/smoke/store.dot --project '$SANDBOX'" "smoke-store"`

### Task 6.5: Record verification summary

- [ ] **Step 1: Write a short verification report**

Create `docs/superpowers/verifications/2026-04-20-source-location-smoke.md` with:
- Validate-clean matrix result per smoke dot (14 rows, all `OK`).
- Validate-schema-error fixture: `PASS` / `FAIL` + captured stdout snippet.
- Validate-syntax-error fixture: `PASS` / `FAIL` + captured stdout snippet.
- Runtime smoke: 3 rows (`tool`, `tool-runtime-vars`, `store`), each `PASS` / `FAIL` with capture reference.

- [ ] **Step 2: Commit the verification report**

```bash
git add docs/superpowers/verifications/2026-04-20-source-location-smoke.md
git commit -m "docs(verify): source-location diagnostics smoke report"
```

- [ ] **Step 3: Tear down sandbox**

```bash
rm -rf "$SANDBOX"
unset SANDBOX
```

**If any task in Chunk 6 fails:** do not claim the feature is shipped. Fix root cause, re-run the failing task, then rerun the tasks below it.

---

## Risks / follow-ups

- **Multi-line quoted values.** `parseDotV2` pre-collapses newlines inside quoted strings before PEG parsing. Line numbers reported for *subsequent* nodes must match the original source. Verify with a test that has a multi-line `model_stylesheet=` attr before a flagged node, and pin.
- **Snapshot fragility.** The e2e test asserts on substrings, not the full frame. If someone wants a golden file, use `expect(all).toMatchSnapshot()` — but prefer substring checks for resilience to cosmetic changes.
- **Columns on default attributes.** Attrs inherited from graph-wide `node [...]` defaults have no per-node position. `attrLocations` will be missing that key → validator falls back to `node.sourceLocation`. Document in inline comment where fallback happens.
- **Performance.** Splitting the source on every diagnostic render is O(N diagnostics × N lines). For the typical pipeline (≤50 lines, ≤10 diagnostics), noise. If validate ever becomes a bottleneck, memoize `source.split("\n")` once per command invocation.
