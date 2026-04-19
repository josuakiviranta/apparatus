# Implementation Plan

> **For agentic workers:** pick the most important unchecked item, brainstorm a concrete plan from the linked design spec, then execute with superpowers:subagent-driven-development (red/green TDD). Close each item by removing it from this file when shipped.

---

## Status (2026-04-19)

- **v0.1.23 shipped** — Pipeline Validator Trust Upgrade (zod schemas per node kind, `$project` preflight, required `cwd=` on tool nodes, `cd $project &&` prefix removed, docs + authoring prompt updated).
- Build green, 917/917 tests passing, `tsc --noEmit` clean.
- Seed material for the next three workstreams is already committed (tmux-tester agent, `issues_found` schema field, wait-human `default_*` fallback). The remaining work for each workstream is summarised below and tracked against the corresponding design spec.

---

## Active Backlog

### 1. Implement-retry tmux context — spec: `specs/2026-04-18-implement-retry-tmux-context-design.md`

**Why:** After `tmux_tester` produces `test_result` + `test_summary` + `issues_found`, the post-tmux Retry edge re-enters `implement` with only `$plan_path`. The agent rediscovers failures from scratch — wastes tokens and often repeats the same mistakes. Need a dedicated `implement_retry` node whose prompt injects the structured test output so retries *start from the diagnosis*.

- [ ] Add `implement_retry` node to `pipelines/illumination-to-implementation.dot` with a prompt that references `$test_result`, `$test_summary`, `$issues_found`, and declares `default_*` fallbacks so first-pass runs don't trip the zod-required-attr check.
- [ ] Rewire `tmux_confirm_gate -> implement_retry` (Retry edge) while keeping the pre-tmux `review_gate -> implement` Retry path untouched.
- [ ] Integration test: pipeline where `tmux_tester` emits `test_result=fail`, flow routes to `implement_retry`, observed agent prompt contains the test output verbatim.
- [ ] Validate end-to-end via smoke run on a pipeline that exercises the loop.

### 2. Pipeline commands spec backfill — spec: `specs/2026-04-18-pipeline-commands-spec-backfill-design.md`

**Why:** `specs/commands.md` covers 3 of 6 implemented `ralph pipeline` subcommands. `validate`, `refine`, `trace` are absent — the illumination verifier has no spec ground truth for any claim about those commands. Pure documentation; no code changes.

- [ ] Add `### ralph pipeline validate`, `### ralph pipeline refine`, `### ralph pipeline trace` sections to `specs/commands.md`.
- [ ] Add `run` exit-code note (exit 1 on `project_binding_missing`, `schema_error`, etc.).
- [ ] Cross-check the new sections against the actual CLI help output so spec and help don't drift.

### 3. Refine run history + failure tip — spec: `specs/2026-04-17-refine-run-history-and-failure-tip-design.md`

**Why:** Shipped behaviourally; spec is the belated write-up. Confirm spec matches code, then close.

- [ ] Read `src/cli/commands/pipeline.ts refineCommand` and cross-check the spec against actual behaviour — record any drift as a follow-up illumination, then mark the spec as shipped.

---

## Notes for the next loop

- Each workstream has its own design spec. Don't expand this file into a multi-task plan — author a short plan in `docs/superpowers/plans/` when you start one.
- Schema enforcement is strict. Any new `type="tool"` node must declare `cwd=`; zod rejects unknown attributes. Run `npm run build && npx vitest run` before committing.
- Add ignored temp-dir prefixes to `.gitignore` if a new test introduces one (vitest `mkdtempSync` seeds in cwd).
