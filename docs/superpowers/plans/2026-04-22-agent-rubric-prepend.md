---
status: implemented
---

# Agent Rubric Prepend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the pipeline engine so an agent's rubric body is always prepended to the node's task prompt (layered, not replaced), then migrate every misuse of `agent="implement"` to the correct agent (`task` for one-shots, existing specialist agents for reference-style nodes).

**Architecture:** One-line change in `agent-handler.ts:62` turns prompt replacement into prompt layering (rubric body + separator + node task). A new empty-rubric `task.md` agent serves trivial one-shot calls. Existing specialist agents (`verifier`, `change-explainer`, etc.) gain their rubrics automatically via the engine fix, and 7 mis-declared nodes in `illumination-to-plan.dot` migrate to those existing agent files. Net effect: spider/web/plain-hands model made explicit — `implement` is the autopilot, specialist agents are web strands, `task` is the plain Claude call.

**Tech Stack:** TypeScript, vitest, gray-matter (frontmatter parser), tsup build, `.dot` pipelines parsed via `@ts-graphviz/ast`.

**Related illuminations (the motivating meditations):**
- `meditations/illuminations/2026-04-21T0600-rubric-body-dropped-in-pipeline-execution.md`
- `meditations/illuminations/2026-04-21T0700-rubric-body-is-dropped-procedure-not-replaced-task.md`
- `meditations/illuminations/2026-04-21T0800-rubric-prepend-is-harmful-for-loop-agents.md` (SUPERSEDED — user decided prepend universally)
- `meditations/illuminations/2026-04-21T0900-agent-archetype-flag-resolves-rubric-split.md` (SUPERSEDED — no flag; rename via `task.md` instead)
- `meditations/illuminations/2026-04-21T1000-follow-agent-procedure-is-broken-in-seven-nodes.md`
- `meditations/illuminations/2026-04-21T1100-two-authoring-conventions-one-engine.md`

---

## File Structure

**Created:**
- `src/cli/agents/task.md` — empty-rubric agent for one-shot calls

**Modified (engine):**
- `src/attractor/handlers/agent-handler.ts` — prompt assembly (line 59–72)
- `src/attractor/tests/agent-handler.test.ts` — new tests for rubric prepend + empty rubric

**Modified (pipelines — 26 node edits across 7 files):**
- `pipelines/illumination-to-plan.dot` — 9 nodes (7 to specialist agents + 2 to task)
- `pipelines/illumination-to-implementation.dot` — 1 node (`chat_summarizer:30` → task)
- `pipelines/gate-test.dot` — 2 nodes → task
- `pipelines/structured-output-test.dot` — 3 nodes → task
- `pipelines/smoke/agent-implement.dot` — 1 node → task
- `pipelines/smoke/agent-json-vars.dot` — 2 nodes → task
- `pipelines/smoke/conditional.dot` — 3 nodes → task
- `pipelines/smoke/gate.dot` — 2 nodes → task
- `pipelines/smoke/json-schema-stream.dot` — 1 node → task
- `pipelines/smoke/static-multi-node.dot` — 3 nodes → task
- `pipelines/smoke/tmux-tester.dot` — 1 node → tmux-tester

**Untouched (already correct):** `illumination-to-implementation.dot:38 implement`, `poc-implement.dot:9 run` — both real spider uses.

---

## Chunk 1: Engine fix — rubric body prepend

### Task 1.1: Failing test for rubric-body prepend when node supplies prompt

**Files:**
- Test: `src/attractor/tests/agent-handler.test.ts`
- Reference: existing test fixtures — look at the test around line 168 that reads `prompt.md` for injection shape.

- [ ] **Step 1: Read existing test setup to match the fixture pattern**

Run: open `src/attractor/tests/agent-handler.test.ts`. Note how the existing test at line 168 sets up an agent fixture, invokes the handler, and inspects `prompt.md`. Mirror that style.

- [ ] **Step 2: Write the failing test**

Add this test beside the existing "prepends pipeline context preamble to prompt.md" test:

```typescript
it("prepends agent rubric body before the node task prompt", async () => {
  // Agent file has a rubric body (content after frontmatter)
  const agentFile = join(tempDir, "agents", "with-rubric.md");
  mkdirSync(dirname(agentFile), { recursive: true });
  writeFileSync(
    agentFile,
    `---\nname: with-rubric\n---\n\n# Procedure\n1. First do X.\n2. Then do Y.\n`,
  );

  const node = {
    id: "n1",
    agent: "with-rubric",
    prompt: "Run the procedure on this input.",
  };

  await handler.execute(node, ctx, meta);

  const promptPath = join(logsRoot, "n1", "prompt.md");
  const rendered = readFileSync(promptPath, "utf8");

  // Rubric body must appear
  expect(rendered).toContain("# Procedure");
  expect(rendered).toContain("1. First do X.");
  expect(rendered).toContain("2. Then do Y.");

  // Node task must also appear
  expect(rendered).toContain("Run the procedure on this input.");

  // Full 4-section ordering: preamble → rubric → separator → task.
  // A regression that reorders any pair of these sections must fail this test.
  const preambleIdx = rendered.indexOf("Pipeline Context"); // preamble marker
  const rubricIdx = rendered.indexOf("# Procedure");
  // Tightened: match the exact "\n\n---\n\n" separator emitted by the handler
  // so a future rubric containing a markdown horizontal rule can't confuse the search.
  const separatorIdx = rendered.indexOf("\n\n---\n\n", rubricIdx);
  const taskIdx = rendered.indexOf("Run the procedure on this input.");

  expect(preambleIdx).toBeGreaterThanOrEqual(0);
  expect(separatorIdx).toBeGreaterThan(0);
  expect(preambleIdx).toBeLessThan(rubricIdx);
  expect(rubricIdx).toBeLessThan(separatorIdx);
  expect(separatorIdx).toBeLessThan(taskIdx);
});
```

- [ ] **Step 3: Run the test — expect FAIL**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "prepends agent rubric body"`
Expected: FAIL. The rendered prompt contains only "Run the procedure on this input." (prefixed by the preamble). The rubric body `# Procedure` is not in the output because line 62 of agent-handler.ts replaces rather than layers.

- [ ] **Step 4: Commit the failing test**

```bash
git add src/attractor/tests/agent-handler.test.ts
git commit -m "test(agent-handler): failing test for rubric body prepend"
```

### Task 1.2: Make the test pass — layer rubric + task

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts:59-72`

- [ ] **Step 1: Edit the prompt assembly block**

Current code (lines 62–63):
```typescript
const rawPrompt = node.prompt ?? node.label ?? config.prompt;
const expandedRawPrompt = expandVariables(rawPrompt, ctx.values, extractDefaults(node as unknown as Record<string, unknown>));
```

Replace with:
```typescript
const nodeTask = node.prompt ?? node.label;
const agentRubric = (config.prompt ?? "").trim();
const defaults = extractDefaults(node as unknown as Record<string, unknown>);
// Expand ONLY the node task. Rubric bodies are authored manuals —
// their literal `$var` tokens (e.g. `$run_id` in tmux-tester.md as documentation)
// must not reach expandVariables or undefined ones throw.
// Spider case (no node task) keeps the old behavior: rubric IS the template, so expand it.
const expandedTask = nodeTask ? expandVariables(nodeTask, ctx.values, defaults) : undefined;
const expandedRawPrompt = expandedTask
  ? (agentRubric ? `${agentRubric}\n\n---\n\n${expandedTask}` : expandedTask)
  : expandVariables(agentRubric, ctx.values, defaults);
```

Rationale:
- `nodeTask` = pipeline node's explicit instruction (template — should substitute `$vars`).
- `agentRubric` = agent markdown body (manual — authors use `$var` as documentation shorthand, e.g. `tmux-tester.md:32` writes "Run id: `$run_id`" to tell the reader what to expect, not as a template placeholder).
- When a task exists: expand task, keep rubric literal, layer rubric first with `---` separator. Claude reads rubric as manual, task as directive.
- When no task exists (spider case, e.g. `implement.md` autopilot): rubric IS the instruction, expand it. Preserves current behavior for spider pipelines.
- `implement.md` uses no `$var` tokens (grep-verified), so spider case is safe today; this path remains for forward compat.

- [ ] **Step 2: Run the target test — expect PASS**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "prepends agent rubric body"`
Expected: PASS.

- [ ] **Step 3: Run the entire agent-handler test file to catch regressions**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts`
Expected: all existing tests still pass. (The previous behavior "node.prompt replaces config.prompt" is not asserted anywhere — our audit confirmed no test pins the drop behavior.)

- [ ] **Step 4: Commit the fix**

```bash
git add src/attractor/handlers/agent-handler.ts
git commit -m "fix(agent-handler): layer agent rubric with node task instead of replacing"
```

### Task 1.3a: Test — rubric `$var` tokens stay literal; task `$var` tokens expand

**Why this test exists (the C1 regression):** agent markdown files like `tmux-tester.md:32` and `memory-writer.md:24` contain lines like `Run id: \`$run_id\`` as *documentation shorthand*. Before this plan, those tokens were inert because the rubric was dropped. After layering, they reach `expandVariables`, which throws `UndefinedVariableError` on any `$var` not in ctx and not a graph-level token (`$goal`, `$project`). The engine fix in Task 1.2 expands only the node task, leaving rubric literal. This test pins that behavior.

**Files:**
- Test: `src/attractor/tests/agent-handler.test.ts`

- [ ] **Step 1: Write the test**

```typescript
it("keeps rubric $var tokens literal and expands node task $var tokens", async () => {
  const agentFile = join(tempDir, "agents", "var-rubric.md");
  mkdirSync(dirname(agentFile), { recursive: true });
  // Rubric uses `$run_id` as author shorthand — must NOT be expanded/throw.
  writeFileSync(
    agentFile,
    `---\nname: var-rubric\n---\n\nRun id context: \`$run_id\` is injected at runtime.\n`,
  );

  const node = {
    id: "n1",
    agent: "var-rubric",
    prompt: "Node task references $task_var for expansion.",
  };

  // ctx supplies task_var but NOT run_id — if the rubric were expanded, this throws.
  const ctxWithVar = { ...ctx, values: { ...ctx.values, task_var: "EXPANDED_VALUE" } };

  await handler.execute(node, ctxWithVar, meta);
  const rendered = readFileSync(join(logsRoot, "n1", "prompt.md"), "utf8");

  // Rubric $run_id stays literal
  expect(rendered).toContain("$run_id");
  // Task $task_var was expanded
  expect(rendered).toContain("EXPANDED_VALUE");
  expect(rendered).not.toContain("$task_var");
});
```

- [ ] **Step 2: Run — expect PASS (engine fix in Task 1.2 already covers this)**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "keeps rubric \\$var tokens literal"`

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/agent-handler.test.ts
git commit -m "test(agent-handler): rubric \$var stays literal, task \$var expands"
```

### Task 1.3b: Test — spider case (no node task) still expands rubric

**Why:** The spider path (e.g. `implement.md` node with no `prompt=`) uses the rubric as the whole instruction. Existing pipelines rely on `$var` expansion there. Guard against future regressions that would break it.

**Files:**
- Test: `src/attractor/tests/agent-handler.test.ts`

- [ ] **Step 1: Write the test**

```typescript
it("expands $var tokens in rubric when node provides no task (spider case)", async () => {
  const agentFile = join(tempDir, "agents", "spider-rubric.md");
  mkdirSync(dirname(agentFile), { recursive: true });
  writeFileSync(
    agentFile,
    `---\nname: spider-rubric\n---\n\nSpider instruction uses $spider_var.\n`,
  );

  // Node has NO prompt/label — rubric is the only instruction.
  const node = { id: "n1", agent: "spider-rubric" };

  const ctxWithVar = { ...ctx, values: { ...ctx.values, spider_var: "SPIDER_VALUE" } };

  await handler.execute(node, ctxWithVar, meta);
  const rendered = readFileSync(join(logsRoot, "n1", "prompt.md"), "utf8");

  expect(rendered).toContain("SPIDER_VALUE");
  expect(rendered).not.toContain("$spider_var");
});
```

- [ ] **Step 2: Run — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/agent-handler.test.ts
git commit -m "test(agent-handler): spider-case rubric still expands \$vars"
```

### Task 1.3: Test — empty rubric agent passes through task cleanly

**Files:**
- Test: `src/attractor/tests/agent-handler.test.ts`

- [ ] **Step 1: Write the test**

```typescript
it("passes node task through unchanged when agent rubric is empty", async () => {
  const agentFile = join(tempDir, "agents", "empty-rubric.md");
  mkdirSync(dirname(agentFile), { recursive: true });
  writeFileSync(agentFile, `---\nname: empty-rubric\n---\n`);

  const node = {
    id: "n1",
    agent: "empty-rubric",
    prompt: "Output exactly: 'hello'.",
  };

  await handler.execute(node, ctx, meta);

  const rendered = readFileSync(join(logsRoot, "n1", "prompt.md"), "utf8");

  // Task is present
  expect(rendered).toContain("Output exactly: 'hello'.");

  // No stray separator from empty rubric
  expect(rendered).not.toContain("---\n\n---\n\n");
  expect(rendered).not.toMatch(/^\s*---\s*\n\nOutput/);
});
```

- [ ] **Step 2: Run — expect PASS (the trim() guard in Task 1.2 should already cover this)**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "passes node task through unchanged"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/agent-handler.test.ts
git commit -m "test(agent-handler): empty-rubric agent does not emit stray separator"
```

### Chunk 1 verification

- [ ] **Run full test suite**

Run: `npm test`
Expected: all green. If anything fails that didn't before, the engine change surfaced a test that silently relied on rubric-drop — investigate and fix.

---

## Chunk 2: Create `task.md` empty-rubric agent

### Task 2.1: Write task.md

**Files:**
- Create: `src/cli/agents/task.md`

- [ ] **Step 0: Preflight — ensure no stale user-home task.md shadows the bundled one**

The agent registry resolves in priority order: `.ralph/agents/<name>.md` (project) → `~/.ralph/agents/<name>.md` (user home) → bundled `dist/agents/<name>.md`. If a developer has a stale `~/.ralph/agents/task.md` from a prior experiment, it will shadow the new bundled file.

Check BOTH shadow locations (project overrides user-home, user-home overrides bundled):

```bash
ls .ralph/agents/task.md 2>/dev/null && echo "STALE (project) — investigate" || echo "project clean"
ls ~/.ralph/agents/task.md 2>/dev/null && echo "STALE (user-home) — investigate" || echo "user-home clean"
```

If "STALE PRESENT": inspect the file. If it's a leftover, remove it before proceeding. Do not silently overwrite — it may be a real user customization that predates this plan.

- [ ] **Step 1: Write the file**

Content (exact):

```markdown
---
name: task
description: One-shot Claude call with no preset procedure. Use when the pipeline node prompt already contains everything the agent needs (trivial utilities, classification, single-tool calls, smoke tests).
model: opus
permissionMode: dangerouslySkipPermissions
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
mcp: []
---
```

Body: **intentionally empty**. The trim() guard in `agent-handler.ts` detects the empty rubric and emits no separator.

- [ ] **Step 2: Sanity check — the agent registry can load it**

Run: `npx vitest run src/cli/lib/tests/agent-registry.test.ts` (if a registry test exists — check first with `ls src/cli/lib/tests/`)
Expected: pass. If no registry test covers loading, add a short smoke test that parses `task.md` and asserts `config.prompt === ""` (or whitespace).

- [ ] **Step 2a: Build and resolve preflight (blocks Chunk 3 entry)**

Before any pipeline migration can land, the bundled `task.md` MUST be loadable from `dist/`. Run:

```bash
npm run build
node -e "import('./dist/cli/lib/agent-registry.js').then(m => m.resolveAgent('task')).then(() => console.log('resolved OK'))"
```

Expected output: `resolved OK`. If this throws "Unknown agent: task", the build did not include `src/cli/agents/task.md` — check `tsup.config.ts` assets config and fix before advancing. Chunk 3 will migrate nodes to `agent="task"`; if task.md doesn't resolve from dist, every migrated pipeline fails at run time.

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/task.md
git commit -m "feat(agents): add task agent for one-shot pipeline calls"
```

---

## Chunk 3: Migrate pipelines

For every edit below: replace `agent="implement"` with the target agent in the same `[ ... ]` block. No other attribute changes unless called out.

After each file is edited, run `ralph pipeline validate <file>` to confirm it still parses clean. Commit per file (not per node) — keeps diffs reviewable and rollback granular.

### Task 3.1: illumination-to-plan.dot (9 node edits)

**File:** `pipelines/illumination-to-plan.dot`

- [ ] **Step 1: Apply edits**

| Line | Node | Old | New |
|---|---|---|---|
| 8 | `verifier` | `agent="implement"` | `agent="verifier"` |
| 10 | `explain_removal` | `agent="implement"` | `agent="change-explainer"` |
| 16 | `mark_archived` | `agent="implement"` | `agent="task"` |
| 18 | `mark_dispatched` | `agent="implement"` | `agent="task"` |
| 20 | `explainer` | `agent="implement"` | `agent="change-explainer"` |
| 24 | `chat_session` | `agent="implement"` | `agent="chat-refiner"` |
| 26 | `chat_summarizer` | `agent="implement"` | `agent="task"` |
| 28 | `design_writer` | `agent="implement"` | `agent="design-writer"` |
| 30 | `plan_writer` | `agent="implement"` | `agent="plan-writer"` |

- [ ] **Step 2: Validate**

Run: `npx ralph pipeline validate pipelines/illumination-to-plan.dot`
Expected: no errors. `portability_heuristic` warnings are acceptable if pre-existing.

- [ ] **Step 3: Commit**

```bash
git add pipelines/illumination-to-plan.dot
git commit -m "refactor(pipelines): route illumination-to-plan nodes to dedicated agents"
```

### Task 3.2: illumination-to-implementation.dot (1 node edit)

**File:** `pipelines/illumination-to-implementation.dot:30`

- [ ] **Step 1: Edit**

Change node `chat_summarizer` (line 30):
`agent="implement"` → `agent="task"`

All other nodes in this file are already correct. Do NOT touch the real spider node `implement` at line 38.

- [ ] **Step 2: Validate + commit**

```bash
npx ralph pipeline validate pipelines/illumination-to-implementation.dot
git add pipelines/illumination-to-implementation.dot
git commit -m "refactor(pipelines): chat_summarizer uses task agent, not implement"
```

### Task 3.3: Trivial pipelines — gate-test + structured-output-test

**Files:**
- `pipelines/gate-test.dot` (lines 8, 9)
- `pipelines/structured-output-test.dot` (lines 6, 8, 10)

- [ ] **Step 1: Edit — 5 occurrences total, all `agent="implement"` → `agent="task"`**

- [ ] **Step 2: Validate both files**

Run:
```bash
npx ralph pipeline validate pipelines/gate-test.dot
npx ralph pipeline validate pipelines/structured-output-test.dot
```

- [ ] **Step 3: Commit**

```bash
git add pipelines/gate-test.dot pipelines/structured-output-test.dot
git commit -m "refactor(pipelines): gate-test and structured-output-test use task agent"
```

### Task 3.4: Smoke pipelines — 12 node edits across 6 files

**Files:**
- `pipelines/smoke/agent-implement.dot:6` (`work`) → `task`
- `pipelines/smoke/agent-json-vars.dot:7,14` (`producer`, `consumer`) → `task`
- `pipelines/smoke/conditional.dot:7,16,21` (`classify`, `pass_path`, `fail_path`) → `task`
- `pipelines/smoke/gate.dot:8,13` (`proceed`, `abort`) → `task`
- `pipelines/smoke/json-schema-stream.dot:6` (`list_files`) → `task`
- `pipelines/smoke/static-multi-node.dot:6,11,16` (`node_a`, `node_b`, `node_c`) → `task`

- [ ] **Step 1: Apply 12 edits**

- [ ] **Step 2: Validate all 6 files**

Run: `for f in pipelines/smoke/agent-implement.dot pipelines/smoke/agent-json-vars.dot pipelines/smoke/conditional.dot pipelines/smoke/gate.dot pipelines/smoke/json-schema-stream.dot pipelines/smoke/static-multi-node.dot; do npx ralph pipeline validate "$f"; done`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add pipelines/smoke/agent-implement.dot pipelines/smoke/agent-json-vars.dot pipelines/smoke/conditional.dot pipelines/smoke/gate.dot pipelines/smoke/json-schema-stream.dot pipelines/smoke/static-multi-node.dot
git commit -m "refactor(pipelines): smoke nodes use task agent instead of implement"
```

### Task 3.5: smoke/tmux-tester.dot — give the smoke its own dog food

**File:** `pipelines/smoke/tmux-tester.dot:8`

Node `tmux_meditate_observer` currently uses `agent="implement"` with a self-contained tmux-driving prompt. Migrate to `agent="tmux-tester"` so the smoke exercises the very rubric-delivery path we just fixed.

- [ ] **Step 1: Edit**

Change line 8: `agent="implement"` → `agent="tmux-tester"`.

Leave the node prompt as-is. The tmux-tester rubric now arrives ahead of it, giving the agent the harness helpers and hard rules it was already assuming.

- [ ] **Step 2: Validate**

Run: `npx ralph pipeline validate pipelines/smoke/tmux-tester.dot`

- [ ] **Step 3: Commit**

```bash
git add pipelines/smoke/tmux-tester.dot
git commit -m "refactor(pipelines): tmux-tester smoke routes through tmux-tester agent"
```

---

## Chunk 4: Smoke verification — prove the fix works end-to-end

### Task 4.1: Run every smoke pipeline and capture results

**Why this matters:** unit tests prove the engine code change. Smoke runs prove the migration did not break live workflows (wrong rubric injected, stray separator, token blow-up, git side effects).

- [ ] **Step 1: Run the non-tmux smokes with pre/post cleanliness guard**

The smokes use `--project .` against the ralph-cli repo itself. A misrouted agent (e.g. a residual `agent="implement"` that still carries `git push`) would silently contaminate the branch. Guard against this: `git status --porcelain` must be empty before each run and must remain empty (or identical) after.

`gate.dot` is interactive — **skip it** in Chunk 4. Rationale: it's the only interactive smoke, pre-answering through tmux-drive is high-cost for this chunk, and its migration (2 nodes to `task`) is structurally identical to `conditional.dot` which IS covered. If a manual post-release smoke is desired, run it separately.

```bash
cd /Users/josu/Documents/projects/ralph-cli

# Snapshot clean state (porcelain + HEAD — catches commit+reset evasion)
BEFORE="$(git status --porcelain)"
HEAD_BEFORE="$(git rev-parse HEAD)"
if [ -n "$BEFORE" ]; then
  echo "ABORT: working tree not clean before smokes. Commit or stash first."
  git status --short
  exit 1
fi

# gate.dot intentionally skipped (interactive — see rationale above).
for f in pipelines/smoke/agent-implement.dot \
         pipelines/smoke/agent-json-vars.dot \
         pipelines/smoke/conditional.dot \
         pipelines/smoke/json-schema-stream.dot \
         pipelines/smoke/static-multi-node.dot; do
  echo "=== $f ==="
  npx ralph pipeline run "$f" --project .

  AFTER="$(git status --porcelain)"
  HEAD_AFTER="$(git rev-parse HEAD)"
  if [ "$AFTER" != "$BEFORE" ] || [ "$HEAD_AFTER" != "$HEAD_BEFORE" ]; then
    echo "ABORT: smoke $f contaminated working tree or advanced HEAD:"
    echo "porcelain diff: $AFTER"
    echo "HEAD before: $HEAD_BEFORE / after: $HEAD_AFTER"
    exit 1
  fi
done

echo "All 5 smokes passed; working tree still clean."
```

Expected: each run completes with a `done` Msquare node reached. Working tree unchanged at each boundary.

- [ ] **Step 2: Run the tmux smoke under the harness**

Follow `docs/harness/tmux-drive.md` to drive `pipelines/smoke/tmux-tester.dot` end-to-end. This is the **critical test** — if rubric delivery works for tmux-tester, the whole fix is validated.

Expected: `tmux_meditate_observer` node drives `ralph meditate`, produces a new illumination file, emits JSON with `topic`, `illumination_path`, `kid_summary`, `observation_notes`.

If this regresses: inspect `~/.ralph/runs/<run-id>/n1/prompt.md` and confirm the tmux-tester rubric body is present above the node task.

- [ ] **Step 3: Spot-check one `illumination-to-plan.dot` node with a dry-run**

Pick `mark_archived` (now `agent="task"`). In a scratch project, invoke the pipeline partway and confirm the MCP call still goes through — no unrelated side effects.

- [ ] **Step 4: Record results**

Append a note to `memory/` describing which smokes passed, any surprises, and final verification commit hash. The `memory-writer` agent structure fits.

### Task 4.2: Bump package version + git tag

- [ ] **Step 1: Bump patch version**

Current: `0.1.31`. New: `0.1.32`.

Edit `package.json`.

- [ ] **Step 2: Run `npm run build` — confirm no compile errors**

- [ ] **Step 3: Run `npm test` one more time — confirm all green**

- [ ] **Step 4: Commit + tag**

```bash
git add package.json
git commit -m "chore: bump version to 0.1.32 — agent rubric prepend shipped"
git tag 0.1.32
```

Do NOT push. The user pushes manually when satisfied.

---

## Non-goals (explicit YAGNI)

- No `pipeline_rubric: include|exclude` frontmatter flag. The user explicitly decided to resolve the split via renaming (`task` agent), not a flag. That illumination is marked SUPERSEDED above.
- No validator warning for "short prompt + `agent="implement"`". If a future regression reintroduces the misuse, the smoke run in Chunk 4 will catch it. Adding a heuristic validator rule is premature.
- No agent-archetype enum in the schema.
- No migration of `loop.sh` callers or the `implement` command's one-shot invocation path — those use `implement` via a different entry point (`src/cli/commands/implement.ts`), not the pipeline engine. Out of scope for this plan.
- No reauthoring of existing specialist agent files (verifier.md, design-writer.md, plan-writer.md, chat-refiner.md, change-explainer.md, memory-writer.md, tmux-tester.md). Their rubrics are already correct — they've just been unreachable until now.

---

## Rollout summary

1. Chunk 1 lands → engine layers rubric with task. No pipeline behavior changes yet because every trivial node still points at `agent="implement"`, which now prepends the full autopilot rubric (dangerous). **DO NOT STOP after Chunk 1** — smoke pipelines would start pushing junk commits.
2. Chunks 2 + 3 land → trivial nodes move off `implement` onto `task`. Specialist nodes pick up their proper agents.
3. Chunk 4 → verify end-to-end.

Sequence discipline matters. The plan is ordered so behavior is safe at every commit boundary, except between the end of Chunk 1 and the end of Chunk 3. Execute those back-to-back.

---

## Review checkpoint

After Chunk 1 + 2 + 3 are complete, dispatch `plan-document-reviewer` against this plan and the verification matrix in `meditations/illuminations/2026-04-20T2900-verification-matrix-in-plan.md` before Chunk 4.

Plan complete.
