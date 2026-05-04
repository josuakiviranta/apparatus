# Scenario tests in the bundled implement pipeline

**Status note (2026-05-04):** The `--model <name>` flag shown in this ADR's CLI synopses was removed on 2026-05-04; see `docs/superpowers/specs/2026-05-04-model-flag-dead-in-implement-pipeline-design.md`. Historical CLI synopses and `inputs=` examples below are preserved as dated artifacts and are NOT retro-edited.

**Status:** accepted (2026-04-30)

## Context

The bundled `implement` pipeline (`src/cli/pipelines/implement/pipeline.dot`)
is `start → run → done`: a deep-loop `implement` agent ticks chunks in
`IMPLEMENTATION_PLAN.md`, commits and pushes per iteration, and exits when
`done=true`. The agent dispatches subagents for unit/integration tests under
`src/cli/tests/` and runs `npm test` in-loop. Smoke pipelines under
`pipelines/smoke/` cover entry-to-exit pipeline runs.

What none of this catches: the *operator-visible* surface. Did the new flag
actually appear in `--help`? Does `ralph implement <empty-folder>` still
behave the way the operator expects after the refactor? Does a TUI overlay
render the right header copy? These are checks a human used to do by hand
and that unit-level tests don't reach. The
`illumination-to-implementation` pipeline already addresses this for one
flow via a `tmux-tester` agent that drives build/test/smoke red-green-fix
loops, but its coverage is generic (the project-wide test suite + smokes),
not feature-specific.

We want the bundled `implement` pipeline to optionally produce
**feature-specific operator-level checks** as part of its run, and to verify
those checks against the just-shipped diff before the run completes —
without mandating tmux for the common case (`ralph implement <project>`
plain).

## Decision

Extend the bundled `implement` pipeline with an opt-in branch that fires
when the operator passes `--scenarios <relative-path>`. The flag's value is
a directory under `$project` that holds **scenario tests**: prose markdown
files describing observable behavior of the system. Two new agents and one
new tool node materialize the loop.

### CLI surface

```
ralph implement <project-folder> [--max N] [--model <name>] [--scenarios <path>]
```

The flag is optional. When omitted, the pipeline runs as before: three
nodes, no tmux dependency, no scenario authoring. When passed, the
pipeline preflights `process.env.TMUX` in `implement.ts` and refuses with
a friendly error if not running inside a tmux session.

### Pipeline shape

```dot
start          -> record_base
record_base    -> implementer
implementer    -> scenario_author        [condition="scenarios_dir!=''"]
implementer    -> done                   [condition="scenarios_dir=''"]
scenario_author -> implementation_tester
implementation_tester -> commit_push
commit_push    -> done
```

The previous `run` node is renamed to `implementer` for self-documenting
readability — same `agent="implement"`, no behavior change.

### `record_base` (new tool node)

Captures `git rev-parse HEAD` once, before the deep loop starts, and
exposes `record_base.sha` to downstream nodes via `produces_from_stdout`.
The mechanic: `produces_from_stdout="true"` makes the engine parse the
last non-empty stdout line as a JSON object and flatten its top-level
keys as `<nodeId>.<key>` (`tool.ts:31-79`). The node therefore wraps
`git rev-parse HEAD` in a `printf '{"sha":"%s"}\n' "$(...)"` so the
last line is JSON, not a bare hex string. This is the bound for "what
was just implemented": `git diff $record_base.sha..HEAD` covers exactly
the work the loop produced this session.

### `scenario_author` (new agent)

Lives at `src/cli/pipelines/implement/scenario-author.md`.

- **Inputs:** `scenarios_dir`, `specs_dir`, `record_base.sha`.
- **Outputs:** `tests_written: boolean`, `scenario_paths: string[]` (added
  or modified files), `summary: string`.
- **Mission:** read the diff, classify clusters as behavior-affecting vs
  internal-only, draft candidate scenarios for the behavior-affecting ones,
  apply two discipline rules, write the survivors.
- **Rule 1 — Subsumption:** read every existing `$scenarios_dir/*.md`
  first. If a candidate's surface is already covered, drop it (or update
  the existing file).
- **Rule 2 — Feasibility:** a scenario must be reducible to concrete
  shell commands (`## Action`) and observable expectations (`## Expect`
  bullets: exit code, file existence, output substring, captured tmux
  frame). "Code is cleaner" is not feasible — drop.
- Creates `$scenarios_dir` (`mkdir -p`) if absent.
- Commits written/updated files with message `test: …`. Does not push.

### `implementation_tester` (new agent)

Lives at `src/cli/pipelines/implement/implementation-tester.md`. Distinct
from `pipelines/illumination-to-implementation/tmux-tester.md` — the
i2i tester drives build/test/smoke for general health; this one drives
*scenario tests* and is the canonical operator-surface verifier. It uses
the same tmux harness helpers (bash block) but its phases and contract
differ.

- **Inputs:** `project`, `run_id`, `scenarios_dir`.
- **Outputs:** `test_result: {pass|fail}`, `test_summary: string`,
  `test_render: string`.
- **Phases:** enumerate every `.md` in `$scenarios_dir`; for each, parse
  `## Setup`, `## Action`, `## Expect`; drive the action via
  `send_input`; check each `Expect` bullet via shell; on any failing
  bullet, enter red-green TDD on **code** (never on the scenario file).
  Commit each passing fix (no push). Loop until all scenarios pass or
  the agent judges itself stuck.
- **Hard rules:** scenarios are authoritative — fix the code, never the
  scenario; do not push (`commit_push` owns that); do not kill the test
  window.
- **Failure mode:** when stuck, return `test_result="fail"` with the
  remaining issues in `test_render`. The pipeline exits non-zero. No
  outer retry — the agent's internal red-green loop *is* the retry
  mechanism.

### `commit_push` (new tool node)

```dot
commit_push [type="tool",
             cwd="$project",
             tool_command="git push origin $(git branch --show-current)"]
```

Pushes scenario_author's `test:` commits and implementation_tester's fix
commits. The implementer's per-iteration push during the deep loop stays
unchanged — `commit_push` only handles post-loop additions.

### Scenario file format

Every `.md` under `$scenarios_dir` follows a fixed three-section shape:

```markdown
# Scenario: <one-line description>

## Setup
<commands or state required before the action; may be empty>

## Action
<the single command invocation under test>

## Expect
- <observable claim 1 — exit code, file existence, output substring, etc.>
- <observable claim 2>
- ...
```

`implementation_tester` parses this shape; deviations break the contract.
The shape is captured in `CONTEXT.md` under "Scenario test."

### Variable mechanics

The graph header gains `scenarios_dir`:

```dot
inputs="specs_dir, max_iterations, llm_model, scenarios_dir"
```

`implement.ts` *always* supplies `scenarios_dir` — empty string when
`--scenarios` is absent. The validator in `graph.ts:763-786` is
satisfied by the header declaration; the existing condition parser in
`conditions.ts` strips a single `'…'` pair, so `scenarios_dir!=''` and
`scenarios_dir=''` work as edge predicates. No changes to the validator
or the condition language.

## Considered alternatives

- **(a) Executable test files (`*.test.ts`) instead of prose markdown.**
  Conventional, integrates with `npm test`. Rejected: duplicates what
  the implementer's TDD subagents already produce. Misses the actual
  gap, which is *operator-surface* verification — the things that pass
  `npm test` but break when a human runs the binary. Prose scenarios
  driven by an agent fill that gap; executable scenarios do not.

- **(b) Plan-only context for scenario_author (no `record_base`).** Read
  `IMPLEMENTATION_PLAN.md` and reason from ticked chunks. Rejected:
  plan can be stale or lie; bounded git diff is the ground truth for
  "what was just implemented." The `record_base` node is a 2-line tool
  call — cheap.

- **(c) Hand-authored starter scenarios for ralph-cli.** Pre-populate
  `src/tests/scenarios/` with 3–5 hand-written files before the
  feature lands. Rejected: would mask the case where scenario_author
  can't bootstrap from zero (a real bug worth surfacing on first
  dogfood); creates style drift between human- and agent-authored
  files. First real run is the acceptance test for the feature itself.

- **(d) Single shared `tmux-tester` agent across both pipelines.**
  Update i2i's tester to conditionally run a Phase 2.5 when
  `scenarios_dir` is supplied; copy the same file into bundled
  implement. Rejected in favor of two distinct agents
  (`tmux-tester` for i2i's general health loop, `implementation-tester`
  for bundled implement's scenario-driven loop). Different missions,
  different prompts, lower cognitive cost than a one-prompt-fits-both.
  ADR-0001 already mandates file-copy reuse, so two physical files
  exist either way; choosing two distinct *contents* matches the two
  distinct missions.

- **(e) Outer retry: route `implementation_tester` failure back to
  `implementer`.** Wire `condition="test_result=fail"` to loop. Rejected:
  the tester already exhausts its red-green loop internally before
  returning fail; re-invoking the implementer without a channel for the
  failure context (which would require modifying the implement agent's
  prompt and frontmatter to consume `test_render`) is theatrical retry,
  not real recovery. Hard fail surfaces the verdict to the operator
  who can act with full context.

## Consequences

- **`ralph implement <project>` (no flag) is unchanged.** Same three-node
  shape, same tmux-not-required posture. No regression for the common
  case.
- **`--scenarios` requires tmux.** Operators outside a tmux session who
  pass the flag get a friendly preflight error from `implement.ts`.
  Documented in `commands.md` and README.
- **Scenarios live with the target project, not with ralph-cli.**
  Per-project artifacts (commits, plan, scenarios) all share the same
  home: the target's git repo. ralph-cli stays generic.
- **Two new agent files and one new tool node.** Both agents follow
  ADR-0001 (sibling to `pipeline.dot`, no registry).
- **Scenario explosion is bounded by author discipline.**
  scenario_author's subsumption + feasibility rules cap the count. If
  drift becomes painful (stale scenarios pile up across many runs), a
  future ADR can add consolidation/cleanup as a separate concern —
  out of scope here.
- **Pushed git history grows a `test: …` commit per scenario authoring
  round, plus one fix commit per failing-then-passing scenario.** The
  implementer's existing per-iteration commits are unchanged.
- **First dogfood run is supervised.** A human reviews what
  scenario_author writes on the empty-dir bootstrap before normalizing
  the loop as autonomous.
- **A future hand-authored scenario or external contribution would
  conflict with scenario_author's authority over `$scenarios_dir`.** If
  that need arises, supersede this ADR with a hybrid model.
