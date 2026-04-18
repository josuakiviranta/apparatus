# Surface `failureReason` in Pipeline Traces + CLI Exit — Design

**Date:** 2026-04-18
**Status:** Approved, ready for implementation plan
**Related incident:** Run `05e023ec` — `mark_dispatched` node failed with `success:false, tool.output:""`. Diagnosis required reading script source to infer what stderr said, because the jsonl trace discarded the error message entirely.

## Problem

`Outcome.failureReason` is populated by handlers (e.g. `src/attractor/handlers/tool.ts:115` embeds full stderr into the string) but the jsonl tracer at `src/attractor/tracer/jsonl-pipeline-tracer.ts:37-45` drops it when writing the `node-end` event. The CLI exit path also prints nothing actionable to stderr on failure — the user has to open `pipeline.jsonl` by hand, and even then the field is missing.

This is an observability gap that affects every handler type (tool, agent, store, ralph-*), not just tool nodes. The handlers have the data; nothing surfaces it.

## Scope

Two changes, both in the observability path. Handlers are untouched.

1. **Tracer forwards `failureReason` on every `node-end` event** when defined.
2. **CLI `pipeline run` prints a one-line failure summary to stderr** on pipeline failure, plus a pointer to the trace file.

All node types benefit (the handlers already populate the field — this is just plumbing).

## Design

### 1. Trace schema change (additive)

**File:** `src/attractor/tracer/jsonl-pipeline-tracer.ts`

Current `node-end` event:

```json
{"kind":"node-end","nodeReceiveId":"...","nodeId":"mark_dispatched","success":false,"contextUpdates":{"tool.output":""}}
```

New:

```json
{"kind":"node-end","nodeReceiveId":"...","nodeId":"mark_dispatched","success":false,"failureReason":"Script exited with code 1: status not open: dispatched\n","contextUpdates":{"tool.output":""}}
```

- Field written **only when** `outcome.failureReason` is defined (typically only on failure).
- **No truncation.** Faithful to whatever the handler produced. Worst-case large stderr is the cost of a loud error.
- **No schema version bump.** Additive, ignored by existing readers.

### 2. CLI stderr on pipeline failure

**File:** `src/cli/commands/pipeline.ts` (pipeline-run path around line 393).

On pipeline failure, before `process.exit(1)`, print to `process.stderr`:

```
✗ pipeline failed at node <lastFailedNodeId>: <failureReason first line, cap 500 chars>
  trace: <tracePath>
```

- `lastFailedNodeId` is captured by a small accumulator in the existing `onNodeEnd` callback (line 334) — remember the last node whose `outcome.status !== "success"`.
- `failureReason first line` = `failureReason.split("\n")[0].slice(0, 500)`. Full text stays in the trace.
- Printed verbatim via `process.stderr.write` — no Ink, no color codes (keeps it greppable in CI logs).

### 3. What is intentionally **not** changed

- **Handlers.** They already set `failureReason` correctly. No edits.
- **TUI.** Failure status is already visible in the live display; adding stderr inline risks layout issues. Deferred.
- **No `failure_truncated` flag** — user chose faithful/no-cap.
- **Retroactive fix of old traces.** Not worth it; the bug only matters going forward.
- **stderr/stdout separation in context updates.** `tool.output` still captures stdout only, per existing contract. Stderr lives in `failureReason`.

## Testing

TDD order — red tests first, then the one-line fixes.

1. **Tracer unit tests** (`src/attractor/tracer/jsonl-pipeline-tracer.test.ts`)
   - `onNodeEnd` with `outcome.failureReason="boom"` → persisted line parses to JSON whose `failureReason === "boom"`.
   - `onNodeEnd` on a success outcome → persisted line has **no** `failureReason` key.
2. **Integration test** (new, alongside `src/cli/tests/pipeline-headless.test.ts` or sibling)
   - Pipeline with a `type="tool"` node whose `tool_command` is `sh -c 'echo err 1>&2; exit 1'`.
   - Run → assert the failing `node-end` line in the generated jsonl contains `"failureReason"` and that value contains `"err"`.
3. **CLI stderr test** (`src/cli/tests/pipeline-headless.test.ts` or new file)
   - Spawn `ralph pipeline run` against the same fail-on-purpose fixture.
   - Assert process stderr matches `/^✗ pipeline failed at node \S+:/m` and contains `trace:` pointer.

All tests should be fast (no agent calls, no tmux). Use a tiny pipeline fixture.

## Backward compatibility

- jsonl readers that ignore unknown fields: unaffected.
- `ralph pipeline trace` command: already treats events as opaque JSON — no change needed.
- Resume (`--resume`): unaffected; checkpoint file unchanged.

## Out-of-scope follow-ups

If this surfaces more hidden failure modes, candidates for follow-up illuminations:

- Separate `stderr` field on `node-end` (distinct from `failureReason`) — only useful if handlers stop embedding stderr into the reason string.
- `failure_truncated: true` flag if real-world traces show pathological sizes.
- TUI: render failure reason inline on node-failed row.
