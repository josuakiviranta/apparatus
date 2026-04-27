# Pipeline Folder Architecture Redesign — Implementation Plan

> **For agentic workers:** This plan is in its post-shipping summary state. The Pipeline Folder Architecture Redesign (D8) is COMPLETE at v0.1.61. When the next initiative is scoped, follow the "Next plan" section below — use superpowers:writing-plans to draft the new chunks, then superpowers:subagent-driven-development (or superpowers:executing-plans) to implement them with task checkboxes.

**Goal:** Migrate ralph-cli pipelines from scattered concept folders to per-pipeline folders with self-describing node files. Net: `src/` becomes the harness, `pipelines/` becomes behavior, concept count for authors drops from 7 to ~3.

**Architecture:** Six sequential chunks, each producing working software. Chunk 1 lands `outputs:` frontmatter on agents (foundation). Chunk 2 adds `inputs:` + flow validator (safety net for later moves). Chunk 3 moves gates to `.md` files. Chunk 4 migrates project pipelines to per-folder layout and relocates agents out of `src/cli/agents/`. Chunk 5 introduces `src/cli/templates/` and converts `pipeline create` to a pipeline. Chunk 6 collapses remaining workflow commands (`plan`, `meditate`, `new`, `pipeline refine`) to pipelines.

**Tech Stack:** TypeScript, Node.js, vitest, zod (already in use for node schemas), `yaml` (already a dep, used by `parseFrontmatter`), graphviz (`@ts-graphviz/ast`, existing).

**Spec:** `docs/superpowers/specs/2026-04-27-pipeline-folder-architecture-redesign.md`

**Plan structure note:** This plan was originally written chunk-by-chunk with full TDD step expansion. After all six chunks shipped (v0.1.61, tag `chunk-6-command-templates`), the verbose per-task blocks were collapsed into the chunk-by-chunk summaries below. Per-chunk implementation lessons live in the memory folder linked from each summary; this file is now the high-level historical index.

---

## File Structure

The redesign touches files across the engine, CLI, and pipelines. Below is the high-level inventory; each chunk specifies exact files.

| Area | Files | What changes |
|---|---|---|
| `src/attractor/core/schemas.ts` | Modify | Add `inputs:`, `outputs:` to `AgentNodeSchema`. Add `GateNodeFrontmatterSchema` for new `.md`-based gates. Add validation refinements (D2 conflict, D5 flow rules). |
| `src/attractor/core/graph.ts` | Modify | Extend validator with `outputs_and_schema_file_conflict`, `derive_produces_from_outputs`, `missing_input_producer`, `branch_incomplete_input`, `input_type_mismatch`, `orphan_output`, `required_caller_vars`, `degenerate_pipeline`. |
| `src/cli/lib/agent.ts` | Modify | Extend `AgentConfig` interface with optional `inputs?: string[]` and `outputs?: Record<string, JsonSchemaFragment>`. Modify the literal-object factory `validateAgentConfig` (`:420-437`) to derive a JSON Schema from `outputs:` and serialize it into the existing `jsonSchema?: string` field. **No change to runtime path** (agent-handler uses `config.jsonSchema` unchanged). |
| `src/cli/lib/agent-registry.ts` | Verify only (Chunk 1) | `parseAgentFile` (`:35-38`) already spreads `...attributes` into `validateAgentConfig`, so `outputs`/`inputs` flow through automatically. Tested end-to-end via `resolveAgent`. After Chunk 4, lookup order changes (pipeline folder first, no fallback). |
| `src/attractor/handlers/agent-handler.ts` | No change in Chunk 1 | The runtime path consumes `config.jsonSchema` (string) and merges every key from the parsed LLM output into `contextUpdates`. No filtering by `produces=`. Chunk 1's frontmatter changes feed the same `jsonSchema` field; no handler edit needed. |
| `src/cli/agents/*.md` | Move (Chunks 4-6) | Each agent file moves into the pipeline folder that uses it (with `outputs:`/`inputs:` added). |
| `src/cli/prompts/*.md` | Delete (Chunks 5-6) | All bespoke prompts dissolved into templates. |
| `src/cli/templates/*` | Create (Chunk 5) | Bundled pipeline starters: `blank/`, `pipeline-create/`, plus `meditate/`, `plan/`, `new/`, `pipeline-refine/` in Chunk 6. |
| `src/cli/lib/assets.ts` | Modify (Chunk 5) | Add `getBundledTemplatesDir()` mirroring `getBundledAgentsDir()`. |
| `src/cli/commands/{plan,meditate,new}.ts` | Modify (Chunk 6) | Collapse to thin shims that call `runPipeline(bundledTemplatePath, vars)`. |
| `pipelines/<name>.dot` | Move (Chunk 4) | Each becomes `pipelines/<name>/pipeline.dot` + per-node files. |
| `pipelines/scripts/*` | Move + delete (Chunk 4) | Scripts move into the pipeline folder that uses them; folder deleted. |
| `pipelines/schemas/*` | Delete (Chunks 1, 4) | Schemas dissolved into agent `outputs:`. Folder deleted at end of Chunk 4. |

---

## Chunk 1: `outputs:` frontmatter + verifier migration (D2) — SHIPPED 2026-04-27

**Tag:** `chunk-1-outputs-frontmatter` (commits ending at `4ee0d28`)
**What landed:** Agent frontmatter parser learned `outputs:`; `validateAgentConfig` now derives a serialized JSON Schema into the existing `jsonSchema` string field, leaving the runtime path untouched. Validator gained `outputs_and_schema_file_conflict` + `produces_redundant_with_outputs` and derives `nodeProduces` from `outputs:` keys. The `verifier` agent migrated end-to-end as proof and `pipelines/schemas/verifier.json` was deleted.
**Tasks:** 7 tasks complete. Key files touched: `src/cli/lib/agent.ts`, `src/cli/lib/frontmatter.ts`, `src/attractor/core/graph.ts`, `src/cli/agents/verifier.md`.
**Carry-overs / notes:** Stale-cache caveat for agent registry surfaced; `debugProducedKeys` seam introduced to make validator output testable.
**Memory file:** `2026-04-27-pipeline-redesign-chunk-1-implementation.md`

---

## Chunk 2: `inputs:` frontmatter + flow validator (D5) — SHIPPED 2026-04-27

**Tag:** `chunk-2-inputs-flow-validator`
**What landed:** Agents now declare `inputs:` (consumed context keys). Validator grew the full flow-safety ruleset: `missing_input_producer`, `branch_incomplete_input`, `input_type_mismatch`, `orphan_output`, `required_caller_vars`. Verifier agent migrated to use `inputs:`. End-to-end topology test for `illumination-to-implementation.dot` keeps the validator honest.
**Tasks:** 13 tasks complete. Key files touched: `src/attractor/core/graph.ts`, `src/cli/agents/verifier.md`, `src/attractor/tests/`.
**Carry-overs / notes:** `Diagnostic.nodeId` TODO logged. `RESERVED` set is duplicated between `validateGraph` and `checkRequiredCallerVars` — DRY hoist deferred until the next validator rule lands (YAGNI).
**Memory file:** `2026-04-27-pipeline-redesign-chunk-2-shipped.md`

---

## Chunk 3: gates as sibling `.md` files (D3) — SHIPPED 2026-04-27

**Tag:** `chunk-3-gates-as-md` (commits `f95821e`..`bf5f080`, v0.1.52)
**What landed:** Gate prompts moved out of DOT `label=` strings into sibling `.md` files. New `GateMdFrontmatterSchema` + `gate-registry`'s `resolveGate` loader. Validator added `gate_handler_missing` plus `.md`/edge consistency rules. Four production gates migrated: `remove_gate`, `approval_gate`, `review_gate`, `tmux_confirm_gate`. `wait-human` handler now loads the prompt from the sibling `.md` when the DOT label is absent.
**Tasks:** 4 validator rules + 4 gate migrations. Key files touched: `src/attractor/core/schemas.ts`, `src/cli/lib/gate-registry.ts`, `src/attractor/handlers/wait-human-handler.ts`, `pipelines/*.md`.
**Memory file:** `2026-04-27-chunk-3-gates-as-md-shipped.md`

---

## Chunk 4: per-folder pipelines + project agents (D4) — SHIPPED 2026-04-27

**Tag:** chunk landed without single canonical tag — bisectable via key commits below.
**Key commits:**
- `bafaef8` — Tasks 4.1 + 4.2: resolver folder-form + janitor pipeline migrated
- `f367a7c` — Task 4.17: `illumination-to-implementation` migrated to per-folder layout; RESERVED-vars validator fix
- `8445012` — Task 4.18: project pipelines fully relocated
- `c8c1255` — Task 4.19: `agent-registry` drops bundled fallback for pipeline runtime (per-folder lookup is authoritative)

**What landed:** Every project pipeline became a folder (`pipelines/<name>/pipeline.dot` + per-node `.md`/script files). Agents that belonged to a pipeline moved out of `src/cli/agents/` into their owning pipeline folder. Pipeline runtime no longer falls back to bundled agents — pipeline-folder lookup is the single source of truth. 14 smoke pipelines + 2 critical pipelines (`illumination-to-implementation`, `janitor`) migrated; 11 stale agents deleted; `pipelines/schemas/` and `pipelines/scripts/` folders removed.
**Tasks:** 20 tasks complete (4.1–4.20). Key files touched: `src/cli/lib/agent-registry.ts`, `src/attractor/core/resolver.ts`, every `pipelines/*` folder.
**Carry-overs / notes:** Bundled-fallback drop simplified the lookup model but means a typo in a pipeline-local agent name now fails fast (intentional). Closed the chunk by expanding Chunk 5 scope.
**Memory files:** `2026-04-27-chunk-4-task-4.1-and-4.2-shipped.md`, `2026-04-27-chunk-4-task-4.17-shipped.md`, `2026-04-27-chunk-4-completion-per-folder-architecture.md`, `2026-04-27-chunk-4-close-and-chunk-5-expansion.md`

---

## Chunk 5: `src/cli/templates/` + `pipeline create` shim (D7) — SHIPPED 2026-04-27

**Tag:** `chunk-5-templates-and-create-shim` (v0.1.55)
**What landed:** New bundled `src/cli/templates/` directory with `blank/` and `pipeline-create/` starters. `getBundledTemplatesDir()` added to `assets.ts`. `pipeline create` command became a thin shim over the `pipeline-create` template. Dead code (`renderCodeFrame`, `existsSync` imports) cleaned up.
**Tasks:** 7 tasks. Task 5.6 (deleting `composeCreatePrompt` + `agent-creator`) deferred to Chunk 6 because `refine` and `ralph agent create` still consumed those targets at the time. Task 5.7 prod-bundle smoke green (one `orphan_output` warning noted, non-blocking).
**Key files touched:** `src/cli/templates/{blank,pipeline-create}/`, `src/cli/lib/assets.ts`, `src/cli/commands/pipeline.ts`.
**Memory file:** `2026-04-27-chunk-5-shipped.md`

---

## Chunk 6: workflow commands collapse to pipelines (D8) — SHIPPED 2026-04-28

**Tag:** `chunk-6-command-templates` (v0.1.61, last commit `7102946`)
**What landed:** Every remaining workflow command — `plan`, `meditate`, `meditate-create`, `new`, `pipeline refine` — became a thin shim over a bundled template. Dead `composeCreatePrompt`, `agent-creator.md`, and `ralph agent create` deleted (the deferred Task 5.6 cleanup). `src/cli/prompts/` directory removed entirely. Two surviving cross-pipeline agents (`chat-summarizer`, `meditate-observer`) relocated into their owning per-pipeline folders. README + spec docs aligned with the D8 layout.

### Sub-chunk 6a: `plan` command as `templates/plan/` — SHIPPED
- `097d000` feat(templates): plan single-node interactive template
- `4d60bb9` refactor(plan): convert command to thin shim
- `652efbf` chore(agents): remove `plan.md` (now `templates/plan/plan.md`)
- `ceba572` docs(chunk-6a): mark SHIPPED

### Sub-chunk 6b: `meditate` + `meditate-create` as templates — SHIPPED
- `0fc0bc1` feat(templates): meditate template (with `steer` var)
- `d844144` feat(templates): meditate-create template
- `f4b69fb` refactor(meditate): thin shim
- `1d8adaa` refactor(meditate-create): thin shim
- `770ed90` refactor(meditate): replace `--steer` flag with `--var steer=...`
- `2d84c7a` chore(agents): remove `meditate` / `meditate-create`
- `c75a139` docs(chunk-6b): mark SHIPPED

### Sub-chunk 6c: `new` command as `templates/new/` — SHIPPED
- `b3f0c5d` feat(templates): new single-node kickoff template
- `becb7ee` refactor(new): thin shim
- `d4e1e88` chore(prompts): remove `PROMPT_kickoff.md`
- `bd8b4fb` docs(chunk-6c): mark SHIPPED

### Sub-chunk 6d: `pipeline refine` as `templates/pipeline-refine/` — SHIPPED
- `0ff621c` feat(templates): pipeline-refine template + refiner agent
- `e09aa58` refactor(pipeline-refine): thin shim
- `a3c876f` docs(chunk-6d): mark SHIPPED
- Memory file: `2026-04-28-chunk-6d-shipped.md`

### Sub-chunk 6e: deferred Task 5.6 cleanup — SHIPPED
- `a74a841` chore(pipeline): drop dead `composeCreatePrompt` + `PROMPT_pipeline_create.md`
- `40084c4` chore(agents): drop `ralph agent create` + `agent-creator.md`
- `0482e67` docs(chunk-6e): mark SHIPPED
- `7c43e83` chore(release): bump to v0.1.60

### Sub-chunk 6f: kill `src/cli/prompts/`; relocate cross-pipeline agents — SHIPPED
- `1440a4f` chore(prompts): remove `src/cli/prompts/` entirely
- `55f7a16` chore(agents): move `chat-summarizer` + `meditate-observer` into per-pipeline folders
- `9cbe729` docs(readme): update commands + architecture for D8
- `5d25680` docs(specs): align architecture + commands with D8 templates
- `cc6b872` docs: fix stale prompts/agents references after chunk-6f cleanup

### Sub-chunk 6g: release — SHIPPED
- `7102946` chore(release): bump version to 0.1.61 (chunk-6f + 6g shipped)

**Memory file:** `2026-04-28-pipeline-redesign-chunk-6f-6g-shipped.md` (covers 6f + 6g; 6a–6e captured in their docs commits and the 6d standalone memory file).

---

## Status as of 2026-04-28

**Pipeline Folder Architecture Redesign (D8): COMPLETE.**
- v0.1.61 / tag `chunk-6-command-templates`
- 1222/1222 vitest tests green; `tsc --noEmit` clean
- All 6 chunks shipped; no carry-over work

---

## Open carry-overs (none blocking)

- **DRY follow-up:** `RESERVED` set is duplicated in `src/attractor/core/graph.ts` (`validateGraph` + `checkRequiredCallerVars`). Hoist to a module-level constant when the next validator rule needs it (per Chunk 2 review note). YAGNI — defer until a new rule lands.

---

## Next plan

When the next initiative is scoped:
1. Write its spec under `docs/superpowers/specs/`.
2. Replace the chunk summaries above with the new plan's chunk outline.
3. Keep this header / File Structure / Plan Review Loop / Post-execution memory capture scaffolding intact.

---

## Plan Review Loop

After each chunk:

1. Dispatch `superpowers:code-reviewer` against the chunk's commits + the spec.
2. Address feedback in-chunk; re-dispatch if needed.
3. Tag chunk in git for bisectable history.
4. Expand the next chunk's outline into full TDD steps.

---

## Post-execution memory capture

**REQUIRED after every chunk lands.** Each chunk's implementation session produces lessons that future Claude sessions need to pick up cold:

- What was harder than the plan predicted (and why)
- Codebase facts the plan got wrong or surprised the implementer
- Tests that turned out flaky / non-deterministic
- Edge cases the validator missed during real runs
- Migration friction the user noticed (regressions, ergonomic complaints)
- Decisions the implementer made that weren't in the plan (and why)

**Procedure at the end of each chunk:**

1. Land the final commit + tag (`chunk-N-<name>`).
2. Dispatch the `memory-writer` subagent with the chunk's session transcript path:
   ```
   Agent({
     description: "Capture chunk-N implementation memory",
     subagent_type: "memory-writer",
     prompt: "Analyze the implementation session for Chunk N of the pipeline folder architecture redesign. Transcript: <path>. Capture: codebase surprises, validator gaps discovered, plan-vs-reality deltas, ergonomic friction. Write to /Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/. Update MEMORY.md index."
   })
   ```
3. Memory file naming: `2026-MM-DD-pipeline-redesign-chunk-N-implementation.md`.
4. Memory `type:` is `project` (captures execution state and lessons applicable to subsequent chunks).
5. The memory file feeds into the expansion of Chunk N+1's outline — read it before writing Chunk N+1's TDD steps.

**Why this is non-optional:** the architecture spec captures decisions that should survive 6 months. The implementation memories capture decisions that should survive the next chunk. Both layers protect against drift between what's documented and what actually shipped.
