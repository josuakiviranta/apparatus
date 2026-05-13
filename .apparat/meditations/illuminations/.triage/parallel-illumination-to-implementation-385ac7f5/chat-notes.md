# Chat round notes — 2026-05-13T09:00Z

## What the user raised
- Wanted source-verified, plain-language walkthrough of the illumination's candidates with simple visual before/after examples.
- Asked for simpler re-explanation: "I'm dumb and I don't understand. Explain simply with simple examples. What are the winnings? And how system would change in user's perspective?"
- Accepted the simplified framing: "Alright sounds good wins."

## Conclusions reached

- All three candidates in the illumination hold against current source — proceed with the scope the verifier captured.
  - Came from: user asked to verify candidates against source before explaining.
  - Rationale: confirmed `meditate.ts:21-24` has only `existsSync` guard, `pipeline-bootstrap.ts` has no `gcStaleMcpConfigs`, `.apparat/.apparat/` ghost still exists, one orphan MCP config (`.mcp-meditate-1777197355164.json`) still at repo root, `agent.ts:118` defines `MCP_CONFIG_GLOB = ".mcp-*-*.json"` and cleanup runs only in `run()` finally (lines 350, 413).

- User-facing framing of the change is two wins:
  1. Tool refuses when pointed at a non-project folder (no more silent ghost notes from typos).
  2. Tool sweeps stale MCP debris on startup (project folder stays self-cleaning even after crashes).
  - Came from: user explicitly asked "what are the winnings? how does system change in user's perspective?"
  - Rationale: user wanted plain-language framing, not implementation detail. They confirmed the framing with "sounds good wins."

- Happy path stays unchanged — only typo / wrong-folder / post-crash cases behave differently.
  - Came from: user's "user perspective" question.
  - Rationale: user accepted the framing that normal runs see no difference, which means scope is bounded to error-path UX + janitorial sweep. No reframing of the meditate command's main flow.

## Open questions

- Concurrency-safety of blanket MCP GC: raised in chat as a real risk (future parallel pipelines could have an in-flight sibling `.mcp-*-*.json` younger than the GC threshold). Two options floated — (a) threshold ≥ max-agent-lifetime, (b) per-run allowlist. User did not pick. Deferred — designer should choose during plan, with default leaning toward conservative threshold since solo-dev single-meditate is the current real workload.

# Chat round notes — 2026-05-13T09:30Z

## What the user raised
- "Explain more deeply the option B. The goal is definitely able to run multiple pipelines parallel and with heartbeat command that is already happening if I for example run meditate and janitor over night." Linked stimulus `.apparat/meditations/stimuli/deep-modules-hide-complexity.md`.
- "And risk of bloat and dead files if these json files are used? How those get cleaned or should those even get cleaned?"
- "And any ideas how to tackle the risk of dead files piling up?"
- "Now verify from source code that this recommendation is possible and works. Thought experiment to run each step."

## Conclusions reached

- Parallel pipelines (meditate + janitor overnight) are an explicit design goal, not hypothetical.
  - Came from: user said "The goal is definitely able to run multiple pipelines parallel and with heartbeat command that is already happening if I for example run meditate and janitor over night."
  - Rationale: design must withstand simultaneous runs from day one. Option A (long timeout) is therefore insufficient — solve concurrency properly now.

- Adopt heartbeat-on-the-file (or folder) as the GC discipline, not blanket mtime threshold.
  - Came from: user picked the deeper option after the deep-modules stimulus framing.
  - Rationale: living agents touch their own file; dead agents stop. Mechanism is one seam (mtime), one interface (glob + age), hides ownership behind a single mechanism — matches the stimulus's locality + leverage payoffs. Threshold can stay short because liveness keeps files fresh.

- Dead files do NOT need to be kept after the owning process dies — they are disposable receipts pointing at dead stdio.
  - Came from: user's "should those even get cleaned?" question.
  - Rationale: MCP config = pointer to live MCP server. Once owner is dead, the pointer is meaningless. Safe to delete the moment liveness fails.

- Layered defense recommended, with run-folder scoping as the architectural anchor:
  1. Run-folder scoping — move `.mcp-*` from project root into `runs/<runId>/`. Single folder per run holds all scratch (MCP configs, logs, pid, future scratch types).
  2. Heartbeat at the folder level — one `runs/<runId>/heartbeat` touched every 60s by the running pipeline, not per-file.
  3. Sweep on every agent spawn — not just meditate startup; any agent.run() triggers gcStaleRuns().
  4. Signal handlers — SIGINT/SIGTERM stop the heartbeat interval; finally still removes the live config (already mostly wired).
  5. Visible sweep log — output.info on every sweep so silent breakage stays visible.
  - Came from: user asked for "ideas to tackle the risk of dead files piling up" and explicitly asked for the simplest-to-manage solution per the deep-modules stimulus.
  - Rationale: ADR-0015 already established run-scoped scratch discipline; this extends it to MCP debris. Adding any future scratch file type costs nothing new — just drop it inside `runs/<runId>/`. One mechanism, no per-type GC.

- Three-state heartbeat semantics — must be made explicit in the design doc:
  - fresh heartbeat → alive → skip
  - stale heartbeat → crashed → rm -rf the run folder
  - absent heartbeat → completed → skip (preserve for debug)
  - Came from: thought-experiment walkthrough during verification.
  - Rationale: without the absent-heartbeat rule, swept completed-run folders would lose debug traces (checkpoint.json, pipeline.jsonl). The rule protects historical runs while still cleaning crashed ones.

- Source-code verification: layered recommendation is buildable from current code with no fatal holes.
  - Came from: user asked "verify from source code that this recommendation is possible."
  - Rationale: confirmed `runs/<runId>/` structure already exists (sample folder `031e002b` holds checkpoint.json, pipeline.jsonl, start, reflect); `agent.ts:155` passes `--mcp-config` as absolute path so CWD-decoupling is free; `pipeline/run.ts:221-222` already registers SIGINT/SIGTERM handlers feeding `ac.abort()` which cascades into `agent.ts:250-263` child kill + `agent.ts:350` finally cleanup. Plumbing required: pass `runId` into RunOptions → agent.run; write `.mcp-*` at `runs/<runId>/` not `cwd`; add `gcStaleRuns()` helper; add heartbeat setInterval in pipeline/run.ts try/finally.

- Non-fatal holes flagged for design doc:
  - Race where sibling sweep fires before brand-new run writes its first heartbeat → fix: write initial heartbeat synchronously before mkdir returns.
  - Pre-fix run folders lack heartbeat → rule "absent heartbeat = complete = skip" preserves them.
  - Concurrent sweeps both target the same stale folder → catch and ignore ENOENT, same pattern as existing `cleanupMcpConfig`.
  - Event-loop block missing heartbeat touches → 5-min threshold vs 60s interval gives 5-cycle margin, tolerable for async-heavy agent work.
  - Came from: thought-experiment walkthrough.
  - Rationale: each is small-code defensive, not architectural. None changes the layered shape.

- The earlier-deferred concurrency open question is now answered: pick run-folder + heartbeat, not blanket mtime threshold.
  - Came from: user's grilling on Option B chose the deeper shape.
  - Rationale: supersedes the "(a) threshold vs (b) per-run allowlist" deferral from round 1. Layer 4 (run-folder scoping) plus folder-heartbeat is the chosen design.

## Open questions

- Long-term growth of completed run folders is acknowledged but explicitly out of scope for this illumination — handled by separate illumination `2026-05-13T0805-scratch-sediment-needs-an-apparat-sweep-command.md` (the `apparat sweep` command). No action needed here.
