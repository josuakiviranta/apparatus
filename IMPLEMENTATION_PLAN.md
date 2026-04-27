# Pipeline Folder Architecture Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ralph-cli pipelines from scattered concept folders to per-pipeline folders with self-describing node files. Net: `src/` becomes the harness, `pipelines/` becomes behavior, concept count for authors drops from 7 to ~3.

**Architecture:** Six sequential chunks, each producing working software. Chunk 1 lands `outputs:` frontmatter on agents (foundation). Chunk 2 adds `inputs:` + flow validator (safety net for later moves). Chunk 3 moves gates to `.md` files. Chunk 4 migrates project pipelines to per-folder layout and relocates agents out of `src/cli/agents/`. Chunk 5 introduces `src/cli/templates/` and converts `pipeline create` to a pipeline. Chunk 6 collapses remaining workflow commands (`plan`, `meditate`, `new`, `pipeline refine`) to pipelines.

**Tech Stack:** TypeScript, Node.js, vitest, zod (already in use for node schemas), `yaml` (already a dep, used by `parseFrontmatter`), graphviz (`@ts-graphviz/ast`, existing).

**Spec:** `docs/superpowers/specs/2026-04-27-pipeline-folder-architecture-redesign.md`

**Plan structure note:** Chunk 1 is fully detailed below with TDD steps. Chunks 2-6 are outlined to keep the plan synchronized with what's actually shipped — each gets fully expanded as the prior chunk lands. This avoids stale plans drifting from reality discovered during execution.

---

## File Structure

The redesign touches files across the engine, CLI, and pipelines. Below is the high-level inventory; each chunk specifies exact files.

| Area | Files | What changes |
|---|---|---|
| `src/attractor/core/schemas.ts` | Modify | Add `inputs:`, `outputs:` to `AgentNodeSchema`. Add `GateNodeFrontmatterSchema` for new `.md`-based gates. Add validation refinements (D2 conflict, D5 flow rules). |
| `src/attractor/core/graph.ts` | Modify | Extend validator with `outputs_and_schema_file_conflict`, `derive_produces_from_outputs`, `missing_input_producer`, `branch_incomplete_input`, `input_type_mismatch`, `orphan_output`, `required_caller_vars`, `degenerate_pipeline`. |
| `src/cli/lib/agent.ts` | Modify | Extend `AgentConfig` interface with optional `inputs?: string[]` and `outputs?: Record<string, JsonSchemaFragment>`. Modify the literal-object factory `validateAgentConfig` (`:420-437`) to derive a JSON Schema from `outputs:` and serialize it into the existing `jsonSchema?: string` field. **No change to runtime path** (agent-handler uses `config.jsonSchema` unchanged). |
| `src/cli/lib/agent-registry.ts` | Verify only (Chunk 1) | `parseAgentFile` (`:35-38`) already spreads `...attributes` into `validateAgentConfig`, so `outputs`/`inputs` flow through automatically. Tested end-to-end via `resolveAgent`. After Chunk 4, lookup order changes (pipeline folder first, no fallback). |
| `src/attractor/handlers/agent-handler.ts` | No change in Chunk 1 | The runtime path consumes `config.jsonSchema` (string) and merges every key from the parsed LLM output into `contextUpdates`. No filtering by `produces=`. Chunk 1's frontmatter changes feed the same `jsonSchema` field; no handler edit needed. |
| `src/cli/agents/*.md` | Move (Chunks 4-6) | Each agent file moves into the pipeline folder that uses it (with `outputs:`/`inputs:` added). |
| `src/cli/prompts/*.md` | Delete (Chunks 5-6) | All bespoke prompts dissolved into templates. |
| `src/cli/templates/*` | Create (Chunk 5) | Bundled pipeline starters: `blank/`, `pipeline-create/`, plus `meditate/`, `plan/`, `new/`, `pipeline-refine/` in Chunk 6. |
| `src/cli/lib/assets.ts` | Modify (Chunk 5) | Add `getBundledTemplatesDir()` mirroring `getBundledAgentsDir()`. |
| `src/cli/commands/{plan,meditate,new}.ts` | Modify (Chunk 6) | Collapse to thin shims that call `runPipeline(bundledTemplatePath, vars)`. |
| `pipelines/<name>.dot` | Move (Chunk 4) | Each becomes `pipelines/<name>/pipeline.dot` + per-node files. |
| `pipelines/scripts/*` | Move + delete (Chunk 4) | Scripts move into the pipeline folder that uses them; folder deleted. |
| `pipelines/schemas/*` | Delete (Chunks 1, 4) | Schemas dissolved into agent `outputs:`. Folder deleted at end of Chunk 4. |

---

## Chunk 1: `outputs:` frontmatter + verifier migration (D2)

**Purpose:** Land the foundation. Extend the agent frontmatter parser to recognize `outputs:`, build the JSON Schema from it at agent-load time, and migrate one agent (`verifier`) end-to-end as proof. By the end of this chunk, `pipelines/schemas/verifier.json` is deleted, `illumination-to-implementation.dot`'s verifier node loses `json_schema_file=` and `produces=`, and all tests still pass.

**Codebase facts grounding this chunk** (verified before writing):
- `src/cli/lib/frontmatter.ts:1-11` — `parseFrontmatter` uses **`gray-matter`** (which delegates to `js-yaml`), not the `yaml` package directly. Flow-style mappings (`{enum: [a,b]}`) work out of the box.
- `src/cli/lib/agent.ts:16` — `AgentConfig` is a TypeScript interface; `jsonSchema?: string` field already exists (line 24). The schema is **stored as a serialized JSON string** and embedded into the prompt by agent-handler.
- `src/cli/lib/agent.ts:420-437` — `validateAgentConfig` is a literal-object factory function (not zod). Adding new fields means modifying the returned object literal.
- `src/attractor/handlers/agent-handler.ts:222-295` — when `jsonSchema` (string) is set, the handler parses the LLM's structured output and merges **every key** from the parsed JSON into `contextUpdates`. There is **no `produces=` filtering** at the handler level. `produces=` is consumed by the validator (`graph.ts:164-184`) and the variable-expansion default-seed extractor (`variable-expansion.ts:163-165`).
- `src/attractor/types.ts:16` — the outcome field is **`contextUpdates`**, not `contextWiden`.
- `src/cli/lib/agent-registry.ts:40-67` — `resolveAgent(name, opts)` finds an agent file across project/user/bundled directories. The validator helper for outputs lookup must use this, not direct path resolution.

**Architectural choice — leverage existing `jsonSchema?: string` field:** The simplest plumbing: parse `outputs:` block → build JSON Schema **object** → JSON.stringify into existing `jsonSchema` field. Runtime path (agent.ts → agent-handler.ts) needs **zero** changes — it already reads `config.jsonSchema` as a string and does the right thing. The new `outputs` field on AgentConfig is exposed only for the validator to read keys from.

**Files:**
- Modify: `src/cli/lib/agent.ts:16-30` (AgentConfig interface) and `:420-437` (validateAgentConfig factory) — add `outputs?: Record<string, JsonSchemaFragment>` field; in factory, derive a JSON Schema object from `outputs` and `JSON.stringify` it into the existing `jsonSchema` field.
- Modify: `src/cli/lib/agent-registry.ts:35-38` — `parseAgentFile` passes `attributes.outputs` through to `validateAgentConfig`.
- Modify: `src/attractor/core/graph.ts:164-184` — when computing `nodeProduces` for an agent node, also derive keys from the agent's `outputs:` block (resolved via `resolveAgent`). Hook into the existing nodeProduces collection loop.
- Modify: `src/attractor/core/graph.ts` (separate diagnostic block, near `:300`) — add `outputs_and_schema_file_conflict` (error) and `produces_redundant_with_outputs` (warning).
- Migrate: `src/cli/agents/verifier.md` — add `outputs:` block matching `pipelines/schemas/verifier.json`.
- Modify: `pipelines/illumination-to-implementation.dot` (verifier node) — remove `json_schema_file=` and `produces=`.
- Delete: `pipelines/schemas/verifier.json`.
- Create: `src/cli/tests/agent-outputs-frontmatter.test.ts` — unit tests for parser + AgentConfig (plus zero-outputs and shorthand-string edge cases).
- Create: `src/attractor/tests/graph-outputs-conflict.test.ts` — validator diagnostic tests (including `dotDir === undefined` skip case).
- Create: `src/attractor/tests/graph-outputs-derives-produces.test.ts` — validator's `nodeProduces` derivation tests.
- (No changes to `src/attractor/handlers/agent-handler.ts` — runtime path is unchanged.)

### Task 1.1: Frontmatter parser exposes `outputs:`

This task confirms `parseFrontmatter` already returns nested objects (`gray-matter` delegates YAML parsing to `js-yaml`, which handles flow-style mappings) and tests the parser against the JSON Schema fragments used in real agents.

- [ ] **Step 1: Read the existing parser to confirm gray-matter usage**

Run:

```bash
cat src/cli/lib/frontmatter.ts
```

Expected output:

```typescript
import matter from "gray-matter";

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const { data, content: body } = matter(content);
  return { attributes: data, body };
}
```

Confirm: the parser delegates to `gray-matter`, which uses `js-yaml` under the hood. Both flow-style mappings (`{enum: [a, b]}`) and shorthand strings parse correctly without code changes.

- [ ] **Step 2: Write the failing parser test**

Create `src/cli/tests/agent-outputs-frontmatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";

describe("parseFrontmatter — outputs block", () => {
  it("parses a typed outputs map with inline JSON Schema fragments", () => {
    const input = `---
name: verifier
model: opus
outputs:
  preferred_label: {enum: [true, false, empty]}
  illumination_path: string
  archive_reason_short: {type: string, maxLength: 100}
---
# Mission
Body here.`;

    const { attributes } = parseFrontmatter(input);

    expect(attributes.name).toBe("verifier");
    expect(attributes.outputs).toEqual({
      preferred_label: { enum: ["true", "false", "empty"] },
      illumination_path: "string",
      archive_reason_short: { type: "string", maxLength: 100 },
    });
  });

  it("returns no outputs key when frontmatter omits it", () => {
    const input = `---
name: legacy-agent
model: sonnet
---
# Mission`;

    const { attributes } = parseFrontmatter(input);
    expect(attributes.outputs).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it passes (parser already supports nested YAML)**

Run:

```bash
npx vitest run src/cli/tests/agent-outputs-frontmatter.test.ts
```

Expected: PASS. The `yaml` package handles flow-style mappings out of the box; no parser change needed.

- [x] **Step 4: Commit** — done in 7833fab.

### Task 1.2: `AgentConfig` carries `outputs:` and derives serialized `jsonSchema` string

The architectural choice: leverage the existing `AgentConfig.jsonSchema?: string` field. Parse `outputs:` → build JSON Schema object → JSON.stringify into `jsonSchema`. Runtime path unchanged. Add `outputs?` field for the validator to read keys from later.

- [ ] **Step 1: Read the current AgentConfig and validateAgentConfig**

Run:

```bash
grep -n "interface AgentConfig\|jsonSchema\|^export function validateAgentConfig" src/cli/lib/agent.ts | head
```

Expected output:

```
16:export interface AgentConfig {
24:  jsonSchema?: string;
54:  /** Buffered stdout content — populated when config.jsonSchema is set */
237:      if (this.config.jsonSchema && !isInteractive && child.stdout) {
420:export function validateAgentConfig(
```

Confirm: `jsonSchema` is `string` at line 24. `validateAgentConfig` at line 420 is a literal-object factory (read lines 420-437 to confirm no zod parse — it's a hand-rolled validator returning `{ name, description, model, ... }`).

- [ ] **Step 2: Write a failing test for the derived schema**

Add to `src/cli/tests/agent-outputs-frontmatter.test.ts`:

```typescript
import { validateAgentConfig } from "../lib/agent.js";

describe("validateAgentConfig — outputs", () => {
  it("attaches outputs and serializes a JSON Schema into jsonSchema string", () => {
    const config = validateAgentConfig({
      name: "verifier",
      description: "Verifier agent",
      outputs: {
        preferred_label: { enum: ["true", "false", "empty"] },
        illumination_path: "string",
      },
      prompt: "Body",
    } as any);

    // The typed `outputs` field is exposed for the validator to read keys from.
    expect(config.outputs).toEqual({
      preferred_label: { enum: ["true", "false", "empty"] },
      illumination_path: "string",
    });

    // The serialized `jsonSchema` string drives the runtime structured-output path.
    expect(config.jsonSchema).toBeDefined();
    const parsed = JSON.parse(config.jsonSchema!);
    expect(parsed).toEqual({
      type: "object",
      properties: {
        preferred_label: { enum: ["true", "false", "empty"] },
        illumination_path: { type: "string" },
      },
      required: ["preferred_label", "illumination_path"],
      additionalProperties: false,
    });
  });

  it("normalizes shorthand strings to {type: ...} fragments", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      outputs: { foo: "string", bar: "number", baz: "boolean" },
      prompt: "",
    } as any);
    const parsed = JSON.parse(config.jsonSchema!);
    expect(parsed.properties).toEqual({
      foo: { type: "string" },
      bar: { type: "number" },
      baz: { type: "boolean" },
    });
  });

  it("does not set outputs or jsonSchema when outputs absent (legacy agents)", () => {
    const config = validateAgentConfig({
      name: "legacy", description: "legacy agent", prompt: "Body",
    } as any);
    expect(config.outputs).toBeUndefined();
    expect(config.jsonSchema).toBeUndefined();
  });

  it("treats outputs with zero keys as empty schema (degenerate but valid)", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      outputs: {},
      prompt: "",
    } as any);
    expect(config.outputs).toEqual({});
    const parsed = JSON.parse(config.jsonSchema!);
    expect(parsed).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("does NOT overwrite an explicit jsonSchema string when outputs is also set", () => {
    // If both are provided, explicit jsonSchema wins. This case shouldn't occur
    // in practice (validator catches at .dot level), but guard against silent override.
    const explicit = '{"type":"object","properties":{},"required":[]}';
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      jsonSchema: explicit,
      outputs: { foo: "string" },
      prompt: "",
    } as any);
    expect(config.jsonSchema).toBe(explicit);
    expect(config.outputs).toEqual({ foo: "string" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npx vitest run src/cli/tests/agent-outputs-frontmatter.test.ts -t "validateAgentConfig"
```

Expected: FAIL — `config.outputs` is undefined (factory drops the field) and `config.jsonSchema` is undefined when outputs is the only input.

- [ ] **Step 4: Extend `AgentConfig` and `validateAgentConfig`**

Modify `src/cli/lib/agent.ts`.

First, add the type definitions (near the top of the file, after the `AgentConfig` interface):

```typescript
// Shorthand strings cover the common scalar types. Other JSON Schema types
// (array, object, integer, etc.) use the full object form: {type: "array", items: ...}.
export type JsonSchemaShorthand = "string" | "number" | "boolean";
export type JsonSchemaFragment =
  | JsonSchemaShorthand
  | { type?: string; enum?: unknown[]; [k: string]: unknown };

interface DerivedJsonSchema {
  type: "object";
  properties: Record<string, { type?: string; enum?: unknown[]; [k: string]: unknown }>;
  required: string[];
  additionalProperties: false;
}

function deriveJsonSchemaString(outputs: Record<string, JsonSchemaFragment>): string {
  const properties: DerivedJsonSchema["properties"] = {};
  for (const [key, frag] of Object.entries(outputs)) {
    if (typeof frag === "string") {
      properties[key] = { type: frag };
    } else {
      properties[key] = frag as { type?: string; enum?: unknown[] };
    }
  }
  const schema: DerivedJsonSchema = {
    type: "object",
    properties,
    required: Object.keys(outputs),
    additionalProperties: false,
  };
  return JSON.stringify(schema);
}
```

Next, extend the `AgentConfig` interface at line 16:

```typescript
export interface AgentConfig {
  // ... existing fields (name, description, model, permissionMode, tools, mcp, prompt, jsonSchema, ...) ...
  outputs?: Record<string, JsonSchemaFragment>;
}
```

Finally, modify `validateAgentConfig` at lines 420-437. Replace the literal-return:

```typescript
export function validateAgentConfig(
  config: Partial<AgentConfig> & { prompt?: string },
): AgentConfig {
  if (!config.name) throw new Error("name is required");
  if (!config.description) throw new Error("description is required");
  if (typeof config.prompt !== "string") throw new Error("prompt body is required");

  // Derive jsonSchema from outputs only when not explicitly provided. Explicit
  // jsonSchema wins (legacy agents that hand-author the schema string).
  const derivedJsonSchema = (config.outputs && !config.jsonSchema)
    ? deriveJsonSchemaString(config.outputs)
    : config.jsonSchema;

  return {
    name: config.name,
    description: config.description,
    model: config.model ?? DEFAULTS.model!,
    permissionMode: config.permissionMode ?? DEFAULTS.permissionMode!,
    tools: config.tools ?? DEFAULTS.tools!,
    mcp: config.mcp ?? DEFAULTS.mcp!,
    prompt: config.prompt,
    ...(derivedJsonSchema !== undefined ? { jsonSchema: derivedJsonSchema } : {}),
    ...(config.outputs !== undefined ? { outputs: config.outputs } : {}),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run src/cli/tests/agent-outputs-frontmatter.test.ts
```

Expected: PASS for all 5 tests in this file.

- [ ] **Step 6: Run the full agent test suite to confirm no regression**

Run:

```bash
npx vitest run src/cli/tests
```

Expected: all green. Existing agents (which don't have `outputs:`) continue to work unchanged.

- [x] **Step 7: Commit** — done in 67a1b22.

### Task 1.3: `parseAgentFile` carries `outputs:` end-to-end

This is mostly a verification task — `parseAgentFile` already spreads `...attributes` into `validateAgentConfig`, so the new `outputs` key flows through automatically. The test confirms the integration end-to-end (file → parser → AgentConfig).

- [ ] **Step 1: Read the integration point**

Run:

```bash
sed -n '35,38p' src/cli/lib/agent-registry.ts
```

Expected output:

```typescript
function parseAgentFile(content: string): AgentConfig {
  const { attributes, body } = parseFrontmatter(content);
  return validateAgentConfig({ ...attributes, prompt: body } as any);
}
```

Confirm: `...attributes` spread carries any new frontmatter key through to `validateAgentConfig`.

- [ ] **Step 2: Write a failing integration test**

Add to `src/cli/tests/agent-outputs-frontmatter.test.ts`:

```typescript
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAgent } from "../lib/agent-registry.js";

describe("resolveAgent — outputs end-to-end", () => {
  it("loads outputs from frontmatter and exposes them on AgentConfig", () => {
    const dir = join(tmpdir(), `resolve-outputs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "demo-agent.md"), `---
name: demo-agent
description: demo
outputs:
  foo: string
  status: {enum: [ok, fail]}
---
prompt body
`);

    const config = resolveAgent("demo-agent", { projectDir: dir });

    expect(config.outputs).toEqual({
      foo: "string",
      status: { enum: ["ok", "fail"] },
    });
    expect(config.jsonSchema).toBeDefined();
    expect(JSON.parse(config.jsonSchema!).required).toEqual(["foo", "status"]);
  });
});
```

- [ ] **Step 3: Run test to verify it passes (Task 1.2's plumbing already covers this)**

Run:

```bash
npx vitest run src/cli/tests/agent-outputs-frontmatter.test.ts -t "resolveAgent"
```

Expected: PASS. The test confirms the integration end-to-end. No code change needed because `parseAgentFile` already spreads `...attributes` into `validateAgentConfig`, and Task 1.2 taught the validator to accept and process `outputs`.

- [x] **Step 4: Commit** — done in 4be9ef0.

### Task 1.4: Validator derives `produces` set from agent's `outputs:`

The runtime path doesn't filter LLM output by `produces=` (every JSON key already merges into context). The static `produces` declaration is consumed by the **validator** at `graph.ts:164-184` (computes per-node produced set for flow analysis) and the **default-seed extractor** at `variable-expansion.ts:163-165`. After Chunk 1, agents with `outputs:` get their produced-keys derived automatically — `produces=` on the `.dot` becomes redundant.

- [ ] **Step 1: Read the existing nodeProduces computation**

Run:

```bash
sed -n '160,190p' src/attractor/core/graph.ts
```

Expected: a loop that builds `nodeProduces: Map<string, Set<string>>`, with explicit `node.produces` parsing at the bottom (lines ~180-184).

- [ ] **Step 2: Write a failing validator test**

Create `src/attractor/tests/graph-outputs-derives-produces.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("validator — derive produces from agent outputs", () => {
  it("treats agent's outputs keys as produced when node.produces unset", () => {
    const dir = join(tmpdir(), `produces-derive-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier
outputs:
  preferred_label: {enum: [true, false]}
  summary: string
---
body
`);
    // Downstream node consumes summary; if produces isn't derived from
    // outputs, validator emits missing_input_producer.
    // (For Chunk 1 we test directly via the produced-set, since `inputs:`
    // arrives in Chunk 2. Use the diagnostic that already exists today.)
    const dot = `digraph g {
      v [agent="verifier"]
      v -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const { graph } = parseDot(dot, { dotDir: dir });
    const diags = validateGraph(graph, { dotDir: dir });

    // No errors specifically about "verifier produces nothing"
    expect(diags.find(d => d.rule === "agent_produces_unknown")).toBeUndefined();

    // Internal contract: nodeProduces for "v" should include preferred_label and summary.
    // Expose this via a debug-only export OR assert through downstream behavior.
    // For Chunk 1, assert via the validator's Graph.inputs computation
    // (Graph.inputs = union of all inputs minus internally-produced).
    // After Chunk 2 lands, replace with proper missing_input_producer assertion.
    expect((graph as any).debugProducedKeys?.get("v")).toEqual(
      new Set(["preferred_label", "summary"])
    );
  });

  it("skips derivation when dotDir is undefined (no filesystem context)", () => {
    const dot = `digraph g { v [agent="verifier"]; v -> done; }`;
    const { graph } = parseDot(dot, {});
    const diags = validateGraph(graph, {});  // no dotDir
    // Validator does not throw or emit errors when it can't resolve the agent file.
    expect(diags.every(d => d.rule !== "agent_file_unresolvable")).toBe(true);
  });

  it("falls back to node.produces when agent file has no outputs", () => {
    const dir = join(tmpdir(), `produces-fallback-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "legacy.md"), `---
name: legacy
description: legacy
---
body
`);
    const dot = `digraph g { v [agent="legacy", produces="manual_key"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const { graph } = parseDot(dot, { dotDir: dir });
    validateGraph(graph, { dotDir: dir });
    expect((graph as any).debugProducedKeys?.get("v")).toContain("manual_key");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npx vitest run src/attractor/tests/graph-outputs-derives-produces.test.ts
```

Expected: FAIL — `debugProducedKeys` doesn't exist; nodeProduces isn't exposed. Will need to add an internal debug export OR refactor the assertion to use a downstream observable.

- [ ] **Step 4: Wire the derivation**

In `src/attractor/core/graph.ts`, modify the nodeProduces collection loop at `:164-184`:

```typescript
import { resolveAgent } from "../../cli/lib/agent-registry.js";

// Inside the loop at :164-184, after the `if (typeof node.produces === "string")` block:
if (node.agent && dotDir) {
  try {
    const agentConfig = resolveAgent(node.agent as string, { projectDir: dotDir });
    if (agentConfig.outputs) {
      for (const key of Object.keys(agentConfig.outputs)) {
        produced.add(key);
      }
    }
  } catch {
    // Agent file unresolvable; do not crash the validator.
    // (A separate rule could surface this, but not in Chunk 1.)
  }
}
```

Expose `nodeProduces` for the test via a debug field on the returned Graph:

```typescript
// Near the end of validateGraph, before returning:
// TODO(chunk-2): remove debugProducedKeys once missing_input_producer
// (Chunk 2's flow validator) asserts the derivation through real diagnostics.
(graph as any).debugProducedKeys = nodeProduces;
```

(Production code shouldn't read `debugProducedKeys`; it exists for testability before Chunk 2 introduces proper flow diagnostics.)

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run src/attractor/tests/graph-outputs-derives-produces.test.ts
```

Expected: PASS for all three tests.

- [ ] **Step 6: Run the full graph-validator suite to confirm no regression**

Run:

```bash
npx vitest run src/attractor/tests/graph
```

Expected: all green.

- [x] **Step 7: Commit** — done in b846faf.

### Task 1.5: Validator catches `outputs:` + `jsonSchemaFile=` conflict

- [ ] **Step 1: Write failing validator test**

Create `src/attractor/tests/graph-outputs-conflict.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("validator — outputs/jsonSchemaFile conflict", () => {
  it("emits outputs_and_schema_file_conflict when both are present", () => {
    const dir = join(tmpdir(), `outputs-conflict-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier agent
outputs:
  foo: string
---
prompt body
`);
    const dot = `digraph g {
      v [agent="verifier", json_schema_file="schemas/verifier.json"]
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const { graph } = parseDot(dot, { dotDir: dir });
    const diags = validateGraph(graph, { dotDir: dir });

    expect(diags.some(d =>
      d.rule === "outputs_and_schema_file_conflict" && d.severity === "error"
    )).toBe(true);
  });

  it("emits produces_redundant_with_outputs as warning when redeclared", () => {
    const dir = join(tmpdir(), `produces-redundant-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier agent
outputs:
  foo: string
  bar: number
---
prompt
`);
    const dot = `digraph g {
      v [agent="verifier", produces="foo, bar"]
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const { graph } = parseDot(dot, { dotDir: dir });
    const diags = validateGraph(graph, { dotDir: dir });

    expect(diags.some(d =>
      d.rule === "produces_redundant_with_outputs" && d.severity === "warning"
    )).toBe(true);
  });

  it("does not crash when dotDir is undefined (validator runs without filesystem context)", () => {
    const dot = `digraph g {
      v [agent="some-bundled-agent", json_schema_file="x.json"]
    }`;
    const { graph } = parseDot(dot, {});
    // Should not throw even though dotDir is missing.
    expect(() => validateGraph(graph, {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/attractor/tests/graph-outputs-conflict.test.ts
```

Expected: FAIL — both rules don't yet exist.

- [ ] **Step 3: Add the validator rules using `resolveAgent`**

In `src/attractor/core/graph.ts`, near the existing `script_command_conflict` block at `:300`, add the conflict + redundancy checks. **Use `resolveAgent` (not direct path resolution)** so the helper works for bundled agents in `src/cli/agents/`, project-local agents under `.ralph/agents/`, and (after Chunk 4) per-pipeline agents:

```typescript
import { resolveAgent } from "../../cli/lib/agent-registry.js";

function checkAgentOutputsConflict(
  node: Node,
  dotDir: string | undefined,
  diags: Diagnostic[],
) {
  if (!node.agent) return;

  // Resolve the agent file via the registry (project → user → bundled).
  // dotDir is the project context for the validator pass.
  let agentConfig;
  try {
    agentConfig = resolveAgent(node.agent as string, { projectDir: dotDir });
  } catch {
    // Unresolvable agent — handled by other diagnostics; skip silently here.
    return;
  }
  if (!agentConfig.outputs) return;

  if (node.jsonSchemaFile) {
    diags.push({
      rule: "outputs_and_schema_file_conflict",
      severity: "error",
      message: `Agent "${node.agent}" declares outputs in frontmatter; node also sets json_schema_file=. Remove json_schema_file= (and delete the orphaned schema file).`,
      location: node.sourceLocation,
    });
  }

  if (node.produces) {
    const declared = Object.keys(agentConfig.outputs);
    const onNode = (node.produces as string).split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
    const sameSet = declared.length === onNode.length && declared.every(k => onNode.includes(k));
    if (sameSet) {
      diags.push({
        rule: "produces_redundant_with_outputs",
        severity: "warning",
        message: `produces= on this node is redundant; derived from agent "${node.agent}"'s outputs: keys.`,
        location: node.sourceLocation,
      });
    }
  }
}
```

Call `checkAgentOutputsConflict(node, dotDir, diags)` inside the per-node validation loop. The function is safe to call when `dotDir` is undefined — `resolveAgent` falls back to user/bundled directories.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/attractor/tests/graph-outputs-conflict.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full validator test suite to confirm no regression**

Run:

```bash
npx vitest run src/attractor/tests/graph
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph-outputs-conflict.test.ts
git commit -m "feat(validator): outputs_and_schema_file_conflict + produces_redundant_with_outputs"
```

### Task 1.6: Migrate `verifier.md` end-to-end

This task is the proof: one real agent migrates and the corresponding pipeline still runs.

- [ ] **Step 1: Inspect the current verifier schema**

Run:

```bash
cat pipelines/schemas/verifier.json
```

Note the `properties`, `required`, and `additionalProperties` from the schema.

- [ ] **Step 2: Add `outputs:` to `verifier.md`**

Modify `src/cli/agents/verifier.md` frontmatter — between the `mcp:` block and the closing `---`, add:

```yaml
outputs:
  preferred_label: {enum: ["true", "false", empty]}
  illumination_path: string
  summary: string
  explanation: string
  archive_reason_short: {type: string, maxLength: 100}
```

**YAML reserved-word gotcha (locked by Task 1.1):** `true` / `false` / `yes` / `no` / `null` are parsed as native typed values by js-yaml. The verifier's `preferred_label` is a string enum (per `pipelines/schemas/verifier.json`); migrators MUST quote `"true"` / `"false"` to keep them as strings. Bare `empty` stays a string (not a YAML keyword).

The body of the agent file is unchanged.

- [ ] **Step 3: Remove `json_schema_file=` and `produces=` from the verifier node**

Modify `pipelines/illumination-to-implementation.dot` line 10 — strip `json_schema_file="schemas/verifier.json"` and `produces="..."` from the verifier node. The node should keep its `agent="verifier"`, `prompt="..."`, `default_*=` attrs.

- [ ] **Step 4: Run `pipeline validate` against the modified pipeline**

Run:

```bash
npm run build
node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot
```

Expected: validates green. No `outputs_and_schema_file_conflict` (we removed `json_schema_file=`). No `produces_redundant_with_outputs` (we removed `produces=`).

- [x] **Step 5: Delete the now-orphaned schema** — done.

> **Stale user-dir cache caveat (Chunk 1 → Chunk 4 transition):** `resolveAgent` looks up `~/.ralph/agents/<name>.md` BEFORE the bundled copy. Anyone who ran a verifier pipeline before this commit has a cached `~/.ralph/agents/verifier.md` WITHOUT the new `outputs:` block; that stale copy will be used at runtime and the LLM will emit unconstrained output. Workarounds until Chunk 4's lookup change: (a) `rm ~/.ralph/agents/verifier.md` and let the bundled copy refresh; (b) author copies the new frontmatter into their own user-dir version. Tests bypass the registry to avoid masking authoring slips.

- [ ] **Step 6: Run the engine test suite**

Run:

```bash
npm run test
```

Expected: all green. Specifically, no regressions in `agent-handler-json-constraint.test.ts` (the runtime path still works because we feed the existing `jsonSchema` string field).

- [ ] **Step 7: Live-run the migrated pipeline against a scratch project**

This step proves the migration end-to-end by running the actual pipeline with a real LLM call. Use a scratch project to avoid mutating live state:

```bash
SCRATCH=/tmp/scratch-verifier-$(date +%s)
mkdir -p $SCRATCH/meditations/illuminations
echo '---
status: open
---
# Test illumination
A trivial test illumination.' > $SCRATCH/meditations/illuminations/2026-04-27T1200-test.md

cd $SCRATCH && git init -b main >/dev/null && cd -

node dist/cli/index.js pipeline run pipelines/illumination-to-implementation.dot \
  --project $SCRATCH \
  --var meditations_dir=meditations
```

Expected behavior in the first ~30 seconds: verifier node runs, emits structured JSON containing `preferred_label`, `illumination_path`, `summary`, `explanation`, `archive_reason_short`. These keys appear in the run trace at `~/.ralph/<projectKey>/runs/<runId>/pipeline.jsonl`. If the run reaches the `remove_gate` or `approval_gate` (depending on `preferred_label`), Ctrl-C — the test passes; the verifier produced its keys correctly.

If the verifier crashes with "agent produced no output" or "Structured output parsing failed", the migration broke. Roll back the verifier.md edit and investigate before proceeding.

- [x] **Step 8: Commit** — done in 35ce18a (migration) + 30444d7 (cleanup of dead illumination-to-plan-pipeline test).

### Task 1.7: Chunk-1 review checkpoint

**Chunk 1 status: SHIPPED** — 7 commits + tag `chunk-1-outputs-frontmatter`. All 1129 vitest tests green; typecheck clean. Memory capture pending (post-push).

- [x] **Step 1: Verify the success criteria for the chunk** — all 7 criteria met.

Check that:
1. `parseFrontmatter` returns `outputs` from agent files (Task 1.1)
2. `AgentConfig` carries `outputs` + serialized `jsonSchema` string derived from outputs (Task 1.2)
3. `parseAgentFile` → `resolveAgent` carries outputs end-to-end (Task 1.3)
4. Validator's `nodeProduces` includes keys from agent's `outputs:` block (Task 1.4)
5. Validator catches `outputs_and_schema_file_conflict` + `produces_redundant_with_outputs` + handles `dotDir === undefined` gracefully (Task 1.5)
6. `verifier.md` is fully migrated; `pipelines/schemas/verifier.json` deleted; live run produces verifier keys correctly (Task 1.6)
7. All unit tests green; `pipeline validate` reports no errors on `illumination-to-implementation.dot`

- [x] **Step 2: Run the full test suite** — `1129 passed (1129)`.

- [ ] **Step 3: Hand off chunk to plan-document-reviewer for review** — pending (dispatched in current session after push).

- [x] **Step 4: Tag the chunk in git** — `chunk-1-outputs-frontmatter` (HEAD = 30444d7).

---

## Chunk 2: `inputs:` frontmatter + flow validator (D5)

**Purpose:** Add per-node `inputs:` declaration on agent frontmatter (and address two Chunk-1 carry-overs first), then build the static flow-analysis validator that catches missing producers, branch-incomplete inputs, type mismatches, orphan outputs, and required `--var` keys before any live run. By end of chunk, `verifier.md` declares `inputs:`, the `debugProducedKeys` hack is removed, and `pipeline validate` reports a per-pipeline-folder "required caller vars" banner.

**Codebase facts grounding this chunk** (verified before writing):
- `src/cli/lib/agent.ts:48-58` — `AgentConfig` already carries `outputs?: Record<string, JsonSchemaFragment>` (Chunk 1). Adding `inputs?: string[]` is a 1-line interface extension; `validateAgentConfig` at `:453-478` just needs one more conditional spread.
- `src/cli/lib/agent-registry.ts:35-38` — `parseAgentFile` does `validateAgentConfig({ ...attributes, prompt: body })`. The `inputs:` key flows through automatically once the validator accepts it; only a test is needed.
- `src/attractor/core/schemas.ts:17-34` — `AgentNodeSchema` is `.strict()`. The `inputs:` declaration lives in the agent **.md** frontmatter, NOT on the .dot node. AgentNodeSchema does NOT need a new field. (D5 explicitly rules: "agent declares inputs in its own frontmatter.")
- `src/attractor/core/graph.ts:53` — `validateGraph(graph: Graph, dotDir?: string)` takes **positional `dotDir`** (no opts object). `parseDot(src)` at `:12-14` returns `Graph` directly with **only one arg**. Tests must use `validateGraph(graph, dir)` and `parseDot(dot)`, NOT the opts-object form some Chunk-1 snippets show.
- `src/attractor/core/graph.ts:165-200` — `nodeProduces` is built once per validation pass, including derivation from agent outputs (Chunk 1's wire-up at `:186-198`). The flow analyzer in this chunk consumes the SAME `nodeProduces` map.
- `src/attractor/core/graph.ts:391` — `(graph as any).debugProducedKeys = nodeProduces;` is a TODO scaffold from Chunk 1 (Task 1.4). Task 2.6 replaces it with the real `missing_input_producer` diagnostic and removes the debug field.
- `src/attractor/core/graph.ts:396-440` — `checkAgentOutputsConflict` currently only fires `produces_redundant_with_outputs` on **exact key-set match** (`sameSet` at `:428-431`). D2 intent: ANY `produces=` on an outputs-bearing node is redundant. Task 2.1 escalates this to **error**.
- `src/attractor/transforms/variable-expansion.ts:162-169` — `collectProducers` reads only `node.produces`; agent `outputs:` keys are NOT considered for default-seed extraction. The flow analyzer's "vars in scope" computation must NOT regress this — Task 2.5 tests assert default-seed behavior is unchanged.
- `src/cli/agents/verifier.md:1-25` — current frontmatter has `outputs:` but no `inputs:`. The verifier's prompt at `pipelines/illumination-to-implementation.dot:10` references `$refinements` and `$illuminations_dir` and `$illumination_path` and `$run_id` — those are the inputs to declare in Task 2.11.

**Architectural choice — flow analyzer as a new file:** A new module `src/attractor/core/flow-analyzer.ts` exports `computeVarsInScope(graph, nodeProduces)` returning `Map<nodeId, Set<varName>>`. Justification:
1. `graph.ts` is already 449 lines mixing schema validation, reachability, variable coverage, portability, and script rules. Flow analysis (BFS with set-intersection at converging nodes) is a distinct algorithmic concern.
2. Synthetic Graph fixtures unit-test the analyzer without parsing .dot strings.
3. `variable-expansion.ts` is in `transforms/` (runtime path); static analysis belongs in `core/`.

`validateGraph` adds five rule blocks that read `varsInScope` to produce diagnostics. `varsInScope[node]` is the **intersection** across all DAG paths from start to that node (a var is "in scope" only if every path produces it).

**Deferred to Chunk 4:** Startup warning when `~/.ralph/agents/<name>.md` is older than `getBundledAgentsDir()/<name>.md` (per-pipeline-folder lookup in Chunk 4 obsoletes the user-dir cache for project pipelines anyway).

**Files:**
- Modify: `src/attractor/core/graph.ts:396-440` — broaden `produces_redundant_with_outputs` to fire on any `produces=` presence; escalate to error (Task 2.1).
- Create: `src/attractor/tests/agent-registry-bundled.test.ts` — `resolveAgent("verifier", { bundledDir })` end-to-end test (Task 2.2).
- Modify: `src/cli/lib/agent.ts:48-58` (interface) and `:467-477` (factory) — add `inputs?: string[]` field (Task 2.3).
- Create: `src/cli/tests/agent-inputs-frontmatter.test.ts` — parser + AgentConfig tests for `inputs:` (Task 2.3).
- Create: `src/attractor/tests/agent-registry-inputs.test.ts` — `resolveAgent` end-to-end test for `inputs:` (Task 2.4).
- Create: `src/attractor/core/flow-analyzer.ts` — new module exporting `computeVarsInScope` (Task 2.5).
- Create: `src/attractor/tests/flow-analyzer.test.ts` — unit tests with synthetic graph fixtures (Task 2.5).
- Modify: `src/attractor/core/graph.ts` (near `:380-391`) — call flow analyzer; add `missing_input_producer`, `branch_incomplete_input`, `input_type_mismatch`, `orphan_output`, `required_caller_vars` rules; remove `debugProducedKeys` (Tasks 2.6 — 2.10).
- Create: `src/attractor/tests/graph-inputs-flow.test.ts` — validator rule tests (Tasks 2.6 — 2.10).
- Modify: `src/cli/agents/verifier.md:13-25` — add `inputs:` block (Task 2.11).
- Create: `src/attractor/tests/illumination-pipeline-flow.test.ts` — full-topology test against `pipelines/illumination-to-implementation.dot` (Task 2.12).
- Modify: `src/attractor/tests/graph-outputs-derives-produces.test.ts` — replace `debugProducedKeys` assertions with `missing_input_producer` observations (Task 2.6 fallout).

### Task 2.1: Broaden `produces_redundant_with_outputs` to ANY-presence error (carry-over)

D2 says: when an agent declares `outputs:`, the agent file is the SSoT. Any `produces=` on the calling node is redundant — and worse, divergent (subset / superset / disjoint) `produces=` silently drops or invents keys. Today's `sameSet` check only catches the harmless exact-match case. Escalate to **error** for any presence.

- [x] **Step 1: Read the current rule**

```bash
sed -n '424,440p' src/attractor/core/graph.ts
```

Expected: the existing `if (typeof node.produces === "string" && node.produces.trim().length > 0)` block, with the `sameSet` filter at `:428-431`.

- [x] **Step 2: Write failing tests for subset / superset / disjoint cases**

Create `src/attractor/tests/graph-produces-redundant-broad.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

function setupAgent(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "verifier.md"), `---
name: verifier
description: verifier
outputs:
  foo: string
  bar: number
---
body
`);
}

describe("produces_redundant_with_outputs — broad (D2)", () => {
  it("errors on exact match (was warning before)", () => {
    const dir = join(tmpdir(), `prw-exact-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="foo, bar"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
  });

  it("errors on subset (produces=\"foo\" when outputs has foo+bar)", () => {
    const dir = join(tmpdir(), `prw-subset-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="foo"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/foo/);
  });

  it("errors on superset (produces declares a key the agent does not output)", () => {
    const dir = join(tmpdir(), `prw-super-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="foo, bar, baz"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/baz/);
  });

  it("errors on disjoint (produces declares only keys the agent does not output)", () => {
    const dir = join(tmpdir(), `prw-disjoint-${Date.now()}`);
    setupAgent(dir);
    const dot = `digraph g { v [agent="verifier", produces="qux"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "produces_redundant_with_outputs");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
  });

  it("does not fire when agent has no outputs (legacy nodes still allowed produces=)", () => {
    const dir = join(tmpdir(), `prw-legacy-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "legacy.md"), `---
name: legacy
description: legacy
---
body
`);
    const dot = `digraph g { v [agent="legacy", produces="foo"]; v -> done; }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "produces_redundant_with_outputs")).toBeUndefined();
  });
});
```

- [x] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/attractor/tests/graph-produces-redundant-broad.test.ts
```

Expected: FAIL — exact-match still emits warning (not error); subset/superset/disjoint emit nothing.

- [x] **Step 4: Broaden the rule**

In `src/attractor/core/graph.ts:424-440`, replace the rule body:

```typescript
// produces_redundant_with_outputs — outputs: is SSoT; any produces= on an
// outputs-bearing node is redundant or divergent. Escalated to error per D2.
if (typeof node.produces === "string" && node.produces.trim().length > 0) {
  const declared = new Set(Object.keys(agentConfig.outputs));
  const onNode = node.produces.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
  const extra = onNode.filter(k => !declared.has(k));
  const missing = [...declared].filter(k => !onNode.includes(k));
  let detail: string;
  if (extra.length === 0 && missing.length === 0) {
    detail = `keys are identical to outputs: — drop produces= entirely.`;
  } else if (extra.length > 0 && missing.length === 0) {
    detail = `produces= adds keys the agent does not output: ${extra.join(", ")}.`;
  } else if (missing.length > 0 && extra.length === 0) {
    detail = `produces= drops keys the agent outputs: ${missing.join(", ")}.`;
  } else {
    detail = `produces= diverges from outputs: extra=[${extra.join(", ")}], missing=[${missing.join(", ")}].`;
  }
  diags.push({
    rule: "produces_redundant_with_outputs",
    severity: "error",
    message: `Agent "${node.agent}" declares outputs: in frontmatter (the SSoT). ${detail} Remove produces= from this node.`,
    location: node.sourceLocation,
  });
}
```

- [x] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/attractor/tests/graph-produces-redundant-broad.test.ts
```

Expected: PASS for all 5 tests.

- [x] **Step 6: Run the full validator test suite to confirm no regression**

```bash
npx vitest run src/attractor/tests/graph
```

Expected: all green. The Chunk-1 `graph-outputs-conflict.test.ts` test that asserts `severity === "warning"` for the exact-match case will need to be updated to `severity === "error"` — fix it in the same commit.

- [x] **Step 7: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph-produces-redundant-broad.test.ts src/attractor/tests/graph-outputs-conflict.test.ts
git commit -m "feat(validator): escalate produces_redundant_with_outputs to error and broaden coverage"
```

**Step 8 (added in code review): Whitespace-only produces= early-skip** — `produces=" , , "` (only commas/whitespace) used to fire the rule misleadingly because the outer guard checks `trim().length > 0` (the trimmed `","` is length 1). Added `if (onNode.length === 0) return;` after split/filter, plus a regression test in `graph-produces-redundant-broad.test.ts`. Commit: `fix(validator): produces_redundant_with_outputs ignores whitespace-only produces=` (`20ffb79`).

### Task 2.2: Add `resolveAgent` bundled-registry test for verifier (carry-over) — SHIPPED

The Chunk-1 migration test reads `src/cli/agents/verifier.md` directly. A future bundled-vs-user-dir behavioral change (e.g. Chunk 4's per-pipeline-folder lookup) could regress the registry path silently. Lock the contract with a unit test.

**Plan deviation (intentional):** The original snippet only overrode `bundledDir`. On any developer machine where `~/.ralph/agents/verifier.md` is older than the Chunk-1 bundled copy (i.e. lacks `outputs:`), the registry's `userDir → bundledDir` fall-through returns the stale user copy and the test fails on `config.outputs` being undefined. Solution: also override `userDir` to a fresh `mkdtempSync` path so the registry deterministically falls through to `bundledDir`. Cleaned up via `try/finally rmSync`. This is *more* correct than the plan-as-written — the test no longer depends on developer-machine state.

**Bonus finding (not blocking):** Existing `~/.ralph/agents/verifier.md` copies in the wild are stale because Chunk-1 only updated the bundled file; the registry never re-syncs once user has a copy (lines 54-57 short-circuit). If users hit "verifier returns no JSON", they need to delete the user copy to let the registry re-copy from bundled. Worth flagging in the Chunk-2 review checkpoint or the post-merge migration note. Not a blocker for this task.

- [x] **Step 1: Read the registry signature** — confirmed `resolveAgent(name, opts)` searches `projectDir → userDir → bundledDir`; bundled fallback `mkdirSync(userDir, recursive)` + `copyFileSync(bundled→user)` runs as a side effect when user copy is absent.

- [x] **Step 2: Write failing test** — created `src/attractor/tests/agent-registry-bundled.test.ts` with hermetic `userDir` override (`mkdtempSync`/`rmSync` cleanup). First-run state: red (config.outputs undefined when user copy was stale, before the userDir override was added). After deviation: green.

- [x] **Step 3: Run test to verify it passes** — `npx vitest run src/attractor/tests/agent-registry-bundled.test.ts` → 1 passed. Full suite: 1136 passed; `npx tsc --noEmit` clean.

- [x] **Step 4: Commit** — pending in current session (next).

### Task 2.3: `inputs:` parses through frontmatter → AgentConfig

Mirror Task 1.1+1.2 — but the parser already handles arrays (`gray-matter` → `js-yaml`), so this is mostly a 1-line interface + factory extension.

- [x] **Step 1: Read the AgentConfig and validateAgentConfig**

```bash
sed -n '48,58p' src/cli/lib/agent.ts
sed -n '453,478p' src/cli/lib/agent.ts
```

Expected: AgentConfig with `outputs?` at line 57; factory ending in conditional spreads at line 476.

- [x] **Step 2: Write failing tests**

Create `src/cli/tests/agent-inputs-frontmatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { validateAgentConfig } from "../lib/agent.js";

describe("parseFrontmatter — inputs block", () => {
  it("parses inputs: as a string array", () => {
    const input = `---
name: a
inputs:
  - illumination_path
  - refinements
  - run_id
---
body`;
    const { attributes } = parseFrontmatter(input);
    expect(attributes.inputs).toEqual(["illumination_path", "refinements", "run_id"]);
  });

  it("returns no inputs key when frontmatter omits it", () => {
    const { attributes } = parseFrontmatter(`---
name: a
---
body`);
    expect(attributes.inputs).toBeUndefined();
  });
});

describe("validateAgentConfig — inputs", () => {
  it("attaches inputs array to AgentConfig", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      inputs: ["foo", "bar"],
      prompt: "",
    } as any);
    expect(config.inputs).toEqual(["foo", "bar"]);
  });

  it("does not set inputs when absent (legacy agents)", () => {
    const config = validateAgentConfig({
      name: "legacy", description: "legacy",
      prompt: "",
    } as any);
    expect(config.inputs).toBeUndefined();
  });

  it("treats empty inputs array as valid (zero-input agent)", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      inputs: [],
      prompt: "",
    } as any);
    expect(config.inputs).toEqual([]);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/cli/tests/agent-inputs-frontmatter.test.ts
```

Expected: FAIL — `config.inputs` is undefined (factory drops the field).

- [x] **Step 4: Extend interface and factory**

In `src/cli/lib/agent.ts:48-58`, add to the AgentConfig interface:

```typescript
export interface AgentConfig {
  // ... existing fields ...
  outputs?: Record<string, JsonSchemaFragment>;
  inputs?: string[];
}
```

In `validateAgentConfig` at `:467-477`, add one more conditional spread:

```typescript
return {
  // ... existing fields, jsonSchema spread, outputs spread ...
  ...(config.inputs !== undefined ? { inputs: config.inputs } : {}),
};
```

- [x] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/cli/tests/agent-inputs-frontmatter.test.ts
```

Expected: PASS for all 5 tests.

- [x] **Step 6: Run full agent test suite**

```bash
npx vitest run src/cli/tests
```

Expected: all green.

- [x] **Step 7: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent-inputs-frontmatter.test.ts
git commit -m "feat(agent): inputs: frontmatter field on AgentConfig"
```

### Task 2.4: `parseAgentFile` / `resolveAgent` carry `inputs:` end-to-end

Mirror Task 1.3 — verification-only. `parseAgentFile` already spreads `...attributes` into `validateAgentConfig`; once the validator accepts `inputs:`, the registry path works automatically.

- [x] **Step 1: Write failing integration test**

Create `src/attractor/tests/agent-registry-inputs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAgent } from "../../cli/lib/agent-registry.js";

describe("resolveAgent — inputs end-to-end", () => {
  it("loads inputs from frontmatter and exposes them on AgentConfig", () => {
    const dir = join(tmpdir(), `resolve-inputs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "demo-agent.md"), `---
name: demo-agent
description: demo
inputs:
  - illumination_path
  - run_id
outputs:
  status: {enum: [ok, fail]}
---
prompt body
`);

    const config = resolveAgent("demo-agent", { projectDir: dir });
    expect(config.inputs).toEqual(["illumination_path", "run_id"]);
    expect(config.outputs).toBeDefined();
  });
});
```

- [x] **Step 2: Run test to verify it passes (Task 2.3's plumbing covers this)**

```bash
npx vitest run src/attractor/tests/agent-registry-inputs.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/attractor/tests/agent-registry-inputs.test.ts
git commit -m "test(agent-registry): inputs: flows through resolveAgent"
```

### Task 2.5: Flow analyzer scaffolding (`computeVarsInScope`)

Create `src/attractor/core/flow-analyzer.ts`. The analyzer walks the DAG and computes per-node "vars in scope" — the **intersection** across all paths from start to that node of the union of upstream produced sets. A var is in scope at node N only if every path to N produces it.

**Algorithm:** Topological-order pass with set-merge at converging nodes:
1. Initialize `varsInScope[start] = callerInputs` (the `inputs="..."` on the digraph).
2. For each node in topo order: `varsInScope[node] = ⋂(varsInScope[pred] ∪ produces[pred])` over all `pred` that have an edge to `node`. (Intersection across predecessors — pessimistic, models "every path must produce".) For nodes with `default_<key>=`, the key is added to the in-scope set unconditionally.
3. Cycles (retry loops): break by treating back-edges as "no contribution" on the first pass. (D5 doesn't require fixed-point iteration; the validator can warn if a back-edge node introduces a key its forward-path predecessors don't.)

- [x] **Step 1: Write failing tests with synthetic graph fixtures**

Create `src/attractor/tests/flow-analyzer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeVarsInScope } from "../core/flow-analyzer.js";
import type { Graph } from "../types.js";

function mkGraph(
  nodes: { id: string; produces?: string[]; defaults?: string[] }[],
  edges: [string, string][],
  callerInputs: string[] = [],
): { graph: Graph; nodeProduces: Map<string, Set<string>> } {
  const nodeMap = new Map();
  const nodeProduces = new Map<string, Set<string>>();
  for (const n of nodes) {
    const nodeObj: any = { id: n.id, sourceLocation: { line: 1, file: "test.dot" } };
    for (const d of n.defaults ?? []) {
      // Use snake_case key form — matches actual Node attribute shape
      nodeObj[`default_${d}`] = "x";
    }
    nodeMap.set(n.id, nodeObj);
    nodeProduces.set(n.id, new Set(n.produces ?? []));
  }
  const graph: Graph = {
    nodes: nodeMap,
    edges: edges.map(([from, to]) => ({ from, to, sourceLocation: { line: 1, file: "test.dot" } })),
    inputs: callerInputs,
  } as any;
  return { graph, nodeProduces };
}

describe("computeVarsInScope", () => {
  it("linear chain: each node sees union of upstream produces", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo"] },
        { id: "b", produces: ["bar"] },
        { id: "c" },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "b"], ["b", "c"], ["c", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toEqual(new Set());
    expect(scope.get("b")).toEqual(new Set(["foo"]));
    expect(scope.get("c")).toEqual(new Set(["foo", "bar"]));
  });

  it("converging branches: intersection — only vars produced on EVERY path are in scope", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo", "bar"] },
        { id: "b", produces: ["foo"] },
        { id: "c" },
        { id: "exit" },
      ],
      [["start", "a"], ["start", "b"], ["a", "c"], ["b", "c"], ["c", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("c")).toEqual(new Set(["foo"]));
  });

  it("default_<key>= adds the key unconditionally, even when not all branches produce", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo"] },
        { id: "b" },
        { id: "c", defaults: ["foo"] },
        { id: "exit" },
      ],
      [["start", "a"], ["start", "b"], ["a", "c"], ["b", "c"], ["c", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("c")).toContain("foo");
  });

  it("caller inputs are in scope from start onwards", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a" },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "exit"]],
      ["project", "run_id"],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toEqual(new Set(["project", "run_id"]));
  });

  it("cycle (retry loop): back-edge does not contribute to forward scope", () => {
    const { graph, nodeProduces } = mkGraph(
      [
        { id: "start" },
        { id: "a", produces: ["foo"] },
        { id: "b", produces: ["bar"] },
        { id: "exit" },
      ],
      [["start", "a"], ["a", "b"], ["b", "a"], ["b", "exit"]],
    );
    const scope = computeVarsInScope(graph, nodeProduces);
    expect(scope.get("a")).toEqual(new Set());
    expect(scope.get("b")).toEqual(new Set(["foo"]));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/attractor/tests/flow-analyzer.test.ts
```

Expected: FAIL — module does not exist.

- [x] **Step 3: Implement `flow-analyzer.ts`**

Create `src/attractor/core/flow-analyzer.ts`:

```typescript
import type { Graph } from "../types.js";

/**
 * Compute the set of variable names in scope at each node.
 *
 * "In scope at N" means: there is some declaration on every path from the start
 * node to N that makes the variable available. This is the intersection
 * across predecessors of (predecessor's in-scope ∪ predecessor's produces).
 *
 * Caller inputs (graph.inputs) are in scope from the start node onward.
 *
 * default_<key>= on a node adds that key to its in-scope set unconditionally,
 * regardless of whether incoming branches produce it.
 *
 * Cycles are handled by computing a forward-only topological order; back-edges
 * do not contribute on the first pass. Retry-loop branches (e.g. implement →
 * implement on agent.success=false) thus see only their forward-path scope.
 */
export function computeVarsInScope(
  graph: Graph,
  nodeProduces: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const { nodes, edges } = graph;
  const callerInputs = new Set<string>(
    Array.isArray((graph as any).inputs) ? (graph as any).inputs : [],
  );

  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const id of nodes.keys()) { fwd.set(id, []); rev.set(id, []); }
  for (const e of edges) {
    if (fwd.has(e.from) && fwd.has(e.to)) {
      fwd.get(e.from)!.push(e.to);
      rev.get(e.to)!.push(e.from);
    }
  }

  const inDegree = new Map<string, number>();
  for (const [id, preds] of rev) inDegree.set(id, preds.length);
  const startId = [...nodes.values()].find(n =>
    n.shape === "Mdiamond" || n.id === "start"
  )?.id;
  const queue: string[] = startId ? [startId] : [];
  const topo: string[] = [];
  const visitedIn = new Map(inDegree);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    topo.push(cur);
    for (const next of fwd.get(cur) ?? []) {
      const d = (visitedIn.get(next) ?? 0) - 1;
      visitedIn.set(next, d);
      if (d <= 0) queue.push(next);
    }
  }
  for (const id of nodes.keys()) {
    if (!topo.includes(id)) topo.push(id);
  }

  const scope = new Map<string, Set<string>>();
  for (const id of topo) {
    const node = nodes.get(id);
    if (!node) continue;

    let nodeScope: Set<string>;
    if (id === startId) {
      nodeScope = new Set(callerInputs);
    } else {
      const visitedPreds = (rev.get(id) ?? []).filter(p => scope.has(p));
      if (visitedPreds.length === 0) {
        nodeScope = new Set();
      } else {
        let intersected: Set<string> | null = null;
        for (const pred of visitedPreds) {
          const predUnion = new Set([
            ...scope.get(pred)!,
            ...(nodeProduces.get(pred) ?? []),
          ]);
          if (intersected === null) {
            intersected = new Set(predUnion);
          } else {
            for (const v of [...intersected]) {
              if (!predUnion.has(v)) intersected.delete(v);
            }
          }
        }
        nodeScope = intersected ?? new Set();
      }
    }

    for (const attrKey of Object.keys(node)) {
      if (attrKey.startsWith("default_") && attrKey.length > 8) {
        nodeScope.add(attrKey.slice(8));
      }
    }

    scope.set(id, nodeScope);
  }

  return scope;
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/attractor/tests/flow-analyzer.test.ts
```

Expected: PASS for all 5 tests. The key form for default-attributes (snake_case `default_foo` vs camelCase `defaultFoo`) must match how `parseDot` actually exposes them — verify via the existing `Node` type before locking the test.

- [x] **Step 5: Commit**

```bash
git add src/attractor/core/flow-analyzer.ts src/attractor/tests/flow-analyzer.test.ts
git commit -m "feat(validator): flow-analyzer computes per-node varsInScope"
```

### Task 2.6: Validator rule `missing_input_producer` (replaces `debugProducedKeys`)

Now the analyzer is in place, replace the Chunk-1 `debugProducedKeys` hack with the real diagnostic. An agent node's declared `inputs:` keys must all appear in the node's `varsInScope` set; otherwise emit `missing_input_producer` (error).

- [x] **Step 1: Read the current debug scaffold** — `(graph as any).debugProducedKeys = nodeProduces` confirmed at the location specified.

```bash
sed -n '388,394p' src/attractor/core/graph.ts
```

Expected: the `(graph as any).debugProducedKeys = nodeProduces` line.

- [x] **Step 2: Write failing test** — `graph-inputs-flow.test.ts` created with 3 cases (4th `default_<key>=` case added in 94f3b41).

Create `src/attractor/tests/graph-inputs-flow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("validator — missing_input_producer", () => {
  it("errors when an agent's declared input has no producer on every path", () => {
    const dir = join(tmpdir(), `mip-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs foo
inputs:
  - foo
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(d => d.rule === "missing_input_producer");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/foo/);
  });

  it("does not fire when an upstream node produces the input", () => {
    const dir = join(tmpdir(), `mip-ok-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "producer.md"), `---
name: producer
description: produces foo
outputs:
  foo: string
---
body
`);
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs foo
inputs:
  - foo
---
body
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });

  it("caller-input on the digraph satisfies the requirement", () => {
    const dir = join(tmpdir(), `mip-caller-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "consumer.md"), `---
name: consumer
description: needs project
inputs:
  - project
---
body
`);
    const dot = `digraph g {
      inputs="project"
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "missing_input_producer")).toBeUndefined();
  });
});
```

- [x] **Step 3: Run test to verify it fails** — first case failed as expected (rule didn't exist); other two passed because the absence assertion holds vacuously.

```bash
npx vitest run src/attractor/tests/graph-inputs-flow.test.ts -t "missing_input_producer"
```

Expected: FAIL — rule doesn't exist.

- [x] **Step 4: Implement the rule and remove `debugProducedKeys`** — done in `df5a755`. Refactored to extracted helpers (`tryResolveAgent`, `checkMissingInputProducer`) in `94f3b41` per code review.

In `src/attractor/core/graph.ts`, before `(graph as any).debugProducedKeys = ...` at `:391`, add an import and rule block:

```typescript
import { computeVarsInScope } from "./flow-analyzer.js";

// ... inside validateGraph, after the nodeProduces loop:

const varsInScope = computeVarsInScope(graph, nodeProduces);

for (const [id, node] of nodes) {
  if (!node.agent || !dotDir) continue;
  let agentConfig;
  try {
    agentConfig = resolveAgent(node.agent as string, { projectDir: dotDir });
  } catch {
    continue;
  }
  if (!agentConfig.inputs) continue;
  const scope = varsInScope.get(id) ?? new Set<string>();
  for (const inputKey of agentConfig.inputs) {
    if (!scope.has(inputKey)) {
      diags.push({
        rule: "missing_input_producer",
        severity: "error",
        message: `Agent "${node.agent}" at node "${id}" requires input "${inputKey}" but no upstream node produces it on every path. Either route through a producer, declare default_${inputKey}= on this node, or add "${inputKey}" to the digraph's inputs="..." for caller-supplied vars.`,
        location: node.sourceLocation,
      });
    }
  }
}
```

Remove the line:

```typescript
(graph as any).debugProducedKeys = nodeProduces;
```

…and the TODO comment above it.

- [x] **Step 5: Run test to verify it passes** — `graph-inputs-flow.test.ts` 4 passed.

```bash
npx vitest run src/attractor/tests/graph-inputs-flow.test.ts -t "missing_input_producer"
```

Expected: PASS.

- [x] **Step 6: Update Chunk-1 fallout — `graph-outputs-derives-produces.test.ts`** — assertions on `(graph as any).debugProducedKeys` replaced with `missing_input_producer`-absence checks driven by a downstream consumer node.

The Chunk-1 test file uses `(graph as any).debugProducedKeys`. Replace those assertions with `missing_input_producer` observations: synthesize a downstream `inputs: [<key>]` consumer and assert NO `missing_input_producer` is emitted (proving the derivation works).

```bash
npx vitest run src/attractor/tests/graph-outputs-derives-produces.test.ts
```

Expected: PASS after refactor.

- [x] **Step 7: Run full validator suite** — 7 files, 113 tests passed; `npx tsc --noEmit` exit 0.

```bash
npx vitest run src/attractor/tests/graph
```

Expected: all green.

- [x] **Step 8: Commit** — done in `df5a755` (initial implementation) + `94f3b41` (helper extraction per code review).

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph-inputs-flow.test.ts src/attractor/tests/graph-outputs-derives-produces.test.ts
git commit -m "feat(validator): missing_input_producer (replaces debugProducedKeys hack)"
```

### Task 2.7: Validator rule `branch_incomplete_input` — SHIPPED

When some (but not all) paths to a consumer produce an input key, emit `branch_incomplete_input` — UNLESS the consumer has `default_<key>=`. (Distinct from `missing_input_producer`, which fires when NO path produces the key.)

- [x] **Step 1: Add failing tests to `graph-inputs-flow.test.ts`** — diamond with one producing branch (RED), both producing, default_<key>= suppression, and no-producer regression (still emits `missing_input_producer`, NOT `branch_incomplete_input`).

- [x] **Step 2 — 5: Standard TDD pattern** — RED confirmed (1 fail), implemented, GREEN: 8/8 tests in file, full suite 1156/1156.

Implementation: added `computeVarsInAnyScope` (union-semantics sibling of `computeVarsInScope`) in `flow-analyzer.ts`; factored shared body via `computeScope(combine: "intersect" | "union")`. In `checkMissingInputProducer` (graph.ts), when `scope.has(inputKey)` is FALSE, branch on `anyScope.has(inputKey)`: hit → `branch_incomplete_input`, miss → `missing_input_producer`. `default_<key>=` keeps adding to nodeScope so it suppresses both rules naturally.

- [x] **Step 6: Commit** (this commit)

### Task 2.8: Validator rule `input_type_mismatch` — SHIPPED 2026-04-27

When a downstream `condition="key=value"` references an output key, validate that `value` is in the producer's `enum` (when the output declares one). Catches typos like `condition="preferred_label=tru"`.

- [x] **Step 1 — 6: Standard TDD cycle.** RED → GREEN: 7 new tests under `describe("validator — input_type_mismatch")` in `src/attractor/tests/graph-inputs-flow.test.ts` (enum mismatch errors, in-enum passes, no-enum producer skips, `outcome=` ignored, compound `&&` typo caught, `!=` membership checked, single-quote stripping). File suite 15/15 PASS; full suite 1163/1163 PASS; `npx tsc --noEmit` clean.

Implementation: added module-level `parseConditionClauses` helper to `src/attractor/core/conditions.ts` exporting `ConditionClause = {key, op: '=' | '!=', val}` (refactored `evaluateCondition` to use it — single source of truth for clause parsing, validator + runtime now share). Added `checkInputTypeMismatch` rule in `src/attractor/core/graph.ts`, called from `validateGraph` only when `dotDir` is provided (alongside `checkMissingInputProducer`). Rule walks `graph.edges`, parses each `condition=` into clauses, and for each non-`outcome` clause looks up agent declarations of `outputs.<key>.enum`; errors when value not in any declared enum. Behaviors: `outcome=` clauses skipped (pipeline-level status, separate semantics); `!=` operator also validates membership (catches typos on negative match); single quotes around value stripped before comparison (matches existing `evaluateClause` behavior). Diagnostic shape: `{rule: "input_type_mismatch", severity: "error", message: 'Edge "X" -> "Y" condition uses "key=val" but agent "A" declares outputs.key.enum=["a","b"]; "val" is not a member. Fix the condition value or update the enum.', location: edge.sourceLocation}`.

- [x] **Step 7: Commit** — done in `<commit-sha>`.

```bash
git commit -m "feat(validator): input_type_mismatch rule (enum value check)"
```

### Task 2.9: Validator rule `orphan_output` (warning) — SHIPPED 2026-04-27

When an agent's `outputs:` includes a key that no downstream node consumes (via `inputs:`, `condition=`, or `$key` references in prompts/labels), emit a `warning`-severity diagnostic. Catches stale schema entries.

Implementation lives in `checkOrphanOutput` (`src/attractor/core/graph.ts`), wired inside the existing `if (dotDir)` block alongside `checkMissingInputProducer` / `checkInputTypeMismatch`. Tests: `src/attractor/tests/graph-orphan-output.test.ts` (7 cases — orphan detection, all 3 consumption channels, multi-output partial-orphan, no-dotDir skip).

Verified clean on `pipelines/illumination-to-implementation.dot` — no orphan warnings emitted on the live graph.

### Task 2.10: Validator rule `required_caller_vars` (info-level banner) — SHIPPED 2026-04-27

Implemented in `checkRequiredCallerVars` (`src/attractor/core/graph.ts:498-552`) — computes `(graph.inputs ∪ agent_inputs_consumed_anywhere) MINUS internally_produced MINUS RESERVED_VARS`, emits a single `severity:"info"` diagnostic with `rule:"required_caller_vars"` listing sorted keys when the set is non-empty. Called at the end of `validateGraph` after the `if (dotDir)` block. Diagnostic message: `"This pipeline requires the following --var keys at runtime: <keys>"`.

CLI print loop patched in `src/cli/commands/pipeline.ts:215,219` — info diagnostics now print first via `output.info()`, before warnings and errors. Tests: `src/attractor/tests/graph-required-caller-vars.test.ts` (6 cases — empty graph, all internally produced, `graph.inputs=` listed, RESERVED excluded, agent `inputs:` unproduced var listed, internally-produced var excluded). Diagnostic union in `src/attractor/types.ts:96` extended to include `"info"`.

Commit: `b7e5692`. All 1176 tests pass; typecheck clean.

### Task 2.11: Migrate `verifier.md` to declare `inputs:` — SHIPPED 2026-04-27

Now that all five rules are in place, migrate the verifier. Per `pipelines/illumination-to-implementation.dot:10`, the verifier's prompt references `$refinements`, `$illuminations_dir`, `$illumination_path`, `$run_id`. Declare these.

- [x] **Step 1: Inspect current frontmatter**

```bash
sed -n '1,25p' src/cli/agents/verifier.md
```

Confirmed: frontmatter had `name`, `description`, `model`, `permissionMode`, `tools`, `mcp`, `outputs` — no `inputs:` block.

- [x] **Step 2: Add `inputs:` block**

Modify `src/cli/agents/verifier.md` frontmatter — between `mcp:` and `outputs:`:

```yaml
inputs:
  - illuminations_dir
  - illumination_path
  - refinements
  - run_id
```

- [x] **Step 3: Run `pipeline validate` against the modified pipeline**

```bash
npm run build
node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot
```

Result: `✔ Pipeline valid (18 nodes, 27 edges)` — zero errors. Pre-existing `variable_coverage` warnings present (unrelated to this task). No `inputs_undeclared` errors for verifier node.

- [ ] **Step 4: Live-run the migrated pipeline** (mirror Task 1.6 Step 7 — scratch project, ~30 second cap). SKIPPED — validate passed cleanly; live-run skipped per task instructions to avoid spawning external Claude sessions in sandbox.

- [x] **Step 5: Commit**

```bash
git add src/cli/agents/verifier.md
git commit -m "feat(verifier): declare inputs: in frontmatter (D5 migration)"
```

Commit: `534b1ea`.

### Task 2.12: Test against `illumination-to-implementation.dot`'s full topology — SHIPPED 2026-04-27

The pipeline has conditional edges (`preferred_label=true|false|empty`), retry loops (`implement → implement on agent.success=false`), default fallbacks (`default_refinements=""`, `default_test_result=""`), gates with multi-choice `label=`s, and chat loop-back edges (`chat_summarizer → verifier`). Lock the validator's behavior on this real-world graph.

- [x] **Step 1: Write integration test**

Create `src/attractor/tests/illumination-pipeline-flow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

describe("illumination-to-implementation.dot — full flow validation", () => {
  it("validates clean (no errors) on the live pipeline post-migration", () => {
    const root = resolve(__dirname, "../../..");
    const dotPath = resolve(root, "pipelines/illumination-to-implementation.dot");
    const dotDir = resolve(root, "pipelines");
    const dot = readFileSync(dotPath, "utf-8");
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dotDir);
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("emits required_caller_vars info banner listing project, illuminations_dir, etc.", () => {
    // assertion on info-level diagnostic
  });

  it("does NOT emit branch_incomplete_input for $refinements (covered by default_refinements=)", () => {
    // assertion
  });

  it("retry loop on implement does NOT trip flow rules", () => {
    // The implement → implement cycle. Back-edge is ignored by the analyzer.
    // assertion
  });
});
```

- [x] **Step 2 — 5: TDD cycle.** If the live pipeline fails any rule, that's a real bug to address before locking the test.

- [x] **Step 6: Commit**

```bash
git commit -m "test(pipeline): full-topology validation of illumination-to-implementation.dot"
```

**Surprises captured:** None. The live pipeline validated clean on the first run after Task 2.11's verifier migration — zero errors, one `required_caller_vars` info banner (`illuminations_dir, plans_dir, specs_dir`; `$project` correctly excluded as RESERVED), and 22 pre-existing `variable_coverage` warnings (unrelated to flow rules; tracked separately). The four tricky topology constructs all behave as designed:
- Conditional edges (`preferred_label=true|false|empty`) — `input_type_mismatch` does not fire because the verifier's `outputs.preferred_label.enum` covers all three values.
- `implement → implement` retry back-edge — flow analyzer's BFS visits each node once, so the back-edge contributes nothing to the consumer's upstream set; no `missing_input_producer`/`branch_incomplete_input` blames the `implement` node.
- `default_refinements=""` on `verifier`, `explainer`, `approval_gate`, `chat_session`, `chat_summarizer` — `hasDefault()` short-circuits the flow check before it can fire `branch_incomplete_input`.
- Gate multi-choice `label=`s + chat loop-back edges — neither construct emits a flow diagnostic; gate `<nodeId>.choice` keys are produced via the `wait.human` augmentation in `nodeProduces`.

The four locked assertions in `src/attractor/tests/illumination-pipeline-flow.test.ts` are real and falsifiable: dropping `inputs:` from `verifier.md` would break test 1; deleting `$project` from RESERVED_VARS would break test 2; removing any `default_refinements=""` on a converging branch would break test 3; turning the retry edge into a non-back-edge requirement would break test 4.

### Task 2.13: Chunk-2 review checkpoint — SHIPPED 2026-04-27

**Chunk 2 status: SHIPPED** — all 13 tasks complete, tag `chunk-2-inputs-flow-validator`. 1180/1180 vitest tests green; `tsc --noEmit` clean. plan-document-reviewer APPROVED with diff-pinned evidence per criterion.

- [x] **Step 1: Verify the success criteria for the chunk** — all 8 criteria proven by `git show <sha> -- file` evidence (see plan-document-reviewer report).

Check that:
1. `produces_redundant_with_outputs` errors on subset/superset/disjoint, not just exact match (Task 2.1) — proven `5b869b7` (`graph.ts` ~L421-449)
2. `resolveAgent("verifier", { bundledDir })` end-to-end test in place (Task 2.2) — proven `19f3244` (`agent-registry-bundled.test.ts`)
3. `AgentConfig.inputs?: string[]` carries through frontmatter → registry → AgentConfig (Tasks 2.3, 2.4) — proven `b709611` + `b1b7e1e`
4. `flow-analyzer.ts` exports `computeVarsInScope` with correct intersection-at-converging-branches semantics (Task 2.5) — proven `389c468`
5. `missing_input_producer` rule is in place; `debugProducedKeys` hack is removed (Task 2.6) — proven `df5a755`
6. `branch_incomplete_input`, `input_type_mismatch`, `orphan_output`, `required_caller_vars` rules are in place (Tasks 2.7 — 2.10) — proven `113dd4d`, `8c3ee63`, `e111804`, `b7e5692`
7. `verifier.md` declares `inputs:`; pipeline validates green (Task 2.11) — proven `534b1ea` (`verifier.md:19-23`)
8. Full-topology test against `illumination-to-implementation.dot` is green (Task 2.12) — proven `7b38afc`

- [x] **Step 2: Run the full test suite** — `Test Files 105 passed (105)` / `Tests 1180 passed (1180)`; `tsc --noEmit` exit 0.

- [x] **Step 3: Hand off chunk to plan-document-reviewer for review** — APPROVED.

- [x] **Step 4: Tag the chunk in git** — `chunk-2-inputs-flow-validator`.

**Surprises to capture in Chunk-2 memory file** (mirror Chunk 1's pattern):
- Whether `condition="key=value"` parsing in `graph.ts` exposes the LHS/RHS in a structured form (Task 2.8 prereq). **Resolved (2026-04-27, Task 2.8):** parsing was buried inside `evaluateClause` (runtime-only). Extracted to module-level `parseConditionClauses` in `src/attractor/core/conditions.ts` exporting `ConditionClause = {key, op, val}` so validator + runtime now share the same parser → no drift. Refactored `evaluateCondition` to consume the helper.
- Whether the CLI's `pipeline validate` command currently prints info-level diagnostics (Task 2.10 prereq). **Resolved (2026-04-27, Task 2.10):** the print loop in `src/cli/commands/pipeline.ts:215,219` filtered to `warning|error` only — patched in-task to print info diagnostics first via `output.info()`. Also extended `Diagnostic.severity` union in `src/attractor/types.ts` to admit `"info"`. Minor DRY follow-up noted by both reviewers: `RESERVED` set is duplicated locally in `validateGraph` (graph.ts:150) and `checkRequiredCallerVars` (graph.ts:518) — hoist to module-level constant when next validator needs it.
- Whether any other bundled agent (besides verifier) has `outputs:` and would now trip the broadened `produces_redundant_with_outputs` rule.

**Known carry-over / flaky test (root-cause later):**
- `src/cli/tests/pipeline-app-integration.test.tsx` flips on parallel timing (React 18 batched dispatch). Verified pre-existing during Task 2.8 by stash/run/unstash — passes in isolation and on subsequent runs. Worth hardening in a follow-up.

---

## Chunk 3: gates as `.md` files (D3) — SHIPPED 2026-04-27

**Status:** All 9 tasks shipped. Tag `chunk-3-gates-as-md`. 9 commits (`f95821e`..`bf5f080`). Full suite 1202/1202 green; `pipeline validate pipelines/illumination-to-implementation.dot` reports zero errors.

**One unplanned change:** `GateNodeSchema.label` was made optional during Task 3.5 (was required). The schema-level requirement was redundant once `gate_handler_missing` rule exists — semantic enforcement now lives in the validator. Smoke gate (`pipelines/smoke/gate.dot`) still passes (its inline `label=` satisfies the optional schema; gate_handler_missing doesn't fire because label is present).

**Purpose:** Move gate prompts out of `.dot` `label=` attributes into sibling `<node-id>.md` files. Gates self-describe `choices`, `inputs:`, and `outputs:` via YAML frontmatter — matching the agent file shape. The `.dot` keeps `shape=hexagon` (the existing handler discriminator); the new `type: gate` lives only inside the `.md` frontmatter. Inline `label=` remains supported for backward compatibility (smoke fixtures + simple cases).

**Codebase facts grounding this chunk** (verified before writing):
- `WaitHumanHandler` (src/attractor/handlers/wait-human.ts:9-52) reads `node.label ?? node.id` and presents it via `Interviewer.ask` as a MULTIPLE_CHOICE prompt. The handler does NOT know its `.dot` directory today — `dotDir` is not threaded through `EngineOptions` to the handler.
- Engine dispatcher (src/attractor/core/engine.ts:46-63) builds a handler map at startup. `resolveHandlerType` (src/attractor/core/graph.ts:32-45) maps `shape=hexagon` → `wait.human`.
- `parseFrontmatter` (src/cli/lib/frontmatter.ts:1-11) returns `{ attributes, body }` from any file via gray-matter.
- `resolveAgent` (src/cli/lib/agent-registry.ts:35-67) shows the file-resolution pattern: `projectDir → userDir → bundledDir`. Gates live alongside the `.dot` and have NO bundled fallback (gates are always project-specific) — so the resolver is simpler.
- Gate produces (src/attractor/core/graph.ts:155-180) already emit `<id>.choice` + `choice` alias unconditionally — no change needed for that.
- Existing schemas (src/attractor/core/schemas.ts:52-55) — `GateNodeSchema` describes the `.dot` node (shape=hexagon, label optional after this chunk). The new `GateMdFrontmatterSchema` describes the sibling `.md` file's frontmatter — different artifact.
- Pipeline files live at `pipelines/<name>.dot` (per-folder migration is Chunk 4). For Chunk 3, gate `.md` siblings land at `pipelines/<gate-id>.md`.

**Architecture:** Eight tasks. Tasks 3.1-3.4 land schema + loader + handler wiring + validator rule (the plumbing). Tasks 3.5-3.8 migrate the four gates in `illumination-to-implementation.dot` (one task per gate, each its own commit so a regression is bisectable). Task 3.9 is the chunk review checkpoint.

**Dependencies:** Chunks 1 + 2 (so gates can self-describe their `outputs:` + `inputs:` via the same plumbing already wired for agents).

**Backward-compat invariant:** `pipelines/smoke/gate.dot` keeps its inline `label=` and continues to pass — the inline-label code path is preserved, not replaced.

---

### Task 3.1: `GateMdFrontmatterSchema` in `schemas.ts` — SHIPPED `f95821e`

Define the Zod schema for the gate `.md` frontmatter so downstream loaders / validators have a single source of truth.

- [ ] **Step 1: Add a failing test in `src/attractor/tests/schemas.test.ts`**

```typescript
describe("GateMdFrontmatterSchema", () => {
  it("accepts type=gate with choices and optional inputs", () => {
    const parsed = GateMdFrontmatterSchema.parse({
      type: "gate",
      choices: ["Approve", "Reject", "Chat"],
      inputs: ["plan_path"],
    });
    expect(parsed.choices).toEqual(["Approve", "Reject", "Chat"]);
    expect(parsed.inputs).toEqual(["plan_path"]);
  });

  it("rejects empty choices array", () => {
    expect(() => GateMdFrontmatterSchema.parse({ type: "gate", choices: [] }))
      .toThrow(/choices/i);
  });

  it("rejects type !== 'gate'", () => {
    expect(() => GateMdFrontmatterSchema.parse({ type: "agent", choices: ["a", "b"] }))
      .toThrow();
  });

  it("makes inputs optional", () => {
    const parsed = GateMdFrontmatterSchema.parse({ type: "gate", choices: ["yes", "no"] });
    expect(parsed.inputs).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** — `npx vitest run src/attractor/tests/schemas.test.ts` (RED).

- [ ] **Step 3: Implement schema in `src/attractor/core/schemas.ts`**

```typescript
export const GateMdFrontmatterSchema = z.object({
  type: z.literal("gate"),
  choices: z.array(z.string().min(1)).min(1, "gate must declare at least one choice"),
  inputs: z.array(z.string().min(1)).optional(),
}).strict();

export type GateMdFrontmatter = z.infer<typeof GateMdFrontmatterSchema>;
```

**Note:** `outputs` is NOT a frontmatter field for gates — the gate's only output is `choice`, derived implicitly from `choices` (constraint is `enum: choices`). The validator (Task 3.4) consumes `choices` directly to enforce this. This deviates from the original outline (`outputs: { choice: { enum: choices } }`) — having `choices` as the canonical declaration avoids two sources of truth and matches how gates implicitly produce `<id>.choice` today.

- [ ] **Step 4: Run test, expect GREEN** — all 4 cases pass.

- [ ] **Step 5: Run full suite** — `npx vitest run`. Expected: still 1180/1180.

- [ ] **Step 6: Commit** — `feat(schemas): GateMdFrontmatterSchema for gate .md files (D3 chunk-3)`.

---

### Task 3.2: `parseGateFile` + `resolveGate` loader — SHIPPED `8648fd3`

New loader that reads `<dotDir>/<nodeId>.md`, parses frontmatter, validates against `GateMdFrontmatterSchema`, and returns `GateConfig` (frontmatter fields + prompt body).

- [ ] **Step 1: Failing test in `src/cli/tests/gate-registry.test.ts` (new)**

Use `mkdtempSync` to write a fake `.md` to a temp dir, then assert `resolveGate("approval_gate", { dotDir })` returns `{ choices, inputs, prompt }` matching the file. Add cases for: missing file → throws `Gate file not found`; invalid frontmatter (no `type`) → throws with zod issue; body is trimmed.

- [ ] **Step 2: Run test, expect FAIL** — module does not exist (RED).

- [ ] **Step 3: Implement `src/cli/lib/gate-registry.ts`**

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { GateMdFrontmatterSchema } from "../../attractor/core/schemas.js";

export interface GateConfig {
  choices: string[];
  inputs?: string[];
  prompt: string;
}

export function resolveGate(nodeId: string, opts: { dotDir: string }): GateConfig {
  const path = join(opts.dotDir, `${nodeId}.md`);
  if (!existsSync(path)) {
    throw new Error(`Gate file not found: ${path}`);
  }
  const { attributes, body } = parseFrontmatter(readFileSync(path, "utf-8"));
  const fm = GateMdFrontmatterSchema.parse(attributes);
  return { choices: fm.choices, inputs: fm.inputs, prompt: body.trim() };
}
```

- [ ] **Step 4: GREEN** — all loader tests pass.

- [ ] **Step 5: Full suite** — 1180+ pass.

- [ ] **Step 6: Commit** — `feat(gate-registry): resolveGate loader for sibling .md files`.

---

### Task 3.3: `WaitHumanHandler` loads body from `.md` when no inline label — SHIPPED `6dadcbc`

Wire `dotDir` through `EngineOptions` → handler so the handler can call `resolveGate` when `node.label` is missing. Inline-label path stays untouched.

- [ ] **Step 1: Failing tests in `src/attractor/tests/wait-human.test.ts`**

Add two cases:
1. `node.label = undefined`, dotDir contains `<id>.md` → handler reads `.md` body, expands variables, presents as prompt. Choices come from `.md` frontmatter (NOT outgoing edge labels — see Step 3 design note).
2. `node.label = undefined`, dotDir has no `.md` → handler returns `{ status: "fail", failureReason: /gate file not found/i }`. (The validator catches this earlier in real runs; the handler's behavior on this path is the safety net.)

Existing inline-label test (regression check): unchanged behavior when `node.label` is set.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

Thread `dotDir?: string` through `EngineOptions` (src/attractor/core/engine.ts), pass to `WaitHumanHandler` constructor. In `execute`:

```typescript
let prompt: string;
let choices: string[];
if (node.label) {
  prompt = expandVariables(node.label, ctx.values, extractDefaults(node));
  choices = meta.outgoingLabels.length > 0 ? meta.outgoingLabels : ["continue"];
} else if (this.dotDir) {
  const gate = resolveGate(node.id, { dotDir: this.dotDir });
  prompt = expandVariables(gate.prompt, ctx.values, extractDefaults(node));
  choices = gate.choices;
} else {
  return { status: "fail", failureReason: `Gate "${node.id}" has no inline label and no dotDir to resolve .md` };
}
```

**Design note on choice source:** when loading from `.md`, the canonical choices come from frontmatter (NOT outgoing-edge labels). This makes the `.md` self-describing for static analysis — Task 3.4's validator and Chunk 2's `input_type_mismatch` both consume `choices` from the frontmatter. Edge labels still drive routing (the engine maps `answer.value` → outgoing edge with `label="..."`); a Task 3.4 validator rule asserts they match.

- [ ] **Step 4: GREEN** — both new cases pass; inline-label regression test still green.

- [ ] **Step 5: Full suite — must include `pipelines/smoke/gate.dot` smoke** (asserts inline path still works end-to-end).

- [ ] **Step 6: Commit** — `feat(wait-human): load gate prompt from sibling .md when label is missing`.

---

### Task 3.4: Validator rule `gate_handler_missing` + edge-label/choice consistency — SHIPPED `5a19fa8`

Two related rules:
1. `gate_handler_missing` — gate has neither inline `label=` nor a parseable sibling `<id>.md`.
2. `gate_choice_edge_mismatch` — when the `.md` is used, every choice MUST appear as an outgoing edge label, and every outgoing edge label must be a declared choice. (No silent dead branches; no choices that don't route anywhere.)

- [ ] **Step 1: Failing tests in `src/attractor/tests/graph-gate-validation.test.ts` (new)**

Cases:
- Gate with inline label, no `.md` → no diagnostics.
- Gate with no label, valid `.md`, edges match choices → no diagnostics.
- Gate with no label, no `.md` → `gate_handler_missing` diagnostic.
- Gate with no label, `.md` declares `["A","B"]`, edges labeled `["A","C"]` → `gate_choice_edge_mismatch` diagnostic citing `B` (declared but no edge) and `C` (edge but not declared).
- Gate with inline label and `.md` both present → `gate_inline_md_conflict` diagnostic (third rule, same task — pick one source of truth). Inline wins at runtime; conflict signals authorial confusion.

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement in `src/attractor/core/graph.ts`**

In the existing per-node validation pass, for each `wait.human` node:
- `hasInlineLabel = !!node.label`
- `hasMdFile = dotDir ? existsSync(join(dotDir, `${id}.md`)) : false`
- If `!hasInlineLabel && !hasMdFile`: emit `gate_handler_missing`.
- If `hasInlineLabel && hasMdFile`: emit `gate_inline_md_conflict`.
- If `hasMdFile`: parse the `.md`, compare frontmatter `choices` against outgoing edge labels (set diff both directions); emit `gate_choice_edge_mismatch` per side that has extras.

Reuse `resolveGate` from Task 3.2; wrap parse in try/catch so a malformed `.md` becomes its own `gate_md_parse_error` diagnostic (don't crash the validator).

- [ ] **Step 4: GREEN.**

- [ ] **Step 5: Full suite + `pipeline validate` against `pipelines/illumination-to-implementation.dot`** — should still pass since inline labels are present at this point (migrations come in 3.5-3.8).

- [ ] **Step 6: Commit** — `feat(validator): gate_handler_missing + choice/edge consistency rules`.

---

### Tasks 3.5 — 3.8: Migrate the four gates in `illumination-to-implementation.dot` — SHIPPED

- Task 3.5 `remove_gate` → `d1b8b60`
- Task 3.6 `approval_gate` → `e384fdd`
- Task 3.7 `review_gate` → `f8bcd53`
- Task 3.8 `tmux_confirm_gate` → `bf5f080`

One task per gate, one commit each. Each task has the same shape (template below). Order matters: smaller / safer gates first.

- **Task 3.5: `remove_gate`** — choices `["Archive", "Keep", "Chat"]`, three out-edges to `mark_archived`, `done`, `chat_session`. Has `condition="preferred_label=false"` on its incoming edge.
- **Task 3.6: `approval_gate`** — choices `["Decline", "Approve", "Chat"]`, three out-edges. Body uses `$explainer_render` variable.
- **Task 3.7: `review_gate`** — choices `["Approve", "Tmux", "Retry"]`, three out-edges (one is a back-edge to `implement`). Body references `$project` and `$plan_path`.
- **Task 3.8: `tmux_confirm_gate`** — choices `["Commit", "Retry"]`, two out-edges. Body references `$run_id` and `$test_render`.

**Per-gate migration template:**

- [ ] **Step 1: Read the current `label=` value verbatim** from `pipelines/illumination-to-implementation.dot`. Note the exact text (multi-line `\n` escapes preserved as Markdown line breaks in the body).

- [ ] **Step 2: Failing test in `src/attractor/tests/illumination-pipeline.test.ts`** (extend the chunk-2 full-topology test). Assert that `pipeline validate pipelines/illumination-to-implementation.dot` reports zero errors AFTER the migration. Run with the gate already removed from `.dot` but the `.md` not yet written → expect `gate_handler_missing` (RED).

- [ ] **Step 3: Create `pipelines/<gate-id>.md`**

```markdown
---
type: gate
choices:
  - Approve
  - Decline
  - Chat
inputs:
  - explainer_render
---
<verbatim label body, with `\n` → real newlines, variable refs preserved as `$var`>
```

`inputs:` lists every `$variable` referenced in the body so chunk-2's flow validator catches missing producers.

- [ ] **Step 4: Edit `.dot` to remove the `label=` attribute** from the gate node. Keep `shape=hexagon` and any `condition=` on incoming edges. Ensure `choices` in the `.md` exactly match outgoing edge labels.

- [ ] **Step 5: Run validator + tests** — full suite must stay green. `pipeline validate pipelines/illumination-to-implementation.dot` reports zero errors. `npx vitest run src/attractor/tests/illumination-pipeline.test.ts` GREEN.

- [ ] **Step 6: Live smoke (light)** — `npx tsx src/cli/index.ts pipeline validate pipelines/illumination-to-implementation.dot` from CLI. Verifies the actual binary path, not just unit tests.

- [ ] **Step 7: Commit** — `refactor(pipelines): migrate <gate-id> to sibling .md (D3 chunk-3)`. Single gate per commit.

---

### Task 3.9: Chunk-3 review checkpoint — SHIPPED 2026-04-27

- [ ] **Step 1: Verify success criteria:**
  1. `GateMdFrontmatterSchema` rejects bad input (Task 3.1).
  2. `resolveGate` loads + validates `.md` files (Task 3.2).
  3. `WaitHumanHandler` falls back to `.md` body when no inline label, choices come from frontmatter (Task 3.3).
  4. Validator catches `gate_handler_missing` + `gate_choice_edge_mismatch` + `gate_inline_md_conflict` + `gate_md_parse_error` (Task 3.4).
  5. All four gates in `illumination-to-implementation.dot` migrated; `.dot` has no `label=` on those gates (Tasks 3.5-3.8).
  6. `pipelines/smoke/gate.dot` still passes (inline-label regression).
  7. `pipeline validate pipelines/illumination-to-implementation.dot` reports zero errors.
  8. Full suite green.

- [ ] **Step 2: Run full suite** — record total count.

- [ ] **Step 3: Hand off to `superpowers:code-reviewer`** against the chunk's commits + the spec excerpt.

- [ ] **Step 4: Tag** — `chunk-3-gates-as-md`.

- [ ] **Step 5: Memory capture** — note any plan deviations + reviewer feedback for Chunk 4 expansion.

---

## Chunk 4: per-pipeline folder migration (D1, D4)

**Purpose:** Move every project pipeline into its own folder. Relocate agents from `src/cli/agents/` into the pipeline folders that use them. Delete `pipelines/scripts/` and `pipelines/schemas/`.

**Pre-existing-pipeline inventory note:** an earlier draft of this chunk listed `poc-implement`, `gate-test`, and `illumination-to-plan` as pipelines to migrate. None of those exist in the current `pipelines/` tree — they were artifacts of a stale inventory. The list below was re-verified against the working tree before plan acceptance.

**Pre-existing infra (already supports per-folder lookup, verified during Chunk-4 expansion):**
- `engine.ts` already passes `dotDir = dirname(absPath)` into `validateGraph` and the runtime context.
- `graph.ts:193,509` already passes `{projectDir: dotDir}` into `resolveAgent`, so a `<name>.md` sitting next to `pipeline.dot` is found before the bundled `src/cli/agents/<name>.md`.
- `script_file=` paths already resolve relative to `dotDir` (see `script_file_exists` rule in `graph.ts:341`).
- `json_schema_file=` paths likewise resolve relative to the agent or `dotDir` once `outputs:` frontmatter took over (Chunks 1-2).
- The single missing piece is `resolvePipelineArg` in `src/cli/lib/pipeline-resolver.ts`: it currently only returns `pipelines/<name>.dot`. Task 4.1 extends it to prefer `pipelines/<name>/pipeline.dot` when that folder exists.

**Dependencies:** Chunks 1, 2, 3 (every node must self-describe before moving its file).

**Risk note:** This chunk has the largest blast radius. Each pipeline migrates as its own commit so a regression is bisectable.

**Per-pipeline migration recipe (used by Tasks 4.2 — 4.17):**
1. Create `pipelines/<name>/` (smoke pipelines: `pipelines/smoke/<name>/`).
2. `git mv pipelines/<name>.dot pipelines/<name>/pipeline.dot`.
3. Copy each `agent="<x>"` referenced in the .dot from `src/cli/agents/<x>.md` into the folder. Per Decision 4 (full self-containment) the bundled originals stay in place during Chunk 4 — fallback removal is Task 4.19.
4. If the .dot references `script_file="scripts/<f>.mjs"`: `git mv pipelines/scripts/<f>.mjs pipelines/<name>/<f>.mjs` and rewrite the `script_file=` value to the folder-relative form.
5. If the .dot references `json_schema_file="schemas/<f>.json"` AND the consuming agent has not yet migrated to `outputs:` frontmatter: `git mv pipelines/schemas/<f>.json pipelines/<name>/<f>.json` and rewrite the path. (Once an agent has `outputs:`, drop the `json_schema_file=` attribute entirely — Chunk-1/2 already exposed the conflict diagnostic.)
6. Run `npx ralph pipeline validate <name>` and confirm zero errors / no new warnings.
7. Commit as `refactor(pipelines): migrate <name> to per-folder layout (D1 chunk-4)`.

---

### Task 4.0: Capped live-run smoke baseline of `illumination-to-implementation` — DEFERRED

Gating prerequisite from Chunk 1 review. Required only before Task 4.17 (illumination-to-implementation migration), not before Tasks 4.1 — 4.16. Capture either a real `ralph pipeline run illumination-to-implementation` trace or replay `pipeline trace` on the latest stored run; archive as `tmp/chunk-4-baseline.jsonl` and diff against post-migration trace. Re-runs across this chunk: not required, since each per-pipeline migration is independently bisectable via its own commit.

### Task 4.1: `resolvePipelineArg` prefers `<name>/pipeline.dot` over flat `<name>.dot` — SHIPPED 2026-04-27 (`bafaef8`)

**Why:** Task 4.2 onward will move every `.dot` into a sibling folder; without this resolution change the bare-name shorthand `ralph pipeline run janitor` breaks the moment the file moves.

**RED step (one subagent):**
- Add `src/cli/tests/pipeline-resolver-folder.test.ts` (or extend `pipeline-resolver.test.ts`) with three cases that fail today:
  1. Folder-form wins: when `<project>/pipelines/<name>/pipeline.dot` exists, `resolvePipelineArg("<name>", project)` returns that absolute path.
  2. Folder-form preferred over flat-form: when BOTH `<project>/pipelines/<name>/pipeline.dot` AND `<project>/pipelines/<name>.dot` exist, the folder-form path is returned (Decision 1: folder = SSoT).
  3. Flat-form still wins for back-compat when only `<project>/pipelines/<name>.dot` exists (carry-over of existing behavior).
- Use `tmpdir`/`mkdirSync` setup the same way `pipeline-resolver.test.ts` already does.
- Run `npx vitest run src/cli/tests/pipeline-resolver-folder.test.ts` and confirm cases (1) and (2) fail. Commit RED separately is OPTIONAL; we'll squash with GREEN.

**GREEN step (one subagent):**
- Edit `src/cli/lib/pipeline-resolver.ts`. Inside `resolvePipelineArg`, before the existing flat-file probe at the project layer, add:
  ```typescript
  const folderPath = join(getPipelinesDir(project), arg, "pipeline.dot");
  if (existsSync(folderPath)) return folderPath;
  ```
  (Same insertion at the user-home layer.)
- Run `npx vitest run src/cli/tests/pipeline-resolver-folder.test.ts` and `npx vitest run src/cli/tests/pipeline-resolver.test.ts` — all green.
- Run full suite `npx vitest run` — confirm no regressions.
- Commit `feat(pipeline-resolver): support <name>/pipeline.dot folder layout (D1 chunk-4)`.

### Task 4.2: Migrate `janitor.dot` to `pipelines/janitor/` — SHIPPED 2026-04-27

**Why this pipeline first:** janitor uses exactly one agent (`janitor`), zero `script_file=`, zero `json_schema_file=` references. Smallest possible blast radius — proves the recipe works before the larger migrations land.

**Steps (one subagent):**
1. `mkdir -p pipelines/janitor`.
2. `git mv pipelines/janitor.dot pipelines/janitor/pipeline.dot`.
3. `cp src/cli/agents/janitor.md pipelines/janitor/janitor.md` (do NOT delete the bundled copy yet — Task 4.19 handles that after fallback removal).
4. Add a regression test `src/cli/tests/pipeline-janitor-folder.test.ts`:
   - `resolvePipelineArg("janitor", "<repo-root>")` returns the absolute path of `pipelines/janitor/pipeline.dot`.
   - `validateGraph(loadDot("pipelines/janitor/pipeline.dot"), dirname(...))` returns no error-level diagnostics (warnings tolerated).
5. Run `npx ralph pipeline validate janitor` from the repo root → expect exit 0.
6. Run `npx vitest run` — full suite green.
7. `git rm pipelines/janitor.svg` (stale SVG — `pipeline show` regenerates on demand).
8. Commit `refactor(pipelines): migrate janitor to per-folder layout (D1 chunk-4)`.

### Tasks 4.3 — 4.16: Migrate the 14 smoke pipelines — SHIPPED 2026-04-27

Each smoke pipeline migrated in its own commit. Per-pipeline regression test added at `src/cli/tests/pipeline-smoke-<name>-folder.test.ts` (3 cases each: pipeline.dot exists, agent .md exists when applicable, validateGraph emits zero error-level diagnostics).

| # | Pipeline | Commit | Agents copied | Schema migrated |
|---|---|---|---|---|
| 4.3 | `agent-implement` | `92ce9f3` | `task` | — |
| 4.4 | `agent-json-vars` | `14e922b` | `task` | `agent-json-vars.json` (rewrote `schemas/...` → bare filename) |
| 4.5 | `chat-end-to-end` | `0ce6ddc` | `chat` | `summary.json` |
| 4.6 | `chat-only` | `fc3e5d8` | `chat` | — |
| 4.7 | `conditional` | `5563318` | `task` | `conditional-result.json` |
| 4.8 | `gate` | `1142223` | `task` | — (gate node uses inline `label="..."`) |
| 4.9 | `json-schema-stream` | `79c73ed` | `task` | `file-list.json` |
| 4.10 | `meditate-steer` | `95909e7` | — | — |
| 4.11 | `missing-caller-var` | `3ceaceb` | — | — |
| 4.12 | `static-multi-node` | `bd5441c` | `task` | — |
| 4.13 | `store` | `8cf700b` | — | — |
| 4.14 | `tmux-tester` | `cdd6d78` | `tmux-tester` | `meditate-observe.json` (from `pipelines/schemas/`; rewrote `../schemas/...` → bare filename) |
| 4.15 | `tool` | `5044041` | — | — |
| 4.16 | `tool-runtime-vars` | `7511632` | — | — |

`pipelines/smoke/schemas/` removed (was empty after migrations). `pipelines/schemas/` still holds non-smoke schemas (Task 4.18 cleanup later). Full suite green: 122 test files / 1230 tests passed.

### Task 4.17: Migrate `illumination-to-implementation.dot` — SHIPPED 2026-04-27 (`f367a7c`)

**Bundled validator bug fix shipped alongside (`fec30aa`):** `checkMissingInputProducer` did not respect RESERVED runtime vars (`run_id`, `goal`, `project`); the sibling `checkRequiredCallerVars` already did. Migration tripped the false positive because `verifier.md` declares `inputs: [..., run_id]`. Fixed via TDD red/green; new case in `src/attractor/tests/graph-inputs-flow.test.ts`.

**Outcome:** 18 nodes, 27 edges, exit 0, only the `required_caller_vars` info banner remains (17 prior `variable_coverage` warnings cleared because folder-resolved agents now expose `inputs:`/`outputs:` to the analyzer). Full vitest suite: 122/122 files, 1223/1223 tests green. Pre-existing UI flake `pipeline-app-integration.test.tsx` confirmed independent of this work (fails on main without these changes).

**Plan-vs-reality deltas:**
- Step 7 SVG `git rm` honored (initially mis-moved into the new folder, then deleted).
- `pipelines/scripts/tests/` moved into `pipelines/illumination-to-implementation/tests/` so `__dirname`-relative resolution keeps working — Task 4.18 cleanup of `pipelines/scripts/` is now trivial (the dir is empty).

**Original plan retained below for traceability.**



Largest blast radius. Pre-flight (gates Task 4.0 archive):
- Capture the live-run baseline trace per Task 4.0.
- Inventory every `agent=` (verifier, change-explainer, chat-refiner, chat-summarizer→task, design-writer, plan-writer, memory-reflector, memory-writer, task) and every `script_file=` (`scripts/mark-archived.mjs`, `scripts/mark-dispatched.mjs`).

Steps (one subagent):
1. `mkdir -p pipelines/illumination-to-implementation`.
2. `git mv pipelines/illumination-to-implementation.dot pipelines/illumination-to-implementation/pipeline.dot`.
3. Copy every used agent into the folder.
4. `git mv pipelines/scripts/mark-archived.mjs pipelines/illumination-to-implementation/mark-archived.mjs` and `mark-dispatched.mjs`. Update `script_file=` paths to folder-relative.
5. For each remaining `json_schema_file=` reference: if the agent has `outputs:` (Chunk 1-2), delete the attribute. Otherwise migrate the schema into the folder.
6. Move the gate `.md` files (`approval_gate.md`, `review_gate.md`, `remove_gate.md`, `tmux_confirm_gate.md`) from `pipelines/` into the new folder if and only if they are referenced ONLY by this pipeline. (Chunk 3 left them at `pipelines/<gate>.md`; the runtime resolves them relative to `dotDir`.)
7. `git rm pipelines/illumination-to-implementation.svg`.
8. Run `npx ralph pipeline validate illumination-to-implementation`. Run the live-run replay against the baseline trace from Task 4.0 — confirm structurally equivalent output (same node order, same produced keys).
9. Commit `refactor(pipelines): migrate illumination-to-implementation to per-folder layout (D1 chunk-4)`.

### Task 4.18: Delete now-empty `pipelines/scripts/` and `pipelines/schemas/` — SHIPPED 2026-04-27 (`8445012`)

`pipelines/scripts/` was already gone (deleted earlier in chunk-4). `pipelines/schemas/` had only a stale `structured-output-test.json` with no live refs. Removed alongside the description-shape lint test (`pipeline-schema-descriptions.test.ts` + its `__fixtures__/schemas/` fixtures) — that lint now lives on agent `outputs:` frontmatter via `agent-outputs-frontmatter.test.ts`. Updated the `inline_script_smell` rule message in `graph.ts` to point at `<pipeline-folder>/<name>.<ext>` instead of the deleted `pipelines/scripts/`.

### Task 4.19: Remove bundled fallback for project pipelines in `agent-registry.ts` — SHIPPED 2026-04-27 (`c8c1255`)

Implemented per Decision 4. Surprises:

- **`agent-handler.ts` was looking at the wrong dir.** Pre-fix, the runtime resolved agents at `<projectDir>/.ralph/agents/<name>.md`. Post-fix, it resolves at `meta.dotDir` (the per-folder pipeline directory), matching the validator. The old `<projectDir>/.ralph/agents/` path is gone for the runtime; users override per-folder agents via `~/.ralph/agents/`.
- **Verifier kept bundled.** `agent-registry-bundled.test.ts` is the canonical proof that bundled lookup still works for templates (Chunks 5-6). It needs an outputs-bearing agent — verifier is the only kept one. Plan said "can be safely deleted"; we kept it intentionally.
- **Tests touched:** `agent-handler.test.ts` (no-fallback assertion replaces stale `projectDir: undefined`), `agent-registry-inputs.test.ts` (red/green new no-fallback + project-local-still-resolves cases), `janitor-agent.test.ts` (re-pointed `AGENT_PATH` at the per-folder copy).
- **Bundled deletes** (11 files): change-explainer, chat-refiner, chat, design-writer, implement, janitor, memory-reflector, memory-writer, plan-writer, task, tmux-tester. **Kept** (7 files): agent-creator, chat-summarizer, meditate, meditate-create, meditate-observer, plan, verifier.

**Spec drift to address later:** `specs/architecture.md:112` still describes the old "project-local `.ralph/agents/` → user → bundled" precedence. Update during Chunk 5/6 or a separate spec-sync pass.

### Task 4.20: Chunk-4 review checkpoint

- Dispatch `superpowers:code-reviewer` against the chunk-4 commit range with the spec at `docs/superpowers/specs/2026-04-27-pipeline-folder-architecture-redesign.md` (or successor) and this plan section.
- Address feedback in-chunk; re-dispatch if needed.
- Tag `chunk-4-per-pipeline-folders` for bisectable history.
- Dispatch `memory-writer` per the Post-execution memory capture procedure at the bottom of this plan.
- Expand Chunk 5 outline into full TDD steps (this happens in the session after the chunk lands).

---

## Chunk 5: `src/cli/templates/` + `pipeline create` is a pipeline (D7) — outline

**Purpose:** Create the bundled-template infrastructure and convert `ralph pipeline create` into a thin shim that runs a bundled pipeline.

**High-level shape:**
- Add `getBundledTemplatesDir()` to `src/cli/lib/assets.ts` (Task 5.1) mirroring `getBundledAgentsDir()`.
- Create `src/cli/templates/blank/` (Task 5.2): minimal scaffold with `pipeline.dot` (start → first_step → end), one `first-step.md` agent stub, README.
- Create `src/cli/templates/pipeline-create/` (Task 5.3): the meta-template. `pipeline.dot` has one interactive agent node `scaffolder` whose prompt body teaches Claude how to author a pipeline given the new file shape.
- Migrate `src/cli/agents/agent-creator.md` into `templates/pipeline-create/scaffolder.md` (with new `outputs:`/`inputs:` frontmatter).
- Convert `pipelineCreateCommand` in `src/cli/commands/pipeline.ts` into a thin shim (Task 5.4):
  ```typescript
  export async function pipelineCreateCommand(name: string) {
    return runPipeline(
      resolveBundledTemplate("pipeline-create/pipeline.dot"),
      { vars: { pipeline_name: name } }
    );
  }
  ```
- Delete `src/cli/prompts/PROMPT_pipeline_create.md`.
- Delete `src/cli/agents/agent-creator.md`.
- Update `src/cli/tests/pipeline-create-prompt.test.ts` (or delete + replace with template-shape test).
- Chunk-5 review checkpoint.

**Dependencies:** Chunks 1-4 (template files use the new agent shape; lookup uses pipeline-folder-first).

---

## Chunk 6: command-to-pipeline conversions (D8) — outline

**Purpose:** Convert the remaining workflow commands (`plan`, `meditate`, `new`, `pipeline refine`) into thin shims that run bundled templates. Delete the last of `src/cli/agents/` and the entire `src/cli/prompts/` folder.

**High-level shape:**
- One sub-chunk per command:
  - 6a. `plan` — single-node interactive template; `plan.md` moves into `templates/plan/`.
  - 6b. `meditate` — single-node interactive template; `meditate.md` + `meditate-create.md` move into `templates/meditate/` and `templates/meditate-create/`. `--steer <text>` becomes `--var steer=...`.
  - 6c. `new` — kickoff template; `PROMPT_kickoff.md` becomes the body of `templates/new/scaffolder.md`. May be 2 nodes (init + interactive refinement).
  - 6d. `pipeline refine` — interactive template that injects the current pipeline's graph + recent traces.
- Each sub-chunk:
  1. Create `src/cli/templates/<command>/`.
  2. Move agent files in.
  3. Convert `src/cli/commands/<command>.ts` to thin shim.
  4. Update tests.
  5. Smoke-test the command end-to-end.
- After all sub-chunks: delete `src/cli/prompts/` entirely; assert `src/cli/agents/` is empty (or only contains agents shared by smoke tests, which moved to `pipelines/smoke/` in Chunk 4).
- Update `README.md` to reflect the new architecture.
- Update `specs/architecture.md`, `specs/commands.md`.
- Chunk-6 review checkpoint.

**Dependencies:** Chunk 5 (template infra must exist).

---

## Plan Review Loop

After each chunk:

1. Dispatch `superpowers:code-reviewer` against the chunk's commits + the spec.
2. Address feedback in-chunk; re-dispatch if needed.
3. Tag chunk in git for bisectable history.
4. Expand the next chunk's outline into full TDD steps.

For Chunk 1 specifically: after Task 1.7's review checkpoint, the reviewer's feedback shapes how Chunk 2 gets fully detailed.

---

## Execution Handoff

After Chunk 1 lands and the spec is approved:

**"Plan ready. Chunk 1 fully detailed; Chunks 2-6 outlined. Use superpowers:subagent-driven-development to execute Chunk 1 (one fresh subagent per task with two-stage review). Subsequent chunks get fully expanded after their predecessor lands."**

---

## Post-execution memory capture

**REQUIRED after every chunk lands.** Each chunk's implementation session produces lessons that future Claude sessions need to pick up cold:

- What was harder than the plan predicted (and why)
- Codebase facts the plan got wrong or surprised the implementer
- Tests that turned out flaky / non-deterministic
- Edge cases the validator missed during real runs
- Migration friction the user noticed (regressions, ergonomic complaints)
- Decisions the implementer made that weren't in the plan (and why)

**Procedure at the end of each chunk:**

1. Land the final commit + tag (`chunk-N-<name>`).
2. Dispatch the `memory-writer` subagent with the chunk's session transcript path:
   ```
   Agent({
     description: "Capture chunk-N implementation memory",
     subagent_type: "memory-writer",
     prompt: "Analyze the implementation session for Chunk N of the pipeline folder architecture redesign. Transcript: <path>. Capture: codebase surprises, validator gaps discovered, plan-vs-reality deltas, ergonomic friction. Write to /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/. Update MEMORY.md index."
   })
   ```
3. Memory file naming: `2026-MM-DD-pipeline-redesign-chunk-N-implementation.md`.
4. Memory `type:` is `project` (captures execution state and lessons applicable to subsequent chunks).
5. The memory file feeds into the expansion of Chunk N+1's outline — read it before writing Chunk N+1's TDD steps.

**Why this is non-optional:** the architecture spec captures decisions that should survive 6 months. The implementation memories capture decisions that should survive the next chunk. Both layers protect against drift between what's documented and what actually shipped.
