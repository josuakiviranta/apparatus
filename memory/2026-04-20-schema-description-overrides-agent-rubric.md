---
date: 2026-04-20
run_id: a5eafbe8-1aea-4f59-973f-159826cf7abd
plan: docs/superpowers/plans/2026-04-20-schema-description-overrides-agent-rubric.md
design: specs/2026-04-20-schema-description-overrides-agent-rubric-design.md
illumination: meditations/illuminations/2026-04-20T2700-schema-description-overrides-agent-rubric.md
test_result: pass
---

# Schema Description Overrides Agent Rubric

## What was implemented

Closed the silent-override bug class where a schema `description` injected above the rubric reference in `src/attractor/handlers/agent-handler.ts:69-70` was silently outranking agent-rubric edits. Shape-encoding descriptions in four pipeline schemas are now short rubric pointers, a vitest lint walks `pipelines/schemas/*.json` to ban shape vocabulary in descriptions, and `specs/pipeline.md` documents the rule under `### Agent Schema Descriptions`.

## Key files

- Created: `src/cli/tests/pipeline-schema-descriptions.test.ts` — lint over every `pipelines/schemas/*.json` `description` (length ≤ 160 chars, banned shape vocabulary list, numeric-shape regex + numeric-range regex for bare "N-M sentences"). `ALLOW_LIST` contains only `verifier.json:archive_reason_short` with inline justification (shell-safety content rules, not prose shape).
- Created: `src/cli/tests/__fixtures__/schemas/description-ok.json`, `description-bad.json` — self-test fixtures so the lint's detectors are pinned.
- Created: `src/cli/agents/chat-summarizer.md`, `src/cli/agents/meditate-observer.md` — rubric files that back the new pointers. Bodies migrate the inline `## Required output` / `Produce the four schema fields` blocks from the node prompts verbatim (no rewording, 1:1).
- Modified: `pipelines/schemas/chat-summarizer.json`, `explainer.json`, `meditate-observe.json`, `tmux-test-result.json` — shape-encoding descriptions rewritten as rubric pointers.
- Modified: `specs/pipeline.md` — new `### Agent Schema Descriptions` subsection under `## Node Types (Handlers)` explains that schema descriptions are prompt input and MUST NOT encode output shape.
- Modified: `src/cli/agents/change-explainer.md` — pre-session rewrite that triggered the illumination; kept as-is (rubric is now load-bearing).

## Decisions and patterns

- `ALLOW_LIST` opt-in, not silent drift. Only `verifier.archive_reason_short` is allow-listed; inline comment names the justifying content rule (shell-safety metacharacter ban + emit-when semantics on a downstream `sh -c` script). Lint error message points at `specs/pipeline.md`, not at the allow-list, so the default remediation path is rubric-migration.
- Lint augments the design's numeric regex (`max N words`) with a numeric-range regex (`\d+\s*[-–—]\s*\d+ short? sentences|bullets|…`) to catch `meditate-observe.kid_summary`'s "3-5 short sentences, no jargon". Without the augmentation that field passed (79 chars, no `max`), so red-phase enforcement would have missed it. Documented at plan Chunk 1.
- Rubric migration is **verbatim copy**, not rewrite. `chat-summarizer.md` mirrors the `## Required output` block from the DOT node prompts in `pipelines/illumination-to-implementation.dot` and `pipelines/illumination-to-plan.dot` byte-for-byte. `meditate-observer.md` mirrors the four `Steps:` + Rules block from `pipelines/smoke/tmux-tester.dot`. Avoids accidentally dropping a rule under the guise of "tidying".
- Optional Step 3 of Tasks 3/4 (shrinking the inline node prompts to cite the rubric) was **skipped** to minimize blast radius. The inline prompts still carry the shape verbatim today. The rubric files back the schema pointer; future authors can collapse the inline copies in a follow-up PR once the rubrics are proven load-bearing.
- No runtime code touched. `src/attractor/handlers/agent-handler.ts:69-70` prompt assembly kept verbatim — stripping/reordering injection was alternative (a) in the illumination and was rejected as heavy-handed.

## Gotchas and constraints

- The schema `description` is a live prompt surface, not developer-only documentation. It arrives above the rubric reference with stronger framing (`IMPORTANT:` banner + `REMINDER:` footer wrapping `Schema: ${jsonSchema}`). When rubric and description disagree, description wins — not because of structural authority, but because of position + emphasis.
- The optional inline-prompt shrink (Task 3/4 Step 3) is a **known two-sources-of-truth seam that remains open**: the DOT node prompt still inlines the same shape the rubric now encodes. If someone edits the DOT prompt without syncing the rubric (or vice versa) the seam re-opens. Tracked for a follow-up; not in scope for this PR.
- `verifier.json:archive_reason_short` intentionally exceeds 160 chars and still names shell metacharacters. Any future addition to `ALLOW_LIST` must carry an inline comment tag naming the content rule that cannot live in a rubric; silent expansion of the allow-list reintroduces the bug class.
- Generator fix (c) — structured `## Output shape` block in rubrics + build-time schema regeneration + CI `git diff` gate — is explicitly deferred. (d) is sufficient to make rubric edits load-bearing.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: npm run build succeeded (63ms), full vitest suite 1057/1057 passed across 89 files, tool.dot smoke pipeline reached exit (run_echo success, trace 3681ed57). Schema-description lint (src/cli/tests/pipeline-schema-descriptions.test.ts) is present and green, confirming the shape-vocabulary ban is enforced. No fixes needed.
