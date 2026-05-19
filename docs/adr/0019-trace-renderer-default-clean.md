# 0019. Trace renderer strips hook ceremony by default

Date: 2026-05-18

## Status

Accepted.

## Context

`apparat pipeline trace <runId>` and `apparat status … <runId>` are the project's
two windows into a finished or live pipeline run. Their **primary consumer is
Claude in agent context**, not humans:

- `memory_writer` reads its own session output when composing the session file.
- The planned `meditate` analyst (see illumination
  `2026-05-18T1559-run-corpus-is-write-only-missing-feedback-edge.md`) will start
  reading run corpora as signal.
- Interactive sessions where the operator says "dig into run X" pay the token
  cost line-by-line.

The Claude Code subprocess emits a thick layer of `SessionStart:startup` hook
envelopes, repeated `additional_context` skill-prelude bodies, `rate_limit_event`
frames, and assistant-side `tool_result` echoes — pure subprocess-boot ceremony
with zero diagnostic value. A real `implement` node's `raw-attempt-1.txt`
(176 KB) spends 20% of its bytes on hooks alone. An agent forensically scanning
five trace files pays the 20% tax five times.

## Decision

The default trace render strips ceremony. `--full` becomes the raw escape hatch
— same mental model as `git log` vs `git log --pretty=raw`.

Implementation seam: one pure module `src/cli/lib/trace-cleaner.ts` exports
`cleanJsonlEvents(lines)`, a deny-list filter over parsed JSONL frames. Every
trace renderer surface routes its line array through this single function when
`opts.full !== true`.

Filter rules:

1. `{type:"system", subtype:"hook_started"|"hook_response"}` — drop frame.
2. `{type:"rate_limit_event"}` — drop frame.
3. `{type:"system", subtype:<anything else>}` — keep frame; strip
   `additional_context` field (defence in depth against the skill-prelude blob
   leaking back in on future system frame variants).
4. `{type:"assistant", message.content[*].type:"tool_result"}` — drop frame
   (user-side copy retained; it carries the result body).

## Consequences

- **Token budget is the design lever, not human ergonomics.** Default optimises
  for Claude reading traces; humans rarely read them directly.
- **On-disk format is untouched.** `raw-attempt-N.txt` and `pipeline.jsonl` keep
  receiving the verbatim transcript. The filter is read-time only. Hook payloads
  remain forensically available when SessionStart itself misfires — preserved
  by ADR-0015 (asymmetric GC keeps failure traces for forensics).
- **`--full` semantics flip contractually** but break nothing in practice. No
  external scripts/skills/agents parse trace output today. Internal call sites
  (the failure-handoff `inspect:` recipe in
  `src/cli/lib/node-receive-inspector.ts:78-85`) continue to emit `--full` for
  raw triage and continue to behave as today.
- **Future renderer surfaces share one seam.** Any new view that renders
  raw-attempt JSONL routes through `cleanJsonlEvents`. No drift between CLI and
  TUI; no per-call deny-list customisation.
- 2026-05-19: The cross-node trace timeline view (`apparat pipeline trace <runId> --timeline`) is the first downstream beneficiary of `cleanJsonlEvents` — it routes every per-node `raw-attempt-N.txt` through the same filter, so hook frames and assistant-side `tool_result` echoes never reach the timeline. Validates the seam.

## Out of scope

- `thinking` block filtering (9% bytes on the real sample). `thinking` carries
  reasoning useful to cross-run meditation. Surface as a separate illumination
  if token pressure persists.
- Disk-format rewrites. The forensic record stays whole.
- The pipeline.jsonl tracer (`src/attractor/tracer/jsonl-pipeline-tracer.ts`).
  Apparat's own frames are never ceremony; nothing to filter on that surface.

## Update 2026-05-18 — delta default for the roster row

Same primary-consumer rationale as the original decision (Claude in agent
context: `memory_writer`, the planned `meditate` analyst, "dig into run X"
operators), same token-budget lever. The default render now goes one step
further: instead of printing the first three keys of each node's cumulative
`contextSnapshot` (which is monotonically-growing and renders every row
identically), the roster prints each node's **`contextUpdates`** as
`+`/`~`/`-` delta markers via the new pure helper
`src/cli/lib/trace-delta.ts:renderContextDelta`. The Ink mission-control
trace view gains the same line under each closed block via
`src/cli/lib/replayTraceIntoApp.ts:mapTraceLineToEvent` →
`PipelineTraceView`.

Same disk-format invariant: `pipeline.jsonl` continues to receive both
`contextSnapshot` on `node-start` and `contextUpdates` on `node-end`. The
delta is a read-time view only. `--full` continues to mean "no cleaner,
no delta synthesis, raw stream" — verbatim continuation of the contract
set above.

See: `docs/superpowers/specs/2026-05-18-trace-emits-context-deltas-not-snapshots-design.md`.
