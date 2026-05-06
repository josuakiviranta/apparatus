# Design: Promote a single `isInteractiveAgent(node)` predicate, dedupe four open-coded sites

**Date:** 2026-05-06
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T1425-interactive-agent-predicate-duplicated.md`

## 1. Motivation

The runtime rule "is this node an interactive agent?" is open-coded verbatim in four sites across three modules, plus two negated mirrors. The same DOT-attribute coercion (`=== true || === "true"`) is repeated six times with no shared seam:

- `src/attractor/handlers/agent-dispatch.ts:12` — handler dispatch:
  ```typescript
  const isInteractive = node.interactive === true || node.interactive === "true";
  ```
- `src/cli/lib/classifyNode.ts:35` — renderer block-kind classifier:
  ```typescript
  const interactive = node.interactive === true || node.interactive === "true";
  return interactive ? "interactive-agent" : "agent";
  ```
- `src/attractor/core/graph-validator.ts:970` — `checkAgentMissingOutputs` exemption:
  ```typescript
  if (node.interactive === true || node.interactive === "true") return;
  ```
- `src/attractor/core/graph-validator.ts:1003` — `checkLoopRequiresDoneField` exemption (same form).
- `src/attractor/core/graph-validator.ts:1032` — `checkInteractiveWithOutputs` (negated mirror):
  ```typescript
  if (node.interactive !== true && node.interactive !== "true") return;
  ```
- `src/attractor/core/graph-validator.ts:1051` — `checkInteractiveWithLoop` (negated mirror, same form).

The DOT-attribute coercion is itself a domain rule. DOT attributes parse as strings; the zod union at `src/attractor/core/schemas.ts:26` permits `z.boolean() | z.literal("true") | z.literal("false")`, so every reader must coerce. A future tightening that forces `node.interactive: boolean` at parse time would need every duplicate updated; missing one becomes a silent renderer/handler/validator split — the kind of bug that ships because the rule has six homes.

Three forces converge:

1. **Locality.** "What does interactive mean at runtime?" requires reading three modules to confirm they agree. There is no canonical predicate to point at.
2. **Drift surface.** Four positive forms + two negated mirrors. Any tightening of the underlying type forces six edits; any one missed produces silent disagreement between handler dispatch, renderer classification, and the validator's exemption rules.
3. **Project direction.** ADR-0009 (parser-validator split, accepted 2026-05-05) and ADR-0001 (single-purpose modules) establish a strong two-week pattern of pulling single-purpose seams out of overloaded modules — `graph-validator.ts` was extracted from `graph.ts`, `pipelineRunCommand` / `pipelineShowCommand` were extracted from `pipeline.ts`. This design applies the same pattern at predicate granularity.

The illumination phrases this as "two duplicates." The verifier surfaced it as quadruple, plus two negated mirrors. The fix is the same in either framing: name the rule once, import it everywhere.

## 2. Decision Summary

1. **Add `isInteractiveAgent(node: Node): boolean` next to `resolveHandlerType` in `src/attractor/core/graph.ts`.** It owns the DOT string-vs-boolean coercion and is the single canonical reader of `node.interactive`. Co-located with `resolveHandlerType` because both are node-shape predicates over the same parsed-graph surface; both are the seam between the parser and downstream consumers.

2. **Replace four positive call sites** with `isInteractiveAgent(node)`:
   - `src/attractor/handlers/agent-dispatch.ts:12`
   - `src/cli/lib/classifyNode.ts:35`
   - `src/attractor/core/graph-validator.ts:970`
   - `src/attractor/core/graph-validator.ts:1003`

3. **Replace two negated call sites** with `!isInteractiveAgent(node)`:
   - `src/attractor/core/graph-validator.ts:1032`
   - `src/attractor/core/graph-validator.ts:1051`

   The negated migrations are not "optional follow-up" as the explainer-render hedged — they are part of the same dedupe and land in the same commit. Leaving them open-coded preserves the drift surface this design is meant to remove. (See §7.1 for why this differs from the explainer's framing.)

4. **Keep the existing `isInteractive(node)` export at `src/cli/lib/classifyNode.ts:51-53` as a thin wrapper** that delegates to `classifyNode(node) === "interactive-agent"`. It is consumed only by `src/cli/tests/classifyNode.test.ts:2,57-61` and asserts a renderer-classifier identity ("after running the full classify, did this come out as interactive-agent?"), which is a stronger property than the bare predicate. The new `isInteractiveAgent` is the predicate over `node.interactive` alone; `isInteractive` is the predicate over the full classifyNode pipeline. Two functions, two distinct properties, both kept.

5. **Add a focused unit test `src/attractor/tests/graph-is-interactive-agent.test.ts`** that pins the predicate's behaviour: `true` boolean → true, `"true"` string → true, `false` boolean → false, `"false"` string → false, `undefined` → false. The existing tests at `src/cli/tests/classifyNode.test.ts`, `src/attractor/tests/agent-dispatch.test.ts`, `src/attractor/tests/agent-handler-interactive.test.ts`, `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts`, and `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` exercise the integrated behaviour and continue to pass unchanged through the new seam.

6. **No behaviour change.** No CLI flag, command name, validator rule id, validator message, agent rubric, frontmatter shape, or pipeline `.dot` syntax changes. The zod union at `src/attractor/core/schemas.ts:26` is preserved exactly — the predicate accepts the same three values it accepts today.

7. **Atomic landing.** All four positive sites + two negated sites + the new export + the new test land in one merge. A staged rollout (e.g., land the seam, migrate one caller per follow-up) would create an interim state where some readers route through the predicate and others don't — the exact drift surface the design removes. One developer, one machine; no cohort needs an interim commit.

## 3. Architecture

### 3.1 Before/after

```
Before                                           After
──────                                           ─────
src/attractor/core/graph.ts (33 LOC)             src/attractor/core/graph.ts (~45 LOC)
  parseDot                                          parseDot
  KNOWN_TYPES                                       KNOWN_TYPES
  UNIMPLEMENTED_TYPES                               UNIMPLEMENTED_TYPES
  SHAPE_TO_TYPE                                     SHAPE_TO_TYPE
  resolveHandlerType                                resolveHandlerType
                                                    isInteractiveAgent ◀── new

src/attractor/handlers/agent-dispatch.ts:12      src/attractor/handlers/agent-dispatch.ts
  const isInteractive = node.interactive          import { isInteractiveAgent } from
    === true || node.interactive === "true";         "../core/graph.js";
                                                  isInteractiveAgent(node)

src/cli/lib/classifyNode.ts:35                   src/cli/lib/classifyNode.ts
  const interactive = node.interactive             import { isInteractiveAgent } from
    === true || node.interactive === "true";         "../../attractor/core/graph.js";
  return interactive ? "interactive-agent"        return isInteractiveAgent(node)
                     : "agent";                     ? "interactive-agent" : "agent";

src/attractor/core/graph-validator.ts:970,1003   src/attractor/core/graph-validator.ts
  if (node.interactive === true ||                  import { isInteractiveAgent } from
      node.interactive === "true") return;             "./graph.js";
                                                    if (isInteractiveAgent(node)) return;

src/attractor/core/graph-validator.ts:1032,1051  src/attractor/core/graph-validator.ts
  if (node.interactive !== true &&                  if (!isInteractiveAgent(node)) return;
      node.interactive !== "true") return;
```

### 3.2 `isInteractiveAgent()` contract

```ts
// src/attractor/core/graph.ts

import type { Node } from "../types.js";

/**
 * Canonical predicate for the "interactive agent" runtime rule.
 *
 * DOT attributes parse as strings; the schema (src/attractor/core/schemas.ts:26)
 * accepts boolean, "true", or "false". This predicate is the single reader of
 * that union. All call sites — handler dispatch, renderer classification,
 * validator exemptions — import it.
 *
 * Returns true iff node.interactive is the boolean true OR the string "true".
 * Returns false for: undefined, null, false, "false", or any other value.
 */
export function isInteractiveAgent(node: Node): boolean {
  return node.interactive === true || node.interactive === "true";
}
```

The predicate is intentionally minimal. It does *not* check `node.agent`, `node.type`, or invoke `resolveHandlerType` — its sole job is to read `node.interactive` against the schema's union. Existing call-site preconditions stay where they are: `agent-dispatch.ts` is wired into the registry by handler-type upstream and only runs against agent nodes; `classifyNode.ts:32` calls `resolveHandlerType` first and only consults the predicate when `t === "agent"`; the validator checks at `:967,1002,1031,1050` all guard `if (!node.agent) return;` before consulting the predicate. The predicate composes cleanly with each guard.

### 3.3 Co-location rationale: `graph.ts` vs handler dispatch

The verifier flagged a project-fit caveat: ADR-0009 narrows `graph.ts` to *parsing*. A strict reading would place the predicate next to handler dispatch (`src/attractor/handlers/`) instead. This design places it next to `resolveHandlerType` because:

- `resolveHandlerType` is itself a node-shape predicate — same surface as `isInteractiveAgent`. ADR-0009's "parsing only" narrowing is best read as "no validation logic," not "no node-shape readers." `resolveHandlerType` predates ADR-0009 and survived the parser/validator split intact.
- The four downstream call sites span three modules (handlers, cli/lib, core/validator). Placing the predicate in any one of them creates an asymmetric import graph — two modules cross-import from the third. `graph.ts` is already imported by all three.
- The schema union the predicate reads against lives at `src/attractor/core/schemas.ts:26` — same package, same module group. `graph.ts` is the natural sibling.

If a follow-up refines `graph.ts` further into a strict parser-only module (per ADR-0009's spirit), the predicate moves to `src/attractor/core/node-predicates.ts` (or similar) alongside `resolveHandlerType`. Both predicates move together; this design does not pre-empt that decision.

### 3.4 Surfaces unchanged

- `Node` type (`src/attractor/types.ts`). Unchanged.
- `node.interactive` zod union at `src/attractor/core/schemas.ts:26` (`z.union([z.boolean(), z.literal("true"), z.literal("false")])`). Unchanged — the predicate preserves the exact accepted-values set.
- All validator rule ids and messages: `agent_missing_outputs`, `loop_missing_done_field`, `interactive_with_outputs_forbidden`, `interactive_with_loop_forbidden`. Unchanged.
- `AgentHandlerDispatch` constructor signature, registry wiring at handler dispatch upstream. Unchanged.
- `BlockKind` union and `classifyNode` return values. Unchanged.
- `isInteractive(node)` export at `src/cli/lib/classifyNode.ts:51-53`. Preserved as a wrapper over `classifyNode`; not deleted.
- CLI flags, command names, exit codes, stdout/stderr formatting. Unchanged.
- Agent rubric / frontmatter schema, pipeline `.dot` syntax. Unchanged.

### 3.5 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Predicate seam | `src/attractor/core/graph.ts` | Inline edit — add `isInteractiveAgent` export (~6 LOC + JSDoc) |
| Call-site replacements (positive) | `src/attractor/handlers/agent-dispatch.ts:12`; `src/cli/lib/classifyNode.ts:35`; `src/attractor/core/graph-validator.ts:970,1003` | Inline edit — replace open-coded predicate with `isInteractiveAgent(node)` |
| Call-site replacements (negated) | `src/attractor/core/graph-validator.ts:1032,1051` | Inline edit — replace with `!isInteractiveAgent(node)` |
| New unit test | `src/attractor/tests/graph-is-interactive-agent.test.ts` | **New** — pins predicate behaviour over the schema union |
| Existing tests | `src/cli/tests/classifyNode.test.ts`; `src/attractor/tests/agent-handler-interactive.test.ts`; `src/attractor/tests/interactive-agent-handler.test.ts`; `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts`; `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` | **No edit** — they exercise integrated behaviour through the call sites and pass unchanged |
| Docs | None | No ADR / CONTEXT / README / VISION changes — JSDoc on the predicate suffices (ADR-0004 source-as-truth) |

### 3.6 LOC sanity check

| File | Before | After | Δ |
|---|---|---|---|
| `src/attractor/core/graph.ts` | 33 | ~45 | +12 (export + JSDoc) |
| `src/attractor/handlers/agent-dispatch.ts` | 17 | 17 | 0 (one-line replacement + import) |
| `src/cli/lib/classifyNode.ts` | 53 | 53 | 0 (one-line replacement + import) |
| `src/attractor/core/graph-validator.ts` | 1156 | ~1152 | -4 (six replacements collapse 12 long lines into 6 short ones) |
| `src/attractor/tests/graph-is-interactive-agent.test.ts` | — | ~30 | +30 |
| **Total** | | | **+38** |

Net +38 LOC dominated by the new test. The implementation files net to roughly zero — six duplicates collapse, one new export emerges.

## 4. Components & file edits

### 4.1 `src/attractor/core/graph.ts` (inline edit)

Append after `resolveHandlerType` (currently `:28-33`):

```ts
/**
 * Canonical predicate for the "interactive agent" runtime rule.
 *
 * DOT attributes parse as strings; the schema (src/attractor/core/schemas.ts:26)
 * accepts boolean, "true", or "false". This predicate is the single reader of
 * that union — call sites import it instead of re-coding the coercion.
 *
 * @returns true iff node.interactive is boolean true or string "true".
 */
export function isInteractiveAgent(node: Node): boolean {
  return node.interactive === true || node.interactive === "true";
}
```

`Node` is already imported at `src/attractor/core/graph.ts:1`.

### 4.2 `src/attractor/handlers/agent-dispatch.ts` (inline edit)

Add the import line, then replace `:12-15`:

```ts
import { isInteractiveAgent } from "../core/graph.js";
// …existing code…

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    return isInteractiveAgent(node)
      ? this.interactive.execute(node, ctx, meta)
      : this.looping.execute(node, ctx, meta);
  }
```

The `// DOT attributes parse as strings; coerce explicitly to boolean.` comment (currently at `:11`) is removed — the predicate's JSDoc owns the explanation now.

### 4.3 `src/cli/lib/classifyNode.ts` (inline edit)

Replace `:35-37` and add the predicate to the existing import on `:2`:

```ts
import { isInteractiveAgent, resolveHandlerType } from "../../attractor/core/graph.js";
// …existing code…

  if (t === "agent") {
    return isInteractiveAgent(node) ? "interactive-agent" : "agent";
  }
```

The `isInteractive` export at `:51-53` (a wrapper over `classifyNode`) is left intact — see §2.4.

### 4.4 `src/attractor/core/graph-validator.ts` (four inline edits)

Add the predicate to the existing graph-module import (verifier confirms it currently imports from `./graph.js` for other symbols), then four replacements:

| Line | Before | After |
|---|---|---|
| `:970` | `if (node.interactive === true \|\| node.interactive === "true") return;` | `if (isInteractiveAgent(node)) return;` |
| `:1003` | `if (node.interactive === true \|\| node.interactive === "true") return;` | `if (isInteractiveAgent(node)) return;` |
| `:1032` | `if (node.interactive !== true && node.interactive !== "true") return;` | `if (!isInteractiveAgent(node)) return;` |
| `:1051` | `if (node.interactive !== true && node.interactive !== "true") return;` | `if (!isInteractiveAgent(node)) return;` |

The `// Interactive agents are exempt — they produce chat.output implicitly.` comment at `:969` stays — it explains *why* the exemption exists, which is orthogonal to the predicate. The predicate explains *how* "interactive" is detected; the comment explains *what* the exemption does.

The truthy check at `src/attractor/core/graph-validator.ts:215` (`if (node.interactive) produced.add("chat.output");`) is **out of scope**. It is a different rule — "any truthy value, including arbitrary strings" — used in the produced-keys debug seam. Forcing it through the strict predicate could alter `produced` for malformed inputs that are currently tolerated. See §7.3.

### 4.5 `src/attractor/tests/graph-is-interactive-agent.test.ts` (new)

```ts
import { describe, it, expect } from "vitest";
import { isInteractiveAgent } from "../core/graph.js";
import type { Node } from "../types.js";

const node = (over: Partial<Node>): Node => ({ id: "n", ...over } as Node);

describe("isInteractiveAgent", () => {
  it("returns true for boolean true", () => {
    expect(isInteractiveAgent(node({ interactive: true }))).toBe(true);
  });
  it("returns true for string 'true'", () => {
    expect(isInteractiveAgent(node({ interactive: "true" as never }))).toBe(true);
  });
  it("returns false for boolean false", () => {
    expect(isInteractiveAgent(node({ interactive: false }))).toBe(false);
  });
  it("returns false for string 'false'", () => {
    expect(isInteractiveAgent(node({ interactive: "false" as never }))).toBe(false);
  });
  it("returns false for undefined", () => {
    expect(isInteractiveAgent(node({}))).toBe(false);
  });
});
```

The test mirrors the schema union at `src/attractor/core/schemas.ts:26` exactly. If the schema tightens, the test surfaces the gap before any of the four call sites silently disagree.

## 5. Data flow

### 5.1 Before — six readers, no shared seam

```
node.interactive (DOT attribute, string-or-boolean per schema:26)
  ├─ agent-dispatch.ts:12    ─ open-coded coercion ─ pick handler
  ├─ classifyNode.ts:35      ─ open-coded coercion ─ pick block kind
  ├─ graph-validator.ts:970  ─ open-coded coercion ─ exempt from agent_missing_outputs
  ├─ graph-validator.ts:1003 ─ open-coded coercion ─ exempt from loop_missing_done_field
  ├─ graph-validator.ts:1032 ─ open-coded NEGATED  ─ guard for interactive_with_outputs_forbidden
  └─ graph-validator.ts:1051 ─ open-coded NEGATED  ─ guard for interactive_with_loop_forbidden
```

### 5.2 After — one predicate, six callers

```
node.interactive
  └─ isInteractiveAgent(node)  ◀── src/attractor/core/graph.ts
       ├─ agent-dispatch.ts:12    ─ pick handler
       ├─ classifyNode.ts:35      ─ pick block kind
       ├─ graph-validator.ts:970  ─ exempt from agent_missing_outputs
       ├─ graph-validator.ts:1003 ─ exempt from loop_missing_done_field
       ├─ graph-validator.ts:1032 ─ guard (negated) for interactive_with_outputs_forbidden
       └─ graph-validator.ts:1051 ─ guard (negated) for interactive_with_loop_forbidden
```

The coercion from DOT-attribute to boolean happens in exactly one place. Future tightening of the schema (e.g., dropping the `"true"` string literal) is a one-line edit at the predicate plus a one-line edit at `schemas.ts:26`; no call site needs to change.

## 6. Blast radius / impact surface

- **Size:** **S** — pure dedupe of an existing rule, no new surface area.
- **Files touched:** 5 source files + 1 new test = 6 files.
  - 1 export (graph.ts), 6 inline call-site replacements across 3 modules (agent-dispatch.ts, classifyNode.ts, graph-validator.ts), 1 new test file.
- **Surfaces crossed:** 3 internal modules — `attractor/handlers/` + `cli/lib/` + `attractor/core/`. All internal.
- **Breaking changes:** **no.**
  - Zero CLI flag, command name, exit code, stdout/stderr changes.
  - Zero agent rubric / frontmatter schema changes.
  - Zero validator rule-id or message changes.
  - `node.interactive` zod union at `src/attractor/core/schemas.ts:26` preserved exactly — the predicate accepts the same three values today and after.
  - The pre-existing `isInteractive` export at `src/cli/lib/classifyNode.ts:51-53` is preserved (different semantics — full-classifier identity vs raw predicate). Test imports unchanged.
- **Spec / docs ripple:**
  - [ ] No ADR required. ADR-0001 (single-purpose modules) and ADR-0009 (parser-validator split) are the precedent; this design is an *application* of those, not a new principle.
  - [ ] No CONTEXT.md, README, AGENTS.md, or VISION.md change. ADR-0004 (source-as-truth) bans behavioural specs; the predicate's JSDoc carries the rule.
  - [ ] No design-doc cross-references — the illumination is the only existing reference.
- **Test ripple:**
  - [ ] **New** `src/attractor/tests/graph-is-interactive-agent.test.ts` — pins predicate behaviour over the schema union.
  - [ ] No edits to existing tests:
    - `src/cli/tests/classifyNode.test.ts` — covers `classifyNode` and the `isInteractive` wrapper end-to-end.
    - `src/attractor/tests/agent-handler-interactive.test.ts` and `src/attractor/tests/interactive-agent-handler.test.ts` — cover `AgentHandlerDispatch` routing.
    - `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts` and `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` — cover the four validator rules whose guards now route through the predicate.
    - All five exercise the integrated behaviour through the call sites and pass unchanged because the predicate is semantically identical to the open-coded form it replaces.

## 7. Trade-offs

### 7.1 Negated mirrors: in-scope vs deferred

The explainer-render the user approved at the gate listed the negated migrations at `graph-validator.ts:1032/1051` as **out of scope** ("Out: optional negated-mirror migrations"). This design pulls them **into scope** for the same commit.

**Why the shift:** The illumination's central claim is that the rule has multiple homes and any one missed produces silent disagreement. Leaving the negated mirrors open-coded preserves the exact drift surface the design removes — the next schema tightening still has to find and update two unmentioned call sites. The negated form is also trivial to migrate (`!isInteractiveAgent(node)`), so the cost-to-clarity ratio strongly favours including them.

**Alignment with the explainer's promise:** The explainer-render's "What changes" section describes "one named predicate `isInteractiveAgent(node)` exported once; every call site imports it." Including the negated mirrors *fulfils* that promise; excluding them weakens it. The "Scope" section's "out: optional negated-mirror migrations" was a hedge in case the migration turned out to be tricky; a closer read of `graph-validator.ts:1032,1051` shows it is mechanical. This design replaces the hedge with the commitment that fits the illumination's intent.

This is the kind of explainer-to-design refinement the procedure invites: "elaborate, don't contradict." The shift is from "two negated mirrors *might* migrate" to "two negated mirrors *do* migrate" — same direction, sharper commitment.

### 7.2 Co-location: `graph.ts` vs `handler-dispatch.ts` vs new file

Three placements were considered:

- **`graph.ts` next to `resolveHandlerType`** (chosen). Already a node-shape-predicate module; already imported by all three call-site modules. Symmetric import graph. ADR-0009 caveat addressed in §3.3.
- **`handlers/agent-dispatch.ts` exporting the predicate.** Aligns with the verifier's strict-ADR-0009 reading. Forces `cli/lib/` and `core/graph-validator.ts` to import from `handlers/` — an asymmetric import direction (validator depending on handler dispatch). Rejected.
- **New `src/attractor/core/node-predicates.ts`.** Cleaner if there were many predicates, but with two predicates total (`resolveHandlerType` + `isInteractiveAgent`) it is premature splitting. `graph.ts` is small (33 LOC); growing to ~45 LOC is comfortable. Rejected for now; the file can split if a third predicate joins.

### 7.3 Truthy check at `graph-validator.ts:215`: out of scope

The line `if (node.interactive) produced.add("chat.output");` (`src/attractor/core/graph-validator.ts:215`) uses a different rule — JavaScript truthiness, not the strict `=== true || === "true"` coercion. It accepts arbitrary truthy values (e.g., a stray non-empty string) where the strict predicate would reject them.

Replacing the truthy check with `isInteractiveAgent(node)` would be a behaviour change: malformed inputs that currently produce `chat.output` in the debug-seam tracker would stop doing so. That may be the right behaviour, but it is a separate decision with its own design surface. Out of scope for this dedupe; the illumination targets the four (positive) + two (negated) sites only.

### 7.4 Atomic vs staged

Staged (land the predicate first; migrate one caller per follow-up) was considered and rejected. Each interim commit produces drift between sites that route through the seam and sites that don't — the exact drift surface the design removes. The migration is mechanical (six search-and-replace edits + one new file), so atomic is the lower-risk path.

### 7.5 Preserve `isInteractive` wrapper vs delete and inline

`src/cli/lib/classifyNode.ts:51-53` exports `isInteractive(node)` consumed only by `src/cli/tests/classifyNode.test.ts:2,57-61`. Three options:

- **Preserve** (chosen). It encodes a *different property* — "after running the full classifyNode, did this come out as interactive-agent?" — which is stronger than the bare predicate. The test asserts this stronger property; rewriting tests to consume `isInteractiveAgent` instead would lose coverage of the classifier's wiring.
- **Delete and rewrite tests** to use `isInteractiveAgent`. Reduces surface but loses the integration assertion. Rejected.
- **Reimplement `isInteractive` to delegate to `isInteractiveAgent`**. Tempting, but the current implementation goes through `classifyNode` first, which catches markers and other shapes before reaching the predicate. Replacing with a direct `isInteractiveAgent` call would silently change behaviour for marker-shaped nodes that happen to carry `interactive=true`. Rejected.

The two functions live alongside each other: `isInteractiveAgent` is the raw schema reader; `isInteractive` is the post-classifier identity.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — five existing test files plus the new `graph-is-interactive-agent.test.ts`.
  - All validator rule ids and messages produce byte-identical output for the same inputs.
  - `apparat pipeline run`, `validate`, `show` produce byte-identical TUI/stderr/stdout for any pipeline mixing interactive and non-interactive agent nodes.
- Repo-wide grep invariants post-merge:
  - `grep -rn 'node\.interactive === true' src/` returns **one** hit: `src/attractor/core/graph.ts` (inside `isInteractiveAgent`).
  - `grep -rn 'node\.interactive !== true' src/` returns **zero** hits.
  - `grep -rn 'isInteractiveAgent' src/` returns the export (1) plus six call sites plus the new test (≥ 8 hits total).
  - The truthy check at `src/attractor/core/graph-validator.ts:215` (`if (node.interactive)`) is preserved verbatim.
- Behaviour invariants:
  - `AgentHandlerDispatch.execute` routes `node.interactive=true` to `this.interactive.execute` and `node.interactive=false` to `this.looping.execute` — same as before.
  - `classifyNode(agentNode)` returns `"interactive-agent"` when `node.interactive` is `true` or `"true"` and `"agent"` otherwise — same as before.
  - The four validator rules (`agent_missing_outputs`, `loop_missing_done_field`, `interactive_with_outputs_forbidden`, `interactive_with_loop_forbidden`) emit the same diagnostics for the same inputs as before.

## 9. Open questions

- **Should the predicate accept `Pick<Node, "interactive">` instead of full `Node`?** Narrower input type reduces coupling. Default: keep `Node` because every call site already has a full `Node` and the predicate is co-located with `resolveHandlerType` which also takes `Node`. Re-examine if a non-Node consumer ever appears.
- **Should the truthy check at `graph-validator.ts:215` migrate too?** §7.3 argues no — it is a different rule. The illumination's "Optional follow-up" mentions folding the DOT coercion into the parser; that follow-up would obsolete this question by making `node.interactive: boolean` strict at parse time, after which `if (node.interactive)` and `isInteractiveAgent(node)` become indistinguishable. Defer to that future work.
- **Does the predicate belong in `core/graph.ts` long-term?** ADR-0009 narrows `graph.ts` to parsing. §3.3 argues the current placement is the right pragmatic call given the import graph. If a future audit splits node-shape predicates into their own module, both `resolveHandlerType` and `isInteractiveAgent` move together. Flagged for the implementing session, not blocking.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean. The new export and six call-site replacements are type-equivalent to the open-coded form.
- `grep -rn 'node\.interactive === true\|node\.interactive !== true\|node\.interactive === "true"\|node\.interactive !== "true"' src/` returns exactly one hit (the predicate body inside `graph.ts`).

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph-is-interactive-agent.test.ts` — new test, passes.
- `npx vitest run src/cli/tests/classifyNode.test.ts` — passes unchanged.
- `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts` — passes unchanged.
- `npx vitest run src/attractor/tests/interactive-agent-handler.test.ts` — passes unchanged.
- `npx vitest run src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts` — passes unchanged.
- `npx vitest run src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` — passes unchanged.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline validate <pipeline-with-interactive-and-non-interactive-agents>.dot` — diagnostic output for the four migrated rules is byte-identical.
- `apparat pipeline run <pipeline-with-interactive-agent>.dot` — TUI renders interactive-agent block kind identically.
- `apparat pipeline run <pipeline-with-loop-agent>.dot` — handler dispatch routes to the looping handler identically.

### 10.4 Negative cases

- A pipeline DOT with `interactive="true"` (string, the legacy DOT serialization) — predicate returns true; handler dispatch picks interactive; classifier returns `"interactive-agent"`; validator exempts/guards correctly. All identical to current.
- A pipeline DOT with `interactive=false` — predicate returns false; handler dispatch picks looping; classifier returns `"agent"`. Identical to current.
- A pipeline DOT with no `interactive` attribute — predicate returns false (undefined !== true and !== "true"). Identical to current.
- A pipeline DOT with `interactive="yes"` (out-of-schema) — schema validation rejects upstream; predicate would return false if reached. Identical to current.

## 11. Summary

The runtime rule "is this an interactive agent?" is open-coded six times across three modules — four positive forms (`agent-dispatch.ts:12`, `classifyNode.ts:35`, `graph-validator.ts:970`, `graph-validator.ts:1003`) and two negated mirrors (`graph-validator.ts:1032`, `graph-validator.ts:1051`). All six read the same DOT-attribute coercion (`=== true || === "true"`) against the schema union at `src/attractor/core/schemas.ts:26`. This design promotes a single `isInteractiveAgent(node: Node): boolean` predicate next to `resolveHandlerType` in `src/attractor/core/graph.ts` and migrates all six call sites — including the negated mirrors that the explainer-render initially flagged as optional follow-up (§7.1 explains the shift). A focused unit test at `src/attractor/tests/graph-is-interactive-agent.test.ts` pins the predicate's behaviour over the schema union; five existing tests (`classifyNode.test.ts`, `agent-handler-interactive.test.ts`, `interactive-agent-handler.test.ts`, `graph-interactive-with-{outputs,loop}-forbidden.test.ts`) continue to exercise the integrated behaviour and pass unchanged. The pre-existing `isInteractive(node)` export at `src/cli/lib/classifyNode.ts:51-53` is preserved as a wrapper over `classifyNode` — it asserts a stronger property (post-classifier identity) than the raw predicate. The truthy check at `src/attractor/core/graph-validator.ts:215` (`if (node.interactive)`) is out of scope (§7.3) — it is a different rule. Blast radius is **S** (5 src files + 1 new test, all internal); breaking changes: zero. CLI surface, validator rule ids/messages, agent rubrics, frontmatter schema, and pipeline `.dot` syntax are all byte-identical before and after.
