---
status: implemented
---

# Pipeline Portability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pipeline authoring portable by default — teach variable-first design in the authoring prompt, warn on hardcoded literals at validate time, inject the local agent list into the create prompt dynamically, and sweep all bundled pipelines to replace hardcoded ralph-cli paths with `$variables`.

**Architecture:** Four independent chunks, each self-contained. No shared state between chunks — execute in priority order: prompt text first (cheapest, highest leverage), then validator heuristics, then runtime injection, then pipeline audit. The `inputs=` enforcement engine change is already live and out of scope.

**Tech Stack:** TypeScript, Node.js, Vitest. Key files: `src/attractor/core/graph.ts` (validateGraph), `src/cli/lib/pipeline-create-prompt.ts` (new), `src/cli/commands/pipeline.ts` (pipelineCreateCommand), `src/cli/prompts/PROMPT_pipeline_create.md`, `pipelines/**/*.dot`.

**Design doc:** `docs/superpowers/specs/2026-04-16-pipeline-portability-design.md`

---

## Chunk 1: Portability section + parameterized example in PROMPT_pipeline_create.md

**Files:**
- Modify: `src/cli/prompts/PROMPT_pipeline_create.md`

This is a pure prompt text change — no code, no tests. The authoring agent reads this file via `getPipelineCreatePromptPath()`.

- [ ] **Step 1: Read the current prompt**

  Open `src/cli/prompts/PROMPT_pipeline_create.md`. Locate:
  - Line ~82: `### Validation rules` section
  - Line ~114: `review [agent="reviewer", prompt="Review the latest changes"]`

- [ ] **Step 2: Insert portability section before validation rules**

  Insert the following block between `### Node attributes` and `### Validation rules`:

  ```markdown
  ### Portability rule

  Every project-specific value must be a `$variable`. Never embed paths, agent names, or
  directory conventions as string literals. A pipeline with `agent="implement"` cannot run in a
  project that registers the agent as `"code-review"`. A prompt that hardcodes
  `meditations/illuminations/` is useless outside ralph-cli.

  | Wrong (hardcoded) | Right (portable) |
  |-------------------|-----------------|
  | `agent="implement"` | `agent="$implement_agent"` |
  | `prompt="Read docs/superpowers/specs/"` | `prompt="Read $specs_dir"` + add to `inputs=` |
  | `tool_command="ls meditations/"` | `tool_command="ls $illuminations_dir"` + `inputs=` |

  Rule: if a value would differ between two projects using this pipeline, it must be a `$variable`
  declared in `inputs=`.
  ```

- [ ] **Step 3: Update the reference example agent line**

  Change:
  ```dot
  review [agent="reviewer", prompt="Review the latest changes"]
  ```
  To:
  ```dot
  // Named agent — use $variable so this pipeline works in any project's agent registry
  review [agent="$review_agent", prompt="Review the latest changes"]
  ```

  Also update the `inputs=` attribute in the **existing** digraph header of the reference example. Do NOT replace the digraph name. Find the existing `digraph <name> {` block and either:
  - Add `inputs="review_agent"` after the `goal=` line if no `inputs=` exists yet, OR
  - Append `review_agent` to the existing `inputs=` value if it already exists.

  Example (keep whatever digraph name is already in the file):
  ```dot
  digraph review_pipeline {
    goal="Run scenarios, meditate on results, then approve or fix"
    inputs="review_agent"
    ...
  }
  ```

- [ ] **Step 4: Verify prompt renders correctly**

  Run: `cat src/cli/prompts/PROMPT_pipeline_create.md | head -140`
  Expected: portability section visible between node attributes and validation rules; reference example uses `$review_agent` and declares `inputs="review_agent"`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/cli/prompts/PROMPT_pipeline_create.md
  git commit -m "docs: add portability section + parameterize reference example in pipeline create prompt"
  ```

---

## Chunk 2: Portability heuristics in validateGraph

**Files:**
- Modify: `src/attractor/core/graph.ts` (validateGraph function, ~line 249+)
- Create: `src/attractor/tests/graph-portability.test.ts`

The `validateGraph` function already emits `variable_coverage` warnings. Add `portability_heuristic` warnings for hardcoded project path substrings.

- [ ] **Step 1: Find the test file for validateGraph**

  Run: `find src -name "*.test.ts" | xargs grep -l "validateGraph" 2>/dev/null`

  If no test file exists: create `src/attractor/tests/graph-portability.test.ts`.
  If it exists: add tests there.

- [ ] **Step 2: Write failing tests for path heuristics**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { validateGraph } from "../core/graph.js";
  import { parseDot } from "../core/graph.js";

  describe("validateGraph portability_heuristic", () => {
    it("warns when prompt hardcodes meditations/ path", () => {
      const src = `digraph t {
        start [shape=Mdiamond]
        done [shape=Msquare]
        a [agent="implement", prompt="Read meditations/illuminations/*.md and summarize"]
        start -> a -> done
      }`;
      const graph = parseDot(src);
      const diags = validateGraph(graph);
      const warns = diags.filter(d => d.rule === "portability_heuristic");
      expect(warns.length).toBeGreaterThan(0);
      expect(warns[0].message).toContain("meditations/");
    });

    it("warns when prompt hardcodes docs/superpowers/ path", () => {
      const src = `digraph t {
        start [shape=Mdiamond]
        done [shape=Msquare]
        a [agent="implement", prompt="Write to docs/superpowers/specs/design.md"]
        start -> a -> done
      }`;
      const graph = parseDot(src);
      const diags = validateGraph(graph);
      const warns = diags.filter(d => d.rule === "portability_heuristic");
      expect(warns.length).toBeGreaterThan(0);
    });

    it("does not warn when values are variables", () => {
      const src = `digraph t {
        inputs="illumination_path"
        start [shape=Mdiamond]
        done [shape=Msquare]
        a [agent="$implement_agent", prompt="Read $illumination_path and summarize"]
        start -> a -> done
      }`;
      const graph = parseDot(src);
      const diags = validateGraph(graph);
      const warns = diags.filter(d => d.rule === "portability_heuristic");
      expect(warns.length).toBe(0);
    });
  });
  ```

- [ ] **Step 3: Run tests to confirm failure**

  Run: `npx vitest run src/attractor/tests/graph-portability.test.ts`
  Expected: FAIL — `portability_heuristic` rule does not exist yet.

- [ ] **Step 4: Implement portability_heuristic in validateGraph**

  In `src/attractor/core/graph.ts`, after the `variable_coverage` check block (after the closing `}` of the `if (startNodes.length === 1)` block), add:

  ```typescript
  // portability_heuristic — warn when node attributes embed project-specific path substrings
  const PORTABILITY_PATH_PATTERNS = ["meditations/", "docs/superpowers/"];
  for (const node of nodes.values()) {
    const fields = [node.prompt, node.toolCommand].filter((f): f is string => typeof f === "string");
    for (const field of fields) {
      for (const pat of PORTABILITY_PATH_PATTERNS) {
        if (field.includes(pat)) {
          diags.push({
            rule: "portability_heuristic",
            severity: "warning",
            message: `Node "${node.id}" hardcodes project path "${pat}" — use $variable and declare in inputs=`,
          });
          break; // one warning per node per field is enough
        }
      }
    }
  }
  ```

- [ ] **Step 5: Run tests to confirm passing**

  Run: `npx vitest run src/attractor/tests/graph-portability.test.ts`
  Expected: PASS all 3 tests.

- [ ] **Step 6: Run full test suite**

  Run: `npx vitest run`
  Expected: all tests pass, no regressions.

- [ ] **Step 7: Verify validate output on illumination-to-plan.dot**

  Run: `npm run build && ralph pipeline validate pipelines/illumination-to-plan.dot`
  Expected: `portability_heuristic` warnings appear for the hardcoded paths (verifies the rule fires on real data).

- [ ] **Step 8: Commit**

  ```bash
  git add src/attractor/core/graph.ts src/attractor/tests/graph-portability.test.ts
  git commit -m "feat: add portability_heuristic warnings to pipeline validate for hardcoded paths"
  ```

---

## Chunk 3: Runtime agent injection for pipeline create

**Files:**
- Create: `src/cli/lib/pipeline-create-prompt.ts`
- Modify: `src/cli/commands/pipeline.ts` (~line 504, pipelineCreateCommand)
- Create: `src/cli/tests/pipeline-create-prompt.test.ts`

`pipelineCreateCommand` currently does `readFileSync(promptPath)`. Replace with `composeCreatePrompt(project)` that appends the local agent list.

- [ ] **Step 1: Write failing test for composeCreatePrompt**

  Create `src/cli/tests/pipeline-create-prompt.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
  import { join } from "path";
  import { tmpdir } from "os";
  import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";

  describe("composeCreatePrompt", () => {
    it("returns base prompt content", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
      const result = composeCreatePrompt(tmpDir);
      expect(result).toContain("Pipeline Workflow Author");
    });

    it("appends Available agents section when agents exist", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
      const agentsDir = join(tmpDir, ".ralph", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, "reviewer.md"),
        `---\ndescription: Code review agent\n---\nYou review code.`,
      );
      const result = composeCreatePrompt(tmpDir);
      expect(result).toContain("Available agents");
      expect(result).toContain("reviewer");
    });

    it("does not throw when no user agents dir exists", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "compose-"));
      // no .ralph/agents dir — bundled agents may still populate the section, but no crash
      expect(() => composeCreatePrompt(tmpDir)).not.toThrow();
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm failure**

  Run: `npx vitest run src/cli/tests/pipeline-create-prompt.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement composeCreatePrompt**

  Create `src/cli/lib/pipeline-create-prompt.ts`:

  ```typescript
  import { readFileSync } from "fs";
  import { join } from "path";
  import { getPipelineCreatePromptPath } from "./assets.js";
  import { listAgents, type RegistryOptions } from "./agent-registry.js";

  function buildAgentSection(project: string): string {
    const opts: RegistryOptions = { userDir: join(project, ".ralph", "agents") };
    const agents = listAgents(opts);
    if (agents.length === 0) return "";
    const rows = agents
      .map(a => `| \`${a.name}\` | ${a.description} | ${a.source} |`)
      .join("\n");
    return [
      "",
      "## Available agents in this project",
      "",
      "Use `agent=\"name\"` to route a node to one of these agents.",
      "Prefer `agent=\"$variable_name\"` and declare the variable in `inputs=` for portability.",
      "",
      "| name | description | source |",
      "|------|-------------|--------|",
      rows,
      "",
    ].join("\n");
  }

  export function composeCreatePrompt(project: string): string {
    const base = readFileSync(getPipelineCreatePromptPath(), "utf-8");
    const agentSection = buildAgentSection(project);
    return agentSection ? base + agentSection : base;
  }
  ```

- [ ] **Step 4: Run tests to confirm passing**

  Run: `npx vitest run src/cli/tests/pipeline-create-prompt.test.ts`
  Expected: PASS all 3 tests.

- [ ] **Step 5: Wire composeCreatePrompt into pipelineCreateCommand**

  In `src/cli/commands/pipeline.ts`, update the import at the top:
  ```typescript
  import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";
  ```

  Find ~line 504-507:
  ```typescript
  const promptPath = getPipelineCreatePromptPath();
  const promptContent = readFileSync(promptPath, "utf8");

  const trigger = `${promptContent}\n\n---\nCreate a new pipeline named "${name}". Write it to: ${dotPath}`;
  ```

  Replace with:
  ```typescript
  const promptContent = composeCreatePrompt(project);

  const trigger = `${promptContent}\n\n---\nCreate a new pipeline named "${name}". Write it to: ${dotPath}`;
  ```

  Remove the now-unused `getPipelineCreatePromptPath` import from `pipeline.ts` if it's no longer referenced in that file. Run `grep -n "getPipelineCreatePromptPath" src/cli/commands/pipeline.ts` to confirm.

- [ ] **Step 5b: Update existing pipeline create tests to mock composeCreatePrompt**

  `src/cli/tests/pipeline.test.ts` and `src/cli/tests/pipeline-headless.test.ts` currently mock `getPipelineCreatePromptPath` from `../lib/assets.js` to control the prompt content. After Step 5, `pipelineCreateCommand` calls `composeCreatePrompt` instead, so those mocks no longer cover the prompt path.

  In both test files:
  1. Find the `vi.mock("../lib/assets.js", ...)` block that stubs `getPipelineCreatePromptPath`
  2. Add a `vi.mock("../lib/pipeline-create-prompt.js", ...)` block alongside or instead:
     ```typescript
     vi.mock("../lib/pipeline-create-prompt.js", () => ({
       composeCreatePrompt: vi.fn().mockReturnValue("# Test prompt"),
     }));
     ```
  3. Remove or keep the `getPipelineCreatePromptPath` mock depending on whether other code in pipeline.ts still uses it.

  Run: `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/pipeline-headless.test.ts`
  Expected: all tests pass.

- [ ] **Step 6: Build and smoke-check**

  Run: `npm run build`
  Expected: build succeeds, no TypeScript errors.

- [ ] **Step 7: Run full test suite**

  Run: `npx vitest run`
  Expected: all tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add src/cli/lib/pipeline-create-prompt.ts src/cli/tests/pipeline-create-prompt.test.ts src/cli/commands/pipeline.ts
  git commit -m "feat: inject available agents dynamically into pipeline create prompt"
  ```

---

## Chunk 4: Pipeline audit sweep

**Files:**
- Modify: `pipelines/illumination-to-plan.dot`
- Modify: `pipelines/poc-implement.dot` (if hardcoded literals found)
- Review: all other `.dot` files under `pipelines/`

Smoke pipelines (`pipelines/smoke/`) test ralph-cli internals; their hardcoded `agent="implement"` is intentional. Add `inputs=` only where the pipeline already accepts `--var` parameters.

- [ ] **Step 1: Run validate against all non-smoke pipelines**

  Run:
  ```bash
  npm run build
  for f in pipelines/*.dot; do echo "=== $f ==="; ralph pipeline validate "$f"; done
  ```
  Expected: portability_heuristic warnings surface for pipelines with hardcoded paths.

- [ ] **Step 2: Audit illumination-to-plan.dot**

  Open `pipelines/illumination-to-plan.dot`. The following are hardcoded and must be parameterized:

  - `meditations/illuminations/*.md` in `verifier` prompt → already uses `$illumination_path` in downstream nodes, but the glob pattern is hardcoded in the verifier itself. Change: replace the hardcoded glob with a comment noting the verifier discovers the file itself, or accept that `verifier` is the entry point that discovers paths (this is a design decision — verifier is the "seeder", not a caller-facing variable).
  - `docs/superpowers/specs/` in `design_writer` prompt → replace with `$specs_dir`, add `specs_dir` to `inputs=`
  - `docs/superpowers/plans/` in `plan_writer` prompt → replace with `$plans_dir`, add `plans_dir` to `inputs=`
  - `agent="implement"` on all nodes → these are intentional for ralph-cli's own workflow; add a comment documenting this is ralph-cli internal, or parameterize as `$implement_agent`

  After edits, run: `ralph pipeline validate pipelines/illumination-to-plan.dot`
  Expected: zero `portability_heuristic` warnings.

- [ ] **Step 3: Audit poc-implement.dot and structured-output-test.dot**

  Read each file. Check for hardcoded paths or agent names that are project-specific.
  Apply same substitution pattern if found.
  Run: `ralph pipeline validate pipelines/poc-implement.dot pipelines/structured-output-test.dot`

- [ ] **Step 4: Review smoke pipelines**

  Run: `for f in pipelines/smoke/*.dot; do echo "=== $f ==="; ralph pipeline validate "$f"; done`

  Smoke pipelines use `agent="implement"` intentionally (they test ralph-cli's own agent). Add a comment to each smoke pipeline explaining the hardcoded agent is intentional:
  ```dot
  // smoke: agent="implement" is intentional — tests ralph-cli's built-in agent
  ```
  No content changes needed beyond the comment. The `portability_heuristic` rule (Chunk 2) checks only `prompt` and `toolCommand` field values for hardcoded path substrings — it does NOT check `agent=` attribute values. Smoke pipelines' `agent="implement"` lines are therefore invisible to the heuristic and will pass without changes.

- [ ] **Step 5: Final validate sweep**

  Run: `find pipelines/ -name "*.dot" | while read f; do ralph pipeline validate "$f" 2>&1; done`
  Expected: zero `portability_heuristic` warnings on non-smoke pipelines.

- [ ] **Step 6: Commit**

  ```bash
  git add pipelines/
  git commit -m "fix: parameterize hardcoded ralph-cli paths in bundled pipelines for portability"
  ```

---

## Post-completion

After all 4 chunks pass:

1. Run full test suite: `npx vitest run`
2. Run: `ralph pipeline validate pipelines/illumination-to-plan.dot` — expect zero warnings
3. Confirm illumination file still exists: `ls meditations/illuminations/2026-04-15T1100-pipelines-hard-code-their-birth-project.md` — fail loudly if absent before proceeding.
4. Mark illumination dispatched via `mcp__illumination__mark_dispatched` with `filename="2026-04-15T1100-pipelines-hard-code-their-birth-project.md"` and `plan_path="docs/superpowers/plans/2026-04-16-pipeline-portability.md"`
