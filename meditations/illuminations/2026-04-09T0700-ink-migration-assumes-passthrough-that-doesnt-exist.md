---
date: 2026-04-08
description: The Ink migration spec classifies meditate.ts streaming as "unchanged passthrough" but runMeditationSession contains a broken inline reimplementation of stream-formatter — not a passthrough — so the migration will ship without fixing it, permanently excluding meditate from the unified output system.
---

## Core Idea

The Ink migration spec (`docs/superpowers/specs/2026-04-08-ink-unified-output-design.md`) contains a migration map entry for `meditate`: "Streaming passthrough | unchanged." This is factually wrong. `runMeditationSession` in `src/cli/commands/meditate.ts` does not pass the stream through — it runs its own inline JSON parse loop that reimplements a subset of `stream-formatter.ts`. It emits `→ [tool] name\n` for tool_use blocks and raw text for text blocks. It does not emit `▶▶▶ MAIN AGENT` open markers. It does not handle subagent blocks at all. It is a fork of an older version of the formatter, not a passthrough.

The Ink migration plan will execute without touching this code — the spec says to leave it unchanged. When it lands, every other command will speak `StreamEvent[]` through `output.stream()`. `meditate.ts` will speak its own inline dialect indefinitely.

## Why It Matters

The whole point of the Ink migration is a unified output system. "Commands never import Ink or React directly" — but more fundamentally, commands should not contain their own stream parsing logic. `meditate.ts` violates this today, and the migration plan will not fix it because the migration author treated the inline parser as a passthrough.

The sequencing makes this worse. Task 2 of the Ink migration changes `processLine`'s return type from `{ output: string }` to `{ events: StreamEvent[] }`. After that change, `stream-formatter.ts` speaks a different language than `meditate.ts`'s inline parser. There is still no interface incompatibility — `meditate.ts` never imports `processLine` — but the conceptual divergence widens. The formatter gains structured events, colors, MAIN AGENT markers, subagent block collapsing. `meditate.ts` keeps emitting `→ [tool] read_file\n` in plain text with no markers.

The agentic loop lens applies: the migration graph has no node for "migrate meditate.ts streaming." It has a node for every other command. There's no join point where the inline parser is replaced. The graph terminates with `@clack/prompts` removed and all imports of Ink centralized — but one command still has orphaned stream parsing that will look increasingly wrong next to the colored, structured output of every other command.

Additionally: the illuminations (0100 through 0500) have been converging on replacing the inline parser with `processLine`. That recommendation becomes stale the moment Task 2 lands and `processLine` returns `StreamEvent[]` instead of `string`. Any developer who reads illumination 2100 after the Ink migration and follows its steps to "import processLine from stream-formatter" will get a type error — `{ events: StreamEvent[] }` is not `{ output: string }`. The illumination's steps will silently expire.

## Revised Implementation Steps

1. **Correct the Ink migration spec before execution begins.** In `docs/superpowers/specs/2026-04-08-ink-unified-output-design.md`, change the meditate migration entry for "Streaming passthrough | unchanged" to: "Inline parser in `runMeditationSession` → `output.stream(sessionStream())` — same pattern as `loop.ts`, no passthrough." This makes the migration complete by definition rather than accidentally excluding meditate.

2. **Add meditate.ts to the Ink migration's `loop.ts` chunk.** The migration plan groups commands by how they handle streaming. `meditate.ts` belongs in the same chunk as `loop.ts` — both spawn claude with `--output-format stream-json`, both own their stream parsing. The fix for meditate.ts is the same structural transformation: replace the inline readline loop with `output.stream(asyncGeneratorOverProcessLine())`.

3. **Do the buildMeditationArgs fix independently, before the migration.** Adding `"--allowedTools", "mcp__illumination__list_illuminations"` to `buildMeditationArgs` is one line and unblocks every meditation session immediately. It is not coupled to the inline parser or the Ink migration. Ship it now in a standalone commit.

4. **When Task 2 of the Ink migration runs (StreamEvent return type), update meditate.ts to use the new API directly.** Do not adopt the current `{ output: string }` API first. If meditate.ts is included in the migration's streaming chunk, its inline parser is replaced once — with `StreamEvent[]` from the start. No double churn.

5. **Retire illuminations 2100 and 2300's "Revised Implementation Steps" after the Ink migration lands.** Those steps target the current `processLine` string API. Once the migration runs, following them produces a type error. Add a note in IMPLEMENTATION_PLAN.md that the meditate.ts inline parser is now addressed by the Ink migration, so future sessions don't try to apply the outdated recipe.
