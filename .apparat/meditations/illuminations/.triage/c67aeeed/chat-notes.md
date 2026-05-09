# Chat round notes — 2026-05-09T1430

## What the user raised

- Command surface simplification: "could we simplify commands to get these outputs? I could imagine example that I would type command 'apparat pipeline explain illumination-to-implementation' to get a big picture of pipeline. However, I would like probably zoom in just giving the node like this 'apparat pipeline explain illumination-to-implementation verifier' that would give the same output what you showed with apparat pipeline preview command."
- Placeholder vs real-value rendering: "I'm more interested the prompts and skeleton of node so that for example the exact filenames could be replaced with placeholders." Later confirmed: "placeholders are enough at least for now."
- Trace addition clarity check: "About pipeline trace addition -> I don't quite understand what is this for and was this also part of the illumination?" After explanation + verifying real output: "Good".
- `.last-rendered/` mirror value: "I still don't quite understand the use of this. Can you explain what simply what benefits this gives me?" After explanation: "Skip?".
- `--var` opt-in flag: "No need for this probably. I think placeholders are enough at least for now."

## Conclusions reached

- Collapse `pipeline preview` and `pipeline explain` into a single command. `apparat pipeline explain <pipeline>` shows topology (big picture). `apparat pipeline explain <pipeline> <nodeId>` shows the rendered prompt skeleton + I/O for that one node.
  - Came from: Command surface simplification.
  - Rationale: User wants one command with optional zoom-in argument rather than two separate commands. Easier to remember, fewer surface concepts.

- Node-zoom mode renders prompts with placeholders (e.g. `<illumination_path>{{illumination_path}}</illumination_path>`) instead of synthesised real values.
  - Came from: Placeholder vs real-value rendering.
  - Rationale: User cares about the prompt skeleton + tag-mangling shape, not specific value substitution. Placeholders make the design-time view independent of any project state.

- Drop the `--var` flag entirely. No real-value rendering mode at all.
  - Came from: `--var` opt-in flag.
  - Rationale: User explicitly said "No need for this probably. I think placeholders are enough at least for now." Keeps surface minimal.

- Keep the `pipeline trace` enhancement (one extra `prompt: <runDir>/<nodeId>/prompt.md` line in the `--node-receive` output).
  - Came from: Trace addition clarity check.
  - Rationale: User confirmed "Good" after seeing the real current output and the proposed one-line addition. Verified value: post-run debugging hop from "what keys arrived" to "what literal text the LLM saw."

- Drop the stable `<pipeline-dir>/.last-rendered/<nodeId>.md` mirror from this illumination's scope.
  - Came from: `.last-rendered/` mirror value.
  - Rationale: User answered "Skip?" after the benefit explanation. With node-zoom `explain` covering design-time, the post-run mirror's value is marginal and not worth the implementation cost. Can be reconsidered later if the run-dir prune actually bites in practice.

## Final agreed scope

- IN: Pure-core split of `assembleAgentPrompt()` into `buildAgentPrompt()` + thin runtime wrapper (preserves `writeFileSync` at `agent-prep.ts:97`).
- IN: Single new command `apparat pipeline explain <pipeline> [nodeId]` (replaces both `preview` and `explain` from the original illumination). Topology view when no node arg; prompt-skeleton-with-placeholders view when node arg given.
- IN: Three-line addition to `pipeline trace --node-receive` to surface the runtime's `prompt.md` path.
- IN: Document the `<renderedTag>` tag-mangling rule in `src/cli/skills/apparatus/pipelines.md` (ADR-0011 live reference).
- OUT: Separate `pipeline preview` command (collapsed into `explain`).
- OUT: `--var` flag for real-value rendering (placeholders only).
- OUT: `<pipeline-dir>/.last-rendered/<nodeId>.md` stable mirror (skipped).
- OUT: `pipeline watch` integration (already deferred in the original illumination).

## Open questions

- None at this round. Scope is locked for design-doc / plan-writing.
