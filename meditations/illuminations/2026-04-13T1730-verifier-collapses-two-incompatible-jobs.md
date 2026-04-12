---
date: 2026-04-10
description: The verifier node mixes deep agentic research (50 subagents, unpredictable length) with structured JSON output in a single Claude session — these two requirements are architecturally incompatible, which is why the pipeline cannot complete a run; splitting into researcher + verifier-summarizer nodes fixes it permanently.
---

## Core Idea

The `verifier` node in `illumination-to-plan.dot` does two things that cannot reliably coexist in one Claude session: (1) deep agentic research — spawning up to 50 subagents to read source files and specs — and (2) structured JSON output. Long agentic sessions degrade the model's ability to honor format constraints; the session may also exceed token budgets before the final `result` event fires. The pipeline has failed at this node in every run: first with markdown returns (`Unexpected token '*'`), then with empty output (`Unexpected end of JSON input`) even after the prompt-constraint fix in 0.0.49. The failures are symptoms of a design mismatch, not bugs to patch.

## Why It Matters

The `illumination-to-plan` pipeline is the core product being built — it is supposed to turn meditations into actionable design docs without manual wrangling. It has never completed a successful run. The blocking node is `verifier`. Every workaround attempted so far (prompt prepend/append constraints, json-schema flag) addresses the symptom (bad JSON) rather than the cause (one node doing two incompatible jobs).

The pattern is already visible in `agent-handler.ts`: `writeFileSync(join(nodeDir, "raw-output.txt"), lastResult.output)` is only reached when `lastResult.output` is non-empty — the instrumentation added in 0.0.49 never fires for the empty-output failure mode because the guard `if (jsonSchema && !lastResult?.output)` exits early. This means the actual claude output for the failing runs is invisible. The node is a black box that consistently fails silently.

## Revised Implementation Steps

1. **Add a `researcher` node before `verifier_summarizer` in `illumination-to-plan.dot`.** Move the 50-subagent verification prompt to `researcher`. Remove `json_schema_file` from this node entirely. End the prompt with: *"Write your complete findings to `meditations/.triage/research-notes.md`. Include: illumination path, your verdict (valid/invalid/empty), a one-paragraph summary, and your detailed reasoning. Do NOT modify any other files."* This node runs free — no schema, no structured output requirement.

2. **Rename `verifier` to `verifier_summarizer` and rewrite its prompt.** Give it `json_schema_file="pipelines/schemas/verifier.json"`. Its prompt should be short and extraction-only: *"Read `meditations/.triage/research-notes.md`. Extract the verdict, illumination path, summary, and explanation. Return structured JSON matching the schema. Do NOT spawn any subagents. Do NOT read any other files."* A one-shot extraction from a file is exactly what `--json-schema` is reliable for.

3. **Update the DOT graph edges.** Replace `start -> verifier` with `start -> researcher -> verifier_summarizer`. All downstream edges from the old `verifier` node now hang off `verifier_summarizer`. No other edges change.

4. **Write `raw-output.txt` unconditionally in `agent-handler.ts`.** Move the `writeFileSync(join(nodeDir, "raw-output.txt"), ...)` call to before the empty-output guard, writing even an empty string. This makes every future failure inspectable without requiring a successful parse. One line change in `src/attractor/handlers/agent-handler.ts`.

5. **Run the pipeline end-to-end.** The researcher node will run long; the verifier_summarizer will be fast. The first successful completion validates the two-node split. After one green run, the illumination-to-plan pipeline becomes operational.
