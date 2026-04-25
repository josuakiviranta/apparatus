---
status: implemented
---

# Refine Authoring Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the post-2026-04-16 refine command into a first-class authoring loop by (1) extracting the duplicated two-phase Claude session into `src/cli/lib/session.ts`, (2) injecting digested recent run traces into the refine trigger, (3) adding an edge-label diff to `pipelineValidateCommand`, and (4) emitting a `ralph pipeline refine <name>` tip from `pipelineRunCommand` on non-zero TTY exits.

**Architecture:** All four chunks are independent and can ship in any order. Chunk 1 lives in `src/cli/lib/session.ts` and rewires three callers (`plan.ts`, `pipelineCreateCommand`, `pipelineRefineCommand`) without behavior change. Chunk 2 extends the refine trigger composition inside `pipelineRefineCommand` and adds a trace-listing helper co-located with the existing trace code. Chunk 3 extends `pipelineValidateCommand`'s signature with an optional `previousGraph` and adds an edge-label diff that the refine flow opts into. Chunk 4 adds a TTY-gated tip print inside `pipelineRunCommand`'s failure paths. No new bundled prompt assets; no new Commander subcommands.

**Tech Stack:** TypeScript, Node.js, Vitest, Commander. Key files: `src/cli/lib/session.ts`, `src/cli/commands/pipeline.ts`, `src/cli/commands/plan.ts`, `src/cli/program.ts`, `src/cli/tests/pipeline.test.ts`, `src/cli/lib/tests/session.test.ts`, `README.md`.

**Design doc:** `docs/superpowers/specs/2026-04-17-refine-authoring-loop-design.md`

**Source illumination:** `meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md`

---

## Chunk 1: Extract `runTwoPhaseClaudeSession` into `src/cli/lib/session.ts`

**Files:**
- Modify: `src/cli/lib/session.ts` (append new helper + options/result types at end of file)
- Create: `src/cli/lib/tests/session.test.ts` (new unit test file)
- Modify: `src/cli/commands/plan.ts` (replace inline two-phase body with helper call)
- Modify: `src/cli/commands/pipeline.ts` (`pipelineCreateCommand` + `pipelineRefineCommand` — same replacement)

Pure refactor. Same spawn calls, same stdio plumbing, same resume flow. The rule of three has fired; this chunk removes the duplication so chunks 2–4 and future edits touch one place. No behavior changes; existing scenario tests for `plan`, `pipeline create`, and `pipeline refine` continue to exercise the three callers end-to-end.

- [ ] **Step 1: Write failing unit tests for `runTwoPhaseClaudeSession`**

  Create `src/cli/lib/tests/session.test.ts` with a `describe("runTwoPhaseClaudeSession", ...)` block. Use `vi.mock("node:child_process", ...)` to stub `spawn` (phase 1) and `spawnSync` (phase 2). Cover:

  - **happy path**: phase-1 `spawn` emits a `system` event carrying `session_id: "abc123"` on stdout; `onSessionId` fires with `"abc123"`; phase-2 `spawnSync` is called with `["--dangerously-skip-permissions", "--resume", "abc123"]`; result is `{ sessionId: "abc123", exitCode: 0, interrupted: false }`.
  - **phase-1 fails, phase-2 skipped**: `spawn` emits nothing on stdout and closes with non-zero exit; phase-2 `spawnSync` is NOT called; result has `sessionId: null` and non-zero `exitCode`.
  - **no session id captured**: phase-1 closes cleanly but never emits a `system` event; phase-2 is still invoked without `--resume` (plain `claude --dangerously-skip-permissions`); result has `sessionId: null, exitCode: 0`.
  - **SIGINT during phase 1**: simulate an abort via the provided `AbortSignal`; phase-2 is NOT called; result has `interrupted: true` and a non-zero exit code.

  Expected initial state: all tests FAIL because `runTwoPhaseClaudeSession` does not yet exist.

- [ ] **Step 2: Run the new tests to confirm failure**

  Run: `npx vitest run src/cli/lib/tests/session.test.ts`
  Expected: FAIL — `runTwoPhaseClaudeSession` is not an export of `../session.js`.

- [ ] **Step 3: Implement `runTwoPhaseClaudeSession` in `src/cli/lib/session.ts`**

  Append to the end of `src/cli/lib/session.ts`:

  ```typescript
  import { spawn, spawnSync } from "node:child_process";
  import { streamEvents } from "./stream-events.js"; // if already imported at top, hoist
  import type { OutputAdapter } from "./output.js";

  export interface TwoPhaseSessionOptions {
    cwd: string;
    trigger: string;
    output: OutputAdapter;
    onSessionId?: (sessionId: string) => void;
    signal?: AbortSignal;
    /** Extra args appended to BOTH phase-1 and phase-2 claude invocations. */
    extraArgs?: string[];
  }

  export interface TwoPhaseSessionResult {
    sessionId: string | null;
    exitCode: number;
    interrupted: boolean;
  }

  export async function runTwoPhaseClaudeSession(
    opts: TwoPhaseSessionOptions,
  ): Promise<TwoPhaseSessionResult> {
    // Phase 1: non-interactive kickoff
    let sessionId: string | null = null;
    let interrupted = false;

    const phase1Args = [
      "-p",
      opts.trigger,
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      ...(opts.extraArgs ?? []),
    ];
    const child = spawn("claude", phase1Args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onAbort = () => { interrupted = true; child.kill("SIGINT"); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const exitPromise = new Promise<number>((res) => {
      child.on("close", (code) => res(code ?? 1));
    });
    await opts.output.stream(
      streamEvents(child.stdout as NodeJS.ReadableStream, {
        onSessionId: (id) => {
          sessionId = id;
          opts.onSessionId?.(id);
        },
      }),
    );
    const phase1Exit = await exitPromise;
    opts.signal?.removeEventListener("abort", onAbort);

    if (interrupted || phase1Exit !== 0) {
      return { sessionId, exitCode: phase1Exit === 0 ? 130 : phase1Exit, interrupted };
    }

    // Phase 2: interactive resume
    const resumeArgs = [
      "--dangerously-skip-permissions",
      ...(sessionId ? ["--resume", sessionId] : []),
      ...(opts.extraArgs ?? []),
    ];
    const result = spawnSync("claude", resumeArgs, {
      cwd: opts.cwd,
      stdio: "inherit",
      env: process.env,
    });

    return {
      sessionId,
      exitCode: result.status ?? 1,
      interrupted: false,
    };
  }
  ```

  Hoist the `streamEvents` / `OutputAdapter` imports to the top of the file if not already present. Do not duplicate imports.

- [ ] **Step 4: Run unit tests to confirm passing**

  Run: `npx vitest run src/cli/lib/tests/session.test.ts`
  Expected: all 4 tests pass.

- [ ] **Step 5: Migrate `plan.ts` to the helper**

  In `src/cli/commands/plan.ts`, locate the inline `spawn("claude", ["-p", …])` block followed by `spawnSync("claude", ["--resume", …])`. Replace with:

  ```typescript
  const { sessionId, exitCode, interrupted } = await runTwoPhaseClaudeSession({
    cwd: project,
    trigger,
    output,
  });
  if (interrupted) process.exit(130);
  if (exitCode !== 0) process.exit(exitCode);
  ```

  Keep all plan-specific trigger composition, output steps, and post-session logic. Add `runTwoPhaseClaudeSession` to the imports from `"../lib/session.js"`.

- [ ] **Step 6: Migrate `pipelineCreateCommand` to the helper**

  In `src/cli/commands/pipeline.ts`, find the two-phase block inside `pipelineCreateCommand` (around line 520–550). Replace with the same helper call. Preserve the surrounding conflict check, trigger composition via `composeCreatePrompt`, and post-session validate call.

- [ ] **Step 7: Migrate `pipelineRefineCommand` to the helper**

  In `src/cli/commands/pipeline.ts`, find the two-phase block inside `pipelineRefineCommand` (around line 610–640). Replace with the same helper call. Preserve the surrounding preserve-labels framing at lines 600–605 and the post-session validate call.

- [ ] **Step 8: Run the full test suite**

  Run: `npx vitest run`
  Expected: all tests pass, including existing `plan`, `pipelineCreateCommand`, and `pipelineRefineCommand` tests (no behavior drift).

- [ ] **Step 9: TypeScript + build check**

  Run: `npm run build`
  Expected: build succeeds, no TS errors.

- [ ] **Step 10: Commit**

  ```bash
  git add src/cli/lib/session.ts src/cli/lib/tests/session.test.ts src/cli/commands/plan.ts src/cli/commands/pipeline.ts
  git commit -m "refactor(session): extract runTwoPhaseClaudeSession helper"
  ```

---

## Chunk 2: Inject recent run-trace digests into the refine trigger

**Files:**
- Modify: `src/cli/commands/pipeline.ts` (`pipelineRefineCommand` + new `listRecentTraces` helper near `pipelineTraceCommand` at line 388)
- Modify: `src/cli/program.ts` (add `--no-traces` option to `pipeline refine`)
- Modify: `src/cli/tests/pipeline.test.ts` (extend `pipelineRefineCommand` describe)
- Modify: `README.md` (refine section: note trace injection + `--no-traces`)

Refine currently sees the `.dot` graph verbatim but nothing about how it has been executing. Inject up to `REFINE_TRACE_COUNT` (default 3) recent traces, digested via `buildSessionDigest`, into the trigger under a clearly labeled "Recent run traces" block placed BEFORE the existing "Here is the current pipeline workflow" block. Skip entirely when no traces exist.

- [ ] **Step 1: Write failing tests for trace injection**

  Extend the `pipelineRefineCommand` describe in `src/cli/tests/pipeline.test.ts`:

  - **includes trace digests in trigger when traces exist**: seed `pipelines/<name>.dot` plus N trace files in the project's trace directory, call `pipelineRefineCommand`, assert the captured `args[1]` trigger contains a `"Recent run traces for review:"` header and the digested summary strings from the seeded traces.
  - **caps injection at `REFINE_TRACE_COUNT`**: seed 5 trace files, assert only the 3 newest appear in the trigger.
  - **skips the trace block entirely when no traces exist**: no trace files on disk → assert the trigger does NOT contain `"Recent run traces"`.
  - **honors `--no-traces` option**: seed traces, call `pipelineRefineCommand("review", { project: dir, traces: false })`, assert trigger does NOT contain `"Recent run traces"`.
  - **trace block precedes the current-graph block**: when both present, assert `indexOf("Recent run traces")` < `indexOf("Here is the current pipeline")`.

  Expected initial state: FAIL — `listRecentTraces` helper is missing and `PipelineRefineOptions` has no `traces` field.

- [ ] **Step 2: Run the tests to confirm failure**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t pipelineRefineCommand`
  Expected: the 5 new assertions fail.

- [ ] **Step 3: Add `listRecentTraces` helper near `pipelineTraceCommand`**

  In `src/cli/commands/pipeline.ts`, below the existing `pipelineTraceCommand` (line 388), add:

  ```typescript
  export const REFINE_TRACE_COUNT = 3;

  /** Returns absolute paths to up to `limit` most recent trace files for `<name>`, newest first. */
  export function listRecentTraces(project: string, name: string, limit: number): string[] {
    const traceDir = getTraceDir(project, name); // reuse whatever pipelineTraceCommand uses; if inlined, factor that out
    if (!existsSync(traceDir)) return [];
    const entries = readdirSync(traceDir)
      .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"))
      .map((f) => ({ path: join(traceDir, f), mtime: statSync(join(traceDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
    return entries.map((e) => e.path);
  }
  ```

  If the trace directory resolution is currently inlined inside `pipelineTraceCommand`, factor it into a small `getTraceDir(project, name)` function and reuse it here — do not duplicate path logic.

- [ ] **Step 4: Extend `PipelineRefineOptions` and `pipelineRefineCommand`**

  Update the interface:

  ```typescript
  export interface PipelineRefineOptions {
    project?: string;
    /** When false, skip recent-trace injection. Default true. */
    traces?: boolean;
  }
  ```

  Inside `pipelineRefineCommand`, after computing `existingContent`/`relativePath` and before composing `trigger`:

  ```typescript
  const includeTraces = opts.traces !== false;
  let traceBlock = "";
  if (includeTraces) {
    const tracePaths = listRecentTraces(project, name, REFINE_TRACE_COUNT);
    if (tracePaths.length > 0) {
      const digests = tracePaths.map((p) => digestTraceFile(p)); // see Step 5
      traceBlock =
        `Recent run traces for ${name}:\n\n` +
        digests.join("\n\n") +
        "\n\n---\n\n";
    }
  }
  ```

  Then prepend `traceBlock` to the existing framing:

  ```typescript
  const refineFraming = traceBlock + existingFramingString; // the "Here is the current pipeline workflow …" block
  const trigger = `${basePrompt}\n\n---\n${refineFraming}`;
  ```

- [ ] **Step 5: Implement `digestTraceFile` using `buildSessionDigest`**

  Add near `listRecentTraces`:

  ```typescript
  /** Reads a trace file, reconstructs a minimal Session, returns a compact human-readable digest string. */
  function digestTraceFile(tracePath: string): string {
    const session = reconstructSessionFromTrace(tracePath); // reuse any existing reader; if none, parse the jsonl minimally
    const d = buildSessionDigest(session);
    return [
      `Trace: ${tracePath}`,
      `Exit: ${d.exitReason} (success=${d.success}) after ${d.turnsUsed} turns`,
      `Tools: ${d.digest.tools.map((t) => `${t.name}×${t.count}`).join(", ") || "none"}`,
      `Usage: in=${d.digest.usage.inputTokens} out=${d.digest.usage.outputTokens}`,
      d.output ? `Last assistant output (truncated):\n${d.output.slice(0, 800)}` : "",
    ].filter(Boolean).join("\n");
  }
  ```

  If `reconstructSessionFromTrace` already exists elsewhere (check trace command code), reuse it. If not, implement a minimal JSONL reader that feeds `session.history` and sets `session.exitReason` — the digest does not need a perfect replay, only the aggregate fields.

- [ ] **Step 6: Register `--no-traces` on the `pipeline refine` Commander subcommand**

  In `src/cli/program.ts`, find the `pipeline refine <name>` registration. Add below the existing `--project` option:

  ```typescript
      .option("--no-traces", "Skip injecting recent run trace digests into the refine trigger")
  ```

  In the action, pass `opts.traces` through to `pipelineRefineCommand`:

  ```typescript
      .action(async (name: string, opts: { project?: string; traces?: boolean }) => {
        await pipelineRefineCommand(name, opts);
      });
  ```

- [ ] **Step 7: Run refine tests**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t pipelineRefineCommand`
  Expected: all refine tests pass, including the 5 new ones.

- [ ] **Step 8: Update README refine section**

  In `README.md`, under the `ralph pipeline refine` description added in the 2026-04-16 plan, append a short paragraph:

  > By default, digests of up to 3 recent run traces for this pipeline are injected into the session so the agent can see how the graph has been executing. Use `--no-traces` to suppress this when experimenting with a half-written pipeline.

- [ ] **Step 9: Full test suite + build**

  Run: `npx vitest run && npm run build`
  Expected: green + clean.

- [ ] **Step 10: Commit**

  ```bash
  git add src/cli/commands/pipeline.ts src/cli/program.ts src/cli/tests/pipeline.test.ts README.md
  git commit -m "feat(pipeline): inject recent run-trace digests into refine trigger"
  ```

---

## Chunk 3: Edge-label diff in `pipelineValidateCommand`

**Files:**
- Modify: `src/cli/commands/pipeline.ts` (extend `PipelineValidateOptions`, add diff logic to `pipelineValidateCommand` at line 39; wire refine flow at the post-session validate call)
- Modify: `src/cli/tests/pipeline.test.ts` (new describe: `pipelineValidateCommand edge-label diff`)

The refine trigger text at `src/cli/commands/pipeline.ts:602–605` tells the agent to preserve node IDs and edge labels. Today that is prose-only. Add a structural post-session check: when the caller supplies a `previousGraph`, validate compares edges and emits a diagnostic for any edge whose `from`/`to` pair is unchanged but whose label text differs. Direct `ralph pipeline validate <path>` invocations pass no previous graph and therefore skip the diff (zero behavior change for direct CLI users).

- [ ] **Step 1: Write failing tests for the edge-label diff**

  Add to `src/cli/tests/pipeline.test.ts`:

  - **warns on label rename with stable topology**: build two `Graph` objects where edge `a → b` has label `"ok"` in previous and `"approved"` in current (other edges identical); call `pipelineValidateCommand(dotPath, { previousGraph })`; assert `out.warn` was called with a message containing both `"ok"` and `"approved"` and the phrase `"Edge labels are routing keys"`.
  - **errors when the old label is still referenced elsewhere**: same diff, but a third edge's condition references `"ok"`; assert the diagnostic is emitted via `out.error` and the return value is non-zero.
  - **no diagnostic when topology changed**: current graph's edge `a → b` is removed entirely and replaced with `a → c` labeled `"approved"`; no warn/error about label renames (topology changes are out of scope per the design).
  - **no diagnostic when label identical**: trivial case; diff branch emits nothing.
  - **no diagnostic when `previousGraph` is omitted**: call with only the path; assert diff code is never reached (covered via `out.warn` not having been called with the label-rename string).

  Expected initial state: FAIL — `PipelineValidateOptions` has no `previousGraph`, `pipelineValidateCommand` has no diff branch.

- [ ] **Step 2: Run tests to confirm failure**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t "edge-label diff"`
  Expected: FAIL.

- [ ] **Step 3: Extend `PipelineValidateOptions` and `pipelineValidateCommand`**

  In `src/cli/commands/pipeline.ts`:

  ```typescript
  export interface PipelineValidateOptions {
    // existing fields preserved
    previousGraph?: Graph;
  }
  ```

  After normal schema validation inside `pipelineValidateCommand`, add:

  ```typescript
  if (opts.previousGraph) {
    const diagnostics = diffEdgeLabels(opts.previousGraph, currentGraph);
    for (const d of diagnostics) {
      if (d.severity === "error") await output.error(d.message);
      else await output.warn(d.message);
    }
    if (diagnostics.some((d) => d.severity === "error")) return 1;
  }
  ```

- [ ] **Step 4: Implement `diffEdgeLabels`**

  Add near the top of `src/cli/commands/pipeline.ts` (or in a small helper module if the file is getting large):

  ```typescript
  interface EdgeDiagnostic { severity: "warning" | "error"; message: string; }

  export function diffEdgeLabels(prev: Graph, curr: Graph): EdgeDiagnostic[] {
    const out: EdgeDiagnostic[] = [];
    const prevEdges = new Map(prev.edges.map((e) => [`${e.from}->${e.to}`, e]));
    const currEdges = new Map(curr.edges.map((e) => [`${e.from}->${e.to}`, e]));

    for (const [key, prevEdge] of prevEdges) {
      const currEdge = currEdges.get(key);
      if (!currEdge) continue; // topology changed — out of scope
      if ((prevEdge.label ?? "") === (currEdge.label ?? "")) continue;

      const referencedElsewhere = labelIsReferenced(prev, prevEdge.label ?? "");
      out.push({
        severity: referencedElsewhere ? "error" : "warning",
        message:
          `Edge ${prevEdge.from} → ${prevEdge.to} label renamed: ` +
          `"${prevEdge.label ?? ""}" → "${currEdge.label ?? ""}". ` +
          "Edge labels are routing keys; silent renames break downstream handlers.",
      });
    }
    return out;
  }

  function labelIsReferenced(g: Graph, label: string): boolean {
    if (!label) return false;
    // Scan node conditions / handler configs for the label string.
    // Implementation mirrors existing pipeline reference scans; reuse if available.
    return g.nodes.some((n) => JSON.stringify(n).includes(`"${label}"`));
  }
  ```

  If the codebase already has a label-reference scanner, use it instead of `JSON.stringify` — string-in-JSON is the fallback.

- [ ] **Step 5: Wire the refine flow into the diff**

  In `pipelineRefineCommand`:

  - Before launching the two-phase session, parse the current `.dot` into a `Graph` and bind it to `previousGraph` (local variable).
  - After a clean session exit (status 0) AND the file still exists, call `pipelineValidateCommand(dotPath, { previousGraph })`.

  Example:

  ```typescript
  const previousGraph = parseDotToGraph(existingContent); // reuse whatever pipelineValidateCommand uses
  // …run two-phase session…
  if (!existsSync(dotPath)) { /* existing warn + exit */ }
  const exitCode = await pipelineValidateCommand(dotPath, { previousGraph });
  process.exit(exitCode);
  ```

- [ ] **Step 6: Run tests**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts`
  Expected: all green, including the 5 new edge-label diff tests.

- [ ] **Step 7: Build check**

  Run: `npm run build`
  Expected: clean.

- [ ] **Step 8: Commit**

  ```bash
  git add src/cli/commands/pipeline.ts src/cli/tests/pipeline.test.ts
  git commit -m "feat(pipeline): diff edge labels in validate when previousGraph supplied"
  ```

---

## Chunk 4: Post-failure refine tip in `pipelineRunCommand`

**Files:**
- Modify: `src/cli/commands/pipeline.ts` (`pipelineRunCommand` failure exit paths)
- Modify: `src/cli/program.ts` (add `--no-tips` option to `pipeline run`)
- Modify: `src/cli/tests/pipeline.test.ts` (extend `pipelineRunCommand` describe)
- Modify: `README.md` (note the tip in the `pipeline run` section)

On any non-zero exit from `pipelineRunCommand`, print `Tip: ralph pipeline refine <name>` so the run → refine → run loop is legible in the UI layer. Suppress when stdout is not a TTY (CI / piped output stays clean) and when `--no-tips` is passed. Success paths remain untouched.

- [ ] **Step 1: Write failing tests for the tip**

  Extend `pipelineRunCommand` tests in `src/cli/tests/pipeline.test.ts`:

  - **emits tip on TTY failure**: stub `process.stdout.isTTY = true`, run a pipeline that exits non-zero, assert `out.info` (or the existing tip channel — whichever the codebase uses for sidebar-ish hints) was called with a message containing `"ralph pipeline refine"` AND the pipeline's resolved name.
  - **no tip on success**: pipeline exits 0 → assert no `ralph pipeline refine` string was emitted.
  - **no tip when stdout is not a TTY**: stub `isTTY = false`, assert no tip even on failure.
  - **`--no-tips` suppresses on TTY failure**: pass `{ tips: false }`, assert no tip on TTY failure.

  Expected initial state: FAIL — `pipelineRunCommand` has no tip emission code.

- [ ] **Step 2: Run tests to confirm failure**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t pipelineRunCommand`
  Expected: the 4 new assertions fail.

- [ ] **Step 3: Extend `PipelineRunOptions` and `pipelineRunCommand`**

  ```typescript
  export interface PipelineRunOptions {
    // existing fields preserved
    tips?: boolean; // default true
  }
  ```

  Inside `pipelineRunCommand`, immediately before each non-zero `process.exit(...)` (or `return nonZero`) path, call a single helper:

  ```typescript
  maybeEmitRefineTip(name, opts);
  ```

  Where:

  ```typescript
  function maybeEmitRefineTip(name: string, opts: PipelineRunOptions): void {
    if (opts.tips === false) return;
    if (!process.stdout.isTTY) return;
    output.info(`Tip: ralph pipeline refine ${name}   # edit this pipeline with agent assistance`);
  }
  ```

  Resolve `name` from the same name-resolution path `pipeline run` uses today (it already has it — do not re-derive it). If the run command was invoked with a direct `.dot` path rather than a name, strip to basename-without-extension.

- [ ] **Step 4: Register `--no-tips` on the `pipeline run` Commander subcommand**

  In `src/cli/program.ts`, find the `pipeline run` registration and add:

  ```typescript
      .option("--no-tips", "Suppress the refine tip on non-zero exits")
  ```

  Pass through to `pipelineRunCommand` in the action callback.

- [ ] **Step 5: Run tests**

  Run: `npx vitest run src/cli/tests/pipeline.test.ts -t pipelineRunCommand`
  Expected: all 4 new tests pass, no regressions.

- [ ] **Step 6: Update README `pipeline run` section**

  In `README.md`, under the `ralph pipeline run` subsection, add a single line:

  > On non-zero exits, a `Tip: ralph pipeline refine <name>` line is printed to point at the iteration loop. TTY-only; pass `--no-tips` to suppress.

- [ ] **Step 7: Full suite + build**

  Run: `npx vitest run && npm run build`
  Expected: green + clean.

- [ ] **Step 8: Commit**

  ```bash
  git add src/cli/commands/pipeline.ts src/cli/program.ts src/cli/tests/pipeline.test.ts README.md
  git commit -m "feat(pipeline): print refine tip on non-zero pipeline run exits"
  ```

---

## Post-completion

After all 4 chunks pass (they may merge in any order):

1. Run full test suite: `npx vitest run` — all green.
2. Rebuild: `npm run build` — clean.
3. End-to-end smoke (only if `claude` CLI is available locally):
   ```bash
   ralph pipeline refine illumination-to-implementation --project .
   ```
   Expected: session opens with an injected "Recent run traces" block if traces exist; on exit, validate runs and reports either clean or an edge-label diagnostic if any label was renamed.
4. Force a pipeline failure and confirm the tip appears:
   ```bash
   ralph pipeline run <a-known-failing-pipeline> --project .
   ```
   Expected: non-zero exit followed by `Tip: ralph pipeline refine <name>` on a TTY; absent under `ralph pipeline run … --no-tips` or when stdout is piped.
5. Confirm the source illumination still exists:
   ```bash
   ls meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md
   ```
   Fail loudly if absent.
6. Mark the illumination dispatched via `mcp__illumination__mark_dispatched` with `filename="2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md"` and `plan_path="docs/superpowers/plans/2026-04-17-refine-authoring-loop.md"`.
