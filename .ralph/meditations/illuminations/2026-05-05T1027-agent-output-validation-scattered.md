---
date: 2026-05-05
description: Agent-output validation loop (outputs frontmatter → JSON schema → zod parse → corrective retry) is split across 4 modules glued by agent-handler.ts, with poor locality and bug-hiding wiring.
---

## Files

- `src/attractor/handlers/agent-prep.ts` — builds JSON schema from `outputs:` frontmatter, prepares agent invocation
- `src/attractor/handlers/evaluate-agent-output.ts` — runs zod validation, decides retry vs success
- `src/cli/lib/outputs-to-zod.ts` — converts outputs spec into a zod schema
- `src/cli/lib/corrective-message.ts` — formats the retry-prompt sent back to the agent on validation failure
- Orchestrator: `src/attractor/handlers/agent-handler.ts`

## Problem

The four modules form one cohesive concept — *the agent-output validation loop* — but live as separate seams. Tracing one retry cycle (raw text → schema build → zod parse → error formatting → retry prompt → next attempt) requires four file hops. Each piece has its own unit tests, but real bugs (off-by-one retry counters, JSON-schema vs zod shape divergence, dropped error context, iteration-cap miscounts) hide in `agent-handler.ts` where the pieces are wired together.

Deletion test: dissolving any one module concentrates complexity in `agent-handler.ts` only, not across N callers — so each "seam" is earning nothing as an independent module. They're shallow: interface ≈ implementation.

## Solution

Collapse the four files into one module that owns "given raw agent text + outputs spec + iteration count, return parsed-outputs OR a corrective-message". `agent-handler.ts` calls one function per iteration. `outputs-to-zod`, schema-building, and corrective-message formatting become private helpers inside the module, not separate import targets.

Keep the merged module focused on validation only — do not also pull in agent invocation or stream parsing.

## Benefits

- **Locality:** the retry state machine lives in one file; future changes to retry semantics (cap, backoff, partial-success retention) edit one place.
- **Test surface:** test the validator's behavior across iterations (attempt 1 fails → corrective message → attempt 2 succeeds) instead of stubbing each helper. Real bugs surface; mocked-internal bugs disappear.
- **Leverage:** `agent-handler.ts` shrinks; the validation seam becomes one named call instead of an implicit pipeline.
