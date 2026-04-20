---
date: 2026-04-20
status: dispatched
description: Agent JSON-schema `description` fields are injected inline above the rubric in the agent prompt (`src/attractor/handlers/agent-handler.ts:69-70`) and emphasized by `IMPORTANT:`/`REMINDER:` wrapper text — they silently override agent-rubric instructions when the two disagree, so every edit to an agent's output format in its `.md` rubric must be matched in `pipelines/schemas/<agent>.json` or the rubric change is dead on arrival.
dispatched_at: 2026-04-20
plan_path: docs/superpowers/plans/2026-04-20-schema-description-overrides-agent-rubric.md
---

## Core Idea

`src/attractor/handlers/agent-handler.ts:69-70` wraps every agent-node prompt that declares `json_schema_file` with a three-part scaffold:

```ts
const jsonWrappedPrompt = jsonSchema
  ? `IMPORTANT: Your FINAL response MUST be valid JSON matching this schema. No markdown, no preamble, output ONLY the JSON object.\nSchema: ${jsonSchema}\n\n${expandedRawPrompt}\n\nREMINDER: Output MUST be valid JSON matching the schema above. No markdown, no explanation.`
  : expandedRawPrompt;
```

The full stringified JSON schema — including every `description` field verbatim — is pasted at the top of the prompt, framed by `IMPORTANT:` above and `REMINDER:` below. The rubric that the node prompt references (e.g. "Follow your agent-level format and procedure in `src/cli/agents/change-explainer.md`") lands *after* the schema and with no emphasis framing.

When the schema description contradicts the rubric, Claude obeys the schema description. Not because the schema is structurally authoritative — the json-schema wrapper is a prompt-only contract, it is not a hard CLI constraint (see `2026-04-13-json-schema-agentic-sessions` memory) — but because it is the more *emphatically* worded instruction earlier in the prompt.

**This is a second, parallel source of truth for agent output shape.** Authors express output shape in the `.md` rubric (human-readable, versioned with the agent). Schema descriptions are the place they forget. When the two drift, rubric edits become silent no-ops.

## Why It Matters

This session, `change-explainer` was rewritten from the old four-section format ("Currently implemented / What will change / Why it matters / Affected files") to a two-tier format ("Tier 1 plain words / Tier 2 detail"). The rubric diff was applied to all three locations where the agent lives:

1. `src/cli/agents/change-explainer.md` (source)
2. `dist/agents/change-explainer.md` (build output)
3. `~/.ralph/agents/change-explainer.md` (user-scope install)

Zero effect. The model kept emitting four-section output. The first enqueue event in transcript `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/cc62ca3f-ef4e-4722-9895-386c8f45b0ad.jsonl` contains the assembled prompt — the schema description (old four-section text) is injected above the rubric reference, framed by the `IMPORTANT:`/`REMINDER:` pair. Claude was never given a reason to trust the rubric over the schema.

The real fix was a one-line edit to `pipelines/schemas/explainer.json`'s `description` field. Before:

> "Markdown string with four sections (Currently implemented, What will change, Why it matters, Affected files). Used verbatim in the approval gate label."

After (now in source at `pipelines/schemas/explainer.json:6`):

> "Markdown render shown verbatim in the approval gate label. MUST lead with '## In plain words' (Tier 1: max 3 sentences, zero jargon/paths/T-codes, analogy-friendly, covers pain→change→gain for a reader who has never opened this repo). Then Tier 2 sections in order: '## What changes', '## Why now', '## Scope'. Total Tier 2 body ≤ 250 words, ≤ 4 bullets per section, ≤ 5 file paths across all of Tier 2. Follow the agent-level rubric for full constraints."

The bug class remains for every other agent schema in `pipelines/schemas/` that encodes output shape inside its `description` string. Any rubric rewrite for any agent with a JSON schema is at risk.

This finding deepens `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming`: contracts and node-attr-rules are not just a naming confusion — contracts can actively contradict agent rubrics. It is the flip side of `2026-04-13-json-schema-agentic-sessions` (memory): the json-schema wrapper is prompt-only, but prompt-only text is strong enough to override other prompt content, not weak. Structurally it is the same failure mode as `2026-04-19T1200-default-vars-whitelist` and `2026-04-20T1800-validator-and-runtime-disagree-on-defaults` — two sources of truth drifted.

## Revised Implementation Steps

Two fixes: (d) ship-now, (c) follow-up.

### (d) Minimal fix — rewrite every schema description as a rubric pointer

1. Audit every file under `pipelines/schemas/*.json`. Flag any `description` string that encodes output shape: section names, "four sections", heading patterns (`## X`, `### Y`), bullet conventions, sentence-count constraints, affected-file patterns.

2. Rewrite each flagged description as a short, shape-free one-liner that points to the rubric. Example shape:

   > "Markdown render per agent rubric (`src/cli/agents/<agent-name>.md`)."

   Or for non-markdown outputs:

   > "Structured output per agent rubric (`src/cli/agents/<agent-name>.md`)."

   The description should state *what the field is* (a markdown render, a decision verdict, a ranked list) without prescribing *how it is structured* — that is the rubric's job.

3. Add a lint test: walk every `pipelines/schemas/*.json`, assert each `description` is under N characters (e.g. 160) and does not contain any banned shape word from a fixed set: `section`, `sections`, `bullet`, `bullets`, `heading`, `###`, `##`, `tier`, `sentence`, `paragraph`, `max 3`, `MUST lead`, numeric word counts. Fails loudly when a future author tries to re-encode shape in a description.

4. Update `specs/pipeline.md` (or the schema-authoring doc, if one exists): one paragraph explaining that schema `description` fields are injected verbatim into the agent prompt above the rubric, and therefore MUST NOT encode output shape — output shape lives in the rubric.

### (c) Follow-up — single source of truth via generator

1. Add a structured block to agent rubrics declaring output shape. Example in `src/cli/agents/change-explainer.md`:

   ````
   ## Output shape

   ```yaml
   field: explainer_render
   type: markdown
   sections:
     - "## In plain words"
     - "## What changes"
     - "## Why now"
     - "## Scope"
   constraints:
     - "Tier 1 ≤ 3 sentences"
     - "Tier 2 body ≤ 250 words"
   ```
   ````

2. Add a build step that reads each rubric's `## Output shape` block and regenerates `pipelines/schemas/<agent>.json` descriptions from it. Rubric is authoritative; schema mirrors.

3. Gate on CI: rebuild schemas, `git diff` must be empty — out-of-sync schema fails the build.

Out of scope for this illumination; (d) is sufficient to close the bug class and keep future rubric edits from being silently overridden.

### Alternatives considered

- **(a) Strip description injection entirely.** The handler could construct a schema without `description` fields before pasting — only `type`, `properties`, `required`, `additionalProperties`. Forces authors to express shape in the rubric. Rejected as too heavy-handed: descriptions are useful for non-shape hints (e.g. "must include at least one file path"), and losing them across every agent is disproportionate.

- **(b) Schema lint heuristic.** Warn when a description contains shape-vocabulary. This is what step 3 of fix (d) does — bundled into the fix rather than as a standalone mitigation.

## Cross-References

- `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming` — names the two-schema confusion at the naming layer. This illumination deepens it: contracts can actively contradict rubrics.
- `2026-04-19T1200-default-vars-whitelist` and `2026-04-20T1800-validator-and-runtime-disagree-on-defaults` — same structural pattern (two sources of truth drifted) in different seams.
- `2026-04-13-json-schema-agentic-sessions` (memory) — prior finding that the json-schema wrapper is prompt-only. This illumination is the flip side: prompt-only text is strong enough to override other prompt content.
- Evidence transcript: `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/cc62ca3f-ef4e-4722-9895-386c8f45b0ad.jsonl` — first enqueue event shows the assembled prompt with schema description above the rubric reference.
- Mechanism: `src/attractor/handlers/agent-handler.ts:69-70`.
- Example site (fixed this session): `pipelines/schemas/explainer.json:6`.
