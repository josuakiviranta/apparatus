---
date: 2026-05-04
run_id: 74ca63f7-2f5b-414a-aa85-4a17f01d03e0
plan: docs/superpowers/plans/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars.md
design: docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md
illumination: meditations/illuminations/2026-05-01T1424-validator-misclassifies-tool-node-outputs-as-caller-vars.md
test_result: pass
---

# Stop listing tool-node outputs and CLI-injected vars in [required_caller_vars]

## What was implemented

`pipeline validate src/cli/pipelines/implement/pipeline.dot` now prints `[required_caller_vars] llm_model, scenarios_dir` instead of `llm_model, max_iterations, record_base.sha, scenarios_dir`. The validator stops listing tool-node stdout outputs and CLI-injected vars, which had become noise that operators either guessed at or ignored.

## Key files

- `src/cli/pipelines/implement/pipeline.dot` — three additive `.dot` edits (line 3 `inputs=` shrunk; `record_base` gained `produces="sha"`; `implementer` gained `default_max_iterations="0"`).
- `src/attractor/tests/graph-required-caller-vars.test.ts` — new regression case covering both the `produces=` exemption and `default_<key>=` silencing in one fixture.

## Decisions and patterns

- No engine code changes. Both code paths existed already: `nodeProduces` already reads tool-node `produces=` (`src/attractor/core/graph.ts:194-198`), and the agent-inputs loop already silences `default_<key>=` (`src/attractor/core/graph.ts:801-802`). The fix activates them via the bundled pipeline source.
- `llm_model` cleanup deliberately deferred to a follow-up illumination. It's structurally similar noise (CLI-injected via `--model` at `src/cli/commands/implement.ts:35`, no agent reads it), but the user narrowed scope mid-chat to land the simpler change first.
- Two assertions packed into one `it(...)` block (qualified `<tool>.<key>` and digraph `inputs=`), per design §2.4: same behavior surface (validator honors author-declared static productions and consumer-level defaults).
- `.ralph/pipelines` portability confirmed non-breaking. Auto-injection of `max_iterations`/`llm_model` is hardcoded only in `ralph implement` (`src/cli/commands/implement.ts:34-35`); `ralph pipeline run` and the resolver pass `--var` through unchanged. Project-local pipelines that legitimately declare `inputs="max_iterations"` continue to require operator `--var`.

## Gotchas and constraints

- `default_max_iterations="0"` only silences the validator banner; it does not constrain runtime behavior. The implement node still loops unbounded by design — `0` is the engine's "unbounded" sentinel matched at the same call site that injects `options.max ?? 0`.
- `grep -c 'max_iterations'` counts lines, not occurrences; the bundled pipeline now packs three tokens onto line 12. Use `grep -o ... | wc -l` for token counts.
- Comma placement matters in multi-line attribute lists. The `record_base` block's previous trailing `]` had to gain a comma on the `produces_from_stdout="true"` line before appending `produces="sha"]`.

## Final verification

- test_result: pass
- test_summary: Cycle 1: build green, full suite 1257/1258 with one flake in pipeline-app-integration.test.tsx (passed in isolation, unrelated to diff). Cycle 2 clean: 1258/1258. `pipeline validate src/cli/pipelines/implement/pipeline.dot` prints exactly `llm_model, scenarios_dir` as the design predicted. No fixes required.

## Learnings from the run

- Pipeline trace for `run_id=74ca63f7-2f5b-414a-aa85-4a17f01d03e0` not present under `~/.ralph/ralph-cli-0c42de/runs/`; the projectKey directory's run dirs use short hashes (e.g. `f6b021e5`) that don't include this run_id substring, and grep across `~/.ralph` returned no match. Memory written from artifact + git evidence only.
