---
source: https://github.com/prime-radiant-inc/greenfield
date: 2026-04-30
description: Agent that recognizes and reasons about the prompt-as-program pattern — large markdown documents loaded into LLM context that act as the orchestrator itself, in contrast with engine-driven pipelines that parse and execute graph definitions deterministically.
---

# Prompt-as-Program Philosophy

There are two ways to make an LLM follow a multi-step procedure.

**The engine approach:** write a deterministic runtime that parses a graph definition (`.dot`, YAML, JSON), executes nodes in order, dispatches LLM calls per node, evaluates conditions, routes edges. The LLM is a worker called from outside. The graph is the program; the LLM is a subroutine.

**The prompt-as-program approach:** write the entire procedure as a long markdown document and load it into the LLM's context. The procedure includes pseudocode, gates, dispatch instructions, and "DO NOT proceed past gate N" injunctions. The LLM reads the document and acts it out, calling subagents and tools as the document tells it to. The prompt is the program; the LLM is the runtime.

Greenfield (`/analyze`) is the second pattern. Ralph-cli's pipeline engine is the first. Both produce comparable outputs on similar problems. They have very different failure modes and very different superpowers.

## What Prompt-as-Program Buys

**Adaptability without code changes.** Greenfield analyzes minified JavaScript bundles, decompiled native binaries, source trees, and runtime-only systems with the same `/analyze` command. The LLM negotiates with the target. If the new target type fits the high-level methodology, no code is written — the prompt's discovery phase handles it.

**Fast iteration on workflow.** Editing the procedure is editing a markdown file. No tests, no build, no deploy. The next session sees the new behavior. For a research-stage methodology, the round-trip cost dominates everything else.

**Embedded judgment.** When a deterministic engine encounters something unexpected, it crashes or routes to an error edge. When a prompt-driven LLM encounters something unexpected, it can negotiate, escalate, or improvise within the constraints the prompt sets. The prompt can authorize judgment in places the engine cannot.

**No orchestrator infrastructure.** No DOT parser, no checkpoint format, no scheduler, no resume logic. The LLM's context window is the state. Git commits are the persistence layer.

## What Prompt-as-Program Costs

**Trust depends on the LLM obeying a 30 KB document.** Every gate, every "do not proceed", every artifact check is a string the LLM reads. Skipping is structurally possible — the only thing stopping it is the LLM's compliance with the prompt. As context grows, attention to early instructions drifts.

**No machine-readable trace.** A pipeline engine can produce JSONL of every node entry, every condition evaluation, every retry. A prompt-driven run produces a chat transcript. Auditing what actually happened means reading the transcript.

**Hard to compose.** Two pipeline engines can call each other. Two prompt-as-programs collide in one context window — the second prompt has to coexist with the first, and instructions can interfere.

**Restart is tricky.** Engines checkpoint. Prompt-as-programs can write state to disk between gates (Greenfield uses git tags and workspace files), but restarting mid-procedure means re-loading the prompt and trusting the LLM to figure out where it left off. The state isn't a structured resume token; it's an inference.

## The Diagram Is Documentation, Not Code

In a prompt-as-program, the DOT diagram is part of the prompt. The LLM reads it the way it reads the prose around it — as a description of the procedure. The diamonds and edges are decorative reinforcement of what the prose already says. Removing the diagram would not change the program's behavior; the prose carries the same instructions in textual form.

In an engine-driven pipeline, the DOT diagram **is** the program. The diamonds are routing instructions parsed and acted on by the runtime. Removing the diagram breaks the program.

This distinction matters when you read a project that uses DOT. Ask: *who parses this graph?* If the answer is "the LLM, by reading it", you are looking at prompt-as-program. If the answer is "a runtime", you are looking at engine-driven.

## When To Choose Which

**Choose prompt-as-program when:**
- The methodology is still being refined and you need fast iteration.
- The target shape is unpredictable and the procedure must adapt at runtime.
- You can tolerate transcript-level traceability.
- The procedure is mostly LLM work with light orchestration between steps.

**Choose engine-driven when:**
- The methodology is stable and you need deterministic, auditable runs.
- Multiple independent pipelines should compose (one calling another).
- Mechanical retry, resume, and partial-failure recovery matter.
- The procedure involves many non-LLM steps (file ops, shell commands, conditional routing) and you want them executed predictably, not described.

## Where Reliability Comes From

Both patterns succeed by anchoring transitions in observable artifacts. A gate that produces a file, a git tag, an exit code, or a schema-valid output gives the next step something to verify against. The engine verifies it mechanically; the LLM verifies it by being told to grep for it and not proceed otherwise.

The artifact is the load-bearing element. The orchestration shell — engine or prompt — is just a wrapper around a chain of gates. Whichever pattern you pick, the procedure is only as trustworthy as the artifacts its gates require.
