---
date: 2026-04-13
status: open
description: The backpressure guard spec proposes counting all .md files in the illuminations directory, but the threshold semantics are "unprocessed" — dispatched illuminations remain on disk and will trigger false positives once the illumination-to-plan pipeline runs successfully.
---

## Core Idea

The backpressure guard spec (`docs/superpowers/specs/2026-04-12-meditate-backpressure-guard-design.md`) specifies `countIlluminations()` as `readdirSync + filter *.md` — a raw file count. The threshold message says "6 illuminations are **waiting to be processed**," but dispatched illuminations are not waiting to be processed. They have a plan. They remain in `meditations/illuminations/` forever (they only leave when `mark_archived` moves them to `archive/`). Once the illumination-to-plan pipeline runs, the file count (guard input) will permanently exceed the open count (guard intent). A corpus with 3 open + 7 dispatched fires the guard at a threshold of 5 even though only 3 illuminations are unprocessed.

The spec anticipates this: "If status-aware counting is needed later, it can be added without changing the guard's interface." That's true — but "later" arrives the first time the pipeline runs end-to-end and marks any file dispatched. Right now all 10 illuminations are open, so file count equals open count and the flaw is invisible. Implement the guard as written and it will work correctly for this session. Run the illumination-to-plan pipeline once and the guard becomes unreliable for every session after.

## Why It Matters

The guard is designed to throttle `ralph meditate` when backlog exceeds a threshold. That use case requires measuring actual backlog — files with `status: open` that have not yet been triaged. File count conflates triage status. A developer who has done good hygiene (run the pipeline, dispatched 7 illuminations, 3 open) gets blocked by the guard. A developer who has done zero hygiene (10 open, 0 dispatched) does not. The guard inverts its own signal.

The fix is one import and one changed line. `listIlluminations(projectRoot, "open")` already exists in `src/cli/mcp/illumination-server.ts` (line ~265), is already unit-tested, and already does exactly what the guard needs: count illuminations with `status: open` or no status field. The spec author's concern about coupling is academic — `illumination-server.ts` is already a dependency of the meditate subsystem (it is the MCP server every meditate session uses). Importing its pure helper functions into `meditate.ts` adds no new coupling that doesn't already exist conceptually.

The spec's coupling argument also misidentifies the failure mode. The claim is: "if the state machine breaks, the guard should still work." But if `listIlluminations` throws (e.g., directory missing), the correct behavior is to proceed, not to fire the guard — the same fallback a raw `readdirSync` would need. The robustness argument is a wash; the correctness argument clearly favors status-aware counting.

## Revised Implementation Steps

1. **Implement `countOpenIlluminations(projectPath: string): number` in `src/cli/commands/meditate.ts`.** Import `listIlluminations` from `../mcp/illumination-server.js`. The function body: call `listIlluminations(projectPath, "open")`, check if the result equals the "No illuminations found" sentinel, otherwise split on `\n` and return the count. Wrap in try/catch and return 0 on error (safe default — guard does not block when count is unknown). This replaces the spec's `readdirSync` approach.

2. **Write the three unit tests before implementing the guard logic.** Fixture: a temp directory with N `.md` files, some with `status: dispatched` frontmatter. Assert: (a) only open files are counted, (b) dispatched files do not contribute to the count, (c) files with no frontmatter are treated as open. These tests will fail. Then implement.

3. **Add the guard to `meditateCommand()` using `countOpenIlluminations`.** Placement: after `ensureMeditationDirs()` and the PID lock check, before `runMeditationSession()`. Threshold from `RALPH_MEDITATE_MAX_OPEN` env var, default 5. Message: `${count} open illuminations are waiting to be processed (threshold: ${threshold}).\nRun the illumination pipeline first, or archive resolved files.\nUse --force to bypass this check.` Exit code 0.

4. **Add `--force` option to the `meditate` Commander registration in `src/cli/program.ts`.** The heartbeat `meditate` subcommand in `src/cli/commands/heartbeat.ts` does not pass `--force` to the spawned command — it passes only `[absPath]` or `[absPath, "--steer", opts.steer]`. This is correct: daemon-scheduled sessions should respect the guard.

5. **Verify against the real corpus.** After implementing, call `countOpenIlluminations` against the current project folder. Expected: 11 (10 existing illuminations + this one, all `status: open`). The guard will fire immediately at threshold 5, confirming the implementation works and the count is correct before any dispatched files exist to expose the flaw.
