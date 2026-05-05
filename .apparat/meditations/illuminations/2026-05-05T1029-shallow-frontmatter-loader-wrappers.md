---
date: 2026-05-05
description: gate-registry.ts and agent-loader.ts are thin wrappers around frontmatter.ts; the file-with-frontmatter-loader pattern is repeated twice without a shared abstraction, and frontmatter.ts itself is an 11-line module.
---

## Files

- `src/cli/lib/frontmatter.ts` (11 lines) — `parseFrontmatter(text)` returns `{ data, body }`
- `src/cli/lib/agent-loader.ts` (17 lines) — `loadAgent(name, dir)` / `parseAgentFile(path)`; 3 production callers (`agent-handler.ts`, `graph.ts`, `annotate-show.ts`)
- `src/cli/lib/gate-registry.ts` (31 lines) — `resolveGate(...)`; 2 production callers (`graph.ts`, `wait-human.ts`)

## Problem

Both `agent-loader` and `gate-registry` follow the identical recipe: `readFileSync` → `parseFrontmatter` → schema-validate → return. Two adapters of the same pattern — by the **two adapters = real seam** rule, this is borderline; by the **deletion test**, the pattern is real domain work but `frontmatter.ts` itself adds no leverage (its 11-line body could live as a private helper inside whichever module needs it).

Per CONTEXT.md, "agent file" and "gate" are real domain concepts — the *named* loaders earn their seams. The unnamed `parseFrontmatter` helper does not — it's a one-liner around a YAML library, exposed as a third module purely because two callers happened to need it.

## Solution

Two-step:

1. **Inline `frontmatter.ts`.** Move its body into `agent-loader.ts` and `gate-registry.ts` (or into a private helper shared between them by relative import). Delete `frontmatter.ts`.
2. **Keep `agent-loader.ts` and `gate-registry.ts` as named domain loaders** — they map to CONTEXT.md vocabulary (agent file, gate). Do not collapse them into each other yet; a third loader (tool spec? scenario file?) would justify a unified `FileWithFrontmatterResolver`. Until then, two named loaders is the right shape.

## Benefits

- **Locality:** the YAML-parse step lives next to the schema-validate step in each loader. No three-hop import chain to read what `loadAgent` does.
- **Test surface:** loader tests stop double-mocking parse + load. They test "given file X on disk, return validated Y or fail" as one operation.
- **Domain alignment:** module names match the glossary — `loadAgent`, `resolveGate` — without an extra structural layer in between named for an implementation detail.
- **Avoids premature seam:** declines to invent `FileWithFrontmatterResolver` until a third real adapter exists.
