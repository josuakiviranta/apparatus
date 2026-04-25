---
status: implemented
---

# Schema Description Overrides Agent Rubric Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the bug class where a schema `description` injected above the rubric reference in `agent-handler.ts` silently overrides agent rubric edits, by rewriting shape-encoding descriptions as rubric pointers and adding a lint test that enforces the rule.

**Architecture:** Static-asset change only. No runtime code touched. One new vitest file walks `pipelines/schemas/*.json` and fails on banned shape vocabulary or descriptions over 160 chars, with one allow-listed field. Four schema `description` strings rewritten as rubric pointers. One new subsection in `specs/pipeline.md`.

**Tech Stack:** TypeScript, vitest, JSON schemas, Markdown specs.

**Source of truth:** `specs/2026-04-20-schema-description-overrides-agent-rubric-design.md`.

---

## Chunk 1: Lint Test (Red Phase)

Write the lint test first, with the `ALLOW_LIST` already populated. On the current (pre-rewrite) tree it MUST fail on `chat-summarizer.json:refinements`, `explainer.json:explainer_render`, `meditate-observe.json:kid_summary`, and `tmux-test-result.json:test_render`. `verifier.json:archive_reason_short` is allow-listed and MUST NOT fail.

### Task 1: Red — fixture schemas

**Files:**
- Create: `src/cli/tests/__fixtures__/schemas/description-ok.json`
- Create: `src/cli/tests/__fixtures__/schemas/description-bad.json`

**Note on path:** Design doc names `src/cli/tests/pipeline-schema-descriptions.test.ts`. The convention in this repo is `src/cli/tests/pipeline-*.test.ts` (see `pipeline-preflight.test.ts`, `pipeline-resolver.test.ts`). We follow convention and place the test and fixtures under `src/cli/tests/`.

- [ ] **Step 1: Create compliant fixture**

```json
{
  "type": "object",
  "properties": {
    "summary": {
      "type": "string",
      "description": "Plain-language summary per agent rubric (src/cli/agents/meditate-observer.md)."
    }
  },
  "required": ["summary"],
  "additionalProperties": false
}
```

Write to `src/cli/tests/__fixtures__/schemas/description-ok.json`.

- [ ] **Step 2: Create non-compliant fixture**

```json
{
  "type": "object",
  "properties": {
    "render": {
      "type": "string",
      "description": "Markdown render with three bullets per section, ≤ 250 words."
    }
  },
  "required": ["render"],
  "additionalProperties": false
}
```

Write to `src/cli/tests/__fixtures__/schemas/description-bad.json`.

- [ ] **Step 3: Commit fixtures**

```bash
git add src/cli/tests/__fixtures__/schemas/description-ok.json src/cli/tests/__fixtures__/schemas/description-bad.json
git commit -m "test(schemas): add fixtures for description shape-vocabulary lint"
```

### Task 2: Red — lint test file

**Files:**
- Create: `src/cli/tests/pipeline-schema-descriptions.test.ts`

**ESM note:** `__dirname` is not defined in this project's ESM test files. Path resolution uses `process.cwd()` anchored at the repo root (the convention in `src/cli/tests/pipeline-preflight.test.ts`). Vitest is invoked from the repo root via `npm test`, so `process.cwd()` is stable.

- [ ] **Step 1: Write the failing lint test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const SCHEMAS_DIR = join(REPO_ROOT, "pipelines", "schemas");
const FIXTURES_DIR = join(REPO_ROOT, "src", "cli", "tests", "__fixtures__", "schemas");
const MAX_DESCRIPTION_LENGTH = 160;

// Fields whose description carries content rules (not prose shape) that a
// rubric cannot enforce. Each entry requires an inline justification.
const ALLOW_LIST = new Set<string>([
  // allow-listed: shell-safety metacharacter ban + emit-when semantics
  // are downstream-script content rules, not prose-rendering shape.
  "verifier.json:archive_reason_short",
]);

const BANNED_WORDS = [
  "section",
  "sections",
  "bullet",
  "bullets",
  "heading",
  "headings",
  "tier",
  "tiers",
];
const BANNED_LITERALS = ["##", "###", "MUST lead"];
const NUMERIC_SHAPE_RE =
  /\b(max|≤|<=|at most|up to)\s*\d+\s*(word|words|sentence|sentences|paragraph|paragraphs|bullet|bullets|char|chars|characters)\b/i;
// Augments the design's numeric regex to catch bare ranges like "3-5 short sentences"
// or "1 to 3 bullets" — required to flag `meditate-observe.kid_summary` ("3-5 short
// sentences, no jargon") on the pre-rewrite tree. Without this augmentation the field
// passes the length check (79 chars) and the design's `max N` regex does not match
// bare ranges, so red-phase enforcement would miss it. Documented in plan Chunk 1 notes.
const NUMERIC_RANGE_RE =
  /\b\d+\s*(?:[-–—]|\s+to\s+)\s*\d+\s+(?:short\s+|long\s+)?(word|words|sentence|sentences|paragraph|paragraphs|bullet|bullets)\b/i;

interface Violation {
  file: string;
  path: string;
  description: string;
  reason: string;
}

function collectDescriptions(
  node: unknown,
  path: string[],
  out: Array<{ path: string; description: string }>,
): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.description === "string") {
    out.push({ path: path.join("."), description: obj.description });
  }
  if (obj.properties && typeof obj.properties === "object") {
    for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
      collectDescriptions(v, [...path, "properties", k], out);
    }
  }
  if (obj.items) collectDescriptions(obj.items, [...path, "items"], out);
}

function fieldKey(file: string, path: string): string {
  const leafMatch = path.match(/properties\.([^.]+)\.?$/);
  const leaf = leafMatch ? leafMatch[1] : path || "<root>";
  return `${file}:${leaf}`;
}

function lintSchema(file: string): Violation[] {
  const full = join(SCHEMAS_DIR, file);
  const schema = JSON.parse(readFileSync(full, "utf8"));
  const descriptions: Array<{ path: string; description: string }> = [];
  collectDescriptions(schema, [], descriptions);

  const violations: Violation[] = [];
  for (const { path, description } of descriptions) {
    const key = fieldKey(file, path);
    if (ALLOW_LIST.has(key)) continue;

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      violations.push({
        file,
        path,
        description,
        reason: `description length ${description.length} > ${MAX_DESCRIPTION_LENGTH}`,
      });
    }

    const lower = description.toLowerCase();
    for (const word of BANNED_WORDS) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (re.test(description)) {
        violations.push({
          file,
          path,
          description,
          reason: `contains banned shape vocabulary '${word}'`,
        });
      }
    }
    for (const lit of BANNED_LITERALS) {
      if (lower.includes(lit.toLowerCase())) {
        violations.push({
          file,
          path,
          description,
          reason: `contains banned shape literal '${lit}'`,
        });
      }
    }
    const numericHit = description.match(NUMERIC_SHAPE_RE);
    if (numericHit) {
      violations.push({
        file,
        path,
        description,
        reason: `contains numeric shape pattern '${numericHit[0]}'`,
      });
    }
    const rangeHit = description.match(NUMERIC_RANGE_RE);
    if (rangeHit) {
      violations.push({
        file,
        path,
        description,
        reason: `contains numeric range shape pattern '${rangeHit[0]}'`,
      });
    }
  }
  return violations;
}

function formatViolation(v: Violation): string {
  return (
    `pipelines/schemas/${v.file}:${v.path} ${v.reason}. ` +
    `Output shape lives in the agent rubric, not the schema description. ` +
    `See specs/pipeline.md § Agent Schema Descriptions.`
  );
}

describe("pipelines/schemas/*.json description shape-vocabulary lint", () => {
  const files = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    it(`${file} descriptions do not encode output shape`, () => {
      const violations = lintSchema(file);
      if (violations.length > 0) {
        throw new Error(
          `schema description lint failed:\n${violations.map(formatViolation).join("\n")}`,
        );
      }
      expect(violations).toEqual([]);
    });
  }

  it("fixture: description-ok.json passes", () => {
    const full = join(FIXTURES_DIR, "description-ok.json");
    const schema = JSON.parse(readFileSync(full, "utf8"));
    const descriptions: Array<{ path: string; description: string }> = [];
    collectDescriptions(schema, [], descriptions);
    const offenders = descriptions.filter(({ description }) => {
      return (
        description.length > MAX_DESCRIPTION_LENGTH ||
        BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(description)) ||
        BANNED_LITERALS.some((l) => description.toLowerCase().includes(l.toLowerCase())) ||
        NUMERIC_SHAPE_RE.test(description) ||
        NUMERIC_RANGE_RE.test(description)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("fixture: description-bad.json fails", () => {
    const full = join(FIXTURES_DIR, "description-bad.json");
    const schema = JSON.parse(readFileSync(full, "utf8"));
    const descriptions: Array<{ path: string; description: string }> = [];
    collectDescriptions(schema, [], descriptions);
    const offenders = descriptions.filter(({ description }) => {
      return (
        description.length > MAX_DESCRIPTION_LENGTH ||
        BANNED_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(description)) ||
        BANNED_LITERALS.some((l) => description.toLowerCase().includes(l.toLowerCase())) ||
        NUMERIC_SHAPE_RE.test(description) ||
        NUMERIC_RANGE_RE.test(description)
      );
    });
    expect(offenders.length).toBeGreaterThan(0);
  });
});
```

Write to `src/cli/tests/pipeline-schema-descriptions.test.ts`.

- [ ] **Step 2: Run the test to verify RED on current tree**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts`
Expected: FAIL. The failing tests MUST name `chat-summarizer.json`, `explainer.json`, `meditate-observe.json`, and `tmux-test-result.json`. `verifier.json` MUST pass (allow-listed). Fixture tests MUST pass.

- [ ] **Step 3: Commit**

```bash
git add src/cli/tests/pipeline-schema-descriptions.test.ts
git commit -m "test(schemas): add description shape-vocabulary lint (red)"
```

---

## Chunk 2: Back the New Rubric Pointers

Before rewriting the schema descriptions, make sure every rubric the new pointers name is real and encodes the shape currently carried by the schema description.

**Pre-audit facts (verified against current working tree on 2026-04-20):**
- `src/cli/agents/change-explainer.md` — **exists**, already encodes the full Tier 1 / Tier 2 shape (rewritten this session). No work needed.
- `src/cli/agents/tmux-tester.md` — **exists**, already encodes the `test_render` Phase 4 markdown shape (`## Verification: PASS | FAIL`, `### Cycles run`, `### Fixes applied (N commits)`, `### Remaining issues`). No work needed.
- `src/cli/agents/chat-summarizer.md` — **does not exist**. The `chat_summarizer` pipeline node currently uses `agent="implement"` and carries the output shape inline in the node `prompt=` attribute (see `pipelines/illumination-to-implementation.dot:30` and the matching node in `pipelines/illumination-to-plan.dot`). We create the rubric file in Task 3, migrating that shape.
- `src/cli/agents/meditate-observer.md` — **does not exist**. The `tmux_meditate_observer` pipeline node in `pipelines/smoke/tmux-tester.dot:8` uses `agent="implement"` and carries the output shape inline. We create the rubric file in Task 4.

**Wiring:** We do NOT change any `agent="implement"` setting in DOT files. The new rubric files are documentation rubrics — they exist so the schema-description pointer resolves to a real file, and so future authors have a canonical shape reference. The node prompt may (optionally) be shrunk to cite the rubric rather than duplicate the shape inline; that optional shrink is Step 3 of each task and can be skipped if the reviewer prefers to keep the blast radius minimal.

### Task 3: Create `src/cli/agents/chat-summarizer.md`

**Files:**
- Create: `src/cli/agents/chat-summarizer.md`
- Modify (optional, Step 3): `pipelines/illumination-to-implementation.dot`, `pipelines/illumination-to-plan.dot`

- [ ] **Step 1: Dump the inline output-shape block from the node prompt**

Run: `grep -nA 40 "chat_summarizer \[" pipelines/illumination-to-implementation.dot | sed -n '/## Required output/,/Do NOT modify/p'`
Expected: prints the full `## Required output` block currently inlined in the `prompt=` attribute (per-bullet shape, MERGE rules, `scope_changed` semantics, "Do NOT modify any project files" tail). Confirm the identical block exists in `pipelines/illumination-to-plan.dot`:

`grep -nA 40 "chat_summarizer \[" pipelines/illumination-to-plan.dot | sed -n '/## Required output/,/Do NOT modify/p'`

If the two blocks diverge, stop and reconcile before proceeding — the rubric must be a single source of truth for both pipelines.

- [ ] **Step 2: Write the rubric file mirroring the inline block verbatim**

Create `src/cli/agents/chat-summarizer.md` with frontmatter mirroring the convention in `src/cli/agents/chat-refiner.md` (`name`, `description`, `model`, `permissionMode`, `tools`, `mcp`). Use conservative defaults (`model: opus`, `tools: [Read]`, `mcp: []`) since the rubric is documentation-only today.

The body MUST mirror the `## Required output` block dumped in Step 1 verbatim — every bullet, every MERGE rule, every constraint in the inline prompt is copied (not paraphrased) into the rubric. The inline block is the source of truth; the rubric is a 1:1 migration target.

Do NOT invent new rules. Do NOT reword, re-order, drop, or combine rules. If the inline prompt doesn't say it, the rubric doesn't say it either. Reviewer will diff the rubric body against the Step 1 dump.

- [ ] **Step 3 (optional): Shrink the inline node prompt to cite the rubric**

In `pipelines/illumination-to-implementation.dot` and `pipelines/illumination-to-plan.dot`, replace the `## Required output` block in the `chat_summarizer` node's `prompt=` with: `Follow the output format in src/cli/agents/chat-summarizer.md.` Preserve every other line of the prompt (context variables, file-read instructions).

Rationale for optional: the rubric is now the canonical shape source. Keeping the inline copy risks re-introducing the two-sources-of-truth failure mode. Skip if the reviewer prefers the prompt untouched — the rubric still backs the schema pointer.

- [ ] **Step 4: Validate and test**

Run: `npx ralph pipeline validate pipelines/illumination-to-implementation.dot`
Run: `npx ralph pipeline validate pipelines/illumination-to-plan.dot`
Expected: no new diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/cli/agents/chat-summarizer.md
# Add the two .dot files as well if Step 3 was applied.
git commit -m "feat(agents): add chat-summarizer rubric; shape moves out of schema description"
```

### Task 4: Create `src/cli/agents/meditate-observer.md`

**Files:**
- Create: `src/cli/agents/meditate-observer.md`
- Modify (optional, Step 3): `pipelines/smoke/tmux-tester.dot`

- [ ] **Step 1: Dump the inline output-shape block from the node prompt**

Run: `grep -nA 40 "tmux_meditate_observer \[" pipelines/smoke/tmux-tester.dot | sed -n '/Produce the four schema fields/,/Do NOT cancel/p'`
Expected: prints the full output-shape block inside `prompt=` — the four `Steps:` entries that enumerate schema fields (`topic`, `illumination_path`, `kid_summary`, `observation_notes`) plus the Rules tail ("Do NOT run 'ralph meditate' yourself synchronously — only via tmux send_keys", "Do NOT git push", "Do NOT cancel the meditation early").

- [ ] **Step 2: Write the rubric file mirroring the inline block verbatim**

Create `src/cli/agents/meditate-observer.md` with frontmatter (`model: opus`, `permissionMode: dangerouslySkipPermissions`, `tools: [Read, Grep, Glob, Bash]`, `mcp: []`).

The body MUST mirror the output-shape block dumped in Step 1 verbatim — every bullet, every rule, every constraint. The inline block is the source of truth; the rubric is a 1:1 migration target.

Do NOT invent new rules. Do NOT reword, re-order, drop, or combine rules. Reviewer will diff the rubric body against the Step 1 dump.

- [ ] **Step 3 (optional): Shrink the inline node prompt**

In `pipelines/smoke/tmux-tester.dot`, replace the output-shape bullets at the tail of the `tmux_meditate_observer` node's `prompt=` with `Follow the output format in src/cli/agents/meditate-observer.md.` Keep the tmux harness instructions (session/window binding, pid-file polling, harness helper source) inline — those are runtime harness context, not output shape.

Same skip caveat as Task 3 Step 3.

- [ ] **Step 4: Validate and test**

Run: `npx ralph pipeline validate pipelines/smoke/tmux-tester.dot`
Expected: no new diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/cli/agents/meditate-observer.md
# Add the .dot file as well if Step 3 was applied.
git commit -m "feat(agents): add meditate-observer rubric; shape moves out of schema description"
```

### Task 5: Sanity-read existing rubrics

**Files:** none (read-only)

- [ ] **Step 1: Confirm `src/cli/agents/tmux-tester.md` encodes the `test_render` shape**

Run: `grep -nE "tmux_confirm_gate|### Cycles run|### Fixes applied|### Remaining issues|## Verification:" src/cli/agents/tmux-tester.md`
Expected: multiple hits spanning the `## Verification: PASS | FAIL` header, the `### Cycles run` / `### Fixes applied` / `### Remaining issues` subsections, and the `tmux_confirm_gate` render contract. No edit needed — this is the rubric's existing Phase 4 Report block.

- [ ] **Step 2: Confirm `src/cli/agents/change-explainer.md` encodes Tier 1 + Tier 2**

Run: `grep -nE "Tier 1|Tier 2|## In plain words" src/cli/agents/change-explainer.md`
Expected: the `# Required output format` section names Tier 1 (`## In plain words`, ≤ 3 sentences, zero jargon, pain→change→gain) and Tier 2 (`## What changes`, `## Why now`, `## Scope`, ≤ 250 words, ≤ 4 bullets per subsection, ≤ 5 file paths total). No edit needed — the rubric was rewritten this session.

No commit in Task 5.

---

## Chunk 3: Schema Description Rewrites (Green Phase)

Apply the four rewrites from the design doc, then verify the lint test flips to green.

### Task 7: Rewrite `chat-summarizer.json`

**Files:**
- Modify: `pipelines/schemas/chat-summarizer.json:6`

- [ ] **Step 1: Replace `refinements.description`**

Replace:

```json
"description": "Cumulative refinement log. Markdown bullets with attribution per entry: each bullet states the refinement, the chat round it came from, the user's surfaced topic, and the rationale. Subsequent rounds APPEND; never drop prior entries."
```

With:

```json
"description": "Cumulative refinement log per agent rubric (src/cli/agents/chat-summarizer.md). Subsequent rounds APPEND; never drop prior entries."
```

- [ ] **Step 2: Run the lint test for this file**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts -t chat-summarizer.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add pipelines/schemas/chat-summarizer.json
git commit -m "refactor(schemas): rewrite chat-summarizer refinements as rubric pointer"
```

### Task 8: Rewrite `explainer.json`

**Files:**
- Modify: `pipelines/schemas/explainer.json:6`

- [ ] **Step 1: Replace `explainer_render.description`**

Replace the current `explainer_render.description` (the long Tier 1/Tier 2 spec) with:

```json
"description": "Markdown render shown verbatim in the approval gate label per agent rubric (src/cli/agents/change-explainer.md)."
```

- [ ] **Step 2: Run the lint test for this file**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts -t explainer.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add pipelines/schemas/explainer.json
git commit -m "refactor(schemas): rewrite explainer_render description as rubric pointer"
```

### Task 9: Rewrite `meditate-observe.json`

**Files:**
- Modify: `pipelines/schemas/meditate-observe.json:14`

- [ ] **Step 1: Replace `kid_summary.description`**

Replace:

```json
"description": "Summary of the illumination written for a 5-year-old (3-5 short sentences, no jargon)"
```

With:

```json
"description": "Plain-language summary of the illumination per agent rubric (src/cli/agents/meditate-observer.md)."
```

- [ ] **Step 2: Run the lint test for this file**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts -t meditate-observe.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add pipelines/schemas/meditate-observe.json
git commit -m "refactor(schemas): rewrite kid_summary description as rubric pointer"
```

### Task 10: Rewrite `tmux-test-result.json`

**Files:**
- Modify: `pipelines/schemas/tmux-test-result.json:20`

- [ ] **Step 1: Replace `test_render.description`**

Replace:

```json
"description": "Markdown-formatted block for display at the approval gate. Cover: pass/fail banner, short summary, cycles run, fixes applied (with commit hashes), remaining issues as bullets. This is read verbatim by the user at tmux_confirm_gate to decide Commit vs Retry."
```

With:

```json
"description": "Markdown render shown verbatim at tmux_confirm_gate per agent rubric (src/cli/agents/tmux-tester.md)."
```

- [ ] **Step 2: Run the lint test for this file**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts -t tmux-test-result.json`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add pipelines/schemas/tmux-test-result.json
git commit -m "refactor(schemas): rewrite tmux test_render description as rubric pointer"
```

### Task 11: Full green

**Files:** none (verification only)

- [ ] **Step 1: Run the full lint suite**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts`
Expected: all tests PASS including fixture tests. `verifier.json` passes via `ALLOW_LIST`.

- [ ] **Step 2: Run the entire project test suite**

Run: `npm test`
Expected: PASS. No existing test regressed (agent-handler, engine, schemas, transforms, etc.).

---

## Chunk 4: Documentation

Document the rule so future schema authors don't re-introduce shape vocabulary.

### Task 12: Add `### Agent Schema Descriptions` subsection

**Files:**
- Modify: `specs/pipeline.md` (insert new `### Agent Schema Descriptions` subsection under `## Node Types (Handlers)`, above `## Variable Expansion` around line 124)

- [ ] **Step 1: Insert the subsection**

Add, just before `## Variable Expansion`:

```markdown
### Agent Schema Descriptions

Agent nodes that declare `json_schema_file` have the full stringified schema (all `description` fields verbatim) injected above the rubric reference in the assembled prompt by `src/attractor/handlers/agent-handler.ts`. A schema `description` is therefore a prompt input, not just developer documentation — and it arrives with stronger framing (`IMPORTANT:` banner) than the rubric reference. Schema descriptions MUST NOT encode output shape (section names, bullet conventions, sentence/word/bullet counts, heading patterns, tier structure). Output shape lives in the agent rubric at `src/cli/agents/<agent-name>.md`. Descriptions state *what* the field is and MAY carry content rules that the rubric cannot enforce (shell-safety, append-vs-replace semantics, emit-when conditions). The lint test `src/cli/tests/pipeline-schema-descriptions.test.ts` enforces this — it fails loudly on banned shape vocabulary and on descriptions over 160 characters.
```

- [ ] **Step 2: Verify the lint error message points here**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts`
Then `grep -n "Agent Schema Descriptions" specs/pipeline.md` to confirm the anchor exists. Expected: PASS + grep hit.

- [ ] **Step 3: Commit**

```bash
git add specs/pipeline.md
git commit -m "docs(pipeline): document agent schema description rule"
```

---

## Chunk 5: Post-Merge Manual Verification

Manual checks to run on the merged branch. These are NOT automated — they confirm no rubric lost shape behavior during the rewrite.

### Task 13: illumination-to-implementation end-to-end

- [ ] **Step 1:** Trigger the `illumination-to-implementation` pipeline against any illumination.
- [ ] **Step 2:** At the approval gate, confirm the `explainer_render` still conforms to the Tier 1 / Tier 2 shape (lead with `## In plain words`, followed by `## What changes`, `## Why now`, `## Scope`).
- [ ] **Step 3:** If shape regresses, `src/cli/agents/change-explainer.md` is missing the constraint — fix the rubric, not the schema.

### Task 14: meditate one full cycle

- [ ] **Step 1:** Run a `meditate` cycle.
- [ ] **Step 2:** Confirm the observer's `kid_summary` remains plain-language (3–5 short sentences, no jargon).
- [ ] **Step 3:** If shape regresses, fix `src/cli/agents/meditate-observer.md`.

### Task 15: chat-summarizer + tmux-tester smoke

- [ ] **Step 1:** Run any pipeline that exercises `chat-summarizer`. Confirm `refinements` still APPENDS and still carries per-entry attribution bullets.
- [ ] **Step 2:** Run any pipeline that exercises `tmux-tester`. Confirm `test_render` still renders the pass/fail banner + cycle summary at `tmux_confirm_gate`.
- [ ] **Step 3:** If shape regresses, fix the respective rubric.

---

## Completion Criteria

- `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts` passes, including fixture tests.
- `npm test` passes with no regressions.
- `pipelines/schemas/chat-summarizer.json`, `explainer.json`, `meditate-observe.json`, and `tmux-test-result.json` have rubric-pointer descriptions.
- `pipelines/schemas/verifier.json:archive_reason_short` is unchanged and allow-listed.
- `specs/pipeline.md` has the `### Agent Schema Descriptions` subsection under `## Node Types (Handlers)`.
- `src/cli/agents/*.md` rubrics for `change-explainer`, `chat-summarizer`, `meditate-observer`, and `tmux-tester` all encode the output shape that was removed from the schema description.
