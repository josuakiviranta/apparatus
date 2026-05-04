# Drop `llm_model` from Bundled `implement` Pipeline `inputs=` — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the spurious `llm_model` entry from `inputs=` on `src/cli/pipelines/implement/pipeline.dot:3` so `pipeline validate` stops advertising a caller-var key that no agent reads.

**Architecture:** One-token edit to a bundled `.dot` file, fronted by a TDD-style regression test that loads the bundled pipeline, runs `validateGraph`, and asserts the `required_caller_vars` diagnostic contains `scenarios_dir` and does not contain `llm_model`. No engine, schema, agent, or CLI source is touched. Single atomic commit.

**Tech Stack:** TypeScript, vitest, the existing `parseDot` / `validateGraph` plumbing in `src/attractor/core/graph.ts`. No new dependencies.

---

## Context for the executing engineer

You may have zero context for this codebase. Here is the orientation you need:

- `ralph-cli` ships bundled pipelines under `src/cli/pipelines/<name>/pipeline.dot`. The `implement` pipeline is one of them.
- A pipeline's top-level `inputs="a,b,c"` attribute declares which `--var` keys the operator must supply at runtime.
- `pipeline validate` reads that declaration and emits an info-level diagnostic with rule key `required_caller_vars` whose message lists the keys.
- The `implementer` node currently does not read `$llm_model`. The model is resolved per-node in `src/attractor/handlers/agent-handler.ts:65` from the DOT attribute `node.llmModel`, not from the runtime variable bag. The CLI auto-injects an `llm_model` variable from `--model` in `src/cli/commands/implement.ts:35` but no agent body consumes it inside the implement pipeline.
- We are leaving the CLI auto-injection alone (out of scope per the design's §2). We only delete the `llm_model` token from `inputs=` on line 3 of `pipeline.dot`.
- Sealed-history docs (the 2026-05-04 validator design, ADR-0003, ADR-0004, prior plans) are not retro-edited.

The design doc is `docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md`. Read its §2, §3, §6, §10 if anything below is unclear.

---

## File Structure

| File | Change |
|---|---|
| `src/cli/pipelines/implement/pipeline.dot` | Modify line 3: drop `llm_model,` from the `inputs=` value. |
| `src/attractor/tests/graph-required-caller-vars.test.ts` | Append one new `it(...)` case that snapshots the bundled implement pipeline's banner. |

No file is created. No file is deleted. No `tsconfig.json`, `tsup.config.ts`, `package.json`, schema definition, agent rubric, or CLI command is touched.

---

## Chunk 1: Drop `llm_model` from `inputs=` on the bundled implement pipeline

This chunk contains the entire change. There is no Chunk 2.

### Task 1.1: Add a regression test that fails on the current pipeline shape

**Files:**
- Modify: `src/attractor/tests/graph-required-caller-vars.test.ts` (append one `it(...)` case to the existing `describe(...)` block — the file currently ends at line 200 with `});`).

**Why a test first:** Per the writing-plans skill (TDD: red → green → refactor → commit), we want a failing test that captures the bug before we fix it. Existing cases in this file cover the rule generically; this case pins the bundled pipeline's banner specifically and prevents re-introduction. The design doc §2 marks this test as optional; we are choosing to add it because the cost is one `it(...)` block and the value is a permanent guard.

**ESM context (read before editing):** `package.json` has `"type": "module"` and `tsconfig.json` uses `"module": "ESNext"` with `"moduleResolution": "bundler"`. The test file is therefore native ESM — neither `require()` nor `__dirname` is available. The new test must use top-level ES imports and `import.meta.url` for path resolution. The existing test file already imports `writeFileSync, mkdirSync` from `"fs"` and `join` from `"path"`; we will widen both imports rather than adding duplicate import statements.

- [x] **Step 1: Read the current state of the test file**

Run: `cat src/attractor/tests/graph-required-caller-vars.test.ts | tail -5`

Expected output ends with the last test's closing brace and the file's closing `});`. The existing file is 200 lines. Confirm the final two lines are the closing brace of the last `it(...)` and the closing `});` of the `describe(...)` block.

- [x] **Step 2a: Widen the existing `fs` and `path` imports to add `readFileSync`, `dirname`, `resolve`, plus `fileURLToPath` from `url`**

Use the `Edit` tool on `src/attractor/tests/graph-required-caller-vars.test.ts`.

`old_string`:
```
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";
```

`new_string`:
```
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseDot, validateGraph } from "../core/graph.js";
```

- [x] **Step 2b: Append the new failing test case to the `describe(...)` block**

Use the `Edit` tool on `src/attractor/tests/graph-required-caller-vars.test.ts` to replace the file's final `});` (the closing of the `describe(...)` block) with the new test plus the same closing brace.

`old_string`:
```
  it("excludes tool-node produces= keys and agent default_<key>= vars from required_caller_vars", () => {
    const dir = join(tmpdir(), `req-caller-vars-6-${Date.now()}`);
    setupAgents(dir, {
      "consumer.md": `---
name: consumer
description: needs sha and max_iterations
inputs:
  - tool_node.sha
  - max_iterations
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      tool_node [type="tool",
                 cwd=".",
                 tool_command="printf '{\\"sha\\":\\"abc\\"}\\n'",
                 produces_from_stdout="true",
                 produces="sha"]
      c [agent="consumer", default_max_iterations="0"]
      done [shape=Msquare]
      start -> tool_node -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    // tool_node.sha is produced via produces="sha"; max_iterations is silenced
    // via default_max_iterations="0" on the consumer. Neither should appear.
    expect(info).toBeUndefined();
  });
});
```

`new_string`:
```
  it("excludes tool-node produces= keys and agent default_<key>= vars from required_caller_vars", () => {
    const dir = join(tmpdir(), `req-caller-vars-6-${Date.now()}`);
    setupAgents(dir, {
      "consumer.md": `---
name: consumer
description: needs sha and max_iterations
inputs:
  - tool_node.sha
  - max_iterations
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      tool_node [type="tool",
                 cwd=".",
                 tool_command="printf '{\\"sha\\":\\"abc\\"}\\n'",
                 produces_from_stdout="true",
                 produces="sha"]
      c [agent="consumer", default_max_iterations="0"]
      done [shape=Msquare]
      start -> tool_node -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    // tool_node.sha is produced via produces="sha"; max_iterations is silenced
    // via default_max_iterations="0" on the consumer. Neither should appear.
    expect(info).toBeUndefined();
  });

  it("bundled implement pipeline lists scenarios_dir and not llm_model", () => {
    // Snapshot guard for the bundled implement pipeline's [required_caller_vars]
    // banner. After the inputs= edit on pipeline.dot:3, llm_model is no longer a
    // declared input and must not appear in the diagnostic message; scenarios_dir
    // remains the sole caller-supplied key.
    const here = dirname(fileURLToPath(import.meta.url));
    const pipelinePath = resolve(here, "..", "..", "cli", "pipelines", "implement", "pipeline.dot");
    const dot = readFileSync(pipelinePath, "utf8");
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dirname(pipelinePath));
    const info = diags.find(d => d.rule === "required_caller_vars");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
    expect(info!.message).toContain("scenarios_dir");
    expect(info!.message).not.toContain("llm_model");
  });
});
```

Path-resolution note: the test file lives at `src/attractor/tests/graph-required-caller-vars.test.ts`. From its directory (`src/attractor/tests/`), the bundled pipeline at `src/cli/pipelines/implement/pipeline.dot` is reached via `../../cli/pipelines/implement/pipeline.dot`. Verify this by running `ls src/cli/pipelines/implement/pipeline.dot` after the edit — if the file is not found at runtime, the relative depth is wrong.

- [x] **Step 3: Run the new test in isolation and confirm it fails on the current pipeline**

Run: `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts -t "bundled implement pipeline lists scenarios_dir and not llm_model"`

Expected: FAIL. The failure message will read along the lines of `expected '... llm_model, scenarios_dir' not to contain 'llm_model'`. This proves the test exercises the right surface and that the bundled pipeline currently exhibits the bug.

If the test passes here instead of failing, stop and investigate — either the test is targeting the wrong file, or the pipeline already shipped without `llm_model` and this plan is moot.

### Task 1.2: Drop `llm_model` from the bundled pipeline's `inputs=`

**Files:**
- Modify: `src/cli/pipelines/implement/pipeline.dot:3`

- [x] **Step 4: Confirm there is no consumer of `$llm_model` inside the implement pipeline directory**

Run (use the Grep tool, or shell `grep -r`):

`Grep` with `pattern: "\\$llm_model"`, `path: "src/cli/pipelines/implement/"`.

Expected: no matches. This is the safety check the design's §2 and the illumination's step 1 require. If any match is returned, STOP — the design's premise (no node consumes `$llm_model`) is invalidated and you must escalate to the user before proceeding.

- [x] **Step 5: Edit the pipeline file**

Use the `Edit` tool on `src/cli/pipelines/implement/pipeline.dot`.

`old_string`:
```
  inputs="llm_model,scenarios_dir"
```

`new_string`:
```
  inputs="scenarios_dir"
```

There is exactly one occurrence in the file. The edit is byte-precise: drop `llm_model,` (eight characters plus the comma) from the value of `inputs=`. Whitespace (the two-space indent before `inputs=`) and the closing quote stay byte-identical. Line 3 in the file is the only line that changes.

- [x] **Step 6: Re-read the file to verify the edit**

Run: `sed -n '1,5p' src/cli/pipelines/implement/pipeline.dot`

Expected output:
```
digraph implement {
  goal="Autonomous implementation loop"
  inputs="scenarios_dir"

  start [shape=Mdiamond]
```

Line 3 now reads `  inputs="scenarios_dir"` and nothing else has changed.

- [x] **Step 7: Confirm `llm_model` is no longer mentioned anywhere in the file**

`Grep` with `pattern: "llm_model"`, `path: "src/cli/pipelines/implement/pipeline.dot"`.

Expected: zero matches. (The other implement-pipeline files — agents, prompts — were already free of `llm_model`; this is a final paranoia check.)

### Task 1.3: Run the regression test, then the full suite, then `tsc`

- [x] **Step 8: Run the new test alone — it should now pass**

Run: `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts -t "bundled implement pipeline lists scenarios_dir and not llm_model"`

Expected: 1 passed.

- [x] **Step 9: Run the entire `graph-required-caller-vars.test.ts` file**

Run: `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts`

Expected: 7 passed (the 6 pre-existing cases plus the new one). Zero failures, zero skipped.

- [x] **Step 10: Run the full vitest suite**

Run: `npx vitest run`

Expected: all tests pass with the same count as `main` plus one (the new case). Zero new failures.

If any unrelated test fails, that failure is a sign of an unexpected coupling — the design's §6 explicitly flags this as something to investigate before merge. Do not paper over it.

- [x] **Step 11: Run TypeScript no-emit check**

Run: `npx tsc --noEmit`

Expected: clean exit, zero diagnostic output. The edit is `.dot` syntax with no TypeScript surface; `tsc` is a sanity check that the test file's appended ESM imports and the new `it(...)` body type-check cleanly.

### Task 1.4: Manual smoke — run `pipeline validate` against the edited pipeline

This step exercises the operator-facing surface the design doc §10.3 names. It catches any divergence between the unit-test view of the pipeline and the actual built/distributed view.

- [x] **Step 12: Build the project so `dist/` reflects the edit**

Run: `npm run build`

Expected: `tsup` completes successfully and the bundled assets are copied into `dist/pipelines/implement/pipeline.dot`. (The smoke test at `src/cli/tests/smoke/implement-pipeline-smoke.dot` documents this copy step.) Zero build errors.

- [x] **Step 13: Run `pipeline validate` against the edited pipeline**

Run: `node dist/cli/index.js pipeline validate src/cli/pipelines/implement/pipeline.dot`

Expected: among the diagnostics emitted, the `[required_caller_vars]` info banner reads exactly:

```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
scenarios_dir
```

Specifically:
- `scenarios_dir` is present.
- `llm_model` is **not** present.
- The total list contains exactly one key.

If the banner still mentions `llm_model`, the build step did not pick up the edit — verify `dist/pipelines/implement/pipeline.dot` contains the new `inputs="scenarios_dir"` line, rebuild if not.

- [x] **Step 14: (Optional, defensive) Re-validate via the bundled-fallback path**

Run: `node dist/cli/index.js pipeline validate dist/pipelines/implement/pipeline.dot`

Expected: same banner shape as Step 13. If this differs from Step 13, the `tsup onSuccess` copy did not propagate the edit — investigate before continuing.

### Task 1.5: Commit

- [x] **Step 15: Stage exactly the two changed files**

Run:
```bash
git add src/cli/pipelines/implement/pipeline.dot src/attractor/tests/graph-required-caller-vars.test.ts
```

- [x] **Step 16: Confirm the staged diff is exactly what is expected**

Run: `git diff --cached --stat`

Expected: exactly two files listed (`src/attractor/tests/graph-required-caller-vars.test.ts` and `src/cli/pipelines/implement/pipeline.dot`). The pipeline file shows `2 +/-` (one removed, one added on line 3); the test file shows ~20-ish insertions for the appended `it(...)` case plus the widened `import` lines. Exact line counts may vary by a line or two — focus on file identities, not the precise count.

Run: `git diff --cached src/cli/pipelines/implement/pipeline.dot`

Expected diff: exactly one line removed and one line added on line 3, where the only change is `llm_model,` (with trailing comma) being deleted. No other line in the file is touched.

If the diff includes any other file, any other line in `pipeline.dot`, or any reformat of `graph-required-caller-vars.test.ts` beyond the one appended `it(...)` case, unstage and redo — this commit must tell exactly the one-line story the design doc promises.

- [x] **Step 17: Commit with a message that ties the diff to the illumination and design**

Run:
```bash
git commit -m "$(cat <<'EOF'
fix(validator): drop llm_model from bundled implement pipeline inputs=

The implement pipeline's `inputs="llm_model,scenarios_dir"` declared
llm_model as a caller-supplied input, but no node under
src/cli/pipelines/implement/ reads $llm_model — the model is resolved
from the per-node DOT attribute in agent-handler.ts. The validator's
[required_caller_vars] banner therefore lied: operators saw a key they
could never meaningfully supply.

Drop llm_model from the inputs= declaration so the banner shrinks to
the one actually-caller-supplied key (scenarios_dir from --scenarios).
CLI auto-injection at src/cli/commands/implement.ts:35 is left alone
per the design's scope; the variable bag will keep carrying an unread
llm_model entry but the digraph stops advertising it.

Add a snapshot test against re-introduction.

Refs:
- meditations/illuminations/2026-05-04T1648-drop-llm-model-from-bundled-implement-pipeline.md
- docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [x] **Step 18: Confirm the commit landed and the working tree is clean**

Run: `git status` and `git log -1 --stat`

Expected: working tree clean; the new commit shows exactly two files changed with the line counts from Step 16. No untracked files relevant to this change.

## Verification targets

- Smokes: `src/cli/tests/smoke/implement-pipeline-smoke.dot` (existing — touches the same bundled pipeline; should continue to pass without edit)
- Manual exercises: `node dist/cli/index.js pipeline validate src/cli/pipelines/implement/pipeline.dot` — banner must list `scenarios_dir` only; `node dist/cli/index.js pipeline validate dist/pipelines/implement/pipeline.dot` — same shape, defensive fallback check
- Lint: `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts`; `npx vitest run`; `npx tsc --noEmit`
- Surfaces touched: bundled pipeline (`src/cli/pipelines/implement/pipeline.dot`) — `pipeline validate` operator-facing banner output. No CLI surface, no schema surface, no agent surface, no engine run-path surface.

---

## Notes on what is intentionally not in this plan

These items are out of scope per the chat refinements logged on 2026-05-04 and the design doc §2. Do not add them in this plan; surface them separately if you believe they are needed.

- **Removing the CLI auto-injection at `src/cli/commands/implement.ts:33-36`** — the `...(options.model ? { llm_model: options.model } : {})` line is left untouched. A separate follow-up illumination (referenced in the design's §9) will decide whether to drop it, wire `llm_model="$llm_model"` onto the `implementer` node, or keep it as documented future-extension scaffolding.
- **Retroactive edits to sealed-history docs** — the 2026-05-04 validator design (`docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md`), ADR-0003 (`docs/adr/0003-attractor-pipeline-runtime.md`), ADR-0004, and any prior plan that quotes the older `inputs=` shape are dated history and must not be edited as part of this work.
- **README.md changes** — only edit if a verbatim quote of the implement pipeline's `[required_caller_vars]` banner exists in `README.md` (per the design's §6 ripple checklist). If absent, no edit. Quick check: `grep -n llm_model README.md`. If zero hits, skip.
- **CONTEXT.md changes** — none. No domain-language change.

## Open questions

None at plan time. The design's §9 surfaces one informational finding for a future illumination (the `--model` flag is currently dead in the implement pipeline) — that finding does not change anything in this plan.
