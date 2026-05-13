# Scenario: pipeline runner sweeps stale run folders on the next spawn

## Setup
- A clean working directory; the target folder `proj-sweep-smoke` does not exist yet.
- `apparat init proj-sweep-smoke`
- Seed a fixture stale run:
  - `mkdir -p proj-sweep-smoke/.apparat/runs/fixture-stale`
  - `echo "{}" > proj-sweep-smoke/.apparat/runs/fixture-stale/.mcp-meditate-0.json`
  - `touch proj-sweep-smoke/.apparat/runs/fixture-stale/heartbeat`
  - Backdate the heartbeat by 6 minutes:
    `touch -d "6 minutes ago" proj-sweep-smoke/.apparat/runs/fixture-stale/heartbeat`
    (or equivalent `touch -t` with a stamp ≥ 6 min in the past)
- Seed a fixture completed run (no heartbeat) — must be preserved:
  - `mkdir -p proj-sweep-smoke/.apparat/runs/fixture-completed`
  - `echo "{}" > proj-sweep-smoke/.apparat/runs/fixture-completed/checkpoint.json`

## Action
Any apparat command that spawns an agent against `proj-sweep-smoke`. The
quickest deterministic harness is `apparat meditate proj-sweep-smoke --steer
sweep-smoke-probe` then immediately `Ctrl+C` once the first agent spawn begins.
Alternatively run a smoke pipeline: `apparat pipeline run meditate proj-sweep-smoke`.

## Expect
- exit code is 0 OR 130 (Ctrl+C) — both are non-failure states for the sweep itself
- stderr contains "[apparat] swept 1 stale run folder"
- `proj-sweep-smoke/.apparat/runs/fixture-stale/` no longer exists
- `proj-sweep-smoke/.apparat/runs/fixture-completed/` still exists (no heartbeat → preserved)
- a new `proj-sweep-smoke/.apparat/runs/<slug>-<uuid8>/` exists with a `heartbeat` file
  whose mtime is within the last 60 seconds
- the new run folder contains its `.mcp-*-*.json` (during the run) or has been
  removed by ADR-0015 tail-GC (after a successful run)
- the project root (`proj-sweep-smoke/`) contains NO `.mcp-*-*.json` files
