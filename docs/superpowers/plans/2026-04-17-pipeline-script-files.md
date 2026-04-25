---
status: implemented
date: 2026-04-17
design_doc: docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md
execution_style: subagent-driven, red/green TDD (per CLAUDE.md)
---

# Implementation Plan — Pipeline Script Files

Implements the design at `docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md`.

## Execution rules

- **TDD discipline.** Every chunk begins with RED tests that fail for the right reason, then GREEN implementation. No implementation before tests compile and fail.
- **One chunk, one commit.** Each chunk lands as a single commit with the message specified below. Commit bodies summarise the scope and link back to this plan.
- **Full suite per chunk.** Before committing a chunk, run `npm run build && npx vitest run`. Both must be clean.
- **Review checkpoint per chunk.** After commit, summarise what landed for the reviewer. Do not start the next chunk until acknowledged.
- **Do not push.** `git push` happens after the reviewer approves the whole series.
- **Subagent-driven.** Per `CLAUDE.md`, spawn subagents for exploration, verification, and independent sub-tasks within each chunk.

## Chunk map

| # | Scope | Primary files touched | LOC est. |
|---|-------|-----------------------|----------|
| 1 | Engine: `script_file=` + `script_args=` dispatch | `src/attractor/handlers/tool.ts`, tests | ~150 |
| 2 | Engine: `produces_from_stdout=true` capture | `src/attractor/handlers/tool.ts`, tests | ~80 |
| 3 | Validator: four new rules, pass `dotDir` | `src/attractor/core/graph.ts`, `src/cli/commands/pipeline.ts`, tests | ~200 |
| 4 | Authoring prompt: tool-node side-effects section | `src/cli/prompts/PROMPT_pipeline_create.md`, tests | ~40 |
| 5 | Migrate `mark_dispatched` to `script_file=` | `pipelines/illumination-to-implementation.dot`, `pipelines/scripts/mark-dispatched.mjs`, script tests | ~80 |
| 6 | Docs | `README.md`, `specs/commands.md`, possibly `specs/architecture.md` | ~30 |

Total: ~580 LOC across 6 commits. Each chunk is independently shippable.

---

## Chunk 1 — Engine: `script_file=` + `script_args=` dispatch

**Goal.** Tool nodes with `script_file=` run the referenced file through the correct interpreter, with argv from variable-expanded `script_args`. Mutual exclusion with `tool_command=` enforced at handler level.

### Tasks

1.1 **Inspect the tool-handler test file.** Locate the existing tool-handler tests (likely `src/attractor/tests/tool-handler.test.ts` or co-located). If none, create `src/attractor/tests/tool-handler.test.ts`. Note the existing test patterns (vitest, `spawnSync` mocking).

1.2 **Write RED tests.** In the tool-handler test file, add a `describe("script_file dispatch", …)` block covering:
- `.mjs` path is dispatched as `node <resolved> <expanded args>`.
- `.ts` path is dispatched as `node --import tsx <resolved> <expanded args>`.
- `.sh` path is dispatched as `bash <resolved> <expanded args>`.
- `.py` path is dispatched as `python3 <resolved> <expanded args>`.
- Unsupported extension (`.rb`) returns a failing `Outcome` with `failureReason: /unsupported_script_extension/`.
- `script_args` undergoes `expandVariables()` with node context values.
- Relative `script_file` resolves against `meta.dotDir` (not process cwd).
- Exit code 0 → `status: "success"`, stdout in `contextUpdates["tool.output"]`.
- Exit code non-zero → `status: "fail"`, both `stdout` and `stderr` populated.
- Both `script_file` and `tool_command` present → `status: "fail"`, `failureReason: /script_command_conflict/`.

Run tests: expect failures pointing at missing implementation.

1.3 **Implement GREEN.** Extend `src/attractor/handlers/tool.ts`:
- Add `const SCRIPT_INTERPRETERS: Record<string, (path: string) => string>` mapping `.mjs|.js|.cjs → "node"`, `.ts|.mts → "node --import tsx"`, `.sh|.bash → "bash"`, `.py → "python3"`.
- Branch at the top: if `node.scriptFile` present, build the interpreter command (resolve path via `resolve(meta.dotDir, scriptFile)`, pick interpreter by extension, expand args via `expandVariables`, concatenate). If `node.toolCommand` also present → early-return failure with `script_command_conflict`.
- Falls through to existing `tool_command` path when `scriptFile` is absent — no change to current behavior.

1.4 **Run the suite.** `npm run build && npx vitest run`. Must be GREEN across all files, not just the new tests.

1.5 **Commit.**

```
feat(engine): add script_file= and script_args= attributes to tool nodes

Tool nodes may now reference an external script file instead of embedding
shell logic inline. Interpreter is chosen by extension (.mjs/.js/.cjs,
.ts/.mts, .sh/.bash, .py). Args are variable-expanded via the shared
helper. script_file and tool_command are mutually exclusive.

Refs docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

1.6 **Review checkpoint.** Report to user: file diff stats, test count added, any surprise findings.

---

## Chunk 2 — Engine: `produces_from_stdout=true` capture

**Goal.** When the attribute is set, the tool handler parses the last non-empty line of stdout as JSON and flattens its top-level keys into `contextUpdates`. `tool.output` is still populated with the raw stdout.

### Tasks

2.1 **Write RED tests** in the same tool-handler test file:
- `produces_from_stdout=true` + stdout `"hello\n{\"a\":1,\"b\":2}\n"` → `contextUpdates` contains `a: 1`, `b: 2`, AND `"tool.output": "hello\n{\"a\":1,\"b\":2}\n"`.
- `produces_from_stdout=true` + stdout without valid JSON on last line → warning logged, `contextUpdates` unchanged except `"tool.output"`. Node status still reflects exit code.
- `produces_from_stdout=true` + empty stdout → no crash, no keys added, node status unaffected.
- Absence of `produces_from_stdout` → stdout never parsed (regression check for existing tool nodes).

2.2 **Implement GREEN.** In the result-mapping path of `tool.ts`:
- After capturing stdout, if `node.producesFromStdout === true` (or `"true"` since attributes arrive as strings — check existing coercion patterns in `graph.ts`), take the last non-empty line, attempt `JSON.parse` inside a try/catch. On success, spread parsed object's top-level keys into `contextUpdates`. On failure, emit a warning via the existing logger and leave context unchanged.
- Continue to emit `"tool.output": stdout` regardless.

2.3 **Edge case check (subagent).** Spawn a subagent to verify (a) how agent-handler flattens JSON output into `contextUpdates` today (`agent-handler.ts:208-235`) and (b) whether we should use the node ID as a prefix (like agent nodes do) or flatten flat. Design doc leaves this slightly open — the subagent should read the agent-handler code and decide based on existing convention for parity. If agent uses `<nodeId>.<key>`, do the same here.

2.4 **Run suite.** `npm run build && npx vitest run` — GREEN across the board.

2.5 **Commit.**

```
feat(engine): capture last-line JSON stdout via produces_from_stdout

When a tool node sets produces_from_stdout=true, the handler parses the
last non-empty line of stdout as JSON and flattens the top-level keys
into contextUpdates, mirroring how agent nodes with json_schema_file=
populate context. tool.output is still emitted for compatibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

2.6 **Review checkpoint.**

---

## Chunk 3 — Validator: four new rules + `dotDir` threading

**Goal.** `ralph pipeline validate` catches inline-script smell, missing script files, conflicting attributes, and unsupported interpreters.

### Tasks

3.1 **Write RED tests** in the existing graph-validator test file (locate via grep for `validateGraph`; likely `src/attractor/tests/graph.test.ts`). Cover:
- `inline_script_smell` warning on `tool_command="node -e '...'"`.
- `inline_script_smell` warning on `tool_command="python -c ..."`.
- `inline_script_smell` warning on `tool_command="bash -c ..."`.
- `inline_script_smell` warning on heredoc marker.
- `inline_script_smell` warning when `tool_command` length > 120 chars post-expansion. Boundary: 120 = no warning, 121 = warning.
- No warning for short commands (`cd $project && git push`).
- `script_file_exists` error when `script_file="scripts/missing.mjs"` and file absent.
- No `script_file_exists` error when file present (use a fixture file in `src/attractor/tests/fixtures/pipelines/`).
- `script_command_conflict` error when both `script_file` and `tool_command` set.
- `unsupported_script_extension` error on `.rb`.
- No error on supported extensions.
- `validateGraph(graph)` (no `dotDir` arg) must not throw — skip the path-existence check gracefully.

3.2 **Implement GREEN.** In `src/attractor/core/graph.ts`:
- Change signature: `validateGraph(graph: Graph, dotDir?: string): Diagnostic[]`.
- Near the existing `portability_heuristic` pass, iterate nodes with `resolveHandlerType(node) === "tool"` and push diagnostics per the design doc's rule table.
- For `script_file_exists`: only run when `dotDir` is truthy AND `node.scriptFile` set. Use `existsSync(resolve(dotDir, node.scriptFile))`.
- For length check in `inline_script_smell`: apply AFTER attempting variable expansion against an empty context (so `$foo` literals count at full length, avoiding false negatives when vars expand to short strings at runtime).

3.3 **Wire `dotDir` through the CLI.** Update `pipelineValidateCommand` in `src/cli/commands/pipeline.ts` to pass `dirname(absPath)` as the second arg to `validateGraph`. Add a unit test ensuring the command passes it correctly.

3.4 **Run suite.** `npm run build && npx vitest run` — GREEN.

3.5 **Manual smoke.** Run `ralph pipeline validate pipelines/illumination-to-implementation.dot` — confirm `inline_script_smell` fires on the broken `mark_dispatched` node (from the failed refine). This is the motivating smoke; it should turn the warning red before Chunk 5 fixes the underlying file.

3.6 **Commit.**

```
feat(validate): rules for script_file= and inline-script smell

Adds four validator diagnostics:
- inline_script_smell (warning) — catches node -e / python -c / bash -c /
  heredoc / >120-char values in tool_command=.
- script_file_exists (error) — script_file= must resolve to a real file.
- script_command_conflict (error) — mutually exclusive with tool_command=.
- unsupported_script_extension (error) — only .mjs/.js/.cjs/.ts/.mts/.sh
  /.bash/.py accepted.

validateGraph now accepts an optional dotDir for path resolution; CLI
wires it through from the parsed .dot file's directory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

3.7 **Review checkpoint.**

---

## Chunk 4 — Authoring prompt: tool-node side-effects section

**Goal.** Every future `pipeline create` and `pipeline refine` session inherits the guidance to externalise scripts.

### Tasks

4.1 **Write RED tests.** In `src/cli/tests/pipeline-create-prompt.test.ts`, add `toContain` assertions for anchor phrases:
- `"Tool-node side effects"`
- `"script_file="`
- `"Do not inline"` (or similar — match whatever phrasing lands in 4.2 exactly)
- `"process.argv"` or `"$1 $2"` — whichever demonstrates argv usage.

Run tests — they fail because the prompt template doesn't yet contain those phrases.

4.2 **Implement GREEN.** Insert the "Tool-node side effects" section into `src/cli/prompts/PROMPT_pipeline_create.md`, between "Portability rule" (line 89) and "Edge attributes" (line 91). Content per design doc §"Authoring prompt changes".

4.3 **Verify via harness (optional but recommended).** Skip CI and run:
```bash
ralph pipeline create /tmp/throwaway-project
```
Abort the Claude session immediately after it prints the system prompt — confirm the new section appears. Delete `/tmp/throwaway-project`.

4.4 **Run suite.**

4.5 **Commit.**

```
feat(prompt): steer pipeline authors toward script_file= for complex tool nodes

Adds a "Tool-node side effects" section to PROMPT_pipeline_create.md
(shared by create and refine) instructing agents to use script_file=
instead of inline node -e / python -c / bash -c commands. Fixes the
class of bug encountered in run 880388e1 where the refine agent
produced an unparseable DOT attribute via an inline Node one-liner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

4.6 **Review checkpoint.**

---

## Chunk 5 — Migrate `mark_dispatched` to `script_file=`

**Goal.** The broken `pipelines/illumination-to-implementation.dot` is restored to validating state. `mark_dispatched` becomes the first real consumer of the new pattern.

### Tasks

5.1 **Revert the bad refine diff.** Inspect current `pipelines/illumination-to-implementation.dot` diff (broken by the earlier refine run). Hand-edit `mark_dispatched` and the implement self-edge block to reach a good state. **Keep** the `implement` node's `max_retries=1, retry_target="implement"` attributes (engine-level retry is valuable). **Remove** the broken inline Node one-liner on `mark_dispatched`.

5.2 **Write `pipelines/scripts/mark-dispatched.mjs`.** Standalone ES module:

```js
import fs from "node:fs";

const [, , illuminationPath, planPath] = process.argv;
if (!illuminationPath || !planPath) {
  console.error("usage: mark-dispatched.mjs <illumination> <plan>");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const raw = fs.readFileSync(illuminationPath, "utf8");
const parts = raw.split("---\n");
if (parts.length < 3) {
  console.error("no frontmatter");
  process.exit(1);
}

const statusMatch = parts[1].match(/status:\s*(.+)\n/);
const status = statusMatch ? statusMatch[1].trim() : "";
if (status !== "open") {
  console.error(`status not open: ${status}`);
  process.exit(1);
}

const frontmatter =
  parts[1].replace(/status:\s*open\n/, "status: dispatched\n") +
  `dispatched_at: ${today}\n` +
  `plan_path: ${planPath}\n`;

fs.writeFileSync(
  illuminationPath,
  `---\n${frontmatter}---\n${parts.slice(2).join("---\n")}`,
);
console.log(JSON.stringify({ marked_dispatched: illuminationPath }));
```

Note the last line is single-line JSON so a future `produces_from_stdout=true` enablement works.

5.3 **Update the node declaration** in `illumination-to-implementation.dot`:

```dot
mark_dispatched [type="tool",
                 script_file="scripts/mark-dispatched.mjs",
                 script_args="$illumination_path $plan_path"]
```

(Note: uses `$plan_path` which is produced by `plan_writer`. The old prompt used `$design_doc_path` — but the state-machine semantics say "plan is what makes the illumination dispatched". Decide during the chunk based on `specs/mcp-illumination.md` — whichever path matches the illumination frontmatter convention.)

5.4 **Write script tests.** Create `pipelines/scripts/tests/mark-dispatched.test.mjs` (vitest or plain Node — pick to match existing repo convention). Fixtures in `pipelines/scripts/tests/fixtures/`:
- `open.md` — status: open → after run, status: dispatched + dispatched_at + plan_path appended. Exit 0.
- `dispatched.md` — already dispatched → exit 1, stderr `"status not open: dispatched"`.
- `no-frontmatter.md` → exit 1, stderr `"no frontmatter"`.

Wire these into the existing vitest config if not auto-discovered.

5.5 **Run validator.** `ralph pipeline validate pipelines/illumination-to-implementation.dot` — must be clean (all green, no `inline_script_smell` warning on `mark_dispatched`).

5.6 **Run full suite + build.** `npm run build && npx vitest run` — GREEN.

5.7 **Scenario smoke (optional).** If a scenario test exists for the illumination pipeline, run it. Otherwise skip — full pipeline execution requires API credits.

5.8 **Commit.**

```
feat(pipeline): migrate mark_dispatched to script_file=

Restores pipelines/illumination-to-implementation.dot to validating
state by replacing the inline Node one-liner on mark_dispatched (which
broke DOT tokenization in run 880388e1) with an externalised script at
pipelines/scripts/mark-dispatched.mjs. First real consumer of the new
script_file= attribute.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

5.9 **Review checkpoint.**

---

## Chunk 6 — Docs

**Goal.** Authors and reviewers can find the new pattern without reading the design doc.

### Tasks

6.1 **README.** Add a paragraph under the pipeline section describing `pipelines/scripts/` and pointing to the design doc.

6.2 **`specs/commands.md`.** If this file documents the `.dot` attribute surface, add a one-liner for `script_file=`, `script_args=`, `produces_from_stdout=`.

6.3 **`specs/architecture.md`.** If this file describes the pipeline engine, add one line noting tool nodes can externalise scripts. Skip if the file doesn't cover this level of detail.

6.4 **No tests required** — these files are not behaviourally loaded.

6.5 **Commit.**

```
docs: document script_file= pipeline attribute

Adds README + specs references for the new pipeline script-files
pattern. Design rationale lives in
docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

6.6 **Review checkpoint.**

---

## Post-series tasks (not chunks)

After the series lands and the reviewer approves:

- `git push origin main` — pushes Chunks 1-6 plus the four prior commits (`668a03b`, `335c957`, `be53a97`, `6ddc5c6`) still sitting locally.
- Optionally refine another pipeline (`mark_archived` in the same file has the same silent-MCP problem) using the new pattern. Not in this plan's scope.
- Prune the 77 leaked scratch dirs (`compose-*`, `ralph-preflight-*`, `ralph-list-*`, `S-*`) in the project root:

  ```bash
  ls -d compose-* ralph-preflight-* ralph-list-* S-* 2>/dev/null | xargs rm -rf
  ```

## Risks & mitigations

- **Hidden consumers of `validateGraph(graph)` single-arg signature.** Mitigation: `dotDir` is optional; old callers keep working.
- **`tsx` may not be a project dep, breaking `.ts` interpreter path.** Mitigation: Chunk 1 includes a test that asserts a clear failure message when `tsx` can't be resolved. Alternative: ship `.mjs` only in v1, add `.ts` in a follow-up if ever needed. Decide during Chunk 1.
- **Existing pipelines that legitimately use `node -e`.** Mitigation: `inline_script_smell` is a warning, not an error. Audit via `grep -l "tool_command.*node -e\|tool_command.*-c '"` — zero matches today besides the broken one.
- **`produces_from_stdout` key-name clashes.** Two nodes both emitting top-level `success` would collide. Mitigation: Chunk 2 subagent decides whether to prefix with node ID (aligning with agent-handler convention).

## Verification trail

Same evidence as design doc §"Verification evidence". No new verification required before starting Chunk 1 — the parser/handler/validator/prompt internals are already mapped.
