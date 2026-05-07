---
date: 2026-05-07
run_id: ab71b561
plan: docs/superpowers/plans/2026-05-07-classify-line-block-shared-parser.md
design: docs/superpowers/specs/2026-05-07-classify-line-block-shared-parser-design.md
illumination: .apparat/meditations/illuminations/2026-05-06T2210-classify-line-block-shared-parser.md
test_result: pass
---

# classify-line-block-shared-parser

## What was implemented
Extracted Claude CLI stream-json decoding from `src/cli/lib/stream-formatter.ts` into a new `src/cli/lib/classify-stream.ts` module exposing two pure functions — `classifyLine(line)` returning a discriminated `system | assistant | user | result` event (or `null` on bad JSON) and `classifyBlock(block)` returning a typed `text | tool_use | tool_result` block. Both `processLine` (TUI formatter state machine) and `parseStreamJsonEvents` (raw NDJSON iterator) now consume the shared decoder; five duplicated per-block walks and two duplicated `JSON.parse` try/catch blocks collapse onto the single seam. Public exports keep their signatures — purely internal refactor.

## Key files
- A `src/cli/lib/classify-stream.ts`
- M `src/cli/lib/stream-formatter.ts`
- A `src/cli/tests/classify-line.test.ts`
- A `src/cli/tests/classify-block.test.ts`
- A `src/cli/tests/classify-stream-replay.test.ts`
- A `src/cli/tests/fixtures/classify-stream-replay.ndjson`
- A `src/cli/tests/fixtures/classify-stream-replay.expected.json`
- A `docs/superpowers/plans/2026-05-07-classify-line-block-shared-parser.md`
- A `docs/superpowers/specs/2026-05-07-classify-line-block-shared-parser-design.md`

## Decisions and patterns
- Two-commit split: `feat(cli/lib): add classifyLine + classifyBlock decoder module` (0644054) lands the new module + unit tests with **zero consumers wired**, then `refactor(cli/lib): rewire stream-formatter to use classify-stream` (6750c32) flips the call sites. Lets the decoder semantics be pinned independently of formatter-state-machine policy and keeps the rewire diff minimal.
- Behaviour pinned via a **byte-identical replay test** — a canned NDJSON corpus + expected JSON snapshot under `src/cli/tests/fixtures/classify-stream-replay.*` exercises both `streamEvents` and `parseStreamJsonEvents` end-to-end. Catches drift the per-classifier unit tests can't.
- `classifyLine` returns `null` on bad JSON (callers decide whether to swallow or yield `parse_error`) — matches the existing asymmetric behaviour of the two original branches without forcing them to converge on error policy.
- Production consumers (`src/cli/lib/agent.ts`, `src/cli/commands/pipeline/run.ts`) were untouched — confirms the additive-only contract held.

## Gotchas and constraints
- The two original parse sites had **different error policies**: `processLine` silently dropped bad JSON (returning empty events), `parseStreamJsonEvents` yielded a `parse_error` event. The `classifyLine` `null` return preserves both — do not "fix" this asymmetry without re-checking both call sites.
- ADR-0006 (event-based stream-formatter; consumers own formatting) still governs: the new classifiers must stay pure decoders, never format.
- Five existing test files (`stream-formatter`, `stream-json-events`, `stream-json-input`, `parseClaudeEvent`, pipeline mocks) continue to validate the public surface unchanged — if any of them needs editing in a future change, the public contract has shifted.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, 1328/1328 tests pass across 149 files; 4 non-agent scenarios (tool, tool-runtime-vars, store, missing-caller-var) ran live in tmux and reached exit 0; 10 agent/interactive scenarios skipped per hard rule (open Claude sessions). No fixes needed — diff was lib-internal (classify-stream extraction) and fully covered by classify-line/classify-block/classify-stream-replay test files which all passed.
