# Design: Deepen `pipeline run`'s failure footer (and Ink fail frame) into a copy-paste recipe

**Date:** 2026-05-09
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2141-pipeline-failure-handoff-is-shallow.md`

## 1. Motivation

When `apparat pipeline run` fails today, the human gets two stderr lines and is then on their own.

The footer at `src/cli/commands/pipeline/run.ts:378-379` is:

```ts
process.stderr.write(`✗ pipeline failed at node ${lastFailedNodeId}: ${firstLine}\n`);
process.stderr.write(`  trace: ${tracePath}\n`);
```

Every other piece of context the harness already knows is available *somewhere else*:

- The failed node's **agent file** lives at `<dotDir>/<failedNode>.md` (gate file at the same path; tool nodes have neither). The footer never resolves the path even though both `loadAgent` (`src/cli/lib/agent-loader.ts:29-39`) and `resolveGate` (`src/cli/lib/gate-registry.ts:12-31`) already join `dotDir + nodeId + ".md"` and the `dotDir` is in scope at `src/cli/commands/pipeline/run.ts:55`.
- The **per-invocation receive id** the human needs to feed `apparat pipeline trace --node-receive` is written to the same JSONL the footer points at. `JsonlPipelineTracer.onNodeStart` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:26-35`) records `nodeReceiveId` on every node-start. The footer prints `nodeId` (`runner`) but `pipeline trace --node-receive` takes the *receive*-id (`a3f1…`); two-step lookup, no breadcrumb.
- The **raw output** path for any validation-retry failure is structured into the trace by `JsonlPipelineTracer.onValidationFailure` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:60-76`) — `kind: "validation-failure"`, `nodeReceiveId`, `attempt`, `errors`, `rawOutputPath`, `timestamp`. The footer never mentions `rawOutputPath`; the human only sees it after running `pipeline trace --node-receive --full`.
- The **resume command** that exists exactly for this moment (`apparat pipeline run <dotFile> --resume <runId>`, documented at `README.md:73,82` and `src/cli/program.ts:118,125,134`) is invisible at the moment of need.

The Ink TUI is no better. `BlockCloseView` at `src/cli/components/PipelineApp.tsx:38-46` collapses a failed block to one dim line — `glyph + status + reason + turns + tokens + duration`. None of agent path, receive id, raw-output path, or resume command surface. The TUI is where the human is *looking*; the stderr footer arrives only after Ink has unmounted.

The verifier's project-fit pass found the team already deepening this exact surface — `88ffe3d feat(tracer): add onValidationFailure for retry observability`, `548a46c feat(trace+docs): emit prompt: path in --node-receive`, `19e73b2 feat(pipeline): add explain <pipeline> [nodeId]`. This design lands the failure-side mirror of those commits: a footer that hands the human a recipe of commands they can already run, instead of a path they have to dig from.

The compass: VISION.md frames pipelines as *delegating to someone who already understands the shape of the problem*. Today's failure mode inverts that — the harness understands the shape and refuses to tell. The Vincent-gate-trick lens applies: failure should hand the human a verification artifact they cannot rationalise past, not a path they have to dig for. The every-action-needs-an-escape lens applies too: a failed run is a state, the human's exit is a fix, today's exit is a treasure hunt.

## 2. Decision summary

The chat refinement (round 1) collapsed the illumination's seven steps into a presentation-only change over data the tracer already records. This design implements only the refined shape:

1. **Deepen the stderr footer in `src/cli/commands/pipeline/run.ts:378-379`** into a bird's-eye line plus a named recipe of existing commands, separated into two visual blocks. Investigation block above, retry block below.
2. **Mirror the same handoff inside the Ink fail frame** at `src/cli/components/PipelineApp.tsx:38-46`. Today the frame collapses a failed block to one dim line; in the failure case it grows to the same recipe shape.
3. **Pin nodeId → agent path resolution behind one helper.** New `src/cli/lib/agent-paths.ts` exporting `resolveAgentFileForNode(node, dotDir): string | null` — used by both render sites so they cannot drift. Returns `null` for tool nodes (no `.md` sibling expected) and for missing files.
4. **Lookup of `nodeReceiveId` and `rawOutputPath` for the failed node** uses the JSONL we just authored — same file the footer already points at. New `src/cli/lib/failure-handoff.ts` exposing `loadFailureHandoff(tracePath, failedNodeId): FailureHandoff` so the stderr footer and the Ink fail frame share one reader.
5. **Add a scenario test** `.apparat/scenarios/pipeline-failure-footer/` driving a deliberately-failing tool node and asserting the footer shape.
6. **Update the existing failure-reason test** `src/cli/tests/pipeline-failure-reason.test.ts:63-65` to match the new footer.
7. **Doc ripple.** README "Inspecting a run" segment (the trace-and-resume paragraph at `README.md:82,100-102`) gains one paragraph showing the new footer shape; `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` gains a new section recording the footer change.

**Locked OUT of scope** (chat refinements, round 1):

- A new `apparat pipeline why <runId>` command. Refinement-bullet 2: "creating markdown files seems bloat risk … Alt A sounds good option for now at least." Footer-as-recipe achieves the same end with zero new command, zero new render format, zero on-disk artifacts.
- Inlining raw-output file contents. Refinement-bullet 7: paths only — Claude `cat`s the path itself; inlining duplicates what the recipe already fetches.
- Listing every validation-retry attempt's `rawOutputPath` inline. Refinement-bullet 4: latest attempt only; full per-attempt list reachable via the named `pipeline trace --node-receive --full` command in the footer.
- Mixing investigation and retry commands into one block. Refinement-bullet 3: two visual blocks separating investigation from retry; resume is post-fix, not part of context-gathering.
- New tracer fields, new IPC, success-path footer changes. The data is already structured; only the renderer is shallow.

## 3. Architecture

### 3.1 Before / after

**Before** (current 2-line footer, `src/cli/commands/pipeline/run.ts:378-379`):

```
✗ pipeline failed at node runner: boom-stderr
  trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl
```

**After** (refined-scope recipe, two visual blocks):

```
✗ failed at runner (agent: implement.md): boom-stderr
trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl
raw output: /work/.apparat/runs/a1b2c3d4/runner/raw-3.txt
inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full

resume: apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4
```

A blank line separates investigation (top block — what broke, where to look) from retry (bottom block — what to type once you fixed it). The `agent:` clause is omitted on tool nodes; the `raw output:` line is omitted when no validation-failure event was recorded for the failed node.

The Ink fail frame at `src/cli/components/PipelineApp.tsx:38-46` mirrors the same shape — `BlockCloseView` grows from a single dim line into a multi-line block in the failure case only. Success blocks stay collapsed.

### 3.2 The footer renderer

A new pure function in a new lib file:

```ts
// src/cli/lib/failure-handoff.ts
export interface FailureHandoff {
  nodeId: string;
  nodeReceiveId: string | null;     // null when no node-start was recorded (early crash)
  agentRelPath: string | null;       // null on tool nodes or missing .md sibling
  reason: string;                    // first 500 chars of failureReason, single-line
  tracePath: string;
  runId: string;                     // used to render the `inspect:` line
  rawOutputPath: string | null;      // latest validation-failure attempt only
  resumeCommand: string;             // `apparat pipeline run <dotFile> --resume <runId>`
}

export function loadFailureHandoff(args: {
  tracePath: string;
  failedNodeId: string;
  failureReason: string;
  dotFile: string;
  dotDir: string;
  runId: string;
  graph: Graph;
}): FailureHandoff;

export function renderFailureFooter(h: FailureHandoff): string;
```

`loadFailureHandoff` reads the JSONL we just authored:

- Find the most recent `kind: "node-start"` event matching `nodeId === failedNodeId`; its `nodeReceiveId` is the receive id.
- For that `nodeReceiveId`, find any `kind: "validation-failure"` events; sort by `attempt`; pick the highest-attempt event's `rawOutputPath`.
- Resolve agent file via `resolveAgentFileForNode(graph.nodes.get(failedNodeId), dotDir)`.
- Resume command is built from `dotFile` (the user-facing path passed to `pipeline run`) and `runId`.

`renderFailureFooter` formats the `FailureHandoff` into the two-block string. No I/O, no globals — easy to snapshot-test.

### 3.3 The shared agent-path helper

```ts
// src/cli/lib/agent-paths.ts
import { existsSync } from "fs";
import { join, relative } from "path";
import type { Node } from "../../attractor/types.js";
import { resolveHandlerType } from "../../attractor/core/graph.js";

/**
 * Resolve the on-disk `.md` sibling for an agent or gate node.
 * Returns the path relative to cwd when the file exists, null otherwise.
 * Tool / start / exit nodes always return null (no `.md` sibling expected).
 */
export function resolveAgentFileForNode(
  node: Node,
  dotDir: string,
): string | null {
  const kind = resolveHandlerType(node);
  if (kind !== "agent" && kind !== "wait.human") return null;
  const abs = join(dotDir, `${node.id}.md`);
  if (!existsSync(abs)) return null;
  return relative(process.cwd(), abs) || abs;
}
```

Single resolver, single call site for "what `.md` file does this nodeId map to?" — used by `failure-handoff.ts` and (via `failure-handoff.ts`) by both render sites. Today this lookup is duplicated inline at `src/cli/lib/agent-loader.ts:33` and `src/cli/lib/gate-registry.ts:16`; this helper does not replace those (they still own loading/parsing) — it owns the *path*-only question.

`resolveHandlerType` (`src/attractor/core/graph.ts:28`) already classifies node kinds; we reuse it rather than re-deriving from `node.shape`.

### 3.4 Wiring `pipeline/run.ts`

The current footer block at `src/cli/commands/pipeline/run.ts:374-382`:

```ts
if (pipelineFailed) {
  if (lastFailedNodeId) {
    const firstLine = (lastFailureReason ?? "pipeline failed").split("\n")[0].slice(0, 500);
    process.stderr.write(`✗ pipeline failed at node ${lastFailedNodeId}: ${firstLine}\n`);
    process.stderr.write(`  trace: ${tracePath}\n`);
  }
  process.exit(1);
}
```

becomes:

```ts
if (pipelineFailed) {
  if (lastFailedNodeId) {
    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: lastFailedNodeId,
      failureReason: lastFailureReason ?? "pipeline failed",
      dotFile,
      dotDir,
      runId,
      graph,
    });
    process.stderr.write(renderFailureFooter(handoff));
  }
  process.exit(1);
}
```

`dotFile` is the original positional arg; `dotDir` is computed at `src/cli/commands/pipeline/run.ts:55`; `runId` at `:126`; `tracePath` at `:143`; `graph` is the post-`variableExpansionTransform` value. All in scope, no signature change.

If `loadFailureHandoff` fails to read the trace (early crash before any node-start was authored), it returns a `FailureHandoff` with `nodeReceiveId: null` and `rawOutputPath: null`; `renderFailureFooter` omits the `inspect:` and `raw output:` lines accordingly. The footer never throws.

### 3.5 Wiring the Ink fail frame

`BlockCloseView` (`src/cli/components/PipelineApp.tsx:38-46`) renders a single dim line today. In the failure case the renderer needs the same `FailureHandoff` shape. Two options, both compatible with the existing `Block` type — the implementing session picks based on the post-extract test ergonomics:

- **Option A (preferred):** the `PipelineApp` props grow an optional `failureHandoff?: FailureHandoff` field, populated by `pipelineRunCommand` when the engine result is non-success. `BlockCloseView` checks `block.outcome.status === "fail"` and, when both the prop and the matching block id are present, renders the multi-line block. Pro: `BlockCloseView` stays a pure render — no new I/O in the React tree.
- **Option B:** `BlockCloseView` calls `loadFailureHandoff` itself when status is `fail`. Pro: no prop plumbing. Con: re-reads the JSONL inside the render, sneaking I/O into a component that has none today.

Option A is the default. The new render shape:

```tsx
function BlockCloseView({ block, handoff }: { block: Block; handoff?: FailureHandoff }) {
  const glyph = block.outcome.status === "success" ? "✓" : "✗";
  const summary = `  ${glyph} ${block.outcome.status} · ${block.outcome.reason ?? ""} · ${block.stats.turns} turns · ${block.stats.tokensIn}/${block.stats.tokensOut} tok · ${(block.stats.durationMs / 1000).toFixed(1)}s`;

  if (block.outcome.status !== "fail" || !handoff) {
    return <Text dimColor>{summary}</Text>;
  }

  // Same recipe shape as the stderr footer, rendered as Static rows.
  return (
    <Box flexDirection="column">
      <Text dimColor>{summary}</Text>
      <Text>✗ failed at {handoff.nodeId}{handoff.agentRelPath ? ` (agent: ${handoff.agentRelPath})` : ""}: {handoff.reason}</Text>
      <Text>trace: {handoff.tracePath}</Text>
      {handoff.rawOutputPath && <Text>raw output: {handoff.rawOutputPath}</Text>}
      {handoff.nodeReceiveId && (
        <Text>inspect: apparat pipeline trace {handoff.runId} --node-receive {handoff.nodeReceiveId} --full</Text>
      )}
      <Text> </Text>
      <Text>resume: {handoff.resumeCommand}</Text>
    </Box>
  );
}
```

The block is rendered inside the existing `<Static>` items list (`src/cli/components/PipelineApp.tsx:36`) so it scrolls into history with the rest of the run, exactly like the success summary does today.

The visible text is byte-identical to what the stderr footer prints (modulo Ink's row-level rendering vs. raw `\n`). Both render sites consume the same `FailureHandoff` value, so a future field addition lands in one place.

### 3.6 `loadFailureHandoff` reading the JSONL

The same JSONL the footer points at is the source. Read shape:

```ts
const lines = readFileSync(tracePath, "utf-8")
  .trim().split("\n").map(l => JSON.parse(l) as Record<string, unknown>);

// Most recent node-start for the failed node (a node may run many times in retry loops).
const nodeStarts = lines.filter(l => l.kind === "node-start" && l.nodeId === failedNodeId);
const nodeReceiveId = nodeStarts.length > 0
  ? String(nodeStarts[nodeStarts.length - 1].nodeReceiveId)
  : null;

// Latest validation-failure attempt for that receive id (empty for non-validation failures).
const failures = nodeReceiveId
  ? lines.filter(l => l.kind === "validation-failure" && l.nodeReceiveId === nodeReceiveId)
  : [];
const rawOutputPath = failures.length > 0
  ? String(failures.sort((a, b) => Number(b.attempt) - Number(a.attempt))[0].rawOutputPath)
  : null;
```

Behaviour:

- **No node-start was written** (engine crashed before the failed node started — extremely rare; the engine writes node-start *before* invoking the handler at `JsonlPipelineTracer.onNodeStart` `src/attractor/tracer/jsonl-pipeline-tracer.ts:26-35`): `nodeReceiveId = null` → `inspect:` line omitted; `rawOutputPath = null` → `raw output:` line omitted. The `agent:` clause and `reason` still print.
- **Node-start present, no validation failure** (tool/agent crash, or final-attempt agent fail with no schema): `nodeReceiveId` set, `rawOutputPath = null`. Footer prints `inspect:` line, omits `raw output:` line.
- **Node ran retries that all failed** (validation-retry exhaustion): `nodeReceiveId` set, `rawOutputPath` is the highest-attempt event's path. Earlier attempts are reachable via the `inspect:` line — `pipeline trace --node-receive --full` prints all of them per `src/cli/commands/pipeline/trace.ts:71-83`.

The JSONL is the trace we **just authored** in the same process; no race with concurrent writers. `tracePath` is the canonical location at `src/cli/commands/pipeline/run.ts:143`. If `readFileSync` throws (unwritable filesystem), `loadFailureHandoff` catches and returns the degraded handoff (`nodeReceiveId: null`, `rawOutputPath: null`) — the footer always prints *something*, never zero lines.

### 3.7 `renderFailureFooter` shape

Plain string, no chalk, no terminal capability assumptions (the existing footer is plain too):

```
✗ failed at <nodeId>[ (agent: <relPath>)]: <reason>
trace: <tracePath>
[raw output: <rawOutputPath>]
[inspect: apparat pipeline trace <runId> --node-receive <receiveId> --full]

resume: <resumeCommand>
```

Bracketed lines drop when the `FailureHandoff` field is null. The blank line between investigation and retry is unconditional — separation is the chat-refinement rule (round 1, bullet 3). Trailing newline after `resume:` so subsequent shell prompts start on their own line.

The bird's-eye line replaces the current `✗ pipeline failed at node X: …` shape. Removed text: the words `pipeline failed at node` — they say nothing the rest of the footer doesn't already imply, and they push the actually-useful agent path off the visual centre.

### 3.8 Files-touched buckets

| Bucket | File | Treatment |
|---|---|---|
| Footer renderer | `src/cli/lib/failure-handoff.ts` | **New** — `loadFailureHandoff`, `renderFailureFooter`, `FailureHandoff` interface |
| Path resolver | `src/cli/lib/agent-paths.ts` | **New** — `resolveAgentFileForNode` |
| Run command | `src/cli/commands/pipeline/run.ts` | Inline edit — replace footer block at `:374-382` with `renderFailureFooter(loadFailureHandoff(...))` |
| Ink fail frame | `src/cli/components/PipelineApp.tsx` | Inline edit — `BlockCloseView` accepts optional `handoff` prop and renders the multi-line block on `fail`; `PipelineApp` plumbs the prop through |
| Existing failure test | `src/cli/tests/pipeline-failure-reason.test.ts` | Edit — update assertions at `:63-65` to match the new footer (agent path, receive id, raw output, resume command) |
| New scenario | `.apparat/scenarios/pipeline-failure-footer/pipeline.dot` (+ supporting files) | **New** — deliberately-failing pipeline asserting the footer shape via the existing scenario harness |
| New unit test | `src/cli/tests/failure-handoff.test.ts` | **New** — `loadFailureHandoff` reading a fixture JSONL + `renderFailureFooter` snapshot |
| Doc — README | `README.md` | Inline edit — one paragraph in the trace/resume area (around `:82` and `:100-102`) showing the new footer shape |
| Doc — monolith spec | `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` | Edit — add a new section (e.g. **§3.6 Failure-footer contract**) after the existing `§3.5 LOC sanity check` recording the footer-shape change. Verifier flagged the originating illumination's `§3.7` reference is incorrect — that section does not exist; the implementer adds the new section rather than editing a missing one. |

Total files: 9 (4 new, 5 edited). Surfaces: CLI lib (2 new helpers), CLI command (1 inline edit), Ink TUI (1 inline edit), tests (1 edited + 1 new + 1 new scenario), docs (2 edited). No daemon IPC, no `.dot` schema change, no tracer schema change.

## 4. Components & key edits

### 4.1 `src/cli/lib/agent-paths.ts` (new)

See §3.3. ~25 LOC. Single export `resolveAgentFileForNode(node, dotDir): string | null`. No side effects beyond `existsSync`.

### 4.2 `src/cli/lib/failure-handoff.ts` (new)

See §3.2 + §3.6 + §3.7. ~120 LOC. Two exports — `loadFailureHandoff` (reads JSONL, builds handoff) and `renderFailureFooter` (pure formatter). Imports `resolveAgentFileForNode` from §4.1. The functions split so tests can snapshot `renderFailureFooter` with a hand-built `FailureHandoff`, and exercise `loadFailureHandoff` with a fixture JSONL — no full pipeline run needed.

### 4.3 `src/cli/commands/pipeline/run.ts` (edited)

See §3.4. Single block edit at `:374-382`. The surrounding state (`pipelineFailed`, `lastFailedNodeId`, `lastFailureReason`, `tracePath`, `runId`, `dotDir`, `graph`) all already in scope. No new imports beyond `loadFailureHandoff` and `renderFailureFooter`.

### 4.4 `src/cli/components/PipelineApp.tsx` (edited)

See §3.5. Two edits:

1. `BlockCloseView` grows an optional `handoff` prop and renders the multi-line block when `block.outcome.status === "fail"` and `handoff` is present.
2. `PipelineApp` accepts `failureHandoff?: FailureHandoff` as a new prop, passes it down to the `BlockCloseView` instance whose `block.id` matches the failed node. The append-only Static-items list (`:54-56`) already preserves the multi-line block in the rendered history.

`renderPipelineApp` (the wrapper used at `src/cli/commands/pipeline/run.ts:162`) gains the same prop. The handoff is computed by `pipelineRunCommand` (using the same `loadFailureHandoff` call as the stderr footer) and threaded into the Ink frame *before* `done()` is called at `:373`. Today `done()` triggers the post-frame stderr write; both render sites see the same handoff.

### 4.5 `src/cli/tests/pipeline-failure-reason.test.ts` (edited)

Update the assertions at `:63-65`:

```ts
expect(writtenStderr).toMatch(/✗ failed at runner( \(agent: .*\))?: .*boom-stderr/);
expect(writtenStderr).toContain(`trace: ${tracePath}`);
expect(writtenStderr).toMatch(/resume: apparat pipeline run .*--resume /);
```

The `agent:` clause is optional in this fixture — the test pipeline's `runner` node is a tool (`type="tool"`), so `resolveAgentFileForNode` returns `null` and the clause is omitted. The optional regex group documents this. The `inspect:` and `raw output:` line assertions are added when the test fixture is upgraded to drive a node-start event (it already does — the engine emits node-start before the handler runs).

### 4.6 `src/cli/tests/failure-handoff.test.ts` (new)

Cases:

- Snapshot of `renderFailureFooter` for a fully-populated `FailureHandoff` (agent + receive id + raw output + resume).
- Snapshot for a tool-node handoff (no `agent:` clause).
- Snapshot for an early-crash handoff (no receive id, no raw output).
- `loadFailureHandoff` against a fixture JSONL with a single failed node-start picks the right receive id.
- `loadFailureHandoff` against a fixture JSONL with three validation-failure attempts picks the highest-attempt `rawOutputPath`.
- `loadFailureHandoff` against a non-existent trace path returns the degraded handoff (no throw).

### 4.7 `.apparat/scenarios/pipeline-failure-footer/` (new)

Sibling to the existing 14 scenario folders (e.g. `agent-implement/`, `tool/`, `gate/`). Mirrors the structure of an existing scenario the implementing session picks as reference (`tool/` is the closest fit — already drives tool-node failure paths). The scenario asserts via the standard scenario harness that the footer printed to stderr contains:

- `✗ failed at <nodeId>` (agent clause optional based on node kind).
- `trace: <path>`.
- `resume: apparat pipeline run … --resume <runId>`.
- A blank line between the trace/inspect block and the resume line.

This locks the footer's contract against future regressions; today no scenario exercises the failure footer's *shape*.

## 5. Data flow

### 5.1 Stderr footer path (today)

```
pipeline run fails
  → engine writes pipeline-end with outcome=failure to JSONL
  → run.ts: pipelineFailed=true, lastFailedNodeId set
  → done() flushes Ink
  → process.stderr.write(`✗ pipeline failed at node ${lastFailedNodeId}: ${firstLine}`)
  → process.stderr.write(`  trace: ${tracePath}`)
  → process.exit(1)
```

### 5.2 Stderr footer path (after)

```
pipeline run fails
  → engine writes pipeline-end with outcome=failure to JSONL
  → run.ts: pipelineFailed=true, lastFailedNodeId set
  → loadFailureHandoff({ tracePath, failedNodeId, failureReason, dotFile, dotDir, runId, graph })
      → readFileSync(tracePath) → parse JSONL
      → find latest node-start for failedNodeId → nodeReceiveId
      → find latest validation-failure for receiveId → rawOutputPath
      → resolveAgentFileForNode(node, dotDir) → agentRelPath
      → build FailureHandoff
  → done() flushes Ink (Ink fail frame already rendered the multi-line block)
  → process.stderr.write(renderFailureFooter(handoff))
  → process.exit(1)
```

### 5.3 Ink fail frame path (after)

```
node fails
  → engine onNodeEnd fires → emit({ kind: "end", outcome: { status: "fail", reason } })
  → reducer freezes the block
  → useEffect appends `block-close` static item
  → BlockCloseView reads handoff prop (set by pipelineRunCommand when failure was detected)
      → if handoff && block.outcome.status === "fail" → render multi-line block
      → else → render the existing one-line summary
  → Static items list grows by one block-close (multi-line in fail case)
```

The handoff is computed once per run (after the engine returns a non-success result) and passed into the Ink frame before `done()`. The reducer does not need to know about handoffs — only `BlockCloseView` reads the prop, so the change is local to the leaf component.

## 6. Blast radius / impact surface

- **Size:** **M.** Verifier final pass: M (reduced from prior pass after dropping `pipeline why`). Explainer Tier-2 §Blast radius: M. Same envelope.
  - **Files touched:** ~9 — 4 new (`failure-handoff.ts`, `agent-paths.ts`, `failure-handoff.test.ts`, `.apparat/scenarios/pipeline-failure-footer/`) + 5 edited (`run.ts`, `PipelineApp.tsx`, `pipeline-failure-reason.test.ts`, `README.md`, monolith spec).
  - **Surfaces crossed:** CLI commands (1 — `run.ts` footer block), CLI lib (2 new helpers), Ink TUI (1 — `BlockCloseView` + `PipelineApp` prop), scenarios (1 new), tests (1 edited + 1 new), docs (2 edited). No daemon IPC, no `.dot` schema change, no tracer schema change, no `program.ts` registration (no new command).
- **Breaking changes:** **yes, contained.**
  - The existing test `src/cli/tests/pipeline-failure-reason.test.ts:63-65` asserts the *current* 2-line footer shape. The test must be updated as part of this change (see §4.5). No external consumers parse the footer per the verifier's scenario subagent — the existing 14 scenarios do not match against `✗ pipeline failed at node`, and the daemon/tmux-tester/external scripts grep on the trace JSONL, not on stderr text.
  - No public CLI flag, no exit code, no JSONL field changes. `process.exit(1)` still fires; `tracePath` still printed (just under a new label).
- **Spec / docs ripple checklist:**
  - [ ] `README.md` around lines 82 and 100-102 — one paragraph in the trace/resume area showing the new footer shape and pointing at the `--resume` line as the standard recovery path. (The README already explains `--resume` and `pipeline trace --node-receive --full`; the new paragraph clarifies that a failed run prints both as a recipe.)
  - [ ] `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` — add a new section after the existing `§3.5 LOC sanity check` (e.g. **§3.6 Failure-footer contract**). Record: the new footer shape, the helper-file split, the test/scenario additions. The illumination cited `§3.7` of this doc, but the doc's `§3` ends at `§3.5` (verifier confirmed); the implementer adds a new section rather than editing a missing one.
  - [ ] **No new ADR.** ADR-0001 (`docs/adr/0001-agents-live-next-to-pipeline.md`) is reinforced — `resolveAgentFileForNode` centralises the path-resolution rule the ADR endorses. ADR-0011 (skill-as-shim-plus-live-reference) does not apply — no skill surface change.
  - [ ] **No CONTEXT.md change.** No new domain term.
  - [ ] **No `SKILL.md` change.** No new pipeline subcommand; the existing `pipeline run`, `pipeline trace`, and `--resume` rows already describe the surface the new footer recipes commands from.
- **Test ripple checklist:**
  - [ ] **Edit** `src/cli/tests/pipeline-failure-reason.test.ts:63-65` — replace the 2-line footer assertions with the new recipe-shape assertions (§4.5).
  - [ ] **New** `src/cli/tests/failure-handoff.test.ts` — unit tests for `loadFailureHandoff` and `renderFailureFooter` (§4.6).
  - [ ] **New** `.apparat/scenarios/pipeline-failure-footer/` — scenario locking the footer shape under the standard scenario harness (§4.7).
  - [ ] **No change** to existing scenarios. The verifier's scenario subagent confirmed none of the 14 existing scenario folders match against the current footer text; updating them is unnecessary.

## 7. Trade-offs

### 7.1 Footer-as-recipe vs. new `pipeline why` command

**Footer-as-recipe** chosen. Reasons (refinement-locked):

- chat_summarizer round 1, bullet 1: "What I'm looking for from this failure output is broad bird eye view and commands that reveal the context. Then I usually just copy and paste these for claude agent to fix the pipeline or create a plan that can be runned to fix the error if it comes from source code."
- chat_summarizer round 1, bullet 2: "Hmm creating markdown files seems bloat risk. Any other ways to get this context? Programmatically stdout to terminal that agent can also run in order to get context?" + "Alt A sounds good option for now at least."
- The composer command and its rollup-doc rendering exist only to glue together commands the user can already run. Footer-as-recipe achieves the same end with zero new command, zero new render format, zero on-disk artifacts. The user's loop is footer → copy commands → paste into Claude → Claude runs commands and reads output → Claude fixes. The footer's job is to announce the right primitives at the moment of need, not manufacture a structured artifact.

### 7.2 Two visual blocks vs. one block

**Two blocks** chosen. Reasons (refinement-locked):

- chat_summarizer round 1, bullet 3: separation of investigation from retry — resume is post-fix, not part of context-gathering.
- Mixing investigation and retry commands creates noise during the understand phase; separation makes the footer scan-friendly.
- Costs one blank line; benefits scanability under fatigue (every failure encounter is a fatigue moment).

### 7.3 Latest attempt only vs. enumerate every retry

**Latest attempt only** chosen. Reasons (refinement-locked):

- chat_summarizer round 1, bullet 4: "What are these raw outputs in after implementation?" → after explanation, Alt A example showing only latest attempt was accepted.
- The failed final attempt is what Claude needs to diagnose. Listing all attempts is noise for the common case; full per-attempt list is still reachable via the named `pipeline trace --node-receive --full` command in the footer.
- Costs one extra command to see all attempts; benefits a 99%-case-clean footer.

### 7.4 Paths only vs. inline content

**Paths only** chosen. Reasons (refinement-locked):

- chat_summarizer round 1, bullet 7: "copy and paste these for claude agent to fix the pipeline" — Claude `cat`s the path itself.
- Inlining contents bloats the footer and duplicates what the recipe commands already fetch. Multi-MB raw outputs would break terminal scrollback for a use case the named `inspect:` line already covers.

### 7.5 Shared helper vs. inline `dotDir + nodeId + ".md"` at each render site

**Shared helper** chosen. Reasons:

- chat_summarizer round 1, bullet 6 (carried over from verifier proposal, not contested): single resolver keeps stderr footer and Ink BlockCloseView in lockstep; avoids drift between two render sites.
- Today the path-resolution rule is duplicated at `src/cli/lib/agent-loader.ts:33` (`join(pipelineDir, ${name}.md)`) and `src/cli/lib/gate-registry.ts:16` (`join(opts.dotDir, ${nodeId}.md)`). The new helper does not displace those — they own loading/parsing. The helper owns *path-only* resolution for "does this node have a `.md` sibling, and where is it?".
- Cost: one new ~25-LOC file. Benefit: future render sites (e.g. a deepened `pipeline trace --node-receive` agent annotation) plug into the same resolver.

### 7.6 Read JSONL once at footer time vs. thread state through engine

**Read JSONL** chosen. Reasons:

- The trace JSONL is the canonical source of `nodeReceiveId` and `rawOutputPath` for the failed node — these are tracer-side concerns, not engine-result-side concerns. Threading them through `runPipeline`'s return value would require widening the engine's outcome type for a CLI-side rendering concern.
- The JSONL we read is the one we just authored in the same process — no race, no missing data (modulo early-crash, which is handled by the degraded handoff per §3.6).
- Cost: one extra `readFileSync` at failure time only. Benefit: zero engine-API change.

### 7.7 Option A (prop plumbing) vs. Option B (Ink-side I/O) for the fail frame

**Option A** preferred. Reasons:

- `BlockCloseView` and the rest of `PipelineApp` are pure renders today (no I/O). Sneaking `readFileSync` into a React component breaks the test ergonomic — every fail-frame test would need to spin up a real trace file.
- Option A keeps the I/O at the command boundary (`pipelineRunCommand`) where the existing `loadFailureHandoff` call already lives for the stderr footer. One read, two render sites.

### 7.8 Sequencing — single PR vs. multi-PR split

Single PR. Default: **single PR** (~9 files, no public CLI surface change, all tests update in lockstep). The natural multi-PR split would be:

- **PR 1:** `agent-paths.ts` + `failure-handoff.ts` + their unit tests (no behaviour change yet).
- **PR 2:** wire `pipelineRunCommand` to use the new helpers; update `pipeline-failure-reason.test.ts`; new scenario.
- **PR 3:** Ink fail frame; thread the prop through `PipelineApp`.

But the test-update-in-lockstep constraint (the existing footer-shape assertion would fail mid-PR2 without the helper landing first) means the seam-first split adds three review cycles for one logically-atomic change. Default to single PR; the implementer may split if review bandwidth requires it.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the new `failure-handoff.test.ts` and the updated `pipeline-failure-reason.test.ts`.
- `apparat pipeline run <pipeline>` — when the run fails — writes the new recipe-shape footer to stderr ending in `resume: apparat pipeline run … --resume <runId>` followed by a single trailing newline. The trace JSONL is unchanged; pipeline-end / node-end / validation-failure events are byte-identical to today.
- `apparat pipeline run <pipeline>` on success — byte-identical behaviour to today (no success-side footer change).
- The Ink fail frame, when a node ends with `outcome.status === "fail"` and the handoff prop is present, renders the same recipe shape inside the Static items list. Success blocks still render the existing one-line dim summary.
- Tool-node failures emit a footer with no `agent:` clause and no `inspect:`/`raw output:` lines when no node-start was authored (pre-handler crash). Current-state safe path: tool nodes always have a node-start (engine emits before invoking handler), so the `inspect:` line always prints; only the `agent:` clause omits.
- Validation-retry-exhaustion failures emit the highest-attempt `rawOutputPath` only. Earlier attempts are reachable via the `inspect:` line (`pipeline trace --node-receive --full` already prints all attempts per `src/cli/commands/pipeline/trace.ts:71-83`).

Repo-wide grep invariants (post-merge):

- `grep -n "renderFailureFooter\|loadFailureHandoff" src/cli/lib/failure-handoff.ts` — both present.
- `grep -nR "import.*failure-handoff" src` — at least three importers (`pipeline/run.ts`, `components/PipelineApp.tsx`, `tests/failure-handoff.test.ts`).
- `grep -n "resolveAgentFileForNode" src/cli/lib/agent-paths.ts` — present.
- `grep -nR "✗ pipeline failed at node" src` — zero matches in source (the old phrasing is gone); historical references in `.apparat/meditations/` stay untouched.
- `grep -n "✗ failed at" src/cli/lib/failure-handoff.ts` — at least one match (the new bird's-eye line template).

Behaviour invariants:

- Failure footer always prints at least 4 lines (bird's-eye + trace + blank + resume) even on early-crash paths.
- `process.exit(1)` still fires on failure.
- No new socket calls. No new LLM invocations. No new `mkdirSync` / `writeFileSync`.

## 9. Open questions

- **Ink fail-frame prop plumbing detail.** §3.5 picks Option A (prop plumbing) over Option B (Ink-side I/O). The implementing session may discover that the existing `Block` type already carries enough state to compute the handoff inside the reducer; if so, the prop-passing route shrinks to one extra reducer field. Either route preserves the no-I/O-in-render rule.
- **Scenario harness reference fixture.** `.apparat/scenarios/tool/` is the closest existing fixture (already drives tool-node failure paths). The implementing session confirms whether the `tool/` scenario can be cloned + edited to assert the footer shape, or whether a new fixture is cleaner. Both paths land the same scenario.
- **Monolith-spec section number.** §3 of `2026-05-06-pipeline-command-orchestration-monolith-design.md` ends at §3.5; the implementer adds the failure-footer-contract section as §3.6 (or `§4.x` if a §4 already exists at landing time). Numbering is editorial — verifier flagged the illumination's `§3.7` reference as off-by-some-amount, not as a substantive contract issue.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `loadFailureHandoff\b` in `src/cli/lib/failure-handoff.ts` — present.
- Grep `resolveAgentFileForNode\b` in `src/cli/lib/agent-paths.ts` — present.
- Grep `import.*failure-handoff` in `src` — at least three matches (run.ts, PipelineApp.tsx, failure-handoff.test.ts).
- Grep `✗ pipeline failed at node` in `src` — zero matches (old phrasing gone).
- Grep `✗ failed at` in `src/cli/lib/failure-handoff.ts` — at least one (new template).

### 10.2 Tests

- `npx vitest run src/cli/tests/failure-handoff.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-failure-reason.test.ts` — passes after assertion update.
- `npx vitest run src/cli/tests/pipeline-show.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts` — unchanged, still passes.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- Run a deliberately-failing tool pipeline (e.g. one whose `tool_command` is `false`). Confirm stderr ends with the new recipe shape; confirm `resume:` line is copy-pasteable; confirm `apparat pipeline run … --resume <runId>` re-runs from the failed node.
- Run a pipeline whose final agent node fails JSON-schema validation 3 times. Confirm `raw output:` line points at the third (highest-attempt) `rawOutputPath`. Confirm `pipeline trace <runId> --node-receive <id> --full` lists all three attempts.
- Run an interactive (Ink) pipeline; trigger a failure. Confirm the in-frame fail block now contains the multi-line recipe (visible in the Static items list, not just the post-exit stderr).
- Run a successful pipeline. Confirm zero footer changes — bytes-identical to today.

### 10.4 Negative cases

- Trace-file missing (deleted between engine end and footer render — pathological): confirm `loadFailureHandoff` returns the degraded handoff, footer prints bird's-eye + trace + resume only.
- Tool-node failure: confirm `agent:` clause omitted; rest of footer present.
- Pre-handler crash (no node-start authored — extremely rare): confirm `inspect:` and `raw output:` lines omitted, rest of footer present.
- `process.cwd()` outside the repo at footer time (e.g. user `cd`'d after `pipeline run` started): confirm `agentRelPath` falls back to absolute path (`relative()` returns absolute when targets diverge).

## 11. Summary

`apparat pipeline run`'s failure footer at `src/cli/commands/pipeline/run.ts:378-379` collapses every piece of structured failure information the harness already records into two lines — `✗ pipeline failed at node X: <reason>` and `trace: <path>`. The Ink fail frame at `src/cli/components/PipelineApp.tsx:38-46` collapses it further, into a single dim line. To go from "it failed" to "I can fix it" the human walks 5+ commands: extract `runId` from the trace path, run `pipeline trace`, eyeball for the failed node's `nodeReceiveId`, run `pipeline trace --node-receive --full`, parse the validation-failure block to find `rawOutputPath`, `cat` it, cross-reference the agent's `outputs:` frontmatter at `<dotDir>/<failedNode>.md`. Every path is computable from data the harness has — `nodeReceiveId` is in `JsonlPipelineTracer.onNodeStart` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:26-35`); `rawOutputPath` is in `JsonlPipelineTracer.onValidationFailure` (`src/attractor/tracer/jsonl-pipeline-tracer.ts:60-76`); the agent file is `<dotDir>/<nodeId>.md` (loaded today by `loadAgent` at `src/cli/lib/agent-loader.ts:29-39` and `resolveGate` at `src/cli/lib/gate-registry.ts:12-31`); the resume command is documented at `README.md:82` and parsed at `src/cli/program.ts:134`. This design ships a presentation-only deepening of both render sites: (1) a new `src/cli/lib/failure-handoff.ts` exposing `loadFailureHandoff` (reads the JSONL we just authored, picks the latest node-start's `nodeReceiveId` and the highest-attempt `rawOutputPath`) and `renderFailureFooter` (pure formatter — bird's-eye line + trace/raw-output/inspect investigation block + blank line + resume retry block); (2) a new `src/cli/lib/agent-paths.ts` exposing `resolveAgentFileForNode` so both render sites resolve `<dotDir>/<nodeId>.md` through one helper; (3) an inline edit at `src/cli/commands/pipeline/run.ts:374-382` replacing the 2-line footer with `renderFailureFooter(loadFailureHandoff(...))`; (4) an inline edit at `src/cli/components/PipelineApp.tsx`'s `BlockCloseView` accepting an optional `handoff` prop and growing the dim one-liner into the same recipe shape on `fail`; (5) a new `.apparat/scenarios/pipeline-failure-footer/` locking the footer's shape against future regressions; (6) an updated `src/cli/tests/pipeline-failure-reason.test.ts:63-65` tracking the new footer assertions; (7) one paragraph in README's trace/resume area + a new section in the 2026-05-06 monolith spec recording the footer-shape change. Per chat refinement (round 1), the originating illumination's step 3 (a new `apparat pipeline why <runId>` command) is dropped in favour of the footer-as-recipe shape; only the latest validation attempt's `rawOutputPath` is inlined; investigation and retry commands are split into two visual blocks; raw-output paths only — never inline content. Blast radius is **M** — ~9 files (4 new, 5 edited), one breaking change contained inside `pipeline-failure-reason.test.ts`. No new tracer fields, no new IPC, no new CLI command, no `program.ts` registration, no agent rubric change. Sequencing defaults to a single PR; the implementer may split into a seam-first three-PR train if review bandwidth requires it.
