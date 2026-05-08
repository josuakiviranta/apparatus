# Implement Node No-Op Passes Verification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `implement` no-op → `tmux_tester` pass collusion in `illumination-to-implementation` by adding three orthogonal disambiguating signals (`implement.pre_sha`, `implement.reason`, `tmux_tester.plan_files_touched`), a richer `tmux_confirm_gate` render, a memory-writer Warnings cross-check, and a backfill smoke test.

**Architecture:** Agent-driven diff guard inside `implement.md` (frontmatter outputs extension + Step 0c capture / Step N+1 verify) — no `LoopingAgentHandler` change. Plan-coverage signal in `tmux-tester.md` sourced from `plan_writer.plan_path` and the `implement.pre_sha`-anchored diff range. `tmux_confirm_gate` body renders all three signals so the operator decides on independent evidence. Memory-writer prepends a `## Warnings` section when `tmux_tester.test_summary` matches a no-op substring set.

**Tech Stack:** TypeScript / Vitest tests; Markdown frontmatter (YAML) + body for `.apparat/pipelines/illumination-to-implementation/*.md`; DOT pipeline definition unchanged.

---

## Source-of-truth note (read before chunk 1)

The design doc references two existing scenario tests as the targets for `pre_sha` and `plan_files_touched` assertions:

- `src/cli/tests/pipeline-implement-folder.test.ts` — actually tests `src/cli/pipelines/implement/pipeline.dot` (the `scenario-author` / `implementation-tester` flow). It already asserts a `record_base` tool node captures git HEAD as JSON. **It does NOT test `.apparat/pipelines/illumination-to-implementation/implement.md`.** Editing it for `pre_sha` would be wrong scope.
- `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` — tests `.apparat/scenarios/tmux-tester/pipeline.dot`, which drives a `meditate-observer` agent (not the `tmux-tester.md` agent in `illumination-to-implementation`). **It does NOT exercise the agent body of the `tmux-tester` we are editing.**

This plan therefore creates **new** content-shape test files alongside the existing ones, named to match the `illumination-to-implementation` pipeline directly. The design doc's intent is preserved (assert `pre_sha` is wired, assert `plan_files_touched` and the three-signal gate body interpolation appear); only the file targets are corrected.

A `runPipelineForTest` helper does not exist in this repo (`Grep runPipelineForTest src/` → 0 hits). The new smoke uses the **shape-test** pattern that the rest of `src/cli/tests/pipeline-smoke-*-folder.test.ts` files use (read the `.md` and assert content), not a runtime engine driver. A future engine-driven smoke is left as Open Question §OQ1.

> **Retro note (added during Chunk 3):** Chunk 2 originally specified `plan_files_touched: integer` but the validator at `src/attractor/core/schemas.ts` only supports `string`/`number`/`boolean` shorthands — `integer` is not a recognized shorthand and produces `[outputs_schema_invalid]`. Switched to `number` retroactively during Chunk 3 to keep `pipeline validate` exit 0 for Chunk 5.

---

## Chunk 1: `implement.md` — agent-driven diff guard

Adds `pre_sha` + `reason` to the `outputs:` frontmatter, and inserts Step 0c (capture pre_sha) + Step N+1 (diff guard before declaring done) in the body. Pure edit to `.apparat/pipelines/illumination-to-implementation/implement.md`.

**Files:**
- Test (new): `src/cli/tests/pipeline-illum-to-impl-implement-folder.test.ts`
- Modify: `.apparat/pipelines/illumination-to-implementation/implement.md`

### Steps

- [x] **Step 1.1: Write the failing content-shape test**

Create `src/cli/tests/pipeline-illum-to-impl-implement-folder.test.ts` with the following content:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const IMPLEMENT_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "implement.md",
);

describe(".apparat/pipelines/illumination-to-implementation/implement.md — diff guard", () => {
  const md = readFileSync(IMPLEMENT_MD, "utf-8");

  it("declares pre_sha as a string output in frontmatter", () => {
    expect(md).toMatch(/outputs:[\s\S]*?pre_sha:\s*string/);
  });

  it("declares reason as an enum output covering no_diff_produced and empty", () => {
    expect(md).toMatch(/outputs:[\s\S]*?reason:\s*\{enum:\s*\[no_diff_produced,\s*""\]\}/);
  });

  it("body captures pre_sha via `git rev-parse HEAD` BEFORE any work (Step 0c)", () => {
    expect(md).toMatch(/Step 0c/);
    expect(md).toMatch(/pre_sha=\$\(cd \$project && git rev-parse HEAD\)/);
  });

  it("body runs a diff guard with `git diff --stat $pre_sha HEAD` and `git status --porcelain` before declaring done", () => {
    expect(md).toMatch(/git diff --stat \$pre_sha HEAD/);
    expect(md).toMatch(/git status --porcelain/);
  });

  it("body documents emitting done=false reason=no_diff_produced when both diff and porcelain are empty", () => {
    expect(md).toContain("no_diff_produced");
    expect(md).toMatch(/"done":\s*false/);
  });

  it("body documents emitting done=<self-attested> reason=\"\" pre_sha=<sha> on the happy path", () => {
    expect(md).toMatch(/"reason":\s*""/);
    expect(md).toMatch(/"pre_sha":\s*"<sha>"/);
  });
});
```

- [x] **Step 1.2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-implement-folder.test.ts`
Expected: 6 failing assertions (all assertions reference content not yet present in `implement.md`).

- [x] **Step 1.3: Edit the frontmatter `outputs:` block**

Open `.apparat/pipelines/illumination-to-implementation/implement.md`. Replace lines 11–12:

```yaml
outputs:
  done: boolean
```

with:

```yaml
outputs:
  done: boolean
  pre_sha: string
  reason: {enum: [no_diff_produced, ""]}
```

- [x] **Step 1.4: Insert Step 0c — capture pre_sha**

Between today's `0b. **Read the active plan.**` block (ends at line 31) and the `0d.` block (line 32), insert a new `0c.` step. The current line 32 is `0d. For reference, the application source code is in src/*.`. Note: the file already uses `0a`, `0b`, `0d` — there is currently no `0c`. Insert exactly:

```markdown
0c. **Capture pre-implement HEAD sha (diff-guard reference).** Before any reads, dispatches, or edits, record the working-tree state:

    ```bash
    pre_sha=$(cd $project && git rev-parse HEAD)
    ```

    Carry this value in your working memory through to the final JSON emit. Every iteration's final JSON MUST include `pre_sha` whether you emit `done=true` or `done=false`.
```

Place it directly between `0b.` (line 31) and `0d.` (line 32). Indentation: outermost bullet is flush left to match `0a`/`0b`/`0d`.

- [x] **Step 1.5: Insert Step N+1 — diff guard**

Append a new section between today's step `4.` (ends ~line 37) and the `9.` step (line 40). The existing numbering is `1, 2, 3, 4, 9, 99, 999, …`. Insert as `5.` (the gap in numbering allows a clean insert):

```markdown
5. **Diff guard before declaring done (mandatory final pre-emit step).** Before emitting your iteration's final JSON, run in `$project`:

    ```bash
    cd $project
    diff_stat=$(git diff --stat $pre_sha HEAD)
    porcelain=$(git status --porcelain)
    ```

    If BOTH `diff_stat` AND `porcelain` are empty AND this iteration's narrative claimed non-trivial implementation work (you attempted a chunk, you intended to touch a file), emit:

    ```json
    { "done": false, "reason": "no_diff_produced", "pre_sha": "<sha>" }
    ```

    Refuse to mask a no-op as success — the deep loop will re-invoke you with a fresh context to actually do the work. Otherwise emit:

    ```json
    { "done": <self-attested>, "reason": "", "pre_sha": "<sha>" }
    ```

    The handler at `src/attractor/handlers/looping-agent-handler.ts:151` still trusts the `done` field as-is — this guard lives in the agent prompt, not the handler, so policy tweaks (e.g. allow no-op for doc-only plans) stay readable here.
```

- [x] **Step 1.6: Run the test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-implement-folder.test.ts`
Expected: 6 passing assertions, no failures.

- [x] **Step 1.7: Commit**

```bash
git add src/cli/tests/pipeline-illum-to-impl-implement-folder.test.ts \
        .apparat/pipelines/illumination-to-implementation/implement.md
git commit -m "feat(implement): add agent-driven diff guard with pre_sha and no_diff_produced reason"
```

### Verification targets

- Smokes: `None` (engine-driven smoke covered in Chunk 5 against `.apparat/pipelines/illumination-to-implementation/pipeline.dot`)
- Manual exercises: `None`
- Lint: `npx vitest run src/cli/tests/pipeline-illum-to-impl-implement-folder.test.ts` and `npx tsc --noEmit`
- Surfaces touched: `pipeline-spec` (illumination-to-implementation/implement.md frontmatter + body), `deep-loop-handler-contract` (additive `outputs:` keys consumed by `outputsToZod` at `src/attractor/handlers/looping-agent-handler.ts:54`)

---

## Chunk 2: `tmux-tester.md` — plan-coverage signal (`plan_files_touched`)

Extends `inputs:` with `plan_writer.plan_path` and `implement.pre_sha`, adds `plan_files_touched: number` to `outputs:`, and inserts Phase 0a (plan-coverage candidate extraction) + Phase 1c (diff cross-reference) into the body.

**Files:**
- Test (new): `src/cli/tests/pipeline-illum-to-impl-tmux-tester-folder.test.ts`
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`

### Steps

- [x] **Step 2.1: Write the failing content-shape test**

Create `src/cli/tests/pipeline-illum-to-impl-tmux-tester-folder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const TMUX_TESTER_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "tmux-tester.md",
);

describe(".apparat/pipelines/illumination-to-implementation/tmux-tester.md — plan-coverage signal", () => {
  const md = readFileSync(TMUX_TESTER_MD, "utf-8");

  it("inputs include plan_writer.plan_path and implement.pre_sha", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*plan_writer\.plan_path/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*implement\.pre_sha/);
  });

  it("outputs include plan_files_touched as a number", () => {
    expect(md).toMatch(/outputs:[\s\S]*?plan_files_touched:\s*number/);
  });

  it("body has a Phase 0a — Plan-coverage candidate extraction step that reads plan_writer.plan_path", () => {
    expect(md).toMatch(/Phase 0a/);
    expect(md).toMatch(/\$plan_writer\.plan_path/);
    expect(md).toMatch(/\\\.\(ts\|md\|dot\|js\|json\)/);
  });

  it("body has a Phase 1c — Diff cross-reference step using implement.pre_sha", () => {
    expect(md).toMatch(/Phase 1c/);
    expect(md).toMatch(/git diff --name-only \$implement\.pre_sha HEAD/);
  });

  it("body emits plan_files_touched in the JSON and a Plan coverage line in test_render", () => {
    expect(md).toContain("plan_files_touched");
    expect(md).toMatch(/Plan coverage/);
  });

  it("test_result remains orthogonal — coverage zero does not flip pass to fail", () => {
    expect(md).toMatch(/orthogonal/);
  });
});
```

- [x] **Step 2.2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-tmux-tester-folder.test.ts`
Expected: 6 failing assertions.

- [x] **Step 2.3: Edit the frontmatter `inputs:` and `outputs:`**

In `.apparat/pipelines/illumination-to-implementation/tmux-tester.md`, replace lines 15–22 (the current `outputs:` then `inputs:` blocks):

```yaml
outputs:
  test_result: {enum: [pass, fail]}
  test_summary: string
  test_render: string
inputs:
  - project
  - run_id
```

with:

```yaml
outputs:
  test_result: {enum: [pass, fail]}
  test_summary: string
  test_render: string
  plan_files_touched: number
inputs:
  - project
  - run_id
  - plan_writer.plan_path
  - implement.pre_sha
```

- [x] **Step 2.4: Insert Phase 0a — Plan-coverage candidate extraction**

Currently Phase 0 is at line 164 (`## Phase 0 — Open (or reuse) the test window`). Add a new sub-section between the end of Phase 0's body (line 179, ends with the empty-`$SESSION` early-exit guidance) and the start of Phase 1 (line 181 `## Phase 1 — Automated verification`):

```markdown
## Phase 0a — Plan-coverage candidate extraction

Before any cycle starts, read `$plan_writer.plan_path` and extract every back-tick-quoted file reference matching the pattern:

```
\`[^\`]+\.(ts|md|dot|js|json)\`
```

Store the matches as the **candidate set** — a list of relative paths the plan claims to touch. Hold this set in working memory; you will diff against it in Phase 1c. If `$plan_writer.plan_path` is empty or unreadable, set the candidate set to `[]` and continue (Phase 1c will emit `plan_files_touched=0`, which the gate disambiguates).
```

- [x] **Step 2.5: Insert Phase 1c — Diff cross-reference**

Append a sub-section to the end of Phase 1 (Phase 1 currently ends at line 191 `If Phase 1 fails, you MAY skip Phases 2–3 …`). Insert after that line, before `## Phase 2 — Scenario pipelines`:

```markdown
## Phase 1c — Diff cross-reference

After Phase 1 settles (build + test cycle finished), run in `$project`:

```bash
git diff --name-only $implement.pre_sha HEAD
```

Count how many paths in the candidate set (Phase 0a) appear verbatim in the diff. Emit the count as `plan_files_touched` in the final JSON. Append a one-line "### Plan coverage" entry to `test_render`:

```markdown
### Plan coverage
plan_files_touched: <count>  (out of <candidate-set-size> candidate paths in plan_writer.plan_path)
```

`test_result` is **orthogonal** to plan coverage — a plan touching zero files but producing green build + green tests still reports `test_result=pass` AND `plan_files_touched=0`. The downstream `tmux_confirm_gate` weights the three signals together; the tester does not fail the build for low coverage.
```

- [x] **Step 2.6: Run the test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-tmux-tester-folder.test.ts`
Expected: 6 passing assertions.

- [x] **Step 2.7: Commit**

```bash
git add src/cli/tests/pipeline-illum-to-impl-tmux-tester-folder.test.ts \
        .apparat/pipelines/illumination-to-implementation/tmux-tester.md
git commit -m "feat(tmux-tester): add plan_files_touched signal sourced from plan_writer.plan_path and implement.pre_sha"
```

### Verification targets

- Smokes: `None` (engine-driven smoke is Chunk 5)
- Manual exercises: `None`
- Lint: `npx vitest run src/cli/tests/pipeline-illum-to-impl-tmux-tester-folder.test.ts` and `npx tsc --noEmit`
- Surfaces touched: `pipeline-spec` (illumination-to-implementation/tmux-tester.md), `deep-loop-handler-contract` (additive `outputs:` key + new `inputs:` keys consumed via prompt assembly)

---

## Chunk 3: `tmux_confirm_gate.md` — three-signal render

Extends gate `inputs:` with `implement.done`, `implement.reason`, `tmux_tester.test_result`, `tmux_tester.plan_files_touched`. Rewrites the body to render all three signals so the operator sees independent evidence at the gate.

**Files:**
- Test (new): `src/cli/tests/pipeline-illum-to-impl-tmux-confirm-gate-folder.test.ts`
- Modify: `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md`

### Steps

- [x] **Step 3.1: Write the failing content-shape test**

Create `src/cli/tests/pipeline-illum-to-impl-tmux-confirm-gate-folder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const GATE_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "tmux_confirm_gate.md",
);

describe(".apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md — three-signal render", () => {
  const md = readFileSync(GATE_MD, "utf-8");

  it("frontmatter inputs include implement.done, implement.reason, tmux_tester.test_result, tmux_tester.plan_files_touched", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*implement\.done/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*implement\.reason/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.test_result/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.plan_files_touched/);
  });

  it("frontmatter inputs still include run_id and tmux_tester.test_render", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*run_id/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.test_render/);
  });

  it("body interpolates all three signals in a Signals block", () => {
    expect(md).toMatch(/### Signals/);
    expect(md).toMatch(/\$implement\.done/);
    expect(md).toMatch(/\$implement\.reason/);
    expect(md).toMatch(/\$tmux_tester\.test_result/);
    expect(md).toMatch(/\$tmux_tester\.plan_files_touched/);
  });

  it("frontmatter retains type=gate and Commit/Retry choices", () => {
    expect(md).toMatch(/type:\s*gate/);
    expect(md).toMatch(/-\s*Commit/);
    expect(md).toMatch(/-\s*Retry/);
  });
});
```

- [x] **Step 3.2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-tmux-confirm-gate-folder.test.ts`
Expected: 4 failing assertions (Signals block, three new inputs, three signal interpolations).

- [x] **Step 3.3: Replace the entire `tmux_confirm_gate.md` content**

Overwrite `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md` with:

```markdown
---
type: gate
choices:
  - Commit
  - Retry
inputs:
  - run_id
  - implement.done
  - implement.reason
  - tmux_tester.test_result
  - tmux_tester.test_render
  - tmux_tester.plan_files_touched
---
Tests ran in tmux window test-$run_id.

### Signals
- implement.done: $implement.done   (reason: $implement.reason)
- tmux_tester.test_result: $tmux_tester.test_result
- tmux_tester.plan_files_touched: $tmux_tester.plan_files_touched

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
```

- [x] **Step 3.4: Run the test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-tmux-confirm-gate-folder.test.ts`
Expected: 4 passing assertions.

- [x] **Step 3.5: Validate the pipeline still parses**

Run: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot`
Expected: exits 0, no error-severity diagnostics. (The gate `inputs:` field is optional per `src/attractor/core/schemas.ts:61`, so additive entries are accepted.)

- [x] **Step 3.6: Commit**

```bash
git add src/cli/tests/pipeline-illum-to-impl-tmux-confirm-gate-folder.test.ts \
        .apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md
git commit -m "feat(tmux_confirm_gate): render implement.done, test_result, plan_files_touched as three-signal block"
```

### Verification targets

- Smokes: `None` (engine smoke is Chunk 5)
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` (exit 0, no errors)
- Lint: `npx vitest run src/cli/tests/pipeline-illum-to-impl-tmux-confirm-gate-folder.test.ts` and `npx tsc --noEmit`
- Surfaces touched: `pipeline-spec` (illumination-to-implementation/tmux_confirm_gate.md), `gate-render-contract` (`GateMdFrontmatterSchema.inputs` is optional — additive)

---

## Chunk 4: `memory-writer.md` — Warnings cross-check

Inserts Step 4a between Step 4 (compose memory) and Step 5 (commit). Step 4a scans `$tmux_tester.test_summary` for a four-substring no-op set and prepends a `## Warnings` section to the memory body so memory-reflector reads the gap pre-distilled.

**Files:**
- Test (new): `src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts`
- Modify: `.apparat/pipelines/illumination-to-implementation/memory-writer.md`

### Steps

- [ ] **Step 4.1: Write the failing content-shape test**

Create `src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const MEMORY_WRITER_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "memory-writer.md",
);

describe(".apparat/pipelines/illumination-to-implementation/memory-writer.md — Warnings cross-check", () => {
  const md = readFileSync(MEMORY_WRITER_MD, "utf-8");

  it("declares Step 4a between Step 4 and Step 5", () => {
    expect(md).toMatch(/4a\./);
    const idx4 = md.indexOf("4. **Write the memory file");
    const idx4a = md.indexOf("4a.");
    const idx5 = md.indexOf("5. **Commit any pending work");
    expect(idx4).toBeGreaterThan(-1);
    expect(idx4a).toBeGreaterThan(idx4);
    expect(idx5).toBeGreaterThan(idx4a);
  });

  it("Step 4a defines the four no-op substrings to scan", () => {
    expect(md).toContain("no in-scope diff");
    expect(md).toContain("nothing to verify");
    expect(md).toContain("implement node committed only");
    expect(md).toContain("no_diff_produced");
  });

  it("Step 4a scans tmux_tester.test_summary case-insensitively and prepends ## Warnings", () => {
    expect(md).toMatch(/\$tmux_tester\.test_summary/);
    expect(md).toMatch(/case-insensitive/i);
    expect(md).toMatch(/##\s*Warnings/);
  });

  it("Warnings section is prepended BEFORE ## What was implemented", () => {
    expect(md).toMatch(/before\s+`?##\s*What was implemented`?/i);
  });

  it("Step 7 pre-check on tmux_tester.test_result=fail is unchanged", () => {
    expect(md).toMatch(/tmux_tester_test_result.*"fail"/);
    expect(md).toMatch(/skip both 7a and 7b entirely/);
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts`
Expected: 4 failing assertions (Step 4a not present yet); the Step 7 pre-check assertion should pass already.

- [ ] **Step 4.3: Insert Step 4a in `memory-writer.md`**

In `.apparat/pipelines/illumination-to-implementation/memory-writer.md`, locate the end of Step 4 (currently lines 64–105 ends with the `Final verification` markdown subsection's closing `\`\`\``). Insert directly between the closing backtick fence of Step 4 (line 105) and the start of `5. **Commit any pending work.**` (line 107):

```markdown
4a. **Warnings cross-check (no-op detection on the success path).** Define the no-op substring set:

    ```
    no_op_substrings = [
      "no in-scope diff",
      "nothing to verify",
      "implement node committed only",
      "no_diff_produced",
    ]
    ```

    Scan `$tmux_tester.test_summary` case-insensitively for each substring. If any substring matches, prepend a `## Warnings` section to the memory body, before `## What was implemented`, with one bullet per matched substring quoting the surrounding sentence from `test_summary`. Memory-reflector reads `## Warnings` first; this is the channel for "this run looks like a no-op even though it landed."

    The Warnings section is **separate** from the optional `## Learnings from the run` section. Learnings is for retry-loop pattern mining; Warnings is for no-op-on-success collusion that the rest of the pipeline already resolved structurally. The Step 7 pre-check still suppresses `consume`/`consume_plan` on `tmux_tester.test_result=fail` — Step 4a runs on the **success path** too, exactly the case the original failure mode missed.
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts`
Expected: 5 passing assertions.

- [ ] **Step 4.5: Commit**

```bash
git add src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts \
        .apparat/pipelines/illumination-to-implementation/memory-writer.md
git commit -m "feat(memory-writer): prepend ## Warnings on no-op substring matches in tmux_tester.test_summary"
```

### Verification targets

- Smokes: `None`
- Manual exercises: `None`
- Lint: `npx vitest run src/cli/tests/pipeline-illum-to-impl-memory-writer-folder.test.ts` and `npx tsc --noEmit`
- Surfaces touched: `pipeline-spec` (illumination-to-implementation/memory-writer.md), `memory-writer-template` (Warnings is additive — does not touch existing Step 7 pre-check)

---

## Chunk 5: New no-op smoke — `pipeline-smoke-implement-noop-folder.test.ts`

Adds a content-shape smoke that verifies all four pipeline-spec edits **interlock** at the file level: `implement.md` emits `pre_sha` + `reason`, `tmux-tester.md` consumes `implement.pre_sha` and emits `plan_files_touched`, `tmux_confirm_gate.md` interpolates all three signals, and `memory-writer.md` Step 4a contains the no-op substring set.

**Why a content-shape smoke instead of an engine-driven smoke:** No `runPipelineForTest` helper exists in this repo (`Grep runPipelineForTest src/` → 0 hits). The existing `src/cli/tests/pipeline-smoke-*-folder.test.ts` files all use the content-shape pattern. An engine-driven smoke is left for §OQ1.

**Files:**
- Create: `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts`

### Steps

- [ ] **Step 5.1: Write the failing integration smoke**

Create `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const PIPELINE_DIR = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
);

const IMPLEMENT_MD = join(PIPELINE_DIR, "implement.md");
const TMUX_TESTER_MD = join(PIPELINE_DIR, "tmux-tester.md");
const GATE_MD = join(PIPELINE_DIR, "tmux_confirm_gate.md");
const MEMORY_WRITER_MD = join(PIPELINE_DIR, "memory-writer.md");

describe("pipeline-smoke: illumination-to-implementation no-op refusal interlock", () => {
  it("implement.md emits pre_sha and reason; tmux-tester.md consumes implement.pre_sha", () => {
    const implement = readFileSync(IMPLEMENT_MD, "utf-8");
    const tester = readFileSync(TMUX_TESTER_MD, "utf-8");
    expect(implement).toMatch(/outputs:[\s\S]*?pre_sha:\s*string/);
    expect(implement).toMatch(/outputs:[\s\S]*?reason:\s*\{enum:\s*\[no_diff_produced/);
    expect(tester).toMatch(/inputs:[\s\S]*?-\s*implement\.pre_sha/);
  });

  it("tmux-tester.md emits plan_files_touched; tmux_confirm_gate.md consumes it", () => {
    const tester = readFileSync(TMUX_TESTER_MD, "utf-8");
    const gate = readFileSync(GATE_MD, "utf-8");
    expect(tester).toMatch(/outputs:[\s\S]*?plan_files_touched:\s*number/);
    expect(gate).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.plan_files_touched/);
    expect(gate).toMatch(/\$tmux_tester\.plan_files_touched/);
  });

  it("tmux_confirm_gate.md renders all three orthogonal signals", () => {
    const gate = readFileSync(GATE_MD, "utf-8");
    expect(gate).toMatch(/\$implement\.done/);
    expect(gate).toMatch(/\$implement\.reason/);
    expect(gate).toMatch(/\$tmux_tester\.test_result/);
    expect(gate).toMatch(/\$tmux_tester\.plan_files_touched/);
  });

  it("memory-writer.md Step 4a scans test_summary for the four no-op substrings", () => {
    const memw = readFileSync(MEMORY_WRITER_MD, "utf-8");
    expect(memw).toMatch(/4a\./);
    expect(memw).toContain("no in-scope diff");
    expect(memw).toContain("nothing to verify");
    expect(memw).toContain("implement node committed only");
    expect(memw).toContain("no_diff_produced");
    expect(memw).toMatch(/##\s*Warnings/);
  });

  it("pipeline.dot routing between implement → review_gate → tmux_tester → tmux_confirm_gate → memory_writer is unchanged", () => {
    const dot = readFileSync(join(PIPELINE_DIR, "pipeline.dot"), "utf-8");
    expect(dot).toMatch(/implement\s*->\s*review_gate/);
    expect(dot).toMatch(/review_gate\s*->\s*tmux_tester\s*\[label="Tmux"\]/);
    expect(dot).toMatch(/tmux_tester\s*->\s*tmux_confirm_gate/);
    expect(dot).toMatch(/tmux_confirm_gate\s*->\s*memory_writer\s*\[label="Commit"\]/);
  });
});
```

- [ ] **Step 5.2: Run the smoke to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts`
Expected: 5 passing assertions. (The smoke runs LAST in the chunk sequence — chunks 1–4 ship the content this smoke asserts. If chunks 1–4 are all green, this smoke is also green.)

If any assertion fails, do NOT modify the smoke — fix the upstream chunk that ships the missing content. The smoke is the interlock check.

- [ ] **Step 5.3: Validate the pipeline parses end-to-end**

Run: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot`
Expected: exit 0, zero error-severity diagnostics.

- [ ] **Step 5.4: Run the full vitest suite to catch regressions**

Run: `npx vitest run`
Expected: all tests green. Pay special attention to any pre-existing scenario tests that touch the four edited files.

- [ ] **Step 5.5: Commit**

```bash
git add src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts
git commit -m "test(smoke): add interlock smoke for implement no-op refusal across pipeline-spec edits"
```

### Verification targets

- Smokes: `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts`
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` (exit 0)
- Lint: `npx vitest run` (full suite) and `npx tsc --noEmit`
- Surfaces touched: `pipeline-spec` (interlock across 4 specs + pipeline.dot), `scenario-tests` (new shape-test smoke)

---

## Chunk 6: README deep-loop section — document `pre_sha` and the no-op refusal contract

Inline edit to `README.md` lines 65–117 (the deep-loop section). Documents the new `pre_sha` output, the no-op refusal contract, and a one-paragraph explanation that the diff guard is **agent-driven** (not handler-side) so the deep-loop public contract is preserved.

**Files:**
- Test (new): `src/cli/tests/readme-deep-loop-pre-sha.test.ts`
- Modify: `README.md`

### Steps

- [ ] **Step 6.1: Locate the deep-loop section**

Run: `grep -n "deep" /Users/josu/Documents/projects/apparatus/README.md` to find the section heading. The design doc cites lines 65–117. Confirm the section exists and capture the exact heading text in this step's output before editing.

If the README does NOT have a deep-loop section at the cited lines (the README may have been edited since the design was written), expand this step: locate the section that documents `outputs: { done: boolean }` as the loop-break contract by `grep -n "done: boolean" README.md`. Edit that section instead. Surface the discrepancy in the commit body.

- [ ] **Step 6.2: Write the failing content-shape test**

Create `src/cli/tests/readme-deep-loop-pre-sha.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const README = join(REPO_ROOT, "README.md");

describe("README.md — deep-loop section documents pre_sha and no-op refusal", () => {
  const md = readFileSync(README, "utf-8");

  it("mentions pre_sha as a deep-loop output", () => {
    expect(md).toMatch(/pre_sha/);
  });

  it("mentions no_diff_produced as the no-op refusal reason", () => {
    expect(md).toContain("no_diff_produced");
  });

  it("clarifies the diff guard is agent-driven, not handler-side", () => {
    expect(md).toMatch(/agent-driven/i);
  });
});
```

- [ ] **Step 6.3: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/readme-deep-loop-pre-sha.test.ts`
Expected: 3 failing assertions.

- [ ] **Step 6.4: Edit `README.md` deep-loop section**

In the deep-loop section (located in Step 6.1), append a paragraph after the existing `outputs: { done: boolean }` documentation:

```markdown
### No-op refusal (added 2026-05-08)

In addition to `done: boolean`, agents that opt into the deep loop MAY emit `pre_sha: string` (captured via `git rev-parse HEAD` before any work) and `reason: {enum: [no_diff_produced, ""]}`. When an agent runs `git diff --stat $pre_sha HEAD` + `git status --porcelain` at exit and finds both empty AND the iteration claimed non-trivial work, the agent MUST emit `{ "done": false, "reason": "no_diff_produced", "pre_sha": "<sha>" }` so the looping handler re-invokes it with a fresh context. Without this guard, a planning-only run can mask as a real ship — green build + green tests on an unchanged tree trivially pass any downstream `tmux_tester` node.

The diff guard is **agent-driven**, not handler-side. The looping handler at `src/attractor/handlers/looping-agent-handler.ts:151` continues to trust the `done` field as-is. Forcing `done=false` from the handler would break the deep-loop public contract for every other agent that uses the looping handler. Keeping the policy in the agent prompt also keeps it readable and tweakable per pipeline (e.g. allow no-op for doc-only plans by editing the `.md`, not TypeScript).
```

- [ ] **Step 6.5: Run the test to verify it passes**

Run: `npx vitest run src/cli/tests/readme-deep-loop-pre-sha.test.ts`
Expected: 3 passing assertions.

- [ ] **Step 6.6: Run the full suite + tsc one more time**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite green, zero TypeScript errors.

- [ ] **Step 6.7: Commit**

```bash
git add src/cli/tests/readme-deep-loop-pre-sha.test.ts README.md
git commit -m "docs(readme): document pre_sha output and agent-driven no-op refusal in deep-loop section"
```

### Verification targets

- Smokes: `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` (re-run after README edit to confirm no regressions)
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` (exit 0)
- Lint: `npx vitest run` (full suite) and `npx tsc --noEmit`
- Surfaces touched: `docs` (README deep-loop section)

---

## Open Questions (carried from design doc §9, plus this plan's §OQ1)

- **§OQ1 — Engine-driven smoke vs. content-shape smoke.** This plan uses content-shape assertions because no `runPipelineForTest` helper exists in `src/cli/tests/`. A real engine-driven smoke that drives `apparat pipeline run` against a fixture project, stubs the implement agent to return `done=true` without touching files, and asserts the pipeline halts at `review_gate` with `implement.done=false reason=no_diff_produced` would be stronger evidence. That helper is a separate design (it would have to wire `engine.runPipeline` to a stub agent factory). Leave for a follow-up plan. The interlock smoke (Chunk 5) is sufficient evidence that the four file edits cohere; the live engine path is exercised every time a real `illumination-to-implementation` run executes, so post-merge real-world runs (memory-writer's session memory) catch regressions in the contract.
- **Handler-side `pre_sha` shape validator** (design §9 item 1). Default: skip — ship without. Revisit if a real run produces a malformed `pre_sha`.
- **New ADR?** (design §9 item 2). Default: no — change fits inside ADR-0003 + ADR-0012 precedents. Surface in the implementing session if the reviewer disagrees.
- **CONTEXT.md term `plan_files_touched`?** (design §9 item 3). Default: no — keep scoped to the pipeline frontmatter and gate body.
- **Diff-guard substring set configurability** (design §9 item 5). Default: ship the four-substring set inline in `memory-writer.md`; lift to config only if a third pipeline starts needing the same scan.
- **Plan with zero file mentions** (design §9 item 4). Mitigation lives in `tmux_confirm_gate`: the operator sees the three signals together and decides. The pipeline does not have to disambiguate at the gate; the operator does.

---

## Final Verification Checklist (run after Chunk 6 commits)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx vitest run` — passes, including all six new test files.
- [ ] `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` — exits 0, no error-severity diagnostics.
- [ ] Repo-wide grep invariants:
  - [ ] `.apparat/pipelines/illumination-to-implementation/implement.md` contains `pre_sha`, `no_diff_produced`, `Step 0c`.
  - [ ] `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` contains `plan_files_touched`, `implement.pre_sha`, `Phase 0a`, `Phase 1c`.
  - [ ] `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md` contains `$implement.done`, `$tmux_tester.plan_files_touched`, `### Signals`.
  - [ ] `.apparat/pipelines/illumination-to-implementation/memory-writer.md` contains `## Warnings`, `no_op_substrings`, `4a.`.
  - [ ] `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` exists and passes.
- [ ] Loop-break check at `src/attractor/handlers/looping-agent-handler.ts:151` is byte-identical to pre-change (no handler edit in this plan).
- [ ] `commit_push`, `review_gate`, `memory_reflector`, `verifier`, `explainer`, `chat_session`, `chat_summarizer`, `design_writer`, `plan_writer`, `pipeline.dot` — all unchanged.
