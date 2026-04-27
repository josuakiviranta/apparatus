# Code Review: Chunk 1 — `outputs:` Frontmatter Implementation

**Branch:** main  
**Tag:** `chunk-1-outputs-frontmatter` (7833fab..30444d7)  
**Reviewer:** Senior Code Reviewer  
**Date:** 2026-04-27

---

## Overall verdict

The implementation is correct and ships working software. All seven questions have answers. Four findings below — none are blockers. Two are worth tracking.

---

## 1. Spec D2 Compliance

**Green with one gap.**

The three D2 pillars are all present:
- `outputs:` keys derive the `produces` set (`graph.ts:187-198`).
- `outputs_and_schema_file_conflict` is an error (`graph.ts:415-422`).
- `produces_redundant_with_outputs` is a warning (`graph.ts:424-439`).

**Gap (nice-to-have):** The `produces_redundant_with_outputs` rule fires only when `produces=` lists the exact same keys as `outputs:` (`sameSet` check, `graph.ts:428-431`). D2 says "if `outputs:` is set, `produces=` is ignored (warning)." The spec intent is: _any_ `produces=` on a node that already has `outputs:` is redundant — regardless of whether the key sets match. A subset mismatch silently passes the rule today. This is the S3 suggestion from the plan review that was not resolved. Low blast radius for Chunk 1 since only `verifier` is migrated, but should be addressed before more agents migrate in Chunk 4.

---

## 2. Runtime Path Safety for `jsonSchema`

**Green.**

`agent-handler.ts:68-76` reads `jsonSchema` from `json_schema_file=` on disk. `agent-handler.ts:99-101` wraps the prompt with it. `agent-handler.ts:106` overrides `config.jsonSchema` with the file-sourced value when present.

`validateAgentConfig` (`agent.ts:461-477`) derives `jsonSchema` from `outputs:` only when `config.jsonSchema` is not already set. The derivation feeds the same `jsonSchema` field. The agent-handler therefore consumes it identically — no behavioral difference from the handler's perspective.

One subtle point: when `resolveAgent` resolves a node's agent config, `jsonSchema` is already populated with the derived schema string. The handler's `let jsonSchema` variable (`agent-handler.ts:69`) is sourced from `node.jsonSchemaFile`, not from `config.jsonSchema`. The two paths are additive. The `outputs_and_schema_file_conflict` validator rule is what prevents both being set simultaneously. This design is correct and documented.

---

## 3. Stale-Cache Caveat (`~/.ralph/agents/verifier.md`)

**Important — document, do not fix now.**

`resolveAgent` checks `~/.ralph/agents/verifier.md` before the bundled copy. After the verifier migration, any user who has an old `verifier.md` in their user-dir will run the pre-`outputs:` version silently. The validator's `outputs_and_schema_file_conflict` rule will never fire for them because their agent file has no `outputs:` block — and the node in `illumination-to-implementation.dot` no longer has `json_schema_file=`, so the handler will send the prompt with no schema at all.

This is a real runtime regression risk for anyone with a stale user-dir copy, not just a cosmetic hazard. The spec puts per-pipeline-folder lookup in Chunk 4, which is the permanent fix. For Chunk 1:
- The workaround ("delete `~/.ralph/agents/verifier.md`") is acceptable IF it is surfaced in a release note or warning, not just internal documentation.
- Per-bundle `mtime` invalidation is not necessary now, but adding a startup check that warns "user-dir agent X looks stale (older than the bundled copy)" would eliminate this class of silent failures. Worth tracking as a Chunk-4 prerequisite, not a Chunk-1 blocker.

---

## 4. Test Design — Verifier-Migration Test Bypasses `resolveAgent`

**Nice-to-have.**

Commit `35ce18a` tests the verifier migration by reading the bundled `.md` file directly rather than going through `resolveAgent`. This is a justified shortcut for verifying the file's frontmatter content, but it does leave a gap: nothing in the test suite asserts that `resolveAgent("verifier")` returns an `AgentConfig` with `outputs` populated and `jsonSchema` derived.

The `agent-registry` tests added in `4be9ef0` cover `resolveAgent` for a synthetic "reviewer" fixture. Adding one more test case — `resolveAgent("verifier", { bundledDir })` returns `config.outputs` with the expected keys — would close the gap. Low priority but avoids the scenario where the bundled `verifier.md` is parseable by the file reader but fails silently in the registry path for some edge case.

---

## 5. `debugProducedKeys` Tech Debt

**Acceptable seam.**

`graph.ts:391` attaches `(graph as any).debugProducedKeys = nodeProduces` after the diagnostics return. The `as any` cast is intentional and honest — it signals "this is a test escape hatch, not a public API." The field is not exported in any type, so TypeScript consumers of `Graph` cannot accidentally use it.

The risk is low: `validateGraph` returns `Diagnostic[]`, not the `Graph` object, so the debug field is on the internal graph structure only. No consumer in the production path reads it. The plan marks this Chunk-2-cleanup-pending, which is the right call.

---

## 6. `produces=` Readers — Coverage Confirmed

**Green.**

`node.produces` is consumed in exactly two places:
- `graph.ts:181-185` — the `nodeProduces` derivation (the flow validator).
- `graph.ts:425-431` — the `produces_redundant_with_outputs` rule.

`variable-expansion.ts:163-165` was cited in the plan as a third consumer. Confirmed: it reads `node.produces` to seed defaults. After the verifier migration removes `produces=` from the `illumination-to-implementation.dot` verifier node, the defaults seed for that node now comes from the `outputs:` keys (via `nodeProduces` derivation in graph.ts). The path is correct because `variable-expansion` is only called at runtime, and by then the validator has already confirmed the keys are derivable.

No other consumers found in `src/`. The `PROMPT_pipeline_create.md` prompt mentions `produces=` in documentation text but does not read the field programmatically — no impact.

---

## 7. Live-Run Skipped

**Acceptable for Chunk 1, but note the gap.**

The schema-equivalence test in `35ce18a` verifies that the derived `jsonSchema` string round-trips to the same shape as the deleted `verifier.json`. This is a valid substitute for a live LLM run at the unit/integration level.

The production-path gap: the pipeline `illumination-to-implementation.dot` exercises the verifier node in a real run where the LLM must produce JSON matching the derived schema. No automated test currently exercises this end-to-end path. The plan review's I4 suggestion (run `pipeline trace` against a recent run dir) remains unaddressed. This is an acceptable gap for Chunk 1 given the verifier is the only migrated agent, but the gap compounds with each subsequent agent migration in Chunk 4. Recommend adding one smoke run (even with `--max-iterations` capped at the verifier node) before Chunk 4 ships.

---

## Summary Table

| # | Question | Finding | Severity |
|---|---|---|---|
| 1 | Spec D2 compliance | Subset-mismatch `produces=` silently passes `produces_redundant_with_outputs` | Nice-to-have |
| 2 | Runtime `jsonSchema` safety | No breaking changes; derivation feeds same field | Green |
| 3 | Stale-cache hazard | Silent regression risk for users with old user-dir verifier; add release note, track Chunk-4 warning | Important |
| 4 | Test gap — registry path | No `resolveAgent("verifier")` assertion; low priority | Nice-to-have |
| 5 | `debugProducedKeys` leak | `as any` cast contained; Chunk-2 cleanup is correct timeline | Green |
| 6 | `produces=` consumers | Only two production consumers; both accounted for | Green |
| 7 | Live-run skipped | Schema equivalence test adequate for Chunk 1; gap compounds at Chunk 4 | Important (pre-Chunk-4) |
