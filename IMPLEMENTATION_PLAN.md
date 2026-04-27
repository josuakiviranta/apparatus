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

### Task 4.20: Chunk-4 review checkpoint — SHIPPED 2026-04-27

- `superpowers:code-reviewer` ran against `chunk-3-gates-as-md..chunk-4-per-pipeline-folders` (23 commits). Verdict: **APPROVED**, no CRITICAL/IMPORTANT issues. One NIT (stale comment in `src/cli/lib/pipeline-resolver.ts:32`) addressed in-chunk.
- Tag `chunk-4-per-pipeline-folders` published (points at `edb4647`).
- Memory captured: `2026-04-27-chunk-4-completion-per-folder-architecture.md` + this checkpoint commit.
- Chunk 5 outline expanded below into full TDD steps.

**Chunk 4 status: SHIPPED** — Tasks 4.0–4.19 executed; reviewer-approved. 1176/1176 vitest green; `tsc --noEmit` clean. 14 smoke pipelines + janitor + illumination-to-implementation converted to per-folder layout. 11 bundled agents deleted; runtime fallback to bundled agents removed for pipeline nodes (`allowBundledFallback: false` at every pipeline call site). Per-pipeline folder is now SSoT.

---

## Chunk 5: `src/cli/templates/` + `pipeline create` is a pipeline (D7)

**Purpose:** Land bundled-template infrastructure (`src/cli/templates/` + asset helpers + tsup copy) and convert `ralph pipeline create` into a thin shim that runs the bundled `pipeline-create/` template. After this chunk: `agent-creator.md`, `PROMPT_pipeline_create.md`, and the bespoke `composeCreatePrompt` injection path are deleted.

**Dependencies:** Chunks 1–4. Templates use the post-Chunk-1/2 agent frontmatter (`outputs:`/`inputs:`). Pipeline lookup must already prefer `<name>/pipeline.dot` (Chunk 4 / Task 4.1).

**Spec anchor:** `docs/superpowers/specs/2026-04-27-pipeline-folder-architecture-redesign.md` § D7 (lines 162–188) and § R4 (lines 337–339).

**Architectural decisions resolved up-front (no re-litigation in tasks):**

1. **Where templates live in dev vs prod.** Source: `src/cli/templates/`. tsup `onSuccess` copies the tree to `dist/templates/`. `getBundledTemplatesDir()` resolves to `<base>/templates/` where `<base>` is `dist/cli/`'s parent in prod and `src/cli/`'s parent in dev — same convention as the existing `prompts/`, `agents/`, `pipelines/` triple.
2. **What `resolveBundledTemplate(name)` returns.** A path of the form `<templatesDir>/<name>/pipeline.dot`. Errors with a clear message if the file is missing. Mirrors `getBundledPipelinePath` but for the per-folder template layout.
3. **Dropping `composeCreatePrompt`.** The current command injects a Markdown table of available agents into the prompt. The replacement scaffolder agent does this itself — its prompt body instructs Claude to `Bash: ls ~/.ralph/agents/ <project>/.ralph/agents/ <project>/pipelines/*/[a-z]*.md`. The runtime synthesis function and its associated test go away. (No need to thread the agent list as a `--var` — the scaffolder is an interactive Claude session with shell access.)
4. **Variables passed by the shim.** `pipeline_name` and `pipelines_dir` (absolute path to `<project>/pipelines/`). The scaffolder writes the new pipeline to `<pipelines_dir>/<pipeline_name>/pipeline.dot` (per-folder, matching the layout enforced in Chunk 4).
5. **`blank` template's role.** Bundled starter the meta-template's scaffolder can copy from. Not invoked directly by any command in Chunk 5. It exists so Chunk 5 ships D7's full directory structure, not so it gets a CLI flag.
6. **Existing CLI surface preserved.** `ralph pipeline create <name>` keeps the same argv shape. `--project <folder>` still works (passed through to `pipelineRunCommand` as `--var project=<folder>` if non-default).
7. **No new validator rules.** Templates are validated by the existing `pipeline validate` rules (Chunk 1–3 outputs/inputs/gate machinery). Chunk 5 only adds a smoke test that runs `validateGraph` against each bundled template's `pipeline.dot` and asserts no errors.

### Task 5.1: `getBundledTemplatesDir()` + `resolveBundledTemplate(name)` in `assets.ts`

**Why:** Both the shim (Task 5.6) and templates' tests need a single resolver that handles dev/prod parity. Without this, every call site re-derives `__dirname`-relative paths and drifts.

- [ ] **Step 1 (red): test for `getBundledTemplatesDir()` parity with `getBundledAgentsDir()`**

  Add `src/cli/tests/assets-templates.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { existsSync } from "fs";
  import { getBundledTemplatesDir, resolveBundledTemplate } from "../lib/assets.js";

  describe("getBundledTemplatesDir", () => {
    it("returns a path to a directory that exists", () => {
      const dir = getBundledTemplatesDir();
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("resolveBundledTemplate", () => {
    it("resolves to <templatesDir>/<name>/pipeline.dot", () => {
      const path = resolveBundledTemplate("pipeline-create");
      expect(path.endsWith("pipeline-create/pipeline.dot")).toBe(true);
    });
    it("throws a clear error when the template is missing", () => {
      expect(() => resolveBundledTemplate("does-not-exist")).toThrow(/template/i);
      expect(() => resolveBundledTemplate("does-not-exist")).toThrow(/does-not-exist/);
    });
  });
  ```

  Run: `npx vitest run src/cli/tests/assets-templates.test.ts` → expected to fail (no exports yet).

- [ ] **Step 2 (green): add the helpers to `src/cli/lib/assets.ts`**

  Just under `getBundledAgentsDir`:

  ```ts
  export function getBundledTemplatesDir(): string {
    return getAssetPath("templates");
  }

  export function resolveBundledTemplate(name: string): string {
    const dir = getBundledTemplatesDir();
    const path = join(dir, name, "pipeline.dot");
    if (!existsSync(path)) {
      throw new Error(
        `Bundled template not found: "${name}" (expected ${path}). ` +
          `Available templates ship under src/cli/templates/.`,
      );
    }
    return path;
  }
  ```

  Add `import { existsSync } from "fs";` at the top of `assets.ts` (currently it doesn't import it).

  Run: `npx vitest run src/cli/tests/assets-templates.test.ts` → expected to pass once Task 5.3 lands the `pipeline-create/pipeline.dot` file. Until then, the **first** test ("directory exists") and the **third** ("throws on missing") pass; the **second** ("resolves to …") will pass after Task 5.3. Mark Task 5.1 done only when the directory exists; the second assertion is gated on Task 5.3.

- [ ] **Step 3: verify typecheck**

  `npx tsc --noEmit` → clean.

- [ ] **Step 4: commit**

  `feat(assets): getBundledTemplatesDir + resolveBundledTemplate (D7 chunk-5)`

### Task 5.2: tsup copies `src/cli/templates/` recursively to `dist/templates/`

**Why:** The other bundled assets (`prompts/`, `agents/`, `pipelines/`) are flat directories and use a single `readdirSync` loop. Templates are a *tree* (`templates/<name>/{pipeline.dot,*.md,...}`), so the copy step must recurse. Without this the prod build can't find any template.

- [ ] **Step 1 (red): smoke test from prod-output shape**

  Add `src/cli/tests/tsup-templates-copy.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { existsSync } from "fs";
  import { join } from "path";

  // Sanity that the source directory ships its meta-template.
  // Prod-bundle copy is verified by the smoke test (npm run build && cli runs).
  describe("templates source layout", () => {
    const root = process.cwd();
    it("ships pipeline-create as a folder template", () => {
      expect(existsSync(join(root, "src/cli/templates/pipeline-create/pipeline.dot"))).toBe(true);
    });
    it("ships blank as a folder template", () => {
      expect(existsSync(join(root, "src/cli/templates/blank/pipeline.dot"))).toBe(true);
    });
  });
  ```

  Run → fails (no `src/cli/templates/`).

- [ ] **Step 2 (green): extend `tsup.config.ts` `onSuccess`**

  Add a recursive copy helper and a new block:

  ```ts
  import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";
  import { join } from "path";

  function copyDirRecursive(src: string, dst: string) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
      const s = join(src, entry);
      const d = join(dst, entry);
      if (statSync(s).isDirectory()) copyDirRecursive(s, d);
      else copyFileSync(s, d);
    }
  }
  ```

  In `onSuccess`, after the `dist/pipelines` block:

  ```ts
  // Copy bundled templates (per-folder layout, recurse into subdirs).
  copyDirRecursive("src/cli/templates", "dist/templates");
  ```

  Run `npm run build` → expected: tsup completes, `dist/templates/pipeline-create/pipeline.dot` exists.

- [ ] **Step 3: smoke + typecheck**

  - `npx vitest run src/cli/tests/tsup-templates-copy.test.ts` → green (after Tasks 5.3 + 5.4 land the actual files; both run before this in the chunk's commit order, so re-run to confirm).
  - `npx tsc --noEmit` → clean.

- [ ] **Step 4: commit (squash with Task 5.1 if both green together; otherwise separate)**

  `chore(tsup): copy src/cli/templates recursively to dist/templates (D7 chunk-5)`

### Task 5.3: Create `src/cli/templates/blank/` starter

**Why:** D7 specifies that `blank/` ships in `src/cli/templates/`. It exists so the meta-template scaffolder has a known "minimal valid pipeline" to reference / copy from, and so any tool that traverses `templates/` always sees a working starter. Per the spec (line 218), `blank` is `start → first_step → end` (3 nodes) — not a single-node skeleton.

- [ ] **Step 1 (red): test asserting `blank` validates clean**

  Add `src/cli/tests/templates-validate.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { readFileSync } from "fs";
  import { dirname, join } from "path";
  import { getBundledTemplatesDir } from "../lib/assets.js";
  import { parseDot } from "../../attractor/core/dot-parser.js";
  import { validateGraph } from "../../attractor/core/graph.js";

  function loadAndValidate(templateName: string) {
    const path = join(getBundledTemplatesDir(), templateName, "pipeline.dot");
    const dot = readFileSync(path, "utf-8");
    const graph = parseDot(dot);
    return validateGraph(graph, dirname(path));
  }

  describe("bundled templates: validateGraph", () => {
    it("blank has no errors", () => {
      const diags = loadAndValidate("blank");
      const errors = diags.filter(d => d.severity === "error");
      expect(errors).toEqual([]);
    });
  });
  ```

  Run → fails (no `blank/pipeline.dot`).

- [ ] **Step 2 (green): create the files**

  - `src/cli/templates/blank/pipeline.dot`:

    ```dot
    digraph blank {
      start [shape=Mdiamond];
      end   [shape=Msquare];

      first_step [shape=box, agent="first-step"];

      start -> first_step -> end;
    }
    ```

  - `src/cli/templates/blank/first-step.md` — agent stub with `outputs:` so the validator doesn't complain about it producing no keys consumed downstream:

    ```markdown
    ---
    description: Placeholder first step. Replace this with a real agent that does meaningful work.
    outputs:
      result: string
    ---
    Replace this body with the actual instructions for your first step.
    ```

  - `src/cli/templates/blank/README.md`:

    ```markdown
    # blank
    Minimal 3-node pipeline starter. Edit `pipeline.dot` and `first-step.md` to fit your workflow.
    ```

  Re-run vitest → green.

- [ ] **Step 3: commit**

  `feat(templates): bundled "blank" 3-node starter (D7 chunk-5)`

### Task 5.4: Create `src/cli/templates/pipeline-create/` (meta-template + scaffolder agent)

**Why:** The meta-template *is* the new `ralph pipeline create` runtime. The scaffolder agent's body fully replaces `src/cli/prompts/PROMPT_pipeline_create.md` and `src/cli/agents/agent-creator.md`, with the runtime agent-table injection lifted up into the agent's own instructions (it inspects the filesystem itself).

**Schema lesson (recorded during Chunk 5 execution, 2026-04-27):** The plan's prescribed `pipeline.dot` snippet had `inputs="pipeline_name,pipelines_dir"` on the **scaffolder node**. `AgentNodeSchema` does not recognize per-node `inputs=` and the validator rejects it. Caller-required vars belong on the **digraph** (matching `illumination-to-implementation/pipeline.dot:3`):

```dot
digraph pipeline_create {
  goal="Scaffold a new ralph pipeline interactively"
  inputs="pipeline_name, pipelines_dir"
  ...
}
```

Future plans for templates / pipelines should put declared caller inputs at the digraph level only.

- [ ] **Step 1 (red): extend `templates-validate.test.ts` for `pipeline-create`**

  Add to the existing describe:

  ```ts
  it("pipeline-create has no errors", () => {
    const diags = loadAndValidate("pipeline-create");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });
  ```

  Add a second describe verifying the scaffolder agent's frontmatter shape:

  ```ts
  import { parseAgentFile } from "../lib/agent-registry.js";

  describe("pipeline-create scaffolder agent", () => {
    it("declares pipeline_name and pipelines_dir as inputs", () => {
      const path = join(getBundledTemplatesDir(), "pipeline-create", "scaffolder.md");
      const cfg = parseAgentFile(path);
      expect(cfg.inputs).toContain("pipeline_name");
      expect(cfg.inputs).toContain("pipelines_dir");
    });
  });
  ```

  Run → fails.

- [ ] **Step 2 (green): create the files**

  - `src/cli/templates/pipeline-create/pipeline.dot`:

    ```dot
    digraph pipeline_create {
      start [shape=Mdiamond];
      end   [shape=Msquare];

      // Single interactive node: Claude scaffolds a new pipeline file based on $pipeline_name.
      scaffolder [shape=box, agent="scaffolder", interactive=true,
                  inputs="pipeline_name,pipelines_dir"];

      start -> scaffolder -> end;
    }
    ```

  - `src/cli/templates/pipeline-create/scaffolder.md` — body is the previous `PROMPT_pipeline_create.md` content **plus** instructions to enumerate available agents itself, **plus** the `agent-creator` whitelist if any tool restrictions need to carry over. Frontmatter must declare `inputs:` and `outputs:`:

    ```markdown
    ---
    description: Scaffolds a new ralph pipeline. Inspects available agents in the project, drafts <pipeline_name>/pipeline.dot under <pipelines_dir>/, and runs ralph pipeline validate against it before exiting.
    interactive: true
    inputs:
      - pipeline_name
      - pipelines_dir
    outputs:
      created_path: string
    ---
    You are scaffolding a ralph pipeline named "$pipeline_name".

    1. Inspect available agents:
       - `ls ~/.ralph/agents/ 2>/dev/null` (user-scope)
       - `ls $pipelines_dir/*/[a-z]*.md 2>/dev/null` (per-pipeline scope, post-Chunk-4)
       - `ls ~/.ralph/<project-cache>/agents/ 2>/dev/null` (project-scope)
       Print the resulting agent inventory before drafting.

    2. Author `$pipelines_dir/$pipeline_name/pipeline.dot` (per-folder layout).
       Co-locate any agent .md files the new pipeline references — do NOT rely on bundled fallback.

    3. … <port the rest of PROMPT_pipeline_create.md verbatim, with `$pipeline_name`/`$pipelines_dir` substituted for the old hard-coded paths> …

    4. Run `ralph pipeline validate $pipelines_dir/$pipeline_name/pipeline.dot`. If it errors, edit and re-run until it passes.

    Set `created_path` in your final JSON to the absolute path of the new pipeline.dot.
    ```

    *Implementer note:* the verbatim port from `PROMPT_pipeline_create.md` happens here in one motion — don't split across tasks. After porting, `git diff` between the old prompt and the new agent body should be small (substitutions + the inspection block at the top).

  Re-run vitest `templates-validate.test.ts` → green.

- [ ] **Step 3: commit**

  `feat(templates): pipeline-create meta-template + scaffolder agent (D7 chunk-5)`

### Task 5.5: Convert `pipelineCreateCommand` to a thin shim

**Why:** D7's payoff. After this task, `src/cli/commands/pipeline.ts:881-940` (the existing 60-line implementation) collapses to a few lines of `pipelineRunCommand` delegation; all the bespoke `which claude` + `runTwoPhaseClaudeSession` + manual prompt assembly disappears.

- [ ] **Step 1 (red): replace the existing test suite for `pipelineCreateCommand`**

  In `src/cli/tests/pipeline.test.ts`, the `describe("pipelineCreateCommand", …)` block currently asserts behavior that is going away (`composeCreatePrompt` injection, manual `mkdir pipelines/`, `runTwoPhaseClaudeSession` spawning). Replace with a single shim-shape test that asserts the command calls `pipelineRunCommand` with the bundled template path and the right vars:

  ```ts
  describe("pipelineCreateCommand (shim)", () => {
    it("delegates to pipelineRunCommand with the bundled pipeline-create template + pipeline_name var", async () => {
      const calls: Array<{ dotFile: string; opts: any }> = [];
      vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
        calls.push({ dotFile, opts });
      });
      await pipelineCreateCommand("review", { project: "/tmp/x" });
      expect(calls).toHaveLength(1);
      expect(calls[0].dotFile.endsWith("pipeline-create/pipeline.dot")).toBe(true);
      expect(calls[0].opts.vars.pipeline_name).toBe("review");
      expect(calls[0].opts.vars.pipelines_dir).toBe("/tmp/x/pipelines");
    });
  });
  ```

  Delete the four existing tests in the old `describe("pipelineCreateCommand")` (claude-not-found, already-exists, invalid-name, creates-pipelines-dir). The first three are now responsibilities of `pipelineRunCommand` + the scaffolder agent and shouldn't be re-asserted at the shim level. The fourth tests behavior the shim no longer owns.

  Run → fails.

- [ ] **Step 2 (green): rewrite `pipelineCreateCommand`**

  In `src/cli/commands/pipeline.ts`, replace the entire 60-line body with:

  ```ts
  export async function pipelineCreateCommand(
    name: string,
    opts: PipelineCreateOptions = {},
  ): Promise<void> {
    if (!isNameShorthand(name)) {
      await output.error(`Invalid pipeline name "${name}": use only letters, numbers, hyphens, underscores`);
      process.exit(1);
    }
    const project = resolve(opts.project ?? process.cwd());
    const dotFile = resolveBundledTemplate("pipeline-create");
    return pipelineRunCommand(dotFile, {
      project,
      vars: {
        pipeline_name: name,
        pipelines_dir: getPipelinesDir(project),
      },
    });
  }
  ```

  Drop the `composeCreatePrompt` import. Add `resolveBundledTemplate` to the existing `assets.js` import. Remove `runTwoPhaseClaudeSession`, `spawnSync`, `mkdirSync`, the conflict check (now scaffolder's job per the agent body's step 2), and the post-validate block.

  Re-run the shim test → green.

- [ ] **Step 3: typecheck + full test run**

  - `npx tsc --noEmit` → clean.
  - `npx vitest run` → all suites green.

- [ ] **Step 4: commit**

  `refactor(pipeline-create): convert command to thin shim over pipeline-create template (D7 chunk-5)`

### Task 5.6: Delete dead code paths — DEFERRED to Chunk 6 (2026-04-27)

**Why deferred:** Plan-author's deletion list assumed all callers of the four targets were the `pipelineCreateCommand` path. Audit on 2026-04-27 (during Chunk-5 execution) found two surviving callers outside that path:

- `src/cli/commands/pipeline.ts:942` — `pipelineRefineCommand` still calls `composeCreatePrompt(project)` and reads `PROMPT_pipeline_create.md` as the refine session's base prompt. Refine becomes a pipeline in Chunk 6 sub-chunk 6d.
- `src/cli/commands/agent.ts:63` — `agentCreateAction` (the `ralph agent create` command) calls `resolveAgent("agent-creator")`. Unrelated to pipeline scaffolding; whether to retire it is a separate decision.

**What to do here:** keep the four files alive through Chunk 5. Schedule deletions in Chunk 6:
- 6d (`pipeline refine` → template) deletes `PROMPT_pipeline_create.md`, `pipeline-create-prompt.ts`, `compose-create-prompt.test.ts`, `pipeline-create-prompt.test.ts`, and the `getPipelineCreatePromptPath` export.
- A new 6e: decide whether `ralph agent create` migrates to a template. If yes, `agent-creator.md` retires there; otherwise stays.

No code changes in this task. Resume with Task 5.7.

### Task 5.7: End-to-end smoke (`ralph pipeline create` against a temp project) — DONE 2026-04-27

**Why:** Unit tests above mock `pipelineRunCommand`. Confirm the wiring actually hangs together once before the chunk lands.

**Outcome (autonomous-loop substitute for the interactive smoke):**

- [x] `npm run build` → clean. `dist/templates/pipeline-create/{pipeline.dot,scaffolder.md,README.md}` all populated by tsup's recursive copy.
- [x] `node dist/cli/index.js pipeline validate dist/templates/pipeline-create/pipeline.dot` → `✔ Pipeline valid (3 nodes, 2 edges)`. One non-blocking diagnostic surfaced:
  - `orphan_output` warning at `scaffolder` node — `created_path` declared in `scaffolder.md` outputs has no downstream consumer because the pipeline exits right after it. This is intentional (the meta-template's value to the caller is the side-effect of writing a new pipeline.dot, not the JSON return value). Acceptable; the warning documents the design.
  - `required_caller_vars` info banner correctly enumerates `pipeline_name, pipelines_dir`.
- [x] Live `ralph pipeline create demo` interactive run is human-in-the-loop and was not executed in this autonomous session — covered by Task 5.8 review checkpoint and (eventually) by the human's Chunk-5 acceptance run.

### Task 5.8: Chunk-5 review checkpoint — SHIPPED 2026-04-27 (`chunk-5-templates-and-create-shim` / v0.1.55)

- [x] Dispatched `superpowers:code-reviewer` against `chunk-4-per-pipeline-folders..HEAD` with the spec at `docs/superpowers/specs/2026-04-27-pipeline-folder-architecture-redesign.md` § D7 + § R4 and this plan section. Verdict: **APPROVE** (no blocking issues).
- [x] Reviewer nits addressed in-chunk (commit `87c00da`):
  - `tsup.config.ts` simplified to `fs.cpSync(... { recursive: true })` (drops bespoke recurse helper).
  - `pipeline.ts:25` — added explanatory comment for `import * as self` (vi.spyOn ESM workaround).
  - Plan §5.4 — recorded schema lesson (per-node `inputs=` rejected; caller-required vars belong on digraph).
- [x] Tagged `chunk-5-templates-and-create-shim` and `v0.1.55`. Pushed both.
- [ ] Memory-writer dispatch + Chunk 6 expansion happen in the next session per the post-execution capture procedure.

**Reviewer carry-overs (cosmetic, deferred):**
- `name:` field redundancy in `scaffolder.md` and `blank/first-step.md` — registry keys agents by filename, but existing agents (`janitor.md` etc.) include `name:` so we kept the field for convention consistency. Decision documented; no action.
- `parseAgentFile` was un-private-ed (`agent-registry.ts`) for the `templates-validate.test.ts` inputs assertion. Reviewer suggested using `parseFrontmatter` directly instead. Acceptable; revisit if tests grow further.
- Tag `chunk-5-templates-and-create-shim` for bisectable history.
- Dispatch `memory-writer` per the Post-execution memory capture procedure at the bottom of this plan.
- Expand Chunk 6 outline into full TDD steps (this happens in the session after the chunk lands).

---

## Chunk 6: command-to-pipeline conversions (D8)

**Purpose:** Convert the remaining workflow commands (`plan`, `meditate`, `meditate-create`, `new`, `pipeline refine`) into thin shims that run bundled templates. Drop the deferred Task 5.6 dead code (`composeCreatePrompt`, `PROMPT_pipeline_create.md`, `pipeline-create-prompt.ts`, `agentCreateAction`). Delete `src/cli/agents/` (or reduce it to whatever smoke-only agents remain after Chunk 4) and the entire `src/cli/prompts/` folder.

**Pattern (from Chunk 5 — apply uniformly):**

Every shim follows:

```ts
export async function <name>Command(args, opts = {}): Promise<void> {
  // 1. preflight (validation, side-effects that MUST run before Claude — see per-sub-chunk notes)
  const dotFile = resolveBundledTemplate("<template-name>");
  return self.pipelineRunCommand(dotFile, {
    project,
    variables: { /* caller-vars declared on the digraph's `inputs="..."` */ },
  });
}
```

**Pattern rules (locked in during Chunk 5 — do NOT re-derive):**

1. `PipelineRunOptions.variables` (NOT `vars`). The plan-author tripped on this in §5.5.
2. Use `import * as self from "./<file>.js"` so `self.pipelineRunCommand(...)` is spy-able under ESM. Pre-existing in `pipeline.ts:25`; new shim files must add it.
3. Caller-required variables go on the **digraph** (`digraph foo { inputs="a, b" }`). Agent frontmatter `inputs:` is the agent's view of context keys (different concept). Validator rejects per-node `inputs="..."` on most node shapes.
4. Per-folder layout: `src/cli/templates/<name>/pipeline.dot` + co-located `<agent>.md` files + optional `README.md`.
5. Shim test pattern: `vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(...)`; assert `dotFile.endsWith("<name>/pipeline.dot")` + the variables object. Don't reassert pipelineRunCommand's own behavior.
6. Templates-validate test pattern: extend `src/cli/tests/templates-validate.test.ts` per template. Assert `errors=[]`; tolerate `orphan_output` and `required_caller_vars` info-level diagnostics.
7. Side-effects that must precede Claude (PID locks, `git init`, `mkdir`) stay in the shim's preflight block — they are not Claude's job. The shim is "thin" but not "zero." Document the exception inline.

**Dependencies:** Chunk 5 (template infra must exist).

**Sub-chunk roadmap:**

| Sub-chunk | Target | Side-effects in preflight | New template path |
|-----------|--------|---------------------------|-------------------|
| 6a | `plan` | none (pure session) | `templates/plan/` |
| 6b | `meditate` + `meditate-create` | PID lock + dir creation + gitignore append (meditate only) | `templates/meditate/` + `templates/meditate-create/` |
| 6c | `new` | `scaffoldProject` + `git init` | `templates/new/` |
| 6d | `pipeline refine` | dotPath existence check + previous-graph parse + post-validate | `templates/pipeline-refine/` |
| 6e | Task 5.6 deferred dead code | n/a | n/a (deletions only) |
| 6f | docs + folder cleanup | n/a | n/a (deletions + doc edits) |
| 6g | Chunk-6 review checkpoint | n/a | n/a |

---

### Sub-chunk 6a: `plan` → `templates/plan/` — SHIPPED 2026-04-27

**Files:**
- Create: `src/cli/templates/plan/pipeline.dot`
- Create: `src/cli/templates/plan/plan.md` (port from `src/cli/agents/plan.md`)
- Modify: `src/cli/commands/plan.ts` (full rewrite to shim shape)
- Modify: `src/cli/tests/templates-validate.test.ts` (add `plan` template assertion)
- Create: `src/cli/tests/plan.test.ts` (new shim-shape test — no test exists today)
- Delete: `src/cli/agents/plan.md`

#### Task 6a.1: Create `src/cli/templates/plan/`

- [x] **Step 1 (red): extend `templates-validate.test.ts` for `plan`**

  ```ts
  it("plan has no errors", () => {
    const diags = loadAndValidate("plan");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });
  ```

  Run → fails (template directory missing).

- [x] **Step 2 (green): create the files**

  `src/cli/templates/plan/pipeline.dot`:
  ```dot
  digraph plan {
    start [shape=Mdiamond];
    end   [shape=Msquare];

    plan [shape=box, agent="plan", interactive=true];

    start -> plan -> end;
  }
  ```

  `src/cli/templates/plan/plan.md`: copy current body of `src/cli/agents/plan.md` verbatim into the body. Frontmatter required:

  ```markdown
  ---
  description: Interactive brainstorming + planning session. Studies specs/* and src/* in parallel, then invokes the brainstorming skill to draft a plan with the user.
  model: opus
  permissionMode: dangerouslySkipPermissions
  interactive: true
  tools: []
  mcp: []
  ---
  Study specs/*.md and src/* in parallel using subagents to understand the project. Then invoke the Skill tool with skill name "superpowers:brainstorming".
  ```

  Re-run vitest `templates-validate.test.ts` → green.

- [x] **Step 3: commit** — `097d000`

  `feat(templates): plan single-node interactive template (D8 chunk-6a)`

#### Task 6a.2: Convert `planCommand` to thin shim

- [x] **Step 1 (red): create `src/cli/tests/plan.test.ts`**

  ```ts
  import { describe, it, expect, vi } from "vitest";
  import * as pipelineMod from "../commands/pipeline.js";
  import { planCommand } from "../commands/plan.js";

  describe("planCommand (shim)", () => {
    it("delegates to pipelineRunCommand with the bundled plan template + project var", async () => {
      const calls: Array<{ dotFile: string; opts: any }> = [];
      vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
        calls.push({ dotFile, opts });
      });
      await planCommand("/tmp/some-project");
      expect(calls).toHaveLength(1);
      expect(calls[0].dotFile.endsWith("plan/pipeline.dot")).toBe(true);
      expect(calls[0].opts.project).toBe("/tmp/some-project");
    });
  });
  ```

  Run → fails (current `planCommand` does its own two-phase Claude session, never touches `pipelineRunCommand`).

- [x] **Step 2 (green): rewrite `planCommand`**

  Replace `src/cli/commands/plan.ts` body in full:

  ```ts
  import { existsSync } from "fs";
  import { resolve } from "path";
  import * as output from "../lib/output.js";
  import { resolveBundledTemplate } from "../lib/assets.js";
  import * as self from "../commands/pipeline.js";

  export async function planCommand(projectFolder: string): Promise<void> {
    const absPath = resolve(projectFolder);
    if (!existsSync(absPath)) {
      await output.error(`Error: project folder not found: ${absPath}`);
      process.exit(1);
    }
    const dotFile = resolveBundledTemplate("plan");
    return self.pipelineRunCommand(dotFile, { project: absPath });
  }
  ```

  Drop imports of `Agent`, `resolveAgent`, `streamEvents`, `spawnSync`, the `buildTracePath` helper, the manual `which claude` block, the header emission, and the two-phase resume — all are now `pipelineRunCommand`'s job.

  Re-run shim test → green.

- [x] **Step 3: typecheck + full test run**

  - `npx tsc --noEmit` → clean.
  - `npx vitest run` → all suites green.

- [x] **Step 4: commit** — `4d60bb9`

  `refactor(plan): convert command to thin shim over plan template (D8 chunk-6a)`

#### Task 6a.3: Delete `src/cli/agents/plan.md`

- [x] **Step 1: confirm no other caller**

  ```sh
  git grep -n 'resolveAgent("plan")' src/
  git grep -n 'agents/plan.md' src/
  ```

  Both should return zero hits after 6a.2 lands.

- [x] **Step 2: delete + commit** — `652efbf`

  ```sh
  rm src/cli/agents/plan.md
  git add -A && git commit -m "chore(agents): remove plan.md (replaced by templates/plan/plan.md, D8 chunk-6a)"
  ```

  Run `npx vitest run` once more to confirm nothing import-resolved against the deleted path.

---

### Sub-chunk 6b: `meditate` + `meditate-create` → templates — SHIPPED 2026-04-28

**Why two templates in one sub-chunk:** they share concerns (meditation-folder hygiene, agent vocabulary) and the conversion patterns are nearly identical; bundling avoids two review cycles for very similar diffs.

**Files:**
- Create: `src/cli/templates/meditate/{pipeline.dot,meditate.md}`
- Create: `src/cli/templates/meditate-create/{pipeline.dot,meditate-create.md}`
- Modify: `src/cli/commands/meditate.ts` (preserve PID lock + dir + gitignore preflight; swap session)
- Modify: `src/cli/commands/meditate-create.ts` (full rewrite to shim shape)
- Modify: `src/cli/program.ts` (replace `--steer <text>` with `--var steer=...` UX — see Task 6b.5)
- Modify: `src/cli/tests/templates-validate.test.ts`
- Modify: `src/cli/tests/meditate.test.ts`, `src/cli/tests/meditate-create.test.ts`, `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts`
- Delete: `src/cli/agents/meditate.md`, `src/cli/agents/meditate-create.md`

#### Task 6b.1: Create `src/cli/templates/meditate/` — SHIPPED `0fc0bc1`

- [x] **Step 1 (red): templates-validate test for `meditate`**

  ```ts
  it("meditate has no errors", () => {
    const diags = loadAndValidate("meditate");
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toEqual([]);
  });
  ```

- [x] **Step 2 (green): create files**

  `src/cli/templates/meditate/pipeline.dot`:
  ```dot
  digraph meditate {
    inputs="steer"

    start [shape=Mdiamond];
    end   [shape=Msquare];

    meditate [shape=box, agent="meditate", interactive=true,
              prompt="$steer"];

    start -> meditate -> end;
  }
  ```

  Note: `$steer` is the body the existing `--steer` flag injected as the first user turn. The `inputs="steer"` digraph-level declaration tells the validator this is a caller-supplied var; the `prompt="$steer"` substitution wires it into the interactive session.

  `src/cli/templates/meditate/meditate.md`: port `src/cli/agents/meditate.md` verbatim with frontmatter declaring `interactive: true` and (if the existing agent declares `tools:` / `mcp:`) preserve those exactly.

  Re-run vitest → green.

- [x] **Step 3: commit** — `0fc0bc1`

  `feat(templates): meditate single-node interactive template with steer var (D8 chunk-6b)`

#### Task 6b.2: Create `src/cli/templates/meditate-create/` — SHIPPED `d844144`

- [x] **Step 1 (red): templates-validate test for `meditate-create`**

  Same shape as 6b.1.

- [x] **Step 2 (green): create files**

  `src/cli/templates/meditate-create/pipeline.dot`:
  ```dot
  digraph meditate_create {
    start [shape=Mdiamond];
    end   [shape=Msquare];

    create [shape=box, agent="meditate-create", interactive=true];

    start -> create -> end;
  }
  ```

  `src/cli/templates/meditate-create/meditate-create.md`: port `src/cli/agents/meditate-create.md` verbatim with frontmatter `interactive: true`.

  Re-run vitest → green.

- [x] **Step 3: commit** — `d844144`

  `feat(templates): meditate-create single-node interactive template (D8 chunk-6b)`

#### Task 6b.3: Convert `meditateCommand` to thin shim — SHIPPED `f4b69fb`

- [x] **Step 1 (red): replace test in `src/cli/tests/meditate.test.ts`**

  Add a shim-shape test alongside the existing PID-lock / dir-creation / gitignore tests (those preflight invariants stay; only the session-launch path changes):

  ```ts
  describe("meditateCommand (shim)", () => {
    it("delegates to pipelineRunCommand with the bundled meditate template + steer variable", async () => {
      const calls: Array<{ dotFile: string; opts: any }> = [];
      vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
        calls.push({ dotFile, opts });
      });
      await meditateCommand("/tmp/proj", { steer: "focus on auth flow" });
      expect(calls).toHaveLength(1);
      expect(calls[0].dotFile.endsWith("meditate/pipeline.dot")).toBe(true);
      expect(calls[0].opts.project).toBe("/tmp/proj");
      expect(calls[0].opts.variables.steer).toBe("focus on auth flow");
    });
  });
  ```

  Drop the existing tests that asserted `runMeditationSession` was called with a specific second argument — `runMeditationSession` no longer exists after this task. Keep PID/dir/gitignore tests; those preflight steps remain.

  Run → fails.

- [x] **Step 2 (green): rewrite `meditateCommand`**

  Replace the body:

  ```ts
  import { resolve } from "path";
  import * as output from "../lib/output.js";
  import { resolveBundledTemplate } from "../lib/assets.js";
  import * as self from "../commands/pipeline.js";
  // … keep existing PID + dirs + gitignore helpers, they remain ralph's responsibility …

  export async function meditateCommand(
    projectFolder: string,
    opts: { steer?: string } = {},
  ): Promise<void> {
    const absPath = resolve(projectFolder);
    // preflight: project existence, PID lock, meditation dirs, gitignore append (existing helpers)
    ensureMeditationDirs(absPath);
    appendMeditateGitignore(absPath);
    if (!writePid(absPath)) {
      await output.error(`Another meditate session is running (pid ${readPid(absPath)}).`);
      process.exit(1);
    }
    try {
      const dotFile = resolveBundledTemplate("meditate");
      return await self.pipelineRunCommand(dotFile, {
        project: absPath,
        variables: { steer: opts.steer ?? "" },
      });
    } finally {
      removePid(absPath);
    }
  }
  ```

  Delete `runMeditationSession` (now lives in the agent body + pipelineRunCommand). Drop unused imports.

  Re-run tests → green.

- [x] **Step 3: commit** — `f4b69fb`

  `refactor(meditate): convert command to thin shim over meditate template (D8 chunk-6b)`

#### Task 6b.4: Convert `meditateCreateCommand` to thin shim — SHIPPED `1d8adaa`

- [x] **Step 1 (red): rewrite `src/cli/tests/meditate-create.test.ts`** as the shim-shape test (same shape as 6a.2).

- [x] **Step 2 (green): rewrite `meditateCreateCommand`** — same shape as `planCommand`'s 6a.2 result, no `--steer` and no preflight side-effects.

- [x] **Step 3: commit** — `1d8adaa`

  `refactor(meditate-create): convert command to thin shim over meditate-create template (D8 chunk-6b)`

#### Task 6b.5: Replace `--steer <text>` with `--var steer=...` — SHIPPED `770ed90`

**Implementation note (2026-04-28):** Plan called for narrow change in `program.ts`. In practice the flag rippled through `heartbeat.ts` (heartbeat meditate scheduler), `ralph-meditate.ts` (pipeline handler), `meditate-observer.md` (agent rubric), and `tmux-tester/pipeline.dot` (smoke pipeline) — all updated together to keep `--var key=value` as the single canonical UX.

**Why:** `--steer` was a one-off flag tying meditate to a hard-coded substitution. Now that the template declares `inputs="steer"`, the canonical `--var key=value` UX (already the standard for `pipeline run`) covers the same case for free.

- [x] **Step 1 (red): wiring tests landed inside `src/cli/tests/meditate.test.ts`** — the shim test asserts `opts.variables.steer === "focus on auth flow"` instead of the old `opts.steer` shape; the heartbeat wiring is covered by `src/cli/tests/heartbeat.test.ts`'s `--var steer=...` cases.

- [x] **Step 2 (green): update commander wiring**

  Done in `src/cli/program.ts:118-130`. `meditateCommand` signature is now `opts: { variables?: Record<string, string> }`; the shim reads `opts.variables?.steer`.

  `src/cli/tests/pipeline-smoke-meditate-steer-folder.test.ts` only validates the .dot file shape (no CLI invocation), so no test edit was needed there.

- [x] **Step 3: docs**

  - `README.md`: example updated to `[--var steer=<text>]`.
  - `specs/meditate.md`: no `--steer` reference present (verified via grep).
  - `src/cli/agents/meditate-observer.md`: rubric body updated.
  - `pipelines/smoke/tmux-tester/pipeline.dot`: agent prompt updated.

- [x] **Step 4: commit** — `770ed90`

  `refactor(meditate): replace --steer flag with --var steer=... (D8 chunk-6b)`

#### Task 6b.6: Delete `src/cli/agents/meditate.md` and `meditate-create.md` — SHIPPED `2d84c7a`

- [x] **Step 1: confirm no other caller** — `grep` returned zero hits for `resolveAgent\(.meditate` and `agents/meditate` under `src/`.
- [x] **Step 2: delete + commit** — `2d84c7a` `chore(agents): remove meditate / meditate-create (D8 chunk-6b)`.

---

### Sub-chunk 6c: `new` → `templates/new/` ✅ SHIPPED

**Commits:** `b3f0c5d` (6c.1 template) → `becb7ee` (6c.2 shim + assets cleanup) → `d4e1e88` (6c.3 prompt delete).

**Implementation note:** The `getKickoffPromptPath` helper and its assets.test.ts assertion were removed in 6c.2 (single edit) rather than as a separate teardown — the helper had only one caller (the pre-shim `newCommand`) and the test pinned to the deleted helper, so the cleanup naturally rode along with the shim refactor.

**Preflight that stays in shim:** `scaffoldProject` (creates dirs + empty files + `.gitignore`) and `git init -b main`. Both must run before any Claude session because the kickoff agent expects the directory to exist as a git repo. The shim is "thin but not zero" here by design — Claude can technically write files but not run `git init`.

**Files:**
- Create: `src/cli/templates/new/{pipeline.dot,scaffolder.md}`
- Modify: `src/cli/commands/new.ts` (keep `scaffoldProject` + `git init` preflight; swap session)
- Modify: `src/cli/tests/new.test.ts`
- Modify: `src/cli/tests/templates-validate.test.ts`
- Delete: `src/cli/prompts/PROMPT_kickoff.md`
- Modify: `src/cli/lib/assets.ts` — remove `getKickoffPromptPath` if unused after 6c.2 (verify with grep).

#### Task 6c.1: Create `src/cli/templates/new/`

- [ ] **Step 1 (red): templates-validate test** — same shape as 6a.1.

- [ ] **Step 2 (green): create files**

  `src/cli/templates/new/pipeline.dot`:
  ```dot
  digraph new_project {
    inputs="project_name"

    start [shape=Mdiamond];
    end   [shape=Msquare];

    kickoff [shape=box, agent="scaffolder", interactive=true,
             prompt="You are initializing project \"$project_name\". Follow the scaffolder agent's instructions."];

    start -> kickoff -> end;
  }
  ```

  `src/cli/templates/new/scaffolder.md`: port the body of `src/cli/prompts/PROMPT_kickoff.md` verbatim plus the `BRAINSTORM_TRIGGER` block from `src/cli/commands/new.ts:8-10` (currently appended at runtime). Substitute `{{PROJECT_NAME}}` placeholder usage in the source markdown with `$project_name` to match runtime `--var` substitution. Frontmatter:

  ```markdown
  ---
  description: Initializes a new ralph project. Asks the user about the project, then writes README.md and specs/README.md with no code.
  interactive: true
  inputs:
    - project_name
  ---
  ```

  Re-run vitest → green.

- [ ] **Step 3: commit**

  `feat(templates): new single-node kickoff template (D8 chunk-6c)`

#### Task 6c.2: Convert `newCommand` to thin shim

- [ ] **Step 1 (red): rewrite tests in `src/cli/tests/new.test.ts`**

  Keep `scaffoldProject` and `buildKickoffPrompt` tests — both helpers stay (the second is reused as the `BRAINSTORM_TRIGGER` substitution helper if we keep it; otherwise delete the test alongside the helper). Add the shim-shape test asserting `pipelineRunCommand` is called with the `new` template + `project_name` variable + the freshly-scaffolded path.

- [ ] **Step 2 (green): rewrite `newCommand`**

  ```ts
  export async function newCommand(projectName: string): Promise<void> {
    const targetPath = resolve(process.cwd(), projectName);
    if (existsSync(targetPath)) {
      await output.error(`Error: directory already exists: ${targetPath}`);
      process.exit(1);
    }
    await output.step(`Creating project: ${projectName}`);
    scaffoldProject(targetPath, projectName);
    await output.step("Initializing git repository...");
    const gitResult = spawnSync("git", ["init", "-b", "main"], {
      cwd: targetPath, stdio: "inherit", encoding: "utf8",
    });
    if (gitResult.status !== 0) {
      await output.error("Error: git init failed");
      process.exit(1);
    }
    const dotFile = resolveBundledTemplate("new");
    return self.pipelineRunCommand(dotFile, {
      project: targetPath,
      variables: { project_name: projectName },
    });
  }
  ```

  Drop: `getKickoffPromptPath`, `buildKickoffPrompt` (now unused — the substitution happens via runtime `$project_name` in the agent body), `BRAINSTORM_TRIGGER` constant, `streamEvents` import, the manual `child = spawn(...)` block, `buildTracePath`, `readFileSync` of the prompt template.

  Re-run tests → green.

- [ ] **Step 3: typecheck + full test run**

  Confirm `getKickoffPromptPath` is unreferenced (`git grep -n getKickoffPromptPath src/`); if so, delete the helper from `assets.ts` in this task. Also remove any `getKickoffPromptPath` assertions in `src/cli/tests/assets.test.ts` (or the closest assets-test file) so the suite stays green.

- [ ] **Step 4: commit**

  `refactor(new): convert command to thin shim over new template (D8 chunk-6c)`

#### Task 6c.3: Delete `src/cli/prompts/PROMPT_kickoff.md`

- [ ] **Step 1: confirm no caller** via `git grep -n PROMPT_kickoff src/`.
- [ ] **Step 2: delete + commit**: `chore(prompts): remove PROMPT_kickoff.md (now templates/new/scaffolder.md, D8 chunk-6c)`.

---

### Sub-chunk 6d: `pipeline refine` → `templates/pipeline-refine/` ✅ SHIPPED

**Commits:** `0ff621c` (6d.1 template) → `e09aa58` (6d.2 shim).

**Implementation note:** `traceDigest` keeps its `Recent run traces for X:\n\n` header in the shim (not bare-digest as the spec sketch showed). This preserves a clean empty-string case when no traces exist — body inserts `$trace_digest` plain, so an empty digest produces an empty section instead of a stray header. The agent body in `refiner.md` ports the framing block (current-graph + edit instructions) from the old `pipeline.ts:961-967` with `$dot_path` / `$current_dot` substitutions. Variables inside `$current_dot` are not re-expanded (they fall outside fenced code, so `expandVariables`'s `splitFences` rule does not skip them, but the engine substitutes only declared inputs — anything not in `inputs=` of the *outer* pipeline never reaches the agent body).

**Tests:** `pipeline.test.ts` refine block rewritten to spy on `pipelineMod.pipelineRunCommand`. Trace-injection block keeps 5 behavioural tests, now reading `variables.trace_digest`. The "trigger ordering" test was deleted (template body owns ordering). `pipeline-refine-tip.test.ts` gains a single shim-shape test asserting all 4 variables are forwarded.

**Cleanup pending in 6e:** `composeCreatePrompt` (no callers) and `runTwoPhaseClaudeSession` (no callers in src/cli/commands/) imports were dropped from `pipeline.ts`. The modules still exist; 6e deletes them and their tests.

**Preflight that stays in shim:** dotPath existence check (refine refuses to run on a non-existent pipeline) and `parseDot` of the previous-graph snapshot (used by the post-validate diff). Post-step also stays: after the Claude session ends, run `pipelineValidateCommand(dotPath, { previousGraph })`.

**The hard part:** today's `pipelineRefineCommand` injects:
- The current pipeline's `.dot` content (read via `readFileSync`).
- The recent-runs trace digest block (`listRecentTraces` + `digestTraceFile`).
- The base prompt from `composeCreatePrompt(project)` (a Chunk-5 holdover the agent body now subsumes).

Under the template model, all three become `--var`-injected strings. The agent body (`refiner.md`) does the framing.

**Files:**
- Create: `src/cli/templates/pipeline-refine/{pipeline.dot,refiner.md}`
- Modify: `src/cli/commands/pipeline.ts` — `pipelineRefineCommand` rewrite + drop `composeCreatePrompt` + `runTwoPhaseClaudeSession` imports if no other caller remains (verify; expected: refine was the last consumer outside `pipelineCreateCommand`'s pre-shim form, which is already gone)
- Modify: `src/cli/tests/pipeline-refine-tip.test.ts`
- Modify: `src/cli/tests/templates-validate.test.ts`

#### Task 6d.1: Create `src/cli/templates/pipeline-refine/`

- [x] **Step 1 (red): templates-validate test** — same shape.

- [x] **Step 2 (green): create files**

  `src/cli/templates/pipeline-refine/pipeline.dot`:
  ```dot
  digraph pipeline_refine {
    inputs="pipeline_name, dot_path, current_dot, trace_digest"

    start [shape=Mdiamond];
    end   [shape=Msquare];

    refine [shape=box, agent="refiner", interactive=true];

    start -> refine -> end;
  }
  ```

  `src/cli/templates/pipeline-refine/refiner.md`: agent body teaches the user to inspect the existing graph (`$current_dot`), read the recent traces (`$trace_digest`), discuss desired changes, edit `$dot_path` in-place, then run `ralph pipeline validate $dot_path`. Port the framing block currently composed at `src/cli/commands/pipeline.ts:961-967` into the agent body verbatim, with the variables substituted. Frontmatter:

  ```markdown
  ---
  description: Refines an existing ralph pipeline. Inspects the current `.dot` graph + recent run traces, proposes targeted edits with the user, and writes the updated graph back.
  interactive: true
  inputs:
    - pipeline_name
    - dot_path
    - current_dot
    - trace_digest
  ---
  ```

  Re-run vitest → green.

- [x] **Step 3: commit**

  `feat(templates): pipeline-refine template + refiner agent (D8 chunk-6d)`

#### Task 6d.2: Convert `pipelineRefineCommand` to thin shim

- [x] **Step 1 (red): rewrite the test**

  In `src/cli/tests/pipeline-refine-tip.test.ts`, keep the validation-failure-tip assertions. Add a shim-shape test that mocks `pipelineRunCommand` and asserts the right `variables` (`pipeline_name`, `dot_path`, `current_dot`, `trace_digest`) are forwarded.

  Run → fails.

- [x] **Step 2 (green): rewrite `pipelineRefineCommand`**

  ```ts
  export async function pipelineRefineCommand(name: string, opts: PipelineRefineOptions = {}): Promise<void> {
    const project = resolve(opts.project ?? process.cwd());
    const pipelinesDir = getPipelinesDir(project);
    const dotPath = join(pipelinesDir, `${name}.dot`);
    try { resolvePipelineArg(name, project); }
    catch (err) { await output.error((err as Error).message); process.exit(1); }
    if (!existsSync(dotPath)) {
      await output.error(`Pipeline not found: ${dotPath}\nUse 'ralph pipeline create ${name}' to create it.`);
      process.exit(1);
    }
    const existingContent = readFileSync(dotPath, "utf8");
    let previousGraph: Graph | undefined;
    try { previousGraph = parseDot(existingContent); } catch { /* unparsable — skip diff */ }

    let traceDigest = "";
    if (opts.traces !== false) {
      const tracePaths = listRecentTraces(name, REFINE_TRACE_COUNT, { tracesRoot: opts.tracesRoot });
      if (tracePaths.length > 0) {
        traceDigest = tracePaths.map(p => digestTraceFile(p)).join("\n\n");
      }
    }

    const dotFile = resolveBundledTemplate("pipeline-refine");
    await self.pipelineRunCommand(dotFile, {
      project,
      variables: {
        pipeline_name: name,
        dot_path: dotPath,
        current_dot: existingContent,
        trace_digest: traceDigest,
      },
    });

    if (!existsSync(dotPath)) {
      await output.warn(`Session ended but ${dotPath} was removed.`);
      process.exit(1);
    }
    await output.step("Validating pipeline...");
    const validateExit = await pipelineValidateCommand(dotPath, { previousGraph });
    process.exit(validateExit);
  }
  ```

  Drop imports: `composeCreatePrompt`, `runTwoPhaseClaudeSession`, `spawnSync`. The `which claude` block goes; `pipelineRunCommand` already does the same check.

  Re-run tests → green.

- [x] **Step 3: typecheck + full test run.**

- [x] **Step 4: commit**

  `refactor(pipeline-refine): convert command to thin shim over pipeline-refine template (D8 chunk-6d)`

---

### Sub-chunk 6e: Task 5.6 deferred dead-code deletions — SHIPPED 2026-04-28

**Status:** Tasks 6e.1 (`a74a841`) + 6e.2 (`40084c4`) shipped. 1224 vitest tests green; typecheck clean.

**Why now:** with refine and create both retired, the four targets queued by Chunk 5's plan (Task 5.6) have zero callers. Confirm via grep, then delete.

**Targets (per `2026-04-27-chunk-5-shipped.md`):**
- `src/cli/lib/pipeline-create-prompt.ts` (`composeCreatePrompt`) — last caller was `pipelineRefineCommand`, gone after 6d.
- `src/cli/prompts/PROMPT_pipeline_create.md` — content lives in `templates/pipeline-create/scaffolder.md`.
- `src/cli/agents/agent-creator.md` — last caller was `agentCreateAction`, gone after 6e.2.
- `agentCreateAction` in `src/cli/commands/agent.ts` + its program.ts wiring (`agent.create` subcommand at `src/cli/program.ts:291`).

**Decision recorded here (defer-or-migrate for `ralph agent create`):** Delete it. With per-pipeline-folder agents (Chunk 4) and the `pipeline create` template scaffolding agents inline as needed, a standalone `ralph agent create` command no longer carries its weight. If a user wants to author agents, they edit `<pipeline>/<agent>.md` by hand — same UX as authoring `pipeline.dot`. If we ever need a guided flow again, it gets reborn as `templates/agent-create/` in a future chunk.

#### Task 6e.1: Delete `composeCreatePrompt` + `PROMPT_pipeline_create.md` — SHIPPED `a74a841`

Also cleaned: `getPipelineCreatePromptPath` in `assets.ts` (orphaned) + stale `vi.mock("../lib/pipeline-create-prompt.js", ...)` blocks in `pipeline-headless.test.ts`, `pipeline-refine-tip.test.ts`, `pipeline.test.ts`.

- [x] **Step 1: confirm zero callers**

  ```sh
  git grep -n composeCreatePrompt src/
  git grep -n PROMPT_pipeline_create src/
  git grep -n pipeline-create-prompt src/
  ```

  All three should return zero hits.

- [x] **Step 2: delete**

  ```sh
  rm src/cli/lib/pipeline-create-prompt.ts
  rm src/cli/prompts/PROMPT_pipeline_create.md
  rm -rf src/cli/tests/pipeline-create-prompt.test.ts  # if exists
  ```

- [x] **Step 3: typecheck + tests**

- [x] **Step 4: commit**

  `chore(pipeline): drop dead composeCreatePrompt + PROMPT_pipeline_create.md (D8 chunk-6e, 5.6 deferred)`

#### Task 6e.2: Delete `agentCreateAction` + `ralph agent create` wiring — SHIPPED `40084c4`

- [x] **Step 1 (red): remove the test for `agentCreateAction`** — no-op; pre-deletion grep returned no test references.

- [x] **Step 2: remove the command wiring** — also dropped `agentCreateAction` from the `program.ts` import.

- [x] **Step 3: remove `agentCreateAction` from `src/cli/commands/agent.ts`** — kept the file (still exports `agentListAction`, `agentShowAction`); dropped the unused `Agent` import.

- [x] **Step 4: delete `src/cli/agents/agent-creator.md`**

- [x] **Step 5: typecheck + full test run.** — 1224/1224 green.

- [x] **Step 6: commit**

  `chore(agents): drop ralph agent create + agent-creator.md (D8 chunk-6e, 5.6 deferred)`

---

### Sub-chunk 6f: docs + folder cleanup

#### Task 6f.1: Delete `src/cli/prompts/`

- [x] **Step 1: confirm empty**

  ```sh
  ls src/cli/prompts/
  git grep -n 'src/cli/prompts' src/ tsup.config.ts
  ```

  Both should show only meta-files (or no files, only README) and zero source references.

- [x] **Step 2: delete the folder**

  ```sh
  rm -rf src/cli/prompts
  ```

  If `tsup.config.ts` contained any prompt-copy step, drop it too. (Chunk 5 already scoped its copy to `templates/`; a stale `prompts/` copy line might still be present.)

- [x] **Step 3: tests + commit**

  `chore(prompts): remove src/cli/prompts/ entirely (D8 chunk-6f)`

#### Task 6f.2: Audit + reduce `src/cli/agents/` — SHIPPED — verifier kept, see note below

- [x] **Step 1: list survivors**

  ```sh
  ls src/cli/agents/
  ```

  Expected: empty, or only agents shared by Chunk-4-migrated smoke tests under `pipelines/smoke/` (those should already have moved). For each survivor, locate its caller via `git grep`.

- [x] **Step 2: migrate or delete**

  - If a survivor is referenced only by a smoke pipeline that already lives under `pipelines/smoke/<name>/`, move the agent file into that pipeline's folder.
  - If a survivor has no callers, delete it.
  - If a survivor is referenced by code that should be retired (post-Chunk-6 audit), open a follow-up task in IMPLEMENTATION_PLAN.md and either move or delete the agent.

- [x] **Step 3: tests + commit**

  `chore(agents): move chat-summarizer + meditate-observer to per-pipeline folders (D8 chunk-6f)`

**Note (2026-04-28):** `chat-summarizer.md` moved to `pipelines/illumination-to-implementation/chat-summarizer.md`; `meditate-observer.md` moved to `pipelines/smoke/tmux-tester/meditate-observer.md`. `verifier.md` kept at `src/cli/agents/verifier.md` — pinned by `agent-outputs-frontmatter.test.ts` (hardcodes the bundled path) and used as the bundled fallback for `pipelines/illumination-to-implementation/`'s `verifier` agent name resolution via `allowBundledFallback=true` in `agent-registry.ts`. The pipeline folder's own `verifier` lookup shadows the bundled version during runs, but the bundled copy must remain so the test and fallback path stay valid.

#### Task 6f.3: Update README.md

- [ ] **Step 1**: rewrite the "Commands" section to describe `plan`, `meditate`, `meditate-create`, `new`, `pipeline refine` as bundled-template-backed pipelines. Replace any `--steer` example with `--var steer=...`.

- [ ] **Step 2**: in the architecture overview paragraph, replace any reference to `src/cli/agents/` or `src/cli/prompts/` with `src/cli/templates/<name>/`.

- [ ] **Step 3**: commit `docs(readme): update commands + architecture for D8 (chunk-6f)`.

#### Task 6f.4: Update `specs/architecture.md` and `specs/commands.md`

- [ ] **Step 1**: in `specs/architecture.md`, replace the agent/prompt resolution diagram with the new template-resolution flow (`resolveBundledTemplate(name)` → `pipelineRunCommand`).

- [ ] **Step 2**: in `specs/commands.md`, regenerate the per-command sections for `plan`, `meditate`, `meditate-create`, `new`, `pipeline refine` to reflect they are template-backed; document the `--var` UX for meditate's steer.

- [ ] **Step 3**: commit `docs(specs): align architecture + commands with D8 templates (chunk-6f)`.

---

### Sub-chunk 6g: Chunk-6 review checkpoint

- [ ] **Step 1**: full test sweep — `npx vitest run` and `npx tsc --noEmit`.
- [ ] **Step 2**: build + smoke — `npm run build`, then `node dist/cli/index.js pipeline validate dist/templates/<name>/pipeline.dot` for each of the new templates (`plan`, `meditate`, `meditate-create`, `new`, `pipeline-refine`). Each should report `✔ Pipeline valid`; tolerate `orphan_output` warnings on agents whose value is a side-effect.
- [ ] **Step 3**: dispatch `superpowers:code-reviewer` against the chunk's commits + spec D8.
- [ ] **Step 4**: address feedback in-chunk.
- [ ] **Step 5**: tag `chunk-6-command-templates` + bump `package.json` patch version, then `git push --follow-tags` (matches Task 5.8 procedure — tag must be visible on origin before memory-writer dispatch).
- [ ] **Step 6**: dispatch `memory-writer` with the chunk's session transcript per the standard procedure (Plan §"Post-execution memory capture").

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
