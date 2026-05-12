---
date: 2026-05-12
description: The TUI failure-handoff JSX block at PipelineRunView.tsx:222-239 reconstructs the same 5-line shape as CLI renderFailureFooter — same shallow-module pattern just refactored away for the recipe string, now at the whole-footer level.
---

## Core Idea

`renderFailureFooter` in `src/cli/lib/failure-handoff.ts:42-56` and the `failure-handoff` branch in `src/cli/components/PipelineRunView.tsx:222-239` independently render the same 5-line failure footer (✗ header, `trace:`, optional `raw output:`, optional `inspect:`, blank line, `resume:`). They already agree today only because two developers copied the same shape by hand. The just-shipped `inspectCommand` extraction fixed this pattern for one line (the `inspect:` recipe); the surrounding four lines remain duplicated.

## Why It Matters

This is the same shallow-module symptom the deep-modules stimulus warns about — "a concept implemented twice (front end and back end) with no single seam where they're forced to agree." The trace-inspector refactor that just shipped (run `parallel-illumination-to-implementation-d1e37dba`, 2026-05-12) collapsed one slice of the duplication; memory-writer's gotchas section flagged the surrounding footer as an explicit out-of-scope sibling. Concrete drift risk that exists today:

- `PipelineRunView.tsx:228` and `failure-handoff.ts:46` both render `✗ failed at <nodeId>(agent: <agentRelPath>): <reason>` — any change to the `agent:` clause format must be made in both places.
- `PipelineRunView.tsx:232` and `failure-handoff.ts:47` both render `trace: <tracePath>` — same comment.
- `PipelineRunView.tsx:233` and `failure-handoff.ts:48` both conditionally render `raw output: <rawOutputPath>` — same comment.
- The unconditional blank line before `resume:` (called out as a chat-refinement contract in `failure-handoff.ts:38-40`) is pinned by the CLI doc-comment but only by convention in the TUI block.
- Existing pin tests (`failure-handoff.test.ts:39/71`, `pipeline-failure-reason.test.ts:69`, `pipeline-failure-footer-scenario.test.ts:58`) lock the CLI shape byte-exact, but no equivalent snapshot pins the TUI block — a JSX edit could silently diverge.

The recently-shipped slice proved the deep-module collapse works: one module (`node-receive-inspector.ts`) now owns both the formatter and the recipe builder, and the migration was byte-parity-clean across CLI, TUI, and lib consumers. Extending the same seam to the whole footer is the natural continuation.

## Revised Implementation Steps

1. **Pin the current TUI shape with a snapshot test.** Add a test that renders the `failure-handoff` `Static` item via `PipelineRunView` and asserts the rendered text equals `renderFailureFooter(handoff)`. This catches drift today before any refactor and proves both paths emit the same bytes right now (or surfaces the first real drift if they already diverge).

2. **Extract footer line builders into `src/cli/lib/failure-handoff.ts`.** Add `renderFailureFooterLines(h: FailureHandoff): string[]` next to `renderFailureFooter`; have `renderFailureFooter` join the lines with `\n` and append the trailing newline. Pure-function shape parallels the `renderNodeReceive(snapshot, opts) → string[]` pattern just shipped.

3. **Make the TUI consume `renderFailureFooterLines`.** Rewrite the `failure-handoff` branch in `PipelineRunView.tsx:223-241` to map the lines array to `<Text key={i}>{line}</Text>` inside the existing `<Box flexDirection="column" marginBottom={1}>`. Ink's `<Text>` renders a literal blank line for the unconditional `""` entry, matching `marginBottom={0}` row spacing.

4. **Verify byte parity end-to-end.** Re-run `pipeline-failure-footer` scenario plus `pipeline-app-integration` after the swap; the live `received context:` recipe (no `--full`) and the failure footer `inspect:` recipe (with `--full`) must remain unchanged — the slice that just shipped pinned both.

5. **Decide the trailing-newline contract.** `renderFailureFooter` returns `lines.join("\n") + "\n"`; the TUI Static-item path renders one `<Text>` per line and does not need the trailing newline. Document in a one-line doc-comment that `renderFailureFooterLines` returns the inner lines without a terminator, and `renderFailureFooter` is the CLI-string wrapper.

6. **(Optional, defer if scope creeps.)** Consider whether the TUI block should also conditionalize on `h.agentRelPath` and `h.rawOutputPath` via `null` items in the lines array vs the current JSX `{h.rawOutputPath && …}` shape. The cleanest seam is for `renderFailureFooterLines` to return only the lines that should be visible, and the consumer to render whatever it received.

Sibling pin to remember: the `inspectCommand` byte-parity contract (`failure-handoff.test.ts:39/71`, `pipeline-failure-reason.test.ts:69`, `pipeline-failure-footer-scenario.test.ts:58`) still applies — `{ full: true }` MUST emit `--full`; `{}` MUST omit it.

## Provenance

- Source memory: `.apparat/sessions/2026-05-12-trace-inspector-shallow-out-of-process.md`
- Pipeline run id: `parallel-illumination-to-implementation-d1e37dba`
- Surfaced by: memory-reflector
