# Design: Extend `unknown_source_node` / `source_missing_output_key` to gate `inputs:`

**Date:** 2026-05-12
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-11T2315-validator-skips-gate-input-refs.md`

## 1. Motivation

`apparat pipeline validate` is documented as the edit-time seam where structural errors surface before any LLM run. Today it under-delivers on that promise for gate (`shape=hexagon`) nodes: gate `inputs:` declarations are read for orphan-output bookkeeping, but never validated against the graph's node set.

The validator already has two well-tested rules that catch references to nonexistent producers — `unknown_source_node` at `src/attractor/core/validators/inputs-refs.ts:223` and `source_missing_output_key` at `src/attractor/core/validators/inputs-refs.ts:240`. Both live inside `checkInputsForNode`, which short-circuits at `src/attractor/core/validators/inputs-refs.ts:134`:

```ts
if (!node.agent) return;
```

Gate nodes never have `node.agent` set, so the rules never reach them. `checkMissingInputProducer` likewise gates on `!node.agent` at `src/attractor/core/validators/inputs-refs.ts:275`.

The validator *does* read gate inputs — but only one-directionally. `checkOrphanOutput` at `src/attractor/core/validators/inputs-refs.ts:395-412` walks gate frontmatter and folds gate `inputs:` into a `consumed` set so producer-side orphan warnings don't false-positive:

```ts
} else if (node.shape === "hexagon") {
  // Gate nodes can also consume outputs via their inputs: frontmatter.
  try {
    const gateCfg = resolveGate(id, { dotDir });
    if (gateCfg?.inputs) {
      for (const k of gateCfg.inputs) {
        try {
          const resolved = resolveInputDecl(k);
          consumed.add(resolved.localKey);
```

"Consumed" bookkeeping tells you the gate uses the key — not whether the named source node exists. The result is a class of bug that flies green through `pipeline validate` and only fires when the engine reaches the gate at run time.

### The 2026-05-11 incident

Run `parallel-illumination-to-implementation-df1d9cf6`. `tmux_confirm_gate.md` was copy-pasted from the original `illumination-to-implementation` pipeline and kept `inputs: [implement.done, implement.reason]`. The parallel-impl pipeline has no `implement` node — only `batch_orchestrator`. `apparat pipeline validate` returned `✔ Pipeline valid (19 nodes, 29 edges)` twice. The pipeline ran for ~50 minutes through plan-writer (~8min), plan-scheduler (~1min), batch-orchestrator (16min across two iterations dispatching 4 parallel worktrees), merge-resolver (~4min), and into tmux-tester before the gate node fired and the engine threw `Undefined variable $implement.done` from `src/attractor/transforms/variable-expansion.ts:5`.

The symptom was patched live by `8631fda fix(parallel-impl): orchestrator no longer terminates while chunks remain` — the gate now correctly declares `inputs: [run_id, batch_orchestrator.done, batch_orchestrator.reason, …]` (see `.apparat/pipelines/parallel-illumination-to-implementation/tmux_confirm_gate.md:6-12`). This design closes the *category* — without it, the next gate copy-paste lands the same hole.

### Why this slot

ADR-0012 (`docs/adr/0012-validation-context.md:32`) clusters the 41 validator rules under `src/attractor/core/validators/`, with the canonical `(ctx: ValidationContext, node: Node) => void` signature. ADR-0009 (parser/validator split) ships the `graph-validator-byte-identical.test.ts` regression oracle. The fix slots cleanly into the existing rule-cluster shape and reuses existing primitives — `resolveGate` (`src/cli/lib/gate-registry.ts:12-31`), `resolveInputDecl` (`src/attractor/transforms/inputs-resolver.ts:18-54`), `tryResolveAgent` (`src/attractor/core/validators/agent-resolver.ts:5`). No new validator concept, no new diagnostic shape.

## 2. Decision summary

Presentation-only deepening of an existing rule cluster, in one source file. No engine change, no IPC, no `.dot` schema change, no agent rubric change.

1. **Extract `iterateGateInputs(graph, dotDir, callback)` in `src/attractor/core/validators/inputs-refs.ts`.** The iteration `checkOrphanOutput` already performs at lines 395–412 (resolve every `shape === "hexagon"` node's `gateCfg.inputs` through `resolveInputDecl`) becomes a shared helper, yielding `(gateNodeId, declString, resolved)` for every parseable gate input.
2. **Add gate-side coverage of `unknown_source_node`.** A new check walks `iterateGateInputs` and pushes the existing diagnostic shape when `resolved.sourceNode !== undefined && !ctx.graph.nodes.has(resolved.sourceNode)`.
3. **Add gate-side coverage of `source_missing_output_key`.** Same walk, but when `resolved.sourceNode` exists and resolves to a `node.agent` (use `tryResolveAgent` for symmetry with the agent-side rule at `:247`) or a `node.type === "tool"` with `producesFromStdout` (`:234`), assert `resolved.localKey` is one of the producer's declared outputs.
4. **Refactor `checkOrphanOutput` to use the new helper.** The orphan-output gate-input loop at `:395-412` is the same iteration; one primitive, three call sites (the two new rules + the existing consumed-set fold).
5. **Regression test mirroring the incident.** Fixture: a 3-node graph `start → batch_orchestrator → my_gate`, where `my_gate.md` declares `inputs: [implement.done]`. Assert the new `unknown_source_node` diagnostic fires with the gate node's source location and `implement` named in the message.
6. **Regenerate `src/attractor/tests/graph-validator-byte-identical.test.ts` snapshot.** The byte-identical oracle is designed to break-and-regenerate when rule emissions change; ADR-0009 names this contract. Mechanical update.
7. **One-pass audit of bundled and project-local gates.** Grep `src/cli/pipelines/**/*.md` and `.apparat/pipelines/**/*.md` for gate frontmatter with `inputs:` entries whose `sourceNode` isn't a node in the sibling `pipeline.dot`. Cheap, surfaces any other silent break before the fix ships.

**Out of scope:**

- No new diagnostic shapes. The `unknown_source_node` and `source_missing_output_key` rule names and message templates are reused; only the surface they fire on widens.
- No engine changes. `variable-expansion.ts:5` still throws `Undefined variable $X.Y` at run time — the validator just catches the class earlier.
- No CONTEXT.md / new ADR / README structural rewrite. Optional one-paragraph adds only (see §6).
- No widening to `checkMissingInputProducer` for gates. The original illumination scopes that as future work — gates don't sit "on every path" the way `missing_input_producer` requires, and the two new rules cover the common copy-paste mistake.

## 3. Architecture

### 3.1 Before / after

**Before** — incident reproduction on `parallel-illumination-to-implementation/pipeline.dot` with a stale `inputs: [implement.done]` in `tmux_confirm_gate.md`:

```
$ apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
✔ Pipeline valid (19 nodes, 29 edges)
…
[~50 min later, at run time]
Error: Undefined variable $implement.done
    at expandVariables (src/attractor/transforms/variable-expansion.ts:5)
```

**After**:

```
$ apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot
✗ unknown_source_node: Gate "tmux_confirm_gate" references source node "implement" in inputs:, but no such node exists in the graph.
  .apparat/pipelines/parallel-illumination-to-implementation/tmux_confirm_gate.md:?
```

Same exit code semantics as the agent-surface rule today (`error` severity → non-zero exit). The user fixes the typo before any LLM runs.

### 3.2 The shared iteration helper

```ts
// src/attractor/core/validators/inputs-refs.ts (new)

interface GateInputVisit {
  gateNodeId: string;
  decl: string;                       // raw decl string from gate frontmatter
  resolved: ReturnType<typeof resolveInputDecl>;
  gateNode: Node;                     // for sourceLocation reuse
}

function iterateGateInputs(
  ctx: ValidationContext,
  callback: (v: GateInputVisit) => void,
): void {
  const { graph, dotDir } = ctx;
  if (!dotDir) return;
  for (const [id, node] of graph.nodes) {
    if (node.shape !== "hexagon") continue;
    let gateCfg;
    try {
      gateCfg = resolveGate(id, { dotDir });
    } catch {
      // resolveGate throws when the .md file is missing or fails zod parsing
      // (see src/cli/lib/gate-registry.ts:18-24). Other rules handle this.
      continue;
    }
    if (!gateCfg.inputs) continue;
    for (const decl of gateCfg.inputs) {
      let resolved;
      try {
        resolved = resolveInputDecl(decl);
      } catch {
        // Malformed decl (multi-dot, empty) — handled by other rules.
        continue;
      }
      callback({ gateNodeId: id, decl, resolved, gateNode: node });
    }
  }
}
```

Single primitive. The existing `checkOrphanOutput` gate-input loop folds into `iterateGateInputs(ctx, ({ resolved }) => consumed.add(resolved.localKey))`. The two new rules each pass their own callback.

### 3.3 The two new gate-surface rules

```ts
// src/attractor/core/validators/inputs-refs.ts (new)

function checkGateUnknownSourceNode(ctx: ValidationContext): void {
  iterateGateInputs(ctx, ({ gateNodeId, decl, resolved, gateNode }) => {
    if (resolved.sourceNode === undefined) return;
    if (ctx.graph.nodes.has(resolved.sourceNode)) return;
    ctx.diags.push({
      rule: "unknown_source_node",
      severity: "error",
      message: `Gate "${gateNodeId}" references source node "${resolved.sourceNode}" in inputs:, but no such node exists in the graph.`,
      location: gateNode.sourceLocation,
    });
  });
}

function checkGateSourceMissingOutputKey(ctx: ValidationContext): void {
  const { dotDir, graph } = ctx;
  iterateGateInputs(ctx, ({ gateNodeId, decl, resolved, gateNode }) => {
    if (resolved.sourceNode === undefined) return;
    const source = graph.nodes.get(resolved.sourceNode);
    if (!source) return; // unknown_source_node handles this
    if (source.type === "tool") {
      if (!source.producesFromStdout) {
        ctx.diags.push({
          rule: "source_missing_output_key",
          severity: "error",
          message: `Gate "${gateNodeId}" input "${decl}" references key "${resolved.localKey}" which "${resolved.sourceNode}" does not declare in produces_from_stdout`,
          location: gateNode.sourceLocation,
        });
      }
      return;
    }
    if (source.agent) {
      const sourceCfg = tryResolveAgent(source, dotDir);
      if (!sourceCfg || sourceCfg.outputs === undefined) return;
      if (!(resolved.localKey in sourceCfg.outputs)) {
        ctx.diags.push({
          rule: "source_missing_output_key",
          severity: "error",
          message: `Gate "${gateNodeId}" input "${decl}" references key "${resolved.localKey}" which "${resolved.sourceNode}" does not declare in outputs:`,
          location: gateNode.sourceLocation,
        });
      }
    }
  });
}
```

The diagnostic message names the gate explicitly (`Gate "<id>" …`) instead of the agent (`Agent "<name>" …` in the agent-side rule). Same `rule:` string — operators see one error template, two surfaces. Same `location` field shape (`Node.sourceLocation`) for `validate`'s source-location renderer.

### 3.4 Wiring into the `run(ctx)` dispatcher

`run(ctx)` in `src/attractor/core/validators/inputs-refs.ts:21` ends with Block D at lines 44–50:

```ts
// Block D — non-loop calls.
if (ctx.dotDir) {
  checkMissingInputProducer(ctx);
  checkInputTypeMismatch(ctx);
  checkOrphanOutput(ctx);
  checkOutputsSchemaShape(ctx);
}
```

Insert the two new graph-wide rules immediately before `checkOrphanOutput` (so the byte-identical snapshot regen pulls them in once, in stable order):

```ts
if (ctx.dotDir) {
  checkMissingInputProducer(ctx);
  checkInputTypeMismatch(ctx);
  checkGateUnknownSourceNode(ctx);        // NEW
  checkGateSourceMissingOutputKey(ctx);   // NEW
  checkOrphanOutput(ctx);
  checkOutputsSchemaShape(ctx);
}
```

`checkOrphanOutput` body switches its gate-input loop (currently `:395-412`) to the helper:

```ts
// in checkOrphanOutput, replacing the hexagon branch
iterateGateInputs(ctx, ({ resolved }) => {
  consumed.add(resolved.localKey);
});
```

The hexagon branch in the `for (const [id, node] of graph.nodes)` loop at `:381-413` becomes agent-only:

```ts
for (const [id, node] of graph.nodes) {
  if (!node.agent) continue;
  const cfg = tryResolveAgent(node, dotDir);
  if (!cfg?.inputs) continue;
  for (const k of cfg.inputs) {
    try {
      const resolved = resolveInputDecl(k);
      consumed.add(resolved.localKey);
    } catch {
      // …
    }
  }
}
// Gate-input contribution now via iterateGateInputs (see above).
iterateGateInputs(ctx, ({ resolved }) => {
  consumed.add(resolved.localKey);
});
```

Order is preserved — the for-loop completes (agent contributions) before the gate iteration runs. Byte-identical to today modulo the two new diagnostic emissions.

### 3.5 Files-touched buckets

| Bucket | File | Treatment |
|---|---|---|
| Validator | `src/attractor/core/validators/inputs-refs.ts` | Inline edit — add `iterateGateInputs`, `checkGateUnknownSourceNode`, `checkGateSourceMissingOutputKey`; wire into `run(ctx)`; refactor `checkOrphanOutput` hexagon branch |
| Test (gate rules) | `src/attractor/tests/graph-validator-inputs.test.ts` | Edit — add gate-surface cases mirroring the existing `unknown_source_node` and `source_missing_output_key` describe blocks at `:63` and `:110` |
| Test (snapshot) | `src/attractor/tests/graph-validator-byte-identical.test.ts` (+ snapshot file) | Regenerate — mechanical, per ADR-0009 contract |
| Bundled gates | `src/cli/pipelines/**/*.md`, `.apparat/pipelines/**/*.md` | Audit-only — verifier subagent confirmed no current bundled hexagon gates declare `inputs:`; green builds stay green |
| Docs (optional) | `CONTEXT.md`, `docs/adr/0012-validation-context.md`, `README.md` | Optional — see §6; not required for the rule to ship |

Total mandatory files: 3 source + 1 snapshot. Optional docs ripple is genuinely optional — the validator is self-describing through `rule:` strings, and no public-contract surface changes.

## 4. Components & key edits

### 4.1 `src/attractor/core/validators/inputs-refs.ts` (edited)

See §3.2–§3.4. Net add: ~80 LOC for the helper + two rule functions; net change in `checkOrphanOutput`: ~−18 LOC, +3 LOC (loop body becomes a helper call). The `run(ctx)` dispatch grows by two lines.

Imports unchanged — `tryResolveAgent` at `:4`, `resolveInputDecl` at `:5`, `resolveGate` at `:9` are already in scope.

### 4.2 `src/attractor/tests/graph-validator-inputs.test.ts` (edited)

The existing `describe("validator — unknown_source_node")` at `:63` and `describe("validator — source_missing_output_key")` at `:110` each grow one nested test case for the gate surface. Pattern mirrors the agent-side cases at `:64-86`:

```ts
it("errors when gate inputs reference a non-existent node", () => {
  const dir = join(tmpdir(), `rule-usn-gate-${Date.now()}`);
  setup(dir, {
    "producer.md": `---
name: producer
description: x
inputs: []
outputs: { foo: string }
---
body`,
    "my_gate.md": `---
type: gate
choices: [Approve, Retry]
inputs: [implement.done]
---
gate body`,
  });
  const dot = `digraph g {
    start [shape=Mdiamond]
    producer [agent="producer"]
    my_gate [shape=hexagon]
    done [shape=Msquare]
    start -> producer -> my_gate -> done
  }`;
  writeFileSync(join(dir, "p.dot"), dot);
  const graph = parseDot(dot);
  const diags = validateGraph(graph, dir);
  const d = diags.find(d => d.rule === "unknown_source_node" && /Gate "my_gate"/.test(d.message));
  expect(d).toBeDefined();
  expect(d!.severity).toBe("error");
  expect(d!.message).toMatch(/source node "implement"/);
});
```

A parallel case for `source_missing_output_key` declares `inputs: [producer.bar]` against a producer that only outputs `foo`. The `Gate "<id>"` prefix in the message disambiguates from the agent-surface match in tests that exercise both surfaces.

### 4.3 `src/attractor/tests/graph-validator-byte-identical.test.ts` (regenerate snapshot)

ADR-0009 names this test as the regression oracle for emission-order stability. The contract: when a new rule is added, the snapshot regenerates and the diff is reviewed manually. The two new rules fire on graphs that previously fired no gate-input errors (because there were none); the snapshot delta is bounded to fixtures that contain gate `inputs:`.

Per the verifier's scenario subagent, no current bundled hexagon gates declare a stale `inputs:` ref, so the snapshot delta from existing fixtures is zero. The two new test cases in §4.2 contribute the expected new emissions, snapshot-captured.

### 4.4 Bundled / project-local gate audit (one-pass)

Mechanical:

```sh
# 1. Find every hexagon gate's frontmatter inputs.
grep -lR "type: gate" src/cli/pipelines .apparat/pipelines | while read f; do
  echo "=== $f"
  awk '/^---$/{p++} p==1' "$f"
done

# 2. For each `inputs:` entry of shape `node.key`, verify `node` exists in sibling pipeline.dot.
```

Verifier confirmed: zero current bundled hexagon gates declare `inputs:` of the form `node.key` against a node that doesn't exist in the sibling `pipeline.dot`. The audit is a defensive sweep — if it surfaces a hit, fix it in the same PR.

`.apparat/pipelines/parallel-illumination-to-implementation/tmux_confirm_gate.md:6-12` is the post-fix state and validates cleanly under the new rules (all sources — `run_id`, `batch_orchestrator`, `tmux_tester` — exist in the sibling `pipeline.dot`).

## 5. Data flow

### 5.1 Today

```
pipeline validate <dot>
  → parseDot → Graph
  → validateGraph(graph, dotDir)
      → run(ctx) for each validator cluster
      → inputs-refs.run(ctx)
          → Loop C: for each node, checkInputsForNode
              → if (!node.agent) return                       # SKIPS GATES
          → Block D: checkMissingInputProducer
              → for each node, if (!node.agent) continue      # SKIPS GATES
          → Block D: checkOrphanOutput
              → for each hexagon node, fold gate inputs into `consumed` set
              # ← One-directional. Source node never checked for existence.
  → exit code 0 (green) iff diags is empty
```

### 5.2 After

```
pipeline validate <dot>
  → parseDot → Graph
  → validateGraph(graph, dotDir)
      → inputs-refs.run(ctx)
          → (unchanged Loop A/B/C — agent-only rules)
          → Block D:
              checkMissingInputProducer
              checkInputTypeMismatch
              checkGateUnknownSourceNode                      # NEW
                  → iterateGateInputs → if !graph.nodes.has(sourceNode) → emit
              checkGateSourceMissingOutputKey                 # NEW
                  → iterateGateInputs → tryResolveAgent / tool check → emit
              checkOrphanOutput
                  → iterateGateInputs → consumed.add(localKey)
                  # ← Now via the same helper.
              checkOutputsSchemaShape
  → exit code 1 if any new gate-side diag is emitted (severity=error)
```

No engine path change. `variable-expansion.ts:5` still throws on runtime undefined-var refs — the validator now refuses to ship a graph that would.

## 6. Blast radius / impact surface

- **Size:** **S.** Verifier final pass: S. Explainer Tier-2 §Blast radius: S. Same envelope.
- **Files touched:** ~3 mandatory + 1 snapshot.
  - 1 source: `src/attractor/core/validators/inputs-refs.ts` (inline edit — extract helper, add two rules, refactor one loop).
  - 1 test edit: `src/attractor/tests/graph-validator-inputs.test.ts` (two new cases).
  - 1 snapshot regen: `src/attractor/tests/graph-validator-byte-identical.test.ts` (+ its `.snap` if file-based) — mechanical per ADR-0009.
  - 0 bundled gate edits expected; the one-pass audit is verification, not modification.
- **Surfaces crossed:** validator core (1 cluster), tests (1 edited + 1 snapshot regen). No CLI command, no `program.ts` registration, no daemon IPC, no `.dot` schema, no agent rubric, no Ink TUI, no engine, no tracer, no scenario folder.
- **Breaking changes:** **no.**
  - `Diagnostic` interface at `src/attractor/types.ts:93-100` is TypeScript-enforced; no consumer parses validator stdout. Public consumption points are `src/cli/commands/pipeline/run.ts:61` (exit code + `Diagnostic[]` object) and `src/cli/tests/bundled-pipelines-self-sufficient.test.ts:30` (same shape). Both stay byte-identical for graphs that don't trip the new rules.
  - No public CLI flag, no env var, no exit-code semantics change. Pipelines that pass today still pass.
  - The byte-identical snapshot is *designed* to regenerate when rules are added — ADR-0009 names this contract — so its mechanical update is not a breaking change to a stable contract.
- **Spec / docs ripple checklist (all optional):**
  - [ ] (optional) `CONTEXT.md` — one sub-bullet under the validator rule list noting that `unknown_source_node` and `source_missing_output_key` fire on agent `inputs:` *and* gate `inputs:` surfaces.
  - [ ] (optional) `docs/adr/0012-validation-context.md` — short appendix mentioning that the gate-input rules extend the `inputs-refs.ts` cluster and reuse the same diagnostic shapes; no new cluster file.
  - [ ] (optional) `README.md` rule-list area — explicit two-surface wording for the two rule names.
  - [ ] **No new ADR.** The fix slots into ADR-0012's existing rule-cluster contract.
- **Test ripple checklist:**
  - [x] **Edit** `src/attractor/tests/graph-validator-inputs.test.ts` — two new gate-surface test cases (§4.2).
  - [x] **Regenerate** `src/attractor/tests/graph-validator-byte-identical.test.ts` snapshot (§4.3).
  - [ ] **No new scenario.** The byte-identical oracle + the unit test cover the rule's surface end-to-end; a `.apparat/scenarios/` folder would be additive noise for a presentation-only validator change.

## 7. Trade-offs

### 7.1 New rule names vs. reuse `unknown_source_node` / `source_missing_output_key`

**Reuse.** The agent-side rules and the new gate-side coverage diagnose the same class of error (a typo'd / stale `node.key` reference). One `rule:` string per category means one operator-facing template per failure mode, regardless of which surface tripped it. Disambiguation lives in the `message` body (`Agent "X" …` vs `Gate "Y" …`).

Cost: a downstream tool grouping diagnostics by `rule:` would now see two surfaces under one bucket. Verifier confirmed no such consumer exists.

### 7.2 Shared helper (`iterateGateInputs`) vs. inline each loop

**Shared helper.** Today's `checkOrphanOutput` already performs the iteration (`:395-412`). The two new rules would each duplicate the same `for … if (node.shape === "hexagon") … resolveGate … resolveInputDecl …` pattern. A single primitive collapses three call sites into one source of truth — future rules (e.g. variable-coverage extensions for gate prompts) plug in without rewriting the iteration.

Cost: one new function (~25 LOC). Benefit: the existing one-directional `consumed` bookkeeping converges with the new bidirectional checks behind one walker — no chance the two grow apart silently.

### 7.3 Insert before `checkOrphanOutput` vs. after

**Before.** `run(ctx)` order in Block D is significant for the byte-identical snapshot. Placing the two new rules immediately before `checkOrphanOutput` keeps the snapshot delta contiguous and predictable: new diagnostics group adjacent in emission order, and `checkOrphanOutput`'s output is unchanged when no new gate-input errors fire.

Cost: none — emission order is the only constraint, and this placement minimises diff churn against the existing snapshot.

### 7.4 Gate-side rule for `missing_input_producer` too?

**Defer.** The illumination scopes `missing_input_producer` as future work. Gates don't sit "on every path from start" the way `checkMissingInputProducer` requires (gates terminate branches), and the failure-mode "I named a source that exists nowhere" is fully covered by the new `unknown_source_node` rule. Adding `missing_input_producer` for gates would require redefining what "producer on every path to a gate" means — out of scope for this fix.

If a future incident shows a gate references an *existing* node that doesn't lie on every path to the gate, revisit. Today's incident shape ("source node does not exist at all") is the dominant copy-paste class.

### 7.5 Diagnostic message phrasing

**`Gate "<id>" …`.** The agent-side rule uses `Agent "<name>" …` because agents are named by their `.md` filename, distinct from the node `id`. Gates are named by the node `id` (the `.md` file is `<id>.md`). The `Gate "<id>"` prefix is the most diagnostic-friendly form — operator can grep the `.dot` directly.

Cost: tests asserting on the message body need a `Gate "X"` regex variant when exercising the gate surface; one extra assertion line per test.

### 7.6 Sequencing — single PR

Single PR. The change is structurally atomic (one file edit + one test edit + one snapshot regen); splitting into helper-first + rule-second would add review cycles without changing the landed shape. The verifier sized this S and named one file as the change surface.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the new gate-surface cases in `graph-validator-inputs.test.ts` and the regenerated `graph-validator-byte-identical.test.ts.snap`.
- `apparat pipeline validate <dot>` returns exit code 1 with the new `unknown_source_node` (and/or `source_missing_output_key`) diagnostic when a gate `inputs:` declares `<id>.<key>` against an `id` that isn't a node in the graph (or a `key` the named producer doesn't declare).
- `apparat pipeline validate <dot>` returns exit code 0 byte-identically for every graph that doesn't trip the new rules — verifier confirmed no current bundled hexagon gates have stale refs, so the bundled-pipelines suite stays green.
- The `tmux_confirm_gate.md` post-fix state at `.apparat/pipelines/parallel-illumination-to-implementation/tmux_confirm_gate.md:6-12` validates cleanly under the new rules.
- A regression fixture mirroring the incident (`my_gate.md` with `inputs: [implement.done]`, sibling `pipeline.dot` containing only `batch_orchestrator`) emits the new `unknown_source_node` diagnostic with `Gate "my_gate"` and `source node "implement"` in the message.

Repo-wide grep invariants (post-merge):

- `grep -n "iterateGateInputs" src/attractor/core/validators/inputs-refs.ts` — at least three matches (declaration + three callbacks).
- `grep -n "checkGateUnknownSourceNode\|checkGateSourceMissingOutputKey" src/attractor/core/validators/inputs-refs.ts` — both present, both invoked from `run(ctx)`.
- `grep -nR 'rule: "unknown_source_node"' src/attractor/core/validators/inputs-refs.ts` — at least two matches (agent-side at the existing line, gate-side new).
- `grep -nR 'rule: "source_missing_output_key"' src/attractor/core/validators/inputs-refs.ts` — at least four matches (agent-side tool branch at `:240` + agent branch at `:251` already exist; gate-side adds tool branch + agent branch).

Behaviour invariants:

- No new socket calls. No new LLM invocations. No new `mkdirSync` / `writeFileSync`. The validator stays pure (modulo `existsSync` / `readFileSync` already used by `resolveGate`).
- The `Diagnostic` interface at `src/attractor/types.ts:93-100` is unchanged.
- `run(ctx)` invocation order in Block D is stable: insertion is immediately before `checkOrphanOutput`.

## 9. Open questions

- **One rule function vs. two.** §3.3 splits into `checkGateUnknownSourceNode` and `checkGateSourceMissingOutputKey` to mirror the agent-side rule decomposition. The implementing session may find that a single `checkGateInputRefs(ctx)` body (one walk, both checks inline) reads more naturally — both shapes preserve `run(ctx)`'s emission order. Either route lands the same byte-identical diff against the snapshot when the two are inserted adjacent.
- **Audit script materialisation.** §4.4 sketches a shell-grep audit; the implementing session decides whether to land it as a one-shot pre-merge check or as a permanent test that runs against `src/cli/pipelines/**` (the bundled-pipelines suite already exists at `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`). The verifier's confirmed-zero-stale-refs report makes either choice safe.
- **Optional docs ripple.** §6 lists `CONTEXT.md`, ADR-0012, and `README.md` as optional. None are required for the rule to ship; the validator is self-describing through `rule:` strings. The implementing session may include or defer; if deferred, log as a follow-up rather than dropping silently.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `iterateGateInputs\b` in `src/attractor/core/validators/inputs-refs.ts` — present.
- Grep `checkGateUnknownSourceNode\|checkGateSourceMissingOutputKey` in `src/attractor/core/validators/inputs-refs.ts` — both present, both invoked from `run(ctx)`.
- Grep `Gate "` in `src/attractor/core/validators/inputs-refs.ts` — at least two matches (the two new diagnostic messages).

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts` — passes, includes new gate-surface cases.
- `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts` — passes with regenerated snapshot.
- `npx vitest run src/cli/tests/bundled-pipelines-self-sufficient.test.ts` — passes (no current bundled gate has stale refs).
- Full `npx vitest run` — passes.

### 10.3 Smoke

- Reproduce the incident shape: in a scratch dir, author a `pipeline.dot` with `start → batch_orchestrator → my_gate → done` and a `my_gate.md` declaring `inputs: [implement.done]`. `apparat pipeline validate <dot>` should exit non-zero with `unknown_source_node` / `Gate "my_gate"` / `source node "implement"` in the diagnostic.
- Validate `.apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot` post-fix — confirm green.
- Validate the bundled pipelines under `src/cli/pipelines/**` — confirm none regress.

### 10.4 Negative cases

- **Gate frontmatter missing or unparseable:** `resolveGate` throws → `iterateGateInputs` swallows and continues. Other rules (gate frontmatter parsing) already surface the underlying error.
- **Malformed gate input decl** (`""`, `a.b.c`): `resolveInputDecl` throws → `iterateGateInputs` swallows and continues. The existing rule covering malformed decls fires.
- **Bare gate input** (e.g. `inputs: [run_id]`): `resolved.sourceNode === undefined`. Both new rules early-return — bare inputs are caller-vars / reserved; gate-surface coverage is qualified-only.
- **Gate references a producer that exists but is unreachable from start to the gate:** out of scope (see §7.4). The two new rules fire only on "source node does not exist" or "key not in declared outputs"; "producer not on every path to gate" is deferred.

## 11. Summary

`apparat pipeline validate` is documented as the edit-time seam where structural errors surface before any run. Today its two reference-checking rules — `unknown_source_node` and `source_missing_output_key`, both in `src/attractor/core/validators/inputs-refs.ts` — fire only on agent `inputs:` declarations, never on gate (`shape=hexagon`) `inputs:`. The short-circuit `if (!node.agent) return;` at `src/attractor/core/validators/inputs-refs.ts:134` is the root: `checkInputsForNode` (containing the two rules at `:223` and `:240`) returns immediately on gates. `checkOrphanOutput` at `:395-412` *does* read gate inputs, but only one-directionally — folding them into a `consumed` set for producer-side orphan warnings, never checking that the named source node exists. The 2026-05-11 run `parallel-illumination-to-implementation-df1d9cf6` burned ~50 minutes of LLM time (plan-writer, plan-scheduler, batch-orchestrator across two iterations, merge-resolver) before `tmux_confirm_gate.md`'s stale `inputs: [implement.done]` blew up as `Undefined variable $implement.done` from `src/attractor/transforms/variable-expansion.ts:5`. The symptom was patched live by `8631fda fix(parallel-impl): orchestrator no longer terminates while chunks remain` — the gate now declares `inputs: [run_id, batch_orchestrator.done, batch_orchestrator.reason, …]` per `.apparat/pipelines/parallel-illumination-to-implementation/tmux_confirm_gate.md:6-12` — but the category remained open. This design closes it with a presentation-only deepening of one validator cluster: (1) extract `iterateGateInputs(ctx, callback)` from the existing `checkOrphanOutput` hexagon loop into a shared primitive; (2) add `checkGateUnknownSourceNode(ctx)` reusing the existing `unknown_source_node` diagnostic shape on the gate surface; (3) add `checkGateSourceMissingOutputKey(ctx)` reusing the existing `source_missing_output_key` shape (both tool-branch and agent-branch, via `tryResolveAgent` at `src/attractor/core/validators/agent-resolver.ts:5` for symmetry with the agent-side rule at `:247`); (4) refactor `checkOrphanOutput`'s hexagon branch to call the new helper; (5) add two regression tests under `src/attractor/tests/graph-validator-inputs.test.ts` mirroring the existing agent-side `describe` blocks at `:63` and `:110`; (6) regenerate `src/attractor/tests/graph-validator-byte-identical.test.ts.snap` per the ADR-0009 contract that names the byte-identical oracle as the break-and-regenerate gate when rules are added; (7) one-pass audit of bundled and project-local gates — verifier confirmed zero current stale refs. Blast radius is **S** — one validator file edited, one test file edited, one snapshot regenerated, zero breaking changes (the `Diagnostic` interface at `src/attractor/types.ts:93-100` is TypeScript-enforced only; the two CLI consumers at `src/cli/commands/pipeline/run.ts:61` and `src/cli/tests/bundled-pipelines-self-sufficient.test.ts:30` consume the `Diagnostic[]` object shape, not stderr text). No engine change, no IPC, no `.dot` schema change, no agent rubric change, no new diagnostic shape, no new CLI command, no `program.ts` registration. Optional docs ripple (CONTEXT.md, ADR-0012 appendix, README rule-list) is genuinely optional — the validator is self-describing through `rule:` strings.
