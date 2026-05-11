# Plan Review - Chunk 2

**Status:** Issues Found (mostly minor, one notable)

## Issues (blocking)

- [Task 2.5, Step 4 — smoke DOT `script_file="../../.apparat/pipelines/parallel-implement-test/capture-pre-sha.sh"`]:
  Both validator (`src/attractor/core/validators/scripts.ts:47` — `resolvePath(ctx.dotDir, scriptFile)`) and runtime (`src/attractor/handlers/tool.ts:94` — `resolve(meta.dotDir, scriptFile)`) call Node's `path.resolve`, which normalises `..` segments. So `..` in `script_file=` IS accepted in principle. BUT no existing pipeline does this — every other `script_file=` lives next to its DOT. This is an untested code path. Recommend the smoke get its own byte-identical copy of `capture-pre-sha.sh` at `pipelines/smoke/parallel-implement-test/capture-pre-sha.sh` and reference it locally. Cost: one extra copy of a 4-line script; benefit: zero novelty risk.

- [Task 2.4, Step 2 — expected validator output]:
  The chunk-2 DOT routes `plan_scheduler.parallel_worthwhile` (consumed) but the agent also declares `batch_count` and `chunk_count` outputs that NO downstream node consumes. `src/attractor/core/validators/inputs-refs.ts:457` fires `orphan_output` warnings for those. Plan says "zero errors, zero `portability_heuristic` warnings" — silent on `orphan_output`. Make the expectation explicit: orphan warnings on `batch_count`/`chunk_count` are EXPECTED in chunk 2 (chunk 1 has same situation, also unaddressed there). Or drop them from `outputs:` until chunk 3 wires a real consumer.

## Recommendations (advisory)

- [Task 2.3, batch_orchestrator frontmatter `tools: []`]:
  Confirmed safe. `src/cli/lib/agent.ts:150` adds `--allowedTools` only for entries in the list; an empty list = no allowlist flag passed = inherits Claude's defaults (Task tool included). `illumination-to-implementation/implement.md:6` uses the same pattern and dispatches Tasks daily. No change needed.

- [Task 2.3, Step 9 — `git commit --amend --no-edit -a` on a merge commit]:
  `--amend` modifies HEAD's tree/message but preserves its parents. For a merge commit HEAD, the two parents are untouched. Safe. Worth a one-line comment in the agent prompt acknowledging this so a future maintainer doesn't second-guess.

- [Task 2.3, Step 9 red path — `git reset --hard HEAD~<merge_count>`]:
  `merge_count` is known in-iteration (step 8 just happened). The orchestrator must compute it as a local bash variable from step 8's exit codes, not read from `dag.json`. The current prompt says "Count successful merge commits created in step 8" — fine; pin this to a concrete bash idiom (e.g. increment a counter on each successful merge in step 8) so a context-switched LLM doesn't recompute via `git log` and accidentally count pre-existing commits.

- [Task 2.5, Step 3 — node-e bash escaping]:
  Bash double-quoted string contains JS single-quoted `'$dag'` and `'$(git rev-parse HEAD)'`. Bash expands `$dag` and `$(...)` before node sees the string; substitutions land inside JS single quotes — valid JS. Works correctly. Only edge case: if `$dag` (a `mktemp -d` path) ever contained a literal single quote it would break — vanishingly unlikely on `mktemp -d` output. No action needed.

- [Task 2.5, Step 6 — smoke pipeline validate]:
  Stub replaces the orchestrator agent with a tool node. The tool node doesn't validate against the agent's `outputs:` schema (validation runs per-node from the DOT graph, not per-agent-file). The stub's tool-node attrs are independent. Confirmed.

- [Task 2.6 — manifest discovery]:
  Step 1 says `grep -rn "smoke" src/cli/tests/ | head -20`. This IS wishy-washy as you flag. Recommend pinning by reading `src/cli/tests/scenarios/` and `src/cli/tests/smokes-cli.test.ts` if they exist. From the codebase: smokes are enumerated in `src/cli/tests/` smoke runner tests. Replace Step 1 with a concrete file Read: locate the smoke runner test file and check whether it globs `pipelines/smoke/*.dot` or enumerates by name. If glob → no edit needed; if enumeration → add the new DOT path explicitly.

- [Task 2.7, Step 1 — fixture paths in real-pipeline exercise]:
  Plan-mixed.md references `src/cli/lib/x.ts` etc. — these are *target* paths the subagent will CREATE in `$TMP`'s worktree, not files the subagent is expected to FIND in the apparatus repo. That works in principle (the subagent just creates empty TS files). But the fixture plans (Task 1.2) have no implementation body — just `**Files:**` stanzas. A real subagent dispatched from `batch_orchestrator` will run the `superpowers:subagent-driven-development` TDD loop on essentially-empty chunk bodies and likely either no-op or invent scope. Recommend Task 2.7 use a slightly fleshier fixture plan (or accept that Task 2.7 is a "did the pipeline run end-to-end without crashing" smoke, NOT a "did it produce sensible code" check). Add a note clarifying this.

- [Task 2.3, Step 2.5 missing `produces=` on `batch_orchestrator` node in chunk-2 DOT (Task 2.4 Step 1)]:
  The DOT declares `batch_orchestrator [agent="batch_orchestrator"]` with no `produces=`. The orchestrator's outputs (`done`, `conflicts_present`, `reason`) come from the agent's frontmatter `outputs:` block and are auto-emitted by the agent-handler's JSON parse. No explicit `produces=` needed for agents. Consistent with `illumination-to-implementation/pipeline.dot:39` (`implement [agent="implement", max_retries=1]`). Correct as written.

## Spec alignment

Chunk 2 implements §3.1 (pipeline shape — chunk-2 partial), §3.4 (batch_orchestrator), §3.6 (test-command discovery), §4.3 (orchestrator frontmatter + ~250 LOC scale — matches), §4.4 (subagent template — ~80 LOC, matches), §4.6 (capture-pre-sha.sh copy), §4.8 (smoke). No scope creep into §3.5 / §4.5 (merge_resolver — correctly deferred to chunk 3).

## Task decomposition

Tasks are atomic, each step is 2-5 min. Checkbox syntax (`- [ ]`) present on every step. Chunk size ~510 lines including code blocks — under 1000-line cap.

## File scale

`batch_orchestrator.md` draft body: ~95 lines of prose + frontmatter. Spec says ~250 LOC. The draft is light. The procedure covers all 11 spec steps but skimps on the "Strict orchestration discipline" rubric prepend (memory `2026-04-22-rubric-prepend-shipped`) and worked-example sections that typically pad orchestrator agents. Acceptable as a starting body — flesh out during execution.

## Tool node attrs

`capture_pre_sha` (Task 2.4): `cwd="$project"`, `script_file="capture-pre-sha.sh"`, `produces_from_stdout="true"`, `produces="pre_sha"` — matches `illumination-to-implementation/pipeline.dot:33-37` byte-for-byte. Correct.

`batch_orchestrator_stub` (Task 2.5 smoke): same shape, `produces="orchestrator_result"`. Correct.

## Routing

Conditional routing uses `<nodeId>.<output>=<value>` namespacing throughout (memory `2026-04-19-gate-choice-namespacing-shipped`). Correct.

## Summary

Two issues worth addressing pre-implementation:
1. Replace smoke's `../../` script_file path with a local copy (avoid untested resolver code path).
2. Make the `orphan_output` warning expectation explicit in Task 2.4 Step 2 (or drop unused outputs).

Everything else is shippable as-drafted. Recommend approving with the two fixes above.
