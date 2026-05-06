---
date: 2026-05-06
description: AgentHandlerDispatch is a dedicated class and file for a single ternary that routes interactive vs looping agents — the ConditionalHandler inline precedent makes this a concrete collapse candidate.
---

## Findings

1. **What:** `AgentHandlerDispatch` is a full `NodeHandler` class whose entire `execute` body is one ternary: `isInteractive ? this.interactive.execute() : this.looping.execute()`. It adds a file (`agent-dispatch.ts`), a class, a constructor, two injected deps, and a test file (`agent-dispatch.test.ts`) to express a boolean attribute check.

   **Evidence:**
   - `src/attractor/handlers/agent-dispatch.ts:4–15`: complete class — constructor + one ternary, nothing else.
   - `src/attractor/core/engine.ts:57–59`: `interactiveAgent` and `loopingAgent` are instantiated, then wrapped into `agentDispatch = new AgentHandlerDispatch(interactiveAgent, loopingAgent)` — three lines for what is ultimately `node.interactive ? interactiveAgent : loopingAgent`.
   - `src/attractor/core/engine.ts:62,64,68`: three handler map entries (`codergen`, `apparat.implement`, `agent`) all point to the same `agentDispatch` — every agent-type node goes through it regardless.
   - `src/attractor/tests/agent-dispatch.test.ts:12–43`: three test cases each verifying only the ternary routing (boolean true, string "true", missing/false).

   **Why it matters (KISS lens):** A reader following the dispatch chain must open a fourth file (`agent-dispatch.ts`) to learn that "agent dispatch = pick interactive or looping." The class exists to make the routing injectable, but `engine.ts` already constructs both concrete handlers directly — the indirection buys nothing testable beyond what the handler tests already cover.

   **Suggested action:** Inline the dispatch at the `engine.ts` handler-lookup site, mirroring the `conditional` inline from `2026-05-05`. Inside `buildHandlerMap`, register `interactiveAgent` and `loopingAgent` separately under distinct keys (e.g. `"agent.interactive"` and `"agent"`), then add a pre-dispatch shim in `runPipeline` that selects the key based on `node.interactive` — or more simply, resolve the handler directly: `const handler = isAgentType(handlerType) && isInteractive(node) ? interactiveAgent : handlers.get(handlerType)`. Delete `agent-dispatch.ts`, `agent-dispatch.test.ts`, and the `AgentHandlerDispatch` import from `engine.ts`. Move the string-coerce comment (`DOT attributes parse as strings`) into `engine.ts` at the inline site.

## Reading thread

- `2026-05-06T1604-janitor-stream-formatter-split.md` — different module (stream-formatter), no overlap.
- `2026-05-06T1548-janitor-eval-output-array-norm.md` — dead branch in evaluate-agent-output, unrelated.
- `2026-05-06T1538-janitor-tracer-test-array-leak.md` — tracer test fixture issue, unrelated.
- Session `2026-05-05-shallow-control-flow-handlers.md` — directly precedent: `ConditionalHandler` (same thin-dispatch pattern) was deleted and inlined as a one-liner in `engine.ts`; that session's "gotchas" note explicitly lists what node types *deserve* full handler classes vs inline shape-marker checks. `AgentHandlerDispatch` falls in the shape-marker camp.
