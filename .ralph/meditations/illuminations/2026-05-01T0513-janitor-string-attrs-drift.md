---
date: 2026-05-01
description: graph.ts hardcodes two field lists that mirror STRING_ATTRS from variable-expansion.ts but both omit `cwd`, creating a silent validator blind spot for $var references in cwd= attributes.
---

## Findings

1. **What:** `STRING_ATTRS` is exported from `variable-expansion.ts` as the canonical list of node attributes that may contain `$var` references — but `graph.ts` never imports it and instead maintains two separate hardcoded copies, both missing `cwd`.

   **Evidence:**
   - `src/attractor/transforms/variable-expansion.ts:137`: `const STRING_ATTRS = ["prompt", "toolCommand", "label", "scriptArgs", "cwd"];` with comment `// Keep in sync with the fields list in graph.ts variable_coverage check.`
   - `src/attractor/core/graph.ts:255–263` (`variable_coverage` rule inside `validateGraph`):
     ```ts
     const fields = [
       consumer.prompt,
       consumer.toolCommand,
       consumer.label,
       consumer.scriptArgs,   // ← cwd absent
     ].filter(Boolean) as string[];
     ```
   - `src/attractor/core/graph.ts:645` (`checkOrphanOutput`):
     ```ts
     const fields = [node.prompt, node.toolCommand, node.label, node.scriptArgs]
       .filter((f): f is string => typeof f === "string");  // ← cwd absent
     ```

   **Why it matters (KISS lens):** The runtime (`variableExpansionTransform`) DOES expand `cwd=` via `STRING_ATTRS`. The validator does NOT. Any `$project` or `$var` in `cwd=` (common in tool nodes — e.g. `cwd="$project"`) is invisible to both the `variable_coverage` warning rule and the `checkOrphanOutput` scan. A missing variable silently reaches runtime instead of being caught at `ralph pipeline validate`. The "keep in sync" comment already acknowledges the problem — but the fix required is import, not comment maintenance.

   **Suggested action:** In `graph.ts`, import `STRING_ATTRS` from `variable-expansion.ts` and replace both hardcoded field arrays at lines 255–263 and 645 with a typed `.map(attr => (node as Record<string, unknown>)[attr])` over `STRING_ATTRS`. The portability-heuristic scan (line ~730) intentionally only checks `prompt` and `toolCommand` — leave that one alone.

## Reading thread

- `2026-05-01T0120-janitor-graph-validator-bloat.md` — flags that `validateGraph` is 1101 lines with duplicated adjacency primitives. This finding is a different duplication within the same file: field-list fragmentation rather than BFS helper duplication. The two could be addressed together but are independent.
