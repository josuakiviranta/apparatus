---
date: 2026-04-20
status: open
description: `plan-writer` produces chunked TDD plans but says nothing about how the finished work should be verified end-to-end; `tmux_tester` is left to guess which smokes, scenarios, or TUI exercises cover each chunk and this session that guess was wrong (one `tool.dot` smoke run for a schema/agent-handler change). Adding a required `## Verification targets` block per chunk — naming the smokes, scenarios, or manual exercises that must be run to prove the chunk shipped — turns verification from LLM judgment into a checklist `tmux_tester` executes verbatim.
---

## Core Idea

`plan-writer` (`src/cli/agents/plan-writer.md`) produces a chunked TDD plan where every chunk has:

- `## Chunk N: <name>`
- failing test → implementation → commit

Nothing in the plan states **how the chunk is verified end-to-end after the commit lands**. Unit tests are in the chunk (they are the TDD step), but integration-level verification — which smoke pipelines exercise the touched surface, which CLI commands need a manual run, which TUI overlays need a tmux check — is entirely delegated to `tmux_tester` several nodes later. By the time `tmux_tester` runs, it has:

- the plan path (string)
- the diff (via `git log`, not structured — see `2026-04-20T2800-tmux-tester-changed-surfaces-context`)
- its own rubric's Phase 2 surface-to-smoke map

…and has to re-derive, from scratch, what the plan's author already knew. If the plan's author had named the verification targets at planning time (while the author is thinking about the change), that knowledge would propagate downstream instead of dissolving.

On run `a5eafbe8` (schema-description-overrides-agent-rubric), the plan authored four chunks touching `pipelines/schemas/*.json`, `src/cli/agents/*.md`, `src/cli/tests/`, and `specs/pipeline.md`. The plan made no claim about which smokes cover those surfaces. `tmux_tester` picked `tool.dot` — which covers neither schemas nor agents nor the agent-handler. The verification was a no-op relative to the change, and no one inside the pipeline had the information to notice.

A **verification matrix** in the plan closes this loop. Concretely, each chunk gets a mandatory block:

```markdown
## Verification targets

- Smokes: `pipelines/smoke/chat-end-to-end.dot`, `pipelines/smoke/tmux-tester.dot`, `pipelines/smoke/json-schema-stream.dot`
- Scenario tests: `scenario-tests/pipeline-schema-lint.sh`
- Manual exercise: `ralph pipeline run pipelines/illumination-to-plan.dot` with a fixture illumination — watch the explainer output at the approval gate.
- Lint: `npm test src/cli/tests/pipeline-schema-descriptions.test.ts`
- Surfaces touched: `pipelines/schemas/`, `src/cli/agents/`, `specs/pipeline.md`
```

`tmux_tester` then has a **deterministic checklist** — not a guess. It runs each named smoke, each named scenario, and reports per-item pass/fail.

## Why It Matters

Three gaps collapse into one fix.

1. **Verification drifts from intent.** The author who writes the plan knows why the chunk matters and which runtime path it exercises. That knowledge is the highest-value input to verification. Today it is discarded between the plan-writer and tmux-tester nodes.

2. **tmux_tester's rubric is load-bearing and brittle.** Any surface → smoke map lives in one rubric (`src/cli/agents/tmux-tester.md` Phase 2, post-`2026-04-20T2800` edit). If a new smoke ships without updating the map, or a new surface ships without mapping to a smoke, verification silently narrows. Moving the mapping into the plan per-change makes it a current-state artifact rather than a rubric that must be kept in sync.

3. **Surface coverage is retrospectively undefined.** After a pipeline run, there is no record of "this run verified smokes X, Y, Z". `ralph pipeline trace` can reconstruct it from `tmux_tester`'s tool calls, but a structured `verification_targets` field on the run would make coverage analysis trivial — count changes without coverage, count coverage without changes, prune stale smokes.

The parallel is exactly `2026-04-20T2200-explicit-consumes-declarations`: implicit relationships become brittle; declared ones are enforceable, debuggable, and refactorable.

## Revised Implementation Steps

### (a) Require `## Verification targets` in plan-writer output

1. Edit `src/cli/agents/plan-writer.md` Procedure step 4 ("Structure the plan as chunks"). Add a required sub-section to the chunk template:
   ```
   ## Verification targets
   - Smokes: <list of pipelines/smoke/*.dot files that exercise the touched surfaces>
   - Scenario tests: <scenario-tests/*.sh if applicable, else "None">
   - Manual exercises: <ralph commands or TUI checks, else "None">
   - Lint: <specific npm test target or "None">
   - Surfaces touched: <matching surface labels from pipelines/surfaces.json>
   ```
2. Update `pipelines/schemas/plan-writer.json` — add a required `verification_targets` structured field to the plan-writer output contract. Per the rubric-authority principle (`2026-04-20T2700-schema-description-overrides-agent-rubric`), keep the schema `description` as a short pointer back to the rubric; describe the field's semantics inside the rubric, not in the description text.
3. Add a lint test under `src/cli/tests/`: every plan at `docs/superpowers/plans/*.md` must contain a `## Verification targets` subsection per `## Chunk` heading. Red-phase fixture under `__fixtures__/plans/missing-verification.md` to prove the detector fires.

### (b) tmux_tester consumes the matrix

1. `illumination-to-implementation.dot` gains a context pass: plan-writer's structured output is already stored (as `plan_path` today plus, after (a), a `verification_targets` array). Wire `verification_targets` into `tmux_tester`'s context.
2. Edit `src/cli/agents/tmux-tester.md` Phase 2: if `$verification_targets` is present, prefer it over the surface-to-smoke map. The map becomes the fallback when the plan is older than the verification-targets requirement or the field is empty.
3. `test_render` output includes the per-target verdict: `✓ pipelines/smoke/chat-end-to-end.dot`, `✗ pipelines/smoke/tmux-tester.dot (crashed at node verify)`, etc. Gate user sees the matrix.

### (c) Coverage reporting

1. `ralph pipeline trace <runId> --coverage` reads the `tmux_tester` node's output and prints: "Verified N of M declared targets; unverified: [...]; unexpected errors: [...]".
2. `ralph pipeline list --coverage` aggregates across recent runs — surfaces an operator view of which smokes are routinely exercised vs dormant.
3. Defer until (a) + (b) have shipped on 3+ real runs; the coverage command is a natural follow-on but its design leans on concrete data.

### Alternatives considered

- **Keep the surface → smoke map only in tmux-tester's rubric.** This is what `2026-04-20T2800` plus the recent rubric edit already does. Good enough in the short term; brittle in the long term (map lives in one agent's head, drifts when smokes are added, and says nothing about scenario tests or TUI exercises). The verification matrix is the superset.

- **Generate the matrix automatically from `changed_files` + surface map.** Clean, but loses author intent: the plan-writer often knows that a specific TUI path or a specific fixture needs to be exercised, which the surface map cannot infer. Auto-generate as a default, let the author edit. Optional follow-on to (a).

- **Put the matrix in a separate file per chunk.** Rejected: splits plan from verification. The plan is the canonical artifact; keep verification inside it so the author reads both together.

## Cross-References

- `2026-04-20T2800-tmux-tester-changed-surfaces-context` — paired illumination; together they remove the "what to verify" guesswork at two ends (diff-side there, plan-side here).
- `2026-04-20T2700-schema-description-overrides-agent-rubric` — ties the `verification_targets` schema field authoring rule back to the rubric-authority principle.
- `2026-04-20T2200-explicit-consumes-declarations` — same structural intuition: make implicit dependencies explicit and structured.
- `2026-04-20T2600-pipeline-smoke-harness-first-class` — this illumination pairs well: smokes as first-class, paired with a declared verification matrix, give CI / `tmux_tester` / authors a shared contract about what each change must clear.
- `2026-04-20-schema-description-overrides-agent-rubric` (memory) — the run where `tmux_tester` picked the wrong smoke; Final verification section names `tool.dot` as the sole smoke, which would not have passed a verification-matrix check.
- Rubric to edit: `src/cli/agents/plan-writer.md` (step 4 of Procedure), `src/cli/agents/tmux-tester.md` (Phase 2).
- Schema to extend: `pipelines/schemas/plan-writer.json` (add `verification_targets` field).
