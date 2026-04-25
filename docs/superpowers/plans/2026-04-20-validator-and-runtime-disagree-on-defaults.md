---
status: implemented
---

# Validator / Runtime Defaults Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validator accepts any `default_<varname>` attribute on `agent`, `gate`, and `tool` nodes so `pipeline validate` stops rejecting attributes the runtime already resolves.

**Architecture:** Keep `.strict()` on the three node schemas, remove the whitelisted `default*` fields, and post-filter zod's `unrecognized_keys` diagnostics in `validateNode` to drop names matching `/^default[A-Z]/`. Runtime `extractDefaults()` is unchanged; a shared fixture table pins validator/runtime parity.

**Tech Stack:** TypeScript, zod, vitest. Files under `src/attractor/core`, `src/attractor/tests`, `src/attractor/transforms`. Design source: `specs/2026-04-20-validator-and-runtime-disagree-on-defaults-design.md`.

---

## Chunk 1: Seed-key helper + parity fixture

### Task 1: Add `DEFAULT_SEED_KEY_RE` and `isDefaultSeedKey`

**Files:**
- Modify: `src/attractor/core/schemas.ts` (new export near top, below imports)
- Test: `src/attractor/tests/schemas.test.ts` (new `describe("isDefaultSeedKey")` block)

- [ ] **Step 1: Write failing test for `isDefaultSeedKey`**

Add `isDefaultSeedKey` to the existing import block at `src/attractor/tests/schemas.test.ts:2-12` (do NOT add a second import line):

```typescript
import {
  BaseNodeSchema,
  AgentNodeSchema,
  ToolNodeSchema,
  GateNodeSchema,
  StartNodeSchema,
  ExitNodeSchema,
  classifyNode,
  validateNode,
  describeKind,
  isDefaultSeedKey,
} from "../core/schemas.js";
```

Then append this describe block to the same file:

```typescript
describe("isDefaultSeedKey", () => {
  it.each([
    ["defaultRefinements", true],
    ["defaultScopeChanged", true],
    ["defaultX", true],
    ["defaulted", false],
    ["default", false],
    ["defualtTypo", false],
    ["refinements", false],
  ])("isDefaultSeedKey(%s) === %s", (key, expected) => {
    expect(isDefaultSeedKey(key)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts -t "isDefaultSeedKey"`
Expected: FAIL — `isDefaultSeedKey is not exported` (or similar).

- [ ] **Step 3: Implement helper**

Add to `src/attractor/core/schemas.ts`, just below the `import` lines (before `BaseNodeSchema`):

```typescript
export const DEFAULT_SEED_KEY_RE = /^default[A-Z]/;
export function isDefaultSeedKey(camelKey: string): boolean {
  return DEFAULT_SEED_KEY_RE.test(camelKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts -t "isDefaultSeedKey"`
Expected: PASS, all 7 rows green.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): add isDefaultSeedKey helper for default_<var> recognition"
```

### Task 2: Shared validator/runtime parity fixture

**Files:**
- Create: `src/attractor/tests/default-seed-parity.test.ts`

- [ ] **Step 1: Write failing parity test**

Create `src/attractor/tests/default-seed-parity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isDefaultSeedKey } from "../core/schemas.js";
import { extractDefaults } from "../transforms/variable-expansion.js";

const FIXTURE: Array<[string, boolean]> = [
  ["defaultRefinements", true],
  ["defaultScopeChanged", true],
  ["defaulted", false],
  ["default", false],
  ["defaultX", true],
  ["defualtTypo", false],
];

describe("default-seed parity (validator vs runtime)", () => {
  it.each(FIXTURE)("validator isDefaultSeedKey(%s) === %s", (key, expected) => {
    expect(isDefaultSeedKey(key)).toBe(expected);
  });

  it.each(FIXTURE)("runtime extractDefaults({ %s: 'v' }) seeds iff %s", (key, expected) => {
    const result = extractDefaults({ [key]: "v" });
    const seeded = Object.keys(result).length === 1;
    expect(seeded).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (parity already holds)**

Run: `npx vitest run src/attractor/tests/default-seed-parity.test.ts`
Expected: PASS — both sides must agree on every row. If runtime side fails on `defaultX`, that would mean `extractDefaults` already disagrees; investigate before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/default-seed-parity.test.ts
git commit -m "test: pin validator/runtime parity for default_<var> seeds"
```

---

## Chunk 2: Remove whitelist + filter zod diagnostics

### Task 3: Invert the rejection test (will fail until Task 4 lands)

**Files:**
- Modify: `src/attractor/tests/schemas.test.ts:270-285`

- [ ] **Step 1: Rewrite the existing test to assert acceptance**

Replace `src/attractor/tests/schemas.test.ts:270-285` with the block below. Note: the original block asserted `unrecognized!.hint!.toContain("default_refinements")` — this assertion is **intentionally dropped** because after Task 4, `default_refinements` is no longer a first-class field listed in `formatAllowedAttrs` output. The new seed-rule line (added in Chunk 3) documents the generic contract instead.

```typescript
  it("accepts arbitrary default_<varname> on agent nodes", () => {
    const node: Node = {
      id: "mark_archived",
      agent: "claude-code",
      prompt: "p",
      defaultArchiveReasonShort: "Declined at approval gate",
    };
    expect(validateNode(node)).toEqual([]);
  });

  it("accepts arbitrary default_<varname> on gate nodes", () => {
    const node: Node = {
      id: "g1",
      shape: "hexagon",
      label: "Proceed?",
      defaultCustomNote: "hello",
    };
    expect(validateNode(node)).toEqual([]);
  });

  it("accepts arbitrary default_<varname> on tool nodes", () => {
    const node: Node = {
      id: "t1",
      type: "tool",
      cwd: ".",
      toolCommand: "echo",
      defaultFoo: "bar",
    };
    expect(validateNode(node)).toEqual([]);
  });

  it("still rejects non-default unknown keys on agent nodes", () => {
    const node: Node = {
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      bogusKey: "x",
    } as Node & { bogusKey: string };
    const diags = validateNode(node);
    expect(diags.some(d => d.message.includes("unrecognized key 'bogus_key'"))).toBe(true);
  });

  it("rejects 'defaulted' (no uppercase after 'default')", () => {
    const node = {
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      defaulted: "x",
    } as Node & { defaulted: string };
    const diags = validateNode(node);
    expect(diags.some(d => d.message.includes("unrecognized key 'defaulted'"))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: FAIL — acceptance cases still produce `unrecognized_keys` diagnostics.

- [ ] **Step 3: Do NOT commit yet** — Task 4 lands the implementation atomically.

### Task 4: Remove whitelisted fields + filter diagnostics

**Files:**
- Modify: `src/attractor/core/schemas.ts:29-32` (AgentNodeSchema)
- Modify: `src/attractor/core/schemas.ts:54` (GateNodeSchema)
- Modify: `src/attractor/core/schemas.ts:147-160` (validateNode `unrecognized_keys` branch)

- [ ] **Step 1: Remove the four `default*` fields from `AgentNodeSchema`**

Delete lines `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary` (currently `:29-32`).

- [ ] **Step 2: Remove `defaultRefinements` from `GateNodeSchema`**

Delete line `:54` (`defaultRefinements: z.string().optional()...`).

- [ ] **Step 3: Filter `unrecognized_keys` diagnostics for agent/gate/tool**

In `validateNode`, replace the `if (issue.code === "unrecognized_keys")` block (`:147-160`) with:

```typescript
    if (issue.code === "unrecognized_keys") {
      const keys = (issue as { keys?: string[] }).keys ?? [];
      const filtered = (kind === "agent" || kind === "gate" || kind === "tool")
        ? keys.filter(k => !isDefaultSeedKey(k))
        : keys;
      for (const key of filtered) {
        const snake = camelToSnake(key);
        diags.push({
          rule: "schema_error",
          severity: "error",
          message: `[${node.id}]: unrecognized key '${snake}'`,
          hint: formatAllowedAttrs(kind),
          location: (node.attrLocations?.[key] as import("../types.js").SourceLocation | undefined) ?? node.sourceLocation,
        });
      }
      continue;
    }
```

- [ ] **Step 4: Run schemas tests to verify they pass**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS — all acceptance tests green, all rejection tests still green, `defaulted` still rejected.

- [ ] **Step 5: Run parity test**

Run: `npx vitest run src/attractor/tests/default-seed-parity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): accept generic default_<var> on agent/gate/tool nodes"
```

### Task 5: Regression — previously-whitelisted fields still accepted

**Files:**
- Modify: `src/attractor/tests/schemas.test.ts` (append inside the same describe block as Task 3)

- [ ] **Step 1: Add regression test**

Append:

```typescript
  it.each([
    "defaultRefinements",
    "defaultChatNotesPath",
    "defaultTestResult",
    "defaultTestSummary",
  ])("still accepts previously-whitelisted agent field: %s", (key) => {
    const node = {
      id: "a1",
      agent: "claude-code",
      prompt: "p",
      [key]: "v",
    } as Node & Record<string, string>;
    expect(validateNode(node)).toEqual([]);
  });

  it("still accepts defaultRefinements on gate node", () => {
    const node: Node = {
      id: "g1",
      shape: "hexagon",
      label: "Proceed?",
      defaultRefinements: "none",
    } as Node & { defaultRefinements: string };
    expect(validateNode(node)).toEqual([]);
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/attractor/tests/schemas.test.ts -t "previously-whitelisted"`
Expected: PASS — all five rows green.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/schemas.test.ts
git commit -m "test(schemas): regression-cover previously-whitelisted default_* fields"
```

---

## Chunk 3: Hint-text seed rule

### Task 6: Append seed-rule line to `formatAllowedAttrs`

**Files:**
- Modify: `src/attractor/core/schemas.ts:120-129` (formatAllowedAttrs)
- Modify: `src/attractor/tests/schemas.test.ts` (new test block)

- [ ] **Step 1: Write failing test**

Ensure `formatAllowedAttrs` is in the existing import block at `src/attractor/tests/schemas.test.ts:2-12` (add it alongside `describeKind` if not already present — do NOT add a second import line). Then append:

```typescript
describe("formatAllowedAttrs seed-rule suffix", () => {
  it.each(["agent", "gate", "tool"] as const)("mentions default_<varname> for kind=%s", (kind) => {
    const out = formatAllowedAttrs(kind);
    expect(out).toMatch(/default_<varname>/);
    expect(out).toMatch(/seeds \$varname/);
  });

  it("does not mention default_<varname> for kind=start", () => {
    expect(formatAllowedAttrs("start")).not.toMatch(/default_<varname>/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/schemas.test.ts -t "seed-rule suffix"`
Expected: FAIL — output lacks the seed-rule text.

- [ ] **Step 3: Implement suffix**

Replace `formatAllowedAttrs` body in `src/attractor/core/schemas.ts:120-129`:

```typescript
export function formatAllowedAttrs(kind: NodeKind): string {
  const entries = describeKind(kind);
  const width = Math.max(...entries.map(e => e.snakeKey.length), 0);
  const lines = entries.map(e => {
    const req = e.required ? " (required)" : "";
    const pad = e.snakeKey.padEnd(width);
    return `  ${pad}  ${e.description}${req}`;
  });
  const seedRule = (kind === "agent" || kind === "gate" || kind === "tool")
    ? `\n  default_<varname>  seeds $varname when no upstream node has produced it.`
    : "";
  return `Allowed keys for kind=${kind}:\n${lines.join("\n")}${seedRule}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/attractor/tests/schemas.test.ts -t "seed-rule suffix"`
Expected: PASS.

- [ ] **Step 5: Run full schemas suite**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS across all tests.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/schemas.ts src/attractor/tests/schemas.test.ts
git commit -m "feat(schemas): document default_<varname> seed rule in formatAllowedAttrs"
```

---

## Chunk 4: Runtime extractDefaults unit coverage

### Task 7: Cover `extractDefaults` directly

**Files:**
- Modify: `src/attractor/tests/variable-expansion.test.ts` (append new describe block)

- [ ] **Step 1: Write failing / characterising tests**

Append to `src/attractor/tests/variable-expansion.test.ts`:

```typescript
import { extractDefaults } from "../transforms/variable-expansion.js";

describe("extractDefaults", () => {
  it("snake-cases scope changed", () => {
    expect(extractDefaults({ defaultScopeChanged: "false" })).toEqual({ scope_changed: "false" });
  });

  it("snake-cases archive reason short", () => {
    expect(extractDefaults({ defaultArchiveReasonShort: "Declined at approval gate" }))
      .toEqual({ archive_reason_short: "Declined at approval gate" });
  });

  it("ignores bare 'default' (no varname)", () => {
    expect(extractDefaults({ default: "x" })).toEqual({});
  });

  it("ignores 'defaulted' (no uppercase after prefix)", () => {
    expect(extractDefaults({ defaulted: "x" })).toEqual({});
  });

  it("ignores non-default keys", () => {
    expect(extractDefaults({ refinements: "x", prompt: "p" })).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "extractDefaults"`
Expected: PASS — runtime is already generic, these are characterising tests.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/variable-expansion.test.ts
git commit -m "test(variable-expansion): cover extractDefaults snake-case conversion"
```

---

## Chunk 5: Docs + smoke

### Task 8: Document per-node default seed contract

**Files:**
- Modify: `docs/superpowers/specs/2026-04-08-attractor-pipeline-engine-design.md`

- [ ] **Step 1: Locate an appropriate section**

Open the spec. Find the section that enumerates node kinds / attributes (near the Graph-level `default_max_retries` / `default_fidelity` block around line 74). Add a new subsection titled `#### Per-node default seeds` after the existing node-kind descriptions (or at the end of the node-attributes section).

- [ ] **Step 2: Insert paragraph**

Exact text to insert:

```markdown
#### Per-node default seeds

Any attribute on an `agent`, `gate`, or `tool` node whose snake_case name begins with `default_` is treated as a context seed. When the run reaches the node, if no upstream producer has written `$<name>` into context, the default value is inserted. The attribute is otherwise uninterpreted by the engine. Example: `default_archive_reason_short="Declined"` on an agent node seeds `$archive_reason_short` if nothing upstream produced it. The validator accepts any key matching `/^default_[a-z][a-z0-9_]*$/` on these three node kinds.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-08-attractor-pipeline-engine-design.md
git commit -m "docs(attractor): document per-node default_<varname> seed contract"
```

### Task 9: Smoke-validate pipelines

**Files:**
- No code changes.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 2: Validate the driving pipeline**

Run: `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot`
Expected: zero errors; no `unrecognized key 'default_refinements'` or `'default_archive_reason_short'` output.

- [ ] **Step 3: Validate every shipped pipeline**

Run:

```bash
for f in pipelines/*.dot; do echo "=== $f ==="; node dist/cli/index.js pipeline validate "$f" || echo "FAIL: $f"; done
```

Expected: no regressions vs. pre-change. Any new failures must be investigated — must relate to this change (false floor) not unrelated drift.

- [ ] **Step 4: Run the full attractor test suite**

Run: `npx vitest run src/attractor`
Expected: all tests pass.

- [ ] **Step 5: Commit smoke-fixture updates only if any pipeline needed editing**

```bash
# Only if a pipeline changed during smoke — typically NOT needed.
git add pipelines/
git commit -m "chore(pipelines): smoke-validated against generic default_<var> rule"
```

---

## Acceptance check (matches design doc §Acceptance)

Run these after all chunks ship:

- [ ] `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` — 0 errors on `default_*` attrs.
- [ ] `npx vitest run src/attractor/tests/schemas.test.ts` — all green including inverted + new rejection tests.
- [ ] `npx vitest run src/attractor/tests/default-seed-parity.test.ts` — fixture table green on both sides.
- [ ] `npx vitest run src/attractor/tests/variable-expansion.test.ts` — `extractDefaults` suite green.
- [ ] `formatAllowedAttrs("agent" | "gate" | "tool")` output contains the seed-rule line; `"start"` / `"exit"` do not.
- [ ] Four previously-whitelisted agent fields still validate cleanly under the generic rule.
- [ ] `defaulted` (no uppercase after `default`) still rejected by validator and not extracted by runtime.
