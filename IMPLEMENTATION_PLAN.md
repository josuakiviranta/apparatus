# JSON Schema Prompt Constraint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix structured output failures in long agentic sessions by injecting an explicit JSON constraint into the prompt whenever a node has a `json_schema_file` — in addition to the existing `--json-schema` CLI flag.

**Architecture:** One targeted change in `agent-handler.ts:70`. When `jsonSchema` is set, wrap `expandedRawPrompt` with a prepended and appended JSON instruction before concatenating with the preamble. The tests are already written and failing at `src/attractor/tests/agent-handler-json-constraint.test.ts`.

**Tech Stack:** TypeScript, vitest

**Root cause documented in:** `memory/2026-04-13-json-schema-agentic-sessions.md`

---

## Chunk 1: Apply fix

### Task 1: Run failing tests, apply fix, confirm pass

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts:70`
- Test: `src/attractor/tests/agent-handler-json-constraint.test.ts` (already written)

- [x] **Step 1: Confirm the tests fail before the fix**

Run:
```bash
npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 3 tests FAIL (the two constraint-presence tests and the no-constraint test), 1 test PASS (the markdown-prose failure-mode pin).

- [x] **Step 2: Apply the fix**

In `src/attractor/handlers/agent-handler.ts`, replace line 70:

```typescript
// Before:
const prompt = preamble + expandedRawPrompt;
```

```typescript
// After:
const jsonWrappedPrompt = jsonSchema
  ? `IMPORTANT: Your FINAL response MUST be a valid JSON object matching this schema. No markdown, no preamble, output ONLY the JSON object.\nSchema: ${jsonSchema}\n\n${expandedRawPrompt}\n\nREMINDER: Output ONLY valid JSON matching the schema above. No markdown, no explanation.`
  : expandedRawPrompt;
const prompt = preamble + jsonWrappedPrompt;
```

- [x] **Step 3: Run the new tests**

Run:
```bash
npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL 4 tests PASS.

- [x] **Step 4: Run the full agent-handler test suite**

Run:
```bash
npx vitest run src/attractor/tests/agent-handler.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL existing tests PASS. No regressions.

- [x] **Step 5: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-json-constraint.test.ts
git commit -m "fix: prepend+append JSON constraint to prompt when json_schema_file set"
```

## Completed

- **Chunk 1** (0.0.49): JSON constraint prepend+append fix applied. All 4 new tests + 19 existing tests pass.
