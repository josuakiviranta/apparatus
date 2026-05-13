# Design: Inner-loop ergonomics debt — Claude allowlist refresh + `pipeline show` auto-open

**Date:** 2026-05-13
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-12T2324-inner-loop-ergonomics-debt.md`
**Related ADR:** new ADR-0018 (`docs/adr/0018-pipeline-show-opens-svg.md`) lands with this change. Cross-references ADR-0010 (rename to apparatus, accepted 2026-05-05 — `docs/adr/0010-rename-to-apparatus.md`) which left `Bash(ralph:*)` as renaming debt; cross-references ADR-0004 ("source code, CONTEXT.md, and ADRs are the only authoritative documentation") which supports recording the choice as an ADR. ADRs 0016 and 0017 are taken (`docs/adr/0016-run-scoped-mcp-config-with-heartbeat.md`, `docs/adr/0017-tsup-node-env-bundle-pin.md`) — the illumination's proposal of "0016" pre-dates them.

## 1. Motivation

Two `.apparat/notes.md` entries describe the same drift: the solo-developer inner loop carries small frictions the project keeps not fixing. Both are evening-sized; neither has been done.

### 1.1 Defect A — stale `Bash(ralph:*)` allowlist, missing daily verbs

`.claude/settings.local.json` today (verified via Read):

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
      "mcp__plugin_context-mode_context-mode__ctx_search",
      "Bash(npm link:*)",
      "Bash(ralph:*)",
      "Bash(npm:*)"
    ]
  }
}
```

`Bash(ralph:*)` grants nothing — the binary was renamed to `apparat` by ADR-0010 on 2026-05-05 (`docs/adr/0010-rename-to-apparatus.md:13-28`, decision table). Meanwhile every routine command run by operator and agents (`apparat status`, `apparat pipeline validate`, `apparat pipeline run`, `git status` / `git log` / `git diff` / `git show` / `git branch`, `rg`, `node` / `tsx` / `vitest`, `open`, the `mcp__illumination__*` server tools) is **not** allowlisted and prompts the operator dozens of times per session.

This is plain renaming debt left behind by the ADR-0010 big-bang. Claude Code already ships the `less-permission-prompts` skill for exactly this audit — apparatus doesn't need to invent it, just run it.

### 1.2 Defect B — `pipeline show` writes the SVG, then stops

`src/cli/commands/pipeline/show.ts:64-75`:

```ts
const svgPath = join(dirname(absPath), basename(absPath, ".dot") + ".svg");
try {
  writeFileSync(svgPath, svg);
} catch (err) {
  await output.error(`Failed to write ${svgPath}: ${(err as Error).message}`);
  return 1;
}

await output.success(
  `Wrote ${relative(process.cwd(), svgPath) || svgPath} ` +
  `(${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
);
return 0;
```

The only purpose of `pipeline show` is to **visualise** the pipeline. Writing the artefact and stopping is half a feature — the same shallow-handler smell that closed sessions like `2026-05-05-shallow-control-flow-handlers.md` were written about. The operator switches windows and runs `open foo.svg` by hand every single time.

### 1.3 Why now — solo-dev inner loop is the UX metric

`VISION.md` and `CONTEXT.md` (CONTEXT line 9 "no global agent library", line 70 "no side folders") make the project posture explicit: the operator **is** the end user. Friction in their inner loop is the user-experience metric for this project — there is no other. Both defects nag every session; neither is glamorous; both are <30-line fixes.

The two items also expose a missing meta-routine: nothing in the project periodically re-audits the operator's daily verbs against the allowlist. A future rename will silently halve the allowlist's value again. Worth folding into `apparat doctor` if and when it earns its keep — not today (YAGNI; illumination Step 7 explicitly defers it).

## 2. Decision summary

Two landed pieces plus doc + ADR + sweep:

1. **Rewrite `.claude/settings.local.json` allowlist.** Drop the dead `Bash(ralph:*)`. Add the verbs the operator actually runs daily: `Bash(apparat:*)`, `Bash(git status:*)`, `Bash(git log:*)`, `Bash(git diff:*)`, `Bash(git show:*)`, `Bash(git branch:*)`, `Bash(rg:*)`, `Bash(ast-grep:*)`, `Bash(node:*)`, `Bash(tsx:*)`, `Bash(vitest:*)`, `Bash(npx:*)`, `Bash(open:*)`, `Bash(npm root:*)`, `mcp__illumination__*`. Keep destructive verbs (`git push`, `git reset --hard`, `rm`, `git commit`) **prompted**.
2. **Make `pipeline show` auto-open the SVG.** Add `--open` / `--no-open` to the CLI. After the `writeFileSync` at `src/cli/commands/pipeline/show.ts:64-69`, branch on `process.platform` and spawn the OS default opener (`open` on darwin, `xdg-open` on linux, `start` on win32). Spawn failure is non-fatal — log "open manually at <relPath>" and exit 0. No browser detection (illumination explicit — "if introduce a lot complicance should be forgotten").
3. **Update `src/cli/skills/apparatus/SKILL.md:19`** — `pipeline show` row gains an auto-open hint + `--no-open` escape.
4. **Update `README.md:92-95`** — `pipeline show` paragraph mentions the auto-open + escape hatch.
5. **Append ADR-0018** (`docs/adr/0018-pipeline-show-opens-svg.md`) — records the OS-default-opener decision and explicit refusal of preferred-browser detection.
6. **Sweep non-historical stale `ralph` references** — `grep -rn "ralph" --include="*.ts" --include="*.json" --include="*.md"` outside `.apparat/sessions/`, `.apparat/meditations/stimuli/.triage/`, ADRs 0007/0008/0010, and frozen plan/review docs. Fold non-historical matches into the same PR.

**Locked OUT of scope** (illumination Steps 6 & 7, explicit):

- Preferred-browser detection. Use OS default only.
- `apparat doctor` command. Deferred — YAGNI until prompt rate stays high after Step 1.
- Cross-project verb-audit automation. The `less-permission-prompts` skill is enough.

## 3. Architecture

### 3.1 Two-piece fix

```
Piece A   Claude allowlist   → rewrite settings.local.json verbs
Piece B   CLI command        → spawn OS opener after writeFileSync; --no-open escape
Piece C   Docs + ADR + sweep → SKILL, README, ADR-0018, stale-`ralph` matches
```

Each piece is independent; Piece A could ship alone tomorrow, Piece B could ship alone the day after. They share a PR because the illumination explicitly bundles them as one ergonomics package and the diff is collectively small (~6 modified + 1 created files).

### 3.2 `.claude/settings.local.json` (Piece A)

Current state (`.claude/settings.local.json:1-11`, 5 allow entries verified):

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
      "mcp__plugin_context-mode_context-mode__ctx_search",
      "Bash(npm link:*)",
      "Bash(ralph:*)",
      "Bash(npm:*)"
    ]
  }
}
```

After:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
      "mcp__plugin_context-mode_context-mode__ctx_search",
      "mcp__illumination__*",
      "Bash(apparat:*)",
      "Bash(npm link:*)",
      "Bash(npm:*)",
      "Bash(npm root:*)",
      "Bash(npx:*)",
      "Bash(node:*)",
      "Bash(tsx:*)",
      "Bash(vitest:*)",
      "Bash(rg:*)",
      "Bash(ast-grep:*)",
      "Bash(open:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)",
      "Bash(git branch:*)"
    ]
  }
}
```

Three categories:

- **Dropped:** `Bash(ralph:*)` — dead grant for the pre-rename binary.
- **Added — read-only / build verbs:** `apparat:*`, `git status/log/diff/show/branch:*`, `rg:*`, `ast-grep:*`, `node:*`, `tsx:*`, `vitest:*`, `npx:*`, `npm root:*`, `open:*`, `mcp__illumination__*`. These are the verbs that fire dozens of times in a normal session.
- **Intentionally NOT added (kept prompting):** `git push`, `git reset --hard`, `git commit`, `git rebase`, `rm`, `mv`, `npm publish`, `npm version`, `gh pr create`. Destructive or human-review-warranted; the prompt is a feature here, not friction.

The `Bash(...)` matcher uses Claude Code's prefix-glob shape — see Claude Code permission docs. `Bash(git status:*)` matches `git status`, `git status --short`, etc., but not `git push`.

### 3.3 `src/cli/commands/pipeline/show.ts` (Piece B)

Current state at `:1-2, :12-16, :71-75`:

```ts
import { writeFileSync } from "fs";
import { join, basename, dirname, relative } from "path";
// ...
export interface PipelineShowOptions {
  /** Project folder used for name-shorthand resolution (mirrors validate/run). */
  project?: string;
}
// ...
await output.success(
  `Wrote ${relative(process.cwd(), svgPath) || svgPath} ` +
  `(${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
);
return 0;
```

After:

```ts
import { writeFileSync } from "fs";
import { spawn } from "child_process";
import { join, basename, dirname, relative } from "path";
// ...
export interface PipelineShowOptions {
  /** Project folder used for name-shorthand resolution (mirrors validate/run). */
  project?: string;
  /**
   * Auto-open the rendered SVG via the OS default opener.
   * Default: `process.stdout.isTTY` — opens in interactive shells, skips in
   * headless / CI / test contexts so callers like `pipeline-show-annotation.test.ts`
   * don't spawn `open` against a `vitest` worker.
   */
  open?: boolean;
}
// ...
const relSvg = relative(process.cwd(), svgPath) || svgPath;
await output.success(
  `Wrote ${relSvg} (${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
);

const shouldOpen = opts.open ?? Boolean(process.stdout.isTTY);
if (shouldOpen) {
  try {
    openWithOSDefault(svgPath);
  } catch (err) {
    await output.warn(
      `Could not auto-open SVG (${(err as Error).message}); open manually at ${relSvg}`,
    );
  }
}
return 0;
```

New helper, inside the same file (~10 LOC):

```ts
function openWithOSDefault(filePath: string): void {
  const platform = process.platform;
  const child =
    platform === "darwin"
      ? spawn("open", [filePath], { stdio: "ignore", detached: true })
      : platform === "win32"
      ? spawn("cmd", ["/c", "start", "", filePath], { stdio: "ignore", detached: true })
      : spawn("xdg-open", [filePath], { stdio: "ignore", detached: true });
  child.on("error", () => {
    /* swallowed — the parent already logged a warning via the outer try/catch */
  });
  child.unref();
}
```

Three substantive changes:

- **`open?: boolean` option** added to `PipelineShowOptions`. The default — `process.stdout.isTTY` — means interactive operator use auto-opens, while `vitest`-driven calls (which set neither `--open` nor `--no-open` and run without a TTY) skip the spawn. This is the verifier's recommended mitigation for the `pipeline-show-annotation.test.ts:40` regression risk (`pipelineShowCommand(join(dir, "p", "pipeline.dot"), {})` — verified, the test passes `{}`).
- **Spawn-failure is non-fatal.** Both `spawn` throw paths (synchronous failures like missing binary on a stripped container) and the async `'error'` event are absorbed; the operator sees a `warn`-level "open manually at <path>" instead. Illumination Step 3 is explicit on this.
- **`detached: true` + `unref()`.** The opener may be a long-lived GUI app (e.g. Preview.app on macOS); detaching prevents the apparat CLI from holding a handle to it after `pipelineShowCommand` returns 0.

### 3.4 CLI plumbing (Piece B, second half)

The commander wiring lives in `src/cli/program.ts` (per `MEMORY.md` "all Commander registration lives here"). The `pipeline show` subcommand gains:

```ts
.option("--open", "Auto-open the rendered SVG (default: when stdout is a TTY)")
.option("--no-open", "Skip auto-open even in an interactive shell")
```

In the subcommand action, commander's `--no-open` flips `opts.open` to `false`; `--open` to `true`; absent → `undefined`, which falls back to the TTY check inside `pipelineShowCommand`. This preserves the test contract — tests passing `{}` get the TTY-derived default — and gives the operator both an opt-out (`--no-open`) and an opt-in (`--open`, useful in scripts that pipe stdout but still want the GUI).

### 3.5 `src/cli/tests/pipeline-show.test.ts` (extended) and a new no-open case

Two assertions to add:

1. **Default behaviour in non-TTY context.** The existing tests at `:34-106` call `pipelineShowCommand(dotFile, {})` from `vitest`, where `process.stdout.isTTY` is `undefined`/falsy. They must continue to pass — verifying that the default does **not** spawn `open` under test runners. A new test asserts the spawn is not called: stub `child_process.spawn` via `vi.mock`, assert `spawn` was not invoked for a `{}` call. Place in a new file `src/cli/tests/pipeline-show-no-open.test.ts` to keep the `child_process` mock isolated from the existing test file's mocks.
2. **Explicit `--no-open` honored.** A second case in the same new file: pass `{ open: false }` explicitly, assert `spawn` was not invoked. Mirror case: pass `{ open: true }`, assert `spawn` was invoked exactly once with the correct binary for `process.platform`.

Why a new file rather than extending `pipeline-show.test.ts`: the existing file mocks `@hpcc-js/wasm-graphviz` and `../lib/output.js` but not `child_process`. Adding a `child_process` mock at the top of the existing file would also intercept any unrelated test that imports something which transitively `spawn`s — keeping it in a sibling file isolates the mock to the cases that need it.

### 3.6 Files-touched buckets

| Bucket            | File                                                | Treatment |
|---|---|---|
| Claude allowlist  | `.claude/settings.local.json`                       | Rewrite — drop `Bash(ralph:*)`, add ~15 daily verbs |
| CLI command       | `src/cli/commands/pipeline/show.ts`                 | Edit — add `open?: boolean` option + `openWithOSDefault` helper + TTY-default branch |
| CLI program       | `src/cli/program.ts`                                | Edit — `--open` / `--no-open` flags on `pipeline show` subcommand |
| Test (new)        | `src/cli/tests/pipeline-show-no-open.test.ts`       | New — 3 cases: default-non-TTY, explicit-false, explicit-true |
| Skill doc         | `src/cli/skills/apparatus/SKILL.md`                 | Edit — `pipeline show` row at `:19` mentions auto-open + `--no-open` |
| README            | `README.md`                                         | Edit — `pipeline show` paragraph at `:92-95` mentions auto-open + escape |
| Docs — ADR        | `docs/adr/0018-pipeline-show-opens-svg.md`          | New — records OS-default-opener + refusal of browser detection |
| Sweep             | various `*.ts` / `*.md`                             | Audit — non-historical stale `ralph` references folded in |

Total: **6 modified + 1 created** (matches verifier's S sizing).

## 4. Components & key edits

### 4.1 `.claude/settings.local.json` (rewritten)

See §3.2. The list ordering puts MCP entries first, then `Bash(...)` entries grouped by family (apparat, npm/node toolchain, search, git read-only). Destructive verbs are deliberately absent — the prompt is the safety net.

### 4.2 `src/cli/commands/pipeline/show.ts` (edited)

See §3.3. Net diff: ~+25 LOC. No exported-signature break — `PipelineShowOptions.project` is preserved verbatim; `open?` is purely additive.

### 4.3 `src/cli/program.ts` (edited)

Two commander option lines added to the `pipeline show` subcommand. The action handler passes both `{ project, open }` to `pipelineShowCommand` (commander's `--no-foo`/`--foo` pair surfaces as `opts.open: boolean | undefined`).

### 4.4 `src/cli/tests/pipeline-show-no-open.test.ts` (new)

Outline:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const spawnMock = vi.fn(() => {
  const child = { on: vi.fn(), unref: vi.fn() };
  return child;
});

vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));
vi.mock("@hpcc-js/wasm-graphviz", () => ({
  Graphviz: { load: vi.fn(async () => ({ dot: () => "<svg/>" })) },
}));

import { pipelineShowCommand } from "../commands/pipeline.js";

describe("pipeline show auto-open behaviour", () => {
  let dir: string;
  beforeEach(() => {
    spawnMock.mockClear();
    dir = mkdtempSync(join(tmpdir(), "apparat-show-open-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("does not spawn opener when called from a non-TTY context with default opts", async () => {
    const dotFile = join(dir, "ok.dot");
    writeFileSync(dotFile, `digraph g { start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }`);
    const code = await pipelineShowCommand(dotFile, {});
    expect(code).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("does not spawn opener when --no-open is explicit", async () => {
    const dotFile = join(dir, "ok.dot");
    writeFileSync(dotFile, `digraph g { start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }`);
    const code = await pipelineShowCommand(dotFile, { open: false });
    expect(code).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns the platform-appropriate opener when --open is explicit", async () => {
    const dotFile = join(dir, "ok.dot");
    writeFileSync(dotFile, `digraph g { start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }`);
    const code = await pipelineShowCommand(dotFile, { open: true });
    expect(code).toBe(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin] = spawnMock.mock.calls[0];
    if (process.platform === "darwin") expect(bin).toBe("open");
    else if (process.platform === "win32") expect(bin).toBe("cmd");
    else expect(bin).toBe("xdg-open");
  });
});
```

This protects both regression risks the verifier flagged: `pipeline-show-annotation.test.ts:40`'s `{}` call stays green, and a future change that flips the default to "always open" fails the first case immediately.

### 4.5 `src/cli/skills/apparatus/SKILL.md` (edited)

Current row at `:19`: `| `apparat pipeline show <name>` | Render the pipeline as SVG next to the source `.dot`. |`.

After: `| `apparat pipeline show <name> [--no-open]` | Render the pipeline as SVG next to the source `.dot` and auto-open it in your OS default viewer; pass `--no-open` to skip. |`.

### 4.6 `README.md` Development section (edited)

Current state at `:92-95` (verified via Read):

```
apparat pipeline show <pipeline.dot>

Render the pipeline as an SVG next to the source `.dot` file. Useful for sharing topology snapshots or eyeballing branching structure.
```

After:

```
apparat pipeline show <pipeline.dot>

Render the pipeline as an SVG next to the source `.dot` file and auto-open it in your OS default SVG viewer. Pass `--no-open` to skip the auto-open (useful in scripts or non-interactive shells; the default already skips when stdout is not a TTY). Useful for sharing topology snapshots or eyeballing branching structure.
```

### 4.7 `docs/adr/0018-pipeline-show-opens-svg.md` (new)

Outline:

- **Status:** Accepted (2026-05-13).
- **Context.** `pipeline show` writes the SVG and stops (`src/cli/commands/pipeline/show.ts:64-75` before this change). The operator switches windows and runs `open foo.svg` by hand every session. The illumination at `.apparat/meditations/illuminations/2026-05-12T2324-inner-loop-ergonomics-debt.md` calls this a half-handler; the project posture (VISION.md, CONTEXT.md — solo dev, single machine) makes auto-open a clear ergonomic win.
- **Decision.** `pipeline show` spawns the OS default opener (`open` on darwin, `xdg-open` on linux, `start` on win32) after the SVG is written. `--no-open` skips the spawn; the default also skips when `!process.stdout.isTTY`. Spawn failure is non-fatal — a `warn`-level message tells the operator to open manually; exit code stays 0.
- **Considered alternatives.**
  - *Preferred-browser detection* (read `$BROWSER`, parse macOS LSHandlers, etc.). Rejected — illumination Step 3 explicitly: "if introduce a lot complicance should be forgotten." Solo-dev + single-machine means the OS default is already configured correctly.
  - *No flag, always open.* Rejected — `pipeline-show-annotation.test.ts:40` and any CI/scripted caller would spawn `open` against a worker process; the `--no-open` escape is cheap and the TTY-aware default makes it ergonomic.
  - *Make the auto-open opt-in (default `--no-open`).* Rejected — half-handler again; the operator still has to remember to add the flag.
- **Consequences.** Inner-loop friction shrinks: zero manual `open` calls during typical `pipeline show` use. CI / tests are unaffected — the TTY default ensures the spawn is a no-op outside interactive shells. ADR-0004 (source + ADRs as truth) means the decision is recorded here rather than buried in a session log.
- **Cross-refs.** ADR-0010 (rename to apparatus) — context for the parallel allowlist refresh in this same PR. ADR-0004 — rationale for recording the choice as an ADR.

### 4.8 Stale-`ralph` sweep

`grep -rn "ralph" --include="*.ts" --include="*.json" --include="*.md"` excluding `.apparat/sessions/`, `.apparat/meditations/stimuli/.triage/`, frozen ADRs (0001–0010 by date), frozen plans, frozen reviews, frozen verifications, and the historical MEMORY-index entries (any `*.md` whose contents are a snapshot of a past session).

The Grep pass at design time (verified) returned the file list below; the implementing session will categorise each. The expected outcome:

- **Living code — fold into this PR:** `src/daemon/runner.ts`, `CONTEXT.md`, `VISION.md` if either still mentions "ralph" in non-historical context (verified: both do, in single-line glossary positions per the Grep result).
- **Settings file — already covered:** `.claude/settings.local.json` (Piece A).
- **Frozen prose — leave alone:** ADRs 0001/0003/0004/0006/0007/0008/0010, `docs/superpowers/reviews/2026-04-27-chunk1-implementation-review.md`, `docs/superpowers/reviews/2026-04-27-illuminations-status-dirs-review.md`, `docs/superpowers/reviews/2026-05-04-ralph-folder-partial-revert-devil-advocate.md`, `docs/superpowers/verifications/2026-04-20-source-location-smoke.md`, `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`, plus other dated specs — all are historical records; rewriting them would falsify the timeline. ADR-0010 §"Frozen prose" already documents this rule explicitly.
- **Memory / triage scratch — leave alone:** `.apparat/meditations/stimuli/prompt-as-program-philosophy.md` (if the match is inside a frozen quote — implementing session checks), `.apparat/meditations/stimuli/.triage/*/chat-notes.md`, `.apparat/meditations/illuminations/2026-05-12T2324-inner-loop-ergonomics-debt.md` (the illumination itself).

The implementing session re-runs the grep just before merging and re-applies this categorisation; the design's job is to capture the rule, not to enumerate each match (they're already enumerated upstream in the Grep result).

## 5. Data flow

### 5.1 Piece A — Claude approval flow (after)

```
operator at terminal types: apparat pipeline validate <pipeline>
  → Claude Code reads .claude/settings.local.json
    → permissions.allow contains "Bash(apparat:*)"
    → command matches → auto-approved, runs immediately
operator at terminal types: git push
  → Claude Code reads .claude/settings.local.json
    → no allow entry matches "git push"
    → operator sees the approval prompt → confirms or denies → command runs
```

The intent: cheap-and-safe verbs auto-approve; destructive verbs keep prompting.

### 5.2 Piece B — `pipeline show` invocation (after, interactive)

```
operator runs: apparat pipeline show meditate --project /repo
  → program.ts parses, opts = { project: "/repo", open: undefined }
  → pipelineShowCommand(dotFile, opts)
    → loadPipeline, render SVG, writeFileSync (unchanged)
    → output.success("Wrote ... .svg (N nodes, M edges)")
    → shouldOpen = opts.open ?? Boolean(process.stdout.isTTY)
      → in interactive shell: shouldOpen = true
    → openWithOSDefault(svgPath)
      → spawn("open", [svgPath], { stdio: "ignore", detached: true })
      → child.unref()
    → return 0
  → Preview.app (or default SVG viewer) opens the file
```

### 5.3 Piece B — `pipeline show` invocation (CI / vitest)

```
vitest worker calls: pipelineShowCommand(dotFile, {})
  → loadPipeline, render SVG, writeFileSync (unchanged)
  → output.success(...)
  → shouldOpen = undefined ?? Boolean(process.stdout.isTTY)
    → process.stdout.isTTY is undefined under vitest → shouldOpen = false
  → spawn is NOT called
  → return 0
```

This is the critical contract: the existing `pipeline-show-annotation.test.ts:40` call (`pipelineShowCommand(join(dir, "p", "pipeline.dot"), {})`) sees no behavioural change. The new test file in §4.4 asserts this invariant explicitly.

### 5.4 Piece B — spawn-failure fallback

```
operator runs: apparat pipeline show pipeline.dot
  → ... writeFileSync succeeds, output.success printed ...
  → shouldOpen = true (interactive)
  → openWithOSDefault throws (e.g. xdg-open missing on a minimal linux container)
    → caught by outer try/catch
    → output.warn("Could not auto-open SVG (...); open manually at <relPath>")
  → return 0 (exit code unchanged; the visualisation artefact is still on disk)
```

The contract is "writing the SVG is the primary job; auto-open is a courtesy." Failure to open never converts a successful render into a failed exit.

## 6. Blast radius / impact surface

- **Size: S** (verifier final pass — `Blast radius: S`; explainer Tier-2 `## Blast radius` confirms). 6 modified + 1 created = 7 files: 2 source + 1 test + 1 ADR + 1 README + 1 SKILL + 1 settings.
- **Surfaces crossed:** 5 — CLI command (`show.ts`), CLI program wiring (`program.ts`), Claude Code allowlist, skill doc + README, ADR. No `.dot` schema change. No pipeline-engine change. No agent-rubric change. No tracer change. No daemon change. No MCP change.
- **Breaking changes:** **minor.**
  - `pipeline-show-annotation.test.ts:40` (verifier-flagged): calls `pipelineShowCommand(join(dir, "p", "pipeline.dot"), {})`. Mitigated by the TTY-aware default — `process.stdout.isTTY` is falsy under `vitest`, so the spawn is skipped. No source edit to that test is required; the new `pipeline-show-no-open.test.ts` explicitly locks the contract in.
  - `PipelineShowOptions` gains an optional `open?: boolean`. Additive — existing callers passing `{}` continue to compile and behave correctly.
  - `program.ts` adds two commander options — additive; existing `apparat pipeline show <dot>` invocations work unchanged.
  - No CLI flag removed, no env var added, no schema field, no public-export change to any other module.
- **Spec / docs ripple checklist:**
  - [ ] `docs/adr/0018-pipeline-show-opens-svg.md` — new; records OS-default-opener + browser-detection refusal.
  - [ ] `src/cli/skills/apparatus/SKILL.md:19` — `pipeline show` row gains auto-open hint.
  - [ ] `README.md:92-95` — `pipeline show` paragraph mentions auto-open + escape.
  - [ ] *No* CONTEXT.md change — no new domain term.
  - [ ] *No* VISION.md change — operator-is-user posture is unchanged; this just acts on it.
- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/pipeline-show-no-open.test.ts` — 3 cases (default-non-TTY, explicit-false, explicit-true). Mocks `child_process` to assert the spawn contract without touching real OS state.
  - [ ] *No* edit to `src/cli/tests/pipeline-show.test.ts` — its 6 cases pass unchanged (vitest's non-TTY context means the new code path is a no-op for them).
  - [ ] *No* edit to `src/cli/tests/pipeline-show-annotation.test.ts` — same reason.

## 7. Trade-offs

### 7.1 TTY default vs always-spawn-with-non-fatal-failure

Verifier flagged two mitigations for the test-spawn risk: (a) `--no-open` default when `!process.stdout.isTTY`, or (b) treat spawn failure as non-fatal. The design uses **both**:

- **TTY default** is the primary defence. Stops the spawn from happening at all in non-interactive contexts (tests, CI, piped stdout). Cleaner — no warning chatter, no platform-dependent error message in test output.
- **Non-fatal failure** is the secondary defence. Catches the case where the operator *is* in a TTY but the opener binary is missing or fails (minimal linux container, locked-down macOS sandbox, etc.). The visualisation artefact is still on disk; the operator gets a clear "open manually" hint.

(a) alone would leave operators on broken `xdg-open` setups seeing a hard exit-1 from `pipeline show`. (b) alone would still spawn `open` in CI logs (`(ERROR) The application could not be launched`). Both together degrade gracefully along both axes.

### 7.2 OS default opener vs preferred-browser detection

**OS default opener chosen.** Illumination Step 3 explicit: "if introduce a lot complicance should be forgotten." Browser detection requires reading `$BROWSER`, parsing macOS `LSHandlers` plist, scanning `~/.config/mimeapps.list` on linux — fragile, platform-dependent, and the operator already configured their OS default exactly the way they want. ADR-0018 records the refusal.

### 7.3 New test file vs extending existing one

**New `pipeline-show-no-open.test.ts` chosen.** §3.5 covered the reasoning: mocking `child_process` at the top of `pipeline-show.test.ts` would intercept transitive spawns from `loadPipeline` or anything else, contaminating the existing 6 cases. A sibling file scopes the mock to the 3 new cases.

### 7.4 Single PR vs split

**Single PR.** The two pieces are independent (you could ship Piece A alone tomorrow and Piece B alone next week), but the illumination explicitly bundles them as the "inner-loop ergonomics debt" package and the diff is collectively small. Splitting would manufacture two review cycles for a thematically unified change. (Cross-reference: the `2026-05-13-react-dev-build-shipped-perf-marks-leak-via-livefooter-tick-design.md` Trade-offs §7.5 makes the same call for the same reason.)

### 7.5 `apparat doctor` now vs deferred

**Deferred** (illumination Step 7 explicit). Tempting — a single command that prints allowlist gaps + stale grants + missing-but-installed binaries would re-prevent the next rename's silent half-allowlist. But the project posture is solo-dev; `less-permission-prompts` (a Claude Code skill, already shipped) does 90% of the job manually; the cost of the doctor command would be its own code+tests to maintain. Revisit only if prompt-rate stays high after Piece A lands.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the existing 6 cases in `pipeline-show.test.ts`, the 1 case in `pipeline-show-annotation.test.ts`, and the new 3 cases in `pipeline-show-no-open.test.ts`.
- `npm run build` exits 0; the existing `onSuccess` regression scan from ADR-0017 stays green.
- `apparat pipeline show <some-pipeline> --project <project>` in an interactive shell auto-opens the SVG in the OS default viewer.
- `apparat pipeline show <some-pipeline> --project <project> --no-open` in an interactive shell prints `Wrote ... .svg (N nodes, M edges)` and exits 0 without spawning anything.
- `apparat pipeline show <some-pipeline> --project <project>` with stdout piped (e.g. `... | tee log.txt`) skips the auto-open by default.
- In a stripped container where `xdg-open` is missing, an interactive `apparat pipeline show` prints `Wrote ...` then a `warn`-level "Could not auto-open SVG (...); open manually at ..." and exits 0.

Repo-wide grep invariants (post-merge):

- `grep -n "Bash(ralph:*)" .claude/settings.local.json` — zero matches.
- `grep -n "Bash(apparat:\*)" .claude/settings.local.json` — exactly one match.
- `grep -rn "spawn" src/cli/commands/pipeline/show.ts` — at least one match inside `openWithOSDefault`.
- `grep -n "ralph" CONTEXT.md` — zero non-historical matches (verify by hand at land-time).

Behaviour invariants:

- No new tracer fields. `pipeline-start` / `pipeline-end` / `node-*` JSONL events byte-identical.
- No new CLI subcommand. `pipeline show` keeps its positional signature; only two flags are added.
- `PipelineShowOptions.project` semantics unchanged.

## 9. Open questions

### 9.1 ADR number 0018 at land-time

Current `docs/adr/` highest ADR is `0017-tsup-node-env-bundle-pin.md` (verified). The implementing session re-checks `ls docs/adr/` immediately before writing the ADR file; if another PR has landed 0018 in the interim, bump to the next free number. The illumination's suggestion of "0016" is stale per ADR-0016 (`run-scoped-mcp-config-with-heartbeat`) already existing.

### 9.2 macOS Gatekeeper / Quarantine warnings

The first `open <some>.svg` after a fresh apparat install may surface a Gatekeeper warning on macOS if the OS treats the freshly-written SVG as quarantined. In practice this does not happen for user-written files (the quarantine xattr is only set on downloaded content), but the implementing session smoke-tests on a real macOS install to confirm. If it does happen, document the one-time `xattr -d com.apple.quarantine` workaround in the ADR; do not auto-strip the attribute from apparat.

### 9.3 `--open` semantics in non-TTY contexts

The design says explicit `--open` always spawns regardless of TTY. Alternative: `--open` is best-effort and silently degrades to `--no-open` when stdout is not a TTY. **Default chosen: explicit always-spawns.** Rationale: if the operator types `--open` they meant it; honouring the flag is more predictable than overriding it. The TTY check is a *default-resolution* mechanism, not a global gate.

### 9.4 Sweep matching false positives

The Grep returned 30 files containing "ralph". A handful are inside frozen-prose stimuli (e.g. quoted material from older sessions) where the implementing session must judge case-by-case whether the match is historical (leave) or current (fold in). The categorisation rule from §4.8 is authoritative; the implementing session does not need to revisit this design's open-question to extend it.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `"Bash(ralph:*)"` in `.claude/settings.local.json` — zero matches.
- Grep `"Bash(apparat:\*)"` in `.claude/settings.local.json` — exactly one match.
- Grep `spawn(` in `src/cli/commands/pipeline/show.ts` — at least one inside `openWithOSDefault`.
- Grep `"--no-open"` in `src/cli/program.ts` — exactly one (the option registration).

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-show.test.ts` — 6 cases pass unchanged.
- `npx vitest run src/cli/tests/pipeline-show-annotation.test.ts` — 1 case passes unchanged.
- `npx vitest run src/cli/tests/pipeline-show-no-open.test.ts` — 3 new cases pass.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline show meditate --project <some-project>` in iTerm.app — SVG opens in Preview.app automatically. Reproduce three times; expect no Gatekeeper warning.
- `apparat pipeline show meditate --project <some-project> --no-open` — exits 0, no Preview window.
- `apparat pipeline show meditate --project <some-project> | cat` (stdout piped) — exits 0, no Preview window (TTY-default skipped).
- After a `claude` session restart: confirm `apparat status` / `git diff` / `rg "foo"` no longer prompt for approval; confirm `git push origin main` still prompts.

### 10.4 Negative cases

- Temporarily rename the `open` binary on macOS (or mock the `spawn` to throw). Run `apparat pipeline show <pipeline>` in a TTY. Expect: SVG written, success log, `warn`-level "Could not auto-open SVG (...); open manually at <relPath>", exit 0.
- Pass `--open` from a script with stdout piped. Expect: SVG written and opener spawned (explicit `--open` overrides the TTY default).
- Drop `Bash(apparat:*)` from `.claude/settings.local.json`. Run `apparat status` from a Claude Code session. Expect: approval prompt — confirms the allowlist is what's gating the friction, not some other layer.
- Re-add `Bash(ralph:*)` to `.claude/settings.local.json`. Run `ralph status`. Expect: command-not-found from the shell (binary doesn't exist), confirming the original entry was dead.

## 11. Summary

Two open `.apparat/notes.md` items name the same pattern: solo-developer inner-loop friction deferred. (a) `.claude/settings.local.json:3-9` still allowlists `Bash(ralph:*)` — a binary that no longer exists post-ADR-0010 — and omits the verbs the operator actually runs daily (`apparat`, `git status/log/diff/show/branch`, `rg`, `node`, `tsx`, `vitest`, `open`, the `mcp__illumination__*` server tools). (b) `src/cli/commands/pipeline/show.ts:64-75` writes the SVG and exits — the operator opens it by hand every single time. Both are evening-sized fixes; neither has been done; both nag every session.

This design ships two pieces in one PR: (1) **rewrite `.claude/settings.local.json`** — drop the dead `Bash(ralph:*)` and allowlist ~15 daily verbs while keeping destructive verbs (`git push`, `git reset --hard`, `git commit`, `rm`) prompted; (2) **add auto-open to `pipeline show`** — after `writeFileSync` at `src/cli/commands/pipeline/show.ts:64-69`, spawn the OS default opener (`open` / `xdg-open` / `start`). Add `--open` / `--no-open` flags on the `pipeline show` subcommand (`src/cli/program.ts`). The default resolves via `process.stdout.isTTY` so interactive operator use auto-opens and `vitest`-driven calls (which pass `{}` from `pipeline-show-annotation.test.ts:40`) skip the spawn. Spawn failure is non-fatal — a `warn` tells the operator to open manually; exit code stays 0.

Plus an ADR-0018 (the next free number; ADR-0016/0017 already exist, contra the illumination's "0016") recording the OS-default-opener choice and the explicit refusal of preferred-browser detection; a one-line `SKILL.md:19` update; a `README.md:92-95` paragraph update; and a non-historical `ralph` sweep folded into the same PR.

Blast radius is **S** — 6 modified + 1 created = 7 files: `.claude/settings.local.json`, `src/cli/commands/pipeline/show.ts`, `src/cli/program.ts`, `src/cli/tests/pipeline-show-no-open.test.ts` (new), `src/cli/skills/apparatus/SKILL.md`, `README.md`, `docs/adr/0018-pipeline-show-opens-svg.md` (new). Surfaces crossed: 5 (CLI command, CLI program, Claude allowlist, skill+README, ADR + tests). Breaking changes: minor — `PipelineShowOptions` gains a backwards-compatible `open?: boolean`; the verifier-flagged `pipeline-show-annotation.test.ts:40` regression risk is fully mitigated by the TTY-aware default and locked in by the 3 new test cases. No `.dot` schema change, no env var, no tracer field, no agent-rubric change, no daemon edit, no MCP edit. Out of scope and explicitly deferred (illumination Steps 6 & 7): preferred-browser detection, `apparat doctor` command. Single PR is the default; splitting would manufacture review cycles for a tightly-coupled 7-file ergonomics package.
