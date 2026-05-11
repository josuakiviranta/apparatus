# Validator: Extend `unknown_source_node` / `source_missing_output_key` to gate `inputs:` — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apparat pipeline validate` catch stale gate-input refs (e.g. `inputs: [implement.done]` against a graph with no `implement` node) at edit time, instead of letting them slip through and explode 50+ minutes into a run.

**Architecture:** Presentation-only deepening of one validator cluster (`src/attractor/core/validators/inputs-refs.ts`). Extract the iteration `checkOrphanOutput` already performs over hexagon-gate `inputs:` into a shared `iterateGateInputs(ctx, callback)` helper, then reuse it from two new rule functions that emit the existing `unknown_source_node` and `source_missing_output_key` diagnostic shapes on the gate surface. No engine change, no IPC change, no `.dot` schema change, no new diagnostic shape.

**Tech Stack:** TypeScript, vitest, existing primitives — `resolveGate` (`src/cli/lib/gate-registry.ts:12-31`), `resolveInputDecl` (`src/attractor/transforms/inputs-resolver.ts:18-54`), `tryResolveAgent` (`src/attractor/core/validators/agent-resolver.ts:5`).

**Originating illumination:** `.apparat/meditations/illuminations/2026-05-11T2315-validator-skips-gate-input-refs.md`
**Design doc:** `docs/superpowers/specs/2026-05-12-validator-skips-gate-input-refs-design.md`

---

## Chunk 1: Extract `iterateGateInputs` helper, refactor `checkOrphanOutput`

**Intent:** Pure refactor — collapse the gate-input iteration `checkOrphanOutput` performs at `src/attractor/core/validators/inputs-refs.ts:395-412` into a shared helper. After this chunk, the byte-identical snapshot oracle (`graph-validator-byte-identical.test.ts`) must still pass with **no changes** to the snapshot file. This proves the refactor is behaviour-preserving and gives Chunks 2–3 a clean primitive to plug into.

### Task 1.1: Add `iterateGateInputs` helper and route `checkOrphanOutput` through it

**Files:**
- Modify: `src/attractor/core/validators/inputs-refs.ts:374-413`

- [x] **Step 1: Confirm the existing snapshot is the baseline**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`
Expected: PASS — all `pins diagnostics for …` cases green. This is the contract Chunk 1 must preserve.

- [x] **Step 2: Add `iterateGateInputs` helper at the bottom of `inputs-refs.ts`**

Append after `isProducerOnEveryPath` (currently ending at `src/attractor/core/validators/inputs-refs.ts:520`), as a new file-local helper:

```ts
/**
 * Walk every hexagon-gate node's frontmatter `inputs:` declarations,
 * invoking `callback` once per (gateNode, decl, resolved) triple.
 *
 * Silently skips gates whose .md is missing/unparseable (`resolveGate` throws)
 * or whose individual decl is malformed (`resolveInputDecl` throws) — other
 * rules surface those errors.
 */
interface GateInputVisit {
  gateNodeId: string;
  decl: string;
  resolved: ReturnType<typeof resolveInputDecl>;
  gateNode: Node;
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
      continue;
    }
    if (!gateCfg?.inputs) continue;
    for (const decl of gateCfg.inputs) {
      let resolved;
      try {
        resolved = resolveInputDecl(decl);
      } catch {
        continue;
      }
      callback({ gateNodeId: id, decl, resolved, gateNode: node });
    }
  }
}
```

- [x] **Step 3: Replace the hexagon branch inside `checkOrphanOutput`**

In `src/attractor/core/validators/inputs-refs.ts:381-413`, the current loop body is:

```ts
for (const [id, node] of graph.nodes) {
  if (node.agent) {
    // agent branch — unchanged
  } else if (node.shape === "hexagon") {
    try {
      const gateCfg = resolveGate(id, { dotDir });
      if (gateCfg?.inputs) {
        for (const k of gateCfg.inputs) {
          try {
            const resolved = resolveInputDecl(k);
            consumed.add(resolved.localKey);
          } catch {
            // Malformed input decl — skip silently.
          }
        }
      }
    } catch {
      // Gate not found or parse error — skip silently (other rules handle this).
    }
  }
}
```

Drop the `else if (node.shape === "hexagon") { … }` block entirely (leave the agent branch intact) and append a single `iterateGateInputs` call immediately after the for-loop closes. The diff inside `checkOrphanOutput` reads:

```ts
for (const [id, node] of graph.nodes) {
  if (node.agent) {
    const cfg = tryResolveAgent(node, dotDir);
    if (!cfg?.inputs) continue;
    for (const k of cfg.inputs) {
      try {
        const resolved = resolveInputDecl(k);
        consumed.add(resolved.localKey);
      } catch {
        // Malformed input decl — skip silently (other rules handle the error).
      }
    }
  }
}
// Gate-input contribution via shared helper — preserves emission order with
// the agent-branch loop above (loop runs to completion first).
iterateGateInputs(ctx, ({ resolved }) => {
  consumed.add(resolved.localKey);
});
```

The order matters for the byte-identical snapshot: every agent-branch contribution lands first, then every gate-branch contribution — identical to the current `for … if/else if …` order over `graph.nodes`.

- [x] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean, no new errors.

- [x] **Step 5: Run the byte-identical oracle — MUST stay green with zero snapshot churn**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`
Expected: PASS, all snapshots match. **If any snapshot mismatches**, the refactor changed behaviour — fix before moving on. Do NOT regenerate the snapshot in this chunk.

- [x] **Step 6: Run the targeted inputs/orphan suites**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts src/attractor/tests/graph-orphan-output.test.ts`
Expected: PASS.

- [x] **Step 7: Run full vitest as a final regression sanity**

Run: `npx vitest run`
Expected: PASS (or, if pre-existing flakes exist in the repo, no new failures vs. `main`).

- [x] **Step 8: Commit**

```bash
git add src/attractor/core/validators/inputs-refs.ts
git commit -m "refactor(validators/inputs-refs): extract iterateGateInputs helper

Collapse the hexagon-gate input iteration from checkOrphanOutput into a
shared iterateGateInputs(ctx, callback) primitive. Pure refactor —
byte-identical snapshot (graph-validator-byte-identical.test.ts) stays
unchanged. Sets up Chunks 2-3 to plug two new gate-surface rules into
the same walker.

Refs: docs/superpowers/specs/2026-05-12-validator-skips-gate-input-refs-design.md §3.2"
```

## Verification targets

- Smokes: None (validator-internal refactor, no scenario-visible behaviour change)
- Manual exercises: `npx apparat pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot` — expect exit 0 with the post-fix `tmux_confirm_gate.md` (the rule additions land in Chunks 2-3, so today the green stays green)
- Lint: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`, `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts`, `npx vitest run src/attractor/tests/graph-orphan-output.test.ts`, `npx tsc --noEmit`
- Surfaces touched: `attractor/validators`

---

## Chunk 2: Add gate-side `unknown_source_node` rule (TDD)

**Intent:** Land the first new gate-surface rule. Write a failing test that reproduces the 2026-05-11 incident shape (`my_gate.md` declares `inputs: [implement.done]` against a graph with no `implement` node), then implement the minimal rule that makes it pass. Wire into `run(ctx)` in the order the design names (immediately before `checkOrphanOutput`). Regenerate the byte-identical snapshot at the end — this is the ADR-0009-sanctioned break-and-regenerate move when a rule is added.

### Task 2.1: Failing regression test mirroring the incident

**Files:**
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts:63-108` (the existing `describe("validator — unknown_source_node")` block)

- [ ] **Step 1: Add the failing case at the end of the `unknown_source_node` describe block**

Insert before the closing `});` at `src/attractor/tests/graph-validator-inputs.test.ts:108`:

```ts
  it("errors when gate inputs reference a non-existent node", () => {
    const dir = join(tmpdir(), `rule-usn-gate-${Date.now()}`);
    setup(dir, {
      "batch_orchestrator.md": `---
name: batch_orchestrator
description: x
inputs: []
outputs: { done: boolean }
---
body`,
      "tmux_confirm_gate.md": `---
type: gate
choices: [Approve, Retry]
inputs: [implement.done]
---
gate body`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      batch_orchestrator [agent="batch_orchestrator"]
      tmux_confirm_gate [shape=hexagon]
      done [shape=Msquare]
      start -> batch_orchestrator -> tmux_confirm_gate -> done
    }`;
    writeFileSync(join(dir, "p.dot"), dot);
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const d = diags.find(
      x => x.rule === "unknown_source_node" && /Gate "tmux_confirm_gate"/.test(x.message),
    );
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/source node "implement"/);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "errors when gate inputs reference a non-existent node"`
Expected: FAIL — `expect(d).toBeDefined()` reports `received: undefined`. (The current validator only fires `unknown_source_node` on agent inputs, so no diagnostic with `Gate "tmux_confirm_gate"` exists.)

### Task 2.2: Implement `checkGateUnknownSourceNode` and wire into `run(ctx)`

**Files:**
- Modify: `src/attractor/core/validators/inputs-refs.ts:44-50` (the Block D dispatcher) and append a new rule function

- [ ] **Step 3: Add `checkGateUnknownSourceNode` immediately above `iterateGateInputs` (or wherever neighbours read well — keep file-local helpers grouped)**

```ts
function checkGateUnknownSourceNode(ctx: ValidationContext): void {
  iterateGateInputs(ctx, ({ gateNodeId, resolved, gateNode }) => {
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
```

- [ ] **Step 4: Insert into Block D immediately before `checkOrphanOutput`**

Edit `src/attractor/core/validators/inputs-refs.ts:44-50` so Block D reads:

```ts
// Block D — non-loop calls.
if (ctx.dotDir) {
  checkMissingInputProducer(ctx);
  checkInputTypeMismatch(ctx);
  checkGateUnknownSourceNode(ctx);
  checkOrphanOutput(ctx);
  checkOutputsSchemaShape(ctx);
}
```

Insertion order is named by §3.4 of the design — placing it immediately before `checkOrphanOutput` keeps any future snapshot delta contiguous.

- [ ] **Step 5: Re-run the failing test to confirm it now passes**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "errors when gate inputs reference a non-existent node"`
Expected: PASS.

- [ ] **Step 6: Run the full `graph-validator-inputs` suite**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts`
Expected: PASS — both the new gate case and every existing agent case stay green.

### Task 2.3: Regenerate the byte-identical snapshot

**Files:**
- Modify: `src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap`

- [ ] **Step 7: Regenerate the snapshot**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts -u`
Expected: PASS — snapshot file updated. ADR-0009 names this break-and-regenerate as the contract when rules are added.

- [ ] **Step 8: Inspect the snapshot diff before committing**

Run: `git diff src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap`
Expected: per the verifier's confirmation (no current bundled hexagon gate declares a stale `inputs:` ref against a missing node), the diff should be **empty**. If any new `unknown_source_node` lines appear, that means a real bundled stale-ref slipped through — investigate the named gate before continuing. Either:
- (a) it is a real bug → fix the gate in the same PR; or
- (b) it is intentional (e.g. a fixture deliberately exercising a broken graph) → accept the snapshot change.

- [ ] **Step 9: Run the full validator regression suite**

Run: `npx vitest run src/attractor/tests/`
Expected: PASS.

- [ ] **Step 10: Run the bundled-pipelines self-sufficient suite**

Run: `npx vitest run src/cli/tests/bundled-pipelines-self-sufficient.test.ts`
Expected: PASS — verifier confirmed no current bundled gate trips this rule.

- [ ] **Step 11: Smoke the post-fix incident artifact**

Run: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot`
Expected: exit 0, `✔ Pipeline valid …`. The post-fix `tmux_confirm_gate.md` declares only valid source nodes (`run_id`, `batch_orchestrator.*`, `tmux_tester.*`), so the new rule does not fire.

- [ ] **Step 11b: Type-check before committing**

Run: `npx tsc --noEmit`
Expected: clean. Catches any type drift introduced by the new rule function.

- [ ] **Step 12: Commit**

```bash
git add src/attractor/core/validators/inputs-refs.ts \
        src/attractor/tests/graph-validator-inputs.test.ts \
        src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap
git commit -m "feat(validators/inputs-refs): unknown_source_node fires on gate inputs

Add checkGateUnknownSourceNode using iterateGateInputs from Chunk 1. The
existing rule template (rule: \"unknown_source_node\", severity: error)
now covers both agent and gate surfaces — the gate-side diagnostic
message uses 'Gate \"<id>\"' instead of 'Agent \"<name>\"' to disambiguate.

Wired into run(ctx) Block D immediately before checkOrphanOutput so the
byte-identical snapshot delta stays contiguous. Regression test mirrors
the 2026-05-11 incident: tmux_confirm_gate.md declaring
inputs: [implement.done] against a graph with only batch_orchestrator.

Refs: docs/superpowers/specs/2026-05-12-validator-skips-gate-input-refs-design.md §3.3, §3.4"
```

## Verification targets

- Smokes: None (validator-only, no pipeline behaviour change beyond exit-code refinement)
- Manual exercises:
  - Reproduce the incident in a scratch dir per Task 2.1 — confirm exit 1 with the new diagnostic
  - `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot` → expect exit 0
- Lint: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts`, `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`, `npx vitest run src/cli/tests/bundled-pipelines-self-sufficient.test.ts`, `npx tsc --noEmit`
- Surfaces touched: `attractor/validators`

---

## Chunk 3: Add gate-side `source_missing_output_key` + audit bundled gates

**Intent:** Close the second half of the gate-surface coverage — when a gate's `inputs:` decl names a source node that exists but doesn't declare the named output key. Same TDD shape as Chunk 2. After the rule lands, run the bundled+project gate audit named in §4.4 of the design to confirm no further stale refs are hiding.

### Task 3.1: Failing regression test — gate references a non-existent output key on an existing producer

**Files:**
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts:110-…` (the existing `describe("validator — source_missing_output_key")` block)

- [ ] **Step 1: Add a failing case at the end of the `source_missing_output_key` describe block**

Insert before the block's closing `});`:

```ts
  it("errors when gate inputs request a key not in producer outputs:", () => {
    const dir = join(tmpdir(), `rule-smok-gate-${Date.now()}`);
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
inputs: [producer.bar]
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
    const d = diags.find(
      x => x.rule === "source_missing_output_key" && /Gate "my_gate"/.test(x.message),
    );
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.message).toMatch(/producer\.bar/);
    expect(d!.message).toMatch(/"bar"/);
    expect(d!.message).toMatch(/outputs:/);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "errors when gate inputs request a key not in producer outputs:"`
Expected: FAIL — no diagnostic with `Gate "my_gate"` and `rule: "source_missing_output_key"` exists. (The agent-surface variant doesn't reach gate nodes today.)

### Task 3.2: Implement `checkGateSourceMissingOutputKey` and wire it in

**Files:**
- Modify: `src/attractor/core/validators/inputs-refs.ts` — add the new rule function and a second line in Block D

- [ ] **Step 3: Add `checkGateSourceMissingOutputKey` next to `checkGateUnknownSourceNode`**

```ts
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

The tool-branch and agent-branch mirror the agent-surface logic at `src/attractor/core/validators/inputs-refs.ts:234-258`. `tryResolveAgent` is already imported at `:4`.

- [ ] **Step 4: Wire into Block D immediately after `checkGateUnknownSourceNode`**

Block D should now read:

```ts
if (ctx.dotDir) {
  checkMissingInputProducer(ctx);
  checkInputTypeMismatch(ctx);
  checkGateUnknownSourceNode(ctx);
  checkGateSourceMissingOutputKey(ctx);
  checkOrphanOutput(ctx);
  checkOutputsSchemaShape(ctx);
}
```

- [ ] **Step 5: Re-run the failing test to confirm it now passes**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts -t "errors when gate inputs request a key not in producer outputs:"`
Expected: PASS.

- [ ] **Step 6: Run the full `graph-validator-inputs` suite**

Run: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts`
Expected: PASS — every case green.

### Task 3.3: Regenerate the byte-identical snapshot and audit bundled gates

**Files:**
- Modify (possibly): `src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap`

- [ ] **Step 7: Regenerate the snapshot**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts -u`
Expected: PASS.

- [ ] **Step 8: Inspect the snapshot diff**

Run: `git diff src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap`
Expected: empty diff (verifier confirmed no current bundled hexagon gate has a stale `inputs:` ref against a missing output key). If any new `source_missing_output_key` lines appear, treat exactly as Chunk 2 Step 8: real bug → fix in this PR; intentional fixture → accept snapshot.

- [ ] **Step 9: Audit bundled and project-local gates**

Run the audit script named in design §4.4. Use the Bash tool with the following one-liner (avoids global grep on the whole repo):

```bash
# List every gate frontmatter that declares `inputs:`, plus its sibling pipeline.dot.
# Captures both inline-array form (`inputs: [a, b]`) and YAML block-list form
# (`inputs:\n  - a\n  - b`).
for f in $(grep -lR --include='*.md' '^type: gate$' src/cli/pipelines .apparat/pipelines 2>/dev/null); do
  inputs=$(awk '
    /^---$/ { p++; next }
    p == 1 && /^inputs:/ { capture = 1; print; next }
    p == 1 && capture && /^[[:space:]]+-/ { print; next }
    p == 1 && capture && /^[^[:space:]]/ { capture = 0 }
  ' "$f")
  [ -n "$inputs" ] && echo "GATE: $f
  $inputs
  SIBLING_DOT: $(dirname "$f")/pipeline.dot"
done
```

Expected output:
- Either **no GATE: lines** (nothing to audit), or
- Each listed gate's `inputs:` qualified-source-nodes (the `X` in `X.key`) must appear as nodes in the sibling `pipeline.dot`. Sanity-check by eye. The post-fix `.apparat/pipelines/parallel-illumination-to-implementation/tmux_confirm_gate.md:6-12` is the reference shape (`run_id`, `batch_orchestrator.*`, `tmux_tester.*` — all present).

If the audit surfaces a stale ref, that pipeline's `apparat pipeline validate` will now fail; fix the gate in this same PR before continuing. If everything is clean, log "audit: 0 stale refs" in the commit body for the next reviewer.

- [ ] **Step 10: Validate the post-fix incident artifact**

Run: `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot`
Expected: exit 0, `✔ Pipeline valid …`.

- [ ] **Step 11: Validate every bundled pipeline**

Run: `npx vitest run src/cli/tests/bundled-pipelines-self-sufficient.test.ts`
Expected: PASS.

- [ ] **Step 12: Full vitest sweep**

Run: `npx vitest run`
Expected: PASS — no regressions vs. `main` (modulo any pre-existing flakes).

- [ ] **Step 13: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 14: Grep invariants from design §8**

Quick post-merge sanity, run each:

```bash
grep -n "iterateGateInputs" src/attractor/core/validators/inputs-refs.ts | wc -l   # ≥ 3
grep -nE "checkGateUnknownSourceNode|checkGateSourceMissingOutputKey" src/attractor/core/validators/inputs-refs.ts | wc -l   # ≥ 4 (2 defs + 2 dispatch calls)
grep -nE 'rule: "unknown_source_node"' src/attractor/core/validators/inputs-refs.ts | wc -l   # ≥ 2
grep -nE 'rule: "source_missing_output_key"' src/attractor/core/validators/inputs-refs.ts | wc -l   # ≥ 4
```

Expected: each count meets the design's `≥ N` constraint.

- [ ] **Step 15: Commit**

```bash
git add src/attractor/core/validators/inputs-refs.ts \
        src/attractor/tests/graph-validator-inputs.test.ts \
        src/attractor/tests/__snapshots__/graph-validator-byte-identical.test.ts.snap
git commit -m "feat(validators/inputs-refs): source_missing_output_key fires on gate inputs

Add checkGateSourceMissingOutputKey reusing iterateGateInputs. Mirrors the
agent-surface tool/agent branch logic at inputs-refs.ts:234-258; gate-side
diagnostic message uses 'Gate \"<id>\"' prefix for disambiguation.

Wired into run(ctx) Block D immediately after checkGateUnknownSourceNode.
Regenerated byte-identical snapshot (audit: 0 stale refs across bundled
and project-local gates).

Closes the gap from run parallel-illumination-to-implementation-df1d9cf6
where pipeline validate returned green on a stale gate input ref, then
crashed at run time with 'Undefined variable \$implement.done'.

Refs: docs/superpowers/specs/2026-05-12-validator-skips-gate-input-refs-design.md §3.3, §4.4"
```

### Task 3.4 (optional): Docs ripple

Design §6 lists three docs touch-ups as **optional**. The implementing session may include or defer them; if deferred, log as a follow-up under §9 of the design rather than dropping silently.

- [ ] **(optional) Step 16: Update `CONTEXT.md`**

If the file has a validator rule list, add a sub-bullet noting that `unknown_source_node` and `source_missing_output_key` fire on both agent and gate `inputs:` surfaces.

- [ ] **(optional) Step 17: Update `docs/adr/0012-validation-context.md`**

Short appendix mentioning the gate-input rules extend the `inputs-refs.ts` cluster with the same diagnostic shapes — no new cluster file, no new ADR.

- [ ] **(optional) Step 18: Update `README.md` rule-list section**

Two-surface wording for `unknown_source_node` and `source_missing_output_key` if the README enumerates rules.

- [ ] **(optional) Step 19: Commit docs**

```bash
git add CONTEXT.md docs/adr/0012-validation-context.md README.md
git commit -m "docs: note unknown_source_node/source_missing_output_key cover gate inputs"
```

## Verification targets

- Smokes: None (no scenario folder needed per design §6: "The byte-identical oracle + the unit test cover the rule's surface end-to-end; a `.apparat/scenarios/` folder would be additive noise for a presentation-only validator change.")
- Manual exercises:
  - Reproduce the missing-output-key shape per Task 3.1 → expect exit 1 with the new diagnostic
  - Run the §4.4 audit script — expect 0 stale refs, or fix any surfaced refs in this PR
  - `npx tsx src/cli/index.ts pipeline validate .apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot` → expect exit 0
- Lint: `npx vitest run src/attractor/tests/graph-validator-inputs.test.ts`, `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`, `npx vitest run src/cli/tests/bundled-pipelines-self-sufficient.test.ts`, `npx vitest run`, `npx tsc --noEmit`
- Surfaces touched: `attractor/validators`

---

## Open questions (from design §9)

- **One rule function vs. two.** Design §3.3 splits into `checkGateUnknownSourceNode` and `checkGateSourceMissingOutputKey` to mirror the agent-side decomposition. The implementing session may inline both into a single `checkGateInputRefs(ctx)` walker — both shapes preserve `run(ctx)` emission order. The plan ships with the two-function shape per the design; collapse only if the reviewer flags it.
- **Audit-script materialisation.** Task 3.3 Step 9 lands the audit as a one-shot pre-merge check, not as a permanent test. If a future incident shows bundled gates drifting, promote it to a vitest under `src/cli/tests/bundled-pipelines-self-sufficient.test.ts`.
- **Optional docs ripple.** Tasks 3.4 Steps 16-19 are explicitly optional. If deferred, leave a follow-up note rather than silently dropping.
