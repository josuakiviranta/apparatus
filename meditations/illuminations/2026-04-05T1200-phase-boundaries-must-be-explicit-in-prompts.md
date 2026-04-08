---
date: 2026-04-05
description: '`ralph new` runs a two-phase Claude session: Phase 1 is non-interactive (headless `claude -p`), Phase 2 is interactive (the user walks in via `--resume`).'
---

# Phase Boundaries Must Be Explicit in Prompts

## Core Idea

`ralph new` runs a two-phase Claude session: Phase 1 is non-interactive (headless `claude -p`), Phase 2 is interactive (the user walks in via `--resume`). But `PROMPT_kickoff.md` doesn't know which phase it's in — it starts by telling Claude to ask the user a question. In Phase 1, there is no user to ask. The phase boundary is invisible to the prompt. Whatever Claude does with that first step is undefined behavior: it may ask the question and stall, skip ahead and hallucinate content, or ask and stream the question to stdout while Phase 2 picks it up — depending on Claude's interpretation of the moment.

## Why It Matters

This is the `interactive-vs-non-interactive` distinction applied at the prompt level, not the code level. `new.ts:runKickoffSession` carefully separates the phases in code (spawn, capture session ID, resume), but `PROMPT_kickoff.md` makes no corresponding separation. The design intent in `memory/MEMORY.md` says "Phase 1: non-interactive, Claude writes README.md + specs/README.md" — but the actual kickoff prompt step 1 is "Ask the user to describe the project." These two descriptions contradict each other. At least one is wrong.

The `the-agentic-loop-is-a-graph` lens sharpens this: the two-phase session is a graph with two nodes and one edge, but neither the edge condition nor the node boundary is written anywhere accessible to the agent. The prompt has no marker that says "stop here and wait for human input." The code has no mechanism to communicate to Phase 1 where it should stop. The phase separation exists only in the spawning machinery, not in the content the agent sees.

This matters practically: a first-time user running `ralph new my-app` will see output from Phase 1, then drop into an interactive session. Depending on what Claude did in Phase 1, the project directory may contain a README.md written without the user's input, an empty file, or nothing at all. The user has no way to know what state to expect when Phase 2 opens.

## Revised Implementation Steps

1. **Decide which model is intended for Phase 1.** Either: (a) Phase 1 is a pure setup step — Claude writes skeletal files without asking anything, using only the project name — or (b) Phase 1 is just a context primer that ends immediately, and all dialogue happens in Phase 2. Pick one and encode it in the prompt explicitly.

2. **Add a Phase 1 / Phase 2 marker to `PROMPT_kickoff.md`.** If option (a): replace "Ask the user..." with "Write README.md and specs/README.md using only the project name as context. Keep both files short. Leave all sections as stubs." If option (b): split the prompt into two sections labeled `## Phase 1 (non-interactive)` and `## Phase 2 (interactive)`, and have Phase 1 simply acknowledge the project and stop.

3. **Update `MEMORY.md`** to match whichever decision is made. The current description ("Phase 1: non-interactive, Claude writes README.md + specs/README.md") implies option (a), but the prompt implies option (b). Reconcile these so the next agent doesn't re-investigate.

4. **Export `BRAINSTORM_TRIGGER` from `new.ts` and import it in `new.test.ts`.** The constant is currently hardcoded in the test file as a string literal — if it changes in `new.ts`, the test silently passes against a stale expectation. One export fixes this, and surfaces the deeper issue: the same constant lives in both `plan.ts` and `new.ts` with no shared source.

5. **Add a smoke-test for `ralph new` in `src/cli/tests/new.test.ts`** that stubs the `claude` binary (using `RALPH_TEST_CMD` or a similar env override) and asserts Phase 1 produces predictable file contents. Right now `scaffoldProject` and `buildKickoffPrompt` are tested, but the Phase 1 execution path — the one that actually writes project files — has no test coverage.
