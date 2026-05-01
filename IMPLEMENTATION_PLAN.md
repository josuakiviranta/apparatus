---
status: complete
---

# Source-as-Truth — Excise `docs/specs/` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the hand-authored `docs/specs/` behavioral-specs folder, replace `$specs_dir` reads in pipeline agents with a discover-then-read orientation, and consolidate decision rationale into ADRs — so source code, `CONTEXT.md`, and `docs/adr/` become the only authoritative documentation.

**Architecture:** Two parallel transformations. (1) **Decision capture:** salvage non-derivable WHY content from the 11 spec files into ADRs before deletion. (2) **Pattern excision:** every `$specs_dir` reference across four pipelines (`pipelines/illumination-to-implementation/`, `src/cli/pipelines/{implement,meditate,janitor}/`) and two CLI commands (`src/cli/commands/{implement,meditate}.ts`) is removed; affected agents adopt a shared discover-then-read orientation block (Glob source/docs roots → read CONTEXT.md + ADRs + README + live source inventory). Test contracts asserting the old pattern are deleted or rewritten.

**Tech Stack:** TypeScript, vitest, tsup, ts-graphviz/ast pipeline parser. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`

---

## File Structure

### New files

- `docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md` — ADR capturing this decision
- `docs/adr/0005-NN-…` (zero or more) — ADRs salvaged from `docs/specs/`

### Modified files

**Pipeline definitions:**
- `pipelines/illumination-to-implementation/pipeline.dot`
- `src/cli/pipelines/implement/pipeline.dot`
- `src/cli/pipelines/meditate/pipeline.dot`
- `src/cli/pipelines/janitor/pipeline.dot`

**Pipeline agent prompts:**
- `pipelines/illumination-to-implementation/{design-writer,plan-writer,verifier,implement}.md`
- `src/cli/pipelines/implement/{implement,scenario-author}.md`
- `src/cli/pipelines/meditate/meditate.md`

**CLI command code:**
- `src/cli/commands/implement.ts`
- `src/cli/commands/meditate.ts`

**Tests:**
- `src/cli/tests/implement.test.ts`
- `src/cli/tests/meditate.test.ts`
- `src/cli/tests/implement-rubric.test.ts`
- `src/cli/tests/pipeline-implement-folder.test.ts`
- `src/cli/tests/pipeline.test.ts`
- `src/attractor/tests/illumination-pipeline-flow.test.ts`

**Repo content:**
- `README.md` (lines 60, 158–170, 183–185)
- `CONTEXT.md` (append "Documentation channels" section)

### Deleted files / folders

- `docs/specs/` — entire folder removed
- `docs/orientation/directory-inventory.md` — folder if empty

### Reusable shared text

The discover-then-read orientation block (referenced by §3.2 of the spec) appears verbatim in four agent files. Use this exact text when the plan says "insert orientation block":

```markdown
**Orient before acting.** First, discover the project layout:

- Source root: Glob `$project` for `src/`, `lib/`, `app/`, `pkg/`, `cmd/`, `internal/` — pick directories that exist.
- Docs root: Glob `$project` for `docs/`, `documentation/`, `architecture/` — pick what exists.
- ADR location: under the discovered docs root, look for `adr/` or `decisions/`.

Then dispatch parallel Sonnet subagents (up to 100) to read concurrently:

- `$project/CONTEXT.md` if present (domain language)
- All files in the discovered ADR location, if any
- `$project/README.md` (mission + command surface)
- File inventory of each discovered source root — one subagent per top-level subdir, returns file list + one-paragraph role summary
- Output of `git log --since="2 weeks ago" --oneline` from `$project`

Each subagent returns a brief summary of its slice. For code-level facts during work, Grep/Glob the discovered source roots on demand.
```

---

## Chunk 1: Decision capture (ADR foundation + salvage pass)

**Goal:** Lock the high-level decision into an ADR and salvage any non-derivable WHY content from `docs/specs/` into supplementary ADRs **before** any deletion. This chunk produces 1 to (1+N) new ADR files and zero code changes.

### Task 1.1: Write ADR 0004 (foundational decision)

**Files:**
- Create: `docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md`

- [x] **Step 1: Write the ADR file**

Use this exact content:

```markdown
# 0004: Source code, CONTEXT.md, and ADRs are the only authoritative documentation

**Date:** 2026-05-01
**Status:** Accepted

## Context

ralph-cli accumulated a third documentation channel — `docs/specs/` — alongside the glossary (`CONTEXT.md`) and decision records (`docs/adr/`). It held 11 hand-authored behavioral specs (`architecture.md`, `commands.md`, `pipeline.md`, `daemon.md`, `loop.md`, `heartbeat.md`, `meditate.md`, `mcp-illumination.md`, `memory-reflector.md`, `stream-formatter.md`, `README.md`) plus auto-generated design docs from the illumination-to-implementation pipeline.

A 2026-05-01 audit found 3 of 11 files heavily DRIFTED (claims contradicted by `src/`), 1 DEAD (described a removed feature), and 5 nominally CURRENT but with no mechanism preventing future drift. Recent illuminations (`2026-05-01T0820-pipeline-spec-drift-poisons-agents.md`, `2026-05-01T0343-agent-orientation-docs-point-to-ghost-paths.md`) named spec drift as a hazard for any agent reading these files for project context.

Pipeline agents — `verifier.md`, `implement.md`, `meditate.md`, `scenario-author.md` — preloaded `$specs_dir/*` to learn the project, then made decisions against an outdated mental model. The drift was not a maintenance problem; it was a structural one. Any document that summarizes structure or behavior is a future lie.

## Decision

The only authoritative documentation in this repo is:

1. **`CONTEXT.md`** — domain language and glossary. Hand-curated. Updated during grill-with-docs sessions and ADR writes.
2. **`docs/adr/`** — append-only decision records. Each captures a hard-to-reverse, surprising-without-context choice with its trade-off. Never edited after acceptance.
3. **Source code** in `src/` and `pipelines/` — the truth about behavior. No spec file claims to mirror it.

`docs/specs/` is deleted. Any non-derivable WHY content from its 11 files is salvaged into supplementary ADRs before deletion.

Pipeline agents that need workspace orientation discover the project layout at runtime (Glob source/docs roots) and read `CONTEXT.md` + `docs/adr/` + `README.md` + a live source inventory. No preloaded curated overview. Instructions are positively phrased — substitution, not prohibition.

The `docs/specs/architecture.md`-style overview is replaced by step-0a-style discovery in two agents (`verifier.md`, `implement.md`) and equivalent rubric updates in three more (`scenario-author.md`, `meditate.md`).

The `$specs_dir` pipeline variable is removed from all four pipelines (`pipelines/illumination-to-implementation/`, `src/cli/pipelines/{implement,meditate,janitor}/`) and both CLI commands that plumb it (`src/cli/commands/{implement,meditate}.ts`).

Auto-generated design docs from the illumination-to-implementation pipeline now land in `docs/superpowers/specs/` (a previously-intended-but-unbuilt folder), not `docs/specs/`. Plans continue to land in `docs/superpowers/plans/`. Both write paths are pipeline-owned conventions hardcoded inside agent files.

## Consequences

**Positive:**
- Drift surface eliminated. Source code, the one thing always true, becomes the read target for behavior questions.
- Pipeline call sites simplify to `ralph pipeline run <dot> --project .` with no `--var` flags.
- Pipeline portability across target projects with different source layouts (`src/`, `lib/`, `app/`, `pkg/`, etc.) via runtime discovery.
- Onboarding signal sharper: README points at four entry points (`CONTEXT.md`, `docs/adr/`, `src/`, `pipelines/`) with stable locations.

**Negative:**
- New contributors landing from GitHub get less hand-holding. Mitigated by README's "Where to look" pointer list.
- Pipeline less portable to projects that do not adopt the (`meditations/illuminations/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`) write convention — they would need to edit agent `.md` files.
- Salvage pass may miss decisions buried in long passages. Mitigated by liberal candidate-surfacing during salvage and `git log` archaeology if anything is later needed.

## Related

- Spec: `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`
- ADR-0001 (`agents-live-next-to-pipeline`) — same principle: kill abstraction surfaces that drift.
- ADR-0002 (`consume-only-illumination-lifecycle`) — same shape: collapse multi-state taxonomies into one source of truth.
- Recent illuminations naming spec drift: `meditations/illuminations/2026-05-01T0820-pipeline-spec-drift-poisons-agents.md`, `meditations/illuminations/2026-05-01T0343-agent-orientation-docs-point-to-ghost-paths.md`, `meditations/illuminations/2026-05-01T0050-pipeline-location-drift-vs-vision.md`.
```

- [x] **Step 2: Verify ADR file written correctly**

Run: `ls -la docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md && head -5 docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md`

Expected: file exists, first line is `# 0004: Source code, CONTEXT.md, and ADRs are the only authoritative documentation`.

- [x] **Step 3: Commit**

```bash
git add docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md
git commit -m "$(cat <<'EOF'
docs(adr): 0004 — source code + CONTEXT.md + ADRs as only truth

Captures the decision to delete docs/specs/ and adopt discover-then-read
orientation in pipeline agents. References the design spec at
docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Salvage pass over `docs/specs/`

**Files:**
- Read-only: every file in `docs/specs/`
- Output (intermediate): consolidated candidate list (in working memory or a scratch file)

- [x] **Step 1: Dispatch 11 salvage subagents in parallel**

Use the Agent tool with `subagent_type=Explore` (or `general-purpose`). Send all 11 dispatches in a single message for parallel execution. One subagent per file:

- `docs/specs/architecture.md`
- `docs/specs/commands.md`
- `docs/specs/daemon.md`
- `docs/specs/heartbeat.md`
- `docs/specs/loop.md`
- `docs/specs/mcp-illumination.md`
- `docs/specs/meditate.md`
- `docs/specs/memory-reflector.md`
- `docs/specs/pipeline.md`
- `docs/specs/README.md`
- `docs/specs/stream-formatter.md`

For each, send this prompt template (replace `<SPEC_PATH>`):

```
Salvage pass on a behavioral spec file slated for deletion.

**Spec file:** <SPEC_PATH>

**Task:** Read the file in full, then verify each non-trivial claim against the current source code by Grep/Read in `src/` (and `pipelines/`, `src/cli/pipelines/` as relevant). Return three things:

1. **Validity verdict:** CURRENT (matches source today) / DRIFTED (one or more claims contradict source — pin examples) / DEAD (describes removed feature). Pin every drift claim with `file:line` evidence in BOTH the spec AND source.

2. **ADR candidates:** verbatim quotes from the spec that meet ALL THREE criteria:
   - Hard to reverse — describes a choice whose change would be costly later
   - Surprising without context — a future reader would wonder "why did they do it this way?"
   - Result of a real trade-off — there were genuine alternatives picked for specific reasons

   Be liberal. When in doubt, surface as a candidate; the human triages.

3. **Confidence note** if your verdict is ambiguous (e.g. partial match, or unverifiable claims).

**Output format (markdown):**

## Salvage Report: <SPEC_PATH>

### Validity verdict
**Status:** CURRENT / DRIFTED / DEAD

**Evidence:**
- [If DRIFTED or DEAD] spec line N claims X; src/path/to/file.ts:M shows Y
- [Continue with all observed mismatches]

### ADR candidates

**Candidate 1:** [title]
> [verbatim quote from spec, ≤10 lines]
**Why ADR-worthy:** [one sentence — which of the three criteria + why]

**Candidate 2:** ...

(Or "None" if nothing meets the criteria.)

### Confidence note
[If applicable, e.g. "Couldn't verify claims about the daemon socket protocol without runtime observation; treated as CURRENT pending dynamic check."]
```

- [x] **Step 2: Consolidate the 11 reports**

Collect all 11 returned reports. Present a single triage table to the user with one row per ADR candidate across all 11 reports:

| File | Candidate | Quote (truncated) | ADR-worthy? (user picks) |
|---|---|---|---|

This is a **user-input checkpoint**. The plan executor must surface the table and wait for user triage decisions.

- [x] **Step 3: User triage**

User inspects the table and marks each candidate Y / N. Optionally edits the proposed candidate text before approval.

### Task 1.3: Write salvaged ADRs (one per approved candidate)

**Files (zero or more):**
- Create: `docs/adr/0005-<slug>.md`, `0006-<slug>.md`, ... (one per approved candidate)

- [x] **Step 1: For each user-approved candidate, write a new ADR file**

Use the existing `docs/adr/0001-…` and `0002-…` files as format references. Each ADR should have:

```markdown
# 000N: <slug-as-title>

**Date:** 2026-05-01
**Status:** Accepted (salvaged from docs/specs/<file>.md before deletion)

## Context

[Verbatim quote from the spec, plus minimum context needed for a future reader to understand the choice. The salvage pass preserved this passage because it captures decision rationale that source code does not express.]

## Decision

[The choice itself, restated cleanly.]

## Consequences

[The trade-off accepted, restated cleanly. If the spec didn't explicitly note consequences, infer them from the surrounding context — but flag with "Inferred:" if doing so.]

## Related

- Salvaged from `docs/specs/<file>.md` on 2026-05-01 during the source-as-truth excision
- See ADR-0004 for the broader excision rationale
- Spec: `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`
```

- [x] **Step 2: Verify each new ADR file**

Run: `ls -la docs/adr/000*-*.md`

Expected: ADR-0004 plus zero or more ADR-0005..N files.

- [x] **Step 3: Commit (one commit per ADR, or one batched commit if convenient)**

```bash
git add docs/adr/000*-*.md
git commit -m "$(cat <<'EOF'
docs(adr): salvage decision context from docs/specs/ before deletion

Each new ADR captures a hard-to-reverse, surprising-without-context choice
that was buried in the soon-to-be-deleted docs/specs/*.md files. Source-only
documentation cannot express these decisions; ADRs preserve them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If zero candidates were approved (all 11 files yielded only WHAT content, no salvage-worthy WHY), skip step 1–3 and note "No ADRs salvaged" in the commit log of Chunk 5.

### Verification targets (Chunk 1)

- Smokes: None
- Manual exercises: `git log --oneline docs/adr/` — confirm one or more new ADR commits since this chunk started
- Lint: None (no code changes)
- Surfaces touched: documentation/decision-records

---

## Chunk 2: illumination-to-implementation pipeline

**Goal:** Excise `$specs_dir` from the project-local pipeline at `pipelines/illumination-to-implementation/` and rewire its agents to use discover-then-read orientation + hardcoded write paths.

This chunk has no unit tests; verification is via the pipeline validator and a final smoke run. Edits are bundled into one atomic commit per logical unit.

### Task 2.1: Edit `pipeline.dot` (declared inputs)

**Files:**
- Modify: `pipelines/illumination-to-implementation/pipeline.dot:4`

- [x] **Step 1: Open the file and locate line 4**

Current: `  inputs="project, illuminations_dir, specs_dir, plans_dir, run_id"`

- [x] **Step 2: Replace line 4**

Replace with: `  inputs="project"`

Use the Edit tool with `old_string=  inputs="project, illuminations_dir, specs_dir, plans_dir, run_id"` and `new_string=  inputs="project"`.

- [x] **Step 3: Validate the pipeline**

Run: `npx tsx src/cli/index.ts pipeline validate pipelines/illumination-to-implementation/pipeline.dot`

Expected: validator returns OK, OR returns errors about agents that still reference `$specs_dir` / `$illuminations_dir` / `$plans_dir` (those will be fixed in Tasks 2.2–2.5; the validator's complaint is informational at this point).

### Task 2.2: Edit `design-writer.md` (hardcode write target)

**Files:**
- Modify: `pipelines/illumination-to-implementation/design-writer.md`

- [x] **Step 1: Update frontmatter `inputs:` list**

Use the Edit tool. Find the block:

```yaml
inputs:
  - verifier.illumination_path
  - specs_dir
  - verifier.summary
  - verifier.explanation
  - explainer.explainer_render
  - chat_summarizer.refinements
```

Replace with (drop the `specs_dir` line):

```yaml
inputs:
  - verifier.illumination_path
  - verifier.summary
  - verifier.explanation
  - explainer.explainer_render
  - chat_summarizer.refinements
```

- [x] **Step 2: Replace the Mission paragraph**

Find: `You turn an approved illumination — already refined and explained — into a superpowers-style design doc at \`$specs_dir/\`.`

Replace with: `You turn an approved illumination — already refined and explained — into a superpowers-style design doc at \`docs/superpowers/specs/\` inside \`$project\`.`

- [x] **Step 3: Delete the "Inputs you will receive" entry for `$specs_dir`**

Use the Edit tool with `old_string="- \`$specs_dir\` — output directory for the design doc.\n"` and `new_string=""` to remove the bullet entirely.

- [x] **Step 4: Replace the "Procedure" step 1 path derivation**

Find:
```
   - Target path: `$specs_dir/YYYY-MM-DD-<slug>-design.md` using today's date.
   - Example: illumination `2026-04-19T1100-gate-choice-namespacing.md` → design doc `$specs_dir/2026-04-19-gate-choice-namespacing-design.md`.
```

Replace with:
```
   - Target path: `$project/docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` using today's date.
   - Example: illumination `2026-04-19T1100-gate-choice-namespacing.md` → design doc `$project/docs/superpowers/specs/2026-04-19-gate-choice-namespacing-design.md`.
```

- [x] **Step 5: Replace the "Procedure" step 4 reference**

Find: `Scan a couple of existing design docs in \`$specs_dir/\` first to match local conventions.`

Replace with: `Scan a couple of existing design docs in \`$project/docs/superpowers/specs/\` first to match local conventions.`

- [x] **Step 6: Verify zero `$specs_dir` references remain**

Run: `grep -n 'specs_dir\|\$specs_dir' pipelines/illumination-to-implementation/design-writer.md`

Expected: no output (zero hits).

### Task 2.3: Edit `plan-writer.md` (hardcode write target)

**Files:**
- Modify: `pipelines/illumination-to-implementation/plan-writer.md`

- [x] **Step 1: Update frontmatter `inputs:` list**

Find:
```yaml
inputs:
  - verifier.illumination_path
  - plans_dir
  - design_writer.design_doc_path
  - chat_summarizer.refinements
```

Replace with (drop the `plans_dir` line):
```yaml
inputs:
  - verifier.illumination_path
  - design_writer.design_doc_path
  - chat_summarizer.refinements
```

- [x] **Step 2: Replace the Mission paragraph**

Find: `You turn an approved design doc into a chunked, TDD-shaped implementation plan at \`$plans_dir/\`.`

Replace with: `You turn an approved design doc into a chunked, TDD-shaped implementation plan at \`docs/superpowers/plans/\` inside \`$project\`.`

- [x] **Step 3: Delete "Inputs you will receive" entry**

Use the Edit tool with `old_string="- \`$plans_dir\` — output directory for the plan.\n"` and `new_string=""` to remove the bullet entirely.

- [x] **Step 4: Replace "Procedure" step 1 path derivation**

Find:
```
   - Target path: `$plans_dir/YYYY-MM-DD-<slug>.md` using today's date.
   - Example: illumination `2026-04-19T1100-gate-choice-namespacing.md` → plan `$plans_dir/2026-04-19-gate-choice-namespacing.md`.
```

Replace with:
```
   - Target path: `$project/docs/superpowers/plans/YYYY-MM-DD-<slug>.md` using today's date.
   - Example: illumination `2026-04-19T1100-gate-choice-namespacing.md` → plan `$project/docs/superpowers/plans/2026-04-19-gate-choice-namespacing.md`.
```

- [x] **Step 5: Verify zero `$plans_dir` references remain**

Run: `grep -n 'plans_dir\|\$plans_dir' pipelines/illumination-to-implementation/plan-writer.md`

Expected: no output.

### Task 2.4: Edit `verifier.md` (orient via discover-then-read)

**Files:**
- Modify: `pipelines/illumination-to-implementation/verifier.md`

- [x] **Step 1: Locate the Project-fit (Feature-Creep lens) section**

The current text at line 47 reads:

```
3. **Project-fit (Feature-Creep lens)** — the change serves the project's stated goals. Read `README.md` and `$specs_dir/architecture.md` (or equivalents) before judging. If `$specs_dir` is empty in the Inputs block, default to `docs/specs`. Reject if the illumination:
```

- [x] **Step 2: Replace the project-fit instruction**

Use the Edit tool. Replace the sentence "Read `README.md` and `$specs_dir/architecture.md` (or equivalents) before judging. If `$specs_dir` is empty in the Inputs block, default to `docs/specs`." with the orientation block from "File Structure → Reusable shared text" above (the block beginning "**Orient before acting.**" through the closing paragraph).

The replacement integrates as: `the change serves the project's stated goals. <ORIENTATION_BLOCK> Use the discovered context to judge whether the change advances the project's goals. Reject if the illumination:`.

- [x] **Step 3: Replace the procedure step at line 66**

Find: `   - **Project-fit pass:** read project \`README.md\` and any \`$specs_dir/architecture.md\` / top-level spec; judge whether the illumination's change advances stated goals.`

Replace with: `   - **Project-fit pass:** apply the orientation block (see step 2 above); judge whether the illumination's change advances the project's stated goals based on the discovered context.`

- [x] **Step 4: Verify zero `$specs_dir` references remain**

Run: `grep -n 'specs_dir\|\$specs_dir' pipelines/illumination-to-implementation/verifier.md`

Expected: no output.

### Task 2.5: Edit `implement.md` (orient via discover-then-read, drop fan-out)

**Files:**
- Modify: `pipelines/illumination-to-implementation/implement.md`

- [x] **Step 1: Replace step 0a**

Find the line at line 16:
```
0a. Study `$specs_dir/*` with up to 500 parallel Sonnet subagents to learn the application specifications. If `$specs_dir` is empty in the Inputs block, default to `docs/specs`.
```

Replace with the orientation block prefixed with `0a. ` (i.e., insert the shared block — see "File Structure → Reusable shared text" — as the body of step 0a).

- [x] **Step 2: Delete the inconsistency-update step**

Find the line at line 37:
```
9999999999999. If you find inconsistencies in the $specs_dir/\* then use an Opus 4.5 subagent with 'ultrathink' requested to update the specs.
```

Delete this line entirely (no replacement). There is no `$specs_dir` to compare against anymore; spec inconsistencies are no longer a category.

- [x] **Step 3: Verify zero `$specs_dir` references remain**

Run: `grep -n 'specs_dir\|\$specs_dir' pipelines/illumination-to-implementation/implement.md`

Expected: no output.

### Task 2.6: Verify ancillary files have no residue

**Files:**
- Read-only: every file under `pipelines/illumination-to-implementation/`

- [x] **Step 1: Grep entire pipeline directory for residual references**

Run:
```bash
grep -rn 'specs_dir\|\$specs_dir' pipelines/illumination-to-implementation/
```

Expected: no output (zero hits across all files in the folder). If found, add an Edit step to remove them before Task 2.7.

### Task 2.7: Validate + commit

- [x] **Step 1: Run pipeline validator**

Run: `npx tsx src/cli/index.ts pipeline validate pipelines/illumination-to-implementation/pipeline.dot`

Expected: OK (no `inputs_undeclared` errors; the pipeline now declares only `project` and the agent rubrics no longer reference `$specs_dir`/`$plans_dir`/`$illuminations_dir`/`$run_id`).

- [x] **Step 2: Type check**

Run: `npx tsc --noEmit`

Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add pipelines/illumination-to-implementation/
git commit -m "$(cat <<'EOF'
refactor(illumination-pipeline): drop \$specs_dir, hardcode write paths

- pipeline.dot inputs collapse to "project" only
- design-writer hardcodes docs/superpowers/specs/ as write target
- plan-writer hardcodes docs/superpowers/plans/ as write target
- verifier + implement adopt discover-then-read orientation block
  (Glob source/docs roots → read CONTEXT.md + ADRs + README + live src/ inventory)
- implement drops the 500-subagent \$specs_dir/* fan-out

Per ADR-0004. See docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Verification targets (Chunk 2)

- Smokes: None directly; affected at Chunk 5 final smoke
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate pipelines/illumination-to-implementation/pipeline.dot`
- Lint: `npx tsc --noEmit`
- Surfaces touched: project-local pipeline `illumination-to-implementation`

---

## Chunk 3: Bundled implement pipeline

**Goal:** Excise `$specs_dir` from the bundled implement pipeline (`src/cli/pipelines/implement/`) and rewrite the rubric tests to assert the new shape.

### Task 3.1: Rewrite `implement-rubric.test.ts` (failing tests first)

**Files:**
- Modify: `src/cli/tests/implement-rubric.test.ts`

- [x] **Step 1: Replace the entire file content**

Use the Write tool to replace `src/cli/tests/implement-rubric.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const agentPath = join(__dirname, "..", "pipelines", "implement", "implement.md");

describe("implement template agent prompt body — discover-then-read orientation", () => {
  it("contains the source-root discovery glob", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    // Body must Glob common source roots, not preload a specs dir
    expect(body).toMatch(/src\/.*lib\/.*app\/.*pkg\/.*cmd\/.*internal\//s);
  });

  it("references CONTEXT.md and docs/adr/ for orientation", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const body = agentMd.slice(agentMd.match(/^---\n[\s\S]+?\n---\n/)![0].length);

    expect(body).toMatch(/CONTEXT\.md/);
    expect(body).toMatch(/docs\/adr/);
  });

  it("contains zero literal $specs_dir references", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const body = agentMd.slice(agentMd.match(/^---\n[\s\S]+?\n---\n/)![0].length);

    expect(body).not.toMatch(/\$specs_dir/);
    expect(body).not.toMatch(/specs_dir/);
  });
});

describe("implement template agent frontmatter — inputs declaration", () => {
  it("does NOT declare specs_dir as a frontmatter input", () => {
    const agentMd = readFileSync(agentPath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n([\s\S]+?)\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const fm = frontmatterMatch![1];

    expect(fm).not.toMatch(/^\s*-\s+specs_dir\s*$/m);
  });
});
```

- [x] **Step 2: Run the test — expect FAIL**

Run: `npx vitest run src/cli/tests/implement-rubric.test.ts`

Expected: tests FAIL because `src/cli/pipelines/implement/implement.md` still has `$specs_dir` references and `- specs_dir` in frontmatter inputs.

### Task 3.2: Edit `src/cli/pipelines/implement/implement.md`

**Files:**
- Modify: `src/cli/pipelines/implement/implement.md`

- [x] **Step 1: Update frontmatter `inputs:` list**

Use Edit:
- `old_string`: `inputs:\n  - specs_dir\n`
- `new_string`: `inputs: []\n`

(The `outputs:` line on line 11 remains untouched.)

- [x] **Step 2: Replace step 0a**

Use Edit:
- `old_string`: ``0a. Study `$specs_dir/*` with up to 500 parallel Sonnet subagents to learn the application specifications. If `$specs_dir` is empty in the Inputs block, default to `docs/specs`.``
- `new_string`: `0a. ` followed by the orientation block from "File Structure → Reusable shared text" (the entire block, kept on multiple lines, beginning with `**Orient before acting.**`).

- [x] **Step 3: Delete step 9999999999999**

Use Edit:
- `old_string`: ``9999999999999. If you find inconsistencies in the $specs_dir/\* then use an Opus 4.5 subagent with 'ultrathink' requested to update the specs.\n``
- `new_string`: empty string

(Removes the inconsistency-update step and its trailing newline so subsequent line numbering stays clean.)

- [x] **Step 4: Verify zero residue**

Run: `grep -n 'specs_dir\|\$specs_dir' src/cli/pipelines/implement/implement.md`

Expected: no output.

### Task 3.3: Edit `src/cli/pipelines/implement/scenario-author.md`

**Files:**
- Modify: `src/cli/pipelines/implement/scenario-author.md`

- [x] **Step 1: Update frontmatter `inputs:` list**

Use Edit:
- `old_string`: `  - specs_dir\n`
- `new_string`: `` (empty)

(The `inputs:` block has multiple entries — `scenarios_dir`, `record_base.sha`, etc. — so only the `specs_dir` line is removed; the block stays non-empty.)

- [x] **Step 2: Replace the body reference at line 97**

Use Edit:
- `old_string`: ``- If `$specs_dir` documents the behavior under test, use the spec wording as the source of truth — don't invent new vocabulary.``
- `new_string`: ``- Ground vocabulary in `$project/CONTEXT.md`, `$project/README.md`, and the discovered source code. Use the project's own terminology, not invented synonyms.``

- [x] **Step 3: Verify zero residue**

Run: `grep -n 'specs_dir\|\$specs_dir' src/cli/pipelines/implement/scenario-author.md`

Expected: no output.

### Task 3.4: Edit `src/cli/pipelines/implement/pipeline.dot`

**Files:**
- Modify: `src/cli/pipelines/implement/pipeline.dot:3`

- [x] **Step 1: Update inputs declaration**

Use Edit:
- `old_string`: `  inputs="specs_dir,max_iterations,llm_model,scenarios_dir"`
- `new_string`: `  inputs="max_iterations,llm_model,scenarios_dir"`

- [x] **Step 2: Confirm exact landed value**

Run: `grep -n 'inputs=' src/cli/pipelines/implement/pipeline.dot`

Expected output (line 3): `  inputs="max_iterations,llm_model,scenarios_dir"` — Chunk 5 Task 5.2 will assert this verbatim.

- [x] **Step 3: Validate**

Run: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/implement/pipeline.dot`

Expected: OK.

### Task 3.5: Run rubric tests + commit

- [x] **Step 1: Run the rubric tests — expect PASS**

Run: `npx vitest run src/cli/tests/implement-rubric.test.ts`

Expected: PASS.

- [x] **Step 2: Run full vitest to surface other regressions**

Run: `npx vitest run --reporter=default`

Expected: rubric test passes; `implement.test.ts` may now FAIL (CLI command still passes `specs_dir`); `pipeline-implement-folder.test.ts` may FAIL. Those are addressed in Chunk 4–5. Note the failures and proceed.

- [x] **Step 3: Commit**

```bash
git add src/cli/pipelines/implement/ src/cli/tests/implement-rubric.test.ts
git commit -m "$(cat <<'EOF'
refactor(implement-pipeline): drop \$specs_dir, adopt discover-then-read

- pipeline.dot drops specs_dir from inputs
- implement.md replaces step 0a (\$specs_dir/* fan-out) with discover-then-read
- scenario-author.md grounds vocabulary in CONTEXT.md + README + source
- implement-rubric.test.ts asserts new orientation shape (no \$specs_dir)

Per ADR-0004.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Verification targets (Chunk 3)

- Smokes: None
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/implement/pipeline.dot`
- Lint: `npx vitest run src/cli/tests/implement-rubric.test.ts`
- Surfaces touched: bundled `implement` pipeline (TypeScript + agent rubric)

---

## Chunk 4: Bundled meditate + janitor pipelines + CLI commands + their tests

**Goal:** Excise `$specs_dir` from the bundled meditate pipeline, the bundled janitor pipeline, and both CLI commands (`implement.ts`, `meditate.ts`). Rewrite affected tests in lockstep.

### Task 4.1: Rewrite meditate rubric tests (failing first)

**Files:**
- Modify: `src/cli/tests/meditate.test.ts:267–288` (the two `specs_dir`-related test cases)

- [x] **Step 1: Locate the two target test cases by name**

Use the Read tool on `src/cli/tests/meditate.test.ts`. Confirm the two test cases the next step rewrites:
- `"passes specs_dir default of docs/specs to pipeline runtime"` — currently at lines 267–275
- `"exploration step weights $specs_dir and src/ folders"` — currently at lines 279–291

- [x] **Step 2: Replace the two test cases (preserving existing mocking style — `vi.spyOn` on `pipelineMod`)**

The existing test scaffold (lines 250–276 of `meditate.test.ts`) uses `vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(...)` and calls `await meditateCommand(tmpDir)` (no DI third arg). The replacements below preserve that pattern exactly.

For the first case, use Edit:
- `old_string`:
  ```typescript
    it("passes specs_dir default of docs/specs to pipeline runtime", async () => {
      const calls: Array<{ dotFile: string; opts: any }> = [];
      vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
        calls.push({ dotFile, opts });
      });
      await meditateCommand(tmpDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].opts.variables.specs_dir).toBe("docs/specs");
    });
  ```
- `new_string`:
  ```typescript
    it("does NOT pass specs_dir to pipeline runtime", async () => {
      const calls: Array<{ dotFile: string; opts: any }> = [];
      vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(async (dotFile, opts) => {
        calls.push({ dotFile, opts });
      });
      await meditateCommand(tmpDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].opts.variables).not.toHaveProperty("specs_dir");
    });
  ```

For the second case, use Edit:
- `old_string`:
  ```typescript
    it("exploration step weights $specs_dir and src/ folders", () => {
      const agentMd = readFileSync(
        join(__dirname, "..", "pipelines", "meditate", "meditate.md"),
        "utf-8",
      );
      const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
      expect(frontmatterMatch).not.toBeNull();
      const body = agentMd.slice(frontmatterMatch![0].length);

      expect(body).toMatch(/\$specs_dir/);
      expect(body).toContain("src/");
      expect(body.toLowerCase()).toContain("weighted focus");
    });
  ```
- `new_string`:
  ```typescript
    it("exploration step uses discover-then-read orientation, not $specs_dir", () => {
      const agentMd = readFileSync(
        join(__dirname, "..", "pipelines", "meditate", "meditate.md"),
        "utf-8",
      );
      const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
      expect(frontmatterMatch).not.toBeNull();
      const body = agentMd.slice(frontmatterMatch![0].length);

      expect(body).not.toMatch(/\$specs_dir/);
      expect(body).not.toMatch(/specs_dir/);
      expect(body).toContain("CONTEXT.md");
      expect(body).toContain("docs/adr");
      expect(body).toMatch(/src\/.*lib\/.*app\/.*pkg\/.*cmd\/.*internal\//s);
    });
  ```

- [x] **Step 3: Run — expect FAIL**

Run: `npx vitest run src/cli/tests/meditate.test.ts`

Expected: FAIL — meditate.md still contains `$specs_dir`; meditate.ts still passes `specs_dir` default.

### Task 4.2: Edit `src/cli/pipelines/meditate/meditate.md`

**Files:**
- Modify: `src/cli/pipelines/meditate/meditate.md:69`

- [x] **Step 1: Replace the exploration step**

Find:
```
3. Use `glob_files` and `read_file` to explore the project, with weighted focus on `$specs_dir/*.md` and `src/`. If `$specs_dir` in the Inputs block is empty, default to `docs/specs`. Read the design specs to understand stated intent; read source code to compare it against actual structure. Note where they agree, where they drift, and where complexity is accumulating without earning its keep.
```

Replace with:
```
3. Use `glob_files` and `read_file` to explore the project. Discover the project layout: glob for source roots (`src/`, `lib/`, `app/`, `pkg/`, `cmd/`, `internal/`) and pick what exists. Read `CONTEXT.md` (domain language), files in `docs/adr/` (decision records), `README.md` (mission and command surface), and a sampling of the source roots to understand current structure. Compare what `CONTEXT.md` and ADRs commit to against what the source actually does. Note where they agree, where they drift, and where complexity is accumulating without earning its keep.
```

- [x] **Step 2: Verify zero residue**

Run: `grep -n 'specs_dir\|\$specs_dir' src/cli/pipelines/meditate/meditate.md`

Expected: no output.

### Task 4.3: Edit `src/cli/pipelines/meditate/pipeline.dot`

**Files:**
- Modify: `src/cli/pipelines/meditate/pipeline.dot:2`

- [x] **Step 1: Update inputs declaration**

Find: `  inputs="steer,vision,specs_dir"`

Replace with: `  inputs="steer,vision"`

- [x] **Step 2: Validate**

Run: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/meditate/pipeline.dot`

Expected: OK.

### Task 4.4: Edit `src/cli/pipelines/janitor/pipeline.dot`

**Files:**
- Modify: `src/cli/pipelines/janitor/pipeline.dot:4`

- [x] **Step 1: Update inputs declaration**

Find: `  inputs="project, specs_dir"`

Replace with: `  inputs="project"`

- [x] **Step 2: Confirm janitor agent file has no `$specs_dir` residue**

Run: `grep -rn 'specs_dir\|\$specs_dir' src/cli/pipelines/janitor/`

Expected: no output. (Verified at plan-write time: `src/cli/pipelines/janitor/janitor.md` is already clean. Only `pipeline.dot:4` had a hit, fixed in Task 4.4 step 1.)

- [x] **Step 3: Validate**

Run: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/janitor/pipeline.dot`

Expected: OK.

### Task 4.5: Rewrite implement command test (failing first)

**Files:**
- Modify: `src/cli/tests/implement.test.ts:48–53`

- [x] **Step 1: Replace the test case (preserving existing `vi.mock` + `mockPipeline` pattern)**

The existing scaffold (`implement.test.ts:1–17`) uses `vi.mock("../commands/pipeline.js", ...)` and exposes `mockPipeline = pipelineRunCommand as ReturnType<typeof vi.fn>`. Tests call `await implementCommand("/my/project", {})` and assert via `expect(mockPipeline).toHaveBeenCalledWith(...)`. The replacement preserves that pattern.

Use Edit:
- `old_string`:
  ```typescript
    it("passes specs_dir default of docs/specs to pipeline runtime", async () => {
      await implementCommand("/my/project", {});
      expect(mockPipeline).toHaveBeenCalledWith(
        "implement",
        expect.objectContaining({
          variables: expect.objectContaining({ specs_dir: "docs/specs" }),
        })
      );
    });
  ```
- `new_string`:
  ```typescript
    it("does NOT pass specs_dir to pipeline runtime", async () => {
      await implementCommand("/my/project", {});
      expect(mockPipeline).toHaveBeenCalled();
      const opts = mockPipeline.mock.calls[0][1] as { variables: Record<string, unknown> };
      expect(opts.variables).not.toHaveProperty("specs_dir");
    });
  ```

- [x] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/cli/tests/implement.test.ts`

Expected: FAIL.

### Task 4.6: Edit `src/cli/commands/implement.ts`

**Files:**
- Modify: `src/cli/commands/implement.ts:30–38`

- [x] **Step 1: Remove the `specs_dir` line**

Find:
```typescript
  await pipelineRunCommand("implement", {
    project: absPath,
    variables: {
      specs_dir: "docs/specs",
      scenarios_dir: options.scenarios ?? "",
      max_iterations: String(options.max ?? 0),
      ...(options.model ? { llm_model: options.model } : {}),
    },
  });
```

Replace with:
```typescript
  await pipelineRunCommand("implement", {
    project: absPath,
    variables: {
      scenarios_dir: options.scenarios ?? "",
      max_iterations: String(options.max ?? 0),
      ...(options.model ? { llm_model: options.model } : {}),
    },
  });
```

- [x] **Step 2: Type check**

Run: `npx tsc --noEmit`

Expected: PASS.

### Task 4.7: Edit `src/cli/commands/meditate.ts`

**Files:**
- Modify: `src/cli/commands/meditate.ts:80–87`

- [x] **Step 1: Remove the `specs_dir` line**

Find:
```typescript
    return await self.pipelineRunCommand(dotFile, {
      project: absPath,
      variables: {
        steer: opts.variables?.steer ?? "",
        vision: readVisionIfPresent(absPath),
        specs_dir: opts.variables?.specs_dir ?? "docs/specs",
      },
    });
```

Replace with:
```typescript
    return await self.pipelineRunCommand(dotFile, {
      project: absPath,
      variables: {
        steer: opts.variables?.steer ?? "",
        vision: readVisionIfPresent(absPath),
      },
    });
```

- [x] **Step 2: Type check**

Run: `npx tsc --noEmit`

Expected: PASS.

### Task 4.8: Run vitest, expect all chunk-4 tests PASS

- [x] **Step 1: Run targeted tests**

Run: `npx vitest run src/cli/tests/meditate.test.ts src/cli/tests/implement.test.ts`

Expected: PASS (all assertions, including the rewrites in Tasks 4.1 and 4.5).

- [x] **Step 2: Run full vitest to catch knock-on failures**

Run: `npx vitest run --reporter=default`

Expected: PASS, except possibly:
- `pipeline-implement-folder.test.ts` (still asserts `specs_dir` in pipeline.dot)
- `pipeline.test.ts` (uses `specs_dir` as a generic variable name)
- `illumination-pipeline-flow.test.ts` (asserts `specs_dir` in preflight error message)

Those are addressed in Chunk 5.

### Task 4.9: Commit

- [x] **Step 1: Commit**

```bash
git add src/cli/pipelines/meditate/ src/cli/pipelines/janitor/ \
        src/cli/commands/implement.ts src/cli/commands/meditate.ts \
        src/cli/tests/meditate.test.ts src/cli/tests/implement.test.ts
git commit -m "$(cat <<'EOF'
refactor(meditate+janitor+CLI): drop \$specs_dir from bundled pipelines

- meditate pipeline.dot drops specs_dir input
- meditate.md replaces \$specs_dir-weighted exploration with discover-then-read
- janitor pipeline.dot drops specs_dir input
- implement.ts and meditate.ts CLI commands no longer pass specs_dir
- meditate.test.ts and implement.test.ts contract assertions inverted

Per ADR-0004.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Verification targets (Chunk 4)

- Smokes: None directly
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/meditate/pipeline.dot`, same for `janitor`
- Lint: `npx vitest run src/cli/tests/meditate.test.ts src/cli/tests/implement.test.ts`, `npx tsc --noEmit`
- Surfaces touched: bundled `meditate` + `janitor` pipelines, `ralph implement` and `ralph meditate` command code

---

## Chunk 5: Remaining tests, repo cleanup, deletion, and smoke

**Goal:** Fix the residual tests that referenced `specs_dir` as a generic variable, perform repo content cleanup (README, CONTEXT.md, directory-inventory deletion), then `git rm -r docs/specs/`, then run end-to-end smoke for all four affected pipelines and the CLI commands.

### Task 5.1: Update `src/cli/tests/pipeline.test.ts` (rename generic variable)

**Files:**
- Modify: `src/cli/tests/pipeline.test.ts:184,187`

- [x] **Step 1: Locate the test using `specs_dir` as a generic variable**

Look for a test that passes `{ specs_dir: "/tmp/specs", foo: "bar" }` and asserts `callerContext` round-trips. The test is concerned with variable plumbing, not the specs pattern.

- [x] **Step 2: Rename `specs_dir` → `widget_dir` in both lines**

Use Edit with `replace_all=false` on line 184: `specs_dir: "/tmp/specs"` → `widget_dir: "/tmp/widget"`.

Then on line 187: `specs_dir: "/tmp/specs"` → `widget_dir: "/tmp/widget"`.

- [x] **Step 3: Run — expect PASS**

Run: `npx vitest run src/cli/tests/pipeline.test.ts`

Expected: PASS.

### Task 5.2: Update `src/cli/tests/pipeline-implement-folder.test.ts`

**Files:**
- Modify: `src/cli/tests/pipeline-implement-folder.test.ts:43`

The assertion at line 43 is checking that **`scenario-author.md`** (loaded into `content` at line 39) contains `"specs_dir"` in its frontmatter. Since Chunk 3 Task 3.3 step 1 removes the `- specs_dir` line from `scenario-author.md`, this assertion will start failing. The cleanest replacement is a positive absence-check confirming the excision actually happened.

- [x] **Step 1: Read the test file to confirm the assertion shape**

Use the Read tool on `src/cli/tests/pipeline-implement-folder.test.ts`. Confirm `content` at line 39 reads `scenario-author.md`, and line 43 reads `expect(content).toContain("specs_dir");`.

- [x] **Step 2: Replace the assertion**

Use Edit:
- `old_string`: `    expect(content).toContain("specs_dir");\n`
- `new_string`: `    expect(content).not.toContain("specs_dir");\n`

(Inverted: now asserts the excision happened — `scenario-author.md` must no longer reference `specs_dir`.)

- [x] **Step 3: Run — expect PASS**

Run: `npx vitest run src/cli/tests/pipeline-implement-folder.test.ts`

Expected: PASS.

### Task 5.3: Update `src/attractor/tests/illumination-pipeline-flow.test.ts`

**Files:**
- Modify: `src/attractor/tests/illumination-pipeline-flow.test.ts:19–29`

The current test (lines 19–29) asserts the validator emits a `required_caller_vars` info banner naming `illuminations_dir`, `specs_dir`, `plans_dir`. After Chunk 2's `inputs="project"` rewrite, only `project` is declared and `project` is RESERVED — so the banner is either empty or omitted entirely. Three lines (26, 27, 28) all break together; the rewrite handles them as a unit.

- [x] **Step 1: Read the test file**

Use the Read tool on `src/attractor/tests/illumination-pipeline-flow.test.ts` and confirm lines 19–29 contain the test case `"emits required_caller_vars info banner listing project, illuminations_dir, etc."`.

- [x] **Step 2: Replace the entire test case**

Use Edit:
- `old_string`:
  ```typescript
    it("emits required_caller_vars info banner listing project, illuminations_dir, etc.", () => {
      const info = diags.find(
        d => d.rule === "required_caller_vars" && d.severity === "info",
      );
      expect(info).toBeDefined();
      // $project is RESERVED so it must NOT appear; the other digraph inputs must.
      expect(info!.message).not.toMatch(/\bproject\b/);
      expect(info!.message).toContain("illuminations_dir");
      expect(info!.message).toContain("specs_dir");
      expect(info!.message).toContain("plans_dir");
    });
  ```
- `new_string`:
  ```typescript
    it("does NOT require any caller vars (only $project declared, which is RESERVED)", () => {
      const info = diags.find(
        d => d.rule === "required_caller_vars" && d.severity === "info",
      );
      // After the source-as-truth excision (ADR-0004), inputs="project" only.
      // $project is RESERVED → no caller-vars banner expected, OR if emitted,
      // it must not name any of the removed inputs.
      if (info) {
        expect(info.message).not.toMatch(/illuminations_dir|specs_dir|plans_dir/);
      } else {
        expect(info).toBeUndefined();
      }
    });
  ```

- [x] **Step 3: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/illumination-pipeline-flow.test.ts`

Expected: PASS. If the validator's actual banner shape contradicts both branches of the conditional, fix the test to match the observed message and document the behavior in CONTEXT.md or an ADR.

### Task 5.4: Run full vitest suite

- [x] **Step 1: Run all tests**

Run: `npx vitest run --reporter=default`

Expected: PASS (entire suite).

- [x] **Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: PASS.

### Task 5.5: Update `README.md`

**Files:**
- Modify: `README.md` (line 60, lines 158–170, lines 181–185)

- [x] **Step 1: Remove the `--var specs_dir=docs/specs` example at line 60**

Find:
```bash
ralph pipeline run pipelines/my-pipeline.dot \
  --var meditations_dir=meditations \
  --var specs_dir=docs/specs
```

Replace with:
```bash
ralph pipeline run pipelines/my-pipeline.dot \
  --var meditations_dir=meditations
```

- [x] **Step 2: Replace the Directory Map section (lines 158–170)**

Find the entire block from `## Directory Map` through the closing blockquote at line 170.

Replace with:

```markdown
## Where to look

- **`CONTEXT.md`** — domain language and glossary
- **`docs/adr/`** — decision records (why things are the way they are)
- **`src/`** — TypeScript source (CLI, pipeline engine, daemon, MCP servers)
- **`pipelines/`** — project-local `.dot` pipelines (also `src/cli/pipelines/` for bundled ones shipped to consumers)
```

- [x] **Step 3: Replace the Specs section (lines 181–185)**

Find (heading at line 181, list at 183–185):
```markdown
## Specs

- [Architecture](docs/specs/architecture.md)
- [Commands](docs/specs/commands.md)
- [Loop Script](docs/specs/loop.md)
```

Replace with:
```markdown
## Decisions

See [`docs/adr/`](docs/adr/) for accepted decision records.
```

### Task 5.6: Update `CONTEXT.md`

**Files:**
- Modify: `CONTEXT.md` (append new section at end)

- [x] **Step 1: Append the "Documentation channels" section**

Append to the end of the file:

```markdown

### Documentation channels

ralph-cli has three documentation channels with disjoint roles:

- **`CONTEXT.md` (this file)** — domain language and glossary. Hand-curated.
  Updated during grill-with-docs sessions and ADR writes. Stable.
- **`docs/adr/`** — append-only decision records. Each captures a hard-to-reverse
  or surprising-without-context choice with its trade-off. Never edited after
  acceptance.
- **`src/` and `pipelines/`** — the authoritative description of behavior.
  Source code is truth. No spec file claims to mirror it.

Removed on 2026-05-01: `docs/specs/` (behavioral specs that drifted faster than
they could be maintained) and `docs/orientation/directory-inventory.md` (a
curated file-tree summary that drifted on every reorg). See
`docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md`.

Agents needing workspace orientation discover the project layout at runtime
(Glob source/docs roots) and read `CONTEXT.md` + `docs/adr/` + `README.md` +
a live `src/` inventory. No preloaded curated overview.
```

### Task 5.7: Delete `docs/orientation/directory-inventory.md`

- [x] **Step 1: Delete the file**

```bash
git rm docs/orientation/directory-inventory.md
```

- [x] **Step 2: Remove the folder if empty**

```bash
if [ -z "$(ls -A docs/orientation 2>/dev/null)" ]; then rmdir docs/orientation; fi
```

### Task 5.8: Run `npm run build` to regenerate `dist/`

`npm run build` MUST succeed before Task 5.9 smokes — the bundled CLI commands (`ralph implement`, `ralph meditate`, `ralph heartbeat pipeline janitor`) read pipeline files from `dist/pipelines/`, so stale dist would mask source-edit bugs.

- [x] **Step 1: Build**

Run: `npm run build`

Expected: PASS — `dist/pipelines/*` regenerates with the new pipeline.dot files (no `specs_dir` in inputs) and updated agent rubrics.

- [x] **Step 2: Verify `dist/` is consistent**

Run: `grep -rn 'specs_dir\|\$specs_dir' dist/pipelines/`

Expected: no output. If hits remain, the source files in `src/cli/pipelines/` were not updated correctly — re-check Tasks 3.2, 3.3, 3.4, 4.2, 4.3, 4.4.

### Task 5.9: Run end-to-end smokes (4 commands)

Prerequisite: Task 5.4 (full vitest pass), Task 5.7 (directory-inventory deletion committed), and Task 5.8 (build) must all be complete. Per spec §7, smokes must pass before `git rm -r docs/specs/` in Task 5.10.

This is dogfooding — ralph-cli runs the affected pipelines against itself. The repo at this point still has `docs/specs/` (deletion is the next step). The smokes verify the agents tolerate either presence or absence; we want them to work in both.

- [x] **Step 1: Bundled `ralph implement` smoke**

Run (in a scratch directory):
```bash
mkdir -p /tmp/ralph-implement-smoke && cd /tmp/ralph-implement-smoke && \
  git init -b main && \
  printf '# scratch\n' > README.md && git add README.md && git commit -m "init" && \
  ralph implement . --max 1
```

Expected: implement runs one iteration, the agent orients via discover-then-read (CONTEXT.md may be missing — that's tolerated), no engine preflight error about `specs_dir`. Exit cleanly.

- [x] **Step 2: Bundled `ralph meditate` smoke**

Run:
```bash
cd /Users/josu/Documents/projects/ralph-cli && ralph meditate . --var steer="smoke test"
```

Expected: meditate runs, exploration step uses discover-then-read, no `$specs_dir` references in injected Inputs block, agent produces an illumination via `write_illumination`. Exit cleanly.

- [x] **Step 3: Bundled janitor smoke**

Run:
```bash
cd /Users/josu/Documents/projects/ralph-cli && ralph heartbeat pipeline janitor --project . --every 0
```

Expected: janitor runs, no `$specs_dir` references, scans source. Cancel after one iteration.

- [x] **Step 4: Project-local illumination-to-implementation smoke**

First, list current alive illuminations and pick the most recent one:

```bash
ls -1t meditations/illuminations/*.md | head -5
```

Use the first listed file as the smoke target. If `meditations/illuminations/` is empty, restore one from history with `git checkout HEAD~10 -- meditations/illuminations/2026-05-01T0820-pipeline-spec-drift-poisons-agents.md` (or any other file present in HEAD~10 — `git log --all --oneline -- meditations/illuminations/` lists candidates).

Then run:

```bash
cd /Users/josu/Documents/projects/ralph-cli && \
  ralph pipeline run pipelines/illumination-to-implementation/pipeline.dot --project .
```

Expected: pipeline starts at `verifier`. Verifier orients via discover-then-read (no `$specs_dir/architecture.md` read attempt). Either reach the approval gate or cancel cleanly with Ctrl-C. The smoke tests pipeline structure, not full triage execution.

### Task 5.10: Final deletion of `docs/specs/`

- [x] **Step 1: Delete the folder**

```bash
git rm -r docs/specs/
```

- [x] **Step 2: Verify zero residual references in non-historical files**

Run:
```bash
grep -rn 'docs/specs\|specs_dir\|\$specs_dir' /Users/josu/Documents/projects/ralph-cli \
  --include="*.ts" --include="*.dot" --include="*.md" --include="*.json" \
  --include="*.sh" --include="*.mjs" 2>/dev/null \
  | grep -v "meditations/illuminations\|/memory/\|/dist/\|docs/superpowers/plans/" \
  | grep -v "docs/superpowers/specs/\|docs/adr/0003" \
  | grep -v "meditations/stimuli/.triage"
```

Expected: zero output (excluding historical/append-only files).

- [x] **Step 3: Final type check + build**

Run:
```bash
npx tsc --noEmit && npm run build && npx vitest run
```

Expected: ALL PASS.

### Task 5.11: Commit + tag

- [x] **Step 1: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(docs): delete docs/specs/ — source code + CONTEXT.md + ADRs are truth

Final step of the source-as-truth excision (ADR-0004). Removes:

- docs/specs/ (11 hand-authored behavioral specs)
- docs/orientation/directory-inventory.md (curated file-tree summary)

Updates README.md (Where to look pointer list) and CONTEXT.md
(Documentation channels section). \$specs_dir is now zero references in
non-historical files.

Per ADR-0004. Spec at
docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [x] **Step 2: Tag (optional — skip unless explicitly requested)**

This change ships in a regular commit; no version bump is required. Skip tagging unless the user requests it. If they do, run `npm version patch --no-git-tag-version && git add package.json && git commit --amend --no-edit && git tag v$(node -p "require('./package.json').version")`.

### Verification targets (Chunk 5)

- Smokes:
  - Bundled `ralph implement` — Task 5.9 step 1
  - Bundled `ralph meditate` — Task 5.9 step 2
  - Bundled janitor heartbeat — Task 5.9 step 3
  - Project-local illumination-to-implementation pipeline — Task 5.9 step 4
- Manual exercises: `ralph implement`, `ralph meditate`, `ralph heartbeat pipeline janitor`, `ralph pipeline run`
- Lint: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
- Surfaces touched: docs (`README.md`, `CONTEXT.md`, `docs/specs/`, `docs/orientation/`), all four affected pipelines, both CLI commands, six test files
