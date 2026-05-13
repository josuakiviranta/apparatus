# ADR-0016: Run-scoped MCP config with heartbeat-driven GC

**Status:** Accepted
**Date:** 2026-05-13
**Supersedes:** —
**Extended by:** —
**Related:** ADR-0015 (asymmetric GC of pipeline tails)

## Context

`Agent.writeMcpConfig` writes `.mcp-<name>-<ts>.json` files to the project's cwd
so the `claude` CLI can find them via `--mcp-config`. The matching cleanup
(`Agent.cleanupMcpConfig`) runs from `Agent.run`'s `finally` block — happy
path only. SIGKILL, OOM, and parent-process aborts between `writeMcpConfig` and
the `finally` leave the file on disk. The `.gitignore` line `.mcp-*-*.json`
hides the files from `git status` but does not delete them. They accumulate.

Two repo-root orphans confirm the pattern: `.mcp-meditate-1777197355164.json`
(Apr 26) and `.mcp-verifier-1778665005965.json` (May 13 today). The same
pattern was flagged in a triage chat two months ago and has recurred.

Parallel pipelines (meditate + janitor overnight) are an explicit design goal,
so any GC mechanism must withstand concurrent sweepers from day one. A long
finally-only timeout is insufficient — it does not handle SIGKILL/OOM.

## Decision

All run-scoped scratch files live at `<project>/.apparat/runs/<runId>/`. MCP
configs are the first concrete case; future scratch types (transcripts,
partial outputs) inherit the location for free.

Liveness signal: a single `heartbeat` file at `runs/<runId>/heartbeat` touched
every 60 s by the pipeline runner (`src/cli/commands/pipeline/run.ts`). The
initial touch is synchronous, before any `await`, so a brand-new run cannot
race a sibling sweeper.

GC: a `gcStaleRuns(projectFolder)` helper sweeps stale run folders on every
`agent.run()` spawn — not just `meditate` startup. Three-state semantics:

| Heartbeat                     | Interpretation              | Action            |
|-------------------------------|-----------------------------|-------------------|
| mtime < 5 min                 | Pipeline alive              | Skip              |
| mtime ≥ 5 min                 | Pipeline crashed            | `rm -rf` the folder |
| absent (ENOENT)               | Completed (ADR-0015 tail GC) or pre-rule dir | Skip — preserve for debug |

The "absent → preserve" rule is what makes this design ADR-0015-symmetric.
Successful runs that ADR-0015's tail GC already swept have no heartbeat;
pre-rule run folders also have no heartbeat. Both populations are safe.

`RunOptions` gains an additive optional `runId?: string`. `writeMcpConfig`
roots its path at `runs/<runId>/` when supplied, at `cwd` otherwise (back-compat
for non-pipeline callers and the interactive harness).
`HandlerExecutionContext` gains a matching optional `runId?: string`; the
engine populates it from the in-scope `runId` at every handler invocation.

ENOENT during concurrent sweep is tolerated — the second sweeper finds nothing
and continues. Mirrors the existing `cleanupMcpConfig` pattern.

## Consequences

Positive:

- Any future scratch file type costs nothing new — drop it inside
  `runs/<runId>/` and it inherits the same heartbeat-driven GC.
- One liveness signal per run, not per scratch file. Deep-modules-hide-complexity
  payoff: a single seam (folder heartbeat) hides ownership of N scratch types.
- Parallel pipelines work from day one — each run is its own folder with its
  own heartbeat; neither sees the other as stale.
- ADR-0015's success-tail GC is unchanged. It still removes the entire
  `runs/<runId>/` on green, including the heartbeat file.

Negative / trade-offs:

- A pipeline that blocks the event loop for > 5 min without touching the
  heartbeat could be falsely swept. Mitigation: 60 s touch cadence vs 5 min
  threshold = 5-cycle margin, sufficient for observed async-heavy agent work.
  If false-stale sweeps ever bite in practice, the threshold is one constant
  edit.
- The runner now owns `mkdir(logsRoot)`; the engine's `mkdir` stays but is
  redundant for the runner path. Acceptable — `recursive: true` is idempotent.
- The interactive harness (`Agent.runInteractive`) does not yet receive
  `runId`. Its MCP configs continue to land at `cwd`. Tracked as open question
  §9.4 in the design doc — one-line edit when needed.

## Alternatives considered

- **Per-file `.mcp-*` mtime threshold.** Rejected: two seams (per-file +
  per-folder) instead of one. Any future scratch type would need its own
  per-file rule.
- **Long timeout for finally-only cleanup.** Rejected: does not handle SIGKILL
  or OOM. Round-2 directive to "solve concurrency properly now."
- **`~/.apparat/projects.json` registry** for preflight refusal. Rejected as
  the preflight mechanism in the companion design (this ADR records only the
  GC layer); the same per-project registry would be heavier than folder-shape
  signals.
- **Lock file** for concurrent sweep coordination. Rejected: adds a second
  seam (lock file + crash-recovery for the lock itself). ENOENT-tolerant
  `rmSync` is cheaper and identical correctness.
- **Heartbeat per file.** Rejected: one liveness signal per run is the simpler
  unit.

## References

- Design doc: `docs/superpowers/specs/2026-05-13-meditate-no-project-orientation-and-mcp-orphans-design.md`
- Originating illumination: `.apparat/meditations/illuminations/2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans.md`
- Long-term completed-run growth (out of scope for this ADR): sibling
  illumination `.apparat/meditations/illuminations/2026-05-13T0805-scratch-sediment-needs-an-apparat-sweep-command.md`
