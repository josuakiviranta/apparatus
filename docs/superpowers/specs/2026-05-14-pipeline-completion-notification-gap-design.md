# Design: OS notification on pipeline completion and gate block

**Date:** 2026-05-14
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-14T1519-pipeline-completion-notification-gap.md`
**Sibling precedent:** `docs/adr/0021-prevent-system-sleep-during-pipeline-runs.md` (same macOS-only silent-no-op pattern)

## 1. Motivation

A pipeline run is a long-haul operation — `illumination-to-implementation` runs ~17 nodes for an hour or more, `parallel-illumination-to-implementation` runs several hours. ADR-0021 already commits to "leave the computer and trust the pipeline finishes": the engine is caffeinated for its full lifetime so the box does not sleep mid-run. `apparat heartbeat` further assumes the operator is away for hours between ticks.

What is missing is the symmetric signal: nothing tells the operator that a run has finished, or that a gate is blocked waiting on a human choice. Today the only way to know is to keep the terminal in focus. The spider/web charter in VISION.md says the human is the spider and the pipeline is the web — the spider should leave the web and return only when something is on it. Polling a tmux pane is not "returning when something is on it"; it is watching the web.

Two seams already carry every signal needed for an OS notification, neither of which currently fires one:

- `src/daemon/runner.ts:118-136` — `child.on("close", ...)` resolves with `exitCode` after `closeRun(...)`. `task.args` carries the pipeline.dot path; `resolveProjectFromArgs(task.args)` returns the project root.
- `src/attractor/handlers/wait-human.ts:35-39` — `this.interviewer.ask(...)` blocks on the operator's choice. The expanded `prompt` and `choices` are already in scope on lines 18–33.

The verifier subagent confirmed there is no notification scaffolding anywhere under `src/` today.

### What this design closes

- The "left it running, came back two hours later, turns out it was waiting on a yes/no gate for 90 minutes" failure.
- The "did the run finish? did it fail?" check that currently requires bringing a tmux pane to the foreground.

### What this design explicitly does **not** close

- Linux and Windows notifications. macOS-only silent-no-op today, matching ADR-0021.
- A cross-platform notification library (`node-notifier` etc.) — explicitly rejected as a new npm dependency for a single-machine personal tool.
- Notifications for engine-internal events (node start, retry, validation failure). Only the two operator-facing "you need to look now" signals: run done and gate blocked.
- Focus / Do Not Disturb behavior. macOS silences banners when Focus is on; that is OS policy, not apparatus's concern. README caveats it.

## 2. Decision summary

A single new helper file plus two one-line call sites. No `.dot` schema change, no `HandlerExecutionContext` change, no `WaitHumanHandler` constructor change, no CLI flag.

1. **New file `src/lib/notify.ts`** exports `notifyUser(title: string, body: string, subtitle?: string): void`. On `process.platform === "darwin"` it `execSync`'s an `osascript -e 'display notification ...'` invocation wrapped in `try/catch` so a notification failure is never fatal. On `linux` and `win32` it returns silently.

2. **One call inside `runner.ts`'s `child.on("close")` block** at `src/daemon/runner.ts:118-136`, between `closeRun(task.id, runId, endedAt, exitCode)` (line 134) and `resolve({ runId, exitCode })` (line 135). Project name is derived from `task.args` via `resolveProjectFromArgs`; pipeline name is derived from `task.args[1]` (the pipeline.dot path under `pipeline run <dotFile>`).

3. **One call inside `WaitHumanHandler.execute`** at `src/attractor/handlers/wait-human.ts:35`, immediately before the `this.interviewer.ask(...)` invocation, after `prompt` and `choices` are resolved on lines 18–33. Pipeline name is derived from `this.dotDir` (basename), with an `unknown` fallback because the constructor declares `dotDir?: string` (optional) at line 8.

4. **Vitest unit coverage at `src/lib/notify.test.ts`** (sibling to source, per the `<module>.test.ts` convention used by `src/lib/`). Asserts:
   - On `darwin`: `execSync` called once with an `osascript -e 'display notification "<body>" with title "<title>" subtitle "<subtitle>"'` invocation built from the args. Body / title / subtitle are quoted-escaped for `osascript`.
   - On `darwin`: `execSync` throwing is swallowed (no rethrow).
   - On `linux` / `win32`: `execSync` not called; helper returns void.

5. **README "Sleep behaviour (macOS)" neighbourhood** (currently lines 227–242) gains a parallel **"Notifications (macOS)"** section: what fires, when, and the Focus / Do Not Disturb caveat. ADR-0019 mirroring ADR-0021 is optional and not blocking on ship.

## 3. Architecture

### 3.1 Module shape

`src/lib/notify.ts` follows ADR-0021's `prevent-sleep.ts` template, with one deviation: it uses `execSync` rather than `spawn`. `execSync` is correct here because notifications are fire-and-forget and synchronous — the helper returns void either way, and there is no PID to watch. `prevent-sleep.ts` needs `spawn` because `caffeinate` must outlive the call.

- **Interface:** `notifyUser(title: string, body: string, subtitle?: string): void`. Three string params, no return, no teardown.
- **Implementation:** hides the `osascript` AppleScript string, the `execSync` choice, the `try/catch`, and the `process.platform` branch.
- **Seam test:** mock `child_process.execSync` and `process.platform`. One mock at one boundary.

The interface stays constant when Linux / Windows branches are added later. Linux candidate: `notify-send "$title" "$body"`. Windows: `powershell -Command "[System.Windows.Forms.MessageBox]::Show(...)"` or skipped entirely.

### 3.2 The two call sites

**Site A — pipeline completion** at `src/daemon/runner.ts:134`.

Today the `child.on("close")` block reads:

```ts
child.on("close", (code) => {
  try { unlinkSync(pidPath); } catch {}
  const exitCode = code ?? 1;
  const endedAt = Date.now();
  if (logsRoot && projectRoot) {
    appendLogLine(task.id, runId, {
      ts: endedAt,
      stream: "system",
      content: `→ apparat pipeline trace ${runId} --project ${projectRoot}`,
    });
  }
  appendLogLine(task.id, runId, {
    ts: endedAt,
    stream: "system",
    content: `Session ended (exit ${exitCode})`,
  });
  closeRun(task.id, runId, endedAt, exitCode);
  resolve({ runId, exitCode });
});
```

After: insert between `closeRun(...)` and `resolve(...)`:

```ts
const projectName = projectRoot ? path.basename(projectRoot) : "apparat";
const pipelineDot = task.args[0] === "run" ? task.args[1] : undefined;
const pipelineName = pipelineDot ? path.basename(path.dirname(pipelineDot)) : "pipeline";
notifyUser(
  "apparat",
  exitCode === 0 ? "done" : "failed",
  `${projectName} › ${pipelineName}`,
);
```

Placement rationale:
- **Between `closeRun` and `resolve`** so DB state is final by the time the banner appears and the promise resolves immediately after. If `notifyUser` somehow threw it could not break the run — the helper swallows internally — but the ordering keeps semantics obvious.
- **`projectRoot` already in scope** from line 65. The `path.basename` guard handles `resolveProjectFromArgs` returning `null` (per `runner-args.ts:6-12`); we fall back to literal `"apparat"` rather than risking a `TypeError`.
- **Pipeline path from `task.args[1]`** is correct only when `task.args[0] === "run"`. The block is reached for every `runTask`, but only `pipeline run` carries a dotfile in `args[1]`; other commands fall back to literal `"pipeline"`. This avoids positional-arg surprises flagged by the verifier ("whether `task.args[1]` is the pipeline.dot path depends on user-CLI arg order").

**Site B — gate block** at `src/attractor/handlers/wait-human.ts:35`.

Today the block reads:

```ts
const askPromise = this.interviewer.ask({
  type: "MULTIPLE_CHOICE",
  prompt,
  options: choices,
});
```

After: insert one line immediately before `this.interviewer.ask(...)`:

```ts
const pipelineName = this.dotDir ? path.basename(this.dotDir) : "pipeline";
const projectName = meta.projectDir ? path.basename(meta.projectDir) : "apparat";
notifyUser(
  "apparat — gate",
  `${truncate(prompt, 60)} [${choices.join(" / ")}]`,
  `${projectName} › ${pipelineName}`,
);
const askPromise = this.interviewer.ask({ /* ... */ });
```

Placement rationale:
- **Before `interviewer.ask`** so the banner fires the moment the gate becomes blocking, not after the user answers. The `prompt` and `choices` strings are already resolved on lines 18–33.
- **`this.dotDir` optional fallback** because `WaitHumanHandler`'s constructor at line 8 declares `private dotDir?: string`. The verifier explicitly called this out as a nuance. Fallback string `"pipeline"` keeps the subtitle non-empty.
- **`meta.projectDir` is optional** on `HandlerExecutionContext` (`registry.ts:36`). Fallback to `"apparat"` mirrors site A. No new context fields are added.
- **`truncate(prompt, 60)`** is a local helper inlined in the handler — slice on grapheme count is unnecessary for `osascript`'s body, which simply renders the chars. Six-line preamble inside the handler file rather than a new `string-utils.ts` module.

### 3.3 The osascript invocation

```ts
import { execSync } from "node:child_process";

export function notifyUser(title: string, body: string, subtitle?: string): void {
  if (process.platform !== "darwin") return;
  try {
    const escTitle = title.replace(/"/g, '\\"');
    const escBody = body.replace(/"/g, '\\"');
    const escSubtitle = subtitle?.replace(/"/g, '\\"');
    const subtitleClause = escSubtitle ? ` subtitle "${escSubtitle}"` : "";
    execSync(
      `osascript -e 'display notification "${escBody}" with title "${escTitle}"${subtitleClause}'`,
      { stdio: "ignore" },
    );
  } catch {
    // notification failure must never break a pipeline
  }
}
```

Quoting / escaping discipline:

- The full `osascript -e '…'` string uses single quotes so embedded AppleScript double-quotes are unambiguous.
- `replace(/"/g, '\\"')` neutralises any double quotes inside title / body / subtitle (e.g. a gate prompt that contains `"yes"`).
- `stdio: "ignore"` keeps `execSync`'s stdout/stderr from leaking into the engine's log capture (which already attaches to the child's pipes).
- No `\` or backtick escaping — neither AppleScript clause uses them.

Failure modes:
- `osascript` missing (broken macOS): `execSync` throws, caught, no-op.
- Notification Center disabled / Focus on: notification is silently dropped by the OS. From apparatus's perspective indistinguishable from "delivered". README captures this.
- Quoted strings containing a single quote: irrelevant — the outer wrapper is single-quoted, but no shell interpretation of the inner content happens because `osascript -e` reads its single argument as a literal AppleScript source string. The double-quote escape is the only one that matters.

### 3.4 Lifetime

```
runTask spawns child
├── ... engine runs for hours ...
child.on("close")
├── closeRun(...)              (DB final)
├── notifyUser("apparat", ...) (~1ms exec, returns or throws-and-swallows)
└── resolve({ runId, exitCode })

WaitHumanHandler.execute
├── prompt / choices resolved
├── notifyUser("apparat — gate", ...) (~1ms exec, returns or throws-and-swallows)
└── await this.interviewer.ask(...)   (blocks for minutes / hours)
```

The notification call is synchronous and short. `execSync` blocks the engine thread for the length of the `osascript` invocation — empirically <20ms on macOS — which is negligible relative to the surrounding I/O.

## 4. Code anchors

- `src/daemon/runner.ts:65-68` — `projectRoot = resolveProjectFromArgs(task.args)` already in scope.
- `src/daemon/runner.ts:118-136` — `child.on("close")` block where Site A lands.
- `src/daemon/runner-args.ts:6-12` — `resolveProjectFromArgs` returns `string | null`; null-guard required before `path.basename`.
- `src/attractor/handlers/wait-human.ts:7-8` — `WaitHumanHandler` constructor; `dotDir?: string` is optional.
- `src/attractor/handlers/wait-human.ts:18-33` — `prompt` and `choices` resolution.
- `src/attractor/handlers/wait-human.ts:35-39` — `this.interviewer.ask(...)` block where Site B lands.
- `src/attractor/handlers/registry.ts:13-41` — `HandlerExecutionContext`; `dotDir: string` required, `projectDir?: string` optional. No new fields added.
- `src/lib/prevent-sleep.ts:1-20` — ADR-0021 precedent for macOS-only silent-no-op. `notify.ts` mirrors the platform branch shape but uses `execSync` not `spawn` because the call is fire-and-forget.
- `README.md:227-242` — existing "Sleep behaviour (macOS)" section that the new "Notifications (macOS)" section sits adjacent to.

## 5. Blast radius / impact surface

- **Size:** S.
- **Surfaces crossed:** `src/lib/` (new helper), `src/daemon/` (one call site), `src/attractor/handlers/` (one call site), `README.md` (one paragraph). Optional: `docs/adr/` (ADR-0019), `CONTEXT.md` (glossary stub).
- **Breaking changes:** none. Every public contract is unchanged.
  - `HandlerExecutionContext` shape: unchanged.
  - `WaitHumanHandler` constructor `(interviewer, dotDir?)`: unchanged.
  - `WaitHumanHandler.execute` return type `Promise<Outcome>`: unchanged.
  - `resolveProjectFromArgs` signature `(args) => string | null`: unchanged.
  - Pipeline `.dot` schema, agent frontmatter, gate `.md` schema: unchanged.
  - CLI flags, env vars: none added.
  - `runTask`'s resolved-promise shape `{ runId, exitCode }`: unchanged.
- **Update checklist:**
  - [ ] `src/lib/notify.ts` — new file (~25 lines).
  - [ ] `src/lib/notify.test.ts` — new vitest unit (one suite, three cases).
  - [ ] `src/daemon/runner.ts` — insert ~5 lines inside `child.on("close")` block, add `path` import if not already present (it is — line 3 `import { join, dirname } from "path"`; either widen that import or add a fresh one).
  - [ ] `src/attractor/handlers/wait-human.ts` — insert ~5 lines before `this.interviewer.ask`, add `path` import, inline `truncate` helper.
  - [ ] `README.md` — add "Notifications (macOS)" paragraph adjacent to lines 227–242, including Focus / Do Not Disturb caveat.
  - [ ] `docs/adr/0019-...md` — **optional.** ADR-0019 mirroring ADR-0021 if the operator wants the historical record; non-blocking.
  - [ ] `CONTEXT.md` — **optional.** Glossary stub for `notifyUser` if domain vocabulary is being maintained; non-blocking.
  - [ ] `.apparat/scenarios/` — no fixture; this is a product-side notification, not engine behavior. No smoke test.

## 6. Open questions

- **Subtitle separator character (` › ` U+203A vs ` / ` vs ` | `).** Refinement bullet ("Notification format for pipeline completion") fixed ` › `. Keep as-is unless the operator pushes back during implementation review. AppleScript renders Unicode fine.
- **Truncation length on gate prompt body (60 chars).** Refinement bullet specified 60. Long gate prompts (e.g. multi-sentence approval gates) get clipped to first 60 characters plus `…`. Acceptable because the banner is a "look now" cue, not the prompt itself — the operator reads the full prompt in the terminal.
- **Should the daemon fire a notification on `apparat heartbeat` tick spawn failure** (e.g. `child.on("error")`)? Today the close handler covers `child.on("close")` only. If a heartbeat tick fails to spawn at all there is no close event. Out of scope for this design; revisit if it bites.
- **Should there be a final "all batches done" notification for `parallel-illumination-to-implementation`?** That pipeline finishes when its outer `pipelineRunCommand` returns — covered by Site A. No special case needed.

## 7. Verification targets

- **Unit:** `npx vitest run src/lib/notify.test.ts` — three cases (darwin happy, darwin error swallowed, non-darwin no-op).
- **Lint / type-check:** `npx tsc --noEmit`.
- **Manual exercises on macOS:**
  - Short pipeline run: `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot --project .` — banner `apparat / apparatus › static-multi-node / done` appears on completion.
  - Failed run (force exit 1 via a tool node): banner body shows `failed`.
  - Gate pipeline: trigger `WaitHumanHandler` (any pipeline with a `wait_human` node) — banner `apparat — gate / <project> › <pipeline> / <truncated prompt> [yes / no]` fires the moment the gate blocks.
  - Cross-project case: from apparatus root, run `apparat pipeline run /…/verba-extension/.apparat/pipelines/harness-loop/pipeline.dot --project /…/verba-extension` — subtitle shows `verba-extension › harness-loop`, confirming the `path.basename(resolveProjectFromArgs(...))` derivation.
  - Focus on / Do Not Disturb on: same run, confirm OS silently suppresses banner. README caveat language matches observed behavior.
- **Linux / Windows manual exercises:** N/A — silent-no-op by design.
- **Surfaces touched:** `lib`, `daemon`, `attractor/handlers`.
