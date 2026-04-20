# Schema Description Overrides Agent Rubric — Design

**Date:** 2026-04-20
**Status:** Approved
**Source illumination:** `meditations/illuminations/2026-04-20T2700-schema-description-overrides-agent-rubric.md`

## Overview

`src/attractor/handlers/agent-handler.ts:69-70` wraps every agent-node prompt that declares `json_schema_file` with a three-part scaffold: an `IMPORTANT:` banner, the full stringified JSON schema (descriptions included, verbatim), the rubric-referencing node prompt, and a closing `REMINDER:`. When a schema `description` encodes output shape (section names, bullet conventions, sentence counts, heading patterns), it lands *above* the rubric reference and with stronger emphasis than the rubric itself. The model follows the schema description. Edits to the rubric `.md` file become silent no-ops until the matching schema description is updated.

This design closes that bug class with the minimal fix from the approved illumination: rewrite every shape-encoding `description` in `pipelines/schemas/*.json` as a short rubric pointer, add a lint test banning shape vocabulary in descriptions, and document the rule in `specs/pipeline.md`. The generator follow-up (`(c)` in the illumination) is explicitly deferred.

## What This Fixes

Agent rubric edits stop being silent no-ops. When a future author rewrites `src/cli/agents/change-explainer.md` (or any other rubric), the rubric wins — because the schema `description` no longer encodes a competing output shape.

Concrete recent failure this closes: the `change-explainer` rubric rewrite this session (four-section → two-tier) had zero effect until `pipelines/schemas/explainer.json:6` was edited. Evidence: the first enqueue event in transcript `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/cc62ca3f-ef4e-4722-9895-386c8f45b0ad.jsonl` contains the assembled prompt with the old four-section schema description injected above the rubric reference.

## What This Does NOT Do

- **No change to `src/attractor/handlers/agent-handler.ts`.** The `jsonWrappedPrompt` template is kept verbatim. Stripping or reordering the schema injection is (a) in the illumination, rejected as too heavy-handed.
- **No change to rubric `.md` files.** Rubrics already own output shape. They are not rewritten as part of this change.
- **No `## Output shape` structured block in rubrics, no generator, no CI schema-rebuild gate.** That is fix (c), deferred.
- **No retroactive rewrite of pipelines or runs.** Changes take effect on the next agent-node execution after merge.
- **No change to non-shape `description` fields.** Fields whose descriptions describe *what the value is* (path, flag, verdict, one-paragraph summary) are untouched. Only descriptions that prescribe *how the value is structured* are rewritten.
- **No change to the `$explainer_render` field name, the `explainer.json` schema structure, or any agent's `properties`/`required`/`additionalProperties`.** Only `description` strings change.

## Architecture

### Rewrite every shape-encoding schema description as a rubric pointer

Audit of `pipelines/schemas/*.json` (`ls` + targeted grep):

| Schema file | Field | Current description | Classification |
|---|---|---|---|
| `chat-summarizer.json` | `refinements` | "Cumulative refinement log. Markdown bullets with attribution per entry: each bullet states the refinement, the chat round it came from, the user's surfaced topic, and the rationale. Subsequent rounds APPEND; never drop prior entries." | **shape-encoding** (bullets, per-entry structure) |
| `explainer.json` | `explainer_render` | "Markdown render shown verbatim in the approval gate label. MUST lead with '## In plain words' (Tier 1: max 3 sentences, zero jargon/paths/T-codes, analogy-friendly, covers pain→change→gain for a reader who has never opened this repo). Then Tier 2 sections in order: '## What changes', '## Why now', '## Scope'. Total Tier 2 body ≤ 250 words, ≤ 4 bullets per section, ≤ 5 file paths across all of Tier 2. Follow the agent-level rubric for full constraints." | **shape-encoding** (section names, sentence counts, bullet/word caps) |
| `meditate-observe.json` | `kid_summary` | "Summary of the illumination written for a 5-year-old (3-5 short sentences, no jargon)" | **shape-encoding** (sentence count, jargon ban) |
| `tmux-test-result.json` | `test_render` | "Markdown-formatted block for display at the approval gate. Cover: pass/fail banner, short summary, cycles run, fixes applied (with commit hashes), remaining issues as bullets. This is read verbatim by the user at tmux_confirm_gate to decide Commit vs Retry." | **shape-encoding** (section contents, bullet convention) |
| `verifier.json` | `archive_reason_short` | "Shell-safe one-line reason suitable for archived frontmatter. ALWAYS emit. On preferred_label='false' (remove_gate → Archive path): verification reason. On preferred_label='true' (approval_gate → Decline path): placeholder 'Declined at approval gate' — consumed only if user later declines. On preferred_label='empty': empty string. One sentence, ≤100 chars, no newlines, no shell metacharacters (no $, \`, \", ', \\, ;, \|, &, <, >, (, ), {, })." | **mixed**: content rules (emit-when semantics, shell-safety) + shape hints (one sentence, ≤100 chars). Kept — content rules belong in the description. Allow-listed from both lint checks. See below. |

All other descriptions in `pipelines/schemas/*.json` (`chat-summarizer.scope_changed`, `meditate-observe.topic`, `meditate-observe.illumination_path`, `meditate-observe.observation_notes`, `verifier.preferred_label`, `verifier.illumination_path`, `verifier.summary`, `verifier.explanation`, `tmux-test-result.test_result`, `tmux-test-result.test_summary`, `tmux-test-result.issues_found`, `design-writer.design_doc_path`, `plan-writer.plan_path`, `memory-writer.memory_path`, all four `structured-output-test` fields) describe *what the value is*, not how it is structured. They are not rewritten.

**Rewrites:**

- `chat-summarizer.json` → `refinements.description`: `"Cumulative refinement log per agent rubric (src/cli/agents/chat-summarizer.md). Subsequent rounds APPEND; never drop prior entries."`
- `explainer.json` → `explainer_render.description`: `"Markdown render shown verbatim in the approval gate label per agent rubric (src/cli/agents/change-explainer.md)."`
- `meditate-observe.json` → `kid_summary.description`: `"Plain-language summary of the illumination per agent rubric (src/cli/agents/meditate-observer.md)."`
- `tmux-test-result.json` → `test_render.description`: `"Markdown render shown verbatim at tmux_confirm_gate per agent rubric (src/cli/agents/tmux-tester.md)."`

**`verifier.archive_reason_short` is kept as-is** (with its shape hints intact). Reason: shell-safety constraints on this field are not "output shape" in the rubric sense — they are content rules consumed by a downstream `sh -c` script (`pipelines/scripts/mark-archived.mjs`), not prose-rendering conventions. A rubric cannot enforce "no shell metacharacters" on the model any more reliably than the schema description can, and collapsing this to a rubric pointer removes the one piece of guidance the verifier has about the downstream consumer. Shape-vocabulary lint (below) is allow-listed for this field via a narrow exception.

Two non-shape content rules from today's `chat-summarizer.json:6` ("attribution per entry", "subsequent rounds APPEND; never drop prior entries") move into the rubric pointer's content-rule tail — "Subsequent rounds APPEND; never drop prior entries." The per-entry attribution requirement is output *shape* and lives in the rubric after this change.

### Rubric pointer contract

Every rewritten description MUST:

- Name *what the field is* in ≤15 words (e.g. "Markdown render", "Plain-language summary", "Cumulative refinement log").
- Name the rubric path inline: `per agent rubric (src/cli/agents/<agent-name>.md)`.
- Optionally carry content rules that survive the shape-lint vocabulary ban (see below) and that a rubric cannot enforce (shell-safety, append-vs-replace semantics, etc.).
- Total length under 160 characters (the lint threshold).

### Lint test: `src/tests/pipeline-schema-descriptions.test.ts`

New vitest test file. Walks every `pipelines/schemas/*.json`, reads each `description` string at any depth (top-level `description` + `properties.*.description`), asserts:

- **Length:** `description.length <= 160`.
- **Shape vocabulary ban:** description must NOT contain (case-insensitive, word-boundary match where applicable) any banned token from this fixed list:
  ```
  section   sections   bullet   bullets   heading   headings
  ##        ###        tier     tiers     MUST lead
  ```
  Plus the numeric-word-count regex `/\b(max|≤|<=|at most|up to)\s*\d+\s*(word|words|sentence|sentences|paragraph|paragraphs|bullet|bullets|char|chars|characters)\b/i` (matches "max 3 sentences", "≤ 250 words", "up to 4 bullets", "≤100 chars", etc.).

- **Allow-list:** `verifier.archive_reason_short`'s description carries content rules (emit-when semantics + shell-safety metacharacter list) that a rubric cannot enforce, and it exceeds 160 chars. Allow-list this one `file:field` pair from BOTH the length and vocabulary checks:
  ```ts
  const ALLOW_LIST = new Set([
    "verifier.json:archive_reason_short",
  ]);
  ```
  Entries in `ALLOW_LIST` skip both assertions (length + vocabulary) for that field. Any other violation fails the test. Adding an entry to `ALLOW_LIST` requires review (explicit opt-in, not silent drift) and an inline comment naming the justifying content rule.

- **Error message on failure:** names the schema file, field path, the offending substring, and a one-line remediation pointing at `specs/pipeline.md`:
  > `pipelines/schemas/foo.json:properties.bar.description contains banned shape vocabulary 'bullets'. Output shape lives in the agent rubric, not the schema description. See specs/pipeline.md § Agent Schema Descriptions.`

Test runs on every `npm test` invocation. No CI config change — the existing vitest suite picks it up.

### Documentation: new paragraph in `specs/pipeline.md`

Insert a new subsection `### Agent Schema Descriptions` under `## Node Types (Handlers)` (between the existing node-type text and `## Variable Expansion`). Body:

> Agent nodes that declare `json_schema_file` have the full stringified schema (all `description` fields verbatim) injected above the rubric reference in the assembled prompt by `src/attractor/handlers/agent-handler.ts`. A schema `description` is therefore a prompt input, not just developer documentation — and it arrives with stronger framing (`IMPORTANT:` banner) than the rubric reference. Schema descriptions MUST NOT encode output shape (section names, bullet conventions, sentence/word/bullet counts, heading patterns, tier structure). Output shape lives in the agent rubric at `src/cli/agents/<agent-name>.md`. Descriptions state *what* the field is and MAY carry content rules that the rubric cannot enforce (shell-safety, append-vs-replace semantics, emit-when conditions). The lint test `src/tests/pipeline-schema-descriptions.test.ts` enforces this — it fails loudly on banned shape vocabulary and on descriptions over 160 characters.

## Data Flow

No runtime data-flow change. The edit surface is entirely static assets (`pipelines/schemas/*.json`, `specs/pipeline.md`) and one new test file. The agent-handler prompt assembly (`src/attractor/handlers/agent-handler.ts:69-70`) is untouched; the schema it stringifies simply no longer contains competing shape instructions.

## Testing

### Red-phase tests (TDD, before rewrites land)

1. **`src/tests/pipeline-schema-descriptions.test.ts` — exists and fails on current tree.** The test is written first, with `ALLOW_LIST = new Set(["verifier.json:archive_reason_short"])` already populated. On a pre-rewrite tree it fails on `chat-summarizer.json:refinements`, `explainer.json:explainer_render`, `meditate-observe.json:kid_summary`, and `tmux-test-result.json:test_render` (shape vocabulary) and on `explainer.json:explainer_render` and `tmux-test-result.json:test_render` (length > 160). `verifier.archive_reason_short` does not fail because it is allow-listed. Red confirms the detector works.
2. Sanity: a scratch `__fixtures/description-ok.json` clone of a compliant schema passes; a scratch `__fixtures/description-bad.json` with `"bullets per section"` fails — scopes the regex check.

### Green-phase

3. All four rewrites applied. `npm test` passes. The `ALLOW_LIST` entry for `verifier.archive_reason_short` is the only exception.
4. Existing agent-handler and pipeline-runtime tests continue to pass (no code path touched).

### Post-merge manual verification (one cycle each)

5. `illumination-to-implementation` pipeline end-to-end: verifier → explainer → approval gate. Explainer output still conforms to the two-tier format (shape now defined only in `src/cli/agents/change-explainer.md`). Confirms the rubric is load-bearing after the schema description stops re-asserting shape.
6. `meditate` pipeline one full cycle: observer's `summary` is still plain-language. Confirms the rubric-pointer rewrite didn't drop required behavior.
7. Any pipeline with `chat-summarizer` or `tmux-tester`: outputs still append / still render the approval-gate block. Confirms content rules preserved in the rewritten descriptions are sufficient.

### Negative test (deferred)

8. Adding a new schema with `"description": "Markdown with three bullets"` must fail `npm test`. Implicit from the lint test — no separate negative test file required.

## Migration & Rollout

- Single PR. No feature flag. No staged rollout. Scope is four description edits, one new test file, one spec paragraph.
- Breaking change surface: none for end users. The rewritten descriptions carry strictly less prescriptive text; the rubric continues to own shape. Agent outputs converge on rubric-defined shape on the next pipeline run after merge.
- Rollback: revert the commit. Lint test reverts with it. No schema structural change means no stored artifacts are invalidated.

## Risks & Mitigations

- **Risk: a rubric somewhere under `src/cli/agents/` is missing the shape details that were implicitly carried by the schema description.** Mitigation: for each rewritten schema, diff the description against the named rubric before the commit. If the rubric doesn't already encode the same shape, the rubric is updated in the same PR. Not an architecture change — just "make the rubric complete before we delete the shape spec from the schema." For `change-explainer.md` this was already done this session; for `chat-summarizer.md`, `meditate-observer.md`, and `tmux-tester.md` the implementation step verifies and, if needed, adds the shape.
- **Risk: `ALLOW_LIST` becomes a silent escape hatch.** Mitigation: any addition to `ALLOW_LIST` requires a comment tag in-line (`// allow-listed: content rules, not prose shape — see <illumination>`), reviewed on the PR. The lint error message points at `specs/pipeline.md`, not at the allow-list, so the default remediation is rubric-migration rather than allow-list expansion.
- **Risk: future schemas skip the rubric pointer convention entirely and just put a one-liner ("a markdown string").** Accepted. The lint test enforces *negative* space (no shape vocabulary), not the pointer convention. Convention is carried by `specs/pipeline.md` and by the existing descriptions. Tightening this is a future concern if drift shows up.
- **Risk: fix (c) never lands; the two-source-of-truth seam is narrowed, not closed.** Accepted per the illumination. (d) is sufficient to make rubric edits load-bearing. (c) is a separate quality-of-life change and is explicitly deferred.

## Out of Scope

- Structured `## Output shape` blocks in rubrics.
- Generator that rebuilds schema descriptions from rubrics.
- CI gate that rebuilds schemas and asserts `git diff` empty.
- Rewriting `src/attractor/handlers/agent-handler.ts` prompt assembly (moving the rubric above the schema, stripping descriptions pre-injection, etc.).
- Any change to non-shape schema descriptions.
- Retroactive rewriting of existing runs or archived outputs.

## Cross-References

- Illumination: `meditations/illuminations/2026-04-20T2700-schema-description-overrides-agent-rubric.md`.
- Mechanism: `src/attractor/handlers/agent-handler.ts:69-70`.
- Example site already fixed this session: `pipelines/schemas/explainer.json:6` (will be rewritten again to remove remaining shape vocabulary per this spec).
- Related two-sources-of-truth illuminations: `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming`, `2026-04-19T1200-default-vars-whitelist`, `2026-04-20T1800-validator-and-runtime-disagree-on-defaults`.
- Prior json-schema finding: memory `2026-04-13-json-schema-agentic-sessions` (the wrapper is prompt-only; this illumination is the flip side — prompt-only is strong enough to override other prompt content).
- Evidence transcript: `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/cc62ca3f-ef4e-4722-9895-386c8f45b0ad.jsonl`.
