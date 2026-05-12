---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-b557ba03
plan: docs/superpowers/plans/2026-05-12-interaction-driver-record-is-noop-padded.md
design: docs/superpowers/specs/2026-05-12-interaction-driver-record-is-noop-padded-design.md
illumination: .apparat/meditations/illuminations/2026-05-12T1020-interaction-driver-record-is-noop-padded.md
test_result: pass
---

# Interaction Driver Record Is Noop Padded

## What was implemented
Split `InteractionKind = "interactive-agent" | "wait-human"` out of `BlockKind`, narrowed the `drivers` registry from 7 padded entries to 2 real entries, and gated 4 call sites on a new `isInteractionKind` predicate so tsc enforces atomicity.

## Key files
- M docs/adr/0014-interaction-drivers.md
- M src/cli/components/LiveFooter.tsx
- M src/cli/components/PipelineRunView.tsx
- M src/cli/lib/classifyNode.ts
- M src/cli/lib/interactions/driver.ts
- M src/cli/lib/interactions/drivers/index.ts
- M src/cli/lib/pipelineReducer.ts
- M src/cli/tests/interactions-registry.test.ts

## Decisions and patterns
- Test file `interactions-registry.test.ts` was **inverted**, not added — the chat-summarizer reframe flipped step 5 from "ADD a registry vitest" to "INVERT the existing 7-kind assertions"; noop-behavior `it()` block deleted, key-count shrunk to 2, `// @ts-expect-error` proof line locks the `satisfies` guard.
- `isInteractionKind(k): k is InteractionKind` predicate added in `classifyNode.ts` so tsc forces all 4 call sites (`LiveFooter.tsx:42`, `PipelineRunView.tsx:103`, `pipelineReducer.ts:70`, `pipelineReducer.ts:81`) to land in the same commit as the registry narrowing — partial migration is not representable.
- `BlockKind` and the `pipelineEvents` contract (`start.blockKind`, `Block.kind`, `LiveBlock.kind`) deliberately left at 7 kinds — only the interaction-driver registry narrows. Zero external surface shift (no agent / frontmatter / CLI / MCP impact).
- ADR-0014 was refined in place (append-only stanza), not rewritten.

## Gotchas and constraints
- The 5 deleted noop entries (`agent`, `tool`, `store`, `conditional`, `marker`) were **structurally dead, not literally dead** — they were called every render/keypress/event but returned `null`/`undefined`/state-unchanged. Deleting them without gating the 4 call sites would crash with `Cannot read properties of undefined` at runtime; the new predicate is what makes the deletion safe.
- Future interaction kinds must be added to `InteractionKind`, not by un-padding a removed noop. The shape promotion direction is one-way.
- Closes a latent silent-Esc-swallow bug: today no non-interactive block holds focus, but the noop `keymap.escape: () => {}` would have eaten the keypress the moment a future hotkey (e.g. the `i`-inspector teased in `2026-05-11T1630-trace-inspector-shallow-out-of-process.md`) lets focus land on a `tool` / `marker` block.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, 1560 tests passed across 176 files (1 skipped), 16 scenarios discovered, 3 included (interaction-driver-escape, gate, pipeline-failure-footer) — all PASS, 13 skipped as diff-irrelevant (refactor narrows interaction-driver registry only, zero observable runtime delta per verifier).
