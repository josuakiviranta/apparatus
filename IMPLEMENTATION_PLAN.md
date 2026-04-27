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

## Chunk 2: `inputs:` frontmatter + flow validator (D5) — outline

**Purpose:** Add per-node `inputs:` declaration and the static flow-analysis validator that catches missing producers, branch-incomplete inputs, type mismatches, orphan outputs, and required `--var` keys before any live run.

**High-level shape:**
- Extend `parseAgentFile` and `validateAgentConfig` with `inputs?: string[]` (Task 2.1).
- Extend `AgentNodeSchema` with `inputs?: string[]` (Task 2.2).
- Add `flow-analyzer.ts` to `src/attractor/core/` that walks the DAG and computes per-node "vars in scope" (Task 2.3).
- Add validator rules (Task 2.4):
  - `missing_input_producer` (error)
  - `branch_incomplete_input` (error unless `default_<key>=` set)
  - `input_type_mismatch` (error — output enum doesn't satisfy condition value)
  - `orphan_output` (warning)
  - `required_caller_vars` (info-level — printed at top of validate output)
- Migrate `verifier.md` to declare `inputs:` (Task 2.5).
- Test against `illumination-to-implementation.dot`'s full topology — conditional edges, retry loops, default fallbacks (Task 2.6).
- Chunk-2 review checkpoint (Task 2.7).

**Dependencies:** Chunk 1 (the parser + AgentConfig must understand new frontmatter keys).

**Plan-expansion note:** Fully detailed TDD steps to be written when Chunk 1 lands.

---

## Chunk 3: gates as `.md` files (D3) — outline

**Purpose:** Move gate prompts out of `.dot` `label=` attributes into `.md` files matching the agent shape, with `type: gate` discriminator in frontmatter.

**High-level shape:**
- Add `GateNodeFrontmatterSchema` to `src/attractor/core/schemas.ts` (Task 3.1):
  ```typescript
  type: literal("gate"),
  choices: array(string),
  inputs: optional array(string),
  outputs: { choice: { enum: choices } },
  ```
- Extend the engine's gate handler to load prompt body from `<node-id>.md` when no inline `label=` is set (Task 3.2).
- Validator rule (Task 3.3): every gate node either has an inline `label=` OR a sibling `<node-id>.md` with `type: gate`. Diagnostic `gate_handler_missing` if neither.
- Migrate the four gates in `illumination-to-implementation.dot` (`remove_gate`, `approval_gate`, `review_gate`, `tmux_confirm_gate`) to `.md` files (Tasks 3.4 — 3.7, one per gate).
- Smoke gates (`pipelines/smoke/gate.dot`) keep inline labels — they test the inline path.
- Chunk-3 review checkpoint.

**Dependencies:** Chunks 1 + 2 (so gates can self-describe their `outputs:` + `inputs:`).

---

## Chunk 4: per-pipeline folder migration (D1, D4) — outline

**Purpose:** Move every project pipeline into its own folder. Relocate agents from `src/cli/agents/` into the pipeline folders that use them. Delete `pipelines/scripts/` and `pipelines/schemas/`.

**High-level shape:**
- Per-pipeline migration steps (one task per pipeline):
  1. Create the new folder.
  2. Move `<name>.dot` → `<name>/pipeline.dot`.
  3. Copy used agents from `src/cli/agents/<agent>.md` into the folder. Shared agents (`task`, `chat`, `tmux-tester`, `verifier`, etc.) are duplicated into every consuming pipeline folder per Decision 4 (no fallback, full self-containment). After all migrations, `src/cli/agents/` is empty (or only retains the agents Chunks 5-6 will move into templates).
  4. Move used scripts from `pipelines/scripts/<name>.mjs` into the folder; update `script_file=` paths in `.dot` to be folder-relative.
  5. Move used schemas from `pipelines/schemas/<name>.json` into the folder (or, if the agent already migrated to `outputs:` frontmatter in Chunks 1-3, delete the now-orphaned schema). Update `json_schema_file=` paths to be folder-relative; the `../schemas/...` reference in `smoke/tmux-tester.dot` dies as part of this step.
  6. Run `pipeline validate` and `pipeline run` against scratch.

- **Project pipelines to migrate (real workflows, 2):**
  - `pipelines/illumination-to-implementation.dot` → `pipelines/illumination-to-implementation/`
  - `pipelines/janitor.dot` → `pipelines/janitor/`

- **Smoke pipelines to migrate (test fixtures, 14):** all `pipelines/smoke/*.dot` move to `pipelines/smoke/<name>/pipeline.dot` for uniformity (Decision 1: per-pipeline folder = SSoT, no exceptions for test fixtures):
  - `agent-implement`, `agent-json-vars`, `chat-end-to-end`, `chat-only`, `conditional`, `gate`, `json-schema-stream`, `meditate-steer`, `missing-caller-var`, `static-multi-node`, `store`, `tmux-tester`, `tool`, `tool-runtime-vars`
  - Each smoke is small (1-3 nodes) so the resulting folder typically holds `pipeline.dot` + 1-2 `.md`/`.mjs` files. Acceptable folder bloat for uniform structure.

- After all 16 migrations: delete `pipelines/scripts/`, `pipelines/schemas/`, and any remaining unused `src/cli/agents/*.md` (the rest go into templates in Chunks 5-6).
- Lookup change in `src/cli/lib/agent-registry.ts` (Task 4.last): pipeline folder is the only resolution path; bundled fallback for project pipelines is removed (still kept for templates, see Chunk 5).
- Chunk-4 review checkpoint.

**Pre-existing-pipeline inventory note:** an earlier draft of this chunk listed `poc-implement`, `gate-test`, and `illumination-to-plan` as pipelines to migrate. None of those exist in the current `pipelines/` tree — they were artifacts of a stale inventory. The list above was re-verified against the working tree before plan acceptance.

**Dependencies:** Chunks 1, 2, 3 (every node must self-describe before moving its file).

**Risk note:** This chunk has the largest blast radius. Each pipeline migrates as its own commit so a regression is bisectable.

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
