---
date: 2026-05-11
description: The `pipeline trace --node-receive` snapshot renderer is duplicated as four copy-paste recipes (PipelineApp received-context line, failure-handoff inspect: line, pipeline list runs table, README docs) while its real implementation hides inline in trace.ts — collapse to one `renderNodeReceive()` deep module and bind it to an `i` hotkey so the TUI stops telling users to leave and ask the data it already holds.
---

## Core Idea

Apparat's primary observability command is `apparat pipeline trace <runId> --node-receive <id>`. Its formatter lives in one place — the inline block at `src/cli/commands/pipeline/trace.ts:34-86`. But the *command string* is hand-assembled in four places:

- `src/cli/components/PipelineApp.tsx:198` — `received context: …`
- `src/cli/lib/failure-handoff.ts:58` — `inspect: …`
- `src/cli/commands/pipeline/list.ts:84` — `→ apparat pipeline trace <runId>` per row
- `README.md` — operator docs

None of them share a seam. Worse, the TUI holds every `contextSnapshot` in memory (it printed the line *because* it just received the `node-start` event) — yet to read that snapshot the user must fork attention to a second shell and re-parse the JSONL from disk. The inspector is shallow: complex interface (four copy-paste recipe sites + one CLI), thin implementation, no module hiding the duplication.

## Why It Matters

The steer asks for *intuitive observability* and *easy fast commands*. The current pattern is the opposite: every `received context: apparat pipeline trace …` line is the TUI confessing "I have this data — you have to leave and ask again." Four printed recipes is a shallow-module symptom flagged directly by `deep-modules-hide-complexity.md`: two implementations (`trace.ts` formatter + N hand-rolled recipe strings) that must agree on `<runId> <nodeReceiveId> [--full]` argument shape, with no seam forcing them to agree.

Drift is already happening. PipelineApp prints the receive command *without* `--full`; failure-handoff prints it *with* `--full`; pipeline list prints only the bare `runId` form. A future flag (e.g. `--diff`, `--prompt`) lands by editing four locations or by accepting silent drift.

Composing with the prior illuminations: `tui-keyboard-input-no-router` flags useInput double-dispatch, and `interaction-kinds-need-deep-drivers` flags the LiveBlock kind explosion. Adding inline inspection without an input router or a kind-driver makes both worse. Fixing the inspector seam *first* gives those refactors a clean test target.

## Revised Implementation Steps

1. **Extract the formatter.** Move the body of `pipelineTraceCommand`'s `nodeReceive` branch (`src/cli/commands/pipeline/trace.ts:34-86`) into `src/cli/lib/node-receive-inspector.ts` as a pure function: `renderNodeReceive(snapshot: ContextSnapshot, opts: { full?: boolean; promptPath?: string | null; validationFailures?: ValidationFailure[]; completedStages?: string[] }): string[]`. Replace the inline block with one call. Snapshot-test byte parity against an existing trace fixture.

2. **Share the recipe-string builder.** Add `inspectCommand(runId, nodeReceiveId, { full }: { full?: boolean })` next to `renderNodeReceive`. Replace the four hand-rolled `apparat pipeline trace …` template literals (PipelineApp, failure-handoff, pipeline list, plus any tests) with calls to it. Single source of `--node-receive` arg shape.

3. **Mount the inspector inline in PipelineApp.** Capture `event.contextSnapshot` from each `node-start` event into a per-block ref or `StaticItem.contextSnapshot`. Bind an Ink hotkey (`i` on the live block, or `[N]i` to inspect frozen block N) that appends a new `StaticItem` of kind `"inspector"` rendering `renderNodeReceive(snapshot)`. Route the hotkey through the input arbiter the `tui-keyboard-input-no-router` illumination will introduce.

4. **Replace the recipe line with a hint.** Drop the verbose `received context: apparat pipeline trace … --node-receive …` line in favor of `  press [i] to inspect · trace: <runId>:<nodeReceiveId>`. The full recipe stays available — `apparat pipeline trace --help` prints it — but the in-TUI default is the hotkey, not a second shell.

5. **Inline a compact snapshot in failure-handoff.** `renderFailureFooter` already loaded the JSONL — let it call `renderNodeReceive(snapshot, { full: false })` and embed the top-N keys directly in the in-frame fail block. Keep `inspect: <inspectCommand(.., { full: true })>` as the deep-dive escape. Failure becomes self-explanatory without leaving the TUI.

6. **Add `--diff <prev-receive-id>` to `pipeline trace`.** Once `renderNodeReceive` owns the format, layering diff on top is one module change. The TUI inherits it the same day via the shared module — exactly the locality + leverage payoff `deep-modules-hide-complexity.md` predicts.
