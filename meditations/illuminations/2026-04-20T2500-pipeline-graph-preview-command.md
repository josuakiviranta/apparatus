---
date: 2026-04-20
status: implemented
implemented_in: a39d046
description: Pipeline `.dot` files routinely reach 200+ lines and 20+ nodes (e.g. `pipelines/illumination-to-implementation.dot`); reading them flat to trace variable flow or edge routing is the biggest ongoing maintainability tax; a `ralph pipeline show <file>` command that renders an annotated graph (ASCII or SVG) with produces/consumes pairs on edges would collapse that tax dramatically.
dispatched_at: 2026-04-27
plan_path: docs/superpowers/plans/2026-04-27-pipeline-graph-preview-command.md
---

## Core Idea

Pipelines are now the primary orchestration surface (see `2026-04-16-implement-as-pipeline.md` — `ralph implement` is itself a thin pipeline shim), but inspection tooling has not kept pace. `pipelines/illumination-to-implementation.dot` is ~200 lines, ~17 nodes, with conditional edges and produces/consumes scattered across node attribute blocks. To answer a basic question — "what feeds `$archive_reason_short` into `mark_archived`?" — a maintainer must grep every `produces=`, read every conditional edge's boolean expression, and mentally reconstruct the traversal. No ralph-cli subcommand renders the graph.

Propose `ralph pipeline show <file> [--ascii | --svg path | --mermaid] [--focus <node-id>] [--flow <var>]`:

1. **Default (`--ascii`)**: terminal box-drawing. Each node shows id + kind + truncated label. Each edge is annotated with its condition (if present). Edges where the upstream `produces=` overlaps the downstream node's declared consumes (see `2026-04-20T2200-explicit-consumes-declarations.md`) get a badge like `[+archive_reason_short]`.
2. **`--svg <path>`**: emit Graphviz DOT (the input is already DOT — restyle and re-emit), shell out to system `dot` for SVG; if `dot` missing, write the styled `.dot` and point the user at it.
3. **`--mermaid`**: Mermaid flowchart syntax for paste-into-markdown review sessions.
4. **`--focus <node-id>`**: restrict to paths through a node — the fastest way to debug "why did/didn't this fire?".
5. **`--flow <var>`**: restrict to edges that carry a given variable — requires declared consumes/produces to be meaningful.

Integration with existing commands:

- `ralph pipeline validate` errors include a one-line hint: "run `ralph pipeline show <file> --focus <node-id>` for context".
- `ralph pipeline trace` (confirm location in `src/cli/commands/pipeline.ts`) emits a preview at run-end highlighting the actual traversed path.

## Why It Matters

Authorship volume will grow: every new pipeline is another file someone must re-read to change, and every change touches conditional edges and variable flow. A viewer collapses per-edit cognitive load, and the ROI scales with pipeline count. The alternative — continuing to read 200-line `.dot` files flat — is already the biggest ongoing maintainability tax on pipeline work. Validator errors without visual context (`2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md`) compound the problem: the author sees a key name, not a topology. Visual preview and semantic validation are companion capabilities.

## Revised Implementation Steps

1. **Core walker.** Reuse the parsed `Graph` from `src/attractor/core/graph.ts` — no new parser. Write a pure function `previewGraph(graph, opts)` that produces a normalized intermediate: nodes with kind/label, edges with condition + carried-vars. Put it under `src/attractor/preview/`.

2. **Renderers, smallest first.** Ship `--mermaid` first (pure string emission, trivial to golden-test). Then `--svg` (restyled DOT → shell `dot`). Defer `--ascii` until layout is proven — a YAGNI evaluation required. If layered-layout turns out hard, document ASCII as a later follow-up rather than pulling in a heavy layout library.

3. **Edge annotations.** Requires `2026-04-20T2200-explicit-consumes-declarations.md` to land first for rich `[+var]` badges. Without declared consumes, fall back to showing only upstream `produces=` names on the emitting edge (partial value, still useful).

4. **Command wiring.** Add `show` subcommand in `src/cli/commands/pipeline.ts` alongside `validate`/`trace`; register in `src/cli/program.ts`. Accept flags per the Core Idea.

5. **Tests.** Golden-file tests under `src/attractor/tests/` rendering known pipelines (`pipelines/illumination-to-implementation.dot` is a natural fixture) and diffing output. One golden per renderer keeps drift contained.

6. **Labels use post-rename vocabulary.** Follow `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming.md` — preview node labels should use whichever names win the contracts-vs-rules rename, not the legacy terms. Land this command after the rename to avoid churning golden files.

7. **Validator hint integration.** After `show` ships, update `pipeline validate` error messages (see `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` and `2026-04-20T1900-path-sensitive-var-flow-validator.md`) to append "run `ralph pipeline show <file> --focus <node-id>` for context" where a node id is known. For path-sensitive "var X missing on path P" errors from the var-flow validator, the suggested `--focus` target is the path's terminal node — the two commands are direct companions.

## Cross-References

- `2026-04-20T2200-explicit-consumes-declarations.md` — direct dependency. Edge variable-flow badges (`[+archive_reason_short]`) require declared consumes/produces, not prose scans. Preview gets dramatically richer once consumes lands; without it, annotations are one-sided.
- `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` — semantic validation errors benefit from visual context. Validate error messages should link to `show` invocations so the author can see the topology the error describes.
- `2026-04-20T1900-path-sensitive-var-flow-validator.md` — when the validator reports "var X missing on path P", `show --focus <node>` is the canonical way to see path P visually. The commands are companions by design.
- `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming.md` — preview labels should use the post-rename vocabulary. Sequence this command after the naming unification to avoid golden-file churn.
