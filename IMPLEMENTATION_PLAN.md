# Agent Output Validation and Retry — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish wiring chunk-1's `outputs:` frontmatter into the runtime, add self-healing validation retry inside the agent handler, persist the failure trail in run dirs + JSONL trace, delete the legacy `json_schema_file=` attribute, and migrate the 7 remaining `.json` schema files into per-agent frontmatter.

**Architecture:** Handler reads `config.jsonSchema` (already derived from `outputs:` per `agent.ts:464`) when `node.jsonSchemaFile` is absent. A new `outputs-to-zod.ts` helper builds a `z.ZodObject` from the frontmatter fragment. After every agent run, the handler `safeParse`s the output; on failure it persists the raw output, emits a JSONL `validation-failure` event, opens a TUI iteration block via the existing `onIterationStart` hook, then re-invokes the agent via `--resume <sessionId>` with a corrective user turn. Cap defaults to 1 retry; per-node override `output_validation_retries=N`. After cap exhaustion, the node fails with `agent.success=false` so the engine's existing retry idiom (`max_retries=N`, condition self-edges) can compose on top.

**Tech Stack:** TypeScript, Node.js, vitest, zod (already in use in `src/attractor/core/schemas.ts`), `yaml` (already a dep), `@ts-graphviz/ast` (existing, used for SVG rendering).

**Spec:** `docs/superpowers/specs/2026-04-29-agent-output-validation-and-retry.md`

---

## Current Status

**DONE:**
- Chunk 1 — Handler unification + zod builder + verifier prompt fix (commits `f9f36b2`, `560e528`, `908ebf5`)
- Chunk 2 — Validation retry + tracing + TUI surfacing (commits `88ffe3d`, `722be13`, `69618e3`, `c0d4539`, `5fe5d0f`, `f51606c`)
- Task 3.1 — `agent_missing_outputs` validator rule (commit `516c2bb`)
- Task 3.2 — Atomic schemas-to-frontmatter migration for `illumination-to-implementation` (commit `516c2bb`)
- Task 3.3 — Annotated `ralph pipeline show` SVG with inputs/outputs (commit `eb05de9`)
- Task 3.4 Step 3 — Smoke validate all `pipelines/smoke/*.dot` (14/14 green)
- Chunk 1 / Chunk 2 / Chunk 3 Review Checkpoints — `superpowers:code-reviewer` subagent loops PASSED (this session). Chunk-3 follow-up: dead `Node.jsonSchemaFile` field deleted + stale failureReason wording updated.
- Tag `chunk-7-agent-output-validation` created.

**REMAINING:**
- Task 3.4 Steps 1–2 — live `illumination-to-implementation` pipeline run + trace inspection. Requires interactive human gates and a real Claude session; deferred to a human-driven run.

---

## File Structure

| Area | File | What changes |
|---|---|---|
| Handler unification | `src/attractor/handlers/agent-handler.ts` | Use `config.jsonSchema` when `node.jsonSchemaFile` absent. Add validation+retry loop using the extracted `evaluate-agent-output` helper. Write `raw-attempt-N.txt` per attempt. Emit `onValidationFailure` callbacks. |
| Output evaluator | `src/attractor/handlers/evaluate-agent-output.ts` (NEW) | `evaluateAgentOutput(raw, zodSchema) → {ok, parsed} | {ok:false, errors}`. Parses stream-json, extracts the result payload, runs zod safeParse. Pure helper, easily unit-testable. |
| Agent SDK | `src/cli/lib/agent.ts` | Allow `-p` + stdin pipe on `isResume` runs so corrective message reaches a resumed session. |
| Zod builder | `src/cli/lib/outputs-to-zod.ts` (NEW) | Convert `Record<string, JsonSchemaFragment>` → `z.ZodObject`. Strict accept-list: string/number/boolean/enum/array-of-primitives/nullable/maxLength/description. Throw on unsupported shapes. |
| Corrective message | `src/cli/lib/corrective-message.ts` (NEW) | `buildCorrectiveMessage(rawOutput, errors, schemaJsonString) → string`. Two paths: empty-output, invalid-output. |
| Tracer | `src/attractor/tracer/jsonl-pipeline-tracer.ts` | Add `onValidationFailure({nodeReceiveId, node, attempt, errors, rawOutputPath})` writing `validation-failure` events via `this.append`. |
| Tracer interface | `src/attractor/tracer/pipeline-tracer.ts` | Add optional `onValidationFailure?` method matching the existing `on*` naming convention. |
| Engine wiring | `src/attractor/core/engine.ts` | Add `onValidationRetryStart` to `EngineRunOptions`. In `meta` block, inject `onValidationFailure` (closes over `nodeReceiveId` + `node` and forwards to `traceWriter.onValidationFailure`) and `onValidationRetryStart`. |
| Handler context | `src/attractor/handlers/registry.ts` | Add `onValidationFailure?: (...) => void` and `onValidationRetryStart?: (nodeId, attempt) => void` to `HandlerExecutionContext`. Engine injects `nodeReceiveId` so the handler does not need to know it. |
| Pipeline command wiring | `src/cli/commands/pipeline.ts` | Provide `onValidationRetryStart` that emits a TUI iteration block via existing `emit({kind:"start"...})`. Extend `--node-receive` view to surface validation attempts inline (filtered by `nodeReceiveId`). |
| Node schema | `src/attractor/core/schemas.ts` | Delete `jsonSchemaFile` field from `AgentNodeSchema`. Add `outputValidationRetries: z.coerce.number().int().nonnegative().optional()`. |
| Validator | `src/attractor/core/graph.ts` | Add `agent_missing_outputs` rule (error) + `agent_outputs_empty` rule (warning) per spec D2. |
| Pipeline show annotation | `src/cli/commands/pipeline.ts` (or sibling `pipeline-show.ts` if extracted) | Augment SVG render pass with declared inputs/outputs sublabels per agent node and edge labels for inferred data flow. |
| Migration target | `pipelines/illumination-to-implementation/` | Fold 7 `.json` files into agent `.md` frontmatter; remove `json_schema_file=...` attributes from `pipeline.dot`; declare `outputs: {}` on `implement.md`; append prompt fix to `verifier.md`. |
| Tests | `src/attractor/tests/agent-handler-validation.test.ts` (NEW), `src/attractor/tests/agent-handler-retry.test.ts` (NEW), `src/cli/tests/outputs-to-zod.test.ts` (NEW), `src/cli/tests/corrective-message.test.ts` (NEW), `src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts` (NEW), `src/attractor/tests/pipeline-tracer.test.ts` (extend), `src/attractor/tests/graph-validator.test.ts` (extend), `src/cli/tests/pipeline-trace-command.test.ts` (extend), `src/cli/tests/pipeline-show.test.ts` (extend) | New + extended tests per chunk. |

---

## Chunk 1: Handler unification + zod builder + verifier prompt fix

**Ships green:** `outputs:`-only agents (no `json_schema_file=` on the node) now activate the structured-output parse path. Verifier-style failures from chunk-1 stop being silent. Verifier prompt one-liner reduces the empty-output trap.

### Task 1.1 — Handler reads `config.jsonSchema` when `node.jsonSchemaFile` absent

**Files:**
- Test: `src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts` (NEW)
- Modify: `src/attractor/handlers/agent-handler.ts:69-78`

- [x] **Step 1: Write the failing test**

```ts
// src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts
import { describe, it, expect, vi } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";

describe("AgentHandler — frontmatter outputs activates parse path", () => {
  it("uses config.jsonSchema when node has no json_schema_file", async () => {
    const fakeAgent = {
      run: vi.fn().mockResolvedValue({
        exitCode: 0,
        sessionId: "s-1",
        output: JSON.stringify([
          { type: "system", subtype: "init", session_id: "s-1" },
          { type: "result", subtype: "success", result: '{"foo":"bar"}' },
        ]),
      }),
    };
    const handler = new AgentHandler({
      resolveAgent: () => ({
        name: "a", description: "d", model: "opus",
        permissionMode: "default", tools: [], mcp: [], prompt: "",
        outputs: { foo: "string" },
        jsonSchema: '{"type":"object","properties":{"foo":{"type":"string"}},"required":["foo"],"additionalProperties":false}',
      }) as any,
      createAgent: () => fakeAgent as any,
    });
    const node: any = { id: "n1", agent: "a", prompt: "do it" };
    const ctx: any = { values: {} };
    const meta: any = {
      logsRoot: "/tmp/test-runs", cwd: process.cwd(), dotDir: "/tmp",
      completedNodes: [], nodeRetries: {},
    };
    const outcome = await handler.execute(node, ctx, meta);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates).toMatchObject({ foo: "bar" });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts`
Expected: FAIL — `contextUpdates` will not contain `foo` because handler skips parse path.

- [x] **Step 3: Modify handler to fall back to `config.jsonSchema`**

In `src/attractor/handlers/agent-handler.ts` replace the block at lines 69-78:

```ts
// Read JSON schema: prefer node.jsonSchemaFile (legacy, deleted in chunk 3),
// fall back to config.jsonSchema derived from agent frontmatter outputs:.
const jsonSchemaFile = node.jsonSchemaFile as string | undefined;
let jsonSchema: string | undefined;
if (jsonSchemaFile) {
  try {
    jsonSchema = readFileSync(resolve(dotDir, jsonSchemaFile), "utf8");
  } catch (err) {
    return { status: "fail", failureReason: `Failed to read json_schema_file "${jsonSchemaFile}": ${(err as Error).message}` };
  }
} else if (config.jsonSchema) {
  jsonSchema = config.jsonSchema;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts`
Expected: PASS.

- [x] **Step 5: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 6: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts
git commit -m "feat(handler): activate parse path from frontmatter outputs:"
```

### Task 1.2 — `outputs-to-zod.ts` strict accept-list helper

**Files:**
- Create: `src/cli/lib/outputs-to-zod.ts`
- Test: `src/cli/tests/outputs-to-zod.test.ts` (NEW)

- [x] **Step 1: Write the failing tests covering the strict accept-list**

```ts
// src/cli/tests/outputs-to-zod.test.ts
import { describe, it, expect } from "vitest";
import { outputsToZod } from "../lib/outputs-to-zod.js";

describe("outputsToZod", () => {
  it("shorthand string", () => {
    const schema = outputsToZod({ foo: "string" });
    expect(schema.safeParse({ foo: "x" }).success).toBe(true);
    expect(schema.safeParse({ foo: 1 }).success).toBe(false);
  });

  it("shorthand number/boolean", () => {
    const s = outputsToZod({ n: "number", b: "boolean" });
    expect(s.safeParse({ n: 1, b: true }).success).toBe(true);
    expect(s.safeParse({ n: "1", b: true }).success).toBe(false);
  });

  it("enum", () => {
    const s = outputsToZod({ label: { enum: ["true", "false", "empty"] } });
    expect(s.safeParse({ label: "true" }).success).toBe(true);
    expect(s.safeParse({ label: "maybe" }).success).toBe(false);
  });

  it("array of primitives", () => {
    const s = outputsToZod({ xs: { type: "array", items: "string" } });
    expect(s.safeParse({ xs: ["a","b"] }).success).toBe(true);
    expect(s.safeParse({ xs: [1] }).success).toBe(false);
  });

  it("nullable form ([type, null])", () => {
    const s = outputsToZod({ p: { type: ["string", "null"] } });
    expect(s.safeParse({ p: "x" }).success).toBe(true);
    expect(s.safeParse({ p: null }).success).toBe(true);
    expect(s.safeParse({ p: 1 }).success).toBe(false);
  });

  it("string maxLength", () => {
    const s = outputsToZod({ short: { type: "string", maxLength: 5 } });
    expect(s.safeParse({ short: "abcde" }).success).toBe(true);
    expect(s.safeParse({ short: "abcdef" }).success).toBe(false);
  });

  it("description is passive (does not affect validation)", () => {
    const s = outputsToZod({ foo: { type: "string", description: "anything" } });
    expect(s.safeParse({ foo: "x" }).success).toBe(true);
  });

  it("all keys required by default (no optional support)", () => {
    const s = outputsToZod({ foo: "string", bar: "string" });
    expect(s.safeParse({ foo: "x" }).success).toBe(false);
  });

  it("rejects unsupported fragment shapes with a clear message", () => {
    expect(() => outputsToZod({ foo: { type: "object", properties: {} } as any }))
      .toThrow(/outputs\[foo\]: unsupported fragment shape/);
    expect(() => outputsToZod({ foo: { type: "number", minimum: 0 } as any }))
      .toThrow(/outputs\[foo\]: unsupported fragment shape/);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/outputs-to-zod.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement `outputs-to-zod.ts`**

```ts
// src/cli/lib/outputs-to-zod.ts
import { z, type ZodObject, type ZodTypeAny } from "zod";
import type { JsonSchemaFragment } from "./agent.js";

const ALLOWED_KEYS_OBJECT = new Set(["type", "enum", "items", "maxLength", "description"]);

function fragmentToZod(key: string, frag: JsonSchemaFragment): ZodTypeAny {
  if (typeof frag === "string") {
    switch (frag) {
      case "string": return z.string();
      case "number": return z.number();
      case "boolean": return z.boolean();
      default:
        throw new Error(`outputs[${key}]: unsupported fragment shape (shorthand "${frag}"). Supported shorthands: string, number, boolean.`);
    }
  }
  const obj = frag as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter(k => !ALLOWED_KEYS_OBJECT.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(`outputs[${key}]: unsupported fragment shape (unknown keys: ${unknownKeys.join(", ")}). Supported: type (string|number|boolean|array), enum, items, maxLength, description, nullable form ([type, "null"]).`);
  }
  // enum
  if (Array.isArray(obj.enum)) {
    const values = obj.enum.map(String);
    return z.enum(values as [string, ...string[]]);
  }
  // array
  if (obj.type === "array") {
    const items = obj.items;
    if (typeof items !== "string") {
      throw new Error(`outputs[${key}]: array requires items: <primitive type>`);
    }
    const inner = fragmentToZod(`${key}.items`, items as JsonSchemaFragment);
    return z.array(inner);
  }
  // nullable ([type, "null"])
  if (Array.isArray(obj.type) && obj.type.length === 2 && obj.type.includes("null")) {
    const realType = obj.type.find(t => t !== "null") as string;
    const inner = fragmentToZod(`${key}.nullable`, realType as JsonSchemaFragment);
    return inner.nullable();
  }
  // string with maxLength
  if (obj.type === "string") {
    let s = z.string();
    if (typeof obj.maxLength === "number") s = s.max(obj.maxLength);
    return s;
  }
  if (obj.type === "number") return z.number();
  if (obj.type === "boolean") return z.boolean();

  throw new Error(`outputs[${key}]: unsupported fragment shape (type=${JSON.stringify(obj.type)}). Supported: type (string|number|boolean|array), enum, items, maxLength, description, nullable form ([type, "null"]).`);
}

export function outputsToZod(
  outputs: Record<string, JsonSchemaFragment>,
): ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, frag] of Object.entries(outputs)) {
    shape[key] = fragmentToZod(key, frag);
  }
  return z.object(shape).strict();
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/outputs-to-zod.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/outputs-to-zod.ts src/cli/tests/outputs-to-zod.test.ts
git commit -m "feat(outputs-to-zod): strict accept-list zod builder for outputs: frontmatter"
```

### Task 1.3 — Verifier prompt fix (cheap prevention)

**Files:**
- Modify: `pipelines/illumination-to-implementation/verifier.md` (Output section, ~line 70)

- [x] **Step 1: Read verifier.md to confirm location**

Run: `grep -n "# Output" pipelines/illumination-to-implementation/verifier.md`
Expected: line ~70.

- [x] **Step 2: Append the prevention line to the Output section**

In `pipelines/illumination-to-implementation/verifier.md` `# Output` section, after the existing field bullets, add a final line:

```
- Emit JSON as your final TEXT response. Never inside a thinking block.
```

- [x] **Step 3: Validate the agent file still parses (re-run the existing test suite)**

Run: `npx vitest run src/cli/tests/agent-registry.test.ts`
Expected: PASS. (The agent-registry tests load real `.md` files via `parseAgentFile`; if the YAML in verifier.md is malformed, those tests will fail.)

- [x] **Step 4: Commit**

```bash
git add pipelines/illumination-to-implementation/verifier.md
git commit -m "fix(verifier): force final TEXT response (prevent thinking-block trap)"
```

### Chunk 1 Review Checkpoint

- [x] **Run plan-document-reviewer subagent against Chunk 1.** If issues found → fix in Chunk 1 → re-dispatch. Loop until ✅ Approved.
- [x] **Run code-reviewer subagent against the chunk-1 commits.** Address feedback in-chunk; re-dispatch if needed.

---

## Chunk 2: Validation + retry loop + observability

**Ships green:** Empty/invalid agent output triggers a self-healing retry via `--resume <sessionId>`. Each attempt's raw output is persisted to disk and announced via JSONL `validation-failure` events. TUI renders retries as visible iteration blocks. `ralph pipeline trace --node-receive` surfaces validation attempts.

### Task 2.1 — `agent.ts` supports prompt on resume

**Files:**
- Modify: `src/cli/lib/agent.ts:208-255` (the `run` method's resume/stdin branches)
- Test: extend or add `src/cli/tests/agent-resume.test.ts` (NEW)

- [x] **Step 1: Write the failing test**

```ts
// src/cli/tests/agent-resume.test.ts
import { describe, it, expect } from "vitest";
import { Agent } from "../lib/agent.js";

describe("Agent.run resume support", () => {
  it("on resume, builds args with -p AND a session id", () => {
    const a = new Agent({
      name: "a", description: "d", model: "opus",
      permissionMode: "default", tools: [], mcp: [], prompt: "system prompt",
    } as any);
    const args = a.buildArgs({ cwd: ".", resume: "sess-123" });
    // Note: -p is added in run(); buildArgs covers --resume and --output-format
    expect(args).toContain("--resume");
    expect(args).toContain("sess-123");
  });
});
```

- [x] **Step 2: Run test to verify current state**

Run: `npx vitest run src/cli/tests/agent-resume.test.ts`
Expected: PASS — `buildArgs` already adds `--resume` (line 155-156). This test pins the contract.

- [x] **Step 3: Modify `agent.ts:run()` to send `-p` and pipe `options.message` on resume**

In `src/cli/lib/agent.ts`, replace lines 210-213:

```ts
// Add -p for non-interactive runs (resume or fresh — corrective message
// goes via stdin in both cases)
if (!isInteractive) {
  args.unshift("-p");
}
```

And replace lines 248-255:

```ts
// Pipe content for non-interactive runs.
// Resume: only the new user-turn (system prompt already in the resumed session).
// Fresh: full system prompt, optionally followed by an initial message.
if (!isInteractive && child.stdin) {
  const stdinContent = isResume
    ? (options.message ?? "")
    : (options.message
        ? `${expandedPrompt}\n\n${options.message}`
        : expandedPrompt);
  child.stdin.write(stdinContent);
  child.stdin.end();
}
```

- [x] **Step 4: Add a behavioural test that resume + message reaches stdin**

Append to `src/cli/tests/agent-resume.test.ts`:

```ts
import { spawn } from "node:child_process";
import { vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

it("on resume with message, pipes only the message to stdin", async () => {
  const writes: string[] = [];
  const fakeChild: any = {
    stdin: { write: (c: string) => writes.push(c), end: () => {}, destroyed: false },
    stdout: null,
    once: vi.fn(),
    kill: vi.fn(),
    pid: 1234,
  };
  (spawn as any).mockReturnValue(fakeChild);

  const a = new Agent({
    name: "a", description: "d", model: "opus",
    permissionMode: "dangerouslySkipPermissions", tools: [], mcp: [], prompt: "system",
  } as any);

  // Fire-and-forget: we only care that stdin received the message before
  // the (mocked) child loop completes. Use a short race.
  void a.run({ cwd: ".", resume: "s-1", message: "fix your output" }).catch(() => {});
  await new Promise(r => setTimeout(r, 10));

  expect(writes).toContain("fix your output");
  expect(writes.find(w => w.includes("system"))).toBeUndefined();
});
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent-resume.test.ts`
Expected: PASS.

- [x] **Step 6: Run full test suite to confirm no regressions**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 7: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent-resume.test.ts
git commit -m "feat(agent): pipe corrective message to stdin on --resume"
```

### Task 2.2 — `corrective-message.ts` builder

**Files:**
- Create: `src/cli/lib/corrective-message.ts`
- Test: `src/cli/tests/corrective-message.test.ts` (NEW)

- [x] **Step 1: Write the failing tests**

```ts
// src/cli/tests/corrective-message.test.ts
import { describe, it, expect } from "vitest";
import { buildCorrectiveMessage } from "../lib/corrective-message.js";

describe("buildCorrectiveMessage", () => {
  const schema = '{"type":"object","properties":{"foo":{"type":"string"}},"required":["foo"]}';

  it("empty output → no-text-content phrasing + thinking-block warning", () => {
    const msg = buildCorrectiveMessage(
      "",
      [{ path: "(root)", message: "no text content in response" }],
      schema,
    );
    expect(msg).toMatch(/no text content/i);
    expect(msg).toMatch(/thinking block/i);
    expect(msg).toContain(schema);
  });

  it("invalid output → lists errors + truncates raw to 500 chars", () => {
    const raw = "x".repeat(1000);
    const msg = buildCorrectiveMessage(
      raw,
      [{ path: "foo", message: "Expected string, received number" }],
      schema,
    );
    expect(msg).toMatch(/foo/);
    expect(msg).toMatch(/Expected string/);
    expect(msg).not.toContain("x".repeat(1000));
    expect(msg).toContain("x".repeat(500));
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/corrective-message.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement `corrective-message.ts`**

```ts
// src/cli/lib/corrective-message.ts
const RAW_TRUNCATE = 500;

export interface ValidationError {
  path: string;
  message: string;
}

export function buildCorrectiveMessage(
  rawOutput: string,
  errors: ValidationError[],
  schemaJsonString: string,
): string {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    return [
      "Your previous response had no text content — the response body was empty",
      "(possibly because the JSON ended up inside a thinking block).",
      "",
      "Required output schema:",
      schemaJsonString,
      "",
      "Re-emit your verdict NOW as a plain TEXT response. JSON only.",
      "Do NOT place the JSON inside a thinking block — emit as text content.",
    ].join("\n");
  }
  const truncated = rawOutput.length > RAW_TRUNCATE
    ? rawOutput.slice(0, RAW_TRUNCATE) + "..."
    : rawOutput;
  const errorBullets = errors
    .map(e => `  • ${e.path || "(root)"}: ${e.message}`)
    .join("\n");
  return [
    "Your previous response failed schema validation:",
    errorBullets,
    "",
    "Your previous raw response (first 500 chars):",
    "<<<",
    truncated,
    ">>>",
    "",
    "Required output schema:",
    schemaJsonString,
    "",
    "Re-emit valid JSON matching the schema. Plain TEXT response, no thinking block, no markdown fences.",
  ].join("\n");
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/corrective-message.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/corrective-message.ts src/cli/tests/corrective-message.test.ts
git commit -m "feat(corrective-message): deterministic builder for empty/invalid output retry"
```

### Task 2.3 — Tracer extension: `onValidationFailure`

**Files:**
- Modify: `src/attractor/tracer/pipeline-tracer.ts` (interface — existing methods are `onPipelineStart`/`onNodeStart`/`onNodeEnd`/`onPipelineEnd`; add `onValidationFailure?` matching that naming convention)
- Modify: `src/attractor/tracer/jsonl-pipeline-tracer.ts` (implementation — uses `private append(...)`, NOT `write`)
- Test: `src/attractor/tests/pipeline-tracer-validation.test.ts` (NEW)

- [x] **Step 1: Read existing tracer files to confirm shape**

Run: `cat src/attractor/tracer/pipeline-tracer.ts src/attractor/tracer/jsonl-pipeline-tracer.ts`
Confirm: methods are `onPipelineStart`, `onNodeStart`, `onNodeEnd`, `onPipelineEnd`. The serializer is `private append(event: object)` at the bottom of `jsonl-pipeline-tracer.ts`.

- [x] **Step 2: Write the failing tracer test**

```ts
// src/attractor/tests/pipeline-tracer-validation.test.ts (NEW)
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlPipelineTracer } from "../tracer/jsonl-pipeline-tracer.js";

describe("JsonlPipelineTracer.onValidationFailure", () => {
  it("emits a validation-failure event line", () => {
    const dir = mkdtempSync(join(tmpdir(), "tracer-"));
    const path = join(dir, "pipeline.jsonl");
    const t = new JsonlPipelineTracer(path);
    const fakeNode = { id: "verifier" } as any;
    t.onValidationFailure({
      nodeReceiveId: "verifier-734e",
      node: fakeNode,
      attempt: 1,
      errors: [{ path: "preferred_label", message: "Required" }],
      rawOutputPath: "verifier/raw-attempt-1.txt",
    });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const evt = JSON.parse(lines[lines.length - 1]);
    expect(evt.kind).toBe("validation-failure");
    expect(evt.nodeReceiveId).toBe("verifier-734e");
    expect(evt.nodeId).toBe("verifier");
    expect(evt.attempt).toBe(1);
    expect(evt.errors[0]).toMatchObject({ path: "preferred_label" });
    expect(evt.rawOutputPath).toBe("verifier/raw-attempt-1.txt");
    expect(typeof evt.timestamp).toBe("string");
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/pipeline-tracer-validation.test.ts`
Expected: FAIL — method missing.

- [x] **Step 4: Add `onValidationFailure` to interface and implementation**

In `src/attractor/tracer/pipeline-tracer.ts` add to the `PipelineTracer` interface (after the existing `onPipelineEnd` line):

```ts
onValidationFailure?(meta: {
  nodeReceiveId: string;
  node: Node;
  attempt: number;
  errors: Array<{ path: string; message: string }>;
  rawOutputPath: string;
}): void;
```

In `src/attractor/tracer/jsonl-pipeline-tracer.ts` add the method following the same shape as `onNodeEnd` (uses `this.append`):

```ts
onValidationFailure({ nodeReceiveId, node, attempt, errors, rawOutputPath }: {
  nodeReceiveId: string;
  node: Node;
  attempt: number;
  errors: Array<{ path: string; message: string }>;
  rawOutputPath: string;
}): void {
  this.append({
    kind: "validation-failure",
    nodeReceiveId,
    nodeId: node.id,
    attempt,
    errors,
    rawOutputPath,
    timestamp: new Date().toISOString(),
  });
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/pipeline-tracer-validation.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/attractor/tracer/pipeline-tracer.ts src/attractor/tracer/jsonl-pipeline-tracer.ts src/attractor/tests/pipeline-tracer-validation.test.ts
git commit -m "feat(tracer): add onValidationFailure for retry observability"
```

### Task 2.4 — Extract `evaluate-agent-output.ts` helper

The validation+retry loop in the next task is large enough that inlining the parse/validate logic in `agent-handler.ts` would push that file into hard-to-reason-about territory. Extract a focused helper first.

**Files:**
- Create: `src/attractor/handlers/evaluate-agent-output.ts`
- Test: `src/attractor/tests/evaluate-agent-output.test.ts` (NEW)

- [x] **Step 1: Write the failing tests**

```ts
// src/attractor/tests/evaluate-agent-output.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { evaluateAgentOutput } from "../handlers/evaluate-agent-output.js";

const zodSchema = z.object({ foo: z.string() }).strict();

describe("evaluateAgentOutput", () => {
  it("empty output → fail with 'no text content' error", () => {
    const r = evaluateAgentOutput("", zodSchema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ path: "(root)" });
    expect(r.errors[0].message).toMatch(/no text content/i);
  });

  it("stream-json with valid result → ok", () => {
    const stream =
      '{"type":"system","subtype":"init","session_id":"s"}\n' +
      '{"type":"result","subtype":"success","result":"{\\"foo\\":\\"bar\\"}"}';
    const r = evaluateAgentOutput(stream, zodSchema);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({ foo: "bar" });
  });

  it("stream-json with structured_output payload → ok", () => {
    const stream =
      '{"type":"system","subtype":"init","session_id":"s"}\n' +
      '{"type":"result","subtype":"success","structured_output":{"foo":"x"}}';
    const r = evaluateAgentOutput(stream, zodSchema);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({ foo: "x" });
  });

  it("schema mismatch → fail with zod path/message", () => {
    const stream =
      '{"type":"result","subtype":"success","result":"{\\"foo\\":1}"}';
    const r = evaluateAgentOutput(stream, zodSchema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].path).toBe("foo");
    expect(r.errors[0].message).toMatch(/string/i);
  });

  it("unparseable JSON → fail", () => {
    const r = evaluateAgentOutput("not json at all", zodSchema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/JSON/i);
  });

  it("no zodSchema → ok when JSON parseable, no validation", () => {
    const stream =
      '{"type":"result","subtype":"success","result":"{\\"any\\":1}"}';
    const r = evaluateAgentOutput(stream, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({ any: 1 });
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/evaluate-agent-output.test.ts`
Expected: FAIL — module does not exist.

- [x] **Step 3: Implement `evaluate-agent-output.ts`**

```ts
// src/attractor/handlers/evaluate-agent-output.ts
import type { ZodObject, ZodTypeAny } from "zod";

export interface ValidationError { path: string; message: string }

export type EvaluationResult =
  | { ok: true; parsed: Record<string, unknown>; raw: string }
  | { ok: false; errors: ValidationError[]; raw: string };

/**
 * Inspect a buffered agent stdout (stream-json) and return either the parsed
 * structured result or a list of validation errors.
 *
 * Empty input → single "no text content" error (the verifier-style trap).
 * Schema validation runs only when zodSchema is non-null.
 */
export function evaluateAgentOutput(
  raw: string,
  zodSchema: ZodObject<Record<string, ZodTypeAny>> | null,
): EvaluationResult {
  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      raw: "",
      errors: [{ path: "(root)", message: "no text content in response" }],
    };
  }
  const resultPayload = extractResultPayload(raw) ?? raw;
  const jsonMatch = resultPayload.match(/\{"[\s\S]*\}/) ?? resultPayload.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : resultPayload;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return {
      ok: false,
      raw,
      errors: [{ path: "(root)", message: `JSON parse failed: ${(e as Error).message}` }],
    };
  }
  if (zodSchema) {
    const result = zodSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        raw,
        errors: result.error.issues.map(i => ({
          path: i.path.length === 0 ? "(root)" : i.path.join("."),
          message: i.message,
        })),
      };
    }
    return { ok: true, parsed: result.data, raw };
  }
  return { ok: true, parsed, raw };
}

function extractResultPayload(raw: string): string | undefined {
  let payload: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(trimmed) as Record<string, unknown>; }
    catch { continue; }
    if (evt.type !== "result") continue;
    if (evt.structured_output != null) {
      payload = typeof evt.structured_output === "string"
        ? evt.structured_output
        : JSON.stringify(evt.structured_output);
    } else if (evt.result != null && evt.result !== "") {
      payload = typeof evt.result === "string"
        ? evt.result
        : JSON.stringify(evt.result);
    }
  }
  return payload;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/evaluate-agent-output.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/attractor/handlers/evaluate-agent-output.ts src/attractor/tests/evaluate-agent-output.test.ts
git commit -m "feat(handlers): extract evaluate-agent-output helper for parse + zod validation"
```

### Task 2.5 — Handler validation + retry loop

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts` (replace existing parse block with attempt loop using the helper from 2.4)
- Modify: `src/attractor/handlers/registry.ts` (extend `HandlerExecutionContext` with optional callbacks)
- Modify: `src/attractor/core/schemas.ts:22` area (add `outputValidationRetries` field on `AgentNodeSchema`)
- Test: `src/attractor/tests/agent-handler-retry.test.ts` (NEW)

- [x] **Step 1: Add `outputValidationRetries` to `AgentNodeSchema`**

In `src/attractor/core/schemas.ts` near the existing `maxRetries` field (line 22), add:

```ts
outputValidationRetries: z.coerce.number().int().nonnegative().optional()
  .describe("Number of times to retry the agent on output validation failure (default 1)."),
```

- [x] **Step 2: Extend `HandlerExecutionContext`**

In `src/attractor/handlers/registry.ts` add to the `HandlerExecutionContext` interface (callback names mirror the tracer's `on*` convention; the `nodeReceiveId` is injected by the engine wiring in Task 2.6, so the handler does not need to know it):

```ts
onValidationFailure?: (args: {
  attempt: number;
  errors: Array<{ path: string; message: string }>;
  rawOutputPath: string;
}) => void;
onValidationRetryStart?: (nodeId: string, attempt: number) => void;
```

- [x] **Step 3: Write the failing handler-retry tests**

```ts
// src/attractor/tests/agent-handler-retry.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHandler } from "../handlers/agent-handler.js";

function makeAgent(responses: Array<{ raw: string; sessionId?: string }>) {
  let i = 0;
  return {
    run: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return {
        exitCode: 0,
        sessionId: r.sessionId ?? "sess-1",
        output: JSON.stringify([
          { type: "system", subtype: "init", session_id: r.sessionId ?? "sess-1" },
          { type: "result", subtype: "success", result: r.raw },
        ]),
      };
    }),
  };
}

function makeMeta(extra: Partial<any> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "handler-retry-"));
  return {
    logsRoot: dir, cwd: process.cwd(), dotDir: "/tmp",
    completedNodes: [], nodeRetries: {},
    ...extra,
  };
}

const config = (extras: any = {}) => ({
  name: "v", description: "d", model: "opus",
  permissionMode: "default", tools: [], mcp: [], prompt: "",
  outputs: { foo: "string" },
  jsonSchema: '{"type":"object","properties":{"foo":{"type":"string"}},"required":["foo"],"additionalProperties":false}',
  ...extras,
});

describe("AgentHandler — validation retry loop", () => {
  it("invalid first attempt + valid retry → success on attempt 2", async () => {
    const fakeAgent = makeAgent([
      { raw: '{"wrong":"key"}', sessionId: "s-1" },
      { raw: '{"foo":"bar"}', sessionId: "s-1" },
    ]);
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const meta = makeMeta();
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do" } as any,
      { values: {} } as any,
      meta as any,
    );
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.foo).toBe("bar");
    expect(fakeAgent.run).toHaveBeenCalledTimes(2);
    // Second call is the resume-with-message
    expect(fakeAgent.run.mock.calls[1][0]).toMatchObject({ resume: "s-1" });
    expect(fakeAgent.run.mock.calls[1][0].message).toMatch(/schema validation/i);
    // Persist raw outputs
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-1.txt"))).toBe(true);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-2.txt"))).toBe(true);
  });

  it("empty output → corrective uses no-text-content phrasing", async () => {
    const fakeAgent = makeAgent([
      { raw: "", sessionId: "s-2" },
      { raw: '{"foo":"x"}', sessionId: "s-2" },
    ]);
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const meta = makeMeta();
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do" } as any,
      { values: {} } as any,
      meta as any,
    );
    expect(outcome.status).toBe("success");
    expect(fakeAgent.run.mock.calls[1][0].message).toMatch(/no text content/i);
  });

  it("invalid 2 attempts → hard fail with attempts logged", async () => {
    const fakeAgent = makeAgent([
      { raw: '{"wrong":"a"}', sessionId: "s-3" },
      { raw: '{"wrong":"b"}', sessionId: "s-3" },
    ]);
    const onValidationFailure = vi.fn();
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const meta = makeMeta({ onValidationFailure });
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do" } as any,
      { values: {} } as any,
      meta as any,
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/output validation failed after 2 attempts/i);
    expect(outcome.contextUpdates?.["agent.success"]).toBe("false");
    expect(onValidationFailure).toHaveBeenCalledTimes(2);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-1.txt"))).toBe(true);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-2.txt"))).toBe(true);
  });

  it("per-node output_validation_retries=0 → no retry (single attempt only)", async () => {
    const fakeAgent = makeAgent([
      { raw: '{"wrong":"a"}', sessionId: "s-4" },
    ]);
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do", outputValidationRetries: 0 } as any,
      { values: {} } as any,
      makeMeta() as any,
    );
    expect(outcome.status).toBe("fail");
    expect(fakeAgent.run).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/agent-handler-retry.test.ts`
Expected: FAIL — retry loop not implemented.

- [x] **Step 5: Implement validation+retry loop in `agent-handler.ts`**

In `src/attractor/handlers/agent-handler.ts`:

a) Add imports near the top:

```ts
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { buildCorrectiveMessage } from "../../cli/lib/corrective-message.js";
import { evaluateAgentOutput } from "./evaluate-agent-output.js";
```

b) **Remove** the existing `if (jsonSchema && !lastResult?.output)` early-return block (currently at `agent-handler.ts:228-238`) AND the existing structured-output parse `try`/`catch` (currently at `agent-handler.ts:240-297`). These are subsumed by the loop below.

c) **Remove** the now-unused `parseStructuredOutput` import at the top of the file (the helper is replaced by `evaluateAgentOutput`).

d) Insert the validation+retry block in place of the deleted parse block:

```ts
// Validation + retry loop.
// The first attempt already ran via the iteration loop above
// (lastResult/lastSessionId hold its result). When jsonSchema is set,
// validate and possibly retry by resuming the same Claude session.
let structuredUpdates: Record<string, unknown> = {};
let preferredLabel: string | undefined;

if (jsonSchema) {
  // Build zod from frontmatter outputs: when available; otherwise we have no
  // typed schema and skip schema validation (still catches empty / unparseable
  // output via the helper).
  const zodSchema = config.outputs ? outputsToZod(config.outputs) : null;

  const writeRaw = (n: number, raw: string) =>
    writeFileSync(join(nodeDir, `raw-attempt-${n}.txt`), raw ?? "");

  writeRaw(1, lastResult?.output ?? "");

  const overrideRetries = (node as any).outputValidationRetries;
  const maxRetries =
    typeof overrideRetries === "number" && overrideRetries >= 0
      ? overrideRetries
      : 1;

  let attempt = 1;
  let evaluation = evaluateAgentOutput(lastResult?.output ?? "", zodSchema);

  while (!evaluation.ok && attempt <= maxRetries) {
    meta.onValidationFailure?.({
      attempt,
      errors: evaluation.errors,
      rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
    });

    if (!lastSessionId) {
      return {
        status: "fail",
        failureReason:
          `Output validation failed and cannot retry: agent did not report sessionId ` +
          `(attempt ${attempt}: ${evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; ")})`,
        contextUpdates: { "agent.iterations": String(iteration), "agent.success": "false" },
      };
    }

    attempt += 1;
    meta.onValidationRetryStart?.(node.id, attempt);

    const corrective = buildCorrectiveMessage(evaluation.raw, evaluation.errors, jsonSchema);

    const retryResult = await agent.run({
      cwd, signal, variables: agentVariables, onStdout,
      resume: lastSessionId, message: corrective,
    });
    lastResult = retryResult;
    if (retryResult.sessionId) lastSessionId = retryResult.sessionId;
    iteration += 1;

    writeRaw(attempt, retryResult.output ?? "");
    evaluation = evaluateAgentOutput(retryResult.output ?? "", zodSchema);
  }

  if (!evaluation.ok) {
    meta.onValidationFailure?.({
      attempt,
      errors: evaluation.errors,
      rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
    });
    return {
      status: "fail",
      failureReason:
        `Output validation failed after ${attempt} attempts: ` +
        evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; "),
      contextUpdates: { "agent.iterations": String(iteration), "agent.success": "false" },
    };
  }

  for (const [key, value] of Object.entries(evaluation.parsed)) {
    structuredUpdates[key] = typeof value === "string" ? value : String(value);
  }
  if (evaluation.parsed.preferred_label != null) {
    preferredLabel = String(evaluation.parsed.preferred_label);
  }
}

return {
  status: "success",
  ...(preferredLabel ? { preferredLabel } : {}),
  contextUpdates: {
    ...structuredUpdates,
    "agent.iterations": String(iteration),
    "agent.success": "true",
    ...(lastSessionId ? { "agent.sessionId": lastSessionId } : {}),
  },
};
```

- [x] **Step 6: Run handler-retry tests**

Run: `npx vitest run src/attractor/tests/agent-handler-retry.test.ts`
Expected: PASS.

- [x] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 8: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/handlers/registry.ts src/attractor/core/schemas.ts src/attractor/tests/agent-handler-retry.test.ts
git commit -m "feat(handler): zod validation + smart retry via --resume on output failure"
```

### Task 2.6 — Engine wiring + TUI retry block + trace command surfacing

**Files:**
- Modify: `src/attractor/core/engine.ts` (engine constructs the per-node `meta` object at `engine.ts:222-235` — add `onValidationFailure` and `onValidationRetryStart` callbacks here, injecting the in-scope `nodeReceiveId`)
- Modify: `src/attractor/core/engine.ts` `EngineRunOptions` interface (so `onIterationStart`-style callbacks have a sibling for retry events)
- Modify: `src/cli/commands/pipeline.ts` (provide `onValidationRetryStart` that emits a TUI iteration block; extend `--node-receive` view to surface validation attempts)
- Test: `src/cli/tests/pipeline-trace-command-validation.test.ts` (NEW)

- [x] **Step 1: Locate the handler-context construction**

Run: `grep -n "HandlerExecutionContext\|nodeReceiveId =" src/attractor/core/engine.ts`
Confirm: `nodeReceiveId` is generated at `engine.ts:169`, the `meta: HandlerExecutionContext = {...}` is built at lines 222-235.

- [x] **Step 2: In `engine.ts`, wire validation callbacks into `meta`**

In `src/attractor/core/engine.ts` `EngineRunOptions` interface, add (next to the existing `onIterationStart`/`onIterationEnd` fields):

```ts
onValidationRetryStart?: (nodeId: string, attempt: number) => void;
```

In the `meta` block at lines 222-235, append two callback fields after `onIterationEnd: opts.onIterationEnd,`:

```ts
onValidationFailure: (args) => {
  opts.traceWriter?.onValidationFailure?.({
    nodeReceiveId,
    node,
    attempt: args.attempt,
    errors: args.errors,
    rawOutputPath: args.rawOutputPath,
  });
},
onValidationRetryStart: opts.onValidationRetryStart,
```

(`nodeReceiveId` and `node` are in scope here — they were declared at lines 169 and 167 respectively.)

- [x] **Step 3: In `src/cli/commands/pipeline.ts`, register `onValidationRetryStart` callback in `engineOpts`**

First locate the existing `onIterationStart` callback (line numbers drift):
Run: `grep -n "onIterationStart:" src/cli/commands/pipeline.ts`

After that callback's closing `},`, add:

```ts
onValidationRetryStart: (nodeId, attempt) => {
  emit({
    kind: "start",
    nodeId,
    label: `agent · validation retry ${attempt - 1}`,
    blockKind: "agent",
  });
},
```

- [x] **Step 4: Extend `pipelineTraceCommand` `--node-receive` view to surface validation attempts**

In `src/cli/commands/pipeline.ts` `pipelineTraceCommand`, inside the `if (opts.nodeReceive)` branch (currently at lines 819-857), after the context-snapshot block and before the `completed stages` line, insert:

```ts
const failures = lines.filter(l =>
  l.kind === "validation-failure" && l.nodeReceiveId === opts.nodeReceive,
);
if (failures.length > 0) {
  console.log(`\nvalidation attempts:`);
  for (const f of failures as Array<Record<string, unknown>>) {
    const errs = (f.errors as Array<{ path: string; message: string }>)
      .map(e => `${e.path}: ${e.message}`)
      .join(", ");
    console.log(`  [${f.attempt}] ✗ failed — ${errs}`);
    console.log(`      raw: ${f.rawOutputPath}`);
  }
}
```

- [x] **Step 5: Write a real trace-command test**

```ts
// src/cli/tests/pipeline-trace-command-validation.test.ts (NEW)
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { deriveProjectKey } from "../lib/run-paths.js"; // adjust import to match codebase

describe("pipeline trace --node-receive surfaces validation attempts", () => {
  const logs: string[] = [];
  const origLog = console.log;
  beforeEach(() => { logs.length = 0; });
  beforeAll(() => { console.log = (...a) => logs.push(a.map(String).join(" ")); });
  afterAll(() => { console.log = origLog; });

  it("prints validation-failure events keyed by nodeReceiveId", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-"));
    process.env.RALPH_RUNS_ROOT = dir;
    const project = "/tmp/some-project";
    const projectKey = deriveProjectKey(project);
    const tracePath = join(dir, projectKey, "runs", "r1", "pipeline.jsonl");
    mkdirSync(join(dir, projectKey, "runs", "r1"), { recursive: true });

    const lines = [
      { kind: "pipeline-start", runId: "r1", pipelineName: "p", nodes: ["start","verifier"], timestamp: "" },
      { kind: "node-start", nodeReceiveId: "verifier-1", nodeId: "verifier", nodeKind: "agent", timestamp: "", contextSnapshot: { foo: "bar" } },
      { kind: "validation-failure", nodeReceiveId: "verifier-1", nodeId: "verifier", attempt: 1, errors: [{ path: "preferred_label", message: "Required" }], rawOutputPath: "verifier/raw-attempt-1.txt", timestamp: "" },
      { kind: "node-end", nodeReceiveId: "verifier-1", nodeId: "verifier", success: false, contextUpdates: {} },
      { kind: "pipeline-end", runId: "r1", outcome: "failure", timestamp: "" },
    ];
    writeFileSync(tracePath, lines.map(l => JSON.stringify(l)).join("\n"));

    await pipelineTraceCommand("r1", { project, nodeReceive: "verifier-1" });

    const out = logs.join("\n");
    expect(out).toMatch(/validation attempts:/);
    expect(out).toMatch(/\[1\] ✗ failed — preferred_label: Required/);
    expect(out).toMatch(/raw: verifier\/raw-attempt-1\.txt/);
  });
});
```

(If `deriveProjectKey` is exported from a different file, update the import. If `pipelineTraceCommand` calls `process.exit` on missing files, this test wraps in a try/catch — adjust as the actual command shape requires. Verify by reading `src/cli/commands/pipeline.ts:775-820` before running.)

- [x] **Step 6: Run tests**

Run: `npx vitest run src/cli/tests/pipeline-trace-command-validation.test.ts`
Expected: PASS.

- [x] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 8: Commit**

```bash
git add src/attractor/core/engine.ts src/cli/commands/pipeline.ts src/cli/tests/pipeline-trace-command-validation.test.ts
git commit -m "feat(trace): surface validation attempts in --node-receive view + TUI retry block"
```

### Chunk 2 Review Checkpoint

- [ ] **Run plan-document-reviewer subagent against Chunk 2.** Loop until ✅ Approved.
- [ ] **Run code-reviewer subagent against the chunk-2 commits.** Address feedback in-chunk.

---

## Chunk 3: Validator rules + schema deletion + 7-file migration + pipeline show annotation

**Ships green:** `json_schema_file=` no longer parses; `agent_missing_outputs` validator rule fires on offending pipelines with the migration recipe inline; the 7 in-tree `.json` files are folded into agent frontmatter; `pipeline.dot` drops `json_schema_file=` attributes; `implement.md` declares the empty-output opt-out; `verifier.md` carries the prompt fix; `ralph pipeline show` renders SVG with declared inputs/outputs annotated. Smoke run of `illumination-to-implementation` reaches the human approval gate (the original failing case).

### Task 3.1 — `agent_missing_outputs` validator rule

**Files:**
- Modify: `src/attractor/core/graph.ts`
- Test: extend `src/attractor/tests/graph-validator.test.ts` (or create `graph-validator-outputs.test.ts`)

**Status: SHIPPED 2026-04-29** — rule + tests added; 4 new tests; no fallout for migrated agents.

- [x] **Step 1: Write the failing validator test**

```ts
// src/attractor/tests/graph-validator-outputs.test.ts
import { describe, it, expect } from "vitest";
import { validateGraph } from "../core/graph.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("validator: agent_missing_outputs", () => {
  it("fires when a non-interactive agent has no outputs: declared", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "p"), { recursive: true });
    writeFileSync(join(dir, "p", "agent_a.md"), `---
name: agent_a
description: no outputs
model: opus
permissionMode: default
tools: []
mcp: []
---
do stuff
`);
    writeFileSync(join(dir, "p", "pipeline.dot"), `digraph p {
  goal="t"
  start [shape=Mdiamond]
  done [shape=Msquare]
  n1 [agent="agent_a", prompt="do"]
  start -> n1 -> done
}`);
    const result = validateGraph(join(dir, "p", "pipeline.dot"));
    expect(result.diagnostics.some(d => d.code === "agent_missing_outputs")).toBe(true);
    const diag = result.diagnostics.find(d => d.code === "agent_missing_outputs");
    expect(diag?.message).toMatch(/outputs:/);
    expect(diag?.message).toMatch(/json_schema_file/);
  });

  it("does NOT fire when agent has outputs: {}", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "p"), { recursive: true });
    writeFileSync(join(dir, "p", "agent_a.md"), `---
name: agent_a
description: opt-out
model: opus
permissionMode: default
tools: []
mcp: []
outputs: {}
---
do stuff
`);
    writeFileSync(join(dir, "p", "pipeline.dot"), `digraph p {
  goal="t"
  start [shape=Mdiamond]
  done [shape=Msquare]
  n1 [agent="agent_a", prompt="do"]
  start -> n1 -> done
}`);
    const result = validateGraph(join(dir, "p", "pipeline.dot"));
    expect(result.diagnostics.some(d => d.code === "agent_missing_outputs")).toBe(false);
  });

  it("does NOT fire for interactive=true agents", () => {
    const dir = mkdtempSync(join(tmpdir(), "validator-"));
    mkdirSync(join(dir, "p"), { recursive: true });
    writeFileSync(join(dir, "p", "agent_b.md"), `---
name: agent_b
description: interactive
model: opus
permissionMode: default
tools: []
mcp: []
---
chat
`);
    writeFileSync(join(dir, "p", "pipeline.dot"), `digraph p {
  goal="t"
  start [shape=Mdiamond]
  done [shape=Msquare]
  n1 [agent="agent_b", interactive=true, prompt="chat"]
  start -> n1 -> done
}`);
    const result = validateGraph(join(dir, "p", "pipeline.dot"));
    expect(result.diagnostics.some(d => d.code === "agent_missing_outputs")).toBe(false);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/graph-validator-outputs.test.ts`
Expected: FAIL — rule not implemented.

- [x] **Step 3: Implement the rule in `graph.ts`**

In `src/attractor/core/graph.ts`, inside the agent-node iteration where other agent rules already run (search for existing `produces_redundant_with_outputs` or similar), add:

```ts
// agent_missing_outputs: non-interactive agent must declare outputs:
// (chunk 3 — replaces the legacy json_schema_file= attribute path).
const isInteractive = node.interactive === true || node.interactive === "true";
if (!isInteractive) {
  const cfg = resolveAgent(node.agent as string, { projectDir: dotDir, allowBundledFallback: false });
  if (!cfg.outputs) {
    diagnostics.push({
      code: "agent_missing_outputs",
      severity: "error",
      message: [
        `node "${node.id}" agent "${node.agent}" has no outputs: declared`,
        ``,
        `Non-interactive agents must declare structured output in frontmatter:`,
        `  outputs:`,
        `    <key>: <type-or-fragment>`,
        ``,
        `If you previously used \`json_schema_file=\`, that attribute was removed.`,
        `Move the schema into the agent's outputs: frontmatter.`,
      ].join("\n"),
    });
  } else if (Object.keys(cfg.outputs).length === 0) {
    diagnostics.push({
      code: "agent_outputs_empty",
      severity: "warning",
      message: `node "${node.id}" agent "${node.agent}" declares outputs: {} (pure-work opt-out). Confirm the agent intentionally returns no structured data.`,
    });
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/graph-validator-outputs.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph-validator-outputs.test.ts
git commit -m "feat(validator): agent_missing_outputs (with migration recipe) + agent_outputs_empty warning"
```

### Task 3.2 — Atomic: delete `jsonSchemaFile` + migrate 7 schemas + drop `json_schema_file=` attributes + `implement` opt-out

**This task is a single atomic commit** because deleting the schema field breaks every node that references `json_schema_file=` until the migration finishes. Do all changes, run tests, then commit once.

**Files:**
- Modify: `src/attractor/core/schemas.ts` (delete `jsonSchemaFile` field from `AgentNodeSchema`)
- Modify: `src/attractor/handlers/agent-handler.ts` (remove the `node.jsonSchemaFile` branch — always go through `config.jsonSchema`)
- Modify (frontmatter additions, 7 agents):
  - `pipelines/illumination-to-implementation/change-explainer.md` — add `outputs: { explainer_render: string }`
  - `pipelines/illumination-to-implementation/design-writer.md` — add `outputs: { design_doc_path: string }`
  - `pipelines/illumination-to-implementation/plan-writer.md` — add `outputs: { plan_path: string }`
  - `pipelines/illumination-to-implementation/memory-writer.md` — add `outputs: { memory_path: string }`
  - `pipelines/illumination-to-implementation/memory-reflector.md` — add `outputs: { illumination_path: {type: [string, "null"]}, reasoning: string }`
  - `pipelines/illumination-to-implementation/task.md` — add `outputs: { refinements: string, scope_changed: boolean }` (used by `chat_summarizer` node)
  - `pipelines/illumination-to-implementation/tmux-tester.md` — add `outputs: { test_result: {enum: [pass, fail]}, test_summary: string, issues_found: {type: array, items: string}, test_render: string }`
  - `pipelines/illumination-to-implementation/implement.md` — add `outputs: {}` (pure-work opt-out)
- Modify: `pipelines/illumination-to-implementation/pipeline.dot` — remove every `json_schema_file="..."` attribute from every node
- Delete: `pipelines/illumination-to-implementation/{explainer,design-writer,plan-writer,memory-writer,memory-reflector,chat-summarizer,tmux-test-result}.json` (7 files)

**Status: SHIPPED 2026-04-29** — atomic migration of 7 illumination agents + smoke pipelines; 12 stale .json deleted; jsonSchemaFile field removed; all 1253 tests pass.

- [x] **Step 1: Snapshot the existing 7 .json files for reference**

Run: `for f in pipelines/illumination-to-implementation/*.json; do echo "=== $(basename $f) ==="; cat $f; done > /tmp/old-schemas.txt`
Inspect to confirm the YAML mapping below matches.

- [x] **Step 2: Delete `jsonSchemaFile` field from `AgentNodeSchema`**

In `src/attractor/core/schemas.ts`, remove the `jsonSchemaFile: z.string().optional()...` line from `AgentNodeSchema` (and any sibling fields specific to this attribute).

- [x] **Step 3: Remove `node.jsonSchemaFile` branch from `agent-handler.ts`**

In `src/attractor/handlers/agent-handler.ts`, replace the block from chunk-1 task 1.1 with the simpler version:

```ts
// jsonSchema comes from agent frontmatter outputs: only.
// (Legacy json_schema_file= attribute removed in chunk 3.)
const jsonSchema: string | undefined = config.jsonSchema;
```

(Also delete the now-unused `readFileSync`/`resolve` imports if they were only used here.)

- [x] **Step 4: Add `outputs:` to each of the 7 agent .md files**

For each agent, edit its `.md` frontmatter to insert the `outputs:` block before the closing `---`. Example for `change-explainer.md`:

```yaml
---
name: change-explainer
... (existing fields)
outputs:
  explainer_render:
    type: string
    description: Markdown render shown verbatim in the approval gate label.
---
```

Repeat for the remaining six agents using the YAML equivalents from the spec table.

- [x] **Step 5: Add `outputs: {}` to `implement.md`**

```yaml
---
name: implement
... (existing fields)
outputs: {}
---
```

- [x] **Step 6: Drop `json_schema_file="..."` from every node in `pipeline.dot`**

Run: `grep -n "json_schema_file" pipelines/illumination-to-implementation/pipeline.dot`
For each line, remove only the `json_schema_file="..."` portion (preserve sibling attributes and the closing `]`).

- [x] **Step 7: Delete the 7 stale `.json` files**

Run: `rm pipelines/illumination-to-implementation/{explainer,design-writer,plan-writer,memory-writer,memory-reflector,chat-summarizer,tmux-test-result}.json`

- [x] **Step 8: Run pipeline validate to confirm migration is consistent**

Run: `npx tsx src/cli/index.ts pipeline validate pipelines/illumination-to-implementation/pipeline.dot`
Expected: PASS (no `agent_missing_outputs`, no `agent_outputs_empty` errors; warning for `implement` is acceptable).

- [x] **Step 9: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 10: Commit atomically**

```bash
git add -A
git commit -m "refactor(pipelines): finish outputs: migration; delete json_schema_file= attribute"
```

### Task 3.3 — Annotated SVG (DONE) — see `src/cli/lib/annotate-show.ts`, `src/cli/commands/pipeline.ts`, `src/cli/tests/pipeline-show-annotation.test.ts`

### Task 3.4 — End-to-end smoke verification

**Status (this session):**
- [x] **Step 3:** Smoke validate — all 14 `pipelines/smoke/*` pipelines green.
- [ ] **Step 1:** Live `illumination-to-implementation` pipeline run — DEFERRED to a human-driven run (requires interactive human gates and a real Claude session; not appropriate for the autonomous loop).
- [ ] **Step 2:** Trace inspect after validation retry — DEFERRED, depends on Step 1.
- [ ] **Step 4:** Tag `chunk-7-agent-output-validation` — being created at end-of-session by the parent loop.

### Chunk 3 Review Checkpoint

- [x] **Run code-reviewer subagent against the chunk-3 commits + the spec.** PASS verdict (this session). Follow-up: deleted dead `Node.jsonSchemaFile` field (`src/attractor/types.ts`) + updated stale `json_schema_file` wording in interactive-mismatch failureReason (`src/attractor/handlers/agent-handler.ts:109`) + matching test (`src/attractor/tests/agent-handler-interactive.test.ts:128`).

---

## Plan Review Loop

After each chunk:

1. Dispatch `superpowers:code-reviewer` against the chunk's commits + the spec at `docs/superpowers/specs/2026-04-29-agent-output-validation-and-retry.md`.
2. Address feedback in-chunk; re-dispatch if needed.
3. Tag chunk in git for bisectable history (`chunk-7-agent-output-validation` after Chunk 3).

---

## Post-execution memory capture

**REQUIRED after Chunk 3 lands.** Capture for the next session:

- Any model-behavior surprises in the validation retry (does `--resume` consistently break the thinking-block trap?)
- Whether the empty-output corrective message phrasing actually heals the verifier case in production
- Plan-vs-reality deltas
- Any zod fragment shapes the migration revealed we need but did not include in the strict accept-list (D3)

**Procedure:**

1. Land the final commit + tag (`chunk-7-agent-output-validation`).
2. Dispatch the `memory-writer` subagent with the chunk's session transcript path:
   ```
   Agent({
     description: "Capture chunk-7 implementation memory",
     subagent_type: "memory-writer",
     prompt: "Analyze the implementation session for Chunk 7 (agent output validation + retry). Transcript: <path>. Capture: model-behavior surprises, empty-output corrective effectiveness, zod fragment gaps, plan-vs-reality deltas. Write to /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/. Update MEMORY.md index."
   })
   ```
3. Memory file naming: `2026-04-29-chunk-7-agent-output-validation-shipped.md` (or `-deferred.md` if any sub-task slipped).
4. Memory `type:` is `project`.
