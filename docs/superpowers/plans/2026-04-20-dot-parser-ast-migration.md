---
status: implemented
---

# DOT Parser AST Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the regex-driven `parseDot()` in `src/attractor/core/graph.ts` with an AST-based parser (`parseDotV2`) built on `@ts-graphviz/ast`, so that every `Node` carries `sourceLine` and future diagnostics can reference `file:line:col`.

**Architecture:** New module `graph-ast.ts` walks `@ts-graphviz/ast`'s AST → existing `Graph` shape. Shared helpers extracted to `dot-common.ts`. Dual-run test asserts `parseDot ≡ parseDotV2` across all 19 pipelines. Once green, `parseDot` becomes a thin re-export of `parseDotV2` and the regex helpers are deleted.

**Tech Stack:** TypeScript, zod, `@ts-graphviz/ast ^3.0.6` (already installed), vitest.

**Reference:** `docs/superpowers/specs/2026-04-20-dot-parser-ast-migration-design.md`

**Pre-flight notes for the engineer:**
- `@ts-graphviz/ast` probe results: 19/19 pipelines parse clean; every AST node exposes `{start,end}` location with `{offset, line, column}`; 468 KB install, zero transitive deps.
- AST shape cheat-sheet (confirmed by probe):
  - Root `Dot.children = [Graph, …]`
  - `Graph.children` is a union of `Attribute | AttributeList | Node | Edge | Subgraph`
  - `Attribute.key.value`, `Attribute.value.value`, `Attribute.value.quoted`
  - `AttributeList.kind` is `"Node"` / `"Edge"` / `"Graph"` for default blocks
  - `Edge.targets: NodeRef[]` (chained edges → multiple targets). `Edge.children: Attribute[]`
  - Escape sequences come through RAW (`\n` stays literal). Keep using `unescapeDotString`.
- Read `src/attractor/core/graph.ts:116-223` to understand what shape the legacy parser produces; your AST walker must produce the same `Graph` object modulo new `sourceLine` field.
- **@superpowers:test-driven-development** is non-negotiable for every task below: write the failing test, run it (confirm it fails for the right reason), then implement, then commit.

---

## Chunk 1: Extract shared helpers

Goal: factor the pure helpers out of `graph.ts` into `dot-common.ts` so both parsers can share them with zero duplication. No behavior change expected — all 968 tests must stay green after this chunk.

### Task 1.1: Create `dot-common.ts` with extracted helpers

**Files:**
- Create: `src/attractor/core/dot-common.ts`
- Modify: `src/attractor/core/graph.ts:7-55` (delete helpers, import instead)
- Modify: `src/attractor/core/graph.ts:57-100` (delete `parseStylesheet` + `applyStylesheet`, import)
- Modify: `src/attractor/core/graph.ts:102-114` (delete `parseInputsAttr`, import)

- [ ] **Step 1: Write a smoke test for the new module**

Create `src/attractor/tests/dot-common.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toCamel,
  coerceValue,
  unescapeDotString,
  parseStylesheet,
  applyStylesheet,
  parseInputsAttr,
} from "../core/dot-common.js";

describe("dot-common helpers", () => {
  it("toCamel converts snake_case", () => {
    expect(toCamel("tool_command")).toBe("toolCommand");
    expect(toCamel("max_retries")).toBe("maxRetries");
    expect(toCamel("id")).toBe("id");
  });

  it("coerceValue infers types", () => {
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("false")).toBe(false);
    expect(coerceValue("42")).toBe(42);
    expect(coerceValue("hello")).toBe("hello");
  });

  it("unescapeDotString handles DOT escapes", () => {
    expect(unescapeDotString("a\\nb")).toBe("a\nb");
    expect(unescapeDotString('say \\"hi\\"')).toBe('say "hi"');
  });

  it("parseInputsAttr splits + dedupes", () => {
    expect(parseInputsAttr("a, b,  a , c")).toEqual(["a", "b", "c"]);
    expect(parseInputsAttr("")).toBeUndefined();
    expect(parseInputsAttr(123)).toBeUndefined();
  });

  it("parseStylesheet + applyStylesheet work round-trip", () => {
    const rules = parseStylesheet(".archived { color: gray; } * { font: mono; }");
    const node = { id: "n", class: "archived" } as any;
    const styled = applyStylesheet(node, rules);
    expect(styled.color).toBe("gray");
    expect(styled.font).toBe("mono");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/dot-common.test.ts`
Expected: FAIL with "Cannot find module '../core/dot-common.js'"

- [ ] **Step 3: Create `dot-common.ts` by copying helpers verbatim from `graph.ts`**

Copy into `src/attractor/core/dot-common.ts`:
- `toCamel` (lines 7-9)
- `coerceValue` (lines 12-19)
- `unescapeDotString` (lines 28-40)
- `parseStylesheet` (lines 57-80)
- `applyStylesheet` (lines 82-100)
- `parseInputsAttr` (lines 102-114)

Add `export` to each. Do NOT copy `stripComments`, `parseAttrs`, `parseDot` — those stay in `graph.ts` for now.

Add top-level import for any internal cross-reference (none — these are all leaves).

- [ ] **Step 4: Run dot-common test to verify it passes**

Run: `npx vitest run src/attractor/tests/dot-common.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Replace helpers in `graph.ts` with imports**

At top of `graph.ts`:
```ts
import {
  toCamel,
  coerceValue,
  unescapeDotString,
  parseStylesheet,
  applyStylesheet,
  parseInputsAttr,
} from "./dot-common.js";
```

Delete the in-file definitions (lines 7-19, 28-40, 57-80, 82-100, 102-114).

Keep `stripComments` (lines 22-26) and `parseAttrs` (lines 43-55) in `graph.ts` — regex-specific.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: PASS, 968/968

- [ ] **Step 7: Commit**

```bash
git add src/attractor/core/dot-common.ts src/attractor/core/graph.ts src/attractor/tests/dot-common.test.ts
git commit -m "refactor(graph): extract pure helpers to dot-common.ts"
```

---

## Chunk 2: Write `parseDotV2` and dual-run safety net

Goal: AST-based parser that produces identical `Graph` to legacy `parseDot` for every pipeline we have, plus the one new field `sourceLine` on every `Node`.

### Task 2.1: Add `sourceLine` to `Node` type

**Files:**
- Modify: `src/attractor/types.ts:12-35`

- [ ] **Step 1: Extend `Node` interface**

```ts
export interface Node {
  id: string;
  shape?: string;
  // … existing fields unchanged …
  /** 1-based line in the source .dot file where this node was declared. */
  sourceLine?: number;
  [key: string]: unknown;
}
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: PASS 968/968 (field is optional, no change in behavior).

- [ ] **Step 3: Commit**

```bash
git add src/attractor/types.ts
git commit -m "types(node): add optional sourceLine field for AST-parser"
```

### Task 2.2: Scaffold `parseDotV2` + write a minimal test

**Files:**
- Create: `src/attractor/core/graph-ast.ts`
- Create: `src/attractor/tests/graph-ast.test.ts`

- [ ] **Step 1: Write the failing test (minimal graph)**

Create `src/attractor/tests/graph-ast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDotV2 } from "../core/graph-ast.js";

describe("parseDotV2 — minimal", () => {
  it("parses a single-node graph", () => {
    const g = parseDotV2(`digraph foo { start [shape=Mdiamond] }`);
    expect(g.name).toBe("foo");
    expect(g.nodes.size).toBe(1);
    expect(g.nodes.get("start")?.shape).toBe("Mdiamond");
  });

  it("records sourceLine on each node", () => {
    const g = parseDotV2(`digraph foo {
  start [shape=Mdiamond]
  done [shape=Msquare]
}`);
    expect(g.nodes.get("start")?.sourceLine).toBe(2);
    expect(g.nodes.get("done")?.sourceLine).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts`
Expected: FAIL "Cannot find module '../core/graph-ast.js'"

- [ ] **Step 3: Implement minimal `parseDotV2`**

Create `src/attractor/core/graph-ast.ts`:

```ts
import { parse as parseAST } from "@ts-graphviz/ast";
import type { Graph, Node, Edge } from "../types.js";
import {
  toCamel,
  coerceValue,
  unescapeDotString,
  parseStylesheet,
  applyStylesheet,
  parseInputsAttr,
} from "./dot-common.js";

// The @ts-graphviz/ast types aren't re-exported conveniently; we use `any`
// for AST nodes and rely on the shape documented in the design spec.
type AttrMap = Record<string, unknown>;

function readAttrs(children: any[]): AttrMap {
  const out: AttrMap = {};
  for (const c of children) {
    if (c.type !== "Attribute") continue;
    const key = toCamel(c.key.value);
    const raw = c.value.quoted ? unescapeDotString(c.value.value) : c.value.value;
    out[key] = c.value.quoted ? raw : coerceValue(raw);
  }
  return out;
}

export function parseDotV2(src: string): Graph {
  const ast = parseAST(src);
  const root = ast.children.find((c: any) => c.type === "Graph");
  if (!root) {
    return { name: "unnamed", nodes: new Map(), edges: [] };
  }
  const name = root.id?.value ?? "unnamed";

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const graphAttrs: AttrMap = {};
  let nodeDefaults: AttrMap = {};
  let edgeDefaults: AttrMap = {};

  function walk(container: any) {
    for (const child of container.children ?? []) {
      switch (child.type) {
        case "Attribute": {
          const key = toCamel(child.key.value);
          const raw = child.value.quoted
            ? unescapeDotString(child.value.value)
            : child.value.value;
          graphAttrs[key] = child.value.quoted ? raw : coerceValue(raw);
          break;
        }
        case "AttributeList": {
          const attrs = readAttrs(child.children);
          if (child.kind === "Node") nodeDefaults = { ...nodeDefaults, ...attrs };
          else if (child.kind === "Edge") edgeDefaults = { ...edgeDefaults, ...attrs };
          else Object.assign(graphAttrs, attrs);
          break;
        }
        case "Node": {
          const id = child.id.value;
          const attrs = { ...nodeDefaults, ...readAttrs(child.children) };
          nodes.set(id, {
            id,
            ...attrs,
            sourceLine: child.location?.start.line,
          } as Node);
          break;
        }
        case "Edge": {
          const attrs = { ...edgeDefaults, ...readAttrs(child.children) };
          const targets = child.targets.map((t: any) => t.id.value);
          for (let i = 0; i < targets.length - 1; i++) {
            edges.push({ from: targets[i], to: targets[i + 1], ...attrs } as Edge);
          }
          break;
        }
        case "Subgraph":
          walk(child); // flatten: subgraph body contributes to outer scope
          break;
      }
    }
  }
  walk(root);

  const stylesheet = (graphAttrs["modelStylesheet"] as string) ?? "";
  const rules = stylesheet ? parseStylesheet(stylesheet) : [];
  if (rules.length > 0) {
    for (const [id, node] of nodes) {
      nodes.set(id, applyStylesheet(node, rules));
    }
  }

  return {
    name,
    goal: graphAttrs["goal"] as string | undefined,
    label: graphAttrs["label"] as string | undefined,
    modelStylesheet: stylesheet || undefined,
    defaultMaxRetries: graphAttrs["defaultMaxRetries"] as number | undefined,
    defaultFidelity: graphAttrs["defaultFidelity"] as string | undefined,
    maxParallel: graphAttrs["maxParallel"] as number | undefined,
    retryTarget: graphAttrs["retryTarget"] as string | undefined,
    fallbackRetryTarget: graphAttrs["fallbackRetryTarget"] as string | undefined,
    headlessSafe: graphAttrs["headlessSafe"] as boolean | undefined,
    inputs: parseInputsAttr(graphAttrs["inputs"]),
    nodes,
    edges,
  };
}
```

**Note:** `applyStylesheet` in `dot-common.ts` uses `{ ...resolved, ...node }` — this means explicit node attrs win over stylesheet. Preserve that; legacy parser does the same.

- [ ] **Step 4: Run minimal test to verify PASS**

Run: `npx vitest run src/attractor/tests/graph-ast.test.ts`
Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/graph-ast.ts src/attractor/tests/graph-ast.test.ts
git commit -m "feat(graph): add AST-based parseDotV2 with sourceLine"
```

### Task 2.3: Dual-run test across all 19 pipelines

**Files:**
- Create: `src/attractor/tests/dual-parser.test.ts`

- [ ] **Step 1: Write the dual-run test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { parseDotV2 } from "../core/graph-ast.js";
import type { Graph, Node } from "../types.js";

function collectPipelines(): string[] {
  const out: string[] = [];
  const roots = ["pipelines", "pipelines/smoke"];
  for (const r of roots) {
    for (const name of readdirSync(r)) {
      const p = join(r, name);
      if (name.endsWith(".dot") && statSync(p).isFile()) out.push(p);
    }
  }
  return out;
}

function stripSourceLine(n: Node): Node {
  const { sourceLine, ...rest } = n;
  return rest as Node;
}

function graphEquiv(a: Graph, b: Graph) {
  expect(b.name).toBe(a.name);
  expect(b.goal).toEqual(a.goal);
  expect(b.label).toEqual(a.label);
  expect(b.modelStylesheet).toEqual(a.modelStylesheet);
  expect(b.inputs).toEqual(a.inputs);
  expect(b.defaultMaxRetries).toEqual(a.defaultMaxRetries);
  expect(b.defaultFidelity).toEqual(a.defaultFidelity);
  expect(b.maxParallel).toEqual(a.maxParallel);
  expect(b.retryTarget).toEqual(a.retryTarget);
  expect(b.fallbackRetryTarget).toEqual(a.fallbackRetryTarget);
  expect(b.headlessSafe).toEqual(a.headlessSafe);

  const aKeys = [...a.nodes.keys()].sort();
  const bKeys = [...b.nodes.keys()].sort();
  expect(bKeys).toEqual(aKeys);
  for (const k of aKeys) {
    expect(stripSourceLine(b.nodes.get(k)!))
      .toEqual(stripSourceLine(a.nodes.get(k)!));
  }

  expect(b.edges.length).toBe(a.edges.length);
  for (let i = 0; i < a.edges.length; i++) {
    expect(b.edges[i]).toEqual(a.edges[i]);
  }
}

describe("parseDot ≡ parseDotV2 across fixtures", () => {
  const files = collectPipelines();
  it.each(files)("%s produces equivalent Graph", (file) => {
    const src = readFileSync(file, "utf8");
    const g1 = parseDot(src);
    const g2 = parseDotV2(src);
    graphEquiv(g1, g2);
  });

  it("parseDotV2 records sourceLine on every node", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const g = parseDotV2(src);
      for (const [id, n] of g.nodes) {
        expect(n.sourceLine, `${file}: node ${id} missing sourceLine`)
          .toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it — expect either pass or targeted failures**

Run: `npx vitest run src/attractor/tests/dual-parser.test.ts`

Three possible outcomes:
1. **All green** → proceed to Task 2.4.
2. **Some pipelines diverge** → investigate each divergence. Usually one of:
   - Missing graph-attr handling in `parseDotV2`'s `walk()` (add to switch).
   - Edge attribute expansion order differs — check `Edge.targets` iteration.
   - Stylesheet application order differs — should not, we reuse `applyStylesheet`.
3. **`parseDotV2` crashes** → read stack, likely a null-safe access needed on `child.id?.value`.

Fix divergences one by one, re-running until green. Do **not** change `parseDot` to match `parseDotV2` — the legacy parser is the oracle. Adjust `parseDotV2` to match it.

- [ ] **Step 3: Commit when green**

```bash
git add src/attractor/tests/dual-parser.test.ts
git commit -m "test(graph): dual-run parseDot ≡ parseDotV2 across 19 pipelines"
```

### Task 2.4: Full test suite green-check

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS 968 + new dual-run tests + new dot-common tests + new graph-ast tests. No regressions.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: success. Note size of `dist/cli/index.js`; compare against pre-migration size (commit `55aff7c` has baseline). Assert <100 KB growth.

- [ ] **Step 3: Commit if anything fixed en route** (otherwise skip)

---

## Chunk 3: Flip the switch

Goal: make `parseDot` internally delegate to `parseDotV2`. Keep the `parseDot` export stable so no downstream code changes. After one clean cycle we'll delete the regex body.

### Task 3.1: Redirect `parseDot` to `parseDotV2`

**Files:**
- Modify: `src/attractor/core/graph.ts:116-223`

- [ ] **Step 1: Before touching, capture baseline**

Run: `npx vitest run 2>&1 | tail -3`
Expected: all tests green. Record count (e.g. `Tests 968 passed`).

- [ ] **Step 2: Replace `parseDot` body**

In `graph.ts`, replace the entire function body (lines 116-223) with a delegation:

```ts
import { parseDotV2 } from "./graph-ast.js";

export function parseDot(src: string): Graph {
  return parseDotV2(src);
}
```

Delete the now-orphaned helpers in `graph.ts`:
- `stripComments` (lines 22-26)
- `parseAttrs` (lines 43-55)

Leave the rest of the file (`validateGraph`, `validateOrRaise`, etc.) untouched.

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: PASS (same count as baseline, possibly +1 for dual-run now passing with identity).

**If any test fails**, it means `parseDotV2` still has a divergence not caught by dual-run fixtures. Fix the divergence and re-run; do NOT revert the delegation.

- [ ] **Step 4: Live-run validate on an existing pipeline**

Run:
```bash
npm run build && ralph pipeline validate pipelines/smoke/gate.dot
```
Expected: `✔ Pipeline valid (5 nodes, 5 edges)` (or equivalent success message).

- [ ] **Step 5: Live-run the actual failing pipeline**

Run: `ralph pipeline validate pipelines/illumination-to-implementation.dot`
Expected: same `schema_error` output as before the migration (content unchanged — this plan doesn't touch the diagnostic formatter).

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/graph.ts
git commit -m "feat(graph): parseDot now delegates to parseDotV2 (AST-based)"
```

### Task 3.2: Simplify dual-run test to identity assertion

**Files:**
- Modify: `src/attractor/tests/dual-parser.test.ts`

After Chunk 3 Task 3.1, the dual-run test is now comparing `parseDotV2` against itself (since `parseDot === parseDotV2`). Keep the test but relabel it as a regression guard.

- [ ] **Step 1: Update test description**

Change the `describe()` block to:
```ts
describe("parseDot fixture regression (AST parser)", () => {
```

Comment at the top:
```ts
// This test was originally a dual-run check (parseDot ≡ parseDotV2) during
// the migration. Now that parseDot delegates to parseDotV2, it serves as a
// fixture snapshot: every .dot in pipelines/ must continue to parse with the
// same Graph shape. If this test fails after a parser change, a pipeline's
// semantics changed silently — review the diff carefully.
```

- [ ] **Step 2: Commit**

```bash
git add src/attractor/tests/dual-parser.test.ts
git commit -m "test(graph): relabel dual-run test as fixture regression guard"
```

### Task 3.3: Smoke-test the full pipeline runtime

- [ ] **Step 1: Run one smoke pipeline end-to-end**

From the repo root:
```bash
npm run build
ralph pipeline run pipelines/smoke/gate.dot --var project=/tmp/ralph-smoke-$(date +%s) 2>&1 | head -60
```
Expected: pipeline starts executing. Validates, graph loads, first node fires. Kill after confirming startup (Ctrl-C).

If startup fails with an error not seen before migration, investigate — the engine might rely on some Node attr our AST parser didn't emit.

- [ ] **Step 2: Run scenario tests**

Run: `ls scenario-tests/ 2>/dev/null` — if present, run one that exercises pipelines:
```bash
bash scenario-tests/pipeline-validate.sh  # or whichever exists
```

- [ ] **Step 3: No commit** (verification step only).

---

## Chunk 4: Ship + clean up

### Task 4.1: Bump version + update CHANGELOG or memory entry

**Files:**
- Modify: `package.json` (bump patch)
- Optional: write memory file documenting the migration

- [ ] **Step 1: Bump version**

Edit `package.json`, increment `version` by patch (e.g. `0.1.2` → `0.1.3`).

- [ ] **Step 2: Write memory file**

Create `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/2026-04-20-dot-parser-ast-migration.md`:

```markdown
---
name: DOT parser migrated to @ts-graphviz/ast
description: parseDot internally uses AST parser; every Node now carries sourceLine. Enables file:line in future diagnostics.
type: project
---

Migrated `src/attractor/core/graph.ts` `parseDot` from regex chain to AST-based `parseDotV2` (`src/attractor/core/graph-ast.ts`).

**Why:** regex parser detached source positions during string mutation, blocking file:line in schema_error diagnostics. AST parser preserves `location: {start, end}` on every AST node including `Attribute`.

**How to apply:** next time someone edits parser code, the oracle is `parseDotV2`. Legacy regex helpers deleted. If adding new DOT syntax support, extend the `walk()` switch in `graph-ast.ts` and add a fixture pipeline to catch regressions via `dual-parser.test.ts`.

Shared pure helpers live in `src/attractor/core/dot-common.ts`.
```

Add an index line to `MEMORY.md`:

```markdown
| 2026-04-20 | DOT Parser AST Migration (parseDot delegates to @ts-graphviz/ast) | [→ File](2026-04-20-dot-parser-ast-migration.md) |
```

- [ ] **Step 3: Commit**

```bash
git add package.json /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/
git commit -m "chore: bump version for AST parser migration + memory note"
```

### Task 4.2: Request code review

- [ ] **Step 1: Invoke @superpowers:requesting-code-review**

Dispatch the review against the full diff on this branch vs `main`. Flag for the reviewer:
- Parser migration is the load-bearing change
- Dual-run regression test is the safety net
- No diagnostic-output changes in this plan (follow-up)

- [ ] **Step 2: Address feedback**

Per @superpowers:receiving-code-review, evaluate each comment on technical merit; don't perform-agree. Re-run full test suite after any code change.

### Task 4.3: Finish the branch

- [ ] **Step 1: Final verification per @superpowers:verification-before-completion**

Run these before declaring done:
```bash
npx vitest run                                                  # 968+ green
npm run build                                                   # success
ralph pipeline validate pipelines/illumination-to-implementation.dot  # schema_error as expected
ralph pipeline validate pipelines/smoke/gate.dot                # valid
```

Paste the actual output of each command into the completion message. Assertions without evidence are not enough.

- [ ] **Step 2: Use @superpowers:finishing-a-development-branch**

Invoke the skill to present the merge/PR/cleanup choice.

---

## Out of scope (follow-up plans)

- Diagnostic output improvements: `file:line:col` prefix, fuzzy "did you mean", `--verbose` allowed-keys table, grouped-by-node formatting. New plan: `2026-04-20-validate-diagnostic-ergonomics.md`.
- AST-based `ralph pipeline refine` that edits the AST instead of rewriting the `.dot` file. Substantial follow-up.
- `ralph pipeline schema [kind]` command (prints allowed keys with descriptions).
