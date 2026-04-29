# Agent Output Validation and Retry — Design

**Status:** proposed
**Date:** 2026-04-29
**Related:** `src/attractor/handlers/agent-handler.ts`, `src/cli/lib/agent.ts`, `src/cli/lib/agent-registry.ts`, `src/attractor/core/schemas.ts`, `src/attractor/core/graph.ts`, `src/attractor/tracer/`, `src/cli/commands/pipeline.ts`, `pipelines/illumination-to-implementation/`
**Origin:** `/grill-me` session 2026-04-29 (this spec captures the decisions reached in that session)

## Mission

Close three related gaps that surfaced when the user attempted to run `pipelines/illumination-to-implementation/pipeline.dot`:

1. The verifier agent's structured output silently disappeared. Routing failed because `preferred_label` never landed in the pipeline context. Pipeline halted without firing the human-in-loop approval gate.
2. The `outputs:` frontmatter mechanism shipped in chunk-1 was never wired into the runtime — `agent-handler.ts` only honored the legacy `json_schema_file=` node attribute, ignoring `config.jsonSchema` derived from the agent's own frontmatter.
3. The author had no in-loop way to recover from a malformed agent output. The pipeline simply ended.

The redesign **finishes** the chunk-1 intent (frontmatter `outputs:` is the canonical structured-output mechanism), introduces **self-healing validation retry** for the cheap "fix your formatting" failure class, **persists the failure trail** so authors can debug after the fact, and **rips out** the legacy `json_schema_file=` attribute so the project has one way to express structured output.

## Why

### What broke during the grill

Running `ralph pipeline run pipelines/illumination-to-implementation/pipeline.dot --project . --var ...` produced this trace tail:

```
node-end verifier success:true
contextUpdates: {"agent.iterations":"1","agent.success":"true","agent.sessionId":"..."}
                ^^^ no preferred_label, summary, explanation
pipeline-end outcome:"failure"
```

Diagnosis: the verifier agent emitted its JSON inside a Claude `thinking` block instead of as `text` content. The session log confirmed `content:[{"type":"thinking",...}]`, `stop_reason:"end_turn"`, no `text` block. `agent-handler.ts` had no parse path active because the verifier node carries no `json_schema_file=` — the handler ignored the agent's frontmatter `outputs:`. With `preferred_label` absent from context, none of the three outgoing condition edges (`=true`, `=false`, `=empty`) matched. Pipeline halted, outcome `failure`, no human gate ever surfaced.

### Three failure classes the design must cover

| Class | Concrete example | Today's behavior |
|---|---|---|
| Empty output | Agent emits everything in `thinking` block; `text` content is empty | Handler skips parse path entirely (when no `json_schema_file=`); `agent.success=true`; routing dead |
| Invalid output | Agent emits text but it fails the schema (missing required key, wrong type) | If `json_schema_file=` set: handler returns `status:"fail"` immediately; no retry; pipeline halts. If only `outputs:` in frontmatter: handler doesn't even check |
| Format trap | Model in a "structured output" prompt mode chooses thinking-only response | No defense; happens silently |

The verifier case hit all three at once: empty `text` content on an `outputs:`-only agent that fell into a format trap.

### Why the existing pipeline-level retry is not enough

Today an author can write:
```dot
verifier -> verifier [condition="agent.success=false"]
```
plus `max_retries=N` on the node. This works for *agent-crashed* failures. It does **not** help the verifier case because:

- A blind retry on the same prompt with the same model often hits the same trap.
- The retry has no signal about *what* was wrong with the prior output (no zod errors fed back).
- The retry runs as a fresh claude session — discarding the work the prior attempt already did (in verifier's case: ~73s + ~50 subagent verifications).

The failure class the verifier hit needs **smart retry**: re-invoke the same claude session with a corrective user turn that names the problem. The model already has the verification work in conversation history; it just needs to re-emit the answer in the right content channel.

### Why the legacy `json_schema_file=` attribute is removed

After chunk-1 introduced frontmatter `outputs:`, the project has two parallel mechanisms expressing the same idea (a JSON Schema constraining agent output). The 7 surviving `.json` files in `pipelines/illumination-to-implementation/` all map cleanly onto the YAML fragment shape `outputs:` already supports:

| File | Shape | YAML equivalent |
|---|---|---|
| explainer.json | 1 string | `outputs: { explainer_render: string }` |
| design-writer.json | 1 string | `outputs: { design_doc_path: string }` |
| plan-writer.json | 1 string | `outputs: { plan_path: string }` |
| memory-writer.json | 1 string | `outputs: { memory_path: string }` |
| memory-reflector.json | nullable + string | `outputs: { illumination_path: {type: [string, "null"]}, reasoning: string }` |
| chat-summarizer.json | string + bool | `outputs: { refinements: string, scope_changed: boolean }` |
| tmux-test-result.json | enum + str + array + str | `outputs: { test_result: {enum: [pass, fail]}, test_summary: string, issues_found: {type: array, items: string}, test_render: string }` |

Keeping both mechanisms imposes ongoing dialect drift cost. The migration path is mechanical, all 7 consumers are in-tree, and the resulting "agent = one self-contained .md file" ergonomic is the same goal chunk-1 set.

## Decisions

### D1. Smart retry inside `agent-handler.ts`, not pipeline-level

When agent output is empty or fails schema validation:

- **Retry strategy:** invoke `agent.run({ resume: lastSessionId, message: correctiveMsg })`. Same Claude session, new user turn carries the corrective signal. The model has the prior reasoning in conversation history; corrective message is short.
- **Default cap:** 1 retry (2 attempts total). Per-node override `output_validation_retries=N` accepts any non-negative integer; default is 1.
- **Hard fail on cap exhaustion:** node returns `status:"fail"` with `failureReason` listing each attempt. Engine then sees `agent.success=false` and may re-route via existing condition edges or `max_retries=N` (orthogonal).
- **Verifier prompt fix** (one line append, kept in addition to retry as cheap prevention): "Emit JSON as your final TEXT response. Never inside a thinking block."

**Rejected alternatives:**

- *Pipeline-level dumb retry only* — same prompt, same trap; the empty-output failure mode is exactly what dumb retry cannot heal.
- *Fresh session on retry* — discards the expensive prior work (verifier's ~73s + subagent verifications). Forces re-verification on every retry. Loses cache-hit cost benefits.
- *Higher retry cap as default* — masks prompt bugs as flake. The point of a 2-attempt default is to catch transient model formatting glitches but surface persistent prompt issues loudly.

### D2. Frontmatter `outputs:` is canonical; `json_schema_file=` is removed

- `agent-handler.ts` reads `config.jsonSchema` (derived from frontmatter `outputs:` per `agent.ts:464`) when the node has no `json_schema_file=`. **This is the chunk-1 path being finished.**
- `jsonSchemaFile` field is **deleted** from `AgentNodeSchema` in `src/attractor/core/schemas.ts`. Zod's strict mode rejects the field at parse time with its standard "unrecognized key" diagnostic.
- New validator rule `agent_missing_outputs` fires when a non-interactive agent has no `outputs:` block. Diagnostic message includes the migration recipe inline:
  ```
  Non-interactive agents must declare structured output in frontmatter:
    outputs:
      <key>: <type-or-fragment>
  
  If you previously used `json_schema_file=`, that attribute was removed.
  Move the schema into the agent's outputs: frontmatter.
  ```

**Pure-work agents** (e.g. `implement` — does work, returns no structured data) opt out by declaring `outputs: {}` (empty object). Validator accepts but emits an `agent_outputs_empty` warning so the choice is explicit.

**`interactive=true` agents** stay forbidden from declaring `outputs:` (existing handler restriction at `agent-handler.ts:113-117` is preserved).

**Rejected alternatives:**

- *Soft deprecation of `json_schema_file=`* — keeps dead code in the handler indefinitely; defers the dialect-collapse benefit.
- *Separate `json_schema_file_unsupported` validator rule* — bloats the rule surface for a one-off migration concern. Folded into `agent_missing_outputs` recipe instead.

### D3. Zod schema built from `outputs:` fragment (strict accept-list)

A new helper `src/cli/lib/outputs-to-zod.ts` converts `Record<string, JsonSchemaFragment>` to `z.ZodObject` for runtime validation of parsed agent output.

**Supported fragment shapes** (covers all 7 in-tree schemas plus current verifier usage):

| Shape | YAML form |
|---|---|
| Shorthand type name | `foo: string` / `foo: number` / `foo: boolean` |
| Enum | `foo: {enum: [a, b, c]}` |
| Array of primitives | `foo: {type: array, items: string}` |
| Nullable | `foo: {type: [string, "null"]}` |
| String maxLength | `foo: {type: string, maxLength: 100}` |
| Description (passive, round-tripped) | `foo: {type: string, description: "..."}` |

Anything else throws at agent-load time with a clear message:
```
outputs[foo]: unsupported fragment shape <X>.
Supported: type (string|number|boolean|array), enum, items, maxLength, description, nullable form ([type, "null"]).
```

**All output keys are required.** Optional outputs are intentionally not supported yet — defer to a real use case (YAGNI).

**Rejected alternatives:**

- *Best-effort + fallthrough to `z.any()`* — silent looseness; fields appear validated but are not.
- *JSON-Schema-as-zod via a converter library* — pulls in a dependency we don't need for the small fragment surface we actually use.

### D4. Persistence and observability

Three channels, all on by default, no flags to remember:

1. **TUI live render** — retry attempt opens a new block via the existing `onIterationStart` hook (`pipeline.ts:573`):
   ```
   ━━ [N] verifier · validation retry 1/1 ━━━━━━━━━━
     resuming session b487daf4-...
     corrective: "Your last response had no text content..."
   ```
2. **Per-attempt raw output on disk** — `<runDir>/<nodeId>/raw-attempt-N.txt` written for every attempt regardless of success/failure. Today's bug was partly invisible because raw output is only persisted when `json_schema_file=` is set.
3. **JSONL trace event** — new event kind `validation-failure` per failed attempt:
   ```json
   {"kind":"validation-failure","nodeId":"verifier","attempt":1,
    "errors":[{"path":"preferred_label","message":"Required"}],
    "rawOutputPath":"verifier/raw-attempt-1.txt","timestamp":"..."}
   ```
   `ralph pipeline trace <runId> --node-receive <nodeReceiveId>` is extended to surface validation attempts inline:
   ```
   validation attempts:
     [1] ✗ failed — preferred_label: Required
         raw: verifier/raw-attempt-1.txt
     [2] ✓ valid
   ```

**Rejected alternative:** *Standalone stderr line per failed attempt* — duplicates the TUI block in interactive mode; gets lost in headless+log-redirect anyway. The persistent file + JSONL trace is the forensic record.

### D5. Two-layer retry stack (handler + engine) composes naturally

| Layer | Purpose | Trigger | Defaults |
|---|---|---|---|
| Handler validation retry (D1) | Fix output format / schema | Empty output OR zod fail | 1 retry per attempt |
| Engine retry (existing, unchanged) | Re-run on actual work failure | `agent.success=false` after handler exhausts | 0 retries unless author opts in via `max_retries=N` or self-edge condition |

Worst-case multiplier is bounded by author choices (`output_validation_retries × max_retries`). Default stack adds at most 1 extra attempt over today's behavior.

### D6. `ralph pipeline show` annotated with declared inputs/outputs

Every agent node in the rendered SVG is sublabeled with its declared `inputs:` and `outputs:`. Data-flow edges are labeled with the keys flowing along them (intersection of upstream `outputs:` and downstream `inputs:`). No flag — annotations always on.

This makes the static pipeline graph self-explanatory and is the visualization counterpart to the `agent_missing_outputs` validator rule.

## Mechanism

### Handler control flow (post-redesign)

```
agent-handler.execute(node, ctx)
  ├─ resolve agent → config (inherits config.jsonSchema from outputs: in frontmatter)
  ├─ jsonSchema := node.jsonSchemaFile ? (REMOVED — zod rejects)
  │              : config.jsonSchema       // chunk-1 derived from outputs:
  ├─ if interactive=true → existing branch (no schema, no retry)
  ├─ ATTEMPT 1: agent.run({...})
  │   ├─ raw-attempt-1.txt written
  │   ├─ if jsonSchema set:
  │   │    parse → zod safeParse via outputs-to-zod helper
  │   │    on success → contextUpdates → return success
  │   │    on failure → emit validation-failure JSONL event, log warning
  │   └─ on failure, fall through to retry
  ├─ ATTEMPT 2 (if retries remain): agent.run({ resume: lastSessionId, message: corrective })
  │   ├─ raw-attempt-2.txt written
  │   ├─ same parse + zod cycle
  │   └─ on cap exhausted → return status:"fail" with combined attempts in failureReason
  └─ return Outcome
```

### `agent.ts` resume support

Today's `agent.ts:211` excludes `-p` for resume runs and skips stdin pipe (`agent.ts:249`). The retry path needs to send a new user turn into a resumed session.

Change: when `isResume`, still add `-p` and pipe just `options.message` (not the full system prompt — Claude already has it loaded from the prior session). The new stdin content becomes the next user turn in the existing conversation.

```ts
if (!isInteractive) args.unshift("-p");

if (!isInteractive && child.stdin) {
  const stdinContent = isResume
    ? (options.message ?? "")
    : (options.message
        ? `${expandedPrompt}\n\n${options.message}`
        : expandedPrompt);
  child.stdin.write(stdinContent);
  child.stdin.end();
}
```

### Corrective message shape

Built deterministically by a `buildCorrectiveMessage(rawOutput, zodErrors, schemaJsonString)` helper.

**Empty output case** (verifier scenario):
```
Your previous response had no text content — the response body was empty
(possibly because the JSON ended up inside a thinking block).

Required output schema:
{"type":"object","properties":{"preferred_label":...},"required":[...]}

Re-emit your verdict NOW as a plain TEXT response. JSON only.
Do NOT place the JSON inside a thinking block — emit as text content.
```

**Invalid JSON case**:
```
Your previous response failed schema validation:
  • preferred_label: Required
  • summary: Required

Your previous raw response (first 500 chars):
<<<
{"preferred_label": "true"}
>>>

Required output schema:
{...}

Re-emit valid JSON matching the schema. Plain TEXT response, no thinking block, no markdown fences.
```

## Migration impact

### Files migrated in this redesign

- `pipelines/illumination-to-implementation/explainer.json` → folded into `change-explainer.md` frontmatter; file deleted
- `pipelines/illumination-to-implementation/design-writer.json` → folded into `design-writer.md` frontmatter; file deleted
- `pipelines/illumination-to-implementation/plan-writer.json` → folded into `plan-writer.md` frontmatter; file deleted
- `pipelines/illumination-to-implementation/memory-writer.json` → folded into `memory-writer.md` frontmatter; file deleted
- `pipelines/illumination-to-implementation/memory-reflector.json` → folded into `memory-reflector.md` frontmatter; file deleted
- `pipelines/illumination-to-implementation/chat-summarizer.json` → folded into `task.md` frontmatter (since `chat_summarizer` node uses `agent="task"`); file deleted (or moved into a per-pipeline-folder copy of `task.md` if the global `task` agent should not own this schema)
- `pipelines/illumination-to-implementation/tmux-test-result.json` → folded into `tmux-tester.md` frontmatter; file deleted
- `pipelines/illumination-to-implementation/pipeline.dot` — every `json_schema_file=...` attribute removed
- `pipelines/illumination-to-implementation/implement.md` — declare `outputs: {}` (pure-work opt-out)
- `pipelines/illumination-to-implementation/verifier.md` — append the prompt fix line (kept alongside retry)

### What breaks for external pipelines

Any pipeline outside this repo that uses `json_schema_file=` will fail validation with the recipe-bearing diagnostic at next `ralph pipeline validate`. This is the intended **noisy-fail** posture per D2.

## Deferred work (captured, not in this chunk)

- **`implement` going deep across iterations** — needs a fresh-context handoff mechanism distinct from `--resume`. Memory file: `2026-04-29-implement-going-deep-iteration-handoff-deferred.md`. No solution direction recorded; the design is open and starts from scratch when the chunk is scoped.
- **Annotated `ralph pipeline visualize` for typed dataflow** — beyond what `pipeline show` does in this chunk. Out of scope; revisit if the basic annotations are not enough.
- **Optional outputs** — every output key is required in this chunk (matches current `deriveJsonSchemaString` behavior). Add `?` syntax or `optional: true` only when a real use case appears.

## Open questions resolved during the grill

- **Same vs fresh session for retry?** Same session via `--resume`. The first wrong design (fresh session) was caught when the user pointed out the empty-output case loses all working memory. (Memory: documented in spec; not a separate file.)
- **Where does the warning surface?** TUI block + JSONL trace + per-attempt raw file. No standalone stderr. (D4)
- **Does `pipeline contract` deserve a new command?** No. The contract checks live in `pipeline validate` (already there per chunks 1-2). Visualization lives in `pipeline show` (annotated per D6). User said "I don't like extra flags."
- **Mandatory outputs?** Yes for non-interactive, with `outputs: {}` explicit opt-out for pure-work agents. (D2)
- **Two-layer retry stack?** Yes, composes naturally; defaults bound the worst case. (D5)

## Spec acceptance gate

Before this spec is approved for plan execution:

- [ ] User confirms the migration table (7 schema files → frontmatter) is acceptable in scope
- [ ] User confirms `agent_missing_outputs` is the single rule (no separate `json_schema_file_unsupported`)
- [ ] User confirms `outputs: {}` opt-out for `implement`-style agents is acceptable
- [ ] User confirms two-layer retry stack composes (handler + engine) and the bounded multiplier is acceptable
- [ ] User confirms the deferred items list is complete (going-deep, optional outputs, contract command)
