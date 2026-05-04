# Triage Chat Notes

## Illumination
`meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md`

Core thesis: `ralph pipeline refine` shifts pipeline authoring from one-shot creation into a repeatable, agent-assisted iteration loop via exemplar injection of the current `.dot` plus a "preserve node IDs and edge labels" constraint.

## Scope Decision

Four follow-ups proposed in illumination. Verifier found two already implemented against current code:

- **Step 1 — extract `runTwoPhaseClaudeSession()`**: already lives at `src/cli/lib/session.ts:114`. Both `pipelineCreateCommand` and `pipelineRefineCommand` already call it. DROP.
- **Step 3 — edge-label diff after refine**: already implemented. `pipelineValidateCommand` calls `diffEdgeLabels()` (`pipeline.ts:99-104`) when `previousGraph` is supplied; `pipelineRefineCommand` supplies it at `pipeline.ts:720`. DROP.

Plan scopes to remaining two actionable items:

- **Step 2 — Inject recent run traces into the `refine` trigger.** Add `buildRunHistorySection(slug, n)` parallel to `buildAgentSection`. Read last N summaries from `~/.ralph/runs/<slug>/pipeline.jsonl`. Append to refine trigger as `## Recent run outcomes` so the agent sees *why* current edges exist.
- **Step 4 — Post-failure refine tip in `pipelineRunCommand`.** After failure outcome prints, append one line: `Tip: ralph pipeline refine <name> to improve this pipeline with agent assistance.` No flag, no config.

## Testing Strategy (agreed)

**No scenario tests.** End-to-end coverage via tmux tester at end of implementation pipeline.

### Step 2 — run history injection
Unit:
- `buildRunHistorySection(slug, n)` — fixture JSONL → markdown `## Recent run outcomes` block, newest-first.
- Missing/empty JSONL → empty string (no header).
- Malformed lines skipped, no throw.
- Byte-budget cap on long traces so trigger doesn't blow context window.

Integration:
- `composeRefinePrompt()` snapshot with seeded JSONL. Assert section placement (after graph block, before closing constraint).

### Step 4 — post-failure tip
Unit:
- `pipelineRunCommand` final-print path. Failure outcome → stdout contains exact tip string.
- Success outcome → tip absent.
- Non-TTY / scripted mode → still prints (plain text, no TUI flicker risk).

### End-to-end — tmux harness at pipeline tail
Per `docs/harness/tmux-drive.md`:
- `start_run` → seed fake `~/.ralph/runs/<slug>/pipeline.jsonl` → `ralph pipeline refine <name>` → `capture` Phase-1 stdout → grep run-summary text.
- `start_run` → `ralph pipeline run <failing-pipeline>` → `capture` → assert `Tip: ralph pipeline refine` line present.
- `cleanup_run`.

### Gate
- `npm run build && npm test` green before handoff.

## Constraints for Plan Author
- Reuse `buildAgentSection` shape for `buildRunHistorySection` (parallel, same file ideally).
- Tip string is a single line, no opt-in flag, printed only on failure.
- Do not re-extract session helper (already done).
- Do not add edge-label diff (already done).
- Follow CLAUDE.md principles: YAGNI, SOLID, DRY, KISS.
