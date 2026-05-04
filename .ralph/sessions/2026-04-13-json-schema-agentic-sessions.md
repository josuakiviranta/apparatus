---
id: memory-json-schema-agentic-2026-04-13
type: memory
created: 2026-04-13
triggered_by: []
related_to: []
tags: [structured-output, agentic-sessions, cli-flags, testing-gaps]
---

# JSON Schema Flag Insufficient for Agentic Sessions

## Description
The `--json-schema` CLI flag does not enforce structured output in long multi-tool agentic sessions, causing models to return markdown prose instead of JSON despite the flag being present.

## Content
The `--json-schema` flag works reliably for simple one-shot prompts but fails in complex agentic sessions where the model uses tools extensively (e.g., verifier node spawning 50+ subagents). After extensive tool use, models default to returning natural language (`**Verdict:**...` markdown) regardless of the `--json-schema` flag, causing `JSON.parse()` to fail in `agent-handler.ts`.

**Testing gap:** Tests for `agent-handler.ts` mock `agent.run()` with pre-canned JSON output and never simulate the flag being ignored (markdown returned instead). A test should verify graceful failure when markdown is returned, documenting this known failure mode explicitly. Better: a test that verifies the fix (explicit JSON instruction in the prompt) works reliably.

**Fix strategy:** When `jsonSchema` is set in `agent-handler.ts`, append explicit JSON output instruction to the prompt (e.g., "Your final response MUST be valid JSON matching the schema") so the model is told to return JSON regardless of agentic session length. This in-prompt instruction + flag together enforce structured output where either alone fails.
