# Design: Model + thinking as first-class agent frontmatter

**Status:** Approved (illumination verified `true`, gate Approve, no interactive refinements)
**Source illumination:** `.apparat/meditations/illuminations/2026-05-12T2354-model-and-thinking-as-first-class-frontmatter.md`
**Date:** 2026-05-14

## 1. Motivation

Two open notes in `.apparat/notes.md` flagged the same architectural gap:
1. Almost every agent uses `opus`, burning tokens and stretching wall-clock.
2. Per-agent model choice should be expressed in frontmatter.

The seam (`AgentConfig` in `src/cli/lib/agent.ts:49-62`) already has the shape of a model selector — one `model: string` field consumed by `buildCommonArgs` as `--model <value>` — but none of the implementation that would make the choice deliberate. `pipelines.md §3` documents `model:` as enum `opus | sonnet | haiku` while the schema accepts any string with `DEFAULTS.model = "opus"` as silent fallback. The skill currently lies-by-omission. No thinking-budget axis exists in code, frontmatter, or doc at all.

### Concrete state (verified 2026-05-14)

- `model: string` at `src/cli/lib/agent.ts:52` (not the documented enum).
- `DEFAULTS.model = "opus"` at `src/cli/lib/agent.ts:116`.
- `args.push("--model", this.config.model)` at `src/cli/lib/agent.ts:147` — no thinking flag emitted.
- `model: config.model ?? DEFAULTS.model!` fallback in `validateAgentConfig` at `src/cli/lib/agent.ts:512`.
- `AgentMetadata { inputs: string[]; outputs: string[] }` at `src/cli/lib/agent.ts:75-78` — no `model` / `thinking` exposed to the renderer.
- `annotate-show.ts:74-75` renders only `in:` / `out:` label lines.
- 27 agent `.md` files set `model: opus`; 9 declare no `model:` at all (gates plus `subagent-prompt-template.md`); 1 (`janitor.md`) sets `sonnet`. (Illumination said 31/32 — same direction, smaller absolute. Headline impact unchanged.)

### Why this slot

The lever is to make both axes mandatory and rendered visible — in the frontmatter, in the validator, in `apparat pipeline show`, and in the skill. `docs/adr/0001-agents-live-next-to-pipeline.md` (agents live next to `pipeline.dot`), `docs/adr/0012-validation-context.md` (clustered validator architecture, signature `(ctx, node) => void`), `docs/adr/0018-pipeline-show-opens-svg.md` (pipeline-show SVG annotation as the established surface) all directly support extending these primitives. (Note: this design refers to `0018-pipeline-show-opens-svg.md`; the earlier `0018` collision has since been resolved by renumbering the sleep ADR to `0021-prevent-system-sleep-during-pipeline-runs.md`.) No new mechanism is invented.

## 2. Decision summary

Tighten the schema, force the choice at validation, plumb thinking through the spawn, render both on the diagram, then tier-down every shipped agent in one atomic commit.

1. **Tighten `AgentConfig`.** In `src/cli/lib/agent.ts:52`, change `model: string` to `model: "opus" | "sonnet" | "haiku"`. Add optional `thinking?: "off" | "low" | "high"`. Drop the entry `DEFAULTS.model = "opus"` from `DEFAULTS` at `src/cli/lib/agent.ts:115-120` and remove the `config.model ?? DEFAULTS.model!` fallback at `src/cli/lib/agent.ts:512`. `validateAgentConfig` raises `model is required and must be one of opus|sonnet|haiku` when missing/wrong; raises `thinking must be one of off|low|high` when present and wrong.
2. **Plumb `thinking` through `buildCommonArgs`.** In `src/cli/lib/agent.ts:144-164`, when `config.thinking && config.thinking !== "off"`, append the Claude CLI thinking flag (or set the corresponding spawn env var — pick whichever the installed Claude CLI version supports today; document the choice inline). `off` emits nothing — identical to current behavior.
3. **Validator rule `model_required`.** Add a new check in the `src/attractor/core/validators/` cluster mirroring `checkLoopRequiresDoneField` at `src/attractor/core/validators/interactive.ts:9-27`. Walks every node with `node.agent`; resolves via `tryResolveAgent`; pushes diagnostic key `model_required` (severity error, with `node.sourceLocation`) when frontmatter omits `model:` or sets a non-enum value. Same shape as `loop_missing_done_field`. Same file:line:col + caret rendering as the existing source-location diagnostics shipped in v0.1.31.
4. **Render model + thinking in `apparat pipeline show`.** Extend `AgentMetadata` at `src/cli/lib/agent.ts:75-78` to `{ inputs, outputs, model, thinking? }`. Extend `extractAgentMetadata` at `src/cli/lib/agent-loader.ts:22`. In `src/cli/lib/annotate-show.ts:74-75`, append a third line per agent node: `opus · think:high` when thinking is set, `opus` otherwise. The label render is the established surface (ADR-0018); a glance at the SVG answers "where am I burning tokens?".
5. **One-commit tier-down.** Set explicit `model:` + `thinking:` on every agent `.md` under `.apparat/pipelines/**/*.md` and `src/cli/pipelines/**/*.md` per the rubric in §5. Same commit lands the schema change, validator rule, thinking plumbing, label render, agent migrations, and fixture migrations — the breaking change is atomic.
6. **Skill rewrite.** Update `src/cli/skills/apparatus/SKILL.md` and `src/cli/skills/apparatus/pipelines.md §3` with a "Choosing model + thinking" section: the rubric, one example frontmatter block per tier, and the one-paragraph principle.

**Out of scope:**
- Per-run override flag (`--model` / `--thinking` on `apparat pipeline run`).
- Numeric thinking budgets (`thinking: 8000`); the CLI surface stays categorical until use cases demand otherwise.
- Cost telemetry beyond what `apparat pipeline trace` already exposes.
- Model selection for non-agent nodes (gates inherit from agent-md only).

## 3. Architecture

### 3.1 Before / after at the seam

Before (`src/cli/lib/agent.ts:49-62`):
```ts
export interface AgentConfig {
  name: string;
  description: string;
  model: string;                              // accepts anything
  permissionMode: string;
  tools: string[];
  mcp: McpServerConfig[];
  prompt: string;
  jsonSchema?: string;
  outputs?: Record<string, JsonSchemaFragment>;
  inputs?: string[];
  loop?: boolean;
  maxIterations?: number;
}
```

After:
```ts
export type AgentModel = "opus" | "sonnet" | "haiku";
export type AgentThinking = "off" | "low" | "high";

export interface AgentConfig {
  name: string;
  description: string;
  model: AgentModel;                          // required enum
  thinking?: AgentThinking;                   // optional, "off" when omitted
  permissionMode: string;
  tools: string[];
  mcp: McpServerConfig[];
  prompt: string;
  jsonSchema?: string;
  outputs?: Record<string, JsonSchemaFragment>;
  inputs?: string[];
  loop?: boolean;
  maxIterations?: number;
}
```

`DEFAULTS` (`src/cli/lib/agent.ts:115-120`) loses the `model` key. `validateAgentConfig` (`src/cli/lib/agent.ts:482-523`) gains:
```ts
if (config.model !== "opus" && config.model !== "sonnet" && config.model !== "haiku") {
  throw new Error(`model is required and must be one of opus|sonnet|haiku (got: ${config.model ?? "undefined"})`);
}
if (config.thinking !== undefined &&
    config.thinking !== "off" && config.thinking !== "low" && config.thinking !== "high") {
  throw new Error(`thinking must be one of off|low|high (got: ${config.thinking})`);
}
```
…and the returned record loses the `?? DEFAULTS.model!` fallback at line 512, plus conditionally spreads `thinking`.

### 3.2 `buildCommonArgs` plumbing

**Contract:** thinking-budget is categorical (`off` / `low` / `high`), off-by-default, and is plumbed to the Claude CLI via **a spawn-time environment variable**, not a CLI flag. The env var (`CLAUDE_THINKING_BUDGET` or whatever the installed Claude CLI version reads — verified once at implementation time, then pinned) is the chosen contract because it survives CLI-flag churn across Claude CLI versions and is the same mechanism `agent.ts` already uses for MCP config paths. The implementer does **not** evaluate a flag-vs-env tradeoff at implementation time — env is the design's chosen plumbing.

`src/cli/lib/agent.ts:226-263` (the spawn block in `Agent.run`) gains the env var injection in `spawnOptions`:
```ts
const spawnOptions: any = {
  cwd: options.cwd,
  detached: true,
  env: this.config.thinking && this.config.thinking !== "off"
    ? { ...process.env, CLAUDE_THINKING_BUDGET: this.config.thinking }
    : process.env,
};
```
(`runInteractive` at `src/cli/lib/agent.ts:390-478` gets the same treatment.) `buildCommonArgs` itself does not change beyond what §3.1 already pins (the existing `--model` push at line 147 stays as-is). A single unit test in `src/cli/tests/agent.test.ts` asserts (a) `thinking: high` sets the env var, (b) `thinking: off` leaves the env var unset, (c) omitted `thinking` leaves the env var unset. The exact env var name is verified at implementation time against the installed Claude CLI; if no such env var exists in the installed version, the implementer pins the Claude CLI to a version that does — the design's contract is env-based, not flag-based.

### 3.3 Validator rule

New file `src/attractor/core/validators/model-required.ts` (mirror of `interactive.ts:9-27`):
```ts
import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { tryResolveAgent } from "./agent-resolver.js";

export function checkModelRequired(ctx: ValidationContext, node: Node): void {
  if (!node.agent) return;
  const agentConfig = tryResolveAgent(node, ctx.dotDir);
  if (!agentConfig) return;             // unresolved agent — separate rule
  const m = (agentConfig as { model?: unknown }).model;
  if (m === "opus" || m === "sonnet" || m === "haiku") return;
  ctx.diags.push({
    rule: "model_required",
    severity: "error",
    message: `Agent "${node.agent}" at node "${node.id}" is missing required model: field. Add 'model: opus|sonnet|haiku' to the agent frontmatter.`,
    location: node.sourceLocation,
  });
}
```
Wire-up matches the existing rule-cluster pattern documented in ADR-0012. The `tryResolveAgent` short-circuit lets the agent's own `validateAgentConfig` throw on enum-misspellings; the validator pass catches the missing-field case at the node-level so the diagnostic carries the `pipeline.dot` source location, not the agent.md path.

`graph-validator-byte-identical.test.ts` (ADR-0009 regression oracle) regenerates mechanically — that contract is designed to break and re-baseline when new rules emit diagnostics.

### 3.4 SVG label render

`src/cli/lib/agent.ts:75-78`:
```ts
export interface AgentMetadata {
  inputs: string[];
  outputs: string[];
  model: AgentModel;
  thinking?: AgentThinking;
}
```

`src/cli/lib/agent-loader.ts:22` `extractAgentMetadata` returns the two new fields verbatim from config.

`src/cli/lib/annotate-show.ts:73-79` gains one line in the label assembly:
```ts
const lines = [child.id.value];
if (meta.inputs.length) lines.push(`in: ${meta.inputs.join(", ")}`);
if (meta.outputs.length) lines.push(`out: ${meta.outputs.join(", ")}`);
const modelLine = meta.thinking && meta.thinking !== "off"
  ? `${meta.model} · think:${meta.thinking}`
  : meta.model;
lines.push(modelLine);
```
The model line always renders (the field is required); thinking renders only when non-`off` to keep the diagram readable. A unit test in `src/cli/tests/annotate-show.test.ts` covers both branches.

### 3.5 The tier-down commit

One atomic commit lands:
- `src/cli/lib/agent.ts` (schema + plumbing).
- `src/cli/lib/agent-loader.ts` (metadata extraction).
- `src/cli/lib/annotate-show.ts` (label render).
- `src/attractor/core/validators/model-required.ts` (new file, plus cluster registration).
- `src/attractor/tests/graph-validator-byte-identical.test.ts` (snapshot regen).
- `src/cli/tests/agent.test.ts` (thinking env var emit/non-emit).
- `src/cli/tests/annotate-show.test.ts` (model line render).
- **37 agent `.md` frontmatter edits** per the rubric in §5. Breakdown (verified 2026-05-14):
  - **7 stay opus, gain `thinking: high`** — the opus+think:high tier (verifier, design-writer, plan-writer, change-explainer, implement, memory-reflector, grill).
  - **4 stay opus, gain `thinking: off`** — the opus+think:off tier (tmux-tester, merge_resolver, batch_orchestrator, plan-scheduler).
  - **16 retier from opus → sonnet, gain `thinking: off`** — the sonnet+think:off tier among the currently-opus set (task, chat-refiner, chat-summarizer, memory-writer, slice_to_issues, implement_from_issues, write_prd, meditate, and the currently-opus gates if any — implementer applies rubric file-by-file).
  - **9 gate/template files gain both `model: sonnet` + `thinking: off`** — the no-model-today set listed in §7.
  - **1 file (`src/cli/pipelines/janitor/janitor.md`)** stays `sonnet`, gains explicit `thinking: off`.
- 7 test fixtures gain `model: sonnet` (`src/attractor/tests/fixtures/auto-inputs-good/{empty,producer,consumer,with-default}.md`, `src/cli/tests/fixtures/parallel-illumination-to-implementation/plan-{all-parallel,mixed,all-serial}.md`).
- Doc updates per §6.

Splitting any of these breaks the build mid-commit: the schema change without the agent migrations fails every pipeline, the agent migrations without the validator fall back to the silent default. Atomic by necessity.

## 4. Data flow

```
pipeline.dot Node (agent="verifier")
        │
        ▼
tryResolveAgent ──► loadAgent ──► validateAgentConfig
        │                              │
        │                       enforce enum +
        │                       enforce thinking if set
        │
        ▼
checkModelRequired (new) ──► diagnostic on missing/invalid
        │
        ▼
extractAgentMetadata ──► AgentMetadata { inputs, outputs, model, thinking? }
        │
        ├─► annotate-show.ts ──► SVG label "opus · think:high"
        └─► Agent.buildCommonArgs ──► --model opus --thinking high ──► claude
```

No new IPC, no new persistence, no engine change beyond the spawn arglist. The validator's existing `tryResolveAgent` short-circuit means agent.md-level enum errors throw inside `validateAgentConfig` (as today for required fields); only the missing-`model:` case is surfaced as a node-level diagnostic with `pipeline.dot` source location.

## 5. Rubric

Written into SKILL.md + pipelines.md and applied to every shipped agent.

| Tier | Use for | Examples |
|---|---|---|
| **opus + think:high** | Decide / design / verify under ambiguity | `verifier`, `design-writer`, `plan-writer`, `change-explainer`, `implement`, `memory-reflector`, `grill` |
| **opus + think:off** | Procedure under opus reasoning (mechanical orchestration over many nodes) | `tmux-tester`, `merge_resolver`, `batch_orchestrator`, `plan-scheduler` |
| **sonnet + think:off** | Summarise / transform / format / mechanical glue | `task`, `chat-refiner`, `chat-summarizer`, `memory-writer`, `slice_to_issues`, `implement_from_issues`, `write_prd`, `meditate`, all gates (`approval_gate`, `remove_gate`, `review_gate`, `tmux_confirm_gate`) |

Bundled `implement.md` stays opus + think:high (deep-loop runs many iterations under ambiguity). `janitor.md` stays sonnet; gains `thinking: off` explicitly.

One-paragraph principle: **opus = decide / design / verify under ambiguity; sonnet = summarise / transform / format / mechanical glue; thinking = on only when the agent must reason under ambiguity, off for procedure.**

## 6. Doc / spec ripple

- `docs/adr/0001-agents-live-next-to-pipeline.md` — one-paragraph amendment noting `model:` is now required, `thinking:` optional.
- `docs/adr/0012-validation-context.md` — list `model_required` in the rule inventory.
- `docs/adr/0018-pipeline-show-opens-svg.md` — note model + thinking now appear in node labels. (The prior numeric collision was resolved by renumbering the sleep ADR to `docs/adr/0021-prevent-system-sleep-during-pipeline-runs.md`; this ripple touches only the pipeline-show-opens-svg ADR.)
- `README.md:174` — update example frontmatter block.
- `CONTEXT.md` — the upstream verifier flagged "~line 141"; on direct inspection that line is a smoke-pipeline-scenario reference, not a canonical frontmatter list. **Action:** implementer greps `CONTEXT.md` for the agent-frontmatter description block (search for `model:` / `outputs:` mentions) and either (a) updates it in place if a canonical list exists or (b) adds a new short subsection naming the required `model:` enum and the optional `thinking:` field. Do not edit line 141 mechanically.
- `src/cli/skills/apparatus/SKILL.md` — new "Choosing model + thinking" subsection with the §5 rubric.
- `src/cli/skills/apparatus/pipelines.md §3` — replace the example with one that includes `thinking:`; remove the lie-by-omission line that documents `model:` as enum while code accepted any string (the schema now matches the doc); add the rubric.

## 7. Blast radius / impact surface

**Size:** L.

**Surfaces crossed:** AgentConfig public interface · validator cluster · SVG render projection · all shipped pipelines · skill docs · ADR set.

**Breaking changes (enumerate):**
1. `AgentConfig.model` becomes a required enum field. Contract broken: callers that constructed `AgentConfig` literals with `model: string` (e.g. tests, fixtures) need updating.
2. `DEFAULTS.model = "opus"` removed. Contract broken: any agent `.md` missing `model:` now fails validation that previously ran silently with the opus default.
3. `AgentMetadata` shape widens by two fields. Contract broken: any consumer destructuring metadata (today only `annotate-show.ts`) needs the new fields available; widening is additive — no consumer becomes invalid, but `annotate-show.ts` is updated in the same commit anyway.

**Files-touched checklist:**

Core (3):
- [ ] `src/cli/lib/agent.ts` — schema, defaults, validator, plumbing (incl. `spawnOptions.env` injection at `:226-263` and `:390-478`)
- [ ] `src/cli/lib/agent-loader.ts:22` — `extractAgentMetadata`
- [ ] `src/cli/lib/annotate-show.ts:73-79` — label render

New (1):
- [ ] `src/attractor/core/validators/model-required.ts` + cluster wire-up

Tests (3 new + 1 regen):
- [ ] `src/cli/tests/agent.test.ts` — thinking env var set / unset / absent
- [ ] `src/cli/tests/annotate-show.test.ts` — model+thinking label render
- [ ] `src/attractor/tests/validators/model-required.test.ts` — diagnostic on missing / bad enum
- [ ] `src/attractor/tests/graph-validator-byte-identical.test.ts` — snapshot regen (mechanical)

Agent .md migrations (37 files total — verified 2026-05-14):

| Sub-bucket | Count | Action | Source |
|---|---|---|---|
| Currently `model: opus`, retier to **opus + think:high** | 7 | Add `thinking: high` | Rubric §5 (verifier, design-writer, plan-writer, change-explainer, implement, memory-reflector, grill) |
| Currently `model: opus`, retier to **opus + think:off** | 4 | Add `thinking: off` | Rubric §5 (tmux-tester, merge_resolver, batch_orchestrator, plan-scheduler) |
| Currently `model: opus`, retier to **sonnet + think:off** | 16 | Change to `model: sonnet`, add `thinking: off` | Rubric §5 sonnet tier among currently-opus files |
| Currently no `model:` (gates + template) | 9 | Add `model: sonnet` + `thinking: off` | `.apparat/pipelines/idea-to-issues/approve_breakdown.md`, `.apparat/pipelines/illumination-to-implementation/{remove,review,approval,tmux_confirm}_gate.md`, `.apparat/pipelines/parallel-illumination-to-implementation/{remove,approval,tmux_confirm}_gate.md`, `.apparat/pipelines/parallel-illumination-to-implementation/subagent-prompt-template.md` |
| Currently `model: sonnet` (janitor) | 1 | Add `thinking: off` | `src/cli/pipelines/janitor/janitor.md` |
| **Total** | **37** | | |

Implementer note: the "retier to sonnet" count of 16 is derived (27 currently-opus − 7 opus+high − 4 opus+off = 16). If the file-by-file rubric application surfaces a node that doesn't fit any §5 tier (e.g. a new agent shipped between this design and implementation), the implementer flips it to the closest-matching tier and notes the call-out in the implementation-plan checkbox.

Test fixtures (7):
- [ ] `src/attractor/tests/fixtures/auto-inputs-good/{empty,producer,consumer,with-default}.md` — add `model: sonnet` (fixtures don't run; sonnet is the cheapest enum value and reflects fixture intent)
- [ ] `src/cli/tests/fixtures/parallel-illumination-to-implementation/plan-{all-parallel,mixed,all-serial}.md` — add `model: sonnet`

Docs (7):
- [ ] `docs/adr/0001-agents-live-next-to-pipeline.md`
- [ ] `docs/adr/0012-validation-context.md`
- [ ] `docs/adr/0018-pipeline-show-opens-svg.md` (specifically — not the unrelated `0021-prevent-system-sleep-…` ADR)
- [ ] `README.md:174`
- [ ] `CONTEXT.md` — implementer locates the right block; see §6
- [ ] `src/cli/skills/apparatus/SKILL.md`
- [ ] `src/cli/skills/apparatus/pipelines.md §3`

**Why atomic:** the schema change without the agent migrations fails every pipeline run on the next invocation; the agent migrations without the validator leave silent defaults in place. The breaking change must land in one commit. Plan-author should chunk for review purposes (schema+plumbing → validator+tests → docs → audit) but ship the merge as one squash.

## 8. Constraints

- Claude CLI surface for thinking-budget pass-through must be resolved at implementation time by reading the installed CLI's `--help`. If the CLI exposes no thinking flag in the installed version, the implementer pins a CLI version that does, or falls back to setting an env var on the spawn options; either way, the unit test in §3.2 pins the contract.
- The validator rule emits at `node.sourceLocation` (pipeline.dot), not at the agent.md location, because `loadAgent` short-circuits when frontmatter validation throws. This is consistent with `loop_missing_done_field` (`src/attractor/core/validators/interactive.ts:23`) which also fires at the node site.
- `graph-validator-byte-identical.test.ts` is expected to break-and-regenerate per ADR-0009.
- Migration cannot be split. Any incremental approach leaves the codebase invalid mid-merge.

## 9. Validate the win

After the commit lands, re-run one canonical pipeline (`illumination-to-implementation` end-to-end) and compare wall-clock + token totals via `apparat pipeline trace <runId>` against a baseline captured just before the commit. Expectation: material drop on chat / task / summarise nodes with no output-quality regression. If a specific node regresses (e.g. `task.md` on sonnet drops critical detail), flip just that one back to opus and note the exception in the SKILL section — the point of explicit per-node frontmatter is to make those exceptions cheap to record.

## 10. Open questions

None blocking. The Claude CLI thinking-flag spelling is the only soft spot, and it's a one-line implementation detail rather than a design question — the contract (categorical, three levels, off-by-default) is locked.
