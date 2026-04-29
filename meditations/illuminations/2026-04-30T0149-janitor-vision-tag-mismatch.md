---
date: 2026-04-29
status: open
description: janitor.md body references `<read_vision_vision>` but the Inputs block renders `<vision>` — the strategic compass points at a tag the LLM never receives, making the vision filter a silent no-op.
---

## Findings

1. **What:** `pipelines/janitor/janitor.md` frontmatter declares `inputs: [project, vision]` (bare key), but the procedure body instructs the agent to read `<read_vision_vision>` — the qualified tag form that would only appear if the input were declared as `read_vision.vision`.
   - **Evidence:**
     - `pipelines/janitor/janitor.md:19-20`: `inputs:\n  - project\n  - vision` (bare)
     - `pipelines/janitor/janitor.md:30`: body reads `"The auto-injected Inputs block at the top of your context contains \`<read_vision_vision>\`"` — expects the qualified-form tag
     - `src/attractor/handlers/tool.ts:66-79`: `produces_from_stdout=true` flattens last-line JSON keys with no node-ID prefix — `read_vision` emitting `{"vision":"..."}` stores `ctx.values["vision"]` (bare)
     - `src/attractor/transforms/inputs-resolver.ts:20-25`: bare input `"vision"` → `renderedTag = "vision"` → Inputs block renders `<vision>…</vision>`, never `<read_vision_vision>`
     - Confirmed by current run's pipeline context header: `vision: # ralph-cli — Vision` (bare key is live; `read_vision.vision` key is absent)
   - **Why it matters:** The janitor's strategic compass is the vision filter — every finding is supposed to be weighed against `<read_vision_vision>`. The LLM receives `<vision>` in the Inputs block but its procedure instructs it to look for `<read_vision_vision>`. The LLM either hallucinates the tag or ignores the vision entirely. Every janitor run since the v0.2.0 redesign has had a broken compass.
   - **Suggested action:** Update `pipelines/janitor/janitor.md` body — replace every occurrence of `<read_vision_vision>` with `<vision>`. One-line fix. The `inputs:` declaration and `produces_from_stdout` flat-key contract are both correct; only the body reference is wrong.

2. **What:** `src/attractor/handlers/tool.ts:67` carries a misleading inline comment: "flat, no node-ID prefix — **matches agent-handler**." Agent-handler prefixes all keys with `${metaPrefix}.` (e.g. `verifier.illumination_path`); tool.ts `produces_from_stdout` does the opposite. The comment inverts the actual relationship.
   - **Evidence:** `src/attractor/handlers/tool.ts:77-78`: `for (const [k, v] of Object.entries(parsed)) { updates[k] = v; }` — flat, no prefix. `src/attractor/handlers/agent-handler.ts` line `const outKey = \`${metaPrefix}.${key}\`` — qualified prefix. The two differ.
   - **Why it matters:** An author reading tool.ts to understand `produces_from_stdout` semantics and then checking agent-handler for comparison will conclude they're equivalent — they're not. This creates the exact class of mismatch documented in finding 1.
   - **Suggested action:** Replace the comment with: "flat, no node-ID prefix — **unlike** agent-handler which qualifies keys as `nodeId.key`; consumers must declare bare inputs to receive `produces_from_stdout` values."

## Lifecycle changes this run

- (none)

## Reading thread

- `2026-04-30T0129-same-key-three-spellings.md` — the three-spelling issue is the broader class that finding 1 falls into; v0.2.0 renamed tags by swapping dots to underscores for qualified inputs, making body text stale when the input declaration form changes
- `2026-04-30T0126-create-refine-have-inverse-context-asymmetry.md` — same session's companion: v0.2.0 context-flow changes left asymmetric states across the authoring surface; the janitor tag mismatch is one more instance of the redesign's rollout touching pipeline bodies but not procedure text
- `2026-04-26T1600-dual-procedure-problem-not-absent-rubric.md` — body-vs-rubric procedure conflicts causing LLMs to follow the wrong step list; the `<read_vision_vision>` mismatch is the same class: the LLM's procedure references something it will not find
