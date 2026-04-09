# Spec Review: Illumination-to-Plan Pipeline Design

**Spec:** `docs/superpowers/specs/2026-04-09-illumination-to-plan-pipeline-design.md`
**Reviewer:** Code Review Agent
**Date:** 2026-04-09

---

## BLOCKER-1: `json_schema` attribute with single-quoted JSON will not parse

The DOT `parseAttrs` regex in `src/attractor/core/graph.ts` is:

```
/(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g
```

It supports **double-quoted** values and **unquoted** values only. The spec uses **single-quoted** JSON strings:

```dot
json_schema='{"type":"object",...}'
```

Single quotes are not recognized by the parser. The unquoted branch (`[^\s,\]]+`) would match `'{"type":"object",...}'` but would break on whitespace or commas inside the JSON, producing garbage.

**Fix options (pick one):**
1. Extend `parseAttrs` regex to also handle single-quoted values: add `'((?:[^'\\]|\\.)*)'` as a third alternative.
2. Change the spec to use double-quoted values with escaped inner quotes: `json_schema="{\"type\":\"object\",...}"` (ugly but works today).
3. Use a separate file reference instead of inline JSON: `json_schema_file="schemas/verifier.json"`.

**Recommendation:** Option 1 is the cleanest. Add single-quote support to the parser -- it is a small, well-scoped change and benefits all future DOT files.

---

## BLOCKER-2: `Agent.run()` does not return captured output

The spec proposes adding `output?: string` to `RunResult` for structured output capture. Currently, `Agent.run()` either:
- Delegates stdout to `onStdout` callback (caller consumes the stream), or
- Parses stdout line-by-line only for `session_id` extraction.

In neither case is stdout content accumulated and returned. When `jsonSchema` is set, the `AgentHandler` needs the full stdout text to parse as JSON. This requires non-trivial changes to `Agent.run()`:
- When `jsonSchema` is present, buffer all stdout lines into a string.
- Return that string as `result.output`.
- Must coexist with `onStdout` (the stream formatter pipeline) -- these are currently mutually exclusive paths.

**The spec correctly identifies this change is needed but underestimates complexity.** The `onStdout` callback consumes the stream; you cannot both pipe it to `onStdout` AND buffer it. You need a tee/passthrough strategy or a post-hoc log file read.

**Recommendation:** Buffer stdout internally when `jsonSchema` is set, and skip the `onStdout` delegate for structured-output nodes (they are typically short-running, no need for live streaming). Document this trade-off in the spec.

---

## WARNING-1: `valid` node (diamond/conditional) does not produce `preferredLabel`

The spec routes from `valid` using `condition="preferred_label=false"` etc. But `valid` is a `shape=diamond` node, which maps to `ConditionalHandler`. The `ConditionalHandler` is a no-op that returns `{ status: "success" }` with no `preferredLabel`.

The `preferredLabel` is set by the **verifier** node (the agent node before `valid`). The engine's `selectNextEdge` evaluates conditions against the **previous node's outcome**. But looking at the engine code, after executing `verifier`, the outcome is used for edge selection from `verifier`, not from `valid`. When execution reaches `valid`, the conditional handler returns a fresh outcome with no `preferredLabel`.

The edge conditions on `valid`'s outgoing edges will never match because `valid`'s own outcome has no `preferredLabel`.

**Fix:** Either:
1. Remove the `valid` diamond node entirely and put the condition edges directly on `verifier`'s outgoing edges. This is the simplest fix.
2. Forward the previous node's outcome context into the conditional handler (engine change).

**Recommendation:** Option 1. Replace `verifier -> valid` with direct conditional edges from `verifier`.

---

## WARNING-2: Variable expansion happens at graph parse time, not execution time

`variableExpansionTransform` in `src/attractor/transforms/variable-expansion.ts` is a graph transform -- it runs once when the graph is loaded, expanding `$key` references against whatever context exists at that point.

The spec assumes variables like `$illumination_path`, `$explanation`, `$refinements` will be available in downstream node prompts via variable expansion. But these values are produced at runtime by earlier nodes (verifier, chat_summarizer). At graph-parse time, these context keys do not exist yet, so `$illumination_path` will remain as the literal string `$illumination_path`.

**However**, the `AgentHandler` already calls `buildPreamble()` which injects context values. The question is whether the raw `$variable` syntax in prompts gets expanded.

Looking at the code flow: the engine calls `variableExpansionTransform` once before the run loop (in the pipeline runner). But the `AgentHandler` uses `node.prompt` directly from the already-transformed graph. Context values added during execution are NOT re-expanded into node prompts.

**Fix:** The `AgentHandler` should expand `$variable` references in `node.prompt` against `ctx.values` at execution time, not rely on the one-time graph transform. Alternatively, the engine should re-run variable expansion before each node execution.

**Recommendation:** Add a lightweight `expand(prompt, ctx.values)` call inside `AgentHandler.execute()` before building the preamble. Export the `expand` function from `variable-expansion.ts`.

---

## WARNING-3: `interactive` attribute and `onStdout` conflict not addressed

The spec has `chat_session` with `interactive=true`. The current `AgentHandler` correctly handles this (sets `stdio: "inherit"`, skips `onStdout`). However, the spec does not address what happens to pipeline observability (the sticky status bar, live output) during an interactive session. When `stdio: "inherit"` is used, the agent takes over the terminal. The pipeline output formatter will have nothing to display.

**Recommendation:** Add a note to the spec acknowledging that interactive nodes suspend pipeline output and restore it after the interactive session completes.

---

## NOTE-1: `preferred_label` convention needs explicit documentation

The spec says: "If the parsed JSON contains a key named `preferred_label`, it is used directly as `Outcome.preferredLabel`." This is a good convention but the verifier schema uses `verdict` (not `preferred_label`). The spec should clarify the mapping: either the schema must include a literal `preferred_label` key, or the `AgentHandler` maps `verdict` to `preferredLabel`. Currently the spec is ambiguous -- it mentions both approaches without committing.

**Recommendation:** Use the explicit `preferred_label` key convention. Change the verifier schema to include `preferred_label` instead of (or in addition to) `verdict`. This keeps the engine generic.

---

## NOTE-2: `coerceValue` will mangle JSON schema strings

The `parseAttrs` function passes values through `coerceValue()`, which converts `"true"` to boolean `true`, `"false"` to boolean `false`, and numeric strings to numbers. If the JSON schema string somehow gets parsed correctly (after fixing BLOCKER-1), it would still be passed through `coerceValue`. Since the full JSON string does not match `"true"`, `"false"`, or a number, it will be kept as a string. This is fine -- but worth noting that the `json_schema` value MUST remain a string type on the Node, not be parsed as an object.

**Status:** No action needed, but worth a unit test.

---

## NOTE-3: Chat session file-based handoff is underspecified

The spec mentions `chat_session` writes notes to `meditations/.triage/chat-notes.md` and `chat_summarizer` reads them. But there is no mechanism in the current engine for a node to write to a specific file path. The agent prompt instructs Claude to write the file, which relies on Claude correctly following instructions. If Claude fails to create the file, `chat_summarizer` will fail silently or produce nonsense.

**Recommendation:** Consider adding a post-execution file existence check in the `AgentHandler` for nodes that declare expected output files.

---

## Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | BLOCKER | Single-quoted `json_schema` values will not parse |
| 2 | BLOCKER | `Agent.run()` cannot capture output for structured parsing |
| 3 | WARNING | `valid` diamond node breaks `preferredLabel` routing chain |
| 4 | WARNING | Variable expansion is one-shot at parse time, not runtime |
| 5 | WARNING | Interactive node impact on pipeline output not addressed |
| 6 | NOTE | `preferred_label` vs `verdict` mapping is ambiguous |
| 7 | NOTE | `coerceValue` interaction with JSON strings (safe but test it) |
| 8 | NOTE | File-based handoff relies on Claude compliance |
