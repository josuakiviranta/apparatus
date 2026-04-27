# Memory Reflector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `memory-reflector` agent node at the tail of `illumination-to-implementation.dot` that reads the just-written session memory and either surfaces one new illumination or skips cleanly, closing the project-memory feedback loop.

**Architecture:** The reflector is a pure agent node — no new TypeScript code. It is wired between `memory_writer` and `done`. Inputs flow via existing pipeline context variables (`$run_id`, `$memory_path`, `$design_doc_path`, `$plan_path`, `$illumination_path`). Output is a structured JSON `{illumination_path: string|null, reasoning: string}`. Idempotency is rubric-level (glob illuminations, grep body for the run id). Provenance is body-only (frontmatter shape stays identical to meditate-written illuminations). Failures propagate noisy; users recover via `--resume`.

**Tech Stack:** Markdown agent definitions with YAML frontmatter, JSON Schema, GraphViz DOT, vitest, MCP illumination server.

---

## Locked design decisions

| # | Decision | Locked value |
|---|---|---|
| 1 | Activation | Always run after `memory_writer`; rubric tells the agent to skip-fast on clean runs |
| 2 | Insight universe | Anything illumination-worthy — bugs, drift, ergonomics, refactor hints. Downstream verifier + human gate filter quality. |
| 3 | Illuminations per run | Zero or one. Forces synthesis. |
| 4 | Inputs | Memory file + design + plan + (original) illumination paths |
| 5 | Failure mode | Noisy fail-early; user fixes and `--resume`s |
| 6 | Model | opus |
| 7 | Provenance | `## Provenance` section in body — frontmatter unchanged from meditate writers |
| 8 | Skip-fast criteria | Enumerated signals (no `Learnings from the run`, no retries, drift unmentioned, routine decisions) |
| 9 | Output schema | Symmetric `{illumination_path: string \| null, reasoning: string}` |
| 10 | Idempotency | Glob illuminations, grep body for `Pipeline run id: $run_id`; skip if found |

## File map

- Create: `pipelines/schemas/memory-reflector.json`
- Create: `src/cli/agents/memory-reflector.md`
- Modify: `pipelines/illumination-to-implementation.dot` (add node + reroute final edge)
- Create: `specs/memory-reflector.md` (spec note documenting the new node)

No code changes required — all behavior is rubric-driven.

---

## Chunk 1: Schema and agent definition

### Task 1.1: Create the structured-output JSON schema

**Files:**
- Create: `pipelines/schemas/memory-reflector.json`
- Test: `src/cli/tests/pipeline-schema-descriptions.test.ts` (existing — auto-discovers new schemas)

- [x] **Step 1: Write the schema file**

```json
{
  "type": "object",
  "properties": {
    "illumination_path": {
      "type": ["string", "null"],
      "description": "Absolute path to the illumination written for this run, or null when no illumination-worthy insight was surfaced."
    },
    "reasoning": {
      "type": "string",
      "description": "Why this run was illuminated or skipped. Captured in the pipeline trace for debugging."
    }
  },
  "required": ["illumination_path", "reasoning"],
  "additionalProperties": false
}
```

- [x] **Step 2: Run the schema description test**

Run: `npx vitest run src/cli/tests/pipeline-schema-descriptions.test.ts`
Expected: PASS. The existing test scans every JSON schema under `pipelines/schemas/` for banned words (section, bullet, heading, tier), banned literals (`##`, `###`, "MUST lead"), numeric shape rules, numeric ranges, and >160-char descriptions. Both new descriptions are well under 160 chars and contain none of the banned tokens.

- [x] **Step 3: Run the broader schema-loading test**

Run: `npx vitest run src/attractor/tests/schemas.test.ts`
Expected: PASS. New schema must parse as valid JSON Schema and round-trip through the loader.

- [x] **Step 4: Commit** — done in `3a0ada3`

```bash
git add pipelines/schemas/memory-reflector.json
git commit -m "feat(memory-reflector): add structured-output schema

Symmetric {illumination_path, reasoning}. illumination_path is null
when the reflector judged the run had nothing worth surfacing;
reasoning is always present so the trace records the call."
```

### Task 1.2: Create the agent definition

**Files:**
- Create: `src/cli/agents/memory-reflector.md`
- Test: `src/cli/tests/agent-registry.test.ts` (existing — exercises agent resolution)

- [x] **Step 1: Write the agent file**

```markdown
---
name: memory-reflector
description: Reflect on a just-written session memory file and decide whether to surface one new illumination capturing what was learned during the run
model: opus
permissionMode: dontAsk
tools:
  - Read
  - Glob
  - Grep
  - mcp__illumination__write_illumination
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
---

# Mission

You sit at the very tail of `illumination-to-implementation.dot`. Memory-writer just wrote a memory file capturing this pipeline run. Your job: read that memory plus its upstream artifacts, decide whether anything in this session's experience deserves to become a new illumination, and either write exactly one illumination or skip cleanly.

You produce zero or one illumination per run. You are not a backlog generator — most clean runs should skip.

# Inputs you will receive

- `$run_id` — pipeline run identifier; used for idempotency and provenance.
- `$project` — repo root.
- `$memory_path` — absolute path to the memory file just written by memory-writer (primary input).
- `$design_doc_path` — design that drove this run.
- `$plan_path` — implementation plan that drove this run.
- `$illumination_path` — original illumination this session sprang from. Note: by the time you run, memory-writer's step 7b may have moved this file from `meditations/illuminations/` to `meditations/implemented-illuminations/`. If `$illumination_path` does not exist on disk, look up the basename under `meditations/implemented-illuminations/` instead.

# Procedure

1. **Idempotency check.** Glob `$project/meditations/illuminations/*.md` and grep each match for the line `Pipeline run id: $run_id`. If any file matches, this is a `--resume` re-run and a previous attempt already wrote the illumination. Emit structured JSON with `illumination_path` set to the existing match's absolute path and `reasoning: "Idempotent skip: illumination from this run already exists at <path>."`. Exit.

2. **Read the inputs.** Read `$memory_path` first — it is memory-writer's distillation of the session trace. Then read `$design_doc_path`, `$plan_path`, and `$illumination_path` (with the post-move fallback above) for cross-reference context. Do not re-open the raw `pipeline.jsonl` trace; if the memory file lacks signal, that signal is gone for your purposes.

3. **Apply skip-fast signals.** Lean toward skipping when any of these hold:
   - The memory file has no `## Learnings from the run` section.
   - The trace shows zero retries, zero tmux-tester fix cycles, and no tool-node failures.
   - Every struggle in `Learnings from the run` already has a merged commit fix documented in `Key files` or `Decisions and patterns`.
   - The memory body restates spec or plan content without flagging any drift.
   - `Decisions and patterns` entries are routine tactical choices (file naming, library picks, copy edits) rather than non-obvious deviations.

   When skipping, emit structured JSON with `illumination_path: null` and a `reasoning` string naming which signals fired. Exit.

4. **Scope to a single illumination.** You may write at most one. If multiple insights surfaced, pick the highest-leverage candidate — strongest evidence, broadest impact, most concrete fix path. Fold related smaller observations into the same illumination's body when they share a root cause; do not split across multiple illuminations.

   The universe of illumination-worthy material is broad: bugs surfaced but not patched, code/spec drift, validator/runtime gaps, ergonomic pain that should become a feature, missing abstractions, refactor opportunities. The downstream verifier and human review gate filter for what is actually worth implementing — your job is to surface, not to gatekeep.

5. **Compose the illumination.** Call `mcp__illumination__write_illumination` with:
   - `slug` — kebab-case theme slug capturing the insight (e.g. `validator-runtime-default-mismatch`). The MCP server prepends `YYYY-MM-DDTHHMM-` and appends `.md` automatically. Do not include the timestamp or extension yourself.
   - `description` — one-sentence summary of the insight. Will appear in `list_illuminations` for future sessions; write it as orientation for someone who reads only this line.
   - `content` — markdown body following the standard illumination shape. End with a `## Provenance` section linking back to this run.

   The body must contain these sections in order:

   ```markdown
   ## Core Idea

   State the insight plainly. No padding.

   ## Why It Matters

   Connect to current pain or future risk. Reference actual files, commits, or trace events you observed in the inputs.

   ## Revised Implementation Steps

   Ordered, concrete steps a developer could act on tomorrow. Each step actionable enough to become a task.

   ## Provenance

   - Source memory: `<repo-relative path to $memory_path>`
   - Pipeline run id: `$run_id`
   - Surfaced by: memory-reflector
   ```

   Frontmatter is auto-generated by the MCP tool — do not include `---` blocks in your `content` argument.

6. **Emit structured JSON** with `illumination_path` set to the absolute path the MCP tool returned, and `reasoning` set to a brief justification: which struggle or pattern in the memory file pushed this over the line, and why it warranted illumination over the alternatives you considered.

# Hard rules

- Zero or one illumination per invocation. If you cannot pick a single highest-leverage candidate, skip — better to surface nothing than to fragment.
- Never write to disk directly. Only `mcp__illumination__write_illumination` is permitted. The MCP tool auto-commits.
- Frontmatter shape is invariant. Do not include frontmatter in your `content` argument; it is added by the MCP server identically to every other writer.
- Provenance lives in the body's `## Provenance` section, not in frontmatter. This keeps illuminations from this writer indistinguishable in shape from human-written or meditate-written ones.
- If any step fails (file unreadable, MCP error, JSON parse), let the error propagate. Do not catch and emit success. The pipeline is configured to fail noisy and resume cleanly.
- Quality of insight outweighs quantity. A skipped run with sharp `reasoning` is more valuable than a written run with vague justification.
```

- [x] **Step 2: Run the agent registry test**

Run: `npx vitest run src/cli/tests/agent-registry.test.ts`
Expected: PASS. The registry resolves agents by name from the bundled directory; the new file lives at the expected path.

- [x] **Step 3: Run the assets test**

Run: `npx vitest run src/cli/tests/assets.test.ts`
Expected: PASS. The bundled-asset discovery includes the new agent.

- [x] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. No type errors introduced.

- [x] **Step 5: Commit** — done in `6041c1b`

```bash
git add src/cli/agents/memory-reflector.md
git commit -m "feat(memory-reflector): add agent definition

Reads the memory file just written by memory-writer plus design,
plan, and original illumination for cross-reference. Decides
whether to write one new illumination capturing what was learned,
or skip cleanly. Idempotency via glob+grep for the run id;
provenance lives in the body's ## Provenance section so frontmatter
shape matches meditate-written illuminations."
```

### Chunk 1 review checkpoint

Dispatch `plan-document-reviewer` with this chunk's content + the design context above. Iterate fixes until ✅ approved. Then continue to Chunk 2.

---

## Chunk 2: Pipeline wiring and spec

### Task 2.1: Wire the new node into the pipeline

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:46-93`
- Test: `npx ralph pipeline validate pipelines/illumination-to-implementation.dot` (existing CLI command)

- [ ] **Step 1: Add the `memory_reflector` node declaration**

Open `pipelines/illumination-to-implementation.dot`. After the `memory_writer` node block (line 46) and before the `done` node (line 48), add:

```dot
  memory_reflector [agent="memory-reflector", json_schema_file="schemas/memory-reflector.json", produces="illumination_path, reasoning", prompt="Reflect on this pipeline session and decide whether a new illumination is warranted.\n\nRun id: $run_id\nProject: $project\nMemory file: $memory_path\nDesign doc: $design_doc_path\nPlan: $plan_path\nOriginal illumination: $illumination_path\n\nFollow your agent-level procedure."]
```

- [ ] **Step 2: Reroute the final edge**

Replace the line `memory_writer -> done` (line 93) with:

```dot
  memory_writer -> memory_reflector
  memory_reflector -> done
```

- [ ] **Step 3: Validate the pipeline**

Run: `npx ralph pipeline validate pipelines/illumination-to-implementation.dot`
Expected: validation passes with no errors. The validator should accept the new node (agent reference resolves; schema reference resolves; produces fields are well-formed; cwd is not required for agent nodes; edges form a DAG).

If validation surfaces a warning about `produces` containing two values, confirm against `verifier` (line 10) which already declares `produces="preferred_label, illumination_path, summary, explanation, archive_reason_short"` — multi-value produces is supported.

- [ ] **Step 4: Run the pipeline-related test suite**

Run: `npx vitest run src/cli/tests/pipeline.test.ts src/cli/tests/illumination-to-plan-pipeline.test.ts`
Expected: PASS. No regressions on pipeline parsing, validation, or trace handling.

- [ ] **Step 5: Run the graph parser tests**

Run: `npx vitest run src/attractor/tests/graph.test.ts src/attractor/tests/dot-syntax.test.ts`
Expected: PASS. The DOT parser cleanly ingests the modified file.

- [ ] **Step 6: Commit**

```bash
git add pipelines/illumination-to-implementation.dot
git commit -m "feat(pipeline): wire memory-reflector into illumination-to-implementation

memory_writer -> memory_reflector -> done. Reflector receives the
fresh memory_path plus upstream artifact paths and decides whether
the session surfaced anything illumination-worthy. Skipping is the
expected path for clean runs."
```

### Task 2.2: Add the spec note

**Files:**
- Create: `specs/memory-reflector.md`

- [ ] **Step 1: Write the spec**

```markdown
# memory-reflector

Tail node of `pipelines/illumination-to-implementation.dot`. Runs after `memory_writer` finalises the session.

## Responsibility

Read the memory file just written, cross-reference it against the design / plan / original illumination, and decide whether the run surfaced anything worth filing as a new illumination. Emit zero or one illumination per invocation.

The downstream verifier + human review gate already filter for "is this worth implementing", so the reflector's bar is "is this worth surfacing", not "is this worth implementing".

## Inputs

- `$run_id` — pipeline run identifier
- `$project` — repo root
- `$memory_path` — memory-writer output
- `$design_doc_path`, `$plan_path` — upstream artifacts
- `$illumination_path` — may have been moved to `meditations/implemented-illuminations/` by memory-writer step 7b; reflector falls back to that directory if the original path is missing

## Output

Structured JSON: `{illumination_path: string | null, reasoning: string}`. `null` denotes a deliberate skip. `reasoning` is always present so the pipeline trace records the call.

## Idempotency

Reflector globs `meditations/illuminations/*.md` and greps each body for `Pipeline run id: <run_id>` before writing. On `--resume`, a partial run that already wrote the illumination is detected and the existing path is returned without a duplicate write.

## Provenance

Reflector-written illuminations carry provenance in a final `## Provenance` body section listing the source memory, run id, and writer. Frontmatter shape is identical to meditate-written illuminations (date, status: open, description) so downstream tooling cannot distinguish writers structurally.

## Failure mode

Errors propagate. Memory-writer has already committed and pushed by the time reflector runs, so a reflector failure does not lose work. Recovery is `ralph pipeline run ... --resume <runId>`.
```

- [ ] **Step 2: Commit**

```bash
git add specs/memory-reflector.md
git commit -m "docs(spec): document memory-reflector tail node

Captures responsibility, inputs/outputs, idempotency contract, and
the post-move quirk on \$illumination_path."
```

### Task 2.3: End-to-end smoke

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. No regressions across the suite.

- [ ] **Step 2: Build the dist**

Run: `npm run build`
Expected: clean tsup output; new agent file copied into `dist/agents/memory-reflector.md`; new schema copied into `dist/pipelines/schemas/memory-reflector.json` (if the build copies schemas — verify against existing layout).

- [ ] **Step 3: Manual end-to-end smoke**

This step is interactive and cannot be unit-tested. Run the pipeline against an open illumination and observe the reflector's behavior at the tail. Two scenarios to confirm:

1. **Clean run path**: pick an illumination that should ship cleanly. After `memory_writer` completes, watch the trace for `memory_reflector` emitting `illumination_path: null` with reasoning citing the skip signals.
2. **Struggle run path**: pick an illumination that historically required retries. After `memory_writer`, confirm `memory_reflector` writes a new illumination under `meditations/illuminations/` with the `## Provenance` section, and emits its absolute path.

Also test the idempotency path deterministically: pre-seed a fake illumination at `meditations/illuminations/<today>T0000-fake-prior-run.md` whose body contains the line `Pipeline run id: <runId>` matching the run id you are about to resume. Then run the pipeline with `--resume <runId>` and confirm reflector's glob+grep step finds the pre-seeded file, emits its absolute path with reasoning explaining the idempotent skip, and writes no new illumination.

If any of the three scenarios fails, debug, fix, then continue.

### Chunk 2 review checkpoint

Dispatch `plan-document-reviewer` with this chunk's content. Iterate fixes until ✅ approved.

---

## Done criteria

- [ ] All vitest tests pass: `npx vitest run`
- [ ] Typecheck clean: `npx tsc --noEmit`
- [ ] Pipeline validates: `npx ralph pipeline validate pipelines/illumination-to-implementation.dot`
- [ ] Build succeeds: `npm run build`
- [ ] Manual smoke (skip path) confirms reflector emits `illumination_path: null` with reasoning
- [ ] Manual smoke (write path) confirms reflector writes one illumination with the `## Provenance` section
- [ ] Manual smoke (resume idempotency) confirms duplicate writes are prevented
