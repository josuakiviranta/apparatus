---
status: implemented
---

# Pipeline Validator Trust Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ralph pipeline validate` trustworthy enough to catch the three failure classes that currently leak through to runtime (unknown attrs, missing `$project` binding, implicit tool cwd).

**Architecture:** Add zod-based per-node schemas as a new layer inside `validateGraph()`, require explicit `cwd=` on every tool node, and add a `$project` preflight to `pipelineRunCommand`. Existing `Diagnostic{rule,severity,message}` error surface is preserved — zod failures are converted to Diagnostics with new `schema_error` rule.

**Tech Stack:** TypeScript, zod ^3.25.76 (already in deps), vitest, Commander-based CLI.

**Spec:** `docs/superpowers/specs/2026-04-18-pipeline-validator-trust-upgrade-design.md`

---

## File Structure

**New:**
- `src/attractor/core/schemas.ts` — zod schemas, `classifyNode`, `validateNode`
- `src/attractor/tests/schemas.test.ts` — schema unit tests
- `src/cli/tests/pipeline-run-preflight.test.ts` — preflight rule tests
- `scripts/audit-tool-nodes.mjs` — one-off migration helper, not shipped
- `src/attractor/tests/fixtures/pre-migration-tool-node.dot` — regression fixture

**Modified:**
- `src/attractor/core/graph.ts` — call `validateNode` inside `validateGraph`, emit `schema_error` Diagnostics
- `src/attractor/handlers/tool.ts` — pass `cwd` to both `spawnSync` sites; drop dead guards
- `src/attractor/transforms/variable-expansion.ts` — add `"cwd"` to `STRING_ATTRS`
- `src/cli/commands/pipeline.ts` — `$project` preflight in `pipelineRunCommand`
- `src/attractor/tests/graph.test.ts` — extended schema_error tests
- `src/attractor/tests/tool-handler.test.ts` — extended cwd assertions (create if absent)
- `pipelines/illumination-to-implementation.dot` — add `cwd` on 3 tool nodes; strip `cd $project &&` from commit_push
- `pipelines/illumination-to-plan.dot` — add `cwd` on delete_file
- `pipelines/smoke/tmux-tester.dot` — add `cwd` on launch_tmux
- `pipelines/smoke/tool-runtime-vars.dot` — add `cwd` on delete_file
- `README.md` — document `cwd=` on tool nodes and `--project` preflight
- `specs/commands.md` — same doc update
- `src/cli/commands/pipeline.ts` `composeCreatePrompt` — tell authoring agent to declare `cwd`

---

## Chunk 1: Zod schemas module (new, not yet wired)

Writes the zod layer as a standalone module with its own tests. Not yet called from `validateGraph`, so the existing validator keeps passing.

### Task 1.1: Skeleton + BaseNodeSchema

**Files:**
- Create: `src/attractor/core/schemas.ts`
- Create: `src/attractor/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/attractor/tests/schemas.test.ts
import { describe, it, expect } from "vitest";
import { BaseNodeSchema } from "../core/schemas.js";

describe("BaseNodeSchema", () => {
  it("accepts a node with only id", () => {
    const result = BaseNodeSchema.safeParse({ id: "n1" });
    expect(result.success).toBe(true);
  });

  it("rejects unknown attributes", () => {
    const result = BaseNodeSchema.safeParse({ id: "n1", tool_commnd: "x" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: FAIL — cannot find module `../core/schemas.js`.

- [ ] **Step 3: Create schemas.ts skeleton**

```ts
// src/attractor/core/schemas.ts
import { z } from "zod";

export const BaseNodeSchema = z.object({
  id: z.string(),
  shape: z.string().optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  class: z.string().optional(),
}).strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): add BaseNodeSchema with strict mode"
```

### Task 1.2: AgentNodeSchema with default_* allowlist

Known `default_*` keys (camelCased): `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary`.

**Files:**
- Modify: `src/attractor/core/schemas.ts`
- Modify: `src/attractor/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/attractor/tests/schemas.test.ts
import { AgentNodeSchema } from "../core/schemas.js";

describe("AgentNodeSchema", () => {
  it("accepts a minimal agent node", () => {
    const r = AgentNodeSchema.safeParse({
      id: "n1",
      agent: "implement",
      prompt: "do thing",
    });
    expect(r.success).toBe(true);
  });

  it("coerces maxRetries string to number", () => {
    const r = AgentNodeSchema.safeParse({
      id: "n1", agent: "implement", prompt: "p", maxRetries: "2",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.maxRetries).toBe(2);
  });

  it("accepts all four default_* attributes", () => {
    const r = AgentNodeSchema.safeParse({
      id: "n1", agent: "implement", prompt: "p",
      defaultRefinements: "", defaultChatNotesPath: "",
      defaultTestResult: "", defaultTestSummary: "",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown attribute (strict)", () => {
    const r = AgentNodeSchema.safeParse({
      id: "n1", agent: "implement", prompt: "p", promt: "typo",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: FAIL — `AgentNodeSchema` is not exported.

- [ ] **Step 3: Add AgentNodeSchema**

```ts
// in src/attractor/core/schemas.ts, after BaseNodeSchema
export const AgentNodeSchema = BaseNodeSchema.extend({
  agent: z.string(),
  prompt: z.string(),
  jsonSchemaFile: z.string().optional(),
  produces: z.string().optional(),
  maxRetries: z.coerce.number().int().nonnegative().optional(),
  retryTarget: z.string().optional(),
  fallbackRetryTarget: z.string().optional(),
  interactive: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
  goalGate: z.boolean().optional(),
  loopRestart: z.boolean().optional(),
  fidelity: z.string().optional(),
  threadId: z.string().optional(),
  llmModel: z.string().optional(),
  llmProvider: z.string().optional(),
  reasoningEffort: z.string().optional(),
  maxIterations: z.union([z.number(), z.string()]).optional(),
  defaultRefinements: z.string().optional(),
  defaultChatNotesPath: z.string().optional(),
  defaultTestResult: z.string().optional(),
  defaultTestSummary: z.string().optional(),
}).strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): add AgentNodeSchema with default_* allowlist"
```

### Task 1.3: ToolNodeSchema with required cwd + XOR refinement

**Files:**
- Modify: `src/attractor/core/schemas.ts`
- Modify: `src/attractor/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append
import { ToolNodeSchema } from "../core/schemas.js";

describe("ToolNodeSchema", () => {
  const base = { id: "n1", type: "tool", cwd: "$project" } as const;

  it("requires cwd", () => {
    const { cwd, ...no_cwd } = base;
    const r = ToolNodeSchema.safeParse({ ...no_cwd, toolCommand: "echo" });
    expect(r.success).toBe(false);
  });

  it("requires cwd to be non-empty", () => {
    const r = ToolNodeSchema.safeParse({ ...base, cwd: "", toolCommand: "echo" });
    expect(r.success).toBe(false);
  });

  it("accepts toolCommand only", () => {
    const r = ToolNodeSchema.safeParse({ ...base, toolCommand: "echo hi" });
    expect(r.success).toBe(true);
  });

  it("accepts scriptFile only", () => {
    const r = ToolNodeSchema.safeParse({ ...base, scriptFile: "scripts/x.mjs" });
    expect(r.success).toBe(true);
  });

  it("rejects both toolCommand and scriptFile (script_command_conflict)", () => {
    const r = ToolNodeSchema.safeParse({
      ...base, toolCommand: "echo", scriptFile: "s.mjs",
    });
    expect(r.success).toBe(false);
  });

  it("rejects neither toolCommand nor scriptFile", () => {
    const r = ToolNodeSchema.safeParse({ ...base });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: FAIL — `ToolNodeSchema` not exported.

- [ ] **Step 3: Add ToolNodeSchema**

```ts
// in src/attractor/core/schemas.ts
export const ToolNodeSchema = BaseNodeSchema.extend({
  type: z.literal("tool"),
  cwd: z.string().min(1),
  toolCommand: z.string().optional(),
  scriptFile: z.string().optional(),
  scriptArgs: z.string().optional(),
  producesFromStdout: z.union([z.boolean(), z.literal("true")]).optional(),
  produces: z.string().optional(),
}).strict()
  .refine(n => !(n.toolCommand && n.scriptFile), {
    message: "script_command_conflict: toolCommand and scriptFile are mutually exclusive",
  })
  .refine(n => n.toolCommand || n.scriptFile, {
    message: "tool_node_needs_command_or_script",
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS (12 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): add ToolNodeSchema with required cwd"
```

### Task 1.4: GateNodeSchema + Start/Exit

**Files:**
- Modify: `src/attractor/core/schemas.ts`
- Modify: `src/attractor/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append
import { GateNodeSchema, StartNodeSchema, ExitNodeSchema } from "../core/schemas.js";

describe("GateNodeSchema", () => {
  it("requires label", () => {
    const r = GateNodeSchema.safeParse({ id: "g1", shape: "hexagon" });
    expect(r.success).toBe(false);
  });
  it("accepts hexagon with label", () => {
    const r = GateNodeSchema.safeParse({ id: "g1", shape: "hexagon", label: "Approve?" });
    expect(r.success).toBe(true);
  });
});

describe("StartNodeSchema / ExitNodeSchema", () => {
  it("StartNodeSchema accepts Mdiamond", () => {
    const r = StartNodeSchema.safeParse({ id: "start", shape: "Mdiamond" });
    expect(r.success).toBe(true);
  });
  it("ExitNodeSchema accepts Msquare", () => {
    const r = ExitNodeSchema.safeParse({ id: "done", shape: "Msquare" });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Add schemas**

```ts
// in src/attractor/core/schemas.ts
export const GateNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("hexagon"),
  label: z.string().min(1),
  defaultRefinements: z.string().optional(),
}).strict();

export const StartNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("Mdiamond"),
}).strict();

export const ExitNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("Msquare"),
}).strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS (16 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): add GateNodeSchema, StartNodeSchema, ExitNodeSchema"
```

### Task 1.5: classifyNode + validateNode

`classifyNode` picks the right schema for an arbitrary node by inspecting its attrs. `validateNode` runs the matching schema and returns `Diagnostic[]` in the existing shape (see `graph.ts` `Diagnostic{rule,severity,message}`).

**Files:**
- Modify: `src/attractor/core/schemas.ts`
- Modify: `src/attractor/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// append
import { classifyNode, validateNode } from "../core/schemas.js";
import type { Node } from "../types.js";

describe("classifyNode", () => {
  it("tool for type='tool'", () => {
    expect(classifyNode({ id: "n", type: "tool" } as Node)).toBe("tool");
  });
  it("agent for agent attr present", () => {
    expect(classifyNode({ id: "n", agent: "implement" } as Node)).toBe("agent");
  });
  it("start for Mdiamond", () => {
    expect(classifyNode({ id: "n", shape: "Mdiamond" } as Node)).toBe("start");
  });
  it("exit for Msquare", () => {
    expect(classifyNode({ id: "n", shape: "Msquare" } as Node)).toBe("exit");
  });
  it("gate for hexagon", () => {
    expect(classifyNode({ id: "n", shape: "hexagon", label: "?" } as Node)).toBe("gate");
  });
});

describe("validateNode", () => {
  it("emits schema_error with node id in message on unknown attr", () => {
    const diags = validateNode({ id: "n1", agent: "implement", prompt: "p", promt: "typo" } as Node);
    expect(diags).toHaveLength(1);
    expect(diags[0].rule).toBe("schema_error");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("n1");
    expect(diags[0].message).toContain("promt");
  });

  it("emits schema_error on tool node missing cwd", () => {
    const diags = validateNode({ id: "t1", type: "tool", toolCommand: "echo" } as Node);
    expect(diags.some(d => d.rule === "schema_error" && d.message.includes("cwd"))).toBe(true);
  });

  it("returns [] for valid node", () => {
    const diags = validateNode({
      id: "t1", type: "tool", cwd: "$project", toolCommand: "echo hi",
    } as Node);
    expect(diags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: FAIL — `classifyNode` / `validateNode` not exported.

- [ ] **Step 3: Add classifyNode + validateNode**

```ts
// in src/attractor/core/schemas.ts, after other schemas
import type { Node } from "../types.js";
import type { Diagnostic } from "./graph.js";

export type NodeKind = "tool" | "agent" | "gate" | "start" | "exit";

const SCHEMAS = {
  tool: ToolNodeSchema,
  agent: AgentNodeSchema,
  gate: GateNodeSchema,
  start: StartNodeSchema,
  exit: ExitNodeSchema,
} as const;

export function classifyNode(node: Node): NodeKind {
  if (node.type === "tool") return "tool";
  if (node.shape === "Mdiamond") return "start";
  if (node.shape === "Msquare") return "exit";
  if (node.shape === "hexagon") return "gate";
  if (typeof node.agent === "string") return "agent";
  // Default: treat as agent so unknown-attr checks still fire on agent fields.
  return "agent";
}

export function validateNode(node: Node): Diagnostic[] {
  const kind = classifyNode(node);
  const schema = SCHEMAS[kind];
  const result = schema.safeParse(node);
  if (result.success) return [];
  return result.error.issues.map(issue => ({
    rule: "schema_error",
    severity: "error" as const,
    message: `[${node.id}] ${issue.path.join(".") || "<node>"}: ${issue.message}`,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS (24 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): add classifyNode + validateNode"
```

---

## Chunk 2: Wire schema validation into validateGraph

Calls `validateNode` for each node inside `validateGraph` and merges the resulting diagnostics with the existing semantic pass.

### Task 2.1: Red — assert validateGraph surfaces schema_error

**Files:**
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Add test near existing validateGraph tests**

```ts
// in src/attractor/tests/graph.test.ts
import { validateGraph } from "../core/graph.js";

it("validateGraph emits schema_error for tool node missing cwd", () => {
  const graph = parseDot(`
    digraph g {
      start [shape=Mdiamond]
      bad [type="tool", toolCommand="echo hi"]
      done [shape=Msquare]
      start -> bad -> done
    }
  `);
  const diags = validateGraph(graph);
  expect(diags.some(d => d.rule === "schema_error" && d.message.includes("cwd"))).toBe(true);
});

it("validateGraph emits schema_error for unknown attribute", () => {
  const graph = parseDot(`
    digraph g {
      start [shape=Mdiamond]
      n [agent="implement", prompt="p", tool_commnd="typo"]
      done [shape=Msquare]
      start -> n -> done
    }
  `);
  const diags = validateGraph(graph);
  expect(diags.some(d => d.rule === "schema_error" && d.message.includes("tool_commnd"))).toBe(true);
});

it("validateGraph returns no schema_error for a valid tool node", () => {
  const graph = parseDot(`
    digraph g {
      start [shape=Mdiamond]
      ok [type="tool", cwd="$project", toolCommand="echo hi"]
      done [shape=Msquare]
      start -> ok -> done
    }
  `);
  const diags = validateGraph(graph);
  expect(diags.filter(d => d.rule === "schema_error")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "schema_error"`
Expected: FAIL — validator does not emit `schema_error` rule yet.

- [ ] **Step 3: Commit (red)**

```bash
git add src/attractor/tests/graph.test.ts
git commit -m "test(graph): red — validateGraph should surface schema_error diagnostics"
```

### Task 2.2: Pre-green audit — migrate inline DOT fixtures

Schema validation will break any existing test fixture that has a `type="tool"` node without `cwd=`. Patch these up-front so the green commit below is deterministic.

**Files:**
- Modify: `src/attractor/tests/graph.test.ts` (any inline DOT strings referencing `type="tool"`)
- Modify: any other `src/**/tests/*.test.ts` with inline tool-node DOT fixtures

- [ ] **Step 1: Grep for affected fixtures**

```bash
grep -rn 'type="tool"' src/**/tests/
```
For each hit in a DOT fixture string missing `cwd=`, add `cwd="$project"` to the attribute list. Do NOT change fixtures that already have `cwd=` (anywhere), and do NOT touch production `pipelines/*.dot` (that's Chunk 5).

- [ ] **Step 2: Run existing tests to confirm no behavior change yet**

Run: `npx vitest run src/attractor` — schema pass not yet wired in, so existing tests must still pass. If anything breaks here, the migration was wrong.

- [ ] **Step 3: Commit**

```bash
git add -u src/
git commit -m "test: add cwd= to inline tool-node DOT fixtures ahead of schema enforcement"
```

### Task 2.3: Green — wire validateNode into validateGraph

**Files:**
- Modify: `src/attractor/core/graph.ts`

- [ ] **Step 1: Add import**

At top of `src/attractor/core/graph.ts`, add alongside existing imports:

```ts
import { validateNode } from "./schemas.js";
```

(Note: `schemas.ts` already imports `Diagnostic` as a type from `./graph.js`. Type-only imports do not create a runtime cycle — ESM hoists both exports.)

- [ ] **Step 2: Insert schema pass in validateGraph**

Locate `validateGraph()` at line ~261. Find the existing `const diagnostics: Diagnostic[] = [];` declaration (or equivalent accumulator). Immediately after it, insert ONE block:

```ts
for (const node of graph.nodes.values()) {
  diagnostics.push(...validateNode(node));
}
```

Do NOT restate the function signature. Do NOT delete any existing checks. The new loop runs before semantic checks and appends to the same `diagnostics` array.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: All tests PASS, including the three added in Task 2.1.

- [ ] **Step 4: Run full attractor test suite for regressions**

Run: `npx vitest run src/attractor`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts
git commit -m "feat(graph): run zod schemas inside validateGraph"
```

---

## Chunk 3: $project preflight in pipelineRunCommand

Detects `$project` references in the parsed graph and requires `opts.project` to be set. Does NOT run in `pipelineValidateCommand` — `--project` is a runtime concern.

### Task 3.1: Red — preflight test

**Files:**
- Create: `src/cli/tests/pipeline-run-preflight.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/cli/tests/pipeline-run-preflight.test.ts
import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineRunCommand } from "../commands/pipeline.js";

describe("pipelineRunCommand — $project preflight", () => {
  it("exits with error when pipeline references $project but --project not passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-preflight-"));
    const dot = join(dir, "p.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="$project", toolCommand="echo $project"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error("exit:" + c);
    }) as never);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(pipelineRunCommand(dot, {})).rejects.toThrow(/exit:1/);

    const errOutput = errSpy.mock.calls.map(c => String(c[0])).join("");
    expect(errOutput).toMatch(/project_binding_missing/);
    expect(errOutput).toMatch(/--project/);
    expect(errOutput).toMatch(/\brun\b/); // node id referenced

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("does not fire preflight when --project is provided", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-preflight-"));
    const dot = join(dir, "p.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="$project", toolCommand="echo $project"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // pipelineRunCommand may still fail later (agent spawn, etc.) — we only assert
    // the preflight-specific rule is NOT in stderr.
    try { await pipelineRunCommand(dot, { project: dir }); } catch {}
    const out = errSpy.mock.calls.map(c => String(c[0])).join("");
    expect(out).not.toMatch(/project_binding_missing/);
    errSpy.mockRestore();
  });

  it("skips preflight when graph does not reference $project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-preflight-"));
    const dot = join(dir, "p.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="/tmp", toolCommand="echo hi"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try { await pipelineRunCommand(dot, {}); } catch {}
    const out = errSpy.mock.calls.map(c => String(c[0])).join("");
    expect(out).not.toMatch(/project_binding_missing/);
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts`
Expected: FAIL — preflight rejection not implemented; `pipelineRunCommand` either runs the full pipeline or fails elsewhere (undefined variable, etc.), producing a different error message.

- [ ] **Step 3: Commit (red)**

```bash
git add src/cli/tests/pipeline-run-preflight.test.ts
git commit -m "test(pipeline): red — \$project preflight should fail without --project"
```

### Task 3.2: Green — implement preflight helper + wire in

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [ ] **Step 1: Export the STRING_ATTRS walker + add preflight helper**

In `src/attractor/transforms/variable-expansion.ts`, add near the existing `STRING_ATTRS` (line 89):

```ts
export { STRING_ATTRS };

// Scan all nodes for references to a specific $var across STRING_ATTRS.
// \b matches $project and $project.foo (dotted paths) but not $project_x.
export function findVarReferences(graph: Graph, varName: string): string[] {
  const re = new RegExp(`\\$${varName}\\b`);
  const out: string[] = [];
  for (const node of graph.nodes.values()) {
    for (const attr of STRING_ATTRS) {
      const v = (node as Record<string, unknown>)[attr];
      if (typeof v === "string" && re.test(v)) { out.push(node.id); break; }
    }
  }
  return out;
}
```

Import `Graph` from `../types.js` if not already imported.

- [ ] **Step 2: Call preflight in pipelineRunCommand — between validateOrRaise and scanUndeclaredCallerVars**

In `src/cli/commands/pipeline.ts`, find `pipelineRunCommand` (line ~122). Insert **immediately after** `validateOrRaise(graph);` (line 136) and **before** the existing `scanUndeclaredCallerVars(graph, ...)` block (line 143). This placement ensures a missing `--project` produces a clean rule-tagged error before noisier "undeclared variable" warnings fire:

```ts
// $project preflight: if any node references $project, --project must be set.
// Uses rule code `project_binding_missing` so docs and stderr grep match.
if (!opts.project) {
  const { findVarReferences } = await import("../../attractor/transforms/variable-expansion.js");
  const refs = findVarReferences(graph, "project");
  if (refs.length > 0) {
    process.stderr.write(
      `✗ [project_binding_missing] Pipeline references $project but --project flag not passed.\n` +
      `  Pass --project <folder>, not --var project=...\n` +
      `  Nodes referencing $project: ${refs.join(", ")}\n`
    );
    process.exit(1);
  }
}
```

(If `findVarReferences` is already imported statically at top of file, drop the dynamic `await import`. Prefer static.)

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts`
Expected: PASS.

- [ ] **Step 4: Run full CLI suite**

Run: `npx vitest run src/cli`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/pipeline.ts
git commit -m "feat(pipeline): \$project preflight in pipelineRunCommand"
```

---

## Chunk 4: ToolHandler uses node.cwd

Adds `"cwd"` to `STRING_ATTRS` so graph-load expansion resolves `$project` inside it, then pipes it to both `spawnSync` callsites. Drops dead runtime guards now redundant with zod.

### Task 4.1: Add "cwd" to STRING_ATTRS

**Files:**
- Modify: `src/attractor/transforms/variable-expansion.ts`

- [ ] **Step 1: Red — add test to variable-expansion tests**

Find or create a test that expands a node's `cwd`:

```ts
// src/attractor/tests/variable-expansion.test.ts (create if missing, else append)
import { describe, it, expect } from "vitest";
import { variableExpansionTransform } from "../transforms/variable-expansion.js";
import type { Graph, Node } from "../types.js";

describe("variableExpansionTransform — cwd attribute", () => {
  it("expands $project inside node.cwd", () => {
    const graph: Graph = {
      goal: "",
      nodes: new Map([
        ["t1", { id: "t1", type: "tool", cwd: "$project", toolCommand: "echo" } as Node],
      ]),
      edges: [],
    };
    const out = variableExpansionTransform(graph, { project: "/proj" });
    expect((out.nodes.get("t1") as any).cwd).toBe("/proj");
  });
});
```

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts`
Expected: FAIL — cwd is not expanded.

- [ ] **Step 2: Commit the red test only**

```bash
git add src/attractor/tests/variable-expansion.test.ts
git commit -m "test(var-expansion): red — cwd should expand \$project"
```

- [ ] **Step 3: Green — add "cwd" to STRING_ATTRS and extend the expand loop**

In `src/attractor/transforms/variable-expansion.ts`:

- Line 89: `const STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs"];` → `const STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs", "cwd"];`

- In `variableExpansionTransform` (line ~73-81), the current runtime expansion block expands only `prompt`, `toolCommand`, and (as a string) `maxIterations`. **Do NOT add `label` or `scriptArgs` expansion — that is out of scope for this plan.** Add exactly ONE new line, after the existing `n.toolCommand` expansion:

```ts
if (typeof n.cwd === "string") n.cwd = expand(n.cwd);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/transforms/variable-expansion.ts
git commit -m "feat(var-expansion): expand \$project inside node.cwd"
```

**Ordering note:** `variableExpansionTransform` runs at graph-load (before `validateGraph`). So `cwd="$project"` is expanded to the real path before the zod `min(1)` check sees it. The Chunk 3 preflight catches the missing-`--project` case first, so `cwd` can never land at the schema layer as an empty string.

### Task 4.2: Tool handler passes cwd to spawnSync (both sites)

**Files:**
- Modify: `src/attractor/handlers/tool.ts`
- Modify: `src/attractor/tests/tool-handler.test.ts` (create if absent)

- [ ] **Step 1: Red — assert spawnSync receives cwd**

```ts
// src/attractor/tests/tool-handler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({ spawnSync: vi.fn() }));
import { spawnSync } from "child_process";
import { ToolHandler } from "../handlers/tool.js";
import type { Node, PipelineContext } from "../types.js";

const mockSpawnSync = vi.mocked(spawnSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawnSync.mockReturnValue({
    status: 0, stdout: "", stderr: "", pid: 0, output: [],
    signal: null,
  } as any);
});

const meta = {
  logsRoot: "/tmp", cwd: "/tmp", dotDir: "/tmp",
  outgoingLabels: [], completedNodes: [], nodeRetries: {},
};

describe("ToolHandler — cwd passthrough", () => {
  it("passes node.cwd to spawnSync for tool_command path", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t1", type: "tool", cwd: "/expected/cwd", toolCommand: "echo hi",
    };
    await h.execute(node, { values: {} } as PipelineContext, meta as any);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "sh", ["-c", expect.any(String)],
      expect.objectContaining({ cwd: "/expected/cwd" }),
    );
  });

  it("passes node.cwd to spawnSync for script_file path", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t1", type: "tool", cwd: "/expected/cwd",
      scriptFile: "scripts/x.mjs",
    } as Node;
    await h.execute(node, { values: {} } as PipelineContext, meta as any);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "sh", ["-c", expect.any(String)],
      expect.objectContaining({ cwd: "/expected/cwd" }),
    );
  });
});
```

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts`
Expected: FAIL — spawnSync not called with `cwd`.

- [ ] **Step 2: Green — pipe cwd through, narrow producesFromStdout inline, drop dead guards**

In `src/attractor/handlers/tool.ts`, make these exact changes:

1. **Replace the three typeof-guarded reads at lines 61-63** with direct-property reads, using a single narrow cast:

   ```ts
   const nodeRecord = node as unknown as {
     scriptFile?: string;
     scriptArgs?: string;
     producesFromStdout?: boolean | "true";
     cwd: string;
   };
   const { scriptFile, scriptArgs, cwd } = nodeRecord;
   const producesFromStdout = nodeRecord.producesFromStdout === true
     || nodeRecord.producesFromStdout === "true";
   ```

   (This inlines the old `isTruthyAttr` call at line 63 for this one call-site.)

2. **Delete the `isTruthyAttr` function (lines 29-31)**. Grep-verify no other callers first:

   ```bash
   grep -rn "isTruthyAttr" src/
   ```
   If any matches remain outside `tool.ts`, stop and surface to human. Otherwise delete the function.

3. **Delete the `script_command_conflict` runtime check (the entire `if (node.toolCommand) { return {...} }` block at lines 87-92**, i.e. inside the `if (scriptFile)` branch). Zod's `.refine` catches this at validate time.

4. **Delete the `if (!node.toolCommand) { return { status: "fail", ... } }` block (lines 122-124)**. Zod's `.refine` guarantees one of `toolCommand`/`scriptFile` exists; since this branch is reached only when `scriptFile` is falsy, `toolCommand` is guaranteed truthy.

5. **Both `spawnSync` callsites** change from:

   ```ts
   spawnSync("sh", ["-c", command], { encoding: "utf8" });
   ```

   to:

   ```ts
   spawnSync("sh", ["-c", command], { encoding: "utf8", cwd });
   ```

   (`cwd` is the destructured local from step 1; already expanded by graph-load transform.)

- [ ] **Step 3: Run tests to verify pass**

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts`
Expected: PASS.

- [ ] **Step 4: Full attractor suite for regressions**

Run: `npx vitest run src/attractor`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/handlers/tool.ts src/attractor/tests/tool-handler.test.ts
git commit -m "feat(tool-handler): use node.cwd, drop dead guards"
```

---

## Chunk 5: Migrate in-repo pipelines + regression fixture

Seven tool nodes across four `.dot` files need `cwd` added (and one `cd $project &&` prefix stripped). Plus a dedicated regression fixture.

### Task 5.1: Write audit script (optional helper, not shipped)

**Files:**
- Create: `scripts/audit-tool-nodes.mjs`

- [ ] **Step 1: Write the audit script**

```js
#!/usr/bin/env node
// scripts/audit-tool-nodes.mjs
// Walk pipelines/**/*.dot, list tool nodes + their tool_command or script_file.
// Suggests cwd value based on prefix patterns. Dev-only, not shipped.

import { readFileSync } from "fs";
import { globSync } from "glob";

const files = globSync("pipelines/**/*.dot");
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
```

- [ ] **Step 2: Run the script to see current state**

```bash
node scripts/audit-tool-nodes.mjs
```
Expected: lists 7 tool nodes, with suggested `cwd` per node.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-tool-nodes.mjs
git commit -m "chore(scripts): audit-tool-nodes helper"
```

### Task 5.2: Migrate illumination-to-implementation.dot

**Four tool nodes** to migrate:
- `delete_file` (line 16)
- `mark_dispatched` (line 20, uses `script_file` — still needs `cwd`)
- `launch_tmux` (line 44)
- `commit_push` (line 50 — has `cd $project &&` prefix, strip it)

**Semantic note for commit_push:** the `$(git branch --show-current)` subshell inherits the `spawnSync` `cwd`, so stripping `cd $project &&` is equivalent to the current behavior AS LONG AS `cwd="$project"` is set on the node.

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot`

- [ ] **Step 1: Replace each tool node with explicit cwd**

```
delete_file [type="tool", cwd="$project", tool_command="rm $illumination_path"]
```

```
mark_dispatched [type="tool",
                 cwd="$project",
                 script_file="scripts/mark-dispatched.mjs",
                 script_args="$illumination_path $plan_path"]
```

```
launch_tmux [type="tool", cwd="$project", tool_command="tmux new-window -c \"$project\" -n \"test-$run_id\""]
```

```
commit_push [type="tool", cwd="$project", tool_command="git push origin $(git branch --show-current) || git push -u origin $(git branch --show-current)"]
```

- [ ] **Step 2: Validate**

```bash
npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot
```
Expected: `✔ Pipeline valid`.

- [ ] **Step 3: Commit**

```bash
git add pipelines/illumination-to-implementation.dot
git commit -m "refactor(pipelines): migrate illumination-to-implementation tool nodes to explicit cwd"
```

### Task 5.3: Migrate illumination-to-plan.dot

**Files:**
- Modify: `pipelines/illumination-to-plan.dot`

- [ ] **Step 1: Add cwd to delete_file (line 14)**

`delete_file [type="tool", cwd="$project", tool_command="rm $illumination_path"]`

- [ ] **Step 2: Validate**

```bash
node dist/cli/index.js pipeline validate pipelines/illumination-to-plan.dot
```
Expected: `✔ Pipeline valid`.

- [ ] **Step 3: Commit**

```bash
git add pipelines/illumination-to-plan.dot
git commit -m "refactor(pipelines): migrate illumination-to-plan tool nodes to explicit cwd"
```

### Task 5.4: Migrate smoke pipelines

**Files:**
- Modify: `pipelines/smoke/tmux-tester.dot` (launch_tmux, line 6)
- Modify: `pipelines/smoke/tool-runtime-vars.dot` (delete_file, line 14)

- [ ] **Step 1: Add cwd="$project" to both**

- `tmux-tester.dot:6` — add `cwd="$project"`.
- `tool-runtime-vars.dot:14` — add `cwd="$project"`.

- [ ] **Step 2: Validate all smoke pipelines**

```bash
for f in pipelines/smoke/*.dot; do
  node dist/cli/index.js pipeline validate "$f" || echo "FAIL: $f"
done
```
Expected: every file prints `✔`.

- [ ] **Step 3: Commit**

```bash
git add pipelines/smoke/tmux-tester.dot pipelines/smoke/tool-runtime-vars.dot
git commit -m "refactor(smoke): migrate smoke tool nodes to explicit cwd"
```

### Task 5.5: Add regression fixture

**Files:**
- Create: `src/attractor/tests/fixtures/pre-migration-tool-node.dot`
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Create fixture (pre-migration snapshot with missing cwd)**

```
digraph regression {
  start [shape=Mdiamond]
  commit_push [type="tool", tool_command="cd $project && git push"]
  done [shape=Msquare]
  start -> commit_push -> done
}
```

- [ ] **Step 2: Add test**

```ts
// src/attractor/tests/graph.test.ts, append
it("rejects pre-migration tool node missing cwd (regression fixture)", () => {
  const src = readFileSync(
    new URL("./fixtures/pre-migration-tool-node.dot", import.meta.url),
    "utf8",
  );
  const graph = parseDot(src);
  const diags = validateGraph(graph);
  expect(diags.some(d => d.rule === "schema_error" && d.message.includes("cwd"))).toBe(true);
});
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: PASS.

```bash
git add src/attractor/tests/fixtures/pre-migration-tool-node.dot src/attractor/tests/graph.test.ts
git commit -m "test(graph): regression fixture for pre-migration tool node"
```

### Task 5.6: Run full test suite + smoke pipelines

- [ ] **Step 1: Full suite**

```bash
npm run build && npm test
```
Expected: all tests pass. If a test fails only on a pre-existing flake (e.g. `pipeline-app-integration.test.tsx`), note in commit message and proceed.

- [ ] **Step 2: Exercise a smoke pipeline end-to-end**

First inspect the pipeline to confirm any `--var` needed:

```bash
grep -n 'inputs=' pipelines/smoke/tool-runtime-vars.dot
```

Pass any declared inputs via `--var` as needed. Typical invocation:

```bash
node dist/cli/index.js pipeline run pipelines/smoke/tool-runtime-vars.dot --project $(pwd)
```

Expected: completes successfully, `runtime-var-expand: ok` printed. If it fails with `UndefinedVariableError`, add the required `--var <k>=<v>` and re-run.

- [ ] **Step 3: Run the $project preflight negative case manually**

```bash
node dist/cli/index.js pipeline run pipelines/illumination-to-implementation.dot
```
(No `--project` passed.)
Expected: exits 1, stderr contains `[project_binding_missing]` and lists affected nodes.

---

## Chunk 6: Docs + authoring prompts

### Task 6.0: Check specs/architecture.md

- [ ] **Step 1: Grep for tool-node mentions in architecture doc**

```bash
grep -n 'tool_command\|type="tool"\|type=\"tool\"\|tool node' specs/architecture.md
```

If matches exist, extend Task 6.2 to also update that file with the cwd + preflight language. If no matches (architecture doc doesn't describe tool-node mechanics), note "no changes needed" in the commit message of Task 6.2. Skip the full Task 6.0 commit if empty.

### Task 6.1: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Pipeline tool-node section**

Find the "Pipeline script files" section heading in `README.md`. Insert the new subsection below, immediately after that section's closing (use the heading as the anchor, not a line number).

Content to add:

```markdown
### Pipeline tool nodes and `cwd=`

Every `type="tool"` node must declare `cwd=` explicitly. The value is a
literal directory (supports `$project`, `$run_id` expansion at load time).
The tool command runs with that as its working directory — avoid the old
`cd $project && ...` prefix pattern.

```dot
commit_push [type="tool",
             cwd="$project",
             tool_command="git push origin $(git branch --show-current)"]
```

If any node references `$project` in any attribute, `pipeline run` requires
`--project <folder>` — passing `--var project=...` is not a substitute.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document tool-node cwd requirement and \$project preflight"
```

### Task 6.2: Update specs/commands.md

**Files:**
- Modify: `specs/commands.md`

- [ ] **Step 1: Add equivalent note under the pipeline run subsection**

Find the `ralph pipeline run` section. Add:

```markdown
**Tool-node `cwd`:** every `type="tool"` node must declare a `cwd=` attribute. The command executes with that directory as cwd.

**`--project` preflight:** if the pipeline references `$project` in any node attribute, `pipeline run` requires `--project <folder>` and exits 1 otherwise with rule `project_binding_missing` (printed to stderr as `[project_binding_missing]`). `--var project=...` does not satisfy this.
```

- [ ] **Step 2: Commit**

```bash
git add specs/commands.md
git commit -m "docs(specs): note tool-node cwd and \$project preflight"
```

### Task 6.3: Update pipeline-create-prompt

Actual location (verified): `composeCreatePrompt` lives in `src/cli/lib/pipeline-create-prompt.ts:27` with signature `(project: string): string` — synchronous, takes a string. It reads a base template from the path returned by `getPipelineCreatePromptPath()` (an asset file) and appends an agent-registry section. Adding the new authoring rule means editing the base asset text, not the TS function.

**Files:**
- Modify: the base prompt asset file (find via `grep -rn "getPipelineCreatePromptPath" src/cli/lib/assets.ts` — it points at a `.md` under `src/cli/prompts/` or equivalent)
- Create: `src/cli/tests/compose-create-prompt.test.ts`

- [ ] **Step 1: Red — test that composeCreatePrompt emits the cwd rule**

```ts
// src/cli/tests/compose-create-prompt.test.ts
import { describe, it, expect } from "vitest";
import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";

describe("composeCreatePrompt", () => {
  it("instructs authoring agent to declare cwd on tool nodes", () => {
    const prompt = composeCreatePrompt("/tmp");
    expect(prompt).toMatch(/cwd=/);
    expect(prompt).toMatch(/tool/i);
  });

  it("notes --project is required when \\$project is referenced", () => {
    const prompt = composeCreatePrompt("/tmp");
    expect(prompt).toMatch(/--project/);
  });
});
```

Run: `npx vitest run src/cli/tests/compose-create-prompt.test.ts`
Expected: FAIL — current prompt does not mention `cwd=` or `--project`.

- [ ] **Step 2: Locate and edit the base prompt asset**

```bash
grep -n "getPipelineCreatePromptPath" src/cli/lib/assets.ts
```

Follow the returned path (likely `src/cli/prompts/pipeline-create.md` or similar). Append these two bullets to the end of the base authoring instructions (not inside an existing subsection):

```text
- Every `type="tool"` node MUST declare a `cwd=` attribute (typical value: `cwd="$project"`). Do NOT rely on the ralph process cwd; it differs from the caller's shell.
- If the pipeline references `$project` in any node attribute, `pipeline run` must be invoked with `--project <folder>` — `--var project=...` is NOT a substitute.
```

Run test again. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/prompts/pipeline-create.md src/cli/tests/compose-create-prompt.test.ts
# (adjust the prompt path to what Step 2 found)
git commit -m "feat(pipeline): authoring prompt tells agent to declare cwd on tool nodes"
```

---

## Verification checklist (run at end)

- [ ] `npm run build && npm test` — all pass.
- [ ] `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` — `✔ Pipeline valid`.
- [ ] `node dist/cli/index.js pipeline run pipelines/smoke/tool-runtime-vars.dot` (no `--project`) — exits 1, references `$project`-preflight message.
- [ ] `node dist/cli/index.js pipeline run pipelines/smoke/tool-runtime-vars.dot --project $(pwd)` — succeeds.
- [ ] Every `type="tool"` node in `pipelines/**/*.dot` has `cwd=`.
- [ ] `src/attractor/handlers/tool.ts` no longer has `isTruthyAttr` or `script_command_conflict` runtime check.
- [ ] `specs/commands.md` and `README.md` mention the new rule.
