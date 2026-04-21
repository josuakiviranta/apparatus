---
date: 2026-04-21
status: open
description: When a pipeline node sets `prompt=`, the agent `.md` rubric body is silently dropped — replaced by the assembled node prompt — making every "Follow your agent-level procedure" reference in pipeline nodes a broken pointer to instructions Claude never received.
---

## Core Idea

`agent-handler.ts` selects `rawPrompt = node.prompt ?? node.label ?? config.prompt`. Every node in `illumination-to-implementation.dot` sets `prompt=`, so `config.prompt` — the agent `.md` rubric body — is never selected. The assembled prompt (preamble + nodePrompt) is sent as the user message via `claude -p`; no `--append-system-prompt` exists in the non-interactive `buildArgs` path. The rubric body is silently gone. Only the agent's tool list, model, and permissionMode survive the spread `{...config, prompt, ...}`.

This means `tmux-tester.md`'s 250+ lines of harness helpers and phase procedures, `implement.md`'s subagent dispatch protocol, `design_writer.md`'s brainstorming loop — none of it reaches Claude during pipeline execution. The rubric files are documentation and direct-invocation fallbacks, not live instructions.

## Why It Matters

Every pipeline node that contains "Follow your agent-level procedure" is a broken self-reference. The four nodes that use this phrase in `illumination-to-implementation.dot` — `tmux_tester`, `design_writer`, `plan_writer`, and `verifier` — each depend on instructions that are never delivered. Claude is responding to the node's short `prompt=` alone, without the elaborate process constraints the authors encoded in the rubric.

This also corrects `T2700`'s mechanism: "rubric edits dead on arrival" was attributed to JSON-schema `description` fields overriding the rubric. The actual cause is simpler — the rubric is absent entirely from the assembled prompt whenever `node.prompt` is set. Schema description vs. rubric conflicts are a secondary concern on top of this baseline: the rubric isn't there to be overridden.

`AGENTS.md` in the project root contains only build/test commands and codebase orientation — no agent-specific procedures. There is no fallback path that restores rubric content for a running `claude -p` subprocess.

## Revised Implementation Steps

1. **Verify flag availability.** Check whether `claude --append-system-prompt` works in non-interactive (`-p`) mode. The flag currently exists only in `buildInteractiveArgs`. If it works for `-p`, the fix is straightforward.

2. **Separate rubric from node prompt in `AgentHandler`.** Before overriding `config.prompt`, capture the original rubric body as `rubricBody`. Pass it alongside the assembled node prompt into `Agent.run()` as a new optional `systemPrompt` field on `RunOptions`.

3. **Extend `Agent.buildArgs`.** When `RunOptions.systemPrompt` is non-empty and the run is non-interactive, append `--append-system-prompt <systemPrompt>` to the args. The assembled node prompt (preamble + nodePrompt) remains the stdin user message.

4. **Keep the fallback intact.** When `node.prompt` is absent (`config.prompt` was selected as `rawPrompt`), the rubric IS the user message already — do not also send it as system prompt or it doubles.

5. **Audit "Follow your agent-level procedure" phrases.** After the fix, these become live references. Each agent rubric must contain the procedure it claims to have. Verify that `tmux-tester.md`, `implement.md`, `design-writer.md`, `plan-writer.md`, and `verifier.md` each self-contain their complete procedure without relying on external context.

6. **Low-cost alternative (YAGNI).** If step 1 reveals `--append-system-prompt` does not work with `-p`, inline the rubric summary into the node prompt directly. This is less elegant but removes the broken-reference trap without engine changes.
