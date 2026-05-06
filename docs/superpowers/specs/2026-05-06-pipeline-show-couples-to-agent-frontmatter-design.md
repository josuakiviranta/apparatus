# Design: Concentrate agent metadata derivation in `agent-loader.ts` via a typed `AgentMetadata` return

**Date:** 2026-05-06
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T1427-pipeline-show-couples-to-agent-frontmatter.md`

## 1. Motivation

`annotate-show.ts` enriches the DOT graph rendered by `apparat pipeline show` — for every agent node it surfaces declared `inputs:` and `outputs:` as visible labels and decorates agent→agent edges with the intersection of upstream outputs ∩ downstream inputs. To do this, it imports `loadAgent` and reads `inputs`/`outputs` directly off the returned `AgentConfig`:

```ts
// src/cli/lib/annotate-show.ts:2
import { loadAgent } from "./agent-loader.js";

// src/cli/lib/annotate-show.ts:4-7
interface AgentMeta {
  inputs: string[];
  outputs: string[];
}

// src/cli/lib/annotate-show.ts:64-71
try {
  const cfg = loadAgent(agentName, dotDir);
  const inputs = Array.isArray(cfg.inputs) ? cfg.inputs : [];
  const outputs = cfg.outputs ? Object.keys(cfg.outputs) : [];
  agentMeta.set(child.id.value, { inputs, outputs });
} catch {
  // Validation step already errors for unresolvable agents; skip silently.
}
```

The `AgentConfig` shape is defined at `src/cli/lib/agent.ts:48-61` with typed `inputs?: string[]` and `outputs?: Record<string, JsonSchemaFragment>`. Field-name knowledge — the literal property names `inputs` and `outputs`, plus the convention that `outputs` is a Record whose *keys* (not values) are the renderer-visible labels — is duplicated:

1. **Producer:** `parseAgentFile` (`src/cli/lib/agent-loader.ts:6-9`) → `validateAgentConfig` (`src/cli/lib/agent.ts:447-488`) read frontmatter and shape the `AgentConfig`.
2. **Consumer A (privileged):** the rest of the pipeline engine reads `config.inputs` / `config.outputs` for validation, schema derivation, dispatch — that is the loader's intended contract.
3. **Consumer B (renderer):** `annotate-show.ts` re-derives a renderer-shaped projection by mapping the `outputs` Record back to a string[] of keys, packaged into its own local `AgentMeta` interface.

Three forces converge:

1. **Locality.** "What metadata does the renderer want?" is split across the loader (which returns the raw `AgentConfig`) and the annotator (which knows that `outputs` keys, not values, are the labels). A reader who wants to add a new label dimension — say, `description` shown on hover — has to touch two modules and remember which one decides the projection.

2. **Silent-degradation surface.** The `catch` at `:69-71` swallows *every* error, with a comment that justifies it for unresolvable agents. But it also swallows the `Object.keys(undefined)` `TypeError` that would fire if `outputs` ever loses its `Record` shape (e.g., a future rename `outputs:` → `produces:` at the frontmatter parser, or a tightening that nulls `outputs` for procedure-less agents). The graph still renders; labels disappear; nothing surfaces in stderr or test output. `pipeline show` becomes a quietly-lossy diagnostic.

3. **Project direction.** ADR-0001 (`docs/adr/0001-agents-live-next-to-pipeline.md`) collapsed agent loading to a single tier — agents live next to their pipeline, loaded by `loadAgent(name, pipelineDir)`. ADR-0009 (`docs/adr/0009-parser-validator-split.md`) just consolidated parsing into the loader and pushed validation to a sibling module. The metadata-projection surface is the last reader still split: parsing happens once in `agent-loader.ts`, but the renderer's view of "what's a label" is decided in `annotate-show.ts`. Closing this seam extends the same direction.

The illumination's structural claim — "agent file format has two readers without a shared schema seam" — holds. The verifier added one nuance worth pinning: `AgentConfig` already exposes typed `inputs?: string[]` and `outputs?: Record<...>`, so the annotator is *not* re-parsing frontmatter; it is re-deriving the renderer's projection from the typed fields. The fix is the same: name that projection once, in the loader, and let the annotator consume it.

## 2. Decision Summary

1. **Add an `AgentMetadata` type to `src/cli/lib/agent.ts`** — the renderer-shaped projection of inputs/outputs (and any future label-bearing fields). Co-located with `AgentConfig` because it derives from it.

   ```ts
   export interface AgentMetadata {
     inputs: string[];
     outputs: string[]; // keys of AgentConfig.outputs Record
   }
   ```

2. **Add `extractAgentMetadata(config: AgentConfig): AgentMetadata`** to `src/cli/lib/agent-loader.ts` — a pure function that owns the projection rule (`outputs` Record → string[] of keys; `inputs` array passes through normalized to `[]` when absent). The annotator's local `AgentMeta` interface and re-derivation logic disappear into this function.

3. **Augment `loadAgent` to return `AgentConfig & { metadata: AgentMetadata }`.** Additive — every existing caller that reads `cfg.inputs` / `cfg.outputs` continues to work because the underlying fields are preserved. The new property is the dedicated seam for the renderer (and any future projection-shaped consumer like MCP introspection or scenario fixtures).

4. **Migrate `src/cli/lib/annotate-show.ts:64-71`** to consume `metadata` directly:

   ```ts
   const { metadata } = loadAgent(agentName, dotDir);
   agentMeta.set(child.id.value, metadata);
   ```

   The local `AgentMeta` interface at `:4-7` is removed; `import type { AgentMetadata } from "./agent.js"` replaces it where the local Map type still references the shape.

5. **Tighten the silent `catch` at `:69-71`.** The comment ("Validation step already errors for unresolvable agents; skip silently.") accurately describes the *file-not-found* case the validator pre-empts — that one stays swallowed. But shape mismatches at field-projection time should not be swallowed. Concretely: the `catch` continues to swallow `loadAgent` failures (file not found, frontmatter parse error, validation rejection) — those are the validator's domain — but the projection itself runs *outside* the try/catch, where a `TypeError` from a future shape mismatch would surface as a real failure during `pipeline show`. Detail in §4.4.

6. **Out of scope (this round):** the other `cfg.inputs`/`cfg.outputs` consumers in the pipeline engine — `src/attractor/core/graph-validator.ts` (~30 reach-ins across `:226-227, 428, 450, 453, 469, 539-540, 583-584, 598-599, 648-649, 673, 675, 701-702, 782-783, 859, 862, 923, 938, 975, 985, 1009, 1035`), `src/attractor/handlers/agent-prep.ts:81`, `src/attractor/handlers/looping-agent-handler.ts:54,64`. Those readers consume the *typed `AgentConfig` fields directly* — that is the loader's intended contract, not the renderer-projection re-derivation we are concentrating. They keep working off the `AgentConfig` superset because the new return type is `AgentConfig & { metadata }` (additive). §7.1 explains why widening is deferred.

7. **No behaviour change** at the `pipeline show` surface today. Same DOT output, same labels, same edge-intersection logic. The protection is structural: a future field rename or shape shift can no longer silently empty the labels — it surfaces as a load-time error or a test failure on the new isolated metadata test (§4.5), not as a quietly degraded SVG.

8. **Atomic landing.** The new type + extractor + loader return-type widening + annotator migration + new test land in one commit. Staged migration would create an interim state where `loadAgent` callers vary in whether they see `.metadata` or not — the change is small enough to be atomic and the contract is easier to reason about as one shape.

## 3. Architecture

### 3.1 Before/after

```
Before                                              After
──────                                              ─────
src/cli/lib/agent.ts                                src/cli/lib/agent.ts
  AgentConfig                                         AgentConfig
  validateAgentConfig                                 AgentMetadata ◀── new
                                                      validateAgentConfig

src/cli/lib/agent-loader.ts                         src/cli/lib/agent-loader.ts
  parseAgentFile(content): AgentConfig                parseAgentFile(content): AgentConfig
  loadAgent(name, dir): AgentConfig                   extractAgentMetadata(cfg): AgentMetadata ◀── new
                                                      loadAgent(name, dir):
                                                        AgentConfig & { metadata: AgentMetadata }

src/cli/lib/annotate-show.ts                        src/cli/lib/annotate-show.ts
  interface AgentMeta { inputs; outputs }             import type { AgentMetadata }
  try {                                               try {
    const cfg = loadAgent(name, dir);                   const { metadata } = loadAgent(name, dir);
    const inputs = Array.isArray(cfg.inputs)            agentMeta.set(child.id.value, metadata);
      ? cfg.inputs : [];                              } catch { /* loader-level only */ }
    const outputs = cfg.outputs
      ? Object.keys(cfg.outputs) : [];
    agentMeta.set(child.id.value, { inputs, outputs });
  } catch { /* swallows everything */ }
```

### 3.2 `AgentMetadata` contract

```ts
// src/cli/lib/agent.ts (next to AgentConfig at :48-61)

/**
 * Renderer-shaped projection of an AgentConfig. Owned by agent-loader.ts;
 * consumed by annotate-show.ts for `apparat pipeline show` labels and
 * available to any future projection-shaped consumer (MCP introspection,
 * scenario fixtures, validator hints) that wants a normalized label set
 * without re-deriving it from the AgentConfig field shape.
 *
 * `outputs` is the keys of AgentConfig.outputs Record — the renderer-visible
 * label set, not the JSON Schema fragments.
 */
export interface AgentMetadata {
  inputs: string[];
  outputs: string[];
}
```

The type is intentionally minimal — exactly the projection `annotate-show.ts` already computes. Future fields (e.g., `description?: string` for hover-text in an HTML graph, or `loop?: boolean` for badge decoration) can extend the interface; existing consumers ignore unknown properties because the migration uses object destructuring.

### 3.3 `extractAgentMetadata()` contract

```ts
// src/cli/lib/agent-loader.ts (after parseAgentFile)

import type { AgentConfig, AgentMetadata } from "./agent.js";

/**
 * Project an AgentConfig into the renderer-visible label set.
 *
 * - `inputs`: passes through the AgentConfig.inputs string[]; defaults to [] when absent.
 * - `outputs`: returns the *keys* of the AgentConfig.outputs Record; defaults to [] when absent.
 *
 * Pure: no I/O, no caching. The single reader of "what's a renderer-visible label?"
 */
export function extractAgentMetadata(config: AgentConfig): AgentMetadata {
  return {
    inputs: Array.isArray(config.inputs) ? config.inputs : [],
    outputs: config.outputs ? Object.keys(config.outputs) : [],
  };
}
```

The two `Array.isArray`/`config.outputs` guards are preserved verbatim from `annotate-show.ts:66-67` — they encode the contract that `inputs` and `outputs` are *optional* in `AgentConfig` (per `agent.ts:57-58`'s `?:` markers). The function is the single reader of those optional-field nuances.

### 3.4 `loadAgent` widening

```ts
// src/cli/lib/agent-loader.ts (current :11-17)

export function loadAgent(
  name: string,
  pipelineDir: string,
): AgentConfig & { metadata: AgentMetadata } {
  const path = join(pipelineDir, `${name}.md`);
  if (!existsSync(path)) {
    throw new Error(`Agent file not found: ${path}`);
  }
  const config = parseAgentFile(readFileSync(path, "utf-8"));
  return Object.assign(config, { metadata: extractAgentMetadata(config) });
}
```

The intersection return type (`AgentConfig & { metadata }`) means every existing call site continues to type-check unchanged: `cfg.inputs`, `cfg.outputs`, `cfg.name`, etc. all resolve through the `AgentConfig` arm. Callers that destructure `metadata` get the projection; callers that don't pay zero cost.

`Object.assign` rather than spread is intentional — it preserves the `AgentConfig` shape exactly (no defensive cloning) which matters because `validateAgentConfig` already returned a freshly-built object at `agent.ts:474-487`; we are augmenting that object in place rather than producing a new one.

### 3.5 Surfaces unchanged

- `AgentConfig` shape (`src/cli/lib/agent.ts:48-61`). Unchanged — additive type only.
- `parseAgentFile(content): AgentConfig` (`src/cli/lib/agent-loader.ts:6-9`). Unchanged signature; this is the layer below `loadAgent`. Future consumers that want `AgentConfig` without forcing the metadata derivation continue to use `parseAgentFile`.
- `validateAgentConfig` (`src/cli/lib/agent.ts:447-488`). Unchanged. The loader does the augmentation post-validation.
- `graph-validator.ts` reach-ins to `cfg.inputs`/`cfg.outputs` (~30 sites listed in §2.6). Unchanged — they consume the typed `AgentConfig` fields, not the projection.
- `agent-prep.ts:81` (`config.inputs`) and `looping-agent-handler.ts:54,64` (`config.outputs`). Unchanged.
- Frontmatter format, agent rubric, `.dot` syntax, CLI flags, command names, exit codes. Unchanged.
- `apparat pipeline show` output for any current pipeline. Byte-identical.

### 3.6 Co-location rationale: why `agent-loader.ts` and not `annotate-show.ts`

The verifier flagged a placement question: the projection could live in `annotate-show.ts` as a private helper — same effect for the immediate consumer, less surface area on `agent-loader.ts`. We place it in the loader because:

- The loader is already the single producer of `AgentConfig` from disk. Concentrating *every* derived view of the file there means "where do I look to learn what the agent file conveys?" has one answer: `agent-loader.ts`. ADR-0001's collapse of agent loading to a single tier already established the pattern; this design extends it from raw fields to projections.
- Future projection consumers (the verifier flagged MCP introspection and scenario fixtures as plausible) get the same shape for free. Having them re-derive locally is exactly the duplication this design removes.
- The function is pure and tiny. It does not bloat the loader's responsibility — `loadAgent` becomes "load and project" rather than "load," which is a coherent expansion, not a new domain.

If a third projection consumer never appears, this design's marginal cost is one type + one ~6-line function in the loader. If it does appear, the seam is already there. The asymmetric outcome favours the loader.

### 3.7 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Type seam | `src/cli/lib/agent.ts` | Inline edit — add `AgentMetadata` interface (~10 LOC + JSDoc) |
| Loader | `src/cli/lib/agent-loader.ts` | Inline edit — add `extractAgentMetadata` (~8 LOC); widen `loadAgent` return type and augment with `metadata` (~3 LOC delta) |
| Renderer | `src/cli/lib/annotate-show.ts` | Inline edit — drop local `AgentMeta` interface; replace `:64-71` projection with destructure (~5 LOC delta net negative) |
| New unit test | `src/cli/tests/agent-metadata-extraction.test.ts` | **New** — pins `extractAgentMetadata` behaviour over the projection contract |
| Existing tests | `src/cli/tests/agent-loader.test.ts`, `src/cli/tests/agent-outputs-frontmatter.test.ts`, `src/cli/tests/pipeline-show-annotation.test.ts` (if present), `src/cli/tests/agent-inputs-frontmatter.test.ts` | **No edit** — they exercise integrated behaviour and continue to pass |
| Docs | None | No ADR / CONTEXT / README change. ADR-0004 (source-as-truth) bans behavioural specs; JSDoc on the new type and function carries the rule. |

### 3.8 LOC sanity check

| File | Before | After | Δ |
|---|---|---|---|
| `src/cli/lib/agent.ts` | 489 | ~500 | +11 (interface + JSDoc) |
| `src/cli/lib/agent-loader.ts` | 17 | ~32 | +15 (extractor + widened return + JSDoc) |
| `src/cli/lib/annotate-show.ts` | 117 | ~110 | −7 (drop local interface + collapse projection) |
| `src/cli/tests/agent-metadata-extraction.test.ts` | — | ~40 | +40 |
| **Total** | | | **+59** |

Net +59 LOC dominated by the new test and JSDoc. The implementation files net ≈ +19 LOC for one new exported type, one new pure function, and one widened return.

## 4. Components & file edits

### 4.1 `src/cli/lib/agent.ts` (inline edit)

Append after `AgentConfig` (currently `:48-61`):

```ts
/**
 * Renderer-shaped projection of an AgentConfig. See agent-loader.ts
 * `extractAgentMetadata` for the projection rules. Consumed by annotate-show.ts
 * for `apparat pipeline show` labels.
 */
export interface AgentMetadata {
  inputs: string[];
  outputs: string[];
}
```

### 4.2 `src/cli/lib/agent-loader.ts` (inline edit)

Replace `:1-17` (current full file) with:

```ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFrontmatter } from "./frontmatter.js";
import {
  validateAgentConfig,
  type AgentConfig,
  type AgentMetadata,
} from "./agent.js";

export function parseAgentFile(content: string): AgentConfig {
  const { attributes, body } = parseFrontmatter(content);
  return validateAgentConfig({ ...attributes, prompt: body } as any);
}

/**
 * Project an AgentConfig into the renderer-visible label set used by
 * `apparat pipeline show`. Single reader of "what's a label?" — callers
 * import metadata, never re-derive from AgentConfig field names.
 */
export function extractAgentMetadata(config: AgentConfig): AgentMetadata {
  return {
    inputs: Array.isArray(config.inputs) ? config.inputs : [],
    outputs: config.outputs ? Object.keys(config.outputs) : [],
  };
}

export function loadAgent(
  name: string,
  pipelineDir: string,
): AgentConfig & { metadata: AgentMetadata } {
  const path = join(pipelineDir, `${name}.md`);
  if (!existsSync(path)) {
    throw new Error(`Agent file not found: ${path}`);
  }
  const config = parseAgentFile(readFileSync(path, "utf-8"));
  return Object.assign(config, { metadata: extractAgentMetadata(config) });
}
```

### 4.3 `src/cli/lib/annotate-show.ts` (inline edit)

Three edits:

1. Replace the local `AgentMeta` interface at `:4-7` with a type import:

   ```ts
   import { loadAgent } from "./agent-loader.js";
   import type { AgentMetadata } from "./agent.js";
   ```

   The local `AgentMeta` interface is removed. The Map type at `:55` becomes `Map<string, AgentMetadata>`.

2. Replace `:64-71` with the destructure-and-store form:

   ```ts
   try {
     const { metadata } = loadAgent(agentName, dotDir);
     agentMeta.set(child.id.value, metadata);
   } catch {
     // loadAgent failure (file not found / parse / validation).
     // Validation step already errors for unresolvable agents; skip silently.
   }
   ```

   The `try` boundary is tightened to `loadAgent` only — `extractAgentMetadata` is pure and runs inside the loader against an already-validated `AgentConfig`, so a shape-mismatch `TypeError` would surface there (loader-level), not get silently absorbed at the annotator boundary. The clarified comment narrows the swallow's documented scope to genuine load failures.

3. The downstream usages at `:79` (`meta.inputs`), `:80` (`meta.outputs`), `:104` (`fromMeta.outputs.filter(...)`, `toMeta.inputs.includes(...)`) work unchanged because `AgentMetadata`'s field names match the local interface they replaced.

### 4.4 `catch` boundary (subtle, called out)

In the current code, the projection (`Object.keys(cfg.outputs)`) sits *inside* the `try`. If a future change to frontmatter parsing or validation produced a `cfg` where `outputs` was, say, a malformed array instead of a Record, `Object.keys` would still succeed but return numeric-string indices — labels appear, but they are `"0"`, `"1"`, etc. Equally, a renaming to `produces:` upstream would leave `cfg.outputs === undefined`; `Object.keys` is guarded, no crash, labels go empty silently.

After the change, `extractAgentMetadata` runs *inside the loader* after `validateAgentConfig` has shaped the config. Validation already enforces field names and types (`agent.ts:447-488`); the projection trusts that contract. A future shape mismatch surfaces at validation time — the existing diagnostic path — not as a quietly empty `metadata.outputs`. The annotator's `try` continues to absorb file-not-found and validation-rejection cases (the documented "validator already complained" scenarios), but the projection is no longer in its swallow zone.

This is a behaviour change *only* in the failure mode: today, certain shape mismatches cause silent label loss; after, they cause an explicit validation error. For all currently valid agent files, `pipeline show` produces byte-identical output.

### 4.5 `src/cli/tests/agent-metadata-extraction.test.ts` (new)

```ts
import { describe, it, expect } from "vitest";
import { extractAgentMetadata } from "../lib/agent-loader.js";
import type { AgentConfig } from "../lib/agent.js";

const cfg = (over: Partial<AgentConfig>): AgentConfig => ({
  name: "demo",
  description: "x",
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
  prompt: "",
  ...over,
});

describe("extractAgentMetadata", () => {
  it("projects outputs Record keys to a string array", () => {
    const m = extractAgentMetadata(cfg({ outputs: { foo: "string", bar: "number" } }));
    expect(m.outputs).toEqual(["foo", "bar"]);
  });

  it("returns [] for outputs when undefined", () => {
    expect(extractAgentMetadata(cfg({})).outputs).toEqual([]);
  });

  it("returns [] for outputs when empty Record", () => {
    expect(extractAgentMetadata(cfg({ outputs: {} })).outputs).toEqual([]);
  });

  it("passes inputs through when array", () => {
    expect(extractAgentMetadata(cfg({ inputs: ["a", "b"] })).inputs).toEqual(["a", "b"]);
  });

  it("returns [] for inputs when undefined", () => {
    expect(extractAgentMetadata(cfg({})).inputs).toEqual([]);
  });

  it("does not include outputs values, only keys", () => {
    const m = extractAgentMetadata(cfg({ outputs: { x: "string" } }));
    expect(m.outputs).toEqual(["x"]);
    expect((m.outputs as unknown[])[0]).not.toEqual({ type: "string" });
  });
});
```

The test pins the projection behaviour in isolation from DOT rendering. If a future change reshapes `AgentConfig.outputs` — say, wraps it in an envelope `{ schema: {...}, deprecated: ... }` — this test fails first, before any silent SVG degradation reaches users.

## 5. Data flow

### 5.1 Before — two readers, no shared projection

```
agent file (frontmatter inputs:, outputs:)
  └─ parseFrontmatter
       └─ validateAgentConfig
            └─ AgentConfig { inputs?: string[], outputs?: Record<...> }
                 ├─ pipeline-engine consumers (graph-validator, agent-prep, handlers)
                 │    ─ read .inputs / .outputs as typed fields  ◀── intended contract
                 │
                 └─ annotate-show.ts:64-71
                      ─ re-derives a renderer projection
                        (Object.keys(cfg.outputs), Array.isArray(cfg.inputs))
                      ─ wrapped in catch that swallows shape errors
```

### 5.2 After — projection lives in the loader

```
agent file
  └─ parseFrontmatter
       └─ validateAgentConfig
            └─ AgentConfig
                 │
                 └─ extractAgentMetadata(config)  ◀── new, pure
                      └─ AgentMetadata { inputs: string[], outputs: string[] }
                           └─ loadAgent returns AgentConfig & { metadata }
                                ├─ pipeline-engine consumers ─ ignore .metadata, read typed fields
                                └─ annotate-show.ts ─ destructures .metadata, no projection logic
```

The projection rule lives in exactly one place (`extractAgentMetadata`). Future shape changes to `AgentConfig.outputs` are a one-line edit at the projection plus a one-line update to `AgentMetadata`'s JSDoc; no annotator code needs to change.

## 6. Blast radius / impact surface

- **Size:** **S** — concentrated dedupe of an existing projection, additive return type widening.
- **Files touched:** 3 source files + 1 new test = 4 files.
  - 1 type addition (`agent.ts`), 1 new function + 1 return-type widening (`agent-loader.ts`), 3 small inline edits (`annotate-show.ts`), 1 new test file.
- **Surfaces crossed:** 1 internal package — `src/cli/lib/`. Pipeline-engine, handlers, validator are *not* edited; they are observers of the unchanged `AgentConfig` arm of the new intersection return type.
- **Breaking changes:** **no.**
  - `loadAgent` return is `AgentConfig & { metadata }` — every existing field-access call site (`cfg.inputs`, `cfg.outputs`, `cfg.name`, `cfg.outputs?.foo`, etc.) type-checks unchanged.
  - No barrel re-export of `loadAgent` exists in `src/cli/lib/index.ts` (no such barrel today), so no public-API contract widening leaks externally.
  - `parseAgentFile` signature unchanged — callers that need just `AgentConfig` without metadata can use it.
  - Zero CLI flag, command name, exit code, stdout/stderr output change. `apparat pipeline show` produces byte-identical SVG/DOT for current pipelines.
  - Frontmatter format, agent rubric, `.dot` syntax, validator rule ids and messages — unchanged.
- **Spec / docs ripple:**
  - [ ] No ADR required. ADR-0001 (agents next to pipeline) and ADR-0009 (parser-validator split) are precedent; this design is an *application* of those, not a new principle.
  - [ ] No CONTEXT.md, AGENTS.md, README, or VISION.md change. ADR-0004 (source-as-truth) keeps the rule in JSDoc rather than prose docs.
  - [ ] No design-doc cross-references. The originating illumination is the only reference.
- **Test ripple:**
  - [ ] **New** `src/cli/tests/agent-metadata-extraction.test.ts` — pins `extractAgentMetadata` over the projection contract.
  - [ ] No edits to existing tests:
    - `src/cli/tests/agent-loader.test.ts` — covers `loadAgent` and `parseAgentFile` end-to-end; the additional `metadata` property is silently present on the returned object (test imports unchanged).
    - `src/cli/tests/agent-outputs-frontmatter.test.ts` — covers frontmatter `outputs:` parsing into `AgentConfig.outputs`. Unchanged.
    - `src/cli/tests/agent-inputs-frontmatter.test.ts` — covers `inputs:` parsing. Unchanged.
    - `src/cli/tests/frontmatter.test.ts` — covers the parser layer. Unchanged.
    - Any `pipeline-show-annotation.test.ts` (if present) — exercises annotation end-to-end through `loadAgent`. Unchanged.
    - All pipeline-engine tests touching `cfg.inputs`/`cfg.outputs` — unchanged because the underlying `AgentConfig` shape is preserved.

## 7. Trade-offs

### 7.1 Scope: annotate-show only vs widen to all metadata consumers

The verifier sized the work as "S–M (2–3 production files if scoped to annotate-show coupling; ~6–7 if widened to other consumers)." This design takes the **S** scope deliberately:

**Why narrow:** The other `cfg.inputs`/`cfg.outputs` readers (`graph-validator.ts` ~30 reach-ins, `agent-prep.ts:81`, `looping-agent-handler.ts:54,64`) consume the typed `AgentConfig` fields *as JSON-Schema fragments* — `outputs` Record values feed `outputsToZod` (`graph-validator.ts:675`), `Object.entries(cfg.outputs)` builds fragment maps (`graph-validator.ts:702`), `looping-agent-handler.ts:64` looks for the special `"note"` key. They are not consuming a renderer-shaped projection; they need the full Record. Forcing them through `metadata` would lose information (it is a string[] of keys) — that is not the seam to share with them.

The illumination's structural claim — "two readers know the field names" — is most acute between `annotate-show.ts` (which re-derives a projection from typed fields) and the loader (which produces the typed fields). Closing that one seam is a clean win. The validator/handler readers are *correctly* using the typed contract; they are not duplication.

**What "wider" would look like:** if a future audit finds projection-shaped duplication elsewhere — e.g., a JSON-output mode of `pipeline show` that wants the same string[] of keys — `metadata` is already there to consume. This design is the smallest move that opens that door without making any current consumer worse.

### 7.2 Augment vs replace: `AgentConfig & { metadata }` vs new wrapper type

Two shapes were considered for `loadAgent`'s return:

- **Intersection** (chosen): `AgentConfig & { metadata: AgentMetadata }`. Existing callers see the same `AgentConfig` shape they already type against; the new property is additive. Zero migration cost for ~30+ existing reach-ins.
- **Wrapper:** `{ config: AgentConfig; metadata: AgentMetadata }`. Cleaner separation of concerns, but every existing call site (`graph-validator.ts:226-227, 428, 450, ...`, `agent-prep.ts:81`, `looping-agent-handler.ts:54,64`) would need a `.config` rewrite. The loader-API rewrite cost is exactly what the §7.1 narrow-scope reasoning rejects.

Intersection is the lower-friction shape and matches the illumination's "additive" framing.

### 7.3 Pure vs cached: should `extractAgentMetadata` memoize?

The function is invoked once per `loadAgent` call. `loadAgent` itself is invoked once per agent node per `pipeline show` (typically <20 nodes). The arithmetic is ~20 invocations × an `Object.keys` call on a small Record — negligible. Memoization would add a layer of state (cache key by what? `config.name`? `config` reference?) for no measurable benefit. Pure is the right shape; if a future profile shows hot-path reads, the cache decision belongs to the caller, not the loader.

### 7.4 Tightening the silent `catch`: scope and risk

§4.4 narrows the documented swallow zone to "loadAgent failure." There is a soft behaviour change: today, certain malformed agent files (e.g., one where validation accidentally let through a non-Record `outputs`) produce empty labels with no diagnostic; after, they produce a validation error.

We considered preserving the wider swallow exactly as-is to be 100% behaviour-preserving. Rejected because:

- The illumination's central concern is silent degradation. Preserving it would honour the letter of "no behaviour change" and violate the spirit of the design.
- `validateAgentConfig` (`agent.ts:447-488`) already throws hard on unrecognized shapes; for the swallow to currently absorb a *new* shape error, validation would have to silently accept malformed `outputs` — which would be a separate validator bug, not load-time tolerance.
- The projection running outside the catch means: for any agent file that loads cleanly today, behaviour is identical. For any agent file that *would* expose a future shape mismatch, the failure is loud rather than silent — exactly the win the illumination prescribes.

### 7.5 Atomic vs staged

Staged (land the type + extractor; migrate annotator later) was considered. Each interim commit produces a state where `loadAgent` returns `metadata` but no consumer reads it — dead code that the next commit activates. The migration is small enough (4 files) that atomic is the cheaper, easier-to-review path. One developer, one commit.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — existing test files unchanged plus the new `agent-metadata-extraction.test.ts`.
  - `apparat pipeline show <pipeline>.dot` produces byte-identical DOT/SVG output for any current pipeline.
  - `apparat pipeline run`, `validate` produce byte-identical TUI/stderr/stdout — no surface they touch is altered.
- Repo-wide grep invariants post-merge:
  - `grep -rn 'Object.keys(cfg.outputs)' src/cli/lib/annotate-show.ts` returns **zero** hits — projection has moved.
  - `grep -rn 'Array.isArray(cfg.inputs)' src/cli/lib/annotate-show.ts` returns **zero** hits — same.
  - `grep -rn 'extractAgentMetadata' src/` returns the export (1) plus the loader call site (1) plus the new test (≥ 4 references).
  - `grep -rn 'interface AgentMeta\b' src/cli/lib/annotate-show.ts` returns **zero** hits — local interface has been replaced by the imported `AgentMetadata`.
  - The existing `cfg.inputs`/`cfg.outputs` reach-ins in `src/attractor/` (~30 sites) remain untouched.
- Behaviour invariants:
  - For every agent file that currently loads without error, `loadAgent(name, dir).metadata` equals exactly what `annotate-show.ts:66-67` previously computed inline.
  - The annotator's `agentMeta` Map carries the same `(nodeId → {inputs, outputs})` shape as before; downstream label-rendering at `:79-80` and edge-intersection logic at `:104` are unaffected.

## 9. Open questions

- **Should `AgentMetadata` add a `description: string` field now?** The verifier flagged that `description` is *not* currently consumed by the annotator (the illumination's example list overstated it). Adding it speculatively risks bloating the projection beyond what any consumer reads. Default: no — extend the type only when a consumer wants it. The interface is small and forward-compatible; adding fields is a one-line patch with no migration cost (existing destructures ignore unknown properties).

- **Does the projection belong in `agent-loader.ts` long-term, or in a separate `agent-metadata.ts`?** With one projection function and one type, splitting is premature. If a third or fourth projection-shaped consumer (MCP introspection, scenario fixtures, JSON-mode `pipeline show`) materialises and the projection logic grows, `extractAgentMetadata` and `AgentMetadata` move together to `src/cli/lib/agent-metadata.ts`. Flagged for a future audit, not for this implementation.

- **Should the truthy-check zone of the existing `catch` be tightened further?** §4.4 narrows the documented swallow to "loadAgent failure." A stricter form would catch only `Error` instances whose message starts with `Agent file not found:` (the loader's own error string at `agent-loader.ts:14`). That is brittle to error-message edits and gives no extra structural protection beyond what §4.4 already buys. Defer unless a downstream incident demands it.

- **Should the implementing session ship a paired ADR?** Trade-offs §7.1 (narrow scope) and §7.2 (intersection vs wrapper) are durable design choices that future sessions might second-guess. ADR-0001 and ADR-0009 already cover the underlying principles; the specific "loader-augmented metadata projection" decision could merit its own ADR if a wider rollout to other consumers is contemplated. Default: no ADR for now — JSDoc on the type and function carries the why.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean. The intersection return type is type-equivalent to `AgentConfig` for every existing caller; the new `metadata` access in `annotate-show.ts` resolves through the new arm.
- `grep -rn 'Object.keys(cfg.outputs)\|Array.isArray(cfg.inputs)' src/cli/lib/annotate-show.ts` — zero hits.

### 10.2 Tests

- `npx vitest run src/cli/tests/agent-metadata-extraction.test.ts` — new, passes.
- `npx vitest run src/cli/tests/agent-loader.test.ts` — passes unchanged. `loadAgent` callers see `cfg.inputs`, `cfg.outputs`, `cfg.name` — all preserved on the intersection arm.
- `npx vitest run src/cli/tests/agent-outputs-frontmatter.test.ts` — passes unchanged. Still exercises `parseFrontmatter` directly; layer below loader.
- `npx vitest run src/cli/tests/agent-inputs-frontmatter.test.ts` — passes unchanged.
- `npx vitest run src/cli/tests/frontmatter.test.ts` — passes unchanged.
- Any `src/cli/tests/pipeline-show-annotation.test.ts` (if present) — passes unchanged because the projection produces the same `{inputs, outputs}` shape the local interface produced.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline show <pipeline-with-agents>.dot --to svg` — diff against pre-change SVG output is byte-identical.
- `apparat pipeline show <pipeline-with-agent-having-empty-outputs>.dot` — agent node renders without an `out:` line, exactly as before.
- `apparat pipeline show <pipeline-with-agent-missing-inputs-frontmatter>.dot` — agent node renders without an `in:` line, exactly as before.

### 10.4 Negative cases

- Agent file that fails to load (file not found): `loadAgent` throws; `annotate-show.ts` `catch` absorbs; node renders without enrichment. Identical to current.
- Agent file that fails validation (e.g., missing `prompt`): `validateAgentConfig` throws; `loadAgent` propagates; annotator catch absorbs. Identical to current.
- Agent file with `outputs: {}` (empty Record — used by interactive agents): `extractAgentMetadata` returns `outputs: []`; node renders without an `out:` line. Identical to current.
- Agent file with `outputs:` block absent entirely: `extractAgentMetadata` returns `outputs: []`. Identical to current.
- Agent file with `inputs: [a, b, c]`: `metadata.inputs` is `["a", "b", "c"]`. Identical to current.

## 11. Summary

`annotate-show.ts:64-71` re-derives a renderer-shaped projection (`{inputs: string[], outputs: string[]}`) from `AgentConfig`'s typed fields, wrapping the projection in a `catch` (`:69-71`) that silently absorbs not just file-not-found but any future shape mismatch. Two readers — the loader (typed `AgentConfig`) and the annotator (renderer projection) — share the agent-file format with no shared seam. This design promotes the projection into `src/cli/lib/agent-loader.ts` as a pure `extractAgentMetadata(config: AgentConfig): AgentMetadata` function; the new `AgentMetadata` type is exported from `src/cli/lib/agent.ts:48-61`'s neighbour position; `loadAgent` widens its return to `AgentConfig & { metadata: AgentMetadata }` (additive — every existing caller's type-checks unchanged); `annotate-show.ts` consumes `.metadata` directly and drops its local `AgentMeta` interface and inline projection. The annotator's `try/catch` boundary tightens to wrap only the load step — a future field rename or shape mismatch surfaces as a validation error rather than as silently empty labels in `pipeline show`. The other `cfg.inputs`/`cfg.outputs` consumers (`graph-validator.ts` ~30 reach-ins, `agent-prep.ts:81`, `looping-agent-handler.ts:54,64`) are out of scope (§7.1) — they consume the typed fields as JSON-Schema fragments, which is the loader's intended contract, not the renderer-projection re-derivation we are concentrating. A focused unit test at `src/cli/tests/agent-metadata-extraction.test.ts` pins the projection's behaviour over `outputs` Record→keys, missing-field defaults, and round-tripped `inputs`. Blast radius is **S** (3 src files + 1 new test, all internal); breaking changes: zero. CLI surface, validator rule ids/messages, agent rubric, frontmatter schema, and pipeline `.dot` syntax are byte-identical before and after; the only behavioural difference is in the failure mode — a quietly-empty label set becomes a loud validation error.
