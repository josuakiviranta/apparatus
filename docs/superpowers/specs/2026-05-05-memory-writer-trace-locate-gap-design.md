# Design: Unify `run_id` so memory-writer/reflector can locate `pipeline.jsonl`

**Date:** 2026-05-05
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-05T1056-memory-writer-trace-locate-gap.md`

## 1. Motivation

The illumination-to-implementation pipeline ends with `memory-writer` + `memory-reflector` reading per-run telemetry. Both agents look up `pipeline.jsonl` by the `$run_id` the engine seeds into pipeline context. They cannot locate it, and the failure is silent — a "smooth run" memory note is byte-indistinguishable from a "trace lost" one.

Root cause is two independent UUID generators, not a glob bug:

- The engine creates its own UUID at `src/attractor/core/engine.ts:142`:

    ```ts
    const runId = randomUUID();
    context["run_id"] = runId;
    ```

    This 36-character UUID is what every downstream agent reads as `$run_id` (it is what feeds `opts.traceWriter?.onPipelineStart({ runId, ... })` at `src/attractor/core/engine.ts:144` and what populates the `run_id` context entry).

- Meanwhile the CLI creates its own, separate id at `src/cli/commands/pipeline.ts:286`:

    ```ts
    const runId = randomUUID().slice(0, 8);
    ```

    This 8-character id is what shapes the on-disk run directory: `logsRoot = join(runsRoot, runId)` at `src/cli/commands/pipeline.ts:301`, and `tracePath = join(logsRoot, "pipeline.jsonl")` at `src/cli/commands/pipeline.ts:303`.

The CLI passes only `logsRoot` to the engine at `src/cli/commands/pipeline.ts:370-381` — the 8-char `runId` is dropped before the engine's context-write. `EngineOptions` at `src/attractor/core/engine.ts:20-38` has no `runId` field, so the engine cannot accept an injected id today. Two `randomUUID()` calls → the value at `$run_id` (36 chars) and the on-disk dir name (8 chars) can never match. The mismatch is invariant on every run.

Memory-writer's prompt at `.ralph/pipelines/illumination-to-implementation/memory-writer.md:41` claims the trace lives at `~/.ralph/<projectKey>/runs/$run_id/`. With the 36-char `$run_id` and the 8-char on-disk dir, that path never resolves. Memory-writer's step 2 at `.ralph/pipelines/illumination-to-implementation/memory-writer.md:51` mentions `ralph pipeline trace` as a parenthetical alternative, but the primary instruction is still a glob — and `ralph pipeline trace $run_id` would equally fail today, because it calls `runDir(project, runId)` at `src/cli/commands/pipeline.ts:589`, which would resolve to a directory that does not exist under the engine's id.

The symptom in the wild: pipeline run `5595c462-…` (recorded by the illumination's source memory `.ralph/sessions/2026-05-05-agent-handler-two-paths-one-execute.md`) saw memory-writer log *"`pipeline.jsonl` for `run_id=5595c462-…` was not present"*. Memory was reconstructed from artifacts + `git log` only; per-node retry counts and tmux fix-cycle data were lost. Memory-reflector's procedure at `.ralph/pipelines/illumination-to-implementation/memory-reflector.md:47` instructs *"Do not re-open the raw `pipeline.jsonl` trace; if the memory file lacks signal, that signal is gone for your purposes."* Reflector inherits writer's gap unconditionally.

This is a self-reinforcing observability regression: every memory file written until this fix lands silently degrades to artifact-only signal, and reflector's skip-fast logic at `.ralph/pipelines/illumination-to-implementation/memory-reflector.md:49-56` cannot tell the difference between a clean run and a trace-lost one.

## 2. Decision Summary

The minimal fix has three pieces, in this order:

1. **Unify `runId` on the 8-char slice.** Add an optional `runId?: string` field to `EngineOptions` (`src/attractor/core/engine.ts:20-38`). At `src/attractor/core/engine.ts:142`, replace the unconditional `randomUUID()` with `opts.runId ?? randomUUID().slice(0, 8)` so the engine adopts the caller-supplied id when present and otherwise generates one in the same shape as the CLI.

2. **CLI passes the 8-char id through.** At `src/cli/commands/pipeline.ts:370-381`, add `runId` to the `runPipeline(graph, opts)` call. The CLI already computes the 8-char id at line 286 — it currently uses it only for `logsRoot` and `tracePath`. After this change, the same id reaches the engine's context-write, so `context["run_id"]` (the value agents see as `$run_id`) equals the on-disk dir name byte-for-byte.

3. **Rewrite memory-writer + memory-reflector prompts to call `ralph pipeline trace $run_id`.** The CLI surface at `src/cli/program.ts:179-186` already exposes the lookup (`ralph pipeline trace <runId> [--node-receive <nodeId>] [--full]`) and resolves the path internally via `runDir(project, runId)` at `src/cli/commands/pipeline.ts:589`. Memory-writer's procedure at `.ralph/pipelines/illumination-to-implementation/memory-writer.md:51` swaps from a path glob to a direct `ralph pipeline trace $run_id` invocation (and `ralph pipeline trace $run_id --node-receive <id>` for per-node slices). Memory-reflector's procedure at `.ralph/pipelines/illumination-to-implementation/memory-reflector.md:36` already references `$run_id` only for idempotency; the path-shape line in the writer's prompt at `.ralph/pipelines/illumination-to-implementation/memory-writer.md:41` is updated to point at the CLI command rather than a glob pattern.

4. **Add a smoke-test assertion.** Extend `src/cli/tests/pipeline-trace-lookup.test.ts` (or a sibling smoke file) with one post-run assertion: after a smoke pipeline completes, `ralph pipeline trace $run_id` (using the `$run_id` the engine wrote into context) exits 0 and lists at least one node. This pins the public contract — "agents can call `ralph pipeline trace $run_id`" — and catches future re-divergence of the two ids.

Out of scope (explicitly dropped from the verifier's earlier proposal — see refinement log entry on `$trace_path` and chat-summarizer's "Drop verifier's `$trace_path` pipeline-context proposal" bullet):

- **No new `$trace_path` context key.** Once `ralph pipeline trace $run_id` resolves, exposing the absolute path as a separate context value is redundant and adds public-context surface.
- **No on-disk layout change.** `~/.ralph/<projectKey>/runs/<8-char>/pipeline.jsonl` keeps its shape. `--resume <8char>` muscle memory is unchanged; the 8-char dir naming is unaffected.
- **No README update.** `README.md:85` already documents `ralph pipeline trace <runId>`, and `README.md:96` already documents `$run_id` expansion at load time. No new public surface to advertise.
- **No engine-side path emission.** The engine continues to take `logsRoot` from the caller and write the trace there. It does not learn about the CLI's directory convention.
- **No removal of the current writer/reflector idempotency wiring.** Memory-reflector's `$run_id`-based idempotency check at `.ralph/pipelines/illumination-to-implementation/memory-reflector.md:36` works identically post-fix; the value just shrinks from 36 chars to 8 chars.

## 3. Architecture

### 3.1 Current shape (broken)

```
CLI: pipeline.ts
  ├── line 286:  const runId = randomUUID().slice(0, 8)        ← 8-char id
  ├── line 301:  logsRoot = join(runsRoot, runId)               ← 8-char dir on disk
  ├── line 303:  tracePath = join(logsRoot, "pipeline.jsonl")
  └── line 370:  runPipeline(graph, { logsRoot, ... })          ← runId NOT passed

Engine: engine.ts
  ├── line 20-38: EngineOptions { logsRoot, cwd, ... }          ← no runId field
  ├── line 142:   const runId = randomUUID()                    ← 36-char id (independent!)
  ├── line 143:   context["run_id"] = runId                     ← agents see 36-char
  └── line 144:   traceWriter.onPipelineStart({ runId, ... })

Result:
  - $run_id in agent context: 36-char UUID
  - On-disk dir name:          8-char UUID slice
  - They never match.

Memory-writer.md
  ├── line 41:  "trace lives at ~/.ralph/<projectKey>/runs/$run_id/"   ← never resolves
  └── line 51:  "Open ~/.ralph/.../$run_id/pipeline.jsonl
                 (or pass the runId to ralph pipeline trace)"           ← also fails:
                                                                          trace command would
                                                                          look up runDir(project,
                                                                          $run_id) under a 36-char
                                                                          name that doesn't exist.

Memory-reflector.md
  └── line 36:  references $run_id for idempotency only — Glob over
                 .ralph/meditations/illuminations/*.md and grep for
                 "Pipeline run id: $run_id". This works (no path lookup), but
                 reflector inherits memory-writer's lost trace because
                 reflector.md:47 forbids re-opening the trace.
```

### 3.2 Target shape (fixed)

```
CLI: pipeline.ts
  ├── line 286:  const runId = randomUUID().slice(0, 8)        (unchanged)
  ├── line 301:  logsRoot = join(runsRoot, runId)               (unchanged)
  ├── line 303:  tracePath = join(logsRoot, "pipeline.jsonl")   (unchanged)
  └── line 370:  runPipeline(graph, { logsRoot, runId, ... })   ← NEW: pass runId

Engine: engine.ts
  ├── line 20-38: EngineOptions { logsRoot, runId?: string, cwd, ... }   ← NEW field
  ├── line 142:   const runId = opts.runId ?? randomUUID().slice(0, 8)   ← accept injected,
  │                                                                       default to same shape
  ├── line 143:   context["run_id"] = runId                              (unchanged shape;
  │                                                                       value is now 8 chars)
  └── line 144:   traceWriter.onPipelineStart({ runId, ... })           (unchanged)

Result:
  - $run_id in agent context: 8-char id (identical bytes to on-disk dir)
  - On-disk dir name:          8-char id
  - They match exactly.

Memory-writer.md
  ├── line 41:  rewritten — points at `ralph pipeline trace $run_id`
  │              instead of asserting a path shape.
  └── line 51:  step 2 rewritten — primary instruction is
                 `ralph pipeline trace $run_id` (whole run) and
                 `ralph pipeline trace $run_id --node-receive <id>`
                 (per-node slice). Path glob removed.

Memory-reflector.md
  └── line 36: unchanged in shape; the $run_id used for idempotency now
                shrinks 36→8 chars but the grep target still works.
```

### 3.3 Why 8 chars, not 36

The chat refinement explicitly chose the 8-char slice (chat-summarizer log: *"Minimal fix: unify runId on the 8-char slice"*). Reasons captured there and re-stated here for the audit trail:

- **Existing on-disk dirs stay valid.** The CLI has been writing 8-char dirs since the slice landed; none get renamed.
- **`--resume <8char>` muscle memory unchanged.** Users type 8 chars after `--resume`; this matches the dir name they see.
- **`pipeline.jsonl` filename unchanged.** It is not parameterised by `runId`.
- **Only `$run_id` in agent context shrinks** (36 → 8 chars). Agents that read `$run_id` for display, idempotency keys, or grep targets are unaffected by the length change because they never assumed 36-char shape. Memory-reflector's idempotency grep at `.ralph/pipelines/illumination-to-implementation/memory-reflector.md:45` greps for the literal `Pipeline run id: $run_id`; the pattern survives identically with an 8-char value.

The opposite choice (engine forces 36 chars; CLI promotes its `runId` to 36 chars and renames dirs) would break `--resume`, drift muscle memory, and require a one-time migration. The 8-char direction is mechanically free.

### 3.4 Why optional, not required

`EngineOptions.runId?` is **optional** so non-CLI callers (tests that drive `runPipeline` directly, future callers that have not adopted the convention) keep working. When the field is absent, the engine falls back to its own `randomUUID().slice(0, 8)` — same shape as the CLI's id, so even fallback callers produce a consistent dir-name-matchable value if they happen to construct a `logsRoot` from it.

This is additive on the public contract. No existing engine consumer breaks.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/attractor/core/engine.ts` | Add `runId?: string` to `EngineOptions` interface (after the `logsRoot: string` field at line 21, before the `cwd: string` field — keeping the "structural inputs" cluster together). Replace `const runId = randomUUID();` at line 142 with `const runId = opts.runId ?? randomUUID().slice(0, 8);`. No other engine logic moves. The trace-writer call at line 144, the `context["run_id"] = runId` at line 143, and every downstream reference to `runId` keep working unchanged because they all use the local binding. |
| `src/cli/commands/pipeline.ts` | At the `runPipeline(graph, { ... })` call site at lines 370-381, add `runId,` to the option object. The CLI already binds `runId` at line 286 — this is a one-token addition. No change to `logsRoot`, `tracePath`, `gcOldRuns`, or any other downstream wiring. |
| `.ralph/pipelines/illumination-to-implementation/memory-writer.md` | Rewrite the path claim on line 41 from `Trace and checkpoint share the directory ~/.ralph/<projectKey>/runs/$run_id/ (pipeline.jsonl + checkpoint.json side by side).` to a sentence pointing at `ralph pipeline trace $run_id`. Rewrite procedure step 2 on line 51 to make `ralph pipeline trace $run_id` the primary instruction (with `--node-receive <id>` flagged for per-node slicing) instead of a parenthetical alternative. Keep the "if the trace is missing, fall back to artifact-only evidence and note the gap" fallback at line 58 — it covers the genuine "engine never wrote the file" case (e.g. headless crash before first node) that survives the fix. |
| `.ralph/pipelines/illumination-to-implementation/memory-reflector.md` | No prompt change required. Reflector references `$run_id` only for idempotency (line 36, 45). Its skip-fast logic at lines 49-56 keys on memory-file *contents* — once writer's contents stop being trace-blind, reflector's signals start firing as designed. |
| `src/cli/tests/pipeline-trace-lookup.test.ts` (or a sibling smoke file under `src/cli/tests/`) | Add one new `it(...)` case: drive a short pipeline (the existing chat-only smoke fixture, or a hand-built minimal `Graph`) end-to-end via `runPipeline`, capture the `run_id` the engine writes into the context, then call `pipelineTraceCommand(runId, { project: projectRoot })` and assert it exits 0 (i.e. resolves the trace path the CLI advertises). The assertion form mirrors the existing "resolves a runId using --project" case at `src/cli/tests/pipeline-trace-lookup.test.ts:49`. The test must read `runId` from the engine's emitted context, not hard-code it — that is the point. |

No source-code logic changes outside the two single-line edits in `engine.ts` and `pipeline.ts`. No new helper, no new module, no schema/API contract change visible to MCP, agents, or `.dot` syntax.

## 5. Data flow

The end-to-end run path changes in exactly one shape:

- **Before:** CLI generates 8-char `runId`, derives `logsRoot` and `tracePath` from it, then drops it. Engine generates a separate 36-char id, writes to `context["run_id"]`, calls `traceWriter.onPipelineStart({ runId: <36-char>, ... })`. The trace writer (which writes to the CLI-supplied `tracePath`) records `runId: <36-char>` inside the JSONL, but the file lives under the 8-char dir. Lookup by `$run_id` fails because it never matches the dir.

- **After:** CLI generates 8-char `runId`, derives `logsRoot` + `tracePath` from it, **passes the same `runId` to `runPipeline`**. Engine sees `opts.runId`, uses it for `context["run_id"]` and `traceWriter.onPipelineStart`. The trace writer records `runId: <8-char>`, the file lives under the 8-char dir, the agent's `$run_id` is the 8-char dir name. Lookup by `$run_id` resolves at the CLI surface (`pipelineTraceCommand` at `src/cli/commands/pipeline.ts:589` joins `runDir(project, runId)` with `pipeline.jsonl` and finds the file).

The trace-writer payload is functionally identical apart from the `runId` field's byte length. Every other JSONL field (`pipelineName`, `nodeId`, `nodeReceiveId`, `timestamp`, `ctx.values`, `outcome`) is unchanged.

The agent-prompt change is purely procedural: writer drops a path glob, calls a CLI command. The command itself is unchanged. The shell-quoting story is unchanged (`$run_id` is a context-substitution variable, not a shell variable — the engine substitutes it at prompt-render time, identical to every other `$foo` use across pipeline prompts).

## 6. Blast radius / impact surface

Sourced from `Blast radius:` paragraph at the tail of the verifier's evidence and the `## Blast radius` block of the explainer's render.

- **Size:** S
- **Files touched:** ~5
  - source (2): `src/attractor/core/engine.ts` (one interface field + one line in `runPipeline`), `src/cli/commands/pipeline.ts` (one token added to the engine-invocation option object)
  - agent prompts (2): `.ralph/pipelines/illumination-to-implementation/memory-writer.md` (lines 41 + 51 reworded), `.ralph/pipelines/illumination-to-implementation/memory-reflector.md` (no change required — listed for explicit zero-touch confirmation)
  - tests (1): `src/cli/tests/pipeline-trace-lookup.test.ts` extended with one assertion
- **Surfaces crossed:** engine core + CLI consumer + agent prompts + test suite. CLI flag/help surface untouched. MCP server (`src/cli/mcp/illumination-server.ts`) untouched. `.dot` syntax untouched. `.ralph/` on-disk layout untouched. Pipeline schemas / agent IO contracts untouched.
- **Breaking change:** **no.**
  - `EngineOptions.runId?` is additive optional; existing engine consumers compile without edits.
  - On-disk dir layout is unchanged — `~/.ralph/<projectKey>/runs/<8-char>/pipeline.jsonl` keeps its shape.
  - `--resume <8char>` muscle memory unchanged; users still resume with the 8-char id they see in the run dir.
  - `$run_id` in agent context shrinks from 36 chars to 8 chars. This is observable to any agent prompt that reasoned about its length. Repo-wide grep for `$run_id` (audit list at §10.1) finds three categories of consumer:
    - Path-shape claims in memory-writer (`.ralph/pipelines/illumination-to-implementation/memory-writer.md:41,51`) — covered by the prompt rewrite.
    - Idempotency keys in memory-reflector (`.ralph/pipelines/illumination-to-implementation/memory-reflector.md:36,45`) — length-agnostic.
    - Provenance lines in pre-existing illumination bodies (e.g. `.ralph/meditations/illuminations/2026-05-05T1056-memory-writer-trace-locate-gap.md:31` records the 36-char id). These are historical artifacts; nothing reads them as a path key.
- **Spec / docs ripple checklist:**
  - [ ] `README.md:85` already documents `ralph pipeline trace <runId>`. No edit.
  - [ ] `README.md:96` already documents `$run_id` expansion. No edit.
  - [ ] No new ADR required. The change is a bugfix that aligns two id sources, not a policy decision. ADR-0004 (source-as-truth) endorses making the on-disk source-of-truth visible to agents — this fix lands in that direction.
  - [ ] No `CONTEXT.md` edit required (ADR-0004 already covers the principle).
- **Test ripple checklist:**
  - [ ] One new assertion in `src/cli/tests/pipeline-trace-lookup.test.ts` (or sibling). Asserts post-run `pipelineTraceCommand($run_id, { project })` exits 0 and the `runId` value it receives is the same one the engine wrote into context.
  - [ ] No edits to `src/cli/tests/pipeline-trace-command-validation.test.ts` — that file tests CLI argument shape, not run-id matching.
  - [ ] No edits to existing engine unit tests — `EngineOptions.runId?` is optional; existing test fixtures that omit it continue to take the fallback path (`randomUUID().slice(0, 8)`), which is a different code path than today (was `randomUUID()`) but produces an id that still satisfies "is a string" assertions everywhere.
  - [ ] Smoke folder tests (`src/cli/tests/pipeline-*-folder.test.ts`) need no edit; they validate `.dot` shapes, not run-time id semantics.

## 7. Trade-offs

### 7.1 Inject vs read-back

The chosen design has the CLI inject the id into the engine. The alternative — engine generates the id, then the CLI reads it back from `traceWriter.onPipelineStart` or `result.context["run_id"]` and uses it for `logsRoot`/`tracePath` — was rejected:

- The CLI must compute `logsRoot` (and pass it to the engine) **before** the engine starts. Read-back inverts that ordering and would force `logsRoot` to be derivable lazily, complicating `gcOldRuns` (`src/cli/commands/pipeline.ts:289-291`) and `--resume` resolution (`src/cli/commands/pipeline.ts:295-302`).
- Inject keeps the CLI as the source of truth for the on-disk layout convention. The engine just records the value.
- The interface change is smaller (one optional field, one line in the engine).

### 7.2 Why not put the trace path in context

The verifier's first proposal added `$trace_path` to pipeline context so memory-writer would not need to resolve the path at all. Dropped per chat refinement (chat-summarizer log: *"Drop verifier's `$trace_path` pipeline-context proposal — no new context key, no engine plumbing of trace path."*). Reasons:

- `ralph pipeline trace $run_id` already resolves the path; surfacing it as a separate context key duplicates that resolution.
- Adding a context key is public-surface growth — any future agent could read `$trace_path` and become a downstream coupling.
- The fix should rest on the smallest possible interface delta. One injected `runId` is minimal; a new context key is not.

If a future agent needs the resolved path *as a string* (e.g. for an `Edit`-tool open of the file), it can call `ralph pipeline trace $run_id --full | head -1` or invoke `runDir` indirectly via a future helper. That is YAGNI for today.

### 7.3 Move-only vs deeper refactor

Tempting refinements (push the id-generator behind a single helper module, extract a `RunContext` type, push `logsRoot` derivation into the engine) are deferred. The chat refinement asked for the **minimal** fix; structural cleanup is the bloat-design domain, not this one. The two-line source change is reviewable in seconds; a wider refactor entangles the regression-fix story with a structural one.

### 7.4 Why not regenerate the id in the engine when CLI does not pass it

When `opts.runId` is absent, the engine could keep `randomUUID()` (36 chars) — preserving today's behaviour for non-CLI callers. The design instead picks `randomUUID().slice(0, 8)` so the engine's fallback shape matches the CLI's. Reasons:

- Future non-CLI callers that derive `logsRoot` from the engine's id (the symmetric pattern to today's CLI) get a working flow on day one — no second migration.
- The shape consistency is the load-bearing invariant; preserving the 36-char fallback would re-create the silent-mismatch surface for future callers.
- The change is invisible to current non-CLI callers because none of them grep `$run_id` for length.

### 7.5 Memory-writer prompt: drop the glob entirely vs keep both

The prompt rewrite makes `ralph pipeline trace $run_id` the primary path and drops the glob. An alternative — keep both, present them as fallback to each other — was rejected on the same minimal-fix grounds: once the CLI command resolves, the glob is dead weight, and presenting two paths invites future drift between them.

The "if `pipeline.jsonl` is missing or empty, proceed with artifact-only evidence and note the gap" fallback at `.ralph/pipelines/illumination-to-implementation/memory-writer.md:58` stays — that covers the genuine "engine never wrote the file" case (e.g. headless crash before first node), which survives the id-unification.

## 8. Constraints

- All edits land in a single commit so the diff tells one story (1 line in `engine.ts`, 1 token in `pipeline.ts`, 2 prompts edited, 1 test extended).
- `npx tsc --noEmit` must pass after the change. The new `runId?` field is optional; no existing engine consumer needs an edit.
- `npx vitest run` must pass. The new assertion in `pipeline-trace-lookup.test.ts` is additive; no existing test changes behaviour.
- After the fix, the engine's `context["run_id"]` value (visible to agents as `$run_id`) MUST equal the basename of the run directory under `~/.ralph/<projectKey>/runs/`. This is the load-bearing invariant; the smoke-test assertion is its enforcement.
- `pipeline.jsonl` byte-equivalence (modulo the `runId` field's length and timestamps) for any pre-change run shape — every other tracer field is preserved.
- Memory-writer prompt rewrite must not delete the existing fallback at `.ralph/pipelines/illumination-to-implementation/memory-writer.md:58` (artifact-only evidence path). That covers a different failure mode (trace genuinely absent) and remains valid.

## 9. Open questions

None at design-doc time. All three rubric criteria pass per the verifier's evidence (relevance, accuracy, project-fit). The reviewer loop may surface nits on:

- **Where to land the new test assertion** — extend `pipeline-trace-lookup.test.ts` or create a new `pipeline-trace-roundtrip.test.ts`. Operational, not architectural.
- **Default-value choice in the engine fallback** — `randomUUID().slice(0, 8)` vs a constant length pulled from a shared helper. Today's design picks the inline slice for symmetry with `src/cli/commands/pipeline.ts:286`; if the bloat-design or a follow-up extracts an `id-helper` module, both call sites can switch.
- **Whether memory-reflector's prompt should *also* be lightly touched** — to mention `ralph pipeline trace $run_id` as an option for future verification, even though reflector's procedure forbids re-opening the trace today. Out of scope for this fix; flagged for transparency. The current design leaves `memory-reflector.md` unchanged.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — clean.
- Repo-wide grep for `randomUUID\(` — expected: still appears in both `src/attractor/core/engine.ts:142` (now slice-form) and `src/cli/commands/pipeline.ts:286` (unchanged); no new call sites; no leftover full-UUID generator on the run-id path.
- Repo-wide grep for `\$run_id` — expected: 3 categories of consumer enumerated in §6's breaking-change paragraph. No fourth category should appear.
- Repo-wide grep for `runId` in `src/attractor/core/engine.ts` — expected: bind site at line 142 reads `opts.runId ?? randomUUID().slice(0, 8)`; downstream uses (line 143, 144, finalize at line 116) keep the local binding.
- Grep for `~/.ralph/.*runs/.*pipeline\.jsonl` in `.ralph/pipelines/` — expected: zero hits (the prompt rewrites remove the path-shape claim).

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-trace-lookup.test.ts` — 4 cases pass (3 existing + 1 new).
- `npx vitest run src/attractor/tests/` — full engine suite passes; the new optional `runId` field is invisible to existing fixtures.
- `npx vitest run src/cli/tests/pipeline-*-folder.test.ts` — 16 folder-form smoke tests pass.
- `npx vitest run` — entire suite passes.

### 10.3 Smoke

- Run a short bundled pipeline (e.g. `chat-only` if present, else `implement` against a no-op project): `ralph pipeline run <bundled>` then immediately `ralph pipeline trace <8-char-id>` (the id printed in the TUI run header). Expected: trace command exits 0, lists the run's nodes.
- After the same run, open the just-written memory file under `$project/.ralph/sessions/`. Expected: `Learnings from the run` section either populates from real trace data or is omitted per memory-writer's "padding corrodes signal" rule. Either is correct — the load-bearing assertion is that the *capability* exists; absence of struggle in a clean run is healthy.

### 10.4 Negative cases

- **Engine called without CLI** (e.g. a future test that drives `runPipeline` directly without setting `opts.runId`): expected fallback path generates an 8-char id, `context["run_id"]` is set, no crash. Validates the `?? randomUUID().slice(0, 8)` fallback.
- **Hand-supplied `runId` collision** (CLI generates an id that happens to collide with an existing run dir under the same project): no design change, but flagged. The CLI's `gcOldRuns` at `src/cli/commands/pipeline.ts:289-291` does not enforce uniqueness; the existing `--resume` path covers the intentional-collision case at `src/cli/commands/pipeline.ts:295-302`. With ~16M slice-id space and a 50-run cap (`RALPH_RUNS_KEEP` at line 289), accidental collision probability is negligible (~7×10⁻⁵ at full cap), and the smoke test does not need to enumerate it.
- **`ralph pipeline trace <bogus-id>`** under any project: existing case at `src/cli/tests/pipeline-trace-lookup.test.ts:63` already covers this — exits 1 with `no trace found`. The fix does not change that behaviour.

## 11. Summary

`memory-writer` and `memory-reflector` cannot locate `pipeline.jsonl` because the engine and CLI generate `runId` independently — engine's `randomUUID()` at `src/attractor/core/engine.ts:142` (36 chars, written to `context["run_id"]`) and CLI's `randomUUID().slice(0, 8)` at `src/cli/commands/pipeline.ts:286` (8 chars, used for the on-disk dir name) never match. The fix adds an optional `runId?: string` field to `EngineOptions` (`src/attractor/core/engine.ts:20-38`), has the engine accept the injected value (`opts.runId ?? randomUUID().slice(0, 8)`), and has the CLI pass its 8-char id through at the `runPipeline` call site (`src/cli/commands/pipeline.ts:370-381`). Memory-writer's prompt rewrites lines 41 and 51 of `.ralph/pipelines/illumination-to-implementation/memory-writer.md` from a path glob to `ralph pipeline trace $run_id` (and `--node-receive <id>` for per-node slices). Memory-reflector needs no prompt edit — its idempotency key is length-agnostic, and once writer's memory contents stop being trace-blind, reflector's skip-fast logic starts firing as designed. One new assertion in `src/cli/tests/pipeline-trace-lookup.test.ts` pins the public contract: after a run, `ralph pipeline trace $run_id` (using the engine's emitted `$run_id`) exits 0. Five files touched, no flag/schema/contract break, README and ADR set unchanged. Result: a self-reinforcing observability regression becomes a one-token CLI passthrough plus a prompt update.
