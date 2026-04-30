# Move `specs/` → `docs/specs/` with Pipeline Variable Portability

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate authoritative specs from repo root to `docs/specs/`, and convert hard-coded `specs/` paths in pipeline agent rubrics to a `$specs_dir` variable so future relocations are caller-config only.

**Architecture:** Two-tier change. (1) Physical `git mv` of 11 spec files + README/docs link rewrites. (2) Refactor: agent rubrics that hard-code `specs/` (`implement`, `meditate`, `janitor`, `illumination-to-implementation`) become portable by templating `$specs_dir`. Pipelines declare `specs_dir` in their `inputs` field; CLI commands (`implement`, `meditate`) pass the default `docs/specs`. The `illumination-to-implementation` pipeline already wires `$specs_dir` correctly — only literal-path holdouts in its rubrics need rewriting.

**Tech Stack:** TypeScript, vitest, Markdown agent rubrics, Graphviz `.dot` pipeline configs, the existing pipeline runtime in `src/attractor/` and `src/cli/lib/pipeline.ts`.

**Pre-flight context to read once:**
- `specs/README.md` — table of current authoritative specs
- `pipelines/illumination-to-implementation/design-writer.md` — reference impl of `$specs_dir` usage
- `src/cli/commands/implement.ts` and `src/cli/commands/meditate.ts` — caller variable wiring
- `src/cli/tests/pipeline.test.ts:184–187` — pattern for `variables` round-trip assertion

---

## Chunk 1: Move the folder + repoint authoritative links

Pure relocation chunk. No code logic changes. The point: get specs to their new home, fix every direct link, leave portability work to chunks 2–4. README's "current vs historical" semantic block (specs/ vs docs/superpowers/specs/) gets rewritten in this chunk too.

### Task 1.1: Move spec files with `git mv`

**Files:**
- Move: all of `specs/*` → `docs/specs/*`

- [x] **Step 1: Verify no untracked files in `specs/`**

```bash
git status specs/
```
Expected: nothing untracked (all 11 .md files tracked).

- [x] **Step 2: `git mv` the folder**

```bash
git mv specs docs/specs
```

- [x] **Step 3: Fix internal cross-links inside `docs/specs/*.md`**

```bash
grep -rn "specs/" docs/specs/ || true
grep -rn "\.\./" docs/specs/ || true
```

Apply these concrete edits — they are known broken after the move:

a. `docs/specs/architecture.md:102` — link target `../docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md` resolved at the old root; from `docs/specs/` it now needs to be `../superpowers/specs/2026-04-17-pipeline-script-files-design.md`. Edit the path depth.

b. `docs/specs/pipeline.md` lines 15, 177, 264 — bare-word references like `specs/architecture.md` and `specs/commands.md` should become sibling-file links (`architecture.md`, `commands.md`) since they're now in the same folder.

Then re-run the greps; both should return only intentional matches (e.g., `$specs_dir` introduced in later chunks isn't here yet, so `specs/` should be empty).

**Out of scope (don't touch in this chunk):** `IMPLEMENTATION_PLAN.md` at repo root is gitignored and historical — references inside it to `specs/architecture.md` etc. are not part of this migration.

- [x] **Step 4: Commit (move only, no other edits yet — leaves bisect clean)**

```bash
git add -A
git commit -m "refactor: move specs/ to docs/specs/ (relocation only)"
```

### Task 1.2: Rewrite README.md links and semantic block

**Files:**
- Modify: `README.md` (lines 53, 156–157, 163, 176–178)

- [x] **Step 1: Read current state**

```bash
sed -n '50,60p;150,180p' README.md
```

- [x] **Step 2: Edit nav links (lines ~176–178)**

Change:
```markdown
[Architecture](specs/architecture.md)
[Commands](specs/commands.md)
[Loop Script](specs/loop.md)
```
To:
```markdown
[Architecture](docs/specs/architecture.md)
[Commands](docs/specs/commands.md)
[Loop Script](docs/specs/loop.md)
```

- [x] **Step 3: Edit example var (line ~53)**

If the line reads `--var specs_dir=docs/specs`, leave as-is — it already matches the new location. Only act if it reads `specs/`.

- [x] **Step 4: Rewrite the "specs/ vs docs/superpowers/specs/" distinction (Directory Map row at lines ~156–157, plus the callout block at line ~163)**

The old text contrasts root `specs/` (authoritative, current) against `docs/superpowers/specs/` (design history). Rewrite to:
- `docs/specs/` — authoritative behavioral specs (what the system does)
- `docs/superpowers/specs/` — design proposals & history (how decisions were reached)

Keep both pointers; do not delete the historical-design pointer.

- [x] **Step 5: Verify links resolve**

```bash
grep -nE "\(specs/" README.md
```
Expected: zero matches.

- [x] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: repoint README links after specs/ relocation"
```

### Task 1.3: Update directory inventory

**Files:**
- Modify: `docs/orientation/directory-inventory.md` (lines ~11–12, 30, 38)

- [x] **Step 1: Read inventory entries that mention `specs/`**

```bash
grep -n "specs" docs/orientation/directory-inventory.md
```

- [x] **Step 2: Edit each entry**

Replace each `specs/` row with the `docs/specs/` path. Where the inventory contrasts root `specs/` vs `docs/superpowers/specs/`, mirror the README rewrite.

- [x] **Step 3: Commit**

```bash
git add docs/orientation/directory-inventory.md
git commit -m "docs: update directory inventory for docs/specs/"
```

### Task 1.4: Plan-document review checkpoint (Chunk 1)

- [x] **Step 1: Dispatch plan-document-reviewer subagent**

Provide: this chunk's content + path to this plan file. Reviewer checks for: missing files, broken-link risk, unaddressed README blocks.

- [x] **Step 2: Apply fixes if ❌, re-dispatch until ✅** — main-agent inline verification confirmed: 11 files at docs/specs/, zero `(specs/` matches in README, only intentional `docs/superpowers/specs/` reference remains in architecture.md.

---

## Chunk 2: Make bundled pipelines portable (`implement`, `meditate`)

Both bundled pipelines hard-code `specs/` in their agent rubric. This chunk threads a `specs_dir` variable through pipeline.dot → agent rubric → CLI caller, using TDD. After this chunk, `ralph implement` and `ralph meditate` resolve specs via a variable that defaults to `docs/specs` but can be overridden by `--var specs_dir=...`.

**Important — variable-substitution semantics:** `$specs_dir` in the rubric body is **NOT** runtime-substituted. The runtime expands `$varname` only in `toolCommand`, `cwd`, and `maxIterations` (see `src/attractor/transforms/variable-expansion.ts`). The agent body is delivered verbatim. Instead, declaring `specs_dir` in the pipeline.dot `inputs="..."` causes the runtime to auto-inject an `## Inputs` block containing `<specs_dir>docs/specs</specs_dir>`; the LLM reads the value from there. The literal `$specs_dir` token in the rubric is a **convention** that signals to the agent "look up `specs_dir` in the Inputs block." Reference impl: `pipelines/illumination-to-implementation/design-writer.md`.

### Task 2.1: Update meditate test for new rubric

**Files:**
- Modify: `src/cli/tests/meditate.test.ts:269–281` (test name + regex)

- [x] **Step 1: Read current test**

```bash
sed -n '268,282p' src/cli/tests/meditate.test.ts
```

- [x] **Step 2: Replace assertion to expect `$specs_dir` token**

```ts
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

- [x] **Step 3: Run test, confirm RED**

```bash
npx vitest run src/cli/tests/meditate.test.ts -t "weights"
```
Expected: FAIL — current rubric still has literal `specs/`, not `$specs_dir`.

- [x] **Step 4: Edit rubric** — `src/cli/pipelines/meditate/meditate.md:69`

Change `specs/*.md` → `$specs_dir/*.md`. Add a sentence near the first use: "If `$specs_dir` in the Inputs block is empty, default to `docs/specs`." (Belt-and-braces: the CLI command always passes a default in Task 2.3, but invocation via `pipeline run` directly bypasses that.)

- [x] **Step 5: Run test, confirm GREEN**

```bash
npx vitest run src/cli/tests/meditate.test.ts -t "weights"
```

- [x] **Step 6: Commit**

```bash
git add src/cli/tests/meditate.test.ts src/cli/pipelines/meditate/meditate.md
git commit -m "refactor(meditate): use \$specs_dir variable in rubric"
```

### Task 2.2: Add `specs_dir` to meditate pipeline.dot inputs

**Files:**
- Modify: `src/cli/pipelines/meditate/pipeline.dot:2`

- [ ] **Step 1: Edit**

```
inputs="steer,vision,specs_dir"
```

- [ ] **Step 2: Run pipeline validator (sanity)**

```bash
npm run build
node dist/cli/index.js pipeline validate src/cli/pipelines/meditate/pipeline.dot
```
Expected: PASS, `specs_dir` listed as declared input.

- [ ] **Step 3: Commit**

```bash
git add src/cli/pipelines/meditate/pipeline.dot
git commit -m "refactor(meditate): declare specs_dir as pipeline input"
```

### Task 2.3: Wire default in `meditate.ts` command

**Files:**
- Modify: `src/cli/commands/meditate.ts` (the `variables:` block in the `pipelineRunCommand` call)

- [ ] **Step 1: Write a failing test in `src/cli/tests/meditate.test.ts`** (use `vi.spyOn` to match the existing pattern at meditate.test.ts:212–220)

```ts
it("passes specs_dir default of docs/specs to pipeline runtime", async () => {
  const calls: Array<{ dotFile: string; opts: any }> = [];
  vi.spyOn(pipelineMod, "pipelineRunCommand").mockImplementation(
    async (dotFile, opts) => {
      calls.push({ dotFile, opts });
    },
  );
  await meditateCommand(tmpDir);
  expect(calls[0].opts.variables.specs_dir).toBe("docs/specs");
});
```

- [ ] **Step 2: Run test, confirm RED**

- [ ] **Step 3: Implement — add `specs_dir: "docs/specs"` (or honor `--specs-dir` flag if exposed) into the `variables` map**

- [ ] **Step 4: Run test, confirm GREEN**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(meditate): default specs_dir to docs/specs"
```

### Task 2.4: Same triplet for `implement` pipeline

**Files:**
- Modify: `src/cli/pipelines/implement/implement.md:14,35` (replace `specs/*` → `$specs_dir/*`)
- Modify: `src/cli/pipelines/implement/pipeline.dot` (add `inputs="specs_dir,max_iterations,llm_model"` — the latter two were previously implicit; declaring them is good hygiene but if scope creep, add `specs_dir` only)
- Modify: `src/cli/commands/implement.ts:24–27` (add `specs_dir: "docs/specs"` to `variables`)

- [ ] **Step 1: Add a rubric assertion test** (new test in `src/cli/tests/implement.test.ts` or wherever implement contract tests live; mirror Task 2.1 pattern). Assert rubric contains `$specs_dir`, not literal `specs/`.

- [ ] **Step 2: RED**

- [ ] **Step 3: Apply edits — rubric, dot, command. Include the same empty-value fallback sentence used in Task 2.1 Step 4.**

- [ ] **Step 4: GREEN**

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(implement): \$specs_dir variable + docs/specs default"
```

### Task 2.5: Plan-document review checkpoint (Chunk 2)

- [ ] Dispatch plan-document-reviewer for Chunk 2 with focus on: TDD discipline preserved? Variable-threading correct? Rubric tokens consistent?

---

## Chunk 3: Project-local pipeline portability (`pipelines/`)

The repo's project-local `pipelines/` mirror is what self-development uses. `illumination-to-implementation/design-writer.md` already uses `$specs_dir` — good. Hold-outs: `implement.md`, `verifier.md`, `memory-writer.md` (in same pipeline) and standalone `janitor/janitor.md`. These don't have unit tests, so verification is via portability validator + smoke pipeline runs.

### Task 3.1: Rewrite literal `specs/` in illumination-to-implementation rubrics

**Files:**
- Modify: `pipelines/illumination-to-implementation/implement.md:16,37` (path-refs)
- Modify: `pipelines/illumination-to-implementation/verifier.md:40,48,67` (path-refs)
- **Do NOT modify:** `pipelines/illumination-to-implementation/verifier.md:65` ("Cited specs:" — concept-reference, English noun, not a filesystem path)
- **Do NOT modify:** `pipelines/illumination-to-implementation/memory-writer.md:144` ("Do not touch source code, specs, or pipelines" — concept-reference, English noun)

- [ ] **Step 1: For each path-ref line above, replace literal `specs/` → `$specs_dir/`. Skip the two concept-reference lines.**

- [ ] **Step 1b: Add empty-value fallback to each migrated agent rubric.** Since `$specs_dir` is read from the auto-injected Inputs block (Chunk 2 preamble), an unset value would yield an empty string and silently break globs like `$specs_dir/*.md` (becomes `/*.md`). Add a single sentence near the first use of `$specs_dir` in each rubric: "If `$specs_dir` is empty in the Inputs block, default to `docs/specs`." Apply to: `implement.md`, `verifier.md`. (`memory-writer.md` was a concept-ref — no fallback needed.)

- [ ] **Step 2: Run portability validator**

```bash
npm run build
node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation/pipeline.dot
```
Expected: no undeclared variables; `specs_dir` already in `inputs="..."`.

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(illumination-to-implementation): \$specs_dir in remaining rubrics"
```

### Task 3.2: Make janitor portable

**Files:**
- Modify: `pipelines/janitor/janitor.md:56` — `specs/*.md` → `$specs_dir/*.md` (the only filesystem path-ref in janitor — illuminations and plans are MCP-resolved, not filesystem paths)
- Modify: `pipelines/janitor/pipeline.dot:4` — current `inputs="project"` → `inputs="project, specs_dir"`

- [ ] **Step 1: Apply rubric edit to `janitor.md:56`. Add the same empty-value fallback sentence used in Task 3.1 Step 1b.**

- [ ] **Step 2: Apply pipeline.dot edit — append `specs_dir` to inputs.**

- [ ] **Step 3: Validate**

```bash
node dist/cli/index.js pipeline validate pipelines/janitor/pipeline.dot
```

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(janitor): \$specs_dir variable for doc-drift scan"
```

### Task 3.3: Plan-document review checkpoint (Chunk 3)

- [ ] Dispatch reviewer; verify only path-references were converted, not the bare-word "specs" semantic uses.

---

## Chunk 4: Verification + smoke

### Task 4.1: Run full test suite

- [ ] **Step 1:**

```bash
npm test
```
Expected: green. If meditate or pipeline tests fail, root-cause before continuing.

### Task 4.2: Run smoke pipelines

Smoke pipelines are folder-form. The CLI requires a `.dot` file path, not the folder.

- [ ] **Step 1: Run all 14 smoke pipelines in a loop**

```bash
for d in pipelines/smoke/*/; do
  echo "=== $d ===" && node dist/cli/index.js pipeline run "$d/pipeline.dot" || break
done
```
Expected: every smoke folder runs to completion. Halt + investigate on first failure.

### Task 4.3: Manual sanity — `ralph implement` default + override

- [ ] **Step 1: Default path (no override)**

```bash
ralph <scratch> implement --max 1
```
Confirm: agent's Inputs block shows `<specs_dir>docs/specs</specs_dir>` and the rubric scans `docs/specs/`.

- [ ] **Step 2: Override path (the whole point of Chunk 2 refactor — verify positive case)**

```bash
ralph <scratch> implement --max 1 --var specs_dir=custom/path/specs
```
Confirm: agent's Inputs block shows `<specs_dir>custom/path/specs</specs_dir>` and the rubric scans `custom/path/specs/`.

### Task 4.4: Update memory

The repo's `memory/` folder contains dated standalone files; there is no project-level `MEMORY.md` index (the user's auto-memory `MEMORY.md` lives elsewhere and is auto-managed).

- [ ] **Step 1: Write `memory/2026-04-30-specs-relocated-to-docs.md`** — short note: specs lives at `docs/specs/` now; agent rubrics use `$specs_dir` convention (read from auto-injected Inputs block, not template substitution); default is `docs/specs`; CLI commands `implement` and `meditate` thread the default; portable across any folder via `--var specs_dir=...`.

- [ ] **Step 2: Commit**

```bash
git commit -am "docs(memory): record specs/ → docs/specs/ relocation"
```

### Task 4.5: Final plan-document review

- [ ] Dispatch reviewer over the whole executed plan; confirm nothing's a half-implementation.

---

## Out of scope

- Renaming `docs/superpowers/specs/` (design-history dir). Keep as-is to preserve git history of design docs.
- Renaming the `specs_dir` variable. Name stays — only its default value moves.
- Adding a `--specs-dir` CLI flag. The pipeline already accepts `--var specs_dir=...`; a dedicated flag is YAGNI until a user asks.

## Done when

1. `specs/` no longer exists at repo root.
2. `docs/specs/` contains all 11 spec files with cross-links intact.
3. `npm test` is green.
4. All bundled and project-local pipelines that previously hard-coded `specs/` now use `$specs_dir`.
5. Smoke pipelines pass.
6. Memory entry written.
