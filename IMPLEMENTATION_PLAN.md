# Implementation Plan

The rubric-prepend plan shipped on 2026-04-22 as **v0.1.32** (tag `0.1.32`, commit `929c4e0`).

**Shipped:**
- Engine layers agent rubric + node task (`rubric\n\n---\n\ntask`) with empty-rubric short-circuit. See `src/attractor/handlers/agent-handler.ts:62-72` and 4 new tests in `src/attractor/tests/agent-handler.test.ts`.
- `src/cli/agents/task.md` — procedure-less one-shot agent.
- `validateAgentConfig` accepts empty prompt (required for procedure-less agents).
- 28 pipeline nodes migrated off `agent="implement"` onto `task` or specialist agents across 11 pipeline files. Real spider uses preserved at `pipelines/illumination-to-implementation.dot:38` and `pipelines/poc-implement.dot:10`.

**Verification:**
- `npm test` → 1062/1062 green.
- All non-tmux smokes green after `agent-json-vars` schema fix (2026-04-22): `agent-implement`, `agent-json-vars`, `conditional`, `json-schema-stream`, `static-multi-node`.
- Composition spot-checks for `tmux-tester` (non-empty rubric, correct ordering) and `mark_archived` (task agent, no stray separator).

See memory entry `memory/2026-04-22-rubric-prepend-shipped.md` for detailed run notes.

---

## Open follow-ups

- **Verification-matrix block in plans** (from `meditations/illuminations/2026-04-20T2900-verification-matrix-in-plan.md`). The rubric-prepend plan informally included verification targets in Chunk 4; formalising a `## Verification targets` sub-block per chunk in `plan-writer.md` is a separate future change.

## Recently shipped

- **Plan reviewer reference disambiguated (2026-04-22).** `plan-writer.md` and `pipelines/illumination-to-implementation.dot` no longer refer to a non-existent `plan-document-reviewer` subagent; both now explicitly dispatch the Task tool with `subagent_type: "general-purpose"` using the `plan-document-reviewer-prompt.md` template from the `superpowers:writing-plans` skill. Matches the skill's own guidance.
