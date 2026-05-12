# Asymmetric success/failure GC of run-scoped scratch paths

**Status:** accepted (2026-05-12)

## Context

Two pipeline-internal scratch paths grow forever today and nothing reads
them after the run that wrote them, but nothing deletes them either:

- `.apparat/runs/<run_id>/` — per-run `checkpoint.json`, per-node `prompt.md`
  / `raw-attempt-N.txt` / `status.json`, and `pipeline.jsonl`. Written by
  the pipeline runner and the engine's JSONL tracer.
- `.apparat/meditations/illuminations/.triage/<run_id>/chat-notes.md` — a
  same-run handoff between the `chat_session` / `chat_summarizer` agents
  and the next-node `verifier` / `explainer`. The write path is hardcoded
  at `.apparat/pipelines/illumination-to-implementation/chat-summarizer.md`
  (the agent writes via `Bash`); no `src/` code touches it.

Existing retention is **quantity-based at pipeline start**, not outcome-
aware: `gcOldRunsPerPipeline` (`src/cli/commands/pipeline/runs-gc.ts`)
runs from the `onPipelineStart` tracer hook and caps the per-pipeline
bucket via `APPARAT_RUNS_KEEP` (default 10). A green run can be evicted
while a red run survives; that is the inverse of the debugging contract.

The janitor pipeline is read-only by design — `src/cli/pipelines/janitor/janitor.md`
declares only `Grep` + `mcp__illumination__*` in its `tools:` block (no
`Edit`, no `Write`, no shell `rm`), so accumulation is unbounded at the
agent layer.

The precedent for outcome-gated cleanup already lives in the
illumination-to-implementation pipeline at
`.apparat/pipelines/illumination-to-implementation/memory-writer.md`:

> Pre-check. If `$tmux_tester_test_result` equals the literal string
> `"fail"`, skip both 7a and 7b entirely.

That gate protects the per-illumination plan + illumination on red. This
ADR extends the **same** asymmetric shape to two more run-scoped paths
at the **pipeline tail**.

## Decision

On `result.status === "success"` in the pipeline runner's `finally` block
(`src/cli/commands/pipeline/run.ts`), `gcRunScopedArtefactsOnSuccess(project, runId)`
removes both run-scoped paths keyed by `<run_id>`:

- `<project>/.apparat/runs/<run_id>/`
- `<project>/.apparat/meditations/illuminations/.triage/<run_id>/`

On any non-success outcome (engine failure, SIGINT, hard crash), both
paths are preserved untouched. The asymmetric guard is one variable
(`pipelineFailed`) already in scope; the helper is one ~10-LOC export
from `src/cli/commands/pipeline/runs-gc.ts`; the rmSync uses `force: true`
so missing paths are silent no-ops (pipelines that never invoke
`chat-summarizer` have no `.triage/<run_id>/` to delete).

No new declarative system, no validator rule, no MCP tool, no
`lifecycle:` frontmatter across agents.

## Precedent cited

- ADR-0002 — `consume(filename, reason: "implemented" | "declined")`
  establishes outcome-gated cleanup for illuminations and plans.
- `.apparat/pipelines/illumination-to-implementation/memory-writer.md`
  — the success-gated `consume` calls inside the existing pipeline.

## Considered alternatives

- **Universal `lifecycle:` frontmatter system across all agents +
  validator artefact-flow rule + `consume_design` MCP tool.** Rejected:
  only `runs/` and `.triage/` are unambiguously trash; specs, sessions,
  illuminations, and stimuli function as institutional memory that
  survives context resets.
- **Quantity-based tail GC (keep-newest-N regardless of outcome).**
  Rejected: the operator wants red runs preserved for debugging, green
  runs disposable. Symmetry destroys the contract.
- **Move chat-notes under `.apparat/runs/<run_id>/` so one GC handles
  both paths.** Rejected: requires atomic update of the
  `chat-summarizer.md` hardcoded write path and any node reading from
  `.triage/`. The current-path GC is mechanically identical (same key,
  same `rmSync`); the repath is a folder-layout question, not a GC
  correctness question, and may happen later if `.triage/` is dropped
  as a directory entirely.
- **Retroactive cleanup of the ~110 pre-rule run dirs + triage dirs.**
  Rejected: out of scope per the originating refinement bullet
  ("forward-looking only"). A sibling `chore` commit may follow at the
  operator's discretion.

## Consequences

- `apparat pipeline trace <runId>` on a green run exits 1 with the
  standard `No trace found` message. `src/cli/commands/pipeline/trace.ts`
  adds one stderr hint line pointing at this ADR. External callers that
  depended on green-run trace persistence must read the ADR.
- `APPARAT_RUNS_KEEP=N` semantics shift from "the newest N runs survive
  per pipeline" to "the newest N **failed** runs survive per pipeline"
  (greens self-evict at tail). The bucket cap still bounds disk; the
  practical contract is now "K failed-run survivors per pipeline."
  Documented in `README.md`.
- The parallel-illumination-to-implementation pipeline inherits this
  rule automatically because the GC lives at the runner level
  (`run.ts`), not in any agent file. No second-pipeline re-validation.
- Pre-rule accumulation (~93 `runs/` dirs + ~18 `.triage/` dirs already
  on disk) remains until the operator runs a one-shot `chore` cleanup.
  Not part of this ADR.
- No new env var, no new CLI flag, no new MCP tool. No new tracer
  field; `pipeline-start` / `pipeline-end` JSONL events are byte-
  identical.
