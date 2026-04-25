---
id: spec-2026-04-25-meditate-prompt-is-write-only
type: spec
created: 2026-04-25
status: draft
tags: [meditate, agent-config, tool-whitelist, solid, prompt]
illumination_source: meditations/illuminations/2026-04-14T1200-meditate-prompt-is-write-only.md
---

# Meditate Prompt Is Write-Only — SOLID Split

## Problem

`src/cli/agents/meditate.md` declares the agent reflective-only at line 28:

> "You are a silent analyst for this software project. Your role is reflective, not executive — you observe, think, and write insights. **You cannot and will not implement anything.**"

But its `tools:` whitelist (lines 7–18) hands the agent five state-mutating lifecycle tools that the prompt body never invokes:

```yaml
# src/cli/agents/meditate.md:7-18
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented        # unused
  - mcp__illumination__mark_dispatched         # unused
  - mcp__illumination__mark_archived           # unused
  - mcp__illumination__list_plans              # unused
  - mcp__illumination__mark_plan_implemented   # unused
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

The prompt body (`meditate.md:55-69`) never references any of those five lifecycle tools. They are unused capability — declared role and granted role have drifted apart.

Concurrently the exploration step (`meditate.md:61`) is generic — *"Use `glob_files` and `read_file` to explore files relevant to the current state of the codebase, architecture, and plans"* — and the reflection brief (`meditate.md:64`) is narrow ("what does the project need, and what do the lenses reveal about it?"). The agent reflects only on gaps, not on architecture, scalability, or feature-creep risk, so illuminations skew tactical.

A divergent file `src/cli/prompts/PROMPT_meditation.md:38-39` carries a reactive *"If the user reports... call `mark_implemented`"* step that `meditate.md` lacks. This is not a fix — it is the same SOLID violation in a second place.

## Goal

Make `src/cli/agents/meditate.md` honor its own self-declaration. Strip the five unused lifecycle tools from the whitelist, and widen the prompt to architect-mode reflection so the agent produces strategic illuminations as well as gap-spotting ones.

Closure of resolved illuminations is **explicitly someone else's job** (a future janitor agent, sketched below but not built here).

## Non-Goals

- No new pipeline node, no new agent, no new pipeline file. The user's pipeline-simplicity preference is binding.
- No janitor agent in this change. Janitor is sketched in *Future Work* only.
- No automatic backlog closure mechanism. The corpus will keep growing monotonically until a janitor ships. **This is an accepted side-effect** (refinements log, round 1).
- No changes to the MCP illumination server or any other agent's whitelist.

## Design

### Before / After (single file edit)

**`src/cli/agents/meditate.md`** is the only production file edited.

#### Change A — Strip 5 lifecycle tools from the `tools:` whitelist

**Before** (lines 7–18, current source):

```yaml
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented
  - mcp__illumination__mark_dispatched
  - mcp__illumination__mark_archived
  - mcp__illumination__list_plans
  - mcp__illumination__mark_plan_implemented
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

**After**:

```yaml
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

Five entries deleted: `mark_implemented`, `mark_dispatched`, `mark_archived`, `list_plans`, `mark_plan_implemented`. The remaining seven match the prompt body's actual tool calls (lines 55–69).

#### Change B — Widen exploration step (around `meditate.md:61`)

**Before**:

> "3. Use `glob_files` and `read_file` to explore files relevant to the current state of the codebase, architecture, and plans"

**After** (proposed wording — final phrasing chosen during implementation):

> "3. Use `glob_files` and `read_file` to explore the project, with weighted focus on `specs/*.md` and `src/`. Read the design specs to understand stated intent; read source code to compare it against actual structure. Note where they agree, where they drift, and where complexity is accumulating without earning its keep."

#### Change C — Widen reflection brief (around `meditate.md:64`)

**Before**:

> "6. Reflect deeply on the intersection: what does the project need, and what do the lenses reveal about it?"

**After** (proposed wording — final phrasing chosen during implementation):

> "6. Reflect as both gap-spotter and architect. In addition to spotting concrete gaps, ask: where is the project headed; what would help it stay scalable; which abstractions earn their keep and which are bloat; where is feature creep accumulating; what could be simplified or collapsed. Mix tactical observations and strategic refactor suggestions — the goal is illuminations a maintainer would act on tomorrow *and* illuminations a CTO would act on next quarter."

The existing `### Things to keep in mind` block (`meditate.md:88-92`) already lists YAGNI / SOLID / DRY / KISS — it stays unchanged. Change C makes step 6 actually exercise those lenses instead of declaring them as decorative footer.

### Why this preserves SOLID

| Principle              | How the change honors it                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Single Responsibility  | Meditate now owns exactly one thing: observe + write_illumination. Lifecycle ownership is no longer co-located with reflection.    |
| Open / Closed          | Adding a janitor later does not modify meditate. Meditate stays closed for modification once this ships.                           |
| Interface Segregation  | Meditate's tool surface shrinks from 12 to 7 — it depends on no methods it does not use.                                           |

### Pipeline impact

None. `runMeditationSession` (`src/cli/commands/meditate.ts:64-109`) resolves the agent via `resolveAgent("meditate")` (`meditate.ts:69`) — the only reference. No pipeline graph (.dot) imports the meditate agent.

### Data flow (unchanged)

```
ralph meditate <project>
    ↓
meditateCommand (src/cli/commands/meditate.ts:113)
    ↓
runMeditationSession (meditate.ts:64)
    ↓
resolveAgent("meditate")  ──→ src/cli/agents/meditate.md  (the file edited here)
    ↓
Agent.run with 7 whitelisted tools (was 12)
    ↓
session writes 1 illumination via write_illumination
    ↓
exits (no closure side-effects, by design)
```

The data flow is the same as today; only the toolset and prompt content change.

## Components

### `src/cli/agents/meditate.md` (edited)

The single production file changed. Three localized edits per the *Before / After* above. No other section of the file moves.

### `src/cli/tests/meditate.test.ts` (extended)

Add prompt-contract assertions to the existing test file:

1. **Whitelist contains exactly the seven kept tools.** Parse the YAML frontmatter and assert the `tools:` list matches the seven-tool set, with the five lifecycle entries explicitly absent. This is a regression test against the SOLID violation re-emerging.
2. **Body does not reference removed tool names.** Assert the prompt body (after frontmatter) contains none of the five removed tool names — catches accidental re-introduction via prompt copy-paste.

No new test file is created.

### `src/cli/prompts/PROMPT_meditation.md` (open question — not edited in this spec)

See *Open Questions* below. This file diverges from `meditate.md` and carries the reactive `mark_implemented` step that the runtime never reaches. Its fate is deferred from this change.

## Error Handling

No new error paths. Removing tools is purely subtractive — sessions that today never call those tools are unaffected. Sessions that *did* call them (none observed in current logs) would now receive a tool-not-found denial under `permissionMode: dontAsk` (`meditate.md:5`); this is the desired failure mode (fail-closed against the SOLID-violating call).

## Testing

### Chunk 1 — Prompt-contract test (unit)

Extend `src/cli/tests/meditate.test.ts`:

- Assert frontmatter `tools:` is exactly the seven-element set listed above.
- Assert the body contains no occurrence of any of `mark_implemented`, `mark_dispatched`, `mark_archived`, `list_plans`, `mark_plan_implemented`.
- Assert the body still contains `write_illumination` and `list_illuminations` (sanity guard).

### Chunk 2 — Smoke run

Run `ralph meditate .` against ralph-cli itself. Expected outcomes:

- Session starts cleanly, no permission prompts.
- Resulting illumination references a spec under `docs/superpowers/specs/` or a source file under `src/` (validates Change B's weighting took effect).
- The body of the resulting illumination shows at least one architect-mode observation (refactor / scalability / abstraction) — validates Change C.

This is a manual qualitative check, not a CI test. Architect-mode tone is not deterministic enough to assert.

## Constraints

- The two `### Things to keep in mind` items already in `meditate.md:88-92` (YAGNI, SOLID, DRY, KISS, UI, UX, refactoring) stay verbatim — Change C only widens step 6, not the principles footer.
- `permissionMode: dontAsk` (`meditate.md:5`) stays — fail-closed is desirable here.
- The `mcp:` config block (`meditate.md:19-26`) and the `{{ILLUMINATION_SERVER_PATH}}` / `{{PROJECT_ROOT}}` / `{{META_MEDITATIONS_DIR}}` placeholders stay — `runMeditationSession` injects them at `src/cli/commands/meditate.ts:88-94`.

## Backwards Compatibility

Subtractive change. No external consumer depends on meditate calling lifecycle tools (it never has — the prompt has never referenced them). Open illuminations remain open until a janitor exists; the existing `mark_implemented` MCP tool (still registered server-side) is unchanged and remains callable from any agent that whitelists it.

## Open Questions (carried from refinements log)

### Q1. `src/cli/prompts/PROMPT_meditation.md` — delete, merge, or keep?

The file diverges from `meditate.md` (prompt step 7 about `mark_implemented` exists only there). Runtime status: `runMeditationSession` does not reference it (`src/cli/commands/meditate.ts:64-109`); the only `src/` consumer of `getMeditationPromptPath()` (`src/cli/lib/assets.ts:32-33`) is the path-existence test at `src/cli/tests/assets.test.ts:21-23`.

Initial read: dead code. Recommend deletion in a follow-up. Deferred from this spec because (a) the strip-and-widen edit is independent and ships first, (b) the user explicitly noted this resolution depends on confirming usage and asked for it to be carried as an open question.

### Q2. Recent commits added `list_plans` / `mark_plan_implemented` (b5e99d5, ac7dac5) — is stripping them correct?

Those commits intentionally widened meditate's whitelist for plan-lifecycle awareness. The SOLID split argues those tools are still lifecycle-tool territory and belong on the future janitor, not on meditate.

Recommendation: strip both. Janitor will own them when built. Flag for explicit user reconfirmation at the implementation-plan checkpoint, since the recency of those commits warrants conscious approval rather than silent reversal. (Refinements log, round 1.)

## Future Work — Janitor Agent (sketched, not built)

Documented here so the design idea is not re-discovered later. **Not part of this spec's implementation.**

Sketch:

- New file `src/cli/agents/janitor.md` (analogous structure to `meditate.md`).
- Tool whitelist: read tools (`list_illuminations`, `read_file`, `glob_files`, `project_tree`, `list_plans`) **plus** the five lifecycle write tools (`mark_implemented`, `mark_dispatched`, `mark_archived`, `mark_plan_implemented` — `write_illumination` excluded; janitor never authors).
- Standalone pipeline `janitor.dot` (single-node), runnable manually or on a schedule.
- Per-session loop: list open illuminations and plans → for each, verify against the codebase → call `mark_implemented` / `mark_archived` (with `duplicate-of <other-illumination>` reason where applicable) / `mark_plan_implemented`.
- Capped, oldest-first (e.g. process the 5 oldest open items per session) to bound cost.

Not in scope here. The relevant illumination would be authored separately when the user is ready to ship the janitor.

## Implementation Order

When the implementation plan is written, recommended chunking:

1. Chunk 1 — Edit `meditate.md` frontmatter (Change A: strip five tools).
2. Chunk 2 — Edit `meditate.md` body (Changes B + C: widen exploration + reflection).
3. Chunk 3 — Extend `meditate.test.ts` with the two prompt-contract assertions.
4. (Out of scope, follow-up issue) — Resolve Q1 (`PROMPT_meditation.md` fate).

Each chunk independently committable. No build-order dependencies between Chunks 1 and 2; tests in Chunk 3 cover both.
