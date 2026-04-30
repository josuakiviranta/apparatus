# Qualified Keys for `produces_from_stdout` Tool Outputs — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `produces_from_stdout` tool nodes write `ctx.values["${nodeId}.${key}"]` (qualified) instead of bare flat keys, eliminating silent cross-node collisions; tighten the validator to reject bare consumer inputs whose source is a `produces_from_stdout` tool node.

**Architecture:** Two surgical changes. (1) Producer side: `tool.ts` qualifies emitted keys with `node.id`, preserving native types (intentionally diverging from agent-handler's String() coercion). (2) Validator side: new `bare_input_from_qualified_producer` rule overrides the existing `hasDefault` escape so authors must declare qualified inputs when consuming from `produces_from_stdout` sources. Janitor pipeline migrated as the only live consumer; its `<read_vision_vision>` body tag becomes correct automatically once the inputs declaration is qualified.

**Tech Stack:** TypeScript, Node.js, vitest, ts-graphviz (DOT parser), Ink (TUI — not touched).

**Source illumination:** `meditations/illuminations/2026-04-30T0149-janitor-vision-tag-mismatch.md`

**Design decisions (from grill session 2026-04-30):**
- Qualify on producer side (`tool.ts`), not consumer side
- Preserve native types — keep tool.ts's intentional divergence from agent-handler
- Validator hard-errors on bare consumer + producer source, even when `default_*` is present
- Reserved vars (`project`, `run_id`, `goal`) stay bare — universal namespacing rejected
- Two-commit structure: Commit 1 = producer + janitor migration, Commit 2 = validator
- Keep `default_vision=""` on janitor consumer node as defensive backstop

**Blast radius (verified):** `produces_from_stdout=true` appears in exactly one live `.dot` file: `pipelines/janitor/pipeline.dot`. Other matches are tests, specs, illuminations.

---

## Chunk 1: Qualified producer outputs + janitor migration

This chunk lands a working janitor end-to-end with qualified keys. After Commit 1, the broken compass is restored and tool.ts emits qualified keys. The validator rule lands in Chunk 2.

### Task 1.1: Add failing test for qualified-key emission in tool-handler

**Files:**
- Modify: `src/attractor/tests/tool-handler.test.ts` (add new test in `produces_from_stdout` describe block)

- [x] **Step 1: Write the failing test**

Add this test after line 354 (inside the `describe("ToolHandler — produces_from_stdout", ...)` block, before the closing `});`):

```ts
it("produces_from_stdout=true qualifies emitted keys with node.id", async () => {
  const h = new ToolHandler();
  const node: Node = {
    id: "weather",
    shape: "parallelogram",
    scriptFile: "scripts/emit-json.mjs",
    producesFromStdout: true,
  } as Node;
  const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
  expect(outcome.status).toBe("success");
  expect(outcome.contextUpdates?.["weather.a"]).toBe(1);
  expect(outcome.contextUpdates?.["weather.b"]).toBe(2);
  // Bare keys must NOT exist
  expect(outcome.contextUpdates?.a).toBeUndefined();
  expect(outcome.contextUpdates?.b).toBeUndefined();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts -t "qualifies emitted keys"`
Expected: FAIL — `outcome.contextUpdates?.["weather.a"]` is `undefined` (current behavior emits bare `a`).

### Task 1.2: Implement qualified-key emission in tool.ts

**Files:**
- Modify: `src/attractor/handlers/tool.ts:65-83`

- [x] **Step 1: Update `buildUpdates` to qualify keys**

Replace lines 65-83 in `src/attractor/handlers/tool.ts` with:

```ts
    // Build stdout-derived context updates. tool.output is always present;
    // when produces_from_stdout=true we additionally flatten the last-line JSON
    // object's top-level keys, qualifying each as `${nodeId}.${key}` to match
    // agent-handler's namespacing convention. Native types are preserved (unlike
    // agent-handler which String()-coerces) so downstream conditions can compare
    // numbers/booleans directly.
    const buildUpdates = (stdout: string): Record<string, unknown> => {
      const updates: Record<string, unknown> = { "tool.output": stdout };
      if (producesFromStdout) {
        const parsed = parseLastLineJson(stdout, node.id);
        if (parsed) {
          for (const [k, v] of Object.entries(parsed)) {
            updates[`${node.id}.${k}`] = v;
          }
        }
      }
      return updates;
    };
```

- [x] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts -t "qualifies emitted keys"`
Expected: PASS.

### Task 1.3: Update pre-existing tool-handler tests for qualified keys

The existing tests in `src/attractor/tests/tool-handler.test.ts` still assert bare keys (`a`, `b`, `x`, `y`). After Task 1.2 they will fail. Update each one.

**Files:**
- Modify: `src/attractor/tests/tool-handler.test.ts`

- [x] **Step 1: Run full test file to see all failures**

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts`
Expected: 3 failing tests — the ones asserting bare keys at lines 247-248, 263-264, 350-351. The regression test at line 311 still passes (asserts `undefined` — both bare and qualified are undefined when producesFromStdout is omitted). Tests at lines 267, 283, 297, 327 do not assert flat keys; unaffected.

- [x] **Step 2: Update line 247-248 (test "produces_from_stdout=true + last-line JSON …")**

Replace:
```ts
    expect(outcome.contextUpdates?.a).toBe(1);
    expect(outcome.contextUpdates?.b).toBe(2);
```
With:
```ts
    expect(outcome.contextUpdates?.["t.a"]).toBe(1);
    expect(outcome.contextUpdates?.["t.b"]).toBe(2);
```

(Node id is `"t"` per line 240.)

- [x] **Step 3: Update line 263-264 (test "produces_from_stdout as string 'true' …")**

Replace:
```ts
    expect(outcome.contextUpdates?.a).toBe(1);
    expect(outcome.contextUpdates?.b).toBe(2);
```
With:
```ts
    expect(outcome.contextUpdates?.["t.a"]).toBe(1);
    expect(outcome.contextUpdates?.["t.b"]).toBe(2);
```

- [x] **Step 4: Update line 350-352 (test "produces_from_stdout=true works with tool_command branch too")**

Replace:
```ts
    expect(outcome.contextUpdates?.x).toBe(42);
    expect(outcome.contextUpdates?.y).toBe("ok");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("prelude");
```
With:
```ts
    expect(outcome.contextUpdates?.["t.x"]).toBe(42);
    expect(outcome.contextUpdates?.["t.y"]).toBe("ok");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("prelude");
```

- [x] **Step 5: Verify line 311 test still passes**

Test "absence of produces_from_stdout → stdout never parsed" asserts `outcome.contextUpdates?.a` is undefined. After change, both bare `a` and qualified `t.a` are undefined when producesFromStdout is omitted. Test still passes — no edit needed.

- [x] **Step 6: Run full test file**

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts`
Expected: All tests pass.

### Task 1.4: Add cross-node non-collision test

**Files:**
- Modify: `src/attractor/tests/tool-handler.test.ts` (add at end of `produces_from_stdout` describe block)

- [x] **Step 1: Write the test**

Add inside the `describe("ToolHandler — produces_from_stdout", ...)` block, after the test added in Task 1.1:

```ts
it("two nodes emitting same JSON key produce non-colliding qualified keys", async () => {
  const h = new ToolHandler();
  const nodeA: Node = {
    id: "weather",
    shape: "parallelogram",
    scriptFile: "scripts/emit-json.mjs",
    producesFromStdout: true,
  } as Node;
  const nodeB: Node = {
    id: "oven",
    shape: "parallelogram",
    scriptFile: "scripts/emit-json.mjs",
    producesFromStdout: true,
  } as Node;

  const outA = await h.execute(nodeA, baseCtx(), makeContext({ dotDir }));
  const outB = await h.execute(nodeB, baseCtx(), makeContext({ dotDir }));

  expect(outA.contextUpdates?.["weather.a"]).toBe(1);
  expect(outB.contextUpdates?.["oven.a"]).toBe(1);
  // Cross-pollution is impossible: each outcome only knows its own node's keys
  expect(outA.contextUpdates?.["oven.a"]).toBeUndefined();
  expect(outB.contextUpdates?.["weather.a"]).toBeUndefined();
});
```

- [x] **Step 2: Run test**

Run: `npx vitest run src/attractor/tests/tool-handler.test.ts -t "non-colliding"`
Expected: PASS.

### Task 1.5: Migrate janitor agent inputs declaration

**Files:**
- Modify: `pipelines/janitor/janitor.md:23-25`

- [x] **Step 1: Update inputs block**

Replace lines 23-25:
```yaml
inputs:
  - project
  - vision
```

With:
```yaml
inputs:
  - project
  - read_vision.vision
```

- [x] **Step 2: Verify body text needs no change**

Body lines 35 and 37 currently reference `<read_vision_vision>`. With qualified input `read_vision.vision`, the rendered tag becomes `read_vision_vision` (per `inputs-resolver.ts:41`: dot replaced by underscore). Body matches — **no body edits needed**.

Run: `grep -n 'read_vision_vision\|<vision>' pipelines/janitor/janitor.md`
Expected: only the two existing body references; no leftover bare `<vision>` tag refs.

### Task 1.6: Verify janitor pipeline.dot needs no change

**Files:**
- Verify only: `pipelines/janitor/pipeline.dot`

- [x] **Step 1: Read the file and confirm structure**

Run: `cat pipelines/janitor/pipeline.dot`
Expected to contain:
```dot
janitor [agent="janitor", default_vision=""]
```

This stays. Per design decision, `default_vision=""` is a defensive backstop and the resolver fallback uses `localKey` (`vision`) for both bare and qualified inputs — `inputs-resolver.ts:42` and `:52` both resolve `fallbackAttr` as `default_${localKey}`.

### Task 1.7: Update specs/pipeline.md

**Files:**
- Modify: `specs/pipeline.md` (the `produces_from_stdout` row + the prose paragraph)

**Note on edit ordering:** Steps below modify three line ranges. Do them in the order given (top-to-bottom) so line numbers do not desynchronize: example block first (around line 226), then the prose at line 229, then the table row at line 52 (separate region — order independent vs the others).

- [x] **Step 1: Update the example block at lines 222-227**

Read the example block at `specs/pipeline.md:222-227` and replace `produces_from_stdout="dispatch_result"` with `produces_from_stdout=true` (the boolean form is the live API; the string form was the older spec). Add a one-line DOT comment immediately after the `produces_from_stdout=true` line showing the qualified consumer:

```dot
mark_dispatched [type="tool",
                 cwd="$project",
                 script_file="pipelines/scripts/mark-dispatched.mjs",
                 script_args="--id $illumination_id",
                 produces_from_stdout=true]
// emits ctx.values["mark_dispatched.dispatch_result"] — consumers must
// declare `inputs: [mark_dispatched.dispatch_result]`
```

- [x] **Step 2: Update the prose paragraph at line 229**

Replace line 229 (the paragraph starting `script_file paths are resolved...`) with:

```
`script_file` paths are resolved relative to the `.dot` file's directory. The script inherits the process environment, receives `script_args` (variable-expanded) on the command line, and runs in `cwd`. If `produces_from_stdout=true` is declared, the script's last-line JSON is parsed and each top-level key is stored in `ctx.values` as `${node_id}.${key}`, preserving native JSON types. Consumers must declare these as qualified inputs (e.g. `inputs: [read_vision.vision]`); bare consumer keys are rejected by the validator. See `pipelines/scripts/mark-dispatched.mjs` for the canonical example.
```

- [x] **Step 3: Update the table row at line 52**

Replace line 52:
```
| `produces_from_stdout` | tool nodes | Context key to populate from stdout |
```

With:
```
| `produces_from_stdout` | tool nodes | When `true`, parse last-line JSON from stdout and store each top-level key as `${node_id}.${key}` in `ctx.values` (native types preserved) |
```

### Task 1.8: End-to-end verification of janitor

- [x] **Step 1: Build and run full test suite**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [x] **Step 2: Run janitor pipeline manually and inspect trace**

Run:
```bash
ralph pipeline run pipelines/janitor/pipeline.dot --project .
```

Then locate the run id and inspect the trace:
```bash
ls ~/.ralph/*/runs/ | tail -1
ralph pipeline trace <runId> --node-receive janitor
```

Expected:
- `read_vision` node-end shows `contextUpdates: { "read_vision.vision": "..." }` (qualified)
- `janitor` node-receive Inputs block contains `<read_vision_vision>...</read_vision_vision>` populated with VISION.md contents

- [x] **Step 3: Validate the pipeline**

Run: `ralph pipeline validate pipelines/janitor/pipeline.dot`
Expected: clean (no errors). The validator currently allows qualified `read_vision.vision` in consumer inputs.

### Task 1.9: Commit Chunk 1

- [x] **Step 1: Stage files**

```bash
git add \
  src/attractor/handlers/tool.ts \
  src/attractor/tests/tool-handler.test.ts \
  pipelines/janitor/janitor.md \
  specs/pipeline.md
```

- [x] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: qualify produces_from_stdout outputs with nodeId, migrate janitor

BREAKING: third-party pipelines using produces_from_stdout must qualify
their consumer inputs as `<sourceNode>.<key>`. Bare consumer keys no
longer resolve at runtime.

Tool handler now stores stdout-derived keys as `${node.id}.${key}` to
match agent-handler's namespacing convention. Eliminates silent
overwrite when two tool nodes emit the same flat key. Native types
preserved (intentional divergence from agent-handler's String() coercion).

Janitor pipeline migrated: inputs: [vision] -> [read_vision.vision].
Body already referenced `<read_vision_vision>` — broken compass restored.

Refs: meditations/illuminations/2026-04-30T0149-janitor-vision-tag-mismatch.md
EOF
)"
```

- [x] **Step 3: Verify commit**

Run: `git log --oneline -1`
Expected: commit appears with the message above.

---

## Chunk 2: Validator rule for bare consumers of qualified producers

This chunk adds a hard-error validator rule so future authors cannot ship the same class of bug Chunk 1 just fixed for janitor.

### Task 2.1: Add failing test — bare consumer of produces_from_stdout source must error

**Files:**
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts`

- [x] **Step 1: Read existing test file structure**

Run: `head -50 src/attractor/tests/graph-validator-inputs.test.ts`
Confirm the test pattern (loadGraph helper or buildGraph fixture).

- [x] **Step 2: Write the failing test**

Add a new test (location: end of the existing `describe` block, or new `describe("bare_input_from_qualified_producer", ...)` block):

```ts
describe("bare_input_from_qualified_producer", () => {
  it("errors when consumer declares bare input whose source is produces_from_stdout tool node", async () => {
    const dot = `
      digraph t {
        inputs="project"
        start [shape=Mdiamond]
        read_vision [type="tool", cwd="$project",
                     tool_command="echo {}", produces_from_stdout=true]
        consumer [agent="consumer-agent"]
        done [shape=Msquare]
        start -> read_vision -> consumer -> done
      }
    `;
    // … fixture setup: write a consumer-agent.md that declares inputs: [vision] (bare)
    const diags = await validateDot(dot, fixtureDir);
    expect(diags.some(d =>
      d.rule === "bare_input_from_qualified_producer"
      && d.message.includes("vision")
      && d.message.includes("read_vision.vision")
    )).toBe(true);
  });
});
```

(Adapt fixture-creation idiom to whatever the existing tests in this file use — e.g. `mkdtempSync` + `writeFileSync` for the agent .md file.)

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "bare_input_from_qualified_producer"`
Expected: FAIL — current validator either allows the bare input (because `default_*` could silence it, or because no rule of this name exists yet).

### Task 2.2: Add failing test — `default_*` does NOT silence the new rule

**Files:**
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts`

- [x] **Step 1: Write the test**

```ts
it("default_* attribute does NOT silence bare_input_from_qualified_producer", async () => {
  const dot = `
    digraph t {
      inputs="project"
      start [shape=Mdiamond]
      read_vision [type="tool", cwd="$project",
                   tool_command="echo {}", produces_from_stdout=true]
      consumer [agent="consumer-agent", default_vision=""]
      done [shape=Msquare]
      start -> read_vision -> consumer -> done
    }
  `;
  // consumer-agent.md declares inputs: [vision] (bare)
  const diags = await validateDot(dot, fixtureDir);
  // Even with default_vision="", the bare input is still rejected
  expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(true);
});
```

- [x] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "default_\\* attribute does NOT silence"`
Expected: FAIL.

### Task 2.3: Implement `bare_input_from_qualified_producer` rule

**Files:**
- Modify: `src/attractor/core/graph.ts` (the bare-input handling block around lines 484-497)

- [x] **Step 1: Read the current rule block**

Run: `npx vitest run src/attractor/core/graph.ts` ← n/a, just open the file.
Read lines 460-510 to confirm the `resolveInputDecl` flow and the existing `bare_input_not_in_caller_inputs_or_system` rule.

- [x] **Step 2: Add the new rule logic INSIDE the existing caller-vars/reserved short-circuit**

The existing block at `graph.ts:484-497` is structured:

```ts
if (resolved.sourceNode === undefined) {
  if (!callerInputs.has(resolved.localKey)
      && !SYSTEM_VARS.has(resolved.localKey)
      && !hasDefault(node, resolved.localKey)) {
    diags.push({ rule: "bare_input_not_in_caller_inputs_or_system", ... });
  }
  continue;
}
```

The new rule must fire ONLY when the bare input is not satisfied by caller-vars and not a reserved system var. (It DOES fire even when `default_*` is set — that's the point.) Restructure the block as follows:

```ts
if (resolved.sourceNode === undefined) {
  // First, short-circuit caller-vars and reserved system vars — these are
  // legitimately bare and must not trigger any producer-related rule.
  if (callerInputs.has(resolved.localKey) || SYSTEM_VARS.has(resolved.localKey)) {
    continue;
  }

  // bare_input_from_qualified_producer — bare input is not caller/reserved,
  // and an upstream produces_from_stdout tool node exists on every reachable
  // path. The bare key cannot resolve (producer writes `${nodeId}.key`).
  // default_* does NOT silence this — the missing value is the symptom of a
  // mis-declared input, not a missing optional.
  const qualifiedProducer = findQualifiedProducer(node.id, nodes);
  if (qualifiedProducer !== undefined) {
    diags.push({
      rule: "bare_input_from_qualified_producer",
      severity: "error",
      message: `Input "${resolved.localKey}" at "${node.id}" is bare but its only upstream producer "${qualifiedProducer}" emits qualified keys via produces_from_stdout. Declare as "${qualifiedProducer}.${resolved.localKey}". The default_${resolved.localKey} attribute does not silence this error — bare keys cannot read qualified producer outputs.`,
      location: node.sourceLocation,
    });
    continue;
  }

  // Existing rule: bare input has no source at all and no default — error.
  if (!hasDefault(node, resolved.localKey)) {
    diags.push({
      rule: "bare_input_not_in_caller_inputs_or_system",
      severity: "error",
      message: `Agent "${node.agent}" requires bare input "${resolved.localKey}" but it is neither declared in the digraph's inputs="..." nor a system-injected var. Add it to inputs="...", qualify it as "<source_node>.${resolved.localKey}", or set default_${resolved.localKey}= on this node.`,
      location: node.sourceLocation,
    });
  }
  continue;
}
```

- [x] **Step 3: Add the helper function `findQualifiedProducer`**

Add the helper inside the same scope where `nodeProduces` and `reachableWithout` are defined (search for `function reachableWithout` at `graph.ts:224` — place this helper immediately after it):

```ts
/**
 * Returns the id of an upstream tool node with produces_from_stdout that is
 * reachable from `start` to `consumerId`. Returns undefined if no such producer
 * exists upstream of `consumerId`. The check is conservative — does not
 * statically inspect script bodies for which keys they emit, so any reachable
 * upstream produces_from_stdout tool node is treated as a qualified producer.
 */
function findQualifiedProducer(
  consumerId: string,
  nodes: Map<string, Node>,
): string | undefined {
  for (const [id, node] of nodes) {
    if (id === consumerId) continue;
    if (resolveHandlerType(node) !== "tool") continue;
    if (!node.producesFromStdout) continue;
    // Confirm the candidate is actually upstream of the consumer.
    if (!reachableWithout(id, consumerId, new Set())) continue;
    return id;
  }
  return undefined;
}
```

**Why these specific corrections:**

1. **`resolveHandlerType(node) === "tool"`** instead of `node.type === "tool"` — the parsed `Node` does not always carry a literal `type` field. Tool nodes can be detected via shape (`parallelogram`) or explicit `type="tool"`; `resolveHandlerType` normalizes both. (Reference: `graph.ts:181, 338, 999` — every other tool-node check in this file uses `resolveHandlerType`.)
2. **`reachableWithout(id, consumerId, new Set())`** — without this, `findQualifiedProducer` would return any `produces_from_stdout` node anywhere in the graph including sibling branches the consumer cannot reach. The reviewer specifically caught this as a real false-positive risk. (Reference: `graph.ts:224, 304` — the same helper is used to gate other reachability-sensitive rules.)
3. **Inserting the new rule INSIDE the caller-vars/reserved short-circuit** — without this, Task 2.4's positive tests (caller-var bare, reserved bare) would FAIL because the new rule would fire on legitimate bare inputs whose source is the caller, not a producer.

**Conservative-on-key-match note:** The helper does NOT verify that the consumer's specific `localKey` matches an actual key the producer's script emits. We have no static manifest of which JSON keys a `produces_from_stdout` script writes. This is intentional — forcing authors to declare qualified inputs is always safer than allowing bare. If false positives appear in real pipelines, refine by adding a `produces_keys=` attribute to tool nodes (out of scope for this plan).

- [x] **Step 3: Run the two failing tests**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "bare_input_from_qualified_producer"`
Expected: both tests PASS.

### Task 2.4: Add positive tests — caller-vars and reserved stay bare

**Files:**
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts`

- [x] **Step 1: Write tests**

```ts
it("bare input from caller-var (declared on digraph) does NOT trigger the rule", async () => {
  const dot = `
    digraph t {
      inputs="project,vision"
      start [shape=Mdiamond]
      consumer [agent="consumer-agent"]
      done [shape=Msquare]
      start -> consumer -> done
    }
  `;
  // consumer-agent.md declares inputs: [vision] (bare, but caller-supplied)
  const diags = await validateDot(dot, fixtureDir);
  expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(false);
});

it("bare input from reserved system var does NOT trigger the rule", async () => {
  const dot = `
    digraph t {
      inputs="project"
      start [shape=Mdiamond]
      consumer [agent="consumer-agent"]
      done [shape=Msquare]
      start -> consumer -> done
    }
  `;
  // consumer-agent.md declares inputs: [project] (bare reserved)
  const diags = await validateDot(dot, fixtureDir);
  expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(false);
});
```

- [x] **Step 2: Run**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "caller-var\\|reserved system var"`
Expected: PASS.

### Task 2.5: Add positive test — qualified consumer of qualified producer

**Files:**
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts`

- [x] **Step 1: Write the test**

```ts
it("qualified input from produces_from_stdout source passes validation", async () => {
  const dot = `
    digraph t {
      inputs="project"
      start [shape=Mdiamond]
      read_vision [type="tool", cwd="$project",
                   tool_command="echo {}", produces_from_stdout=true]
      consumer [agent="consumer-agent"]
      done [shape=Msquare]
      start -> read_vision -> consumer -> done
    }
  `;
  // consumer-agent.md declares inputs: [read_vision.vision] (qualified)
  const diags = await validateDot(dot, fixtureDir);
  expect(diags.some(d => d.rule === "bare_input_from_qualified_producer")).toBe(false);
});
```

- [x] **Step 2: Run**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "qualified input"`
Expected: PASS.

### Task 2.6: Validate live janitor pipeline still clean

- [x] **Step 1: Run validator against janitor**

Run: `npx ralph pipeline validate pipelines/janitor/pipeline.dot`
(or `node dist/cli/index.js pipeline validate pipelines/janitor/pipeline.dot` if not built)

Expected: clean — Chunk 1 already migrated `inputs: [read_vision.vision]`, so the new rule does not fire on the live pipeline.

### Task 2.7: Run full test suite

- [x] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass — including pre-existing graph-validator tests (the new rule must not regress them).

### Task 2.8: Commit Chunk 2

- [x] **Step 1: Stage files**

```bash
git add \
  src/attractor/core/graph.ts \
  src/attractor/tests/graph-validator-inputs.test.ts
```

- [x] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
validator: reject bare consumer inputs when source is produces_from_stdout

New rule `bare_input_from_qualified_producer` errors when a consumer
declares a bare input whose only upstream producer emits qualified keys
via produces_from_stdout. Overrides the existing hasDefault escape —
defaults cannot silence this case because the bare key never resolves.

Catches a class of silent bug where authors forget to qualify and rely
on default_* fallbacks that mask broken wiring.
EOF
)"
```

- [x] **Step 3: Verify**

Run: `git log --oneline -2`
Expected: both Chunk 1 and Chunk 2 commits visible.

---

## Out of Scope

- Universal namespacing of reserved vars (`system.project`) — rejected in grill (costly migration, no real bug).
- Stringifying tool outputs to fully match agent-handler — rejected in grill (type preservation is a useful tool-node feature).
- Validator error message discoverability improvements (spelling out the reserved-vars list in every "bare input rejected" error) — worth its own follow-up illumination.
- Static analysis of `produces_from_stdout` script bodies to determine which exact keys they emit — current rule is conservative (any upstream `produces_from_stdout` node triggers the rule for any bare consumer key); refine only if false positives surface.

## Definition of Done

- Both commits land on `main`.
- All tests pass: `npm test`.
- Manual janitor run shows `read_vision.vision` qualified key in trace and `<read_vision_vision>` block populated in agent context.
- `ralph pipeline validate pipelines/janitor/pipeline.dot` is clean.
- Source illumination flips to `status: implemented` on the next janitor run (or by the implementer after merging).
