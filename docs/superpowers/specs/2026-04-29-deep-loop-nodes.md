---
title: Deep Loop Nodes — agent-driven self-termination for long-running agentic loops
status: proposed
date: 2026-04-29
related:
  - docs/superpowers/specs/2026-04-29-agent-output-validation-and-retry.md
  - pipelines/illumination-to-implementation/pipeline.dot
  - pipelines/implement.dot (src/cli/pipelines/implement.dot)
  - src/attractor/handlers/agent-handler.ts
supersedes:
  - "Deferred 'implement going deep — iteration handoff' item in 2026-04-29-agent-output-validation-and-retry.md"
---

# Deep Loop Nodes

## Mission

Replace the manual Ctrl+C as the only stop condition for long-running agentic loops with an agent-driven, structured stop signal. Make "deep loop" a first-class, declarative behavior on agent definitions, so any agent that needs to iterate over a stack of work (an implementation plan, a research backlog, a refactor list) can do so inside a pipeline node without bespoke plumbing per pipeline.

## Background

### Why this matters

`ralph implement` today loops forever. It is a pipeline shim around
`pipelines/implement.dot`:

```dot
run [agent="implement", max_iterations="$max_iterations"]
```

with `--max 0` (default) → `Infinity` → loops until the operator presses Ctrl+C
when the TUI shows "implementation plan finished." That manual eyeball + key
press is the only termination.

The same shape is needed elsewhere: any agent meant to crunch through a list of
work items in fresh-context iterations (research loops, refactor loops,
stimulus-driven authoring loops) currently has no clean way to declare "I'm
done."

### Why fresh context per iteration

The handler already spawns a NEW `claude` process per iteration via
`agent.run()` — each iteration begins with an empty context window. State
handoff from iteration N to iteration N+1 is implicit, via filesystem (the
plan file, git commits, AGENTS.md notes). This is the deliberate alternative
to `--resume`-based iteration, which would balloon context across a
long-running loop.

This spec **supersedes** the "going deep — iteration handoff" deferred item
from the parent spec (`2026-04-29-agent-output-validation-and-retry.md`).

### What's already in place

- Per-iteration loop body in `agent-handler.ts:189` — `for (let i = 0; i < maxIterations; i++)`
- `meta.onIterationStart` / `meta.onIterationEnd` TUI hooks at `agent-handler.ts:194, 211`
- `outputs:` frontmatter on agents (chunk-1 of agent-output-validation, shipped) — declares the structured output schema
- `evaluateAgentOutput` helper (chunk-2 of agent-output-validation, shipped) at `src/attractor/handlers/evaluate-agent-output.ts`
- Validation+retry loop using `--resume` (chunk-2, shipped). NOTE: today this loop runs **once**, AFTER the iteration loop has finished. This spec moves it inside.
- Pipeline routing engine that reads node outputs and matches edge `condition="key=value"` clauses

What is missing is a stop signal the agent itself emits.

### What we are not building

This is **not** a cross-iteration session-resume mechanism. Iteration N+1 sees
a fresh context window. State carry-over is via filesystem by default and via
ONE optional reserved message field (see D4) only when explicitly opted in.

This is **not** a replacement for chunk-2's validation+retry. Validation retry
operates inside a single iteration's session; deep loop operates between
iterations as fresh sessions. The two layers compose orthogonally (D6).

## Decisions

### D1 — Opt-in via `loop: true` in agent frontmatter

A new boolean attribute `loop` lives in agent `.md` frontmatter. When `true`,
the engine treats the node as a deep-loop node and enters per-iteration loop
behavior. Default `false` (one-shot, current behavior).

**Why frontmatter, not a `.dot` node attribute:**

The looping CONTRACT belongs to the agent. The agent's prompt is written
assuming "do one chunk per invocation, emit done when finished." Putting the
toggle on every node call site would duplicate the contract across pipelines
and risk skew.

**Override at node level (escape hatch):** node attribute `loop="false"` can
disable looping for an agent that normally loops. Rare; if a different
behavior is wanted, write a different agent.

### D2 — Stop signal: `done: boolean` field in agent's `outputs:` schema

The agent declares `done: boolean` in its `outputs:` frontmatter and emits
the field on every iteration. The handler parses output AFTER each iteration
(reusing `evaluateAgentOutput` from chunk-2), reads `done`, and breaks the
loop on `done === true`.

```yaml
---
name: implement
loop: true
outputs:
  done: boolean
---
```

**Wire format and accept-list compatibility:**

`outputs-to-zod.ts:8–10` accepts the shorthand `boolean` (not `bool`).
Agent frontmatter must use `done: boolean` verbatim (or the long form
`done: { type: "boolean" }`). The validator (D5) enforces this.

**Coercion policy:** `done: "true"` (string) does NOT auto-coerce to boolean.
zod will reject the iteration's output, chunk-2's validation retry will
trigger inside the iteration's session and ask the model to re-emit. If
retry budget exhausts, the deep loop aborts (D6 failure mode).

**Why generic name `done`, not `plan_complete`:**

Deep loops are not always plan-driven (research loops, refactor loops, etc.).
One generic primitive, many contexts.

**Naming considerations: `done` vs. `complete`:**

Existing pipelines have a literal exit node named `done` (`shape=Msquare`)
in `pipeline.dot` files. The output field `done` and routing condition
`condition="done=true"` live in a different namespace (context key/value
versus node identifier), so no parser collision exists, but readers may have
to swap mental contexts when seeing both in the same file.

The alternative `complete` was considered. `done` is retained because:

1. It is shorter and reads naturally as `if done: break`.
2. The two namespaces (node IDs vs. context keys) are syntactically
   distinct: `-> done` versus `condition="done=true"`.
3. Pipelines name their exit node by convention, not requirement;
   pipelines that want to disambiguate can rename their exit node
   (`exit`, `finish`).

If reader confusion shows up in code review later, a rename is mechanical
and limited to the validator rule + handler accessor + agent frontmatter
files.

### D3 — Cap cascade

`max_iterations` is a safety cap, never the primary control. Resolution:

```
final_cap = node.maxIterations
         ?? agent.maxIterations
         ?? (loop ? Infinity : 1)
```

- **Node-level** (in `.dot`): pipeline tightens or loosens for THIS use.
- **Agent-level** (in frontmatter): agent author's recommended ceiling.
- **Default**: unlimited if `loop: true`; 1 if not (preserves current
  one-shot semantics).

`ralph implement --max N` populates the `max_iterations` variable that the
node references. If `--max` is unset, the variable is empty → fall through
cascade → unlimited (with `loop: true` on the implement agent).

**Backwards compatibility:** today `agent-handler.ts:181-183` maps
`max_iterations=0 → Infinity`. This idiom is preserved; with deep-loop on, an
operator passing `--max 0` now relies on the agent's `done` to terminate, as
intended.

### D4 — Optional iteration handoff: `note: string`

Reserved field `note` in agent `outputs:`, opt-in by declaration. When
declared and emitted, the value is captured by the handler and injected as
variable `$prev_note` into the NEXT iteration's prompt expansion.

```yaml
outputs:
  done: boolean
  note: string         # optional
```

```
# Agent prompt fragment
Last iteration's note (empty on first pass):
$prev_note
```

**Mechanism — explicit per-iteration variable injection:**

Output schema declaration is the same pattern as every other `outputs:` field.
The runtime consumption is **new**: the handler maintains a per-iteration
variable bag that includes `prev_note` from the previous iteration's parsed
output, expanded into the next iteration's prompt before each `agent.run()`
call. Today `agentVariables` is built once before the loop
(`agent-handler.ts:64–69`); this spec moves the variable bag construction
inside the loop body for `loop:true` nodes so `prev_note` reflects the
prior iteration.

On the **first iteration** `$prev_note` expands to the empty string. The
preflight variable check (`scanUndeclaredCallerVars`) must seed `prev_note`
as an always-present default for `loop:true` nodes, otherwise the
"undeclared variable" error fires before runtime.

**Why opt-in via schema declaration, not a new frontmatter knob:**

Same surface area as every other output field. No new frontmatter parser
changes for the opt-in itself; only the per-iteration variable injection
plumbing is new.

**Why replace, not accumulate:**

Only the LAST iteration's note carries forward. Prevents context bloat across
long loops. Agents that need a longer journal use the filesystem.

**Why a single reserved name, not arbitrary keys:**

Keeps the contract clear and the handler logic simple. If multiple distinct
hand-offs are needed, the agent serializes them into the `note` string itself.

**Naming rationale for `note`:**

Chosen for terseness. Authors document the actual semantic (e.g., "remaining
tasks summary") in the agent prompt body. Alternatives `carry_over`,
`iteration_memo`, `progress_note` are wordier without adding clarity.

### D5 — Validator rule: `loop: true` requires `done: boolean` in `outputs:`

`pipeline validate` must reject any agent whose frontmatter declares
`loop: true` without a `done` field of `boolean` shape in `outputs:`.

The check belongs alongside `checkAgentMissingOutputs` in
`src/attractor/core/graph.ts:652`. Error code:
`loop_missing_done_field`. Surfaces with the existing source location
formatting (`file:line:col` + caret).

**Empty outputs collision:** `outputs: {}` (chunk-2's pure-work-agent
opt-out) combined with `loop: true` is rejected with
`loop_missing_done_field` — empty outputs cannot satisfy the deep-loop
contract. The chunk-2 warning `agent_outputs_empty` does not apply here
because the deep-loop error supersedes it (deep loop is the stronger
constraint). The check ordering: deep-loop error fires first, suppressing
the empty-outputs warning for the same node.

**Accept shapes:** `done: boolean` (shorthand) or
`done: { type: "boolean" }` (long form). Strict; no `bool`, no
`Boolean`, no `True/False` enum.

### D6 — Composition with validation retry: handler restructure

Two retry mechanisms exist; they nest cleanly. **This requires moving the
validation+retry block from `agent-handler.ts:218–297` (currently after the
iteration loop) into the body of the iteration loop.**

```
// New nesting (this spec):
for iteration in 1..final_cap:
    session = start fresh claude process
    output = agent.run(session, variables incl. $prev_note)

    # Chunk-2 layer (per iteration):
    while output fails zod schema and validation_attempts < retries:
        output = agent.run(--resume session, corrective_message)
        validation_attempts++

    if output still invalid:
        return failure              # exits deep loop
        # agent.success=false, last error preserved

    # Deep loop layer (this spec):
    capture parsed outputs as last_parsed
    if last_parsed.done === true:
        break                       # normal completion
    if last_parsed.note is declared:
        carry into next iteration's variables as prev_note
    # else continue with FRESH session next iteration

after loop:
    contextUpdates ← last_parsed     # routing engine sees last iteration's outputs
    agent.success ← (loop terminated cleanly via break or cap)
```

**State that must reset per iteration vs. accumulate:**

- Reset per iteration: `validation_attempts`, `lastSessionId` (next iteration
  starts fresh), `agentVariables` (rebuilt to inject `$prev_note`).
- Accumulate across iterations: `iteration` counter (for tracing /
  `agent.iterations` context), `last_parsed` (only the last iteration's
  parsed outputs feed `contextUpdates`).

| Mechanism | Scope | Trigger | Channel |
|---|---|---|---|
| Validation retry (chunk-2) | Within one iteration's session | Output fails zod schema | `--resume <sessionId>` + corrective message |
| Deep loop (this spec) | Between iterations | Agent emits `done=false` (or no done emit but valid) | Fresh process, no resume |

**Failure mode:** if validation retry exhausts within one iteration → abort
deep loop, set `agent.success=false`, exit via failure path. Routing handles
recovery via existing patterns.

**Crash mid-iteration:** if `agent.run()` returns `exitCode !== 0` during a
deep-loop iteration, today the fail-fast at `agent-handler.ts:215` only
fires when `maxIterations === 1`. With deep-loop on, behavior must change:
treat non-zero exit at any iteration as a hard failure (`agent.success=false`,
exit loop). The spec preserves the existing one-shot behavior; deep-loop
adds the "any iteration's crash exits the loop" rule.

**`signal?.aborted` checks** must remain at the iteration loop head
(`agent-handler.ts:181`) AND the validation retry loop head — the existing
checks at the iteration loop are kept; chunk-2's retry loop already checks
abort.

### D7 — Routing engine reads last iteration's `done`

After the loop ends (via break, cap, or failure), the LAST iteration's
parsed outputs become the node's exposed context. Routing engine sees the
`done` value and selects the matching edge:

```dot
deep_node -> next_step  [condition="done=true"]
deep_node -> escalate   [condition="done=false"]
```

**Why the same field for inner break and outer route:**

Single source of truth. No parallel signals to keep in sync. A node that ran
to cap without self-terminating is naturally distinguishable from one that
self-terminated — the last iteration's `done` field tells the story.

### D8 — Three message channels, three jobs

| Channel | Sender | Reader | Scope | When |
|---|---|---|---|---|
| `done` | Agent (each iteration) | Handler (break) + routing engine (edge condition) | Stop signal + outer route | Always emitted on each iteration |
| `note` (`$prev_note`) | Agent (iteration N) | Same agent (iteration N+1) | Cross-iteration self-talk | Optional; only when declared in outputs |
| `$reviewer_message` | Verifier node | Implement node next entry | Outer-loop verifier feedback | Optional pattern; pipeline-level, not part of this spec's runtime |

The `$reviewer_message` channel is a pipeline composition pattern. It uses
existing variable expansion + a verifier node that emits its own outputs.
This spec ships only the runtime support for `done` and `$prev_note`. The
verifier loop pattern is documented for completeness but requires no new
runtime code.

## Files affected

| File | Change |
|---|---|
| `src/attractor/core/schemas.ts` | Add `loop?: z.coerce.boolean()` (default false) to agent-frontmatter shape; add `maxIterations?: z.coerce.number().int().nonnegative().optional()` to the same shape (D3 cascade). |
| `src/cli/lib/agent.ts` | Add `loop?: boolean` and `maxIterations?: number` to `AgentConfig` (`agent.ts:48–59`); plumb through `validateAgentConfig` (`agent.ts:459`). |
| `src/cli/lib/agent-registry.ts` | `parseAgentFile` (line 41) passes the new fields through into `AgentConfig`. |
| `src/cli/lib/outputs-to-zod.ts` | No change required — `boolean` (shorthand) and `string` are already accepted by the strict accept-list (chunk-1). |
| `src/attractor/handlers/agent-handler.ts` | (a) Compute final cap via D3 cascade, replacing the current parse at lines 177–183. (b) Move the validation+retry block (lines 218–297) into the iteration loop body. (c) After each iteration's evaluator returns valid, read `done` and break on true. (d) Capture `note` field; rebuild `agentVariables` for the next iteration to include `prev_note`. (e) Expose last iteration's `parsed` as `contextUpdates`. (f) Treat non-zero exit at any iteration as hard failure (drop the `maxIterations === 1` guard). |
| `src/attractor/core/graph.ts` | Add `checkLoopRequiresDoneField` rule alongside `checkAgentMissingOutputs` (line 652). Suppresses `agent_outputs_empty` warning on the same node when fired. |
| `src/attractor/core/preflight.ts` (or wherever `scanUndeclaredCallerVars` lives) | Seed `prev_note` as an always-present default for nodes whose agent declares `note` in outputs. |
| `pipelines/illumination-to-implementation/implement.md` | Replace `outputs: {}` with `outputs: { done: boolean }`. Add `loop: true`. Update prompt to instruct emitting `done` after each chunk. |
| `pipelines/implement.dot` (`src/cli/pipelines/implement.dot`) | Optionally drop `max_iterations="$max_iterations"` since the agent default + `--max` fallback handles this; keep the explicit cap path for `--max N` users. |
| `src/cli/commands/implement.ts` | No behavior change needed — `--max` continues to wire to the variable. |
| `README.md` | New short section: "Deep loop nodes — authoring guide." |
| Tests | Frontmatter parser, handler per-iteration done check, cap cascade, validator rule, `$prev_note` injection, crash mid-iteration, malformed `done` (chunk-2 retry), empty outputs + `loop:true` rejection. |

## Migration

Two implement agent files exist:

1. `pipelines/illumination-to-implementation/implement.md` — used by the bigger pipeline.
2. The bundled implement agent (sourced from this same file via per-folder resolver, after chunk-4 of pipeline-folder redesign).

Both must gain `loop: true` and a `done` emit instruction in the same chunk
that ships the runtime change. Otherwise the validator catches it (D5).

No other in-tree agents currently need looping. Future loop agents follow the
declared contract.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agent emits `done=true` falsely → premature exit with incomplete plan | Trust + downstream verification: `review_gate` in the bigger pipeline; for `ralph implement` standalone, user sees TUI output and re-runs. Lying agents leave incomplete commits — auditable. Optional pattern: a `plan_verifier` node reads the plan, emits its own `done` to the routing engine, loops back if false. |
| Per-iteration parse adds cost vs. once-after-loop | Cost is identical to chunk-2's validation retry path; we reuse `evaluateAgentOutput`. No new parse infrastructure. |
| Agent never emits `done`, never validates (e.g., `done` field missing) | Validator (D5) rejects at `pipeline validate`; chunk-2 retry handles missing field at runtime via corrective message. |
| Compound unboundedness: `final_cap=Infinity × output_validation_retries=N` is unbounded in two dimensions | Keep `output_validation_retries` default at 1. Document the compound shape in the README authoring guide. With well-behaved agents this is desired (autonomy); with a misbehaving model the operator falls back to Ctrl+C. `signal?.aborted` checks at both loop heads make Ctrl+C still effective. |
| User confusion: `--max 0` historically meant "unlimited but loops forever" → now means "unlimited with auto-stop" | Behavior changes ONLY in the direction of "now actually stops when agent says done." Existing scripts that relied on Ctrl+C still work. README note in the migration chunk. |
| `$prev_note` becomes dumping ground | Reserved single-string field. Replace-on-emit semantics. No accumulation in handler. Agent authors who abuse it pay the prompt-size cost themselves. |
| First-iteration `$prev_note` triggers undeclared-variable preflight error | Preflight seeds `prev_note` as always-present default for nodes whose agent declares it in outputs. Spec'd in Files affected. |
| Validator rule false positive (`loop:true` agent that legitimately doesn't need a `done` field) | None envisaged — `done` is the contract. If a valid use case appears, document it as a follow-up exception, not a default. |
| `done` collides visually with Msquare exit nodes named `done` | Different namespaces (node ID vs. context key). Document in D2 naming considerations. Mechanical rename available if reader confusion surfaces. |
| Crash mid-iteration in deep loop | Treat non-zero exit at any iteration as hard failure; loop exits with `agent.success=false`. Recovery via existing failure-edge patterns. |

## Alternatives considered

| Option | Why rejected |
|---|---|
| Sentinel file the agent writes (`.ralph/<run>/done`) | Out-of-band channel; second source of truth; doesn't compose with routing-engine condition checks. |
| Magic exit code (`exit 42`) | Conflates control flow with shell exit semantics; brittle. |
| Built-in MCP tool `mcp__ralph__mark_complete` | Adds a tool dependency for a one-bit signal already representable in JSON output. |
| Implicit loop mode from `outputs:` containing `done` | Hides a major control-flow decision in agent metadata; no explicit per-agent toggle. |
| Per-node `loop="true"` attribute (no agent frontmatter version) | Forces every pipeline using a loopy agent to redeclare; risk of skew; agent contract belongs with agent. |
| Cumulative `note` (accumulate across iterations) | Context bloat; agent has filesystem for journals. Replace-on-emit chosen. |
| Field name `complete` instead of `done` | `done` is shorter, reads naturally; namespaces distinct from node IDs. Rename available if reader confusion surfaces. |

## Out of scope

- Cross-iteration session continuity (`--resume` for going deep). Explicitly rejected — the whole point is fresh context per iteration.
- A new TUI surface for iteration progress beyond the existing `onIterationStart`/`onIterationEnd` block hooks.
- Verifier loop pattern documentation as runtime feature — it's a composition pattern using existing primitives, surfaced in user docs only.
- Multi-iteration carry-over fields beyond the single reserved `note`. If demand surfaces, add as a follow-up.

## Acceptance

Functional:

- [ ] A new agent declares `loop: true` + `outputs: { done: boolean }`. A pipeline node referencing that agent loops fresh-context iterations until the agent emits `done=true` or cap is hit.
- [ ] `ralph implement` auto-stops when the implementer emits `done=true`. No Ctrl+C required.
- [ ] `pipeline validate` errors on `loop:true` agents lacking `done: boolean`.
- [ ] `pipeline validate` errors on `loop:true` + `outputs: {}` with `loop_missing_done_field` (suppressing `agent_outputs_empty`).

Test scenarios (must pass before ship):

- [ ] Agent emits `done=true` on iteration 3 of `final_cap=10` → loop breaks at 3; `agent.iterations` context = 3; `done=true` exposed downstream.
- [ ] Agent emits `done=false` until cap hit → last iteration's `done=false` exposed downstream; routing can branch on it.
- [ ] Agent emits malformed `done: "true"` (string) → chunk-2 validation retry triggers within the iteration; if it eventually emits `done: true` (boolean), loop breaks; if retry budget exhausts, deep loop aborts with `agent.success=false`.
- [ ] Agent emits valid output without `done` field → chunk-2 retry triggers (schema mismatch); same outcomes as malformed case.
- [ ] Agent crashes (non-zero exit) on iteration 2 of `final_cap=5` → loop exits, `agent.success=false`, failure edge taken.
- [ ] `loop: false` agent (default) — current single-shot behavior preserved exactly.
- [ ] `loop: true` + `final_cap=0` (operator typo) → maps to `Infinity` per existing `0 → Infinity` idiom; loop terminates only via agent's `done` or signal abort.
- [ ] `$prev_note` undefined on first iteration expands to empty string (no preflight error, no runtime error).
- [ ] `$prev_note` from iteration N is visible in iteration N+1's prompt; replaced (not accumulated) by iteration N+1's emit.
- [ ] Compound retry: `final_cap=3 × output_validation_retries=2` with one validation failure on iteration 2 → up to 6 agent invocations total; assert exact count.
- [ ] Cascade: node `max_iterations=5` overrides agent `maxIterations=20`; agent `maxIterations=20` overrides the `loop:true` default of `Infinity`.

Documentation:

- [ ] README has a short "Deep loop nodes" section with the authoring guide (frontmatter shape, `done` contract, optional `note`).
- [ ] At least one in-tree agent (`pipelines/illumination-to-implementation/implement.md`) is migrated end-to-end as the canonical example.
