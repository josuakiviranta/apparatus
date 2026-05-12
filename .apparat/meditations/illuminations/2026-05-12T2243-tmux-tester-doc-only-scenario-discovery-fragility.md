---
date: 2026-05-12
description: tmux-tester crashes on doc-only DOT fixtures under .apparat/scenarios/ unless an author remembers to hand-drop a self-skip marker — flip the convention to opt-in or auto-detect.
---

## Core Idea

`tmux_tester` walks every folder under `.apparat/scenarios/` and tries to run each `pipeline.dot` it finds. If a scenario is documentation-only (nodes have no `agent=` attribute, contract asserted by a TS regression test rather than by execution), the tester resolves the missing agent to a default `implement.md`, fails to find it, and crashes the run. The only thing standing between authors and that crash is remembering to drop a `tmux-tester.md` self-skip marker next to the DOT. This run hit the gap (run `parallel-illumination-to-implementation-7565cf19`, fixed in commit `405441f`), and the gap will keep biting future doc-only fixtures.

The convention is fragile in the wrong direction: discovery is opt-out, and the failure mode is a hard crash with a misleading "missing `implement.md`" error rather than a clear "scenario has no executable agents" diagnostic.

## Why It Matters

- Concrete incident this run: commit `c400a0c` introduced `.apparat/scenarios/scheduler-shape-collision/{pipeline.dot,chunked-plan.md}` as a documentation fixture (contract asserted by `src/cli/tests/scheduler-shape-collision-scenario.test.ts`). The plan author explicitly marked the DOT "not executed in CI" — but `tmux_tester` discovered and ran it anyway, crashed on missing `implement.md`, and required an in-session fix (`405941f`) to ship.
- The fix is a workaround, not a root cause: a `tmux-tester.md` self-skip marker. Every future doc-only DOT must remember the same dance.
- The crash message points at the wrong thing: "missing `implement.md`" reads like a default-agent-resolution bug, not "this DOT has no executable nodes". Future authors will spend time chasing the wrong cause.
- The discovery convention silently couples scenario authors to `tmux_tester` internals. A scenario folder is supposed to be a self-describing artifact; needing a marker to opt-out of execution leaks tester concerns into the fixture surface.
- Pattern generalizes: any future doc-only scenario (DAG illustration, validator regression input, design-time reference) will hit the same trap unless the author has read `tmux_tester`'s discovery rules.

## Revised Implementation Steps

1. Survey `src/cli/lib/` (or wherever `tmux_tester`'s scenario discovery lives) and locate the loop that enumerates `.apparat/scenarios/*/pipeline.dot`. Grep for `pipeline.dot` and `scenarios/` to find both the discovery site and the agent-resolution call.
2. Pick a convention. Two viable shapes:
   - **Auto-detect:** treat a DOT whose nodes carry zero resolvable `agent=` attributes as documentation-only and SKIP with a clear `doc_only_no_agents` reason. Cheapest — no marker file needed. Risk: a scenario with a forgotten `agent=` looks doc-only.
   - **Opt-in execution:** require a `tmux-tester.md` runbook (or similar) for a scenario folder to be *eligible* for execution. Folders without one are implicitly doc-only. Inverts today's opt-out marker.
3. Whichever convention wins, make the failure path loud and specific. When `tmux_tester` would otherwise crash on a missing default agent, emit `scenario X has no executable agents — treating as doc-only` (auto-detect path) or `scenario X has no tmux-tester.md runbook — skipping` (opt-in path). Never let it fall through to "missing implement.md".
4. Add a validator pass (in the same family as the existing scenario validators under `src/cli/lib/pipeline-validator/`) that flags a DOT where every node lacks `agent=` and the folder lacks the marker/runbook, with a hint at the chosen convention.
5. Migrate existing doc-only scenarios (start with `.apparat/scenarios/scheduler-shape-collision/`) to the new convention and delete now-redundant self-skip markers if the auto-detect path wins.
6. Document the convention in `CONTEXT.md` next to the `tmux_tester` glossary entry and in the scenario authoring section of `README.md`. One sentence each — the goal is that a future author dropping a doc-only DOT finds the rule without needing to read code.

## Provenance

- Source memory: `.apparat/sessions/2026-05-12-plan-scheduler-shape-consumer-collision.md`
- Pipeline run id: `parallel-illumination-to-implementation-7565cf19`
- Surfaced by: memory-reflector
