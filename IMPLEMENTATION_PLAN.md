# Structured Output Debug Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a permanent diagnostic pipeline that tests structured JSON output at three complexity levels and verifies context propagation between agent nodes.

**Architecture:** Linear three-node pipeline (trivial → light → heavy), each using a shared JSON schema with a `received_context` field that reveals what the previous node's output looked like after `$variable` expansion.

**Tech Stack:** DOT graph definition, JSON Schema, existing attractor pipeline engine (no code changes).

**Spec:** `docs/superpowers/specs/2026-04-09-structured-output-debug-pipeline-design.md`

---

## Chunk 1: Pipeline Files — COMPLETE

All tasks completed and committed (f87407a):
- `pipelines/schemas/structured-output-test.json` — shared JSON schema
- `pipelines/structured-output-test.dot` — three-node debug pipeline
- Pipeline validates: 5 nodes, 4 edges
- All 434 tests pass (35 test files)

### Bugs from 2026-04-13 spec (JSON unwrapping, readline race, Ink flush)

All three bugs were already fixed in prior commits:
- **agent-handler.ts**: Properly extracts `result` field from NDJSON events
- **agent.ts**: Registers close handler before consuming stdout, awaits readline completion
- **pipeline.ts**: Yields one macrotask to flush Ink before unmounting

### Task 4: Run the pipeline and inspect results — MANUAL

- [ ] **Step 1: Run the pipeline**

Run: `ralph pipeline run structured-output-test --project .`

Observe the output. Note which nodes succeed and which fail.

- [ ] **Step 2: Inspect raw output for each node**

Check each node's artifacts:

```bash
cat ~/.ralph/runs/structured-output-test/trivial/prompt.md
cat ~/.ralph/runs/structured-output-test/trivial/raw-output.txt
cat ~/.ralph/runs/structured-output-test/light/prompt.md
cat ~/.ralph/runs/structured-output-test/light/raw-output.txt
cat ~/.ralph/runs/structured-output-test/heavy/prompt.md
cat ~/.ralph/runs/structured-output-test/heavy/raw-output.txt
```

For each node, verify:
1. `prompt.md` contains the preamble + expanded prompt (with `$message` replaced)
2. `raw-output.txt` contains NDJSON with a `{type:"result"}` event
3. The `received_context` field in the result matches the previous node's `message`
