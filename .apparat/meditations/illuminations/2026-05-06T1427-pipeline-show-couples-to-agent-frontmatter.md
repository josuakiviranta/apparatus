---
date: 2026-05-06
description: annotate-show.ts reaches into agent files via loadAgent and parses inputs/outputs frontmatter to enrich pipeline show — hidden coupling that silently degrades the rendered graph if agent format shifts.
---

## Files

- `src/cli/lib/annotate-show.ts` (117 LOC)
- `src/cli/lib/agent-loader.ts` (consumer)

## Problem

`annotate-show.ts` exists to enrich the `pipeline show` rendered DOT with metadata: each agent node gets its `inputs:` and `outputs:` surfaced as visible labels. To do this, it walks every agent node in the graph, calls `loadAgent(name, pipelineDir)`, then reaches into the returned `AgentConfig` to extract frontmatter fields.

This creates an undocumented coupling:

- **Agent file format** (frontmatter shape: `inputs:`, `outputs:`, `description:`) is the contract.
- **`agent-loader.ts`** is one consumer that parses the file.
- **`annotate-show.ts`** is a *second* consumer that re-extracts metadata from the loader's return shape.

If a future change adds a field, renames `outputs:` → `produces:`, or shifts `description` semantics, `pipeline show` silently degrades — labels go missing, the graph still renders. The loader passes the change through; the visualization quietly loses information.

The agent file format has two readers without a shared schema seam. ADR-0001 collapsed agent loading to a single tier; the metadata surface above that tier is still split.

## Solution

Move "agent metadata extraction" into `agent-loader.ts` as a typed return:

```typescript
type AgentMetadata = {
  description: string;
  inputs: string[];
  outputs: Record<string, OutputDecl>;
  // ... whatever annotate-show currently re-derives
};

function loadAgent(name: string, dir: string): AgentConfig & { metadata: AgentMetadata };
```

`annotate-show.ts` then consumes the typed metadata directly — no frontmatter re-parsing, no field-name knowledge.

The seam becomes: agent file → `agent-loader.ts` (the *only* parser) → typed metadata → consumers (dispatcher, renderer, `pipeline show` annotator).

## Benefits

- **Locality:** agent file format has one reader. Schema changes touch one file plus one type.
- **Leverage:** future consumers (validator hints, scenario fixtures, MCP introspection) inherit the typed metadata without re-deriving it.
- **Tests:** agent metadata extraction becomes unit-testable in isolation from DOT rendering. Today, testing the annotator requires a real graph + real agent files.
- **Deletion test:** complexity concentrates in `agent-loader.ts` where the parsing already lives; nothing disperses. The annotator shrinks to a pure DOT-decoration function.
