---
date: 2026-05-07
description: When a pipeline run fails, the human gets a two-line `✗ … / trace: <path>` footer and must walk 5+ commands to find the failed agent file, its receive-id, the raw-output, and the resume command — a deeper failure surface that inlines all of these would close the edit→fail→understand→fix loop the solo human lives in.
---

## Core Idea

`pipeline run` already knows which node failed, why, and where every diagnostic artifact landed — but the failure footer at `src/cli/commands/pipeline/run.ts:299-302` collapses that knowledge to two lines: `✗ pipeline failed at node <id>: <first-line-reason>` and `trace: <abs-path>`. To turn that pointer into a fix the human must (1) recognise the runId is the basename of `<abs-path>`, (2) `pipeline trace <runId>` to get the node listing, (3) eyeball it for the failed node's `nodeReceiveId`, (4) `pipeline trace <runId> --node-receive <id> --full`, (5) parse the validation-failure block to find `rawOutputPath`, (6) `cat` that file, (7) cross-reference the agent's `outputs:` frontmatter in `<dotDir>/<agentName>.md`. The failure surface is a *shallow module*: it exposes a path; the caller assembles the meaning. A solo human running pipelines all day pays this discovery tax on every failure.

## Why It Matters

The vision frames apparat as orchestration that "feels like delegating to someone who already understands the shape of the problem." Today's failure mode inverts that: the harness understands the shape and refuses to tell. Concrete waste:

- **Run footer drops the runId verbatim.** `tracePath` ends in `<runId>/pipeline.jsonl`, but the human must mentally extract `runId` to invoke `pipeline trace`. The next command they need to run is computable but uncomputed.
- **`nodeReceiveId` ≠ `nodeId`.** The footer prints `nodeId` (`<id>`) but `pipeline trace --node-receive` takes the *receive*-id, a per-invocation hash visible only after the listing call. Two-step lookup, no breadcrumb.
- **Validation failures hide their artifact.** `JsonlPipelineTracer.onValidationFailure` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:69-86`) writes a `validation-failure` event with `rawOutputPath` already filled in. The footer never mentions it; you only see it inside `pipeline trace --node-receive`.
- **No agent-file pointer.** The human's fix lives in `<dotDir>/<failedNode>.md`. The failure footer carries `nodeId` but never resolves it through the `loadAgent` seam to print the agent file path. The fix target is one resolver call away — uncalled.
- **`--resume` is invisible at the moment of need.** `pipeline run --resume <runId>` exists (`run.ts:99-110`) and is exactly what you want after fixing the agent. It is not mentioned in the failure footer.

This compounds the four prior pipeline-management illuminations (mission-control, cold authoring, prompt-assembly invisibility, two run homes). All four diagnose the same shape: information already exists in the system, the deep view that joins it doesn't. This one fills the most acute gap, because failure is when the human is paying maximum attention and minimum patience.

The Vincent-gate-trick lens applies: a failure should hand the human a verification artifact they cannot rationalize past — not a path they have to dig for. The every-action-needs-an-escape lens applies too: a failed run is a state, the human's "exit" is a fix, and today's exit is a treasure hunt.

## Revised Implementation Steps

1. **Deepen the failure footer in `src/cli/commands/pipeline/run.ts:299-302`.** When `lastFailedNodeId` is set, look up the failed node's receive-id from the just-written trace (the same `pipeline.jsonl` we authored), resolve the agent file via the `loadAgent` seam (when the failed node is an agent), and emit a four-line block: `✗ failed at <nodeId> (agent: <relPath>): <reason>`, `trace: <tracePath>`, `inspect: apparat pipeline trace <runId> --node-receive <receiveId> --full`, `resume: apparat pipeline run <dotFile> --resume <runId>`. Tool/gate nodes drop the `agent:` clause.

2. **Inline validation-failure raw-output paths.** When the trailing `pipeline.jsonl` events for the failed node include any `kind: "validation-failure"`, append a `raw outputs:` section listing each `rawOutputPath` (the most recent attempt last). One copy-pasteable line per attempt, e.g. `raw outputs:\n  attempt 3: <path>`. No truncated content inline — the path is enough; the human reads the file. (The data is already structured in the JSONL via `onValidationFailure`, no new instrumentation.)

3. **Add `apparat pipeline why <runId>`.** Compose the existing trace primitives into a single command that emits, in order: pipeline-end outcome → failed node → resolved agent file path → context snapshot at receive → validation attempts with raw paths → suggested resume command. Implementation = a new file under `src/cli/commands/pipeline/why.ts` that reads the same `pipeline.jsonl` `pipeline trace` reads, but renders the failure-centric projection. No new tracer fields, no new IPC. `pipeline trace <runId>` stays as today; `pipeline why` is the post-failure shortcut.

4. **Pin nodeId → agent path resolution behind one helper.** Add `resolveAgentFileForNode(node, dotDir): string | null` in `src/cli/lib/pipeline-status.ts` (or a new `agent-paths.ts` if it grows beyond one helper) so the run footer, `pipeline why`, and any future surface (e.g. a deepened `pipeline trace` with `agent:` annotations) share one resolver. Today this lookup is duplicated between agent-handler resolvers and ad-hoc string concatenation.

5. **Surface the same handoff inside the live Ink failure block** (`PipelineApp` end-frame). When a node ends with `outcome.status === "fail"`, the Static block for that node should print the same four-line handoff the post-exit footer prints. Today the Ink frame shows the failure reason but not the next-step commands. The TUI is where the human is *looking*; the stderr footer arrives after Ink has unmounted.

6. **Add a scenario test** at `.apparat/scenarios/pipeline-failure-footer/pipeline.dot` driving a deliberately-failing agent (or reusing `agent-implement` with a forced bad output) and asserting via tmux-tester that the four-line footer contains the agent path, the receive-id, and the resume command. This locks the contract against future regressions; today no scenario exercises the failure footer's shape.

7. **Update the spec ripple.** Once shipped, edit `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` §3.7 to record that `pipeline run`'s stderr footer shape changes, and link the new `pipeline why` command from `README.md`'s "Inspecting a run" section if one exists (or add the section). The deepened footer is the new contract — document it once, not in each follow-up.
