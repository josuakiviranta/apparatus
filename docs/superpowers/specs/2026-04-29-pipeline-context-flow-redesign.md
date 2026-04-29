# Pipeline Context-Flow Redesign — Design

**Status:** implemented
**Date:** 2026-04-29
**Related:** `src/attractor/handlers/agent-handler.ts`, `src/attractor/transforms/variable-expansion.ts`, `src/attractor/core/graph.ts`, `src/attractor/core/schemas.ts`, `src/cli/lib/agent-registry.ts`, `src/cli/lib/frontmatter.ts`, `pipelines/illumination-to-implementation/`, `pipelines/janitor/`, `pipelines/smoke/*/`
**Origin:** `/grill-me` session 2026-04-29 (architectural decisions captured below)

## Mission

Replace the current `prompt=`-as-var-carrier model with **agent-frontmatter-as-contract**: every agent declares its `inputs:` and `outputs:`, the engine auto-injects an unambiguous **Inputs** block at runtime, and pipeline `prompt=` shrinks to optional per-call **Steering**. Outputs are namespaced by node id to eliminate collisions. The validator gains per-path flow checking against contracts so context-flow gaps surface at `pipeline validate`, not at runtime.

Net effect: pipeline `.dot` files lose most of their inline prompts, agent `.md` files own their procedure end-to-end, and the validator becomes the type-checker for inter-node data flow.

## Why

### Today's friction (observed during illumination-to-implementation walkthrough)

Pipeline `prompt=` attributes carry three different roles in one string:

1. **Variable injection.** Authors write `$illumination_path` etc. so the engine can substitute live values from `ctx.values` before the LLM call.
2. **Procedure.** Same string repeats the agent's procedure — "do step 1, do step 2, return JSON" — already documented in the agent `.md` body.
3. **Per-call steering.** Pipeline-specific overrides like "for this node, only run the smoke phase" or "this is the loop-back pass."

Because all three roles live in one place, every pipeline node ends up with a 2–6 line inline prompt that duplicates ~70% of the agent file's body. Concrete sample (from `pipelines/illumination-to-implementation/pipeline.dot:42`):

> `tmux_tester [agent="tmux-tester", prompt="Open (or reuse) a tmux window named test-$run_id ... drive it through build/test/smoke cycles. When a cycle surfaces a fixable issue, apply a red/green TDD fix in-session and commit it (no push — commit_push handles that). Repeat cycles until the project is healthy ... Follow your agent-level procedure and harness helpers. Stop based on context, not a counter. Emit the structured JSON ..."]`

The above is 90% verbatim copy of `tmux-tester.md` Phases 1–4 + Hard rules. The only genuinely pipeline-specific content is the smoke-phase spec (which itself belongs in the agent file under Phase 2). The rest is duplication.

### What the validator can already do, and where it falls short

Two existing rules:

- `scanUndeclaredCallerVars` (`src/attractor/transforms/variable-expansion.ts:247`) — scans `$var` tokens in pipeline `prompt=` text and agent body. Existence check: "is `foo` produced by some node OR caller-provided OR declared in `inputs=`?"
- `missing_input_producer` (`src/attractor/core/graph.ts`, tested in `graph-inputs-flow.test.ts`) — for every consumer's frontmatter `inputs:` declaration, walks every path back to start: "does at least one upstream node produce this input on every path?"

The strong per-path check (`missing_input_producer`) only fires when an agent declares `inputs:` in frontmatter. Today many agents don't (e.g. `tmux-tester.md` has `outputs:` but no `inputs:`). So the strongest validator pass is silently skipped for those agents.

The redesign makes `inputs:` mandatory and routes all data through it, unlocking per-path validation across the entire pipeline.

### What the user named during grilling

- **Vars are the context-flow plumbing.** "If pipeline node does not get any inputs what should happen ... could validator catch errors like that some node says it gets some input but the upstream node does not give it as an output?"
- **Cognitive load on agent authors.** "I would every agent node to stay simple to understand for user and not having complicated templating if just possible. If there are a lot of rules user who creates a new agent can easily forget what all the features to add for agent would be."
- **Bullet-list structural confusion.** "If big prompts get injected to agent with bulletpoints agent might lose track where the bullet points continue."
- **Naming muddy.** "vars does not tell from me as a human that they pass context between agent nodes? Should these be renamed more intuitively?"
- **Auto-inject preference.** "Why not just inject context variable as inputs to agent instructions and keep prompt optional pipeline level steering?"

## Decisions

The grilling produced nine decisions, each picked deliberately for clarity and validator power over conceptual flexibility.

### D1. Agent frontmatter `inputs:` becomes mandatory contract

Once an agent opts into the new system (D9 — gated by `auto_inputs: true` during transition), the agent `.md` file MUST declare `inputs:` in frontmatter, listing every input it expects. The contract is universally mandatory once the cleanup PR removes the legacy code path. Caller-provided keys (`project`, `run_id`) and node-produced keys (`verifier.summary`) both get listed.

```yaml
---
name: explainer
description: Render before/after for verified illumination
inputs:
  - verifier.summary
  - verifier.explanation
  - verifier.illumination_path
  - refinements
outputs:
  explainer_render: string
---
```

`inputs:` is required; an empty list (`inputs: []`) is the explicit form for "I take no inputs."

**Rationale:** unlocks per-path flow validation (Layer 2) for every agent. Agent declares contract, validator enforces.

### D2. Strict namespacing of outputs by node id

When a node produces an output declared in its agent's `outputs:`, the engine writes it to `ctx.values` under the qualified key `<nodeId>.<outputKey>`. Caller-provided and system-injected keys remain bare (no prefix).

```
ctx.values after a few nodes have run:
{
  project: "/repo",                              // bare (caller --var)
  run_id: "abc-123",                             // bare (caller --var)
  ILLUMINATION_SERVER_PATH: "/path/to/...",      // bare (system auto-inject)
  verifier.summary: "...",                       // qualified (verifier produced)
  verifier.explanation: "...",                   // qualified
  explainer.explainer_render: "...",             // qualified
}
```

Two nodes producing same local key (e.g. `verifier.summary` and `chat_summarizer.summary`) coexist without overwrite because their qualified keys differ. Loop-backs (same node running twice) overwrite the same qualified key — exactly the desired behavior.

**Rationale:** zero accidental collisions, explicit data lineage, validator can pinpoint dangling references with precise messages ("`explainer.foo` declared but `explainer` doesn't produce `foo`").

### D3. Always-qualified rendering with underscore swap

In the rendered Inputs block, qualified keys appear with the dot replaced by underscore (XML doesn't permit dots in tag names):

```
ctx.values["verifier.summary"]   →  rendered as <verifier_summary>...</verifier_summary>
ctx.values["project"]             →  rendered as <project>...</project>
```

Agent body documentation uses the same form when referring to inputs:

```markdown
You render an explainer for the illumination at $verifier_illumination_path.
Use $verifier_summary as the headline anchor.
```

**Rationale:** total ambiguity elimination. Reader sees `$verifier_summary` and instantly knows the source. No alias collisions possible.

### D4. XML tags for the Inputs block

The auto-rendered Inputs section uses XML tags (one tag per declared input) rather than markdown bullets, key=value lines, or YAML.

```
## Inputs

<verifier_summary>The auth bug lives in middleware/token.ts...</verifier_summary>
<verifier_explanation>
## Technical detail

The check uses `<` not `<=` causing valid tokens to fail at boundary moments.
</verifier_explanation>
<refinements></refinements>
<run_id>abc-123</run_id>
```

**Rationale:** unambiguous boundaries even when values contain markdown headers, code fences, colons, or other special characters. Anthropic's recommended pattern for structured input. LLM-friendly. Author-transparent (engine renders; author never types tags).

### D5. Section order: instructions → inputs → steering

The assembled prompt the LLM receives:

```
[Agent instructions — the markdown body of the .md file]
   - Mission
   - Procedure
   - Output schema / rules
---
## Inputs
<key>value</key>
...

## Steering          (optional, only if pipeline prompt= is set)
[free-form prose, per-call instruction]
```

**Rationale:** instructions establish role + procedure (primacy). Inputs sit after, where the procedure can refer back to them. Steering goes last (recency) so per-call overrides have maximum LLM weight.

### D6. Steering is pure prose — no `$var` substitution

Pipeline `prompt=` is reserved for optional per-call instruction. The engine does NOT substitute `$var` tokens in steering text. Anything that would be a `$var` should be declared as an input in the consumer agent's frontmatter and will appear in the auto-rendered Inputs block.

```dot
# Good: pure prose steering
implement [agent="implement",
           prompt="This iteration, focus only on chunk 3 of the plan."]

# Bad (will not substitute under new system):
implement [agent="implement",
           prompt="Focus on $current_chunk."]
# Use this instead: declare current_chunk as input in implement.md frontmatter,
# the value lands in <current_chunk> tag in the Inputs block, agent reads it.
```

**Rationale:** one rule for var injection (Inputs block, automatic). Steering is just words. No two-modal complexity. Validator stops scanning steering text for var references entirely.

### D7. Terminology: "agent instructions" replaces "rubric"

The markdown body of an agent `.md` file is called **agent instructions**, not "rubric." Variable rename in source code: `agentRubric` → `agentInstructions` in `agent-handler.ts:80`.

**Rationale:** "rubric" is overloaded with LLM-judge scoring criteria in industry vocabulary. "Agent instructions" matches Anthropic/OpenAI/LangChain conventions. User explicitly flagged confusion during grilling.

### D8. `default_*=` stays on the consumer node, not in agent frontmatter

Optional inputs are marked at the pipeline-node level via `default_<input>=` attributes, not in the agent file's frontmatter. Same agent might be required-input in one pipeline and optional-with-default in another.

```dot
# Pipeline declares: chat_summarizer's "refinements" input is optional, fallback to ""
chat_summarizer [agent="chat-summarizer",
                 default_refinements="",
                 default_test_result=""]
```

The engine resolves consumer inputs in this priority order, branching by whether the declared input name is qualified or bare:

For a **qualified** input (e.g. `verifier.summary`):

1. `ctx.values["verifier.summary"]` (real upstream output) — highest priority
2. Node attribute `default_summary=` (key after the dot, per-pipeline fallback)
3. Fail (validator should have caught this at validate time)

For a **bare** input (e.g. `project`):

1. `ctx.values["project"]` (caller-provided or system-injected) — highest priority
2. Node attribute `default_project=` (per-pipeline fallback)
3. Fail (validator should have caught this at validate time)

**Rationale:** optionality is a per-pipeline-use property, not a per-agent property. Validator already knows about `default_*` attrs.

### D9. Phased migration, engine-gated

The new system ships in one engine PR (gated by an opt-in marker on the agent file or pipeline). Existing pipelines continue working with the legacy `$var`-in-prompt behavior. Pipelines migrate one folder at a time, each in its own PR with green tests + smokes. Once all in-tree pipelines are migrated, a final cleanup PR drops the legacy code path.

Migration order: `illumination-to-implementation/` first (most complex; highest risk if redesign has gaps), then `janitor/`, then each smoke pipeline in alphabetical order.

**Rationale:** atomic per-pipeline blast radius, easy rollback per migration, no half-state inside any single pipeline. Matches the codebase's existing chunked-PR culture.

## Mechanics

### Prompt assembly under the new system

`agent-handler.ts` constructs the prompt sent to the LLM in this order:

```
1. Read agent's instructions (config.prompt, the markdown body, treated as literal docs)
2. Render Inputs block:
     a. For each name in agent.frontmatter.inputs:
          - If qualified (contains `.`): look up ctx.values[name].
            If missing AND consumer node has default_<localKey>= attr: use that.
            If still missing: validator should have caught; runtime errors.
          - If bare: look up ctx.values[name].
            If missing AND consumer node has default_<name>= attr: use that.
            If still missing: validator should have caught; runtime errors.
     b. Format each input as <renderedTag>value</renderedTag>
        where renderedTag = name.replace('.', '_')
3. Render Steering block (only if node.prompt is non-empty):
     a. Treat as literal prose; no var substitution.
4. Glue with separators:
     <agent instructions>

     ---

     ## Inputs

     <renderedTags>

     ## Steering    (only emitted when node.prompt is non-empty)

     <prose>
```

The runtime stores its produced outputs into `ctx.values` under qualified keys:

```typescript
// After agent emits structured JSON: { summary: "...", explanation: "..." }
// And agent's frontmatter outputs: { summary, explanation }
// Engine writes:
ctx.values[`${nodeId}.summary`] = "...";
ctx.values[`${nodeId}.explanation`] = "...";
```

### Validator behavior

The validator walks the graph at `pipeline validate` (and again before run, via preflight) to enforce:

| Rule | Severity | Message form |
|---|---|---|
| `missing_input_producer` (existing, generalized) | error | "Input `X` declared by `consumer` has no producer on path `start → … → consumer`" |
| `unknown_source_node` (new) | error | "Input `verifier.summary` references node `verifier` which does not exist" |
| `source_missing_output_key` (new) | error | "Input `verifier.foo` references key `foo` which `verifier` does not declare in `outputs:`" |
| `bare_input_not_in_caller_inputs_or_system` (new) | error | "Input `foo` is not qualified, not declared in caller `inputs=`, and not a system var" |
| `steering_has_var_token` (new) | error | "Steering text contains `$X` — under auto_inputs, steering is pure prose; declare `X` as an input or rephrase" |
| `inputs_missing_frontmatter` (new) | error | "Agent `verifier.md` is missing required `inputs:` declaration. Use `inputs: []` if no inputs are needed" |
| `rendered_tag_collision` (new) | error | "Input `verifier.summary` renders as `<verifier_summary>`, which collides with bare input `verifier_summary` declared in the same agent. Rename or remove one." |
| `output_collision` (relaxed under D2) | n/a | namespacing eliminates the collision class entirely; no rule needed |

`steering_has_var_token` is an **error** under the new system, not a warning. An unsubstituted `$X` in steering would reach the LLM verbatim — a silent bug. Authors who want a value in steering should declare it as an input in frontmatter (it lands in the Inputs block). During the transition (legacy agents without `auto_inputs: true`), this rule is suppressed because the legacy path still substitutes.

### Interaction with existing features

- **Loops:** unchanged. Same node running twice overwrites its own qualified outputs (`verifier.summary` updates each iteration).
- **Self-input pattern (loop-back accumulator):** an agent that consumes its OWN qualified output to read prior iterations' state (e.g. `chat_summarizer.md` declares `inputs: [chat_summarizer.refinements]` so each round can append to the prior log). The validator's `missing_input_producer` rule would normally fire (the source node IS the consumer; no upstream producer on the start→consumer path). The accepted resolution is: declare `default_<localKey>=""` on the consumer node in `pipeline.dot`. This satisfies the validator's "default fallback exempts per-path check" branch (D8). On first iteration the default is used; on later iterations the prior run's qualified output is consumed. Validator MUST permit self-input declarations when the corresponding default attr exists on the consumer node.
- **Tool nodes (`type="tool"`):** continue to use `produces_from_stdout="<key>"`. The captured stdout writes to `ctx.values["<nodeId>.<key>"]` (qualified), consistent with agent nodes. Tool nodes don't have agent frontmatter, so their declared output is the `produces_from_stdout` attr alone. **Consumers reference tool-node outputs the same way as agent-node outputs** — qualified `<toolNodeId>.<key>` in their `inputs:` declaration. Validator's `unknown_source_node` and `source_missing_output_key` rules apply identically (the producer of `<toolNodeId>.<key>` is the tool node's `produces_from_stdout` attr).
- **Gates:** gates do not produce outputs and do not receive an auto-Inputs prepended block. Gates may declare a bare `inputs:` array in frontmatter listing every variable their prompt body interpolates (e.g., `$summary`, `$illumination_path`); this is solely for validator coverage. Gate prompt bodies stay text-only — no procedure, no agent rubric. Gates keep their existing label-based decision UI; the `inputs:` declaration only governs prompt-template substitution.
- **Interactive nodes (`interactive=true`):** still get their session digest written to `ctx.values["<nodeId>.output"]`, `["<nodeId>.success"]`, etc. — these become qualified keys consistent with D2.
- **Caller `inputs=` graph attribute:** unchanged. Lists the bare keys the caller will provide via `--var`.
- **System auto-injected vars** (`ILLUMINATION_SERVER_PATH`, `PROJECT_ROOT`, `META_MEDITATIONS_DIR`): continue to live in `ctx.values` as bare keys. Consumer agents that need them list them bare in `inputs:`.
- **`default_*=` attributes:** continue to work; resolution priority order documented in D8.

## Migration

### Engine gate mechanism

The engine reads a per-agent flag to decide which assembly path to use:

```yaml
---
name: verifier
auto_inputs: true       # opt-in to new system
inputs:
  - illumination_path
outputs:
  ...
---
```

When `auto_inputs: true`:

- Engine renders the Inputs block automatically from frontmatter `inputs:`.
- Engine ignores `$var` tokens in pipeline `prompt=` (pure-prose steering only).
- Validator applies the new rule set (D1, D2, D3, plus the new validator rules above).

When absent / false (legacy):

- Engine uses today's `expandVariables` path on `prompt=`.
- Validator applies today's rules unchanged.

This flag is the migration switch. Once every in-tree agent has `auto_inputs: true`, the legacy code path is removed.

### Migration order

1. **Engine PR:** add `auto_inputs` flag, new assembly path, new validator rules. No agent files touched yet. All existing tests pass; new tests cover the new path on synthetic agent files.
2. **`pipelines/illumination-to-implementation/`** (most complex): migrate every agent + the `.dot` file in one PR. Tests + smokes green.
3. **`pipelines/janitor/`**: migrate.
4. **Each `pipelines/smoke/<name>/`** in alphabetical order: migrate per pipeline, one PR each.
5. **Cleanup PR:** drop the legacy `expandVariables` path, drop the `auto_inputs` flag (every agent now has it; flag is dead weight), drop legacy validator rule branches.

Each migration PR follows the same pattern:

- For each agent `.md` in the folder:
  - Add `auto_inputs: true` to frontmatter
  - Add or expand `inputs:` declaration
  - If agent body has `$var` references that were documentation, update them to qualified form (`$verifier_summary` etc.)
  - If agent body has duplicated procedure that used to live in pipeline `prompt=`, absorb the unique parts (e.g. tmux-tester's smoke spec)
- For the pipeline `.dot` file:
  - Drop or shrink each node's `prompt=` to optional steering
  - For nodes consuming outputs, ensure `inputs:` declarations are qualified (`verifier.summary` not `summary`)
  - Run `ralph pipeline validate` — fix any flow gaps surfaced

### Backward compatibility window

During the transition (after engine PR ships, before all pipelines migrate):

- Every existing pipeline keeps working.
- New pipelines authored against the new system from day one.
- Mixed-mode pipelines (some agents `auto_inputs: true`, some legacy) work but are unusual; validator emits info-level note when detected.

### Rollback procedure per migration PR

Each pipeline-migration PR is independently revertable:

1. The PR touches files only inside `pipelines/<name>/` (agent `.md` files, `pipeline.dot`, tests). The engine PR is not modified.
2. To roll back: `git revert <pr-merge-sha>`. The legacy `expandVariables` path remains in the engine until cleanup; reverted agents lose their `auto_inputs: true` flag and resume legacy behavior.
3. Smokes for that pipeline must be green before merge. If a regression slips through, revert immediately and re-attempt migration in a follow-up PR with the smoke that should have caught it.

## Out of scope

The following are NOT part of this redesign and explicitly preserved as-is:

- The `.dot` graph syntax itself (nodes, edges, conditions, labels).
- Tool node mechanics (`script_file=`, `produces_from_stdout=`, `cwd=`).
- Gate node mechanics (label-based UI, choice namespacing).
- Interactive node digest capture (`session.output`, etc., now qualified).
- Caller `inputs=` graph attribute and `--var` CLI flag.
- Checkpoint format on disk (still `checkpoint.json`; key names just become qualified).
- Trace JSONL format (`pipeline.jsonl`).
- Agent registry / per-folder layout (already shipped).
- MCP integration in agent frontmatter.
- Loop semantics, retry semantics, gate cascade rules.
- The `produces_from_stdout` mechanism on tool nodes.

These can be revisited in future specs but are stable surfaces for this work.

## Appendix: Concrete before/after

### Before (today's `pipelines/illumination-to-implementation/pipeline.dot`, verifier node)

```dot
verifier [agent="verifier",
          default_refinements="",
          default_illumination_path="",
          prompt="Step 1: Call mcp__illumination__list_illuminations with status: open
to get the list of open illuminations to consider. Step 2: If refinements
are non-empty, re-verify the previously chosen illumination
($illumination_path) against the REFINED scope. Otherwise, pick ONE
open illumination to verify against the current ralph-cli codebase.

Follow your agent-level rubric (relevance + technical accuracy +
project-fit / Feature-Creep) and procedure. Project root for README and
specs lookup is the current working directory.

Refinements (cumulative; empty on first pass):
$refinements

If refinements are non-empty, this is a loop-back pass after a chat
round — re-verify against the REFINED scope, not the original
illumination text. Full chat record (read for full context if helpful):
$illuminations_dir/.triage/$run_id/chat-notes.md

Return the structured verdict only — no prose preamble."]
```

`verifier.md` body has the procedure but the pipeline duplicates ~80% of it.

### After

```dot
verifier [agent="verifier",
          default_refinements="",
          default_illumination_path=""]
```

`verifier.md` frontmatter:

```yaml
---
name: verifier
description: Read-only verification of illuminations against current code, specs, and project goals
auto_inputs: true
inputs:
  - illuminations_dir
  - illumination_path
  - refinements
  - run_id
outputs:                                # schema format unchanged from today; see src/cli/lib/outputs-to-zod.ts
  preferred_label: { enum: ["true", "false", empty] }
  illumination_path: string
  summary: string
  explanation: string
  archive_reason_short: { type: string, maxLength: 100 }
model: opus
permissionMode: dangerouslySkipPermissions
tools:
  - Read
  - Grep
  - Glob
  - Task
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
---
```

`verifier.md` body (instructions) — unchanged structurally; the procedure absorbs what used to live in pipeline `prompt=`:

```markdown
# Mission

You verify illuminations against the current ralph-cli codebase.

## Mode (decided by inputs)

- $refinements empty → **fresh pass**: call `mcp__illumination__list_illuminations`
  with status: open, then pick one illumination to verify against the codebase.
- $refinements non-empty → **re-verify pass**: re-check $illumination_path against
  the refined scope. For full chat context, read
  `$illuminations_dir/.triage/$run_id/chat-notes.md`.

Follow the relevance + technical accuracy + project-fit rubric below. Project root
is the current working directory.

## Procedure

[…unchanged from today…]

## Output

Return the structured verdict matching the schema; no prose preamble.
```

### What the LLM receives at runtime

```
# Mission
[full agent instructions, markdown body, including procedure and output schema]

---

## Inputs

<illuminations_dir>meditations/illuminations</illuminations_dir>
<illumination_path>meditations/illuminations/2026-04-29-auth-bug.md</illumination_path>
<refinements></refinements>
<run_id>abc-123</run_id>

## Steering

(empty — no per-call override on this node)
```

When chat-loop comes back, `$refinements` is non-empty:

```
[same agent instructions]

---

## Inputs

<illuminations_dir>meditations/illuminations</illuminations_dir>
<illumination_path>meditations/illuminations/2026-04-29-auth-bug.md</illumination_path>
<refinements>
- Skip the migration concerns; user clarified those are out of scope.
  - Round: 1
  - Topic raised by user: "the migration part is overkill"
  - Rationale: existing data is small enough to recreate by hand
</refinements>
<run_id>abc-123</run_id>

## Steering

(empty)
```

Agent reads `<refinements>` is non-empty → enters re-verify branch per its instructions.

### Pipeline file size win

`pipelines/illumination-to-implementation/pipeline.dot` today is ~100 lines. After migration, expect ~50 lines (most inline `prompt=` blocks dropped or shrunk to 1 line of steering). Same logical content, half the bytes, zero duplication with agent files.

### Canonical empty-inputs example

For an agent that takes no inputs (e.g. a node that just calls an MCP tool to list illuminations and emits results):

```yaml
---
name: list-open-illuminations
description: Enumerate open illuminations via MCP
auto_inputs: true
inputs: []                             # explicit empty list, not omitted
outputs:
  illuminations_list: string
model: opus
permissionMode: dangerouslySkipPermissions
tools:
  - mcp__illumination__list_illuminations
---

# Mission

Call `mcp__illumination__list_illuminations` with status: open and emit
the result as a JSON-serializable list.
```

At runtime the engine renders an empty Inputs section (`## Inputs` followed by no tags), then the rubric body. Validator does not emit `inputs_missing_frontmatter` because the empty list is the explicit form.

---

## Open questions surfaced during grilling but deferred

These do not block this redesign; flag for future thought:

- **Conditional outputs** (an agent that emits `summary` only on some code paths): today, `outputs:` is a flat schema. Could grow to `outputs: { summary: { type: string, optional: true } }`. Not needed for the current pipeline set; defer.
- **Type checking on edges** (validator asserts producer's output type matches consumer's expected type, e.g. string vs JSON object): today only key existence is checked. Type-level matching is a future enhancement; defer.
- **Deprecation of `default_*` in favor of frontmatter optionality**: deliberately kept on the consumer node per D8, but if the same agent ends up always-optional in every consumer, frontmatter optionality might earn its keep. Defer until pattern is observed.
