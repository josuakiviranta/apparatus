# Design: Collapse failure-footer TUI / CLI duplicate rendering into one deep module

**Date:** 2026-05-12
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-12T1548-failure-footer-tui-cli-duplicate-render.md`

## 1. Motivation

The `apparat pipeline` failure footer ("✗ failed at …", `trace:`, optional `raw output:`, optional `inspect:`, blank line, `resume:`) is the project's hand-off recipe when a run fails — the user copies it into a fresh Claude session to continue investigating. Today the same 4-6 line shape is built twice:

- `src/cli/lib/failure-handoff.ts:42-56` — `renderFailureFooter(h)` builds a private `lines: string[]` then returns `lines.join("\n") + "\n"`. This is the stderr path written at `src/cli/commands/pipeline/run.ts:418`.
- `src/cli/components/PipelineRunView.tsx:223-240` — the `failure-handoff` JSX branch hand-rebuilds the same shape via independent `<Text>` fragments inside `<Box flexDirection="column" marginBottom={1}>`, including a `<Text> </Text>` blank-line workaround.

They agree today only because two developers copied the shape by hand. The CLI side is pinned byte-exact by `src/cli/tests/failure-handoff.test.ts:39` (full footer literal) and `:80` (`endsWith("\n")`), plus regex pins at `src/cli/tests/pipeline-failure-reason.test.ts:69` and `src/cli/tests/pipeline-failure-footer-scenario.test.ts:58`. The TUI side has zero snapshots — `pipeline-run-view.test.tsx` does not assert on the `failure-handoff` branch at all. A JSX edit can silently drift.

The just-shipped `inspectCommand` deep-module collapse (commits `a1beea1`, `7a2bcb1`, `4bd4503`, 2026-05-12) proved the one-module-owns-shape pattern works end-to-end for one recipe line. The remaining four footer lines were explicitly flagged as an out-of-scope sibling in `docs/superpowers/specs/2026-05-12-trace-inspector-shallow-out-of-process-design.md:58`. This slice picks them up.

**Project-fit.** ADR-0006:27 states "Rendering is the consumer's responsibility … `serializeEvent()` exists for plain-text output, while Ink components consume events directly." ADR-0014:19-25 establishes the `InteractionDriver` seam with one module owning state, reducer, footer renderer, and keymap. Both push toward one-module-owns-shape. Today's footer rendering violates that with no seam, so this change is on-trajectory.

## 2. Decision summary

This slice is **pure refactor only**. The user explicitly confirmed at chat-summarizer round 1: "Ah so this is just a refactor." `renderFailureFooter`'s public contract (return `string` ending in `\n`) is preserved verbatim — `src/cli/tests/failure-handoff.test.ts:80` `expect(renderFailureFooter(FULL).endsWith("\n")).toBe(true)` keeps passing.

1. **Extract** the private `lines: string[]` builder at `src/cli/lib/failure-handoff.ts:43-53` into a new sibling export `renderFailureFooterLines(h: FailureHandoff): string[]`. `renderFailureFooter` becomes a thin wrapper: `lines.join("\n") + "\n"`.
2. **Rewrite** the `failure-handoff` JSX branch at `src/cli/components/PipelineRunView.tsx:223-240` to consume the new helper. The new JSX is `<Box flexDirection="column">{lines.map((line, i) => <Text key={i}>{line === "" ? " " : line}</Text>)}</Box>` — note **no `marginBottom`** on the outer `<Box>`. Any visible spacing belongs in the lines array.
3. **Pin** the TUI shape with a new parity snapshot test at `src/cli/tests/pipeline-run-view-failure-handoff.test.tsx`. The test renders `PipelineRunView` with a `failure-handoff` static item, captures the frame via `ink-testing-library`'s `lastFrame()`, and asserts byte-parity with `renderFailureFooter(handoff)` (trailing newline normalised).

**Decision pinned at chat-summarizer round 1 ("ok (a)"):** option (a) wins — `renderFailureFooterLines` owns the **complete on-screen shape including blank lines**; the TUI is pinned byte-for-byte to `renderFailureFooter(handoff)` via the parity snapshot. Option (b) — shared content but TUI keeps its own `marginBottom={1}` opinion — was rejected because the deep-modules stimulus (`.apparat/meditations/stimuli/deep-modules-hide-complexity.md`) names it as the shallow-module symptom: a concept implemented twice with no single seam where they're forced to agree.

**Locked OUT of scope:**

- `src/cli/commands/pipeline/run.ts:418` stderr `process.stderr.write(renderFailureFooter(handoff))` call site — untouched.
- Schema changes, ADR rewrites, README copy edits — none.
- `pipeline-failure-handoff-is-shallow-design.md` schema discussions — that draft documents the `FailureHandoff` shape, not the renderer; no edit needed.
- Conditionalising the JSX block's `h.rawOutputPath` / `h.nodeReceiveId` branches differently — the helper already returns only the lines that should be visible, so the consumer JSX is uniform.

## 3. Architecture

### 3.1 Before / after

**Before — `renderFailureFooter` is a single string-builder; TUI rebuilds the same shape inline.**

```
src/cli/lib/failure-handoff.ts:42-56            renderFailureFooter(h): string  (private lines[] join "\n" + "\n")
src/cli/components/PipelineRunView.tsx:223-240  hand-rebuilds the footer via <Text> fragments:
                                                  - one multi-fragment <Text> for "✗ failed at <id>(agent: <p>): <reason>"
                                                  - <Text>{`trace: ${h.tracePath}`}</Text>
                                                  - conditional <Text> for raw output
                                                  - conditional <Text> for inspect:
                                                  - <Text> </Text>  (blank-line workaround)
                                                  - <Text>{`resume: …`}</Text>
                                                inside <Box flexDirection="column" marginBottom={1}>
```

**After — one helper owns the on-screen shape; both surfaces consume it.**

```
src/cli/lib/failure-handoff.ts                  renderFailureFooterLines(h): string[]   (NEW — owns full shape inc. blanks)
                                                renderFailureFooter(h): string          (thin wrapper: lines.join("\n") + "\n")

src/cli/components/PipelineRunView.tsx:223-240  const lines = renderFailureFooterLines(h);
                                                <Box flexDirection="column">
                                                  {lines.map((line, i) => (
                                                    <Text key={i}>{line === "" ? " " : line}</Text>
                                                  ))}
                                                </Box>

src/cli/commands/pipeline/run.ts:418            unchanged — still writes renderFailureFooter(handoff) to stderr
```

### 3.2 The new helper — `renderFailureFooterLines`

Pure function. No I/O, no globals. Lives in `src/cli/lib/failure-handoff.ts` next to `renderFailureFooter`, exported.

```ts
/**
 * Return the failure footer as one string per line — the full on-screen shape
 * including the unconditional blank line before `resume:`. No trailing
 * terminator. Consumers:
 *   - renderFailureFooter joins with "\n" and appends "\n" (CLI stderr contract).
 *   - PipelineRunView maps each entry to a <Text> element (Ink TUI).
 *
 * Bracketed lines drop when the field is null. Blank line before `resume:`
 * is unconditional — chat-refinement rule round 1, bullet 3 (separation of
 * investigation from retry).
 */
export function renderFailureFooterLines(h: FailureHandoff): string[] {
  const lines: string[] = [];
  const agentClause = h.agentRelPath ? ` (agent: ${h.agentRelPath})` : "";
  lines.push(`✗ failed at ${h.nodeId}${agentClause}: ${h.reason}`);
  lines.push(`trace: ${h.tracePath}`);
  if (h.rawOutputPath) lines.push(`raw output: ${h.rawOutputPath}`);
  if (h.nodeReceiveId) {
    lines.push(`inspect: ${inspectCommand(h.runId, h.nodeReceiveId, { full: true })}`);
  }
  lines.push("");
  lines.push(`resume: ${h.resumeCommand}`);
  return lines;
}

export function renderFailureFooter(h: FailureHandoff): string {
  return renderFailureFooterLines(h).join("\n") + "\n";
}
```

The body is moved verbatim from `src/cli/lib/failure-handoff.ts:43-53`; only the function boundary changes. `renderFailureFooter` is now two lines.

### 3.3 The TUI call site

Replaces `src/cli/components/PipelineRunView.tsx:223-240`. The component already imports `inspectCommand` from `node-receive-inspector.ts`; that import is removed (no longer referenced). A new import of `renderFailureFooterLines` is added.

```tsx
if (item.kind === "failure-handoff") {
  const lines = renderFailureFooterLines(item.handoff);
  return (
    <Box key={item.id} flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line === "" ? " " : line}</Text>
      ))}
    </Box>
  );
}
```

Two intentional shape choices:

- **No `marginBottom` on the outer `<Box>`.** The previous code had `marginBottom={1}`; the new design pushes all spacing into the lines array (which already includes the unconditional `""` before `resume:`). Locality: every shape decision lives in `failure-handoff.ts`.
- **`line === "" ? " " : line`.** Ink's `<Text>` collapses an empty string and renders nothing — a known Ink behaviour. Substituting a single space when the line is empty matches the existing `<Text> </Text>` blank-line workaround at the old `:237` and preserves the byte shape (one blank line in the frame).

### 3.4 What "byte parity" means at the TUI seam

`ink-testing-library`'s `lastFrame()` returns the rendered terminal text — what the user sees. The parity test trims a single trailing newline from `renderFailureFooter(handoff)` (the stderr wrapper appends one; Ink does not) and compares string-equal. If the two surfaces disagree by one character, the test fails on first run. From this point forward any future shape change must go through `renderFailureFooterLines`; the test is the seam that forces the agreement.

## 4. Data flow

No runtime data flow change.

```
FailureHandoff (struct)
   │
   ├──► renderFailureFooterLines(h) ──► string[]
   │                                       │
   │                                       ├──► renderFailureFooter(h)  ─► join("\n") + "\n" ─► stderr (run.ts:418)
   │                                       │
   │                                       └──► PipelineRunView <Text> map ─► Ink frame
```

`FailureHandoff` shape is untouched — `loadFailureHandoff` at `src/cli/lib/failure-handoff.ts:88-155` produces the same struct as today.

## 5. Components

| Component | Path | Change |
| --- | --- | --- |
| `renderFailureFooterLines` (new export) | `src/cli/lib/failure-handoff.ts` | Pure helper — body extracted from existing `renderFailureFooter`. Returns `string[]`, no terminator. |
| `renderFailureFooter` (existing) | `src/cli/lib/failure-handoff.ts:42-56` | Becomes a two-line wrapper: `renderFailureFooterLines(h).join("\n") + "\n"`. Public contract unchanged. |
| `failure-handoff` JSX branch | `src/cli/components/PipelineRunView.tsx:223-240` | Replace inline `<Text>` fragments with `lines.map(...)`. Drop outer-box `marginBottom={1}`. |
| `PipelineRunView` imports | `src/cli/components/PipelineRunView.tsx` (top) | Add `renderFailureFooterLines` import; drop the now-unused `inspectCommand` import if no other branch references it (audit at edit time). |
| TUI parity snapshot test (new) | `src/cli/tests/pipeline-run-view-failure-handoff.test.tsx` | Renders `PipelineRunView` with a `failure-handoff` `StaticItem`, asserts `lastFrame()` byte-equals `renderFailureFooter(handoff)` trimmed of one trailing newline. |

No public types change. `FailureHandoff` is untouched. `StaticItem` shape (defined near `PipelineRunView.tsx:35`) is untouched. Only `pipelineEvents.ts` and `PipelineRunView.tsx` import `FailureHandoff` as a type — verifier confirmed.

## 6. Constraints

- **`renderFailureFooter` contract preserved.** Returns `string` ending in `\n`. Pinned by `src/cli/tests/failure-handoff.test.ts:35-42` (full literal including trailing `\n`) and `:80` (`endsWith("\n")`). Both pass unchanged.
- **Existing CLI pins stay green.** `src/cli/tests/failure-handoff.test.ts:39/71`, `src/cli/tests/pipeline-failure-reason.test.ts:69`, `src/cli/tests/pipeline-failure-footer-scenario.test.ts:58` all assert against the joined string — unaffected by the inner refactor.
- **TUI shape locked at one seam.** The new parity snapshot test forces TUI bytes to equal `renderFailureFooter(handoff)` (modulo trailing-newline normalisation). A future hand-edit to either surface fails the test on the first run.
- **No JSX-side margin.** Outer `<Box>` is `flexDirection="column"` only. Any visible spacing belongs in the `string[]` returned by `renderFailureFooterLines` (e.g. the existing `""` before `resume:`). Rationale: locality — every shape decision in one file.
- **Pre-existing TUI micro-drift is collapsed.** The old JSX had `<Box marginBottom={1}>`; the CLI string does not. Option (a) means the new TUI loses that trailing margin (now expressed only if added as a trailing `""` to the lines array — currently not added; matches CLI). Surfaced by first run of the parity test.
- **`renderFailureFooterLines` is pure.** No `process.cwd()`, no `existsSync`, no `console.log`. Snapshot-testable in isolation.
- **No new dependencies, no new ADRs, no README copy edits.**

## 7. Testing

**New test file: `src/cli/tests/pipeline-run-view-failure-handoff.test.tsx`.**

1. TUI parity, full footer (agent + raw output + inspect + resume) — `lastFrame()` byte-equals `renderFailureFooter(handoff).replace(/\n$/, "")`.
2. TUI parity, agent-omitted (tool node, `agentRelPath: null`) — same assertion shape.
3. TUI parity, early-crash (`nodeReceiveId: null`, `rawOutputPath: null`) — bird's-eye + trace + blank + resume only.
4. TUI parity, no raw output but inspect present (`rawOutputPath: null`, `nodeReceiveId` set).

Each case uses the same `FailureHandoff` fixture shape as `src/cli/tests/failure-handoff.test.ts:11-31` for consistency.

**Existing tests that must stay green unchanged:**

- `src/cli/tests/failure-handoff.test.ts` — all six `renderFailureFooter` cases (`:34`, `:45`, `:52`, `:67`, `:74`, `:79`) and all `loadFailureHandoff` cases.
- `src/cli/tests/pipeline-failure-reason.test.ts:69` — `/inspect: apparat pipeline trace .* --node-receive \S+ --full/` regex.
- `src/cli/tests/pipeline-failure-footer-scenario.test.ts:58` — same regex shape, end-to-end.
- `src/cli/tests/pipeline-run-view.test.tsx` — re-typecheck only; the existing tests do not assert on the `failure-handoff` branch, so behaviour change there (loss of `marginBottom={1}`) does not break them.

**Test environment note (per `memory/2026-04-17-ink-test-ansi-and-tmux-labels.md`):** `ink-testing-library` frames may include ANSI sequences depending on `FORCE_COLOR` / `chalk.level`. The parity test should normalise both strings the same way — either both ANSI-stripped or both forced to plain — and the test file should set `FORCE_COLOR=0` if the existing `pipeline-run-view.test.tsx` does. (Verify by reading that file's setup; mirror its convention.)

## 8. Blast radius / impact surface

- **Size:** S. Pure refactor — no behaviour change, no schema, no public API.
- **Surfaces crossed:** CLI lib (`failure-handoff.ts`), TUI component (`PipelineRunView.tsx`), tests (one new file). No engine, no agents, no daemon, no schema, no README copy.
- **Breaking change:** none. `renderFailureFooter` keeps its `string`-with-trailing-`\n` contract (pinned by `failure-handoff.test.ts:80` `endsWith("\n")`). `renderFailureFooterLines` is purely additive — no existing export changes signature.
- **Files touched (3 source + 1 new test):**
  - **Edit (2 source):** `src/cli/lib/failure-handoff.ts` (split body), `src/cli/components/PipelineRunView.tsx:223-240` (consume helper; adjust imports).
  - **New test (1):** `src/cli/tests/pipeline-run-view-failure-handoff.test.tsx`.
  - **Re-typecheck only (~4):** `src/cli/tests/failure-handoff.test.ts`, `src/cli/tests/pipeline-failure-reason.test.ts`, `src/cli/tests/pipeline-failure-footer-scenario.test.ts`, `src/cli/tests/pipeline-run-view.test.tsx`.
- **Spec / docs ripple:** zero copy change. Draft `docs/superpowers/specs/2026-05-09-pipeline-failure-handoff-is-shallow-design.md` documents the `FailureHandoff` shape — unaffected.
- **ADR ripple:** none. On-trajectory for ADR-0006:27 ("Rendering is the consumer's responsibility") and ADR-0014:19-25 (one module owns state + renderer). No new ADR — no new architectural concept; this is a textbook deep-module collapse.
- **Migration / data:** none. No trace JSONL shape change, no checkpoint migration, no CLI flag change.
- **Behaviour delta visible to users:** the TUI loses the `marginBottom={1}` after the failure block. Footer text bytes identical to the CLI stderr footer afterwards. Trade-off was the explicit decision at chat-summarizer round 1 — "every shape decision lives in `failure-handoff.ts`".

## 9. Open questions

1. **Drop trailing margin or move it into the lines array?** The previous JSX had `marginBottom={1}` after the resume line. Option (a) as accepted drops it — TUI matches CLI stderr (no trailing blank). If the user later wants the spacing back, adding a trailing `""` to `renderFailureFooterLines` puts it in both surfaces simultaneously. Recommendation: ship without it; surface during parity test review if visually jarring. Reviewer: confirm.

2. **Ink empty-`<Text>` collapsing — single-space workaround.** Ink's `<Text>` renders an empty string as nothing; the current code already worked around this with `<Text> </Text>` (one space) at the old `:237`. The new design preserves the workaround via `line === "" ? " " : line` in the map. An alternative would be to make `renderFailureFooterLines` emit `" "` (one space) instead of `""` for the blank — but that would leak a TUI quirk into the CLI string (CLI stderr would print a space-only line, currently it prints an empty line). Recommendation: keep the empty string in the lines array; do the ` `-substitution in the JSX map. Reviewer: confirm.

3. **Should `pipeline-run-view.test.tsx` absorb the new parity test or stay separate?** Separate file (proposed) keeps the test focused and discoverable by filename. Reviewer: confirm or recommend merging.

4. **Future sibling — should the live `received context:` block at `PipelineRunView.tsx:196-219` get the same shared-shape treatment with its CLI counterpart (if any)?** Out of scope for this slice. Note here so future meditation has a pointer.
