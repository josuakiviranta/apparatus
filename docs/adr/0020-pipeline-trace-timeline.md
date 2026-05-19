# 0020. Pipeline trace timeline

- Status: Accepted
- Date: 2026-05-19

## Context

`apparat pipeline trace <runId>` had two depth flags: `--node-receive <X>` for
per-node detail and `--full` for the raw JSONL escape hatch. Both zoom into
one node or list nodes statically. No mode joined events across nodes. Three
forensic jobs failed because of that gap: deep-loop waste audits ("did
iterations 2-4 re-read files iteration 1 already had?"), "where did wallclock
go" forensics across long runs, and drafting new agent rubrics from observed
tool-use cadence.

## Decision

Add `--timeline` — a third, mutually-exclusive mode that renders one row per
`tool_use` event across every node, sorted by timestamp. Annotate duplicate
`(toolName, normalized-input)` pairs with `← re-read`. Build on top of the
existing `cleanJsonlEvents` filter (ADR-0019) so hook ceremony never reaches
the timeline.

Mutual exclusion is enforced handler-side (Commander `.conflicts()` is absent
from this repo's `.option(...)` registrations). The on-disk format
(`pipeline.jsonl` + `raw-attempt-N.txt`) is unchanged — timeline is a
read-time projection. The live-tail Ink view (`PipelineTraceView`) is
intentionally untouched.

## Consequences

- Cross-node forensics no longer require manual `cat … | jq` across multiple
  `raw-attempt-*.txt` files.
- The downstream mining illumination
  (`2026-05-18T1830-mine-harness-pattern-mining-from-traces.md`) depends on
  the `buildTimeline` helper this ADR introduces, giving it concrete
  downstream pull beyond ad-hoc inspection.
- Niche framing carries through: timeline is irreplaceable for cross-node
  questions, but probably used 5–10× less often than `--node-receive`. Do not
  promote it as a daily driver in docs.
- Future enhancements (live-tail timeline, `--from`/`--to` window, cross-run
  joins) are deferred — revisit if mining usage drives demand.
