# Mark Plan Implemented — Wire memory_writer As Canonical Caller — Implementation Plan (v2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pipelines/illumination-to-implementation.dot` actually flip both halves of the lifecycle pair — `plan: pending → implemented` AND `illumination: dispatched → implemented` — at the end of every run, by removing the inline shadow procedure that strands the `memory_writer` rubric's lifecycle steps and by wiring `mark_implemented` (illumination side) alongside the already-wired `mark_plan_implemented` (plan side).

**State as of 2026-04-26 (auto-discovered before re-execution):**

| Plan element | Status |
|---|---|
| Chunk 1 (memory-writer.md frontmatter MCP block + `mark_plan_implemented` whitelist) | ✅ APPLIED — see `src/cli/agents/memory-writer.md:6-18` |
| Chunk 2 (memory-writer.md procedure step 7 + Hard rules bullet) | ✅ APPLIED — see `src/cli/agents/memory-writer.md:117, 128` |
| Chunk 3 (specs/2026-04-25-plans-have-no-lifecycle-design.md line-276 amendment) | ⏳ PENDING — old "caller identity is not pinned" framing still on line 276 |
| Chunk 4 (tmux verification) | ⏳ PENDING |

**New findings driving v2 (illuminations T1700, T1800, T1900):**

- **Shadow procedure (T1900):** `pipelines/illumination-to-implementation.dot` line 46 (`memory_writer` node `prompt=` attribute) re-states a 6-step inline procedure ending at `"6. Return structured JSON with memory_path."` After rubric-prepend (v0.1.32), the LLM receives both the rubric (8 steps) AND this inline list. The inline list is later in the assembled prompt and forms a complete self-terminating task — so steps 7 (mark_plan_implemented) and 8 (JSON emit) of the rubric are unreachable. The plan-closure that v1 of this plan declared "shipped" has never fired in a live run. Static grep can't see this — only an LLM-execution trace would.
- **Half-designed pair (T1800):** `mark_dispatched` opens TWO artifacts (illumination frontmatter + plan frontmatter). v1 of this plan only wired the close for one (plan). `mark_implemented` (illumination side) is missing from `memory-writer.md` tools list AND from the rubric. After plan flips to `implemented`, the originating illumination stays at `dispatched` forever — exactly the dead-end T0100 was diagnosing in the first place.
- **Reliability layer is correct (T1700):** Rubric (cognitive enforcement) is the right place for best-effort closes; structural tool nodes are wrong because they have no graceful-degradation path. T1400's "lifecycle-close-must-be-a-graph-node" is rejected. Just kill the inline shadow and let the rubric run.

The MCP tool itself already exists: `mark_implemented` registered at `src/cli/mcp/illumination-server.ts:633-645`, schema `{filename: z.string()}`, valid from status `open` or `dispatched`.

---

## File Map (v2)

| File | Operation | Reason |
|---|---|---|
| `pipelines/illumination-to-implementation.dot` | Modify (`memory_writer` node `prompt=` attribute on line 46) | Delete inline 6-step shadow procedure; replace with bare "Follow your agent-level procedure." referencing the context-variable bindings only. |
| `src/cli/agents/memory-writer.md` | Modify (frontmatter `tools:` + Procedure step 7 + Hard rules) | Whitelist `mcp__illumination__mark_implemented`; extend step 7 to call both closes; expand Hard rules bullet to cover both. |
| `specs/2026-04-25-plans-have-no-lifecycle-design.md` | Modify (line-276 paragraph) | Strike "any implementing agent"; name `memory_writer` as canonical caller for both closes. |

No tests added — `markPlanImplemented` and `markImplemented` happy-path / error cases are already covered in `src/cli/tests/illumination-server.test.ts`. The new surface is agent-file wiring + pipeline-prompt cleanup, not server logic.

---

## Chunk A: Delete shadow procedure from `memory_writer` node in DOT

**Goal:** Stop the inline 6-step list from terminating the LLM before it reaches the rubric's lifecycle close. After this, the rubric (8 steps) is the single source of truth.

### Task A.1: Edit `pipelines/illumination-to-implementation.dot` line 46

- [ ] **Step 1: Re-read the `memory_writer` node block to confirm shape**

The `prompt=` attribute on the `memory_writer` node currently embeds steps 1–6 ending at `"6. Return structured JSON with memory_path."` Confirm this is still the case before editing.

- [ ] **Step 2: Edit — replace inline procedure with bare reference**

Use Edit. Match the full `memory_writer = [...]` declaration so the edit is unique.

`old_string`: the existing `memory_writer [agent="memory-writer", ..., prompt="Close out the pipeline session.\n\nRun id: $run_id\n...\n1. Derive the memory filename...\n6. Return structured JSON with memory_path."]` block — preserve every input variable line, only kill the numbered list.

`new_string`: same node attributes, but `prompt=` ends with the input-variable bindings followed by a single sentence: `"Follow your agent-level procedure."` — no inline numbered list.

- [ ] **Step 3: Static grep — confirm shadow gone**

Grep `pipelines/illumination-to-implementation.dot` for `Return structured JSON`. Expected: zero matches inside the `memory_writer` node prompt. Grep for `Follow your agent-level procedure.` — expected: one match in the `memory_writer` node prompt.

- [ ] **Step 4: Validate the pipeline still parses**

Run: `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` (after `npm run build`). Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add pipelines/illumination-to-implementation.dot
git commit -m "fix(pipeline): drop shadow procedure from memory_writer node so rubric lifecycle steps run"
```

---

## Chunk B: Add `mcp__illumination__mark_implemented` to memory-writer.md tools

**Goal:** Give the agent permission to call the illumination-side close. Without this, the new rubric step in Chunk C cannot fire.

### Task B.1: Append tool entry under existing `mark_plan_implemented`

- [ ] **Step 1: Static grep — confirm starting state**

Grep `src/cli/agents/memory-writer.md` for `mcp__illumination__mark_implemented`. Expected: zero matches. Grep for `mcp__illumination__mark_plan_implemented` — expected: one match (Chunk 1 of v1 already landed).

- [ ] **Step 2: Edit frontmatter — insert tool entry directly below `mark_plan_implemented`**

`old_string`:
```
  - mcp__illumination__mark_plan_implemented
mcp:
```

`new_string`:
```
  - mcp__illumination__mark_plan_implemented
  - mcp__illumination__mark_implemented
mcp:
```

- [ ] **Step 3: Static grep — confirm both whitelisted**

Grep `src/cli/agents/memory-writer.md` for `mcp__illumination__mark_`. Expected: two matches — `mark_plan_implemented` and `mark_implemented` (no plan_ prefix).

---

## Chunk C: Extend rubric step 7 to also close the illumination

**Goal:** Make the rubric's lifecycle step do BOTH closes in one node, with matching best-effort policy. Both calls log to `Learnings` on `success: false` and never abort the node.

### Task C.1: Rewrite step 7 in memory-writer.md procedure

- [ ] **Step 1: Re-read existing step 7 to confirm shape**

Existing `src/cli/agents/memory-writer.md:117` covers only the plan side. We extend it in place to also call `mark_implemented` for the illumination after the plan call returns.

- [ ] **Step 2: Edit — replace step 7 body**

Use Edit. Match the entire existing step-7 paragraph so the edit is unique.

`old_string`: the line-117 paragraph beginning with `7. **Mark the plan implemented (best-effort).**` and ending with `(- Lifecycle flip skipped: $plan_path was empty)`.

`new_string`: same structure but covering both closes:
```
7. **Mark the lifecycle artifacts implemented (best-effort, both halves).** This step closes BOTH halves of the open/close pair that `mark_dispatched` opened upstream — the plan frontmatter AND the illumination frontmatter. Run them in this order:

   **7a. Plan side.** If `$plan_path` is set and non-empty, call `mark_plan_implemented` with the basename of `$plan_path` (strip the directory portion — the tool resolves the file under `docs/superpowers/plans/`). On `success: true`, do nothing more — the tool auto-commits its own frontmatter rewrite. On `success: false` (orphan plan with no frontmatter, plan already `implemented`, plan file missing), append a single bullet to the memory file's `Learnings from the run` section quoting the `error` field verbatim, then continue. If `$plan_path` is empty or unset, skip 7a and append `- Plan lifecycle flip skipped: $plan_path was empty` to the memory file.

   **7b. Illumination side.** If `$illumination_path` is set and non-empty, call `mark_implemented` with the basename of `$illumination_path` (strip the directory portion — the tool resolves the file under `meditations/illuminations/`). On `success: true`, do nothing more — the tool auto-commits its own frontmatter rewrite. On `success: false` (already `implemented`/`archived`, no frontmatter, file missing), append a single bullet to the memory file's `Learnings from the run` section quoting the `error` field verbatim, then continue. If `$illumination_path` is empty or unset, skip 7b and append `- Illumination lifecycle flip skipped: $illumination_path was empty` to the memory file.

   Do **not** abort the node on either branch's failure. Push (step 6) and the structured-JSON emit (step 8) are non-negotiable; the lifecycle flips are opportunistic.
```

- [ ] **Step 3: Static grep — confirm both calls present**

Grep `src/cli/agents/memory-writer.md` for `mark_plan_implemented\|mark_implemented`. Expected: matches in tools list (2 lines) AND in step 7 (2 calls — one per sub-step).

---

## Chunk D: Update Hard rules bullet to cover both closes

**Goal:** Pin the best-effort contract for both halves so a future edit cannot quietly upgrade either to fatal-on-failure.

### Task D.1: Rewrite the existing "best-effort" bullet

- [ ] **Step 1: Edit — generalize the bullet from `mark_plan_implemented` to "both lifecycle calls"**

`old_string`:
```
- `mark_plan_implemented` is **best-effort** — never abort the node on `success: false`. Push (step 6) and the structured-JSON emit (step 8) are non-negotiable; the lifecycle flip (step 7) is opportunistic. A frontmatter-less or already-`implemented` plan must not block finalization.
```

`new_string`:
```
- Both lifecycle calls — `mark_plan_implemented` (step 7a) and `mark_implemented` (step 7b) — are **best-effort**. Never abort the node on `success: false` from either. Push (step 6) and the structured-JSON emit (step 8) are non-negotiable; both lifecycle flips in step 7 are opportunistic. A frontmatter-less, already-`implemented`, or missing plan/illumination must not block finalization.
```

- [ ] **Step 2: Static grep — confirm bullet landed**

Grep `src/cli/agents/memory-writer.md` for `Both lifecycle calls`. Expected: one match.

- [ ] **Step 3: Commit chunks B+C+D as a single agent-file edit**

```bash
git add src/cli/agents/memory-writer.md
git commit -m "feat(memory-writer): also call mark_implemented (illumination) best-effort alongside plan close"
```

(B, C, D all touch the same file and form one logical change — split commits would make the half-applied state harder to roll back.)

---

## Chunk E: Amend `specs/2026-04-25-plans-have-no-lifecycle-design.md` line-276 paragraph

**Goal:** Bring the spec into alignment with the now-implemented design — name `memory_writer` as the canonical caller for BOTH closes, not just the plan side. Replaces the original Chunk 3 with extended scope.

### Task E.1: Rewrite the line-276 paragraph in place

- [ ] **Step 1: Edit — replace the existing paragraph**

`old_string`:
```
Agents that implement features and need to flip pending → implemented gain `mcp__illumination__mark_plan_implemented` in their `tools:` list. The agent that calls the tool is the implementing agent itself, whichever pipeline or loop is actively shipping the plan's feature; caller identity is not pinned to one specific agent file (per round-2 rationale: "user said 'agent' generically, scoped by autonomy goal; pinning to one specific agent would re-introduce a coordination point").
```

`new_string`:
```
The canonical caller for BOTH lifecycle closes is `memory_writer` (`src/cli/agents/memory-writer.md`), the terminal node of `pipelines/illumination-to-implementation.dot`. It calls `mark_plan_implemented` (step 7a) and `mark_implemented` (step 7b) as best-effort rubric steps after the unconditional `git push`. On `success: false` for either, the node logs the error to its memory file's `Learnings from the run` section and continues — the contract is symmetric across both halves of the open/close pair that `mark_dispatched` upstream opens. No other agent calls these tools from inside this pipeline; `implement.md` retains `tools: []` / `mcp: []` and remains a freeform Bash node. The reliability layer is intentional: mandatory lifecycle steps (`mark_dispatched`, `mark_archived`) live as structural tool nodes; best-effort lifecycle steps live as rubric steps because the engine has no graceful-degradation path for non-fatal failures, but agent cognition does (`src/cli/agents/memory-writer.md` Hard rules: "Both lifecycle calls … are best-effort. Never abort the node on `success: false` from either.").
```

- [ ] **Step 2: Static grep — confirm amendment landed**

Grep `specs/2026-04-25-plans-have-no-lifecycle-design.md` for `memory_writer\|canonical caller\|caller identity is not pinned`. Expected: ≥2 hits naming `memory_writer`; zero hits for `caller identity is not pinned`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-04-25-plans-have-no-lifecycle-design.md
git commit -m "docs(spec): name memory_writer as canonical caller for both lifecycle closes"
```

---

## Chunk F: Build, typecheck, and end-to-end tmux verification

**Goal:** Prove the wiring works end-to-end on the real `pipelines/illumination-to-implementation.dot` runtime against happy path AND orphan-plan negative case. Same scope as v1 Chunk 4, but the assertion set expands to cover both closes.

### Task F.1: Build and validate

- [ ] **Step 1:** `npm run build` — expect success, `dist/cli/index.js` regenerated.
- [ ] **Step 2:** `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` — expect exit 0.
- [ ] **Step 3:** `npx vitest run src/cli/tests/illumination-server.test.ts` — expect pass (no test changes; this is regression-only).

### Task F.2: Tmux happy-path run

Per `docs/harness/tmux-drive.md`. After: assert plan frontmatter `status: implemented` AND illumination frontmatter `status: implemented`. Both auto-commits should appear in the test repo's `git log`.

### Task F.3: Tmux negative-path runs

Two cases: (a) orphan plan (no frontmatter), (b) orphan illumination (no frontmatter). For each: assert the corresponding `Learnings from the run` bullet quoting the verbatim MCP error, AND that the OTHER close still succeeded.

---

## Hard rules for the implementer (v2)

- Do not edit `src/cli/agents/implement.md` or any test file. The shadow-procedure deletion + rubric extension is the entire change.
- Do not add `META_MEDITATIONS_DIR` to `memory-writer.md`'s MCP block. Memory-writer doesn't read meta-meditations.
- Step 7 in `memory-writer.md` MUST run AFTER push (step 6). Reordering breaks the orphan path — a frontmatter-less plan or illumination would block the unconditional push.
- The Hard rules best-effort bullet is load-bearing — do not weaken it. It is the only structural defence against a future edit converting either close into a fatal-on-failure step.
- The shadow-procedure deletion in Chunk A is the entry condition. If Chunk A is skipped, Chunks B/C/D land but never execute in a live run — exactly T1900's "confirmed dead zone" pattern.

## Out of scope (do NOT do)

- specs/pipeline.md authoring-convention note (T1700 step 3) — defer; not blocking lifecycle correctness.
- New automated tests beyond what already covers `markPlanImplemented` / `markImplemented` in `illumination-server.test.ts`.
- Janitor agent or MCP auto-injection bug.
- `implement.md` as a fallback caller. Redundant — `markPlanImplemented` returns `success: false` on already-implemented input but the noise is unwanted.

## Open questions resolved in-line by this plan

- **Empty `$plan_path` / `$illumination_path`:** Step 7a/7b skip the call and log a one-line note. Symmetric across both halves.
- **`Learnings` log shape:** Log only on `success: false` — match the existing rubric bar at `src/cli/agents/memory-writer.md:75-83`.
- **Why rubric not graph:** T1700. Best-effort closes need cognitive enforcement (graceful degradation); engine tool nodes have no such path.

## Files modified at the end of this plan

| File | Lines net |
|---|---|
| `pipelines/illumination-to-implementation.dot` | ~-6 / +1 (delete shadow procedure on `memory_writer` node) |
| `src/cli/agents/memory-writer.md` | ~+12 / -3 (one tool entry + step 7 split into 7a/7b + hard-rules bullet generalization) |
| `specs/2026-04-25-plans-have-no-lifecycle-design.md` | ~+5 / -2 (rewrite line-276 paragraph in place) |

Total: 3 files. No source-code changes, no new tests, no pipeline-graph topology change (only prompt-text cleanup on one node).
