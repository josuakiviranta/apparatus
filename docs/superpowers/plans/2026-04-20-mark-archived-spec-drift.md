---
status: implemented
---

# Mark-Archived Spec-Drift — `archive_reason_short` Implementation Plan

## Status

**Shipped 2026-04-20.** All four chunks landed: mark-archived.mjs argv-join (58e5937), verifier schema+rubric (55aff7c), pipeline dot swap + artifact regression tests + validator-hint rendering, and superseded banner on prior spec. 995 unit tests + 6 pipeline artifact tests green.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore rich archive-audit-trail by adding a shell-safe `archive_reason_short` field to the verifier's structured output and piping it through `mark_archived`, replacing the current two-state `Archive|Decline` token.

**Architecture:** Keep the single `mark_archived` node. Teach `pipelines/scripts/mark-archived.mjs` to reconstruct multi-word reasons from `process.argv.slice(3)` (sh -c tokenization splits them). Add one optional property to `pipelines/schemas/verifier.json` and a matching rubric rule in `src/cli/agents/verifier.md`. Swap `$choice` → `$archive_reason_short` on the `mark_archived` node and supply `default_archive_reason_short="Declined at approval gate"` for the decline branch. Supersede the obsolete prior spec.

**Tech Stack:** Node.js, Vitest (for `.mjs` and `.ts` tests), JSON Schema, ralph-cli DOT pipeline + validator.

**Primary source of truth:** `specs/2026-04-19-mark-archived-spec-drift-design.md`

---

## File Structure

- **Modify:** `pipelines/scripts/mark-archived.mjs` — rebuild reason via `process.argv.slice(3).join(" ")`.
- **Modify:** `pipelines/scripts/tests/mark-archived.test.mjs` — add 3 tests for the new argv-join path.
- **Modify:** `pipelines/schemas/verifier.json` — add `archive_reason_short` property (not required).
- **Modify:** `src/cli/agents/verifier.md` — add Output bullet + Hard-rule line.
- **Modify:** `pipelines/illumination-to-implementation.dot` — extend `produces=`, add `default_archive_reason_short`, swap `script_args`.
- **Create:** `pipelines/tests/illumination-to-implementation.artifacts.test.ts` — regression assertions on schema, dot, and rubric wiring. *(Final path may be adjusted to match the closest existing pipeline-test file; see Chunk 3.)*
- **Modify:** `specs/2026-04-19-mark-archived-reason-split-design.md` — prepend superseded banner + body note.

---

## Chunk 1: Script argv-join + multi-word tests

**Files:**
- Modify: `pipelines/scripts/mark-archived.mjs:3` — swap single-arg destructure for `argv.slice(3)` join.
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs` — add 2 new tests.

**Why this chunk first:** The engine raw-expands `$archive_reason_short` into `sh -c`, which tokenizes on whitespace. Script currently reads `process.argv[3]` and would keep only the first word. Fixing the script before changing the pipeline keeps every commit green.

- [ ] **Step 1.1: Write failing test — multi-word invalid reason via multiple argv entries**

Add to `pipelines/scripts/tests/mark-archived.test.mjs` (after the existing "literal" test):

```javascript
  it("joins multiple argv entries (simulates sh -c tokenization of a multi-word reason)", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Simulates engine raw-expansion of `$archive_reason_short` into sh -c,
    // which tokenizes the sentence into separate argv entries.
    const result = runScript([
      target,
      "pipelineFailed",
      "boolean",
      "already",
      "present",
      "at",
      "src/attractor/engine.ts:221",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const after = readFileSync(target, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present at src/attractor/engine.ts:221\n",
    );
  });

  it("joins multiple argv entries for the decline-path default reason", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Decline path: node default `Declined at approval gate` tokenizes to 4 argv entries.
    const result = runScript([target, "Declined", "at", "approval", "gate"]);

    expect(result.status).toBe(0);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("reason: Declined at approval gate\n");
  });
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`
Expected: the 2 new tests FAIL with `reason: pipelineFailed\n` (first-word only) or similar truncation; all other tests still pass.

- [ ] **Step 1.3: Implement argv-join**

Replace `pipelines/scripts/mark-archived.mjs` lines 1–7 with:

```javascript
import fs from "node:fs";

const [illuminationPath, ...reasonArgs] = process.argv.slice(2);
if (!illuminationPath || reasonArgs.length === 0) {
  console.error("usage: mark-archived.mjs <illumination> <reason-or-reason-file>");
  process.exit(2);
}
const reasonArg = reasonArgs.join(" ");
```

Rationale: `sh -c` tokenizes a multi-word reason into separate argv entries. `argv.slice(2)` keeps `illuminationPath` as argv[0] of the rest; remaining entries rejoin into the reason. Single-word reasons (or `spawnSync([target, "whole string"])`) still work because `reasonArgs` will contain one entry. The file-vs-literal branch on the rejoined `reasonArg` continues to work: single-entry paths resolve as before; multi-word strings never match a real file path and fall through to the literal branch.

- [ ] **Step 1.4: Run all script tests to verify green**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`
Expected: all existing tests + 2 new tests PASS. No regressions.

- [ ] **Step 1.5: Commit**

```bash
git add pipelines/scripts/mark-archived.mjs pipelines/scripts/tests/mark-archived.test.mjs
git commit -m "fix(mark-archived): rejoin multi-word reasons from argv slice

sh -c tokenizes \$archive_reason_short into separate argv entries; the
script now rebuilds the reason so the YAML frontmatter \`reason:\` line
captures the full sentence instead of the first word."
```

---

## Chunk 2: Verifier schema + rubric (co-load-bearing)

**Files:**
- Modify: `pipelines/schemas/verifier.json` — add `archive_reason_short` property.
- Modify: `src/cli/agents/verifier.md` — add Output bullet + Hard-rule line.

**Why together:** Spec ("Constraints" → "Schema + rubric are co-load-bearing") — schema leaves the field optional because success-path agents have no consumer; rubric makes it required on the `false` path. Both land in one commit or the invalid path silently writes empty reasons.

- [ ] **Step 2.1: Edit `pipelines/schemas/verifier.json`**

After the existing `explanation` property (before the closing `}` of `properties`), add:

```json
    "archive_reason_short": {
      "type": "string",
      "description": "Shell-safe one-line reason suitable for archived frontmatter. Emit when preferred_label is 'false'. One sentence, ≤100 chars, no newlines, no shell metacharacters (no $, `, \", ', \\, ;, |, &, <, >, (, ), {, }). Written verbatim into the illumination's frontmatter reason: field if the user archives at remove_gate."
    }
```

Keep `required` unchanged (field stays optional). Keep `additionalProperties: false`.

- [ ] **Step 2.2: Edit `src/cli/agents/verifier.md` — Output section**

Under `# Output` (after the `explanation` bullet), add:

```markdown
- `archive_reason_short`: required when `preferred_label` is `"false"`. One sentence, ≤100 chars, no newlines, no shell metacharacters. The illumination's archive frontmatter reads this verbatim. Example: `Feature already implemented at src/bar.ts:42` — not `This illumination is stale because…`. Omit (or set to empty) when `preferred_label` is `"true"` or `"empty"`.
```

- [ ] **Step 2.3: Edit `src/cli/agents/verifier.md` — Hard rules**

Under `# Hard rules`, append:

```markdown
- On `preferred_label: "false"`, you MUST emit `archive_reason_short`. The mark_archived script uses it verbatim as the illumination's archived frontmatter `reason:` value. Treat the shape constraints (one sentence, ≤100 chars, shell-safe) as strict.
```

- [ ] **Step 2.4: Validate JSON schema parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('pipelines/schemas/verifier.json','utf8'))" && echo OK`
Expected: `OK` (no parse error).

- [ ] **Step 2.5: Commit**

```bash
git add pipelines/schemas/verifier.json src/cli/agents/verifier.md
git commit -m "feat(verifier): add archive_reason_short to schema + rubric

Co-land schema (optional property) and agent rubric (required on the
false path). Consumer-side swap of \$choice → \$archive_reason_short on
the mark_archived node follows in the next commit."
```

---

## Chunk 3: Pipeline dot edit + artifact regression tests

**Files:**
- Create: `pipelines/tests/illumination-to-implementation.artifacts.test.ts` — asserts schema/dot/rubric wiring (path may be adjusted to match the nearest existing pipeline-test file; see Step 3.1).
- Modify: `pipelines/illumination-to-implementation.dot` — two edits: `produces=` extension on `verifier`, and `mark_archived` node default + script_args swap.

**TDD order:** write regression assertions first (they fail against the unchanged dot), then apply the dot edits to make them pass.

- [ ] **Step 3.1: Determine test file location**

Check for an existing pipeline-artifact test harness:

```bash
ls pipelines/tests/ 2>/dev/null
ls src/cli/tests/ | grep -i pipeline
```

- If a pipeline artifact/validator test already exists and covers this dot, extend it instead of creating a new file.
- Otherwise create `pipelines/tests/illumination-to-implementation.artifacts.test.ts`.

Pick the file once; use the same path for Steps 3.2 and 3.3.

- [ ] **Step 3.2: Write failing artifact regression test**

Content (adjust import paths to match project convention):

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOT = resolve(__dirname, "../illumination-to-implementation.dot");
const SCHEMA = resolve(__dirname, "../schemas/verifier.json");
const RUBRIC = resolve(__dirname, "../../src/cli/agents/verifier.md");

describe("illumination-to-implementation.dot — archive_reason_short wiring", () => {
  const dot = readFileSync(DOT, "utf8");

  it("verifier node's produces= list includes archive_reason_short", () => {
    const verifierLine = dot.split("\n").find((l) => l.includes('agent="verifier"'));
    expect(verifierLine).toBeDefined();
    expect(verifierLine).toMatch(/produces="[^"]*\barchive_reason_short\b[^"]*"/);
  });

  it("mark_archived node passes $archive_reason_short, not $choice", () => {
    const match = dot.match(/mark_archived\s*\[[^\]]*script_args="([^"]+)"/s);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("$archive_reason_short");
    expect(match![1]).not.toContain("$choice");
  });

  it("mark_archived node declares default_archive_reason_short for the decline path", () => {
    const match = dot.match(/mark_archived\s*\[[^\]]*default_archive_reason_short="([^"]+)"/s);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Declined at approval gate");
  });
});

describe("verifier.json schema — archive_reason_short property", () => {
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));

  it("declares archive_reason_short as an optional string property", () => {
    expect(schema.properties.archive_reason_short).toBeDefined();
    expect(schema.properties.archive_reason_short.type).toBe("string");
    expect(schema.required).not.toContain("archive_reason_short");
  });

  it("preserves additionalProperties: false", () => {
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("verifier.md rubric — archive_reason_short rule", () => {
  const rubric = readFileSync(RUBRIC, "utf8");

  it("mentions archive_reason_short in Output section and Hard rules", () => {
    expect(rubric).toMatch(/archive_reason_short/);
    expect(rubric).toMatch(/MUST emit `archive_reason_short`/);
  });
});
```

- [ ] **Step 3.3: Run tests to verify they fail**

Run: `npx vitest run <path-chosen-in-3.1>`
Expected: dot-assertion tests FAIL (current dot has `$choice`, no `default_archive_reason_short`, no `archive_reason_short` in `produces=`). Schema/rubric tests PASS because Chunk 2 already landed those.

- [ ] **Step 3.4: Edit `pipelines/illumination-to-implementation.dot` — verifier produces**

On the `verifier` node (line 10), change `produces="preferred_label, illumination_path, summary, explanation"` to:

```
produces="preferred_label, illumination_path, summary, explanation, archive_reason_short"
```

- [ ] **Step 3.5: Edit `pipelines/illumination-to-implementation.dot` — mark_archived node**

Replace the `mark_archived` node block (lines 14–17) with:

```
  mark_archived [type="tool",
                 cwd="$project",
                 script_file="scripts/mark-archived.mjs",
                 default_archive_reason_short="Declined at approval gate",
                 script_args="$illumination_path $archive_reason_short"]
```

- [ ] **Step 3.6: Run the pipeline validator**

Run: `npx ralph pipeline validate pipelines/illumination-to-implementation.dot` (or whatever the in-repo equivalent is — `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot`).

Expected: exit 0. The spec notes ("Architecture" → "Pipeline") that a producer-tracking warning about the gate-side default is acceptable; a hard error is not. If the validator errors (rather than warns), stop and consult spec §Architecture and §Constraints before hacking around it.

- [ ] **Step 3.7: Run artifact tests to verify green**

Run: `npx vitest run <path-chosen-in-3.1>`
Expected: all tests PASS.

- [ ] **Step 3.8: Run the full suite to confirm no regressions**

Run: `npm run build && npm test`
Expected: green.

- [ ] **Step 3.9: Commit**

```bash
git add pipelines/illumination-to-implementation.dot <path-chosen-in-3.1>
git commit -m "feat(pipeline): route archive_reason_short through mark_archived

verifier produces archive_reason_short; mark_archived consumes it via
script_args; default_archive_reason_short supplies the decline-branch
value so archived frontmatter gains a rationale instead of the literal
token 'Archive' or 'Decline'."
```

---

## Chunk 4: Supersede the prior spec + final verification

**Files:**
- Modify: `specs/2026-04-19-mark-archived-reason-split-design.md` — prepend supersede banner + body paragraph.

**Why:** The prior spec describes a two-node + sidecar shape that no longer matches code or the current spec. Leaving it unmarked misleads the next reader; deleting it breaks git-log archaeology (spec §Constraints: "Superseded spec stays in-tree. Delete would break git-log archaeology. A superseded header is the lowest-churn signal.").

- [ ] **Step 4.1: Read the prior spec's current header**

Run: `head -15 specs/2026-04-19-mark-archived-reason-split-design.md`
Note the existing frontmatter shape so the banner lands in the right block.

- [ ] **Step 4.2: Prepend supersede banner + body note**

Update the prior spec's header block to include:

```markdown
**Status:** Superseded by `specs/2026-04-19-mark-archived-spec-drift-design.md`
```

And insert a paragraph at the top of the body (above the existing "Overview" or equivalent first section):

```markdown
> **Superseded.** This spec prescribed a two-node split (`mark_archived_invalid` + `mark_archived_decline`) plus an `explain_removal` sidecar writing `$meditations_dir/.triage/$run_id/invalid-reason.txt` to ferry multi-word rationale through `sh -c`. During refactor the pipeline collapsed to a single `mark_archived` node and `explain_removal` was removed. The replacement design — a shell-safe `archive_reason_short` field emitted by the verifier and passed as `mark_archived`'s reason arg — lives in `specs/2026-04-19-mark-archived-spec-drift-design.md`. Body retained for archaeology.
```

- [ ] **Step 4.3: Sanity-check file still renders**

Run: `head -30 specs/2026-04-19-mark-archived-reason-split-design.md`
Expected: banner + body note present; rest of file intact.

- [ ] **Step 4.4: Full pipeline smoke (if a dry-run harness exists)**

Run (only if the repo has a low-cost pipeline smoke suite; skip otherwise): `npm run test:pipelines` or the nearest equivalent.
Expected: green. If no suite exists, rely on Chunks 1 + 3's test coverage.

- [ ] **Step 4.5: Commit**

```bash
git add specs/2026-04-19-mark-archived-reason-split-design.md
git commit -m "docs(specs): supersede mark-archived-reason-split by spec-drift

Prior spec described a two-node + sidecar shape that no longer matches
the pipeline. Retain body for archaeology; point readers to the
replacement design."
```

- [ ] **Step 4.6: Final verification**

Run: `npm run build && npm test`
Expected: green.

Run: `npx ralph pipeline validate pipelines/illumination-to-implementation.dot` (or repo equivalent).
Expected: exit 0.

Confirm no other spec/doc references the stale `mark_archived_invalid` / `mark_archived_decline` / `explain_removal` names by running:

```bash
grep -rn "mark_archived_invalid\|mark_archived_decline\|explain_removal" --include="*.md" --include="*.dot" . | grep -v superseded | grep -v spec-drift
```

Expected: empty (or only the prior spec's body text, which is explicitly retained).

---

## Coverage of spec §Components §5 (regression assertions)

The spec pins three assertions for a regression surface. They are satisfied by tests across Chunks 1 and 3 (no separate end-to-end scenario file is needed — running the opus verifier agent inside a unit test is not feasible; the static wiring + script behavior together cover the intent):

| Spec assertion | Where covered |
|---|---|
| Invalid path: `reason:` equals verifier's `archive_reason_short` verbatim, not literal `Archive`. | Chunk 1 Step 1.1 new test "joins multiple argv entries (simulates sh -c tokenization of a multi-word reason)" + Chunk 3 Step 3.2 artifact test asserting the dot routes `$archive_reason_short` (not `$choice`) into `script_args`. |
| Decline path: `reason:` equals `Declined at approval gate`, not literal `Decline`. | Chunk 1 Step 1.1 new test "joins multiple argv entries for the decline-path default reason" + Chunk 3 Step 3.2 artifact test asserting `default_archive_reason_short="Declined at approval gate"` is present on the `mark_archived` node. |
| Absent-field guard: when verifier skips `archive_reason_short` on the false path, pipeline fails loudly (script exits non-zero, no silent empty `reason:`). | Existing `mark-archived.test.mjs` test "fails with exit 2 and usage message when args are missing" (lines 128–132) already asserts exit 2 + usage message when the reason arg is empty. Runtime flow: absent `$archive_reason_short` interpolates to empty string in `script_args`, `sh -c` drops the trailing empty token, script sees only `illuminationPath`, exits 2. No new test needed. |

## Cross-cutting constraints (from spec §Constraints)

- **Schema + rubric co-land.** Chunk 2 commits them together. Do not split.
- **Script must join `argv[3..]`.** Chunk 1 lands before Chunk 3's dot edit so multi-word reasons always survive.
- **Rubric example uses `file:line` citation style.** Preserved verbatim in Step 2.2.
- **Shell-safety lives in the agent.** No sanitization added to the script; the rubric's metacharacter blacklist is the contract.
- **Idempotency preserved.** `mark-archived.mjs` same-reason idempotent path and different-reason error path remain unchanged — existing tests cover both.
- **No engine change.** `src/attractor/handlers/tool.ts` `sh -c` raw-expansion behavior is untouched.
- **No retroactive rewrites.** Existing archived illuminations keep their current `reason:` value.

## Out of scope (from spec §What This Excludes)

Do not touch in this plan:

- Decline-reason UX at `approval_gate` (human-typed rationale).
- JSON-schema `pattern`/`maxLength` structural enforcement of the shell-safe shape.
- `mark-dispatched.mjs` or its test file.
- Re-introducing `explain_removal` or the two-node split.
- Default-var whitelist extension (unless Step 3.6 surfaces a hard validator error attributable to `default_archive_reason_short`; see spec §What This Excludes).
- Hand-editing existing archived illuminations.
