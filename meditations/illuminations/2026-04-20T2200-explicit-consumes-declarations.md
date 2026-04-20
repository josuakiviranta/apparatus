---
date: 2026-04-20
status: open
description: Pipeline nodes declare what they produce (`produces="a, b"`) but never what they consume — consumed vars must be scraped from `$var` references inside `prompt`, `tool_command`, `script_args`, and `label` strings; making consumption explicit is a small attribute addition that pays off in better diagnostics, faster review, and cleaner path-sensitive validation.
---

## Core Idea

Today the consumes side of every node is implicit. `src/attractor/transforms/variable-expansion.ts` scans each node's string-valued attributes at runtime and substitutes any `$var` token it finds. That scan is the de-facto consumes declaration — but it lives inside string bodies, not as a first-class attribute. Grepping `pipelines/**/*.dot` for `consumes=` returns zero matches today; every consumed variable must be inferred by reading prose.

Propose a symmetric `consumes="var1, var2"` attribute next to `produces=`:

```dot
mark_archived [type="tool",
               cwd="$project",
               consumes="illumination_path, archive_reason_short",
               script_file="scripts/mark-archived.mjs",
               script_args="$illumination_path $archive_reason_short"]
```

Three concrete benefits:

1. **Error messages improve.** When the path-sensitive validator (see `2026-04-20T1900-path-sensitive-var-flow-validator.md`) reports a missing upstream producer, the diagnostic can point at a single declarative attribute — one line, one source location — instead of reporting "found `$archive_reason_short` inside string `script_args`".
2. **New contributors read one line to understand node inputs** rather than scanning every quoted string on the node (prompt, tool_command, script_args, label).
3. **Validator sanity-check.** Compare declared `consumes=` against the scan-derived set. Warn on mismatch — declared-but-unused and used-but-undeclared both caught. Keeps the attribute honest over time.

## Why It Matters

The graph becomes self-documenting. Today the `produces=` side is half the contract; adding `consumes=` closes the loop and makes every node's data dependency visible at a glance. Downstream tooling stacks on the same attribute: path-sensitive validation (`2026-04-20T1900-path-sensitive-var-flow-validator.md`) pinpoints a declarative line instead of a scanned string; the graph preview command (`2026-04-20T2500-pipeline-graph-preview-command.md`) labels edges with variable names by pairing each upstream `produces=` with the downstream `consumes=`; the semantic checks anticipated by `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` gain a declarative anchor instead of re-deriving intent from prose.

This is YAGNI-compliant — one attribute, many downstream wins. No speculative machinery; each benefit is a short follow-up that only becomes possible once consumes is declared.

## Revised Implementation Steps

1. **Extend the schemas.** In `src/attractor/core/schemas.ts`, add an optional `consumes: z.string()` to `ToolNodeSchema`, `AgentNodeSchema`, and `GateNodeSchema`. Parser already camelCases attribute names, so the attribute lands as `node.consumes` — split on `,` and trim at read time.

2. **Compute the scan-derived consumes set.** In `src/attractor/core/graph.ts` (or reuse the scanner already in `src/attractor/transforms/variable-expansion.ts`), expose a helper that returns the set of `$var` tokens referenced by any string attribute of a node.

3. **Validator rule in `validateGraph`.** If `consumes=` is declared, enforce set equality with the scan-derived set (warn on drift in either direction). If `consumes=` is omitted, fall back to the scan-derived set — preserves full backward compatibility.

4. **Migrate pipelines gradually.** Do not make `consumes=` a hard gate. Add it opportunistically to new pipelines and during edits; the validator's fallback path keeps old pipelines green.

5. **Document.** Update `pipelines/schemas/` JSON Schema docs and `specs/pipeline.md` so the attribute is discoverable. One paragraph explaining that `consumes=` is a quality upgrade, not a requirement, and that the validator enforces set-equality when present.

6. **Surface in trace output.** `ralph pipeline trace` should print each node's `consumes=` (declared or derived) so run logs show the input expectations per node. Makes debugging "why is this var empty?" a read-only trace scan.

7. **Bake into scaffolding.** The agent scaffold command (`2026-04-20T2100-agent-scaffold-command.md`) should include `consumes=""` as a default attribute in every templated node so the habit installs from the first file of every new agent.
