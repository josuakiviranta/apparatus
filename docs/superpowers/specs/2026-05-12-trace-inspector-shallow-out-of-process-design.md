# Design: Collapse `--node-receive` inspector duplication into one deep module

**Date:** 2026-05-12
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-11T1630-trace-inspector-shallow-out-of-process.md`

## 1. Motivation

The `apparat pipeline trace <runId> --node-receive <id>` command is the project's primary "what context did this node receive?" inspector. Today it is shallow in the Ousterhout sense: a small bit of implementation (one formatter) sits behind a wide interface (one CLI command plus three hand-rolled recipe strings spread across the codebase). The implementations have already silently drifted, and there is no seam forcing them to agree.

**The formatter.** The body of `pipelineTraceCommand`'s `nodeReceive` branch lives inline at `src/cli/commands/pipeline/trace.ts:31-86`:

```ts
  if (opts.nodeReceive) {
    const event = lines.find(
      l => l.kind === "node-start" && l.nodeReceiveId === opts.nodeReceive
    );
    if (!event) {
      await output.error(`No node-start event found for: ${opts.nodeReceive}`);
      ...
    }
    const snapshot = (event.contextSnapshot as Record<string, unknown>) ?? {};
    const keys = Object.keys(snapshot);
    ...
    console.log(`\nnode:     ${event.nodeId}`);
    console.log(`kind:     ${event.nodeKind}`);
    console.log(`received: ${event.timestamp}`);
    ...
```

It prints node header, prompt path, context-snapshot key/value table (with `--full` toggling the over-80-char wrap), validation-failure attempts, and completed-stages footer.

**The recipe string.** The command `apparat pipeline trace … --node-receive …` is hand-assembled in three places, with two of them mutually inconsistent:

1. `src/cli/components/PipelineRunView.tsx:196` — `` `apparat pipeline trace ${item.runId} --node-receive ${item.nodeReceiveId}` `` (live receive-context hint; **no `--full`**).
2. `src/cli/components/PipelineRunView.tsx:234` — `` `inspect: apparat pipeline trace ${h.runId} --node-receive ${h.nodeReceiveId} --full` `` (in-frame failure-handoff JSX; **with `--full`**).
3. `src/cli/lib/failure-handoff.ts:49` — `` `inspect: apparat pipeline trace ${h.runId} --node-receive ${h.nodeReceiveId} --full` `` (stderr failure footer; **with `--full`**).

Three sites, two flag shapes already. Any future flag (`--diff`, `--prompt`, etc.) would have to land in three places, or accept further silent drift. Two of the three sites are inside one component file and still disagree.

**Project-fit.** ADR-0006:27 frames `serializeEvent()` as the seam between event production and rendering — "Rendering is the consumer's responsibility … `serializeEvent()` exists for plain-text output, while Ink components consume events directly". ADR-0014:19-25 frames interaction drivers similarly: "Each kind has one driver module owning state, reducer, footer renderer, and keymap". Both ADRs push the same shape: one module owns one concept at one site, consumers call into it. Today's `--node-receive` formatter and recipe string violate that with no seam, so this change is on-trajectory for the project, not a new direction.

## 2. Decision summary

This slice is **pure refactor only**. The user explicitly accepted scope at chat-summarizer round 1: "Yep only pure refactor is accepted". The behavior the user sees today (TUI output, stderr footer, README docs) stays byte-identical.

1. **Extract the formatter** at `src/cli/commands/pipeline/trace.ts:31-86` (the entire `if (opts.nodeReceive) { … }` body up to the early `return;`) into a new pure module `src/cli/lib/node-receive-inspector.ts` exporting `renderNodeReceive(snapshot, opts) → string[]`. `trace.ts` calls it and prints via `console.log(line)` per returned line.
2. **Co-locate `inspectCommand(runId, nodeReceiveId, { full }) → string`** in the same module. Replace the three template literals at `PipelineRunView.tsx:196` (no `--full`), `PipelineRunView.tsx:234` (with `--full`), and `failure-handoff.ts:49` (with `--full`) with calls to it.
3. **Byte-parity snapshot test** for `renderNodeReceive` against a fixture trace event. Existing assertions in `failure-handoff.test.ts:39`, `failure-handoff.test.ts:71`, `pipeline-failure-reason.test.ts:69`, and `pipeline-failure-footer-scenario.test.ts:58` already lock the `inspectCommand` output byte-for-byte — they pass unchanged when the builder is faithful.
4. **Re-pin README.md citations** (`README.md:79`, `:92`, `:94`) at edit time. The verifier round confirmed they hold at HEAD; the implementation step must re-grep before editing in case formatting shifts move them. **The README copy itself does not change** — it documents the command shape, not the module structure.

**Locked OUT of scope** (each rejected or deferred by chat-summarizer round 1, with attribution preserved):

- **Step 3 of the illumination — `i` hotkey for inline TUI inspection.** Deferred. The `received-context` `StaticItem` at `PipelineRunView.tsx:35` carries only `{ id, nodeReceiveId, runId, hasContext: boolean }` — no `contextSnapshot` reference — and the live block populates it from `event.hasContext ?? false` at `PipelineRunView.tsx:130`. Wiring the full snapshot through is a non-trivial plumbing change outside the locked refactor scope. Rationale (user): "maybe the TUI inspect ... would be maybe usefull at some cases" — mild interest, plumbing cost not free.
- **Step 4 of the illumination — trim the live `received context: …` recipe line.** Rejected. The full printed command is the user's lingua franca for handing off mid-run to a separate Claude session ("the good thing with the commands are that I can just copy paste those for another claude session context if something breaks"). Live TUI output stays byte-identical to today.
- **Step 5 of the illumination — inline compact snapshot in failure-handoff.** Deferred. Would require `loadFailureHandoff` at `src/cli/lib/failure-handoff.ts:87-155` to extract the snapshot from JSONL, and both `renderFailureFooter` and the duplicated JSX block at `PipelineRunView.tsx:222-239` to render it. Mild user interest, non-trivial cost.
- **Step 6 of the illumination — `--diff <prev-receive-id>` (and speculative `--prompt` / `--keys` flags).** Rejected. User: "I don't know which flags these are … I'm probably never going to use them if those are added". Motivation rests on real present-day duplication, not hypothetical future ergonomics.
- **Sibling drift between the TUI failure-handoff JSX block at `PipelineRunView.tsx:222-239` and CLI `renderFailureFooter` at `src/cli/lib/failure-handoff.ts:41-55`.** Flagged but not addressed. Unifying those two rendering paths is a larger refactor for a separate slice.

## 3. Architecture

### 3.1 Before / after

**Before — formatter inline at one site, recipe hand-rolled at three sites (already drifted):**

```
src/cli/commands/pipeline/trace.ts:31-86       full `if (opts.nodeReceive) { … }` body inlined inside the trace command
src/cli/components/PipelineRunView.tsx:196     `apparat pipeline trace ${item.runId} --node-receive ${item.nodeReceiveId}`            (no --full)
src/cli/components/PipelineRunView.tsx:234     `inspect: apparat pipeline trace ${h.runId} --node-receive ${h.nodeReceiveId} --full` (with --full)
src/cli/lib/failure-handoff.ts:49              `inspect: apparat pipeline trace ${h.runId} --node-receive ${h.nodeReceiveId} --full` (with --full)
```

**After — one module owns both shapes:**

```
src/cli/lib/node-receive-inspector.ts          NEW. Exports:
                                                  renderNodeReceive(snapshot, opts) → string[]
                                                  inspectCommand(runId, id, { full }) → string

src/cli/commands/pipeline/trace.ts:31-86       calls renderNodeReceive(...) and prints each line via console.log
src/cli/components/PipelineRunView.tsx:196     calls inspectCommand(item.runId, item.nodeReceiveId, {})
src/cli/components/PipelineRunView.tsx:234     calls inspectCommand(h.runId, h.nodeReceiveId, { full: true })
src/cli/lib/failure-handoff.ts:49              calls inspectCommand(h.runId, h.nodeReceiveId, { full: true })
```

### 3.2 The new module — `src/cli/lib/node-receive-inspector.ts`

Two exports, both pure (no I/O, no `console.log`, no `process.exit`).

```ts
export interface RenderNodeReceiveOptions {
  full?: boolean;
  promptPath?: string | null;
  validationFailures?: Array<{
    attempt: number;
    errors: Array<{ path: string; message: string }>;
    rawOutputPath: string;
  }>;
  completedStages?: string[];
}

export interface NodeReceiveSnapshot {
  nodeId: string;
  nodeKind: string;
  timestamp: string;
  contextSnapshot: Record<string, unknown>;
}

/**
 * Pure formatter for the `pipeline trace --node-receive <id>` view.
 * Returns one string per output line; callers join with "\n" or print
 * line-by-line. No trailing blank line — caller appends.
 */
export function renderNodeReceive(
  snap: NodeReceiveSnapshot,
  opts: RenderNodeReceiveOptions = {},
): string[];

/**
 * The single source-of-truth for the `apparat pipeline trace … --node-receive …`
 * recipe string. `{ full: true }` appends `--full`; default omits it.
 */
export function inspectCommand(
  runId: string,
  nodeReceiveId: string,
  opts: { full?: boolean } = {},
): string;
```

`renderNodeReceive` exactly reproduces the current output of `trace.ts:31-86`:

- `node:     <nodeId>`
- `kind:     <nodeKind>`
- `received: <timestamp>`
- `prompt:   <promptPath>` (omitted when `promptPath` is null/undefined)
- blank line
- `context snapshot (<n> key[s]):`
- `  (empty — first node)` when `keys.length === 0`
- per-key rows using the existing `maxLen + 2` padding rule; values over 80 chars wrap onto a second indented line unless `full` is set
- when `validationFailures` non-empty: blank line, `validation attempts:`, then `  [<attempt>] ✗ failed — <path: message, …>` and `      raw: <rawOutputPath>` per failure
- blank line, then `completed stages: <a · b · c>` or `(none)`

`trace.ts` is responsible for: locating the `node-start` event in JSONL, computing `completedStages` from prior `node-end` events, computing `promptPath` from `runDir` + `nodeId`, gathering `validationFailures` from `validation-failure` events. It hands the assembled inputs to `renderNodeReceive`, then prints `console.log(line)` per returned line plus a trailing blank line via `console.log()` (matching the current trailing blank at `trace.ts:85`).

`inspectCommand` is one line:

```ts
export function inspectCommand(
  runId: string,
  nodeReceiveId: string,
  opts: { full?: boolean } = {},
): string {
  const base = `apparat pipeline trace ${runId} --node-receive ${nodeReceiveId}`;
  return opts.full ? `${base} --full` : base;
}
```

The byte-parity contract is enforced by existing test assertions (see §6).

### 3.3 Call-site rewrites

**`src/cli/commands/pipeline/trace.ts:31-86` →** thin wrapper. `trace.ts` keeps its current responsibilities (JSONL load, event find, exit-on-missing) and calls `renderNodeReceive` for the body. Implementation skeleton:

```ts
if (opts.nodeReceive) {
  const event = lines.find(
    l => l.kind === "node-start" && l.nodeReceiveId === opts.nodeReceive
  );
  if (!event) { /* unchanged error path */ }

  const thisIdx = lines.indexOf(event);
  const completedStages = lines
    .slice(0, thisIdx)
    .filter(l => l.kind === "node-end" && l.success === true)
    .map(l => String(l.nodeId));

  const promptPath = join(runDir(project, runId), String(event.nodeId), "prompt.md");
  const validationFailures = lines
    .filter(l => l.kind === "validation-failure" && l.nodeReceiveId === opts.nodeReceive)
    .map(/* shape match */);

  const out = renderNodeReceive(
    {
      nodeId: String(event.nodeId),
      nodeKind: String(event.nodeKind),
      timestamp: String(event.timestamp),
      contextSnapshot: (event.contextSnapshot as Record<string, unknown>) ?? {},
    },
    {
      full: opts.full,
      promptPath: existsSync(promptPath) ? promptPath : null,
      validationFailures,
      completedStages,
    },
  );

  for (const line of out) console.log(line);
  console.log();
  return;
}
```

**`src/cli/components/PipelineRunView.tsx:196` →**

```ts
const cmd = inspectCommand(item.runId, item.nodeReceiveId);
```

(no `--full`; matches current byte-exact behavior for the live receive-context line.)

**`src/cli/components/PipelineRunView.tsx:234` →**

```tsx
<Text>{`inspect: ${inspectCommand(h.runId, h.nodeReceiveId, { full: true })}`}</Text>
```

**`src/cli/lib/failure-handoff.ts:49` →**

```ts
lines.push(`inspect: ${inspectCommand(h.runId, h.nodeReceiveId, { full: true })}`);
```

The `inspect: ` prefix and the failure-handoff doc-comment example at `src/cli/lib/failure-handoff.ts:33` stay verbatim — `inspectCommand` returns only the `apparat pipeline trace …` portion. The prefix is the caller's concern (different formatting in stderr footer vs Ink JSX vs README).

### 3.4 What the live recipe-line case (no `--full`) means for the builder

`PipelineRunView.tsx:196` is the only caller that omits `--full`. The builder contract is "`{ full: true }` MUST emit `--full`, `{}` or `{ full: false }` MUST omit it". This preserves the current drift verbatim — both the `--full` and no-`--full` variants are still observable, but they emerge from the same module by parameter, not from three independent string templates. If a future maintainer wants to align them (e.g. make the live line use `--full` too), it is now a one-line caller change with one place to test.

## 4. Data flow

No runtime data flow change. Static call-site reshuffle only:

```
trace.ts                                            PipelineRunView.tsx:196      PipelineRunView.tsx:234      failure-handoff.ts:49
   │                                                       │                            │                             │
   │ (extract body)                                        │                            │                             │
   ▼                                                       ▼                            ▼                             ▼
node-receive-inspector.ts                                  ◄─── inspectCommand ─────────◄─── inspectCommand ──────────◄─── inspectCommand
   ├── renderNodeReceive(snap, opts) → string[]
   └── inspectCommand(runId, id, { full }) → string
```

`renderNodeReceive` consumes only the data the caller assembles — it does not read from disk or look at JSONL itself. `inspectCommand` is a string builder over its three arguments and has no inputs beyond them. Both functions are trivially snapshot-testable.

## 5. Components

| Component | Path | Change |
| --- | --- | --- |
| `renderNodeReceive` (new) | `src/cli/lib/node-receive-inspector.ts` (new file) | Pure formatter. Body extracted verbatim from `trace.ts:31-86` modulo I/O separation. |
| `inspectCommand` (new) | `src/cli/lib/node-receive-inspector.ts` (new file) | One-line recipe-string builder. `{ full: true }` → `--full`. |
| `NodeReceiveSnapshot` / `RenderNodeReceiveOptions` (new types) | `src/cli/lib/node-receive-inspector.ts` (new file) | Input shape for `renderNodeReceive`. |
| `pipelineTraceCommand` `--node-receive` branch | `src/cli/commands/pipeline/trace.ts:31-86` | Replace 56-line inline body with: assemble inputs → call `renderNodeReceive` → print each returned line. |
| Live receive-context recipe | `src/cli/components/PipelineRunView.tsx:196` | Replace template literal with `inspectCommand(item.runId, item.nodeReceiveId)`. |
| Failure-handoff JSX inspect line | `src/cli/components/PipelineRunView.tsx:234` | Replace template literal with `` `inspect: ${inspectCommand(h.runId, h.nodeReceiveId, { full: true })}` ``. |
| Failure-footer inspect line | `src/cli/lib/failure-handoff.ts:49` | Replace template literal with `` `inspect: ${inspectCommand(h.runId, h.nodeReceiveId, { full: true })}` ``. |

Type-only consumers (no logic change, may need to re-typecheck after the new module is added — but no imports change for them):

- `src/cli/components/PipelineRunView.tsx` — gains one import of `inspectCommand`.
- `src/cli/lib/failure-handoff.ts` — gains one import of `inspectCommand`.
- `src/cli/commands/pipeline/trace.ts` — gains one import of `renderNodeReceive`.

No public-facing types change. `FailureHandoff` shape is untouched. `StaticItem.received-context` at `PipelineRunView.tsx:35` stays `{ kind, id, nodeReceiveId, runId, hasContext }` — the `i`-hotkey snapshot plumbing required for Step 3 is explicitly out of scope.

## 6. Constraints

- **Byte parity for `renderNodeReceive`.** The trace-command output must be byte-identical to today's `trace.ts:31-86` output. A new snapshot test in `src/cli/tests/node-receive-inspector.test.ts` pins the rendered string against a fixture `node-start` event. The fixture covers the common shapes: empty snapshot, multi-key snapshot, one over-80-char value (wrap path), one over-80-char value with `full: true` (no wrap), validation-failures present, completed-stages present, completed-stages empty.
- **Byte parity for `inspectCommand`.** Already enforced by existing assertions:
  - `src/cli/tests/failure-handoff.test.ts:39` — `expect(renderFailureFooter(FULL)).toBe("…inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full\n…")`.
  - `src/cli/tests/failure-handoff.test.ts:71` — `.toContain("inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full")`.
  - `src/cli/tests/pipeline-failure-reason.test.ts:69` — `expect(writtenStderr).toMatch(/inspect: apparat pipeline trace .* --node-receive \S+ --full/)`.
  - `src/cli/tests/pipeline-failure-footer-scenario.test.ts:58` — `expect(writtenStderr).toMatch(/\ninspect: apparat pipeline trace [^ ]+ --node-receive [^ ]+ --full/)`.

  None of these snapshots need editing; they pass unchanged when the builder emits `--full` for `{ full: true }` and omits it for `{}`.
- **No user-visible behavior change.** Live TUI output, stderr failure footer, and the README walkthrough all stay byte-identical to HEAD. Live recipe-line and inspect-line drift (whether `--full` is included) is preserved verbatim by passing the correct `{ full }` argument at each call site.
- **No README copy change.** `README.md:79`, `:92`, `:94` document command shape and operator-recipe semantics. The implementation step must re-grep at edit time (chat-summarizer round 1 flagged that the verifier's line numbers were not re-grounded during chat) — but the design's contract is that no README copy edit is required because the command shape is unchanged.
- **No new dependencies, no new ADRs.** The new module slots under `src/cli/lib/` next to `failure-handoff.ts` and follows the same single-concern pattern (one file, one concept, pure exports).
- **`renderNodeReceive` is pure.** No `process.cwd()`, no `existsSync`, no `console.log`. The caller (`trace.ts`) keeps all I/O. This is what makes the snapshot test trivial and what lets future callers (e.g. a hypothetical Ink `i` hotkey in a later slice) reuse the formatter without spawning a subprocess.

## 7. Testing

**New test file: `src/cli/tests/node-receive-inspector.test.ts`.**

1. `renderNodeReceive` byte-parity, empty snapshot — first-node case prints `(empty — first node)`.
2. `renderNodeReceive` byte-parity, multi-key snapshot — padding via `maxLen + 2`, all values under 80 chars (no wrap).
3. `renderNodeReceive` byte-parity, one over-80-char value, `full: false` — wraps onto an indented second line.
4. `renderNodeReceive` byte-parity, same over-80-char value, `full: true` — single-line padded row.
5. `renderNodeReceive` byte-parity, validation-failures present — `validation attempts:` block with `[<attempt>] ✗ failed — <errors>` and `raw: <path>` per attempt.
6. `renderNodeReceive` byte-parity, completed-stages empty — `completed stages: (none)`.
7. `renderNodeReceive` byte-parity, completed-stages non-empty — `completed stages: a · b · c`.
8. `renderNodeReceive` with `promptPath: null` — no `prompt:` line.
9. `inspectCommand` default — `apparat pipeline trace <runId> --node-receive <id>` exactly (no trailing `--full`).
10. `inspectCommand` with `{ full: true }` — appends ` --full`.
11. `inspectCommand` with `{ full: false }` — same as default (no `--full`).

**Existing tests that re-assert the same byte-exact strings via the new builder (no edits, must pass unchanged):**

- `src/cli/tests/failure-handoff.test.ts` — `FULL` fixture asserts the full footer including the `inspect:` line at `:39` and `:71`. Same string emitted, just via `inspectCommand`.
- `src/cli/tests/pipeline-failure-reason.test.ts:69` — `\S+ --full` regex still matches.
- `src/cli/tests/pipeline-failure-footer-scenario.test.ts:58` — same regex shape.
- `src/cli/tests/pipeline-app-integration.test.tsx` — re-typecheck only; `FailureHandoff` shape unchanged.
- `src/cli/tests/pipeline-trace-command-validation.test.ts` — re-typecheck only; trace-command CLI contract unchanged.

**Existing tests that don't need new coverage but must stay green:**

- Any test that exercises `trace.ts`'s `--node-receive` branch end-to-end (if any) — same output expected.
- `src/cli/tests/pipeline-run-view.test.tsx` — re-typecheck; the live `received context:` line content is unchanged (still no `--full`).

## 8. Blast radius / impact surface

- **Size:** M. ~4 source files (1 new + 3 edits) + ~5 existing tests touched only at the typecheck level + 1 new test file. Pure refactor — no behavior change.
- **Surfaces crossed:** CLI command (`trace.ts`), Ink TUI component (`PipelineRunView.tsx`), lib helper (`failure-handoff.ts`), new lib module (`node-receive-inspector.ts`), tests. No engine, no agents, no daemon, no docs copy.
- **Breaking change:** none. `inspectCommand({ full: true })` emits `--full` and `inspectCommand({})` omits it — the existing byte-exact assertions in `failure-handoff.test.ts:39`, `failure-handoff.test.ts:71`, `pipeline-failure-reason.test.ts:69`, `pipeline-failure-footer-scenario.test.ts:58` are the contract, and they all hold when the builder is faithful. The live `PipelineRunView.tsx:196` recipe stays without `--full` exactly as today.
- **Files touched:**
  - **New (1):** `src/cli/lib/node-receive-inspector.ts`.
  - **New test (1):** `src/cli/tests/node-receive-inspector.test.ts`.
  - **Source edits (3):** `src/cli/commands/pipeline/trace.ts` (extract body), `src/cli/components/PipelineRunView.tsx` (two call sites: `:196`, `:234`), `src/cli/lib/failure-handoff.ts` (one call site: `:49`).
  - **Existing tests re-typecheck only (~5):** `src/cli/tests/failure-handoff.test.ts`, `src/cli/tests/pipeline-failure-reason.test.ts`, `src/cli/tests/pipeline-failure-footer-scenario.test.ts`, `src/cli/tests/pipeline-app-integration.test.tsx`, `src/cli/tests/pipeline-trace-command-validation.test.ts`.
- **Spec / docs ripple:** zero copy change. README.md, `docs/pipelines.md`, `SKILL.md` document command shape, not internal module structure. The implementation step re-grounds the README line numbers (verifier cited `:79`, `:92`, `:94`) before any read-only audit, but no edits land in README.
- **ADR ripple:** none. On-trajectory for ADR-0006:27 ("Rendering is the consumer's responsibility") and ADR-0014:19-25 (driver modules own state + renderer + keymap). No new ADR needed because no architectural concept is introduced — the new module is a pure formatter, not a new abstraction kind.
- **Migration / data:** none. Pure presentation refactor; no trace JSONL shape change, no checkpoint migration.

## 9. Open questions

1. **Should `renderNodeReceive` accept the raw `node-start` event object or a pre-projected `NodeReceiveSnapshot`?** Recommendation: pre-projected. Keeps the formatter purely a string transformation and decouples it from the JSONL event shape (which is currently a loose `Record<string, unknown>` in `trace.ts:29` and would otherwise leak into the new module's signature). Reviewer: confirm or counter.
2. **Should `inspectCommand` live in `node-receive-inspector.ts` next to `renderNodeReceive`, or in its own one-symbol file (e.g. `src/cli/lib/inspect-command.ts`)?** Recommendation: co-located. The two functions are conceptually the same module (the inspector — its renderer and its launch recipe). The May-11 `failure-handoff` design colocated `buildResumeCommand` next to `renderFailureFooter` for the same reason; following that precedent. Reviewer: confirm.
3. **`PipelineRunView.tsx:196` omits `--full`; `:234` and `failure-handoff.ts:49` include it.** This slice preserves the asymmetry verbatim. Should the implementation PR include a one-line comment at the `:196` call site noting "intentional: live hint, not deep-dive" so a future maintainer doesn't try to "align" the three sites by adding `{ full: true }`? Recommendation: yes, one-line comment plus a test that pins the no-`--full` shape at `:196`. Reviewer: confirm.
4. **Sibling drift between `PipelineRunView.tsx:222-239` (in-frame failure JSX) and `renderFailureFooter` at `src/cli/lib/failure-handoff.ts:41-55` (stderr footer) — same data, two renderers — is flagged by the chat-summarizer round 1 as out-of-scope for this slice.** Should the design doc explicitly recommend a follow-on illumination for that unification, or leave it to organic discovery? Recommendation: explicit follow-on note in this section (now done) so the next round of meditation has a pointer; do not author the illumination here.
