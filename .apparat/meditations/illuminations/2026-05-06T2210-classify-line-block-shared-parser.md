---
date: 2026-05-06
description: stream-formatter.ts and parseStreamJsonEvents duplicate JSON-line parsing and per-block content classification — extract two-layer classifier shared by both consumers.
---

## Findings

1. **What:** `src/cli/lib/stream-formatter.ts` has two consumers of Claude CLI's NDJSON stream that duplicate (a) JSON.parse + event-type dispatch, and (b) `message.content[]` per-block walk.
   - **Evidence:**
     - `processLine` lines 124–129: `JSON.parse(line)` + try/catch; lines 132, 170 dispatch on `event.type === "user" | "assistant"`.
     - `parseStreamJsonEvents` lines 360–365: identical `JSON.parse(line)` + try/catch; lines 367–415 dispatch on `event.type === "system" | "assistant" | "user" | "result"`.
     - Per-block walk duplicated: `processLine` lines 141–155 (user `tool_result`), 192–203 (subagent `text` / `tool_use`), 251–272 (main `text` / `tool_use`); `parseStreamJsonEvents` lines 378–393 (assistant blocks), 397–406 (user blocks).
     - The source file itself admits the seam: line 317 carries an in-file separator comment `// Raw stream-json event iterator for interactive chat (Path 1.5)`. Lines 1–316 are the TUI formatter (`StreamEvent`, `FormatterState`, `processLine`, `streamEvents`, `serializeEvent`); lines 318–end are the raw NDJSON parser (`StreamJsonEvent`, `coerceSessionUsage`, `parseStreamJsonEvents`).
     - Consumer call sites that will migrate to the shared classifier: `src/cli/lib/agent.ts` (importer of `parseStreamJsonEvents`), `src/cli/commands/pipeline/run.ts` (importer of both), `src/cli/tests/stream-json-events.test.ts`. Test files for the two halves are already split — the source has not yet caught up.
   - **Why it matters:** Two independently-evolved parsers consume the same protocol. Adding a new Claude CLI event type or block kind requires editing both call sites, with no compiler signal that they drifted. The earlier framing (parse/format coupled) was wrong — `serializeEvent` is already pure and `processLine` already returns `{events, nextState}` immutably (lines 158–167, 286–295). The real seam is upstream of both consumers: line classification + block classification.
   - **Suggested action:** Two-layer extraction, both layers in one move:
     - Layer 1 — `classifyLine(line) → ClassifiedEvent | null`: discriminated union over `system | assistant | user | result`. Wraps JSON.parse + type dispatch.
     - Layer 2 — `classifyBlock(block) → ClassifiedBlock`: discriminated union over `text | tool_use | tool_result`. Used by both consumers' inner loops.
     - Both consumers wrap the classifiers: `processLine` adds the subagent-buffering state machine; `parseStreamJsonEvents` yields one event per block. Layer 1 alone leaves the bigger duplication (block iteration) untouched — commit both layers together.

## Reading thread

- Architecture review session 2026-05-06: candidate #5 in the deepening survey. Reframed mid-grill from "parse + format mutate state" (false — `serializeEvent` is pure and `processLine` returns a new state immutably) to "JSON-line + block classification duplicated across two consumers" (true).
- A naive file-split (move `parseStreamJsonEvents` into a sibling module) would preserve the duplication across module boundaries instead of deleting it. The deepening is the shared classifier, not the file boundary.
