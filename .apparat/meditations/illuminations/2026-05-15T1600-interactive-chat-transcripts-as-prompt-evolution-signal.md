---
date: 2026-05-15
description: Interactive chat agents write transcripts to disk every run but nothing ever reads them back — recurring user prompts (re-explaining context, asking for visual explanations) are signals that the agent's system prompt is incomplete, and apparatus already has the seam to close this loop.
---

## Core Idea

Interactive chat nodes in apparatus write `digest.json` + a transcript file to disk on every run via `InteractiveAgentHandler` → `buildSessionDigest`. These transcripts are dead artifacts — apparatus never reads them back. When a user types the same compensating prompts session after session ("read the source code for context", "explain more visually"), they are manually patching a gap in the agent's system prompt. The filesystem already holds the evidence; no seam reads it.

The fix is a `chat-learner` pipeline node that runs after an interactive session, reads recent digests for that node across prior runs, detects recurring user-turn patterns above a frequency threshold, and proposes additions to the agent's `.md` file as a gate choice.

## Why It Matters

The project vision states: *"Re-explaining context to an agent every session is exhausting. Pipelines exist to capture orchestration logic once and reuse it across projects."* Interactive chat nodes violate this promise: their system prompts are static `.md` files that only change when the developer edits them by hand. Every session resets the agent to the same blank state, forcing the user to compensate with the same orientation prompts again and again.

The `InteractiveAgentHandler` (`src/attractor/handlers/interactive-agent-handler.ts:67`) already writes `digest.transcriptPath` and `digest.sessionId` into `contextUpdates`. The `.apparat/sessions/` folder shows that apparatus already models the pattern of writing cross-session artifacts to disk. The gap is a reader: nothing in any bundled pipeline (`src/cli/pipelines/`) analyzes those transcripts to extract signal.

This is the same pattern described in the "filesystem as agent memory" stimulus: write intermediate state to disk so it survives a session reset and can be passed to a different agent. The transcripts are already written; the analyst agent that reads them doesn't exist yet.

## Revised Implementation Steps

1. **Add a `chat-learner` agent file** to any pipeline that has an interactive node (start with `illumination-to-implementation/`). Its job: receive `<nodeid>.transcriptPath` from the pipeline context, find the N most recent prior runs of the same node via `$HOME/.apparat/runs/<pipeline>/*/`, read their `digest.json` files to locate prior transcript paths, extract all user-turn text, and cluster recurring asks semantically.

2. **Define a frequency threshold gate.** Only propose a system prompt update when the same class of ask appears in ≥10 distinct sessions. Below that, emit a no-op output. This avoids false positives from single-session anomalies and keeps the gate quiet on new pipelines.

3. **Propose a diff, not an append.** When the threshold is crossed, the learner should output a proposed replacement for the relevant section of the agent's `.md` file — not just an append. Tasks change over time; an always-growing prompt accumulates stale instructions. Present the proposed change as a unified diff string.

4. **Surface via a gate node** (e.g., `chat-prompt-update-gate`). Show the user the proposed diff with a short rationale ("You've asked 'read source code for context' in 14 of the last 17 sessions"). Options: Approve (auto-edit the `.md` and commit), Skip (mark snoozed for N runs), Edit (open for manual refinement).

5. **Alternatively, add an in-session signal.** The interactive agent itself can detect a recurring pattern mid-conversation and ask: "I notice you keep asking me to read source files before answering — should I add that to my default instructions?" This requires no post-run analysis node but needs the agent's system prompt to include the pattern-detection instruction and the Write tool for self-modification.

6. **Scope modifications to pipeline + project.** The agent `.md` file lives in `.apparat/pipelines/<name>/` — edits are already project-local. The learner must pass the resolved agent file path (not just the agent name) so the gate edits the correct file and does not touch bundled pipelines in `src/cli/pipelines/`.