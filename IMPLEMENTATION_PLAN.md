# Implementation Plan

> Plans completed since the last reset are recorded in memory under
> `~/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/`.
> Active backlog lives below; everything else is historical.

---

## Recently shipped

### Fenced Code-Block Variable-Skip (2026-04-19) — DONE

All four chunks landed; commit history `1f2b0df…f94d708`. Memory: `2026-04-19-fenced-var-skip-shipped.md`.

Lessons captured during execution:

- **Plan glossed wiring of `unresolved_var_in_agent_prompt` into `pipelineValidateCommand`.** The plan said "wire diagnostic in pipeline.ts around line 157" — that's the run flow. Chunk 4's demo expects validate to fail, so the diagnostic had to be wired into BOTH `pipelineValidateCommand` and `pipelineRunCommand`. Fixed mid-execution; future plans that reuse this layer should be explicit about both entry points.
- **Inline-backtick `$VAR` in agent prompts is a true positive.** Per spec, only triple-backtick fences are skipped. Inline single-backtick spans still expand — the new validator caught a pre-existing inline `$SESSION:$WIN` example in `tmux-tester.md:141`. Replaced with `<session>:<window>` placeholder. Rule of thumb: shell-syntax examples in agent docs must use placeholders (or live inside a triple-backtick fence) — never inline backticks.
- **Stale LSP diagnostics misled briefly.** After Task 3.1 the LSP reported 10 errors that `npx tsc --noEmit` did not see. When LSP and tsc disagree, tsc wins.

---

## Active backlog

### Pre-existing TS error (unrelated, low priority)

- `src/attractor/handlers/agent-handler.ts:36:40` — "Expected 1 arguments, but got 2" (pre-existing on prior commit, vitest passes regardless). Out of scope for fenced-var-skip; pick up next time the agent handler is touched.

### Pre-existing dead code in pipeline.ts (low priority)

After Task 3.2's render hunk shifted line numbers, two pre-existing unreachable-code warnings remain (lines around 599, 611). Pure dead code — remove next time we touch nearby logic. Out of scope for the fence-skip work.

### Specs queued for design review

- `specs/2026-04-19-mark-archived-reason-split-design.md`
- `specs/2026-04-19-gate-choice-namespacing-design.md`

Decide which to scaffold into a plan next.
