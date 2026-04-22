---
date: 2026-04-20
status: open
description: `tmux_tester` today receives only narrative context (summary, explanation, explainer_render, plan_path) and has to infer "what changed" by running `git log --stat` inside the session — this wastes turns and invites misreads (this session it picked `tool.dot` for a schema-description change that had zero overlap with tool-handler code); the `implement` (and `commit_push`) node should emit a structured `changed_files` + `touched_surfaces` pair into pipeline context so downstream test/verify nodes get ground truth instead of a guess.
---

## Core Idea

`ralph pipeline trace <runId> --node-receive tmux_tester-<hash>` on run `a5eafbe8` shows the context handed to `tmux_tester`:

- `$goal`, `$project`, `$run_id`
- `illumination_path`, `summary`, `explanation`, `explainer_render`
- `design_doc_path`, `plan_path`
- `approval_gate.choice`, `review_gate.choice`, `agent.sessionId`

Nothing that names the files the `implement` node touched. The only "what changed" signal is semantic prose inside `summary`/`explanation` — which is a distillation of the illumination, not a diff.

`tmux_tester`'s rubric (`src/cli/agents/tmux-tester.md`, Phase 2) then asks the agent to "pick the smoke pipelines most relevant to what the implementation node changed". Because the received context has no structured diff, the agent has to:

1. Shell out to `git log -1 --stat` and `git log --stat -3 -- <guessed globs>`.
2. Parse the stat output as free text.
3. Map parsed paths to smoke pipelines using nothing but its own judgment.

This session that chain produced: schema-description edits → `tool.dot` smoke. `tool.dot` exercises the tool-handler; the schema-description change was in the agent-handler prompt assembly surface. Zero overlap, zero verification of the actual risk surface. The agent-surface rubric tightening (`2026-04-20T2900-verification-matrix-in-plan`) is one side of the fix; this illumination is the other side — give the agent ground truth instead of forcing it to derive ground truth from a shell.

## Why It Matters

Agent nodes pay for context in tokens and in wall-clock — a `git log --stat` + follow-up filtering + path-to-smoke mapping costs ~3-5 tool turns and ~2-3K tokens. More importantly, every one of those turns is a failure surface: the agent can mis-grep, mis-parse, or mis-map. On this run the whole chain succeeded technically (it did read `git log --stat -3 -- 'pipelines/schemas/*.json' 'src/**/description*.test.ts'`) and still arrived at a wrong smoke selection — the mapping step is where judgment broke down.

The pipeline engine **already has** this data cheaply:

- `implement`'s agent-handler can capture the shell commit list it just produced.
- `commit_push` can call `git diff --name-only <base>..HEAD` and return the result.
- Either node can emit the set as a first-class context value.

Shipping the diff as structured context turns the "what changed" question from an agent-inference problem into a dictionary lookup. That lookup is deterministic, cacheable by the runtime (checkpoint preserves it on `--resume`), and falsifiable by downstream nodes that can assert on specific paths.

This is the same shape as the fix in `2026-04-16-pipeline-context-observability`: don't require an LLM to re-derive something the runtime already computed. Context is cheaper and more reliable than re-inference.

The bug is also **composable**: once `changed_files` lives in context, it becomes the substrate for the next lint-lane / observability features (`2026-04-20T2400-split-validate-and-lint-lanes`), for per-PR CI narrowing, for `pipeline trace` to show a diff summary per node, and — most directly — for `2026-04-20T2900-verification-matrix-in-plan` to index the plan's verification table by actual changed files rather than projected ones.

## Revised Implementation Steps

### (a) Minimal — emit `changed_files` from `commit_push`

1. `commit_push` already runs after `implement` and has a git repo in hand. Add one shell line: `git diff --name-only <base>..HEAD` where `<base>` is the SHA captured at pipeline start (stored in context as `$git_base_sha`).

2. Store the `$git_base_sha` at pipeline start. Simplest place: a new tool-node at the top of `illumination-to-implementation.dot` (and peers) that runs `git rev-parse HEAD` and emits `git_base_sha`. Alternatively, a synthetic context value written by the engine at `pipeline-start` time — bigger blast radius, prefer the tool-node route unless several pipelines need it.

3. Emit the diff as `changed_files` (newline-separated string; parse in the consuming agent with `split('\n')`) and `changed_files_count` (number, for preflight budget decisions).

4. Update `specs/pipeline.md` to document `changed_files` as a first-class context key produced by `commit_push`. Add a one-line example under the "Context values produced by stock nodes" section.

### (b) Derived — emit `touched_surfaces`

1. After (a) lands, add a second tool-node (or inline script in `commit_push`) that maps `changed_files` to a coarse surface bucket set: `schemas`, `agents`, `handlers`, `commands`, `tests`, `docs`, `scripts`, `specs`.

2. The mapping lives as a small data file `pipelines/surfaces.json` shipped in the repo:
   ```json
   {
     "schemas": ["pipelines/schemas/"],
     "agents": ["src/cli/agents/"],
     "handlers": ["src/attractor/handlers/"],
     "core": ["src/attractor/core/", "src/attractor/transforms/"],
     "commands": ["src/cli/commands/", "src/cli/program.ts"],
     "tests": ["src/cli/tests/", "src/attractor/tests/"],
     "scripts": ["pipelines/scripts/"],
     "specs": ["specs/", "docs/"]
   }
   ```
   Single source of truth. Consumers (tmux_tester, memory_writer, future lint lane) read the same file.

3. Emit `touched_surfaces` (comma-separated or JSON array string) alongside `changed_files`.

4. `tmux_tester.md`'s Phase 2 surface → smoke map reads `touched_surfaces` directly instead of inferring via git log. Deterministic lookup replaces LLM judgment.

### (c) Follow-up — runtime-level, not tool-node-level

1. Move the capture out of user-space tool nodes into the engine. A `git-diff` transform runs automatically on `pipeline-end` of any node whose handler committed (agent nodes with `allows_write=true`, `commit_push` tool node). The transform reads `git log <base>..HEAD --name-only` and injects `changed_files` / `touched_surfaces` into context without any `.dot`-level wiring.

2. Pros: every pipeline gets the signal for free. Cons: more engine surface, more invariants to maintain. Justifiable only once 3+ pipelines want it. Defer.

### Alternatives considered

- **Pass the whole `git diff` as context.** Rejected: large, token-expensive, and the consumer almost always wants paths not hunks. `git diff --name-only` is the right granularity.

- **Let `tmux_tester` call `git diff` itself (status quo).** That is what happens today. The failure mode — paths read correctly but mapped to the wrong smoke — is exactly why pushing the lookup into deterministic context is the fix. The rubric tightening in `tmux-tester.md` helps but does not remove the need: a deterministic signal is still better than "LLM reads a stat line".

- **Read `~/.ralph/runs/<slug>/pipeline.jsonl`.** The trace already records `node-end` events with `contextUpdates`. A downstream agent could parse the JSONL to rebuild state. Rejected: trace is the *debugging surface*, not a consumption contract; making agents consume JSONL couples them to the trace format and defeats the point of context.

## Cross-References

- `2026-04-20T2900-verification-matrix-in-plan` — paired illumination; together they remove the "what to verify" guesswork at two ends (diff-side here, plan-side there).
- `2026-04-16-pipeline-context-observability` (memory) — design + plan for context observability; this illumination extends that substrate with a concrete new key set.
- `2026-04-20-schema-description-overrides-agent-rubric` (memory) — the session that exposed the gap: tmux_tester picked `tool.dot` for a schema/agent-handler change because it had no structured "touched surfaces" signal.
- `2026-04-20T2400-split-validate-and-lint-lanes` — once `changed_files` is context-native, the lint lane can scope its own checks to changed files.
- `2026-04-20T2200-explicit-consumes-declarations` — same structural intuition: make implicit dependencies explicit and structured so downstream tooling can trust them.
- Rubric currently constrained: `src/cli/agents/tmux-tester.md` Phase 2 step 2.
- Evidence: `ralph pipeline trace 8eddf696 --node-receive tmux_tester-c458` — shows the received context omits any structured diff.
