---
date: 2026-05-12
description: Two open notes converge on the same missing primitive — per-agent model + thinking-budget choice forced by schema, plumbed through agent.ts, and taught in SKILL.md — without it, every new pipeline silently defaults back to opus.
---

## Core Idea

Two open notes in `.apparat/notes.md` are the same architectural gap surfaced from two angles:

> - [ ] Currently almost every agent uses Opus model in pipelines/ -> Burns tokens and opus models extended thinking makes pipeline runs very long. We should investigate is there possibilities to use different models and thinking levels that can be configured for agents... After this we should also update apparatus skill with a section how to select models and thinking capabilities.
> - [ ] We should think how to pipelines' agents frontmatters could decide which model to use. -> Faster pipeline runs + less token consumption.

The grep confirms the operator's hunch: **31 of 32** agent files across `.apparat/pipelines/` and `src/cli/pipelines/` set `model: opus`; only `src/cli/pipelines/janitor/janitor.md` reaches for `sonnet`. The mechanism for per-node override already half-exists — `AgentConfig.model` is a frontmatter field consumed by `agent.ts` `buildCommonArgs` as `--model <value>` — but **(a)** the schema is an unvalidated `string` with default `"opus"`, **(b)** there is no thinking-budget knob at all (neither a CLI flag in `agent.ts` nor a frontmatter field), and **(c)** the apparatus skill (`SKILL.md` + `pipelines.md`) tells the author the field exists but never tells them how to pick. The audit-and-tier-down work is downstream of a schema gap — without forcing the choice at the seam, the next pipeline drifts back to opus by inertia.

## Why It Matters

This is a deep-modules failure on a primitive the whole codebase depends on. The seam (`AgentConfig` in `src/cli/lib/agent.ts:42–55`) has the **interface** of a model selector (one string field) but **none of the implementation that would make the choice deliberate**: no enum constraint, no thinking-budget field, no validator rule, no skill guidance. So every author writes `model: opus` because that's the default in `DEFAULTS` (`agent.ts:104`) and there is nothing — schema or doc — pushing them to think otherwise. The cost compounds: each pipeline run is paying the opus premium for nodes whose work is "format JSON" or "summarise three paragraphs" (e.g. `illumination-to-implementation/task.md` — 16 lines — and `chat-summarizer.md` / `chat-refiner.md`).

A sandboxed prior meditation at `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` (sandbox path; not in the live `list_illuminations` set) sketched the tier-down audit but stopped at "change some `opus`s to `sonnet`". That treats the symptom. The disease is that **the choice is implicit**. Adding a thinking-budget axis (the operator's first note explicitly calls this out — "opus models extended thinking makes pipeline runs very long") only makes the gap worse if it lands as another defaulted-and-ignored string. The lever is to make both axes mandatory and rendered visible — in the frontmatter, in the validator, in `apparat pipeline show`, and in the skill.

Note also: `pipelines.md §3` already documents `model:` as one-of `opus | sonnet | haiku` even though `agent.ts` accepts any string. The skill currently lies-by-omission — it claims an enum the code doesn't enforce. The schema fix removes the lie.

## Revised Implementation Steps

1. **Tighten `AgentConfig` and add `thinking`.** In `src/cli/lib/agent.ts:42–55`, change `model: string` to `model: "opus" | "sonnet" | "haiku"` and add `thinking?: "off" | "low" | "high"` (names chosen so `off` is the no-extended-thinking default — match Claude CLI capabilities; if the CLI exposes a numeric budget, accept `thinking?: number | "off"` instead and document the units). Drop `DEFAULTS.model = "opus"`; make `model` a required frontmatter field — no implicit default. `validateAgentConfig` (same file, ~line 380) raises `model is required and must be one of opus|sonnet|haiku` and `thinking must be one of off|low|high` when present.

2. **Plumb `thinking` through `buildCommonArgs`.** In `agent.ts` `buildCommonArgs` (~line 145), if `config.thinking && config.thinking !== "off"`, append the corresponding Claude CLI flag (or set the corresponding env var on the spawned process — pick whichever Claude CLI version supports; today no such pass-through exists, hence the gap). Add a single test in `src/cli/tests/agent.test.ts` asserting the flag/env is emitted when `thinking: high` and absent when `thinking: off`.

3. **Validator rule: explicit `model:` per node.** Extend the agent-frontmatter validator (`src/attractor/core/validators/` — likely `agent-resolver.ts` or `types.ts` ruleset) to reject any agent `.md` missing `model:`. Emit diagnostic key `model_required` with file:line:col + caret. This is the forcing function — without it, a forgotten `model:` field today silently lands `opus`. The validator already enforces `loop_missing_done_field` in the same shape; mirror that pattern.

4. **Render the choice in `apparat pipeline show`.** Extend `annotate-show.ts` and the agent metadata projection in `agent-loader.ts:21` (`AgentMetadata`) to include `model` and `thinking` in the SVG label — one line per agent box, e.g. `opus · think:high`. Makes a glance at the pipeline picture answer "where am I burning tokens?". This closes the loop on the operator's deeper preference (cf. `apparat pipeline show` SVG-open work in the 2324 illumination) — the rendered graph becomes the cost map.

5. **Audit pass: tier-down + thinking-off the 32 agents.** In one commit, set explicit `model:` + `thinking:` on every agent file under `.apparat/pipelines/**/*.md` and `src/cli/pipelines/**/*.md`. Decision rubric (write this into the SKILL.md update in step 6, but apply it here too):
   - **opus + think:high** — `verifier`, `design-writer`, `plan-writer`, `change-explainer`, `implement`, `memory-reflector`, `grill` (deep judgement under ambiguity)
   - **opus + think:off** — `tmux-tester`, `merge_resolver`, `batch_orchestrator`, `plan-scheduler` (procedure-heavy; opus reasoning, no need to "think")
   - **sonnet + think:off** — `task`, `chat-refiner`, `chat-summarizer`, `memory-writer`, `slice_to_issues`, `implement_from_issues`, `write_prd`, `meditate`, gates (`approval_gate`, `remove_gate`, `review_gate`, `tmux_confirm_gate`) — summarise / transform / format / mechanical glue
   - Keep `janitor.md` as-is (already sonnet). Bundled `implement.md` stays opus + think:high because the deep-loop runs many iterations under ambiguity.

6. **Add a "Choosing model + thinking" section to the skill.** Update `src/cli/skills/apparatus/SKILL.md` and the live reference `src/cli/skills/apparatus/pipelines.md §3` with the rubric above, plus a one-paragraph principle: **opus = decide / design / verify under ambiguity; sonnet = summarise / transform / format / mechanical glue; thinking = on only when the agent must reason under ambiguity, off for procedure**. Show one example `.md` frontmatter block per tier. This is what the operator's first note explicitly asks for ("update apparatus skill with a section how to select models and thinking capabilities").

7. **Validate the win.** Re-run one canonical pipeline (`illumination-to-implementation` end-to-end) before and after; compare wall-clock + token totals via `apparat pipeline trace <runId>`. If wall-clock drops materially on the chat / task / summarise nodes with no observable output-quality regression, the tier-down was correct. If a specific node regresses (e.g. `task.md` on sonnet drops critical detail), the rubric is wrong for that node — flip just that one back to opus and note the exception in the SKILL section. The point of explicit per-node frontmatter is to make those exceptions cheap to record and review.
