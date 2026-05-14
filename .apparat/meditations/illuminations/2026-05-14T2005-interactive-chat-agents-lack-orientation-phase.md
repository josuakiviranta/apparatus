---
date: 2026-05-14
description: Interactive chat agents have no mandatory orientation step — they receive injected context but never surface it, so the user must ask the same three grounding questions every session to prevent hallucination and stay oriented.
---

## Core Idea

Interactive chat agents in apparatus receive a fully assembled prompt — inputs block, pipeline context, preamble — but their `.md` instructions contain no requirement to surface that context to the user before the first exchange. The agent simply starts and waits. The user compensates by asking the same three questions every time: *"What is?"* (what got injected), *"study the source code first"* (to prevent hallucination), and *"explain simply, verify each claim from code"* (to get grounded output). These are load-bearing prompts that should be structural, not manual.

As the operator noted: *"one of the agent's most important tasks would be to explain as clearly as possible… the way that I can understand the problems and changes and what is happening in the source code with cognitive ease without guess work or repetitive questions."*

## Why It Matters

The exhaustion loop is real. Every interactive pipeline session — `chat-refiner`, any future chat node — starts with the user doing orientation work that the agent could have done automatically. `agent-prep.ts:buildAgentPrompt` faithfully assembles and injects the inputs block, but no agent `.md` file mandates that the agent reads and surfaces that block before engaging. `chat-refiner.md` has step-by-step procedure that includes "read the illumination" (step 1) and "use Read/Grep/Glob to ground the discussion" (step 3) — but neither step requires opening with a structured summary the user can verify. The agent could silently hallucinate its way through step 1 without the user knowing.

The gap is not in the engine — it is in the prompt architecture.

## Revised Implementation Steps

1. **Define a canonical "grounded opening" pattern** — a prose block any interactive agent `.md` can copy:  
   > Before your first message: (a) summarize every injected value from the Inputs block in one line each; (b) for every path in the inputs, read the file and state what you found; (c) open with: *"Here is what I can see: [summary]. Here is what I am inferring (unverified): [list]."* Only then ask your first question.

2. **Update `chat-refiner.md`** to include this pattern as an explicit numbered step before "Talk with the user." Add a hard rule: *"Never make a claim about the codebase without citing the file and line you read it from."*

3. **Consider engine-level injection in `buildAgentPrompt`** (engine-level is stronger than per-agent remembering): detect `interactive: true` on the node and append a standard orientation block to the system prompt — same block every time, no per-agent author discipline required. This is the deep-module play: single seam, consistent behavior, zero drift.

4. **Add a brief "what I found" format convention** — the agent's opening message should be structured enough that the user can scan it cold: injected values → verified findings → inferences → first question. One short section each. No walls of text.

5. **Test it**: add a scenario test for an interactive node that validates (via the session digest or transcript) that the agent's first turn contains a reference to at least one injected variable or file path — proving it surfaced the context rather than ignored it.