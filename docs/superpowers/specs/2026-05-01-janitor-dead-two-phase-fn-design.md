# Design: Janitor — Delete the Dead Two-Phase Claude Session Helper

**Date:** 2026-05-01
**Status:** draft (pending review)
**Originating illumination:** `meditations/illuminations/2026-05-01T0212-janitor-dead-two-phase-fn.md`

## 1. Motivation

`src/cli/lib/session.ts` exports a public API — `runTwoPhaseClaudeSession` plus its `TwoPhaseSessionOptions` and `TwoPhaseSessionResult` types — that no shipping command consumes. The helper was scaffolded for `plan` and `new` commands that were never built; today's `src/cli/commands/` directory contains only `heartbeat.ts`, `implement.ts`, `meditate.ts`, and `pipeline.ts`. None of them imports the helper.

Whole-repo verification (per `chat_summarizer.refinements`, Round 1) confirmed the dead-code claim outside `src/`:

```
$ grep -rn runTwoPhaseClaudeSession .
src/cli/lib/session.ts:114:        export async function runTwoPhaseClaudeSession(
src/cli/lib/tests/session.test.ts:28: import { runTwoPhaseClaudeSession } from "../session.js";
src/cli/lib/tests/session.test.ts:32: describe("runTwoPhaseClaudeSession", () => {
src/cli/lib/tests/session.test.ts:59: const result = await runTwoPhaseClaudeSession({ ... })
src/cli/lib/tests/session.test.ts:95: const result = await runTwoPhaseClaudeSession({ ... })
src/cli/lib/tests/session.test.ts:109: const result = await runTwoPhaseClaudeSession({ ... })
src/cli/lib/tests/session.test.ts:122: const result = await runTwoPhaseClaudeSession({ ... })
meditations/illuminations/.triage/.../chat-notes.md
meditations/illuminations/2026-05-01T0212-janitor-dead-two-phase-fn.md
meditations/illuminations/2026-05-01T0255-janitor-dead-scripts.md
meditations/illuminations/2026-05-01T0423-janitor-parallel-handler-yagni.md
```

Zero hits in `pipelines/`, `scripts/`, `docs/`, `package.json`, `tsup.config.ts`, `tsconfig.json`, or any non-test source file. The illumination matches; the only divergence from its original wording is a one-line cosmetic drift (the function body ends at `session.ts:151`, not `:146`).

The expanded scope, per the chat refinements (Round 1, "Blast radius analaysis too for the changes"), is a pure subtraction:

- Three exports defined at `src/cli/lib/session.ts:104-151`.
- Four import bindings at `src/cli/lib/session.ts:1-3` that exist only to feed the dead helper.
- The entire 129-line test file at `src/cli/lib/tests/session.test.ts`, whose single `describe("runTwoPhaseClaudeSession", ...)` block (line 32) covers nothing else.
- A stale planning note in the user's auto-memory `MEMORY.md` (Code Reuse Note: "extract to `lib/claude-session.ts` only when a third command needs it") that describes a future extraction the deletion makes nonsensical.

Every reader of `session.ts` currently pays a cognitive tax decoding a public API with zero consumers. The test file gives false coverage signal: green CI implies the helper works, but no command exercises it. The memory note misleads future planners by pointing at a `lib/claude-session.ts` extraction that, post-deletion, would have nothing to extract.

This change deletes a speculative abstraction. It does not introduce new behavior.

## 2. Decision Summary

1. **Delete the three exports** at `src/cli/lib/session.ts:104-151` — `TwoPhaseSessionOptions`, `TwoPhaseSessionResult`, `runTwoPhaseClaudeSession`.
2. **Delete the four orphaned import bindings** at `src/cli/lib/session.ts:1-3` — `spawn`, `spawnSync` from `child_process`; `streamEvents` from `./stream-formatter.js`; `* as output` from `./output.js`. These appear only inside the dead function (lines 118, 127, 144).
3. **Delete the test file** `src/cli/lib/tests/session.test.ts` whole. Its single `describe("runTwoPhaseClaudeSession", ...)` block plus mocks support only the dead helper. Live `Session` coverage already lives at `src/cli/tests/session.test.ts` (separate file).
4. **Remove the stale Code Reuse Note** from the user's auto-memory `MEMORY.md` so future planners do not inherit a reference to an extraction that no longer applies.

Out of scope:

- The `Session` class (`src/cli/lib/session.ts:53-102`), `buildSessionDigest` (`src/cli/lib/session.ts:153-167`), and the surrounding type exports (`Turn`, `ToolCall`, `Usage`, `ExitReason`, `InteractiveSessionDigest`, lines 5-51).
- Any change to `heartbeat.ts`, `implement.ts`, `meditate.ts`, `pipeline.ts`, or daemon entry points.
- Peer-pointer illuminations `2026-05-01T0255-janitor-dead-scripts.md` and `2026-05-01T0423-janitor-parallel-handler-yagni.md` — they reference the dead helper as cross-context, not as consumers (chat refinements, Round 1, "Cross-referencing illuminations remain standalone").
- Re-introducing the helper inline in any future `plan` or `new` command. If/when those commands ship, they implement two-phase spawn inline; extraction waits for a third caller (the historical KISS rationale, now applied as policy rather than as scaffolded code).

## 3. Architecture

### 3.1 Current vs target shape of `session.ts`

**Current** (`src/cli/lib/session.ts`):

```
Lines 1-3:    imports — { spawn, spawnSync }, streamEvents, * as output  ← used only by dead fn
Lines 5-51:   type exports — Turn, ToolCall, Usage, ExitReason, InteractiveSessionDigest
Lines 53-102: Session class — used by InteractiveSession + chat infra
Lines 104-112: TwoPhaseSessionOptions, TwoPhaseSessionResult interfaces  ← DEAD
Lines 114-151: runTwoPhaseClaudeSession async function                    ← DEAD
Lines 153-167: buildSessionDigest function — used by chat infra
```

**Target**:

```
Lines 1-N:    type exports — Turn, ToolCall, Usage, ExitReason, InteractiveSessionDigest  (unchanged content)
Lines N+:     Session class                                              (unchanged)
Lines N+:     buildSessionDigest function                                (unchanged)
```

No imports remain at the top of the file because the surviving exports are pure value-/type-only definitions with no runtime dependencies. (`Turn` references no external types; `Session` and `buildSessionDigest` operate only on the file's own types.) Verification post-edit: `grep` the new file for `child_process`, `stream-formatter`, `output.js` — all four bindings should be absent.

### 3.2 Why the test file deletes whole

`src/cli/lib/tests/session.test.ts` opens with three `vi.mock` calls (`./output.js`, `./stream-formatter.js`, `child_process`) at lines 3-26. All three exist solely to stub the spawn/stream surface that `runTwoPhaseClaudeSession` exercises. The single `describe` block at line 32 contains four `it` cases — happy path, phase-1 fail, no session id, phase-2 non-zero exit — each of which calls `runTwoPhaseClaudeSession` directly. Removing only the `describe` block would orphan the three mocks and the imports at lines 28-30. Deleting the file is the smallest coherent change.

The `Session` class continues to be tested at `src/cli/tests/session.test.ts` (separate path under `src/cli/tests/`, not `src/cli/lib/tests/`). Confirmed by Glob: both files exist independently. The live test asserts `Session.lastAssistantText`, `turnsUsed`, etc. (lines 1-30 inspected). No coverage gap is introduced by the deletion.

### 3.3 Memory-note removal

The note lives in the user's auto-memory `MEMORY.md` (path: `~/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/MEMORY.md`) under the section "Code Reuse Note":

> The two-phase Claude session logic (non-interactive kickoff → parse session ID → interactive resume) is duplicated in `plan.ts` and will be duplicated again in `new.ts`. This is intentional for now — extract to `lib/claude-session.ts` only when a third command needs it.

This note is stale on two axes: (1) `plan.ts` and `new.ts` were never built, so the "duplicated" framing is false; (2) the helper it points at as the extraction target is being deleted. The remediation removes the note rather than rewriting it — the underlying topic no longer warrants a memory entry, and any future revival of two-phase logic should be reasoned about fresh, not against a record of a speculative abstraction that was already tried and removed.

## 4. Components & file edits

### 4.1 Source code

| File | Change |
|---|---|
| `src/cli/lib/session.ts:1-3` | Remove the three import statements. After the edit, the file begins directly with the `Turn` type alias on what was line 5. |
| `src/cli/lib/session.ts:104-112` | Remove the two interface declarations (`TwoPhaseSessionOptions`, `TwoPhaseSessionResult`). |
| `src/cli/lib/session.ts:114-151` | Remove the `export async function runTwoPhaseClaudeSession` declaration in full, including its body. |

After edits, `session.ts` exports: `Turn`, `ToolCall`, `Usage`, `ExitReason`, `InteractiveSessionDigest`, `Session`, `buildSessionDigest`. Nothing else changes.

### 4.2 Tests

| File | Action |
|---|---|
| `src/cli/lib/tests/session.test.ts` | Delete the file in full. |

The directory `src/cli/lib/tests/` may end up empty after the deletion. If so, leave the empty directory untouched — git will not track it, and a future test in this layer can recreate as needed. (Verification step in §9: `ls src/cli/lib/tests/` after the change to confirm whether other files exist there.)

### 4.3 Memory

| File | Action |
|---|---|
| `~/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/MEMORY.md` | Remove the "Code Reuse Note" paragraph quoted in §3.3. The surrounding section headers (currently "## `ralph new` Command Design") remain; only the dedicated "Code Reuse Note" sub-block goes. |

This file lives outside the repo and is not version-controlled with `ralph-cli`; the implementation plan handles it as a separate manual step. No git operation reflects this change.

## 5. Data flow

No runtime data flow is affected. The dead helper had two flows:

- **Phase-1**: `spawn("claude", ["-p", trigger, "--output-format", "stream-json", "--dangerously-skip-permissions"])` → captures `sessionId` via `streamEvents` → resolves on child `close`.
- **Phase-2**: if phase-1 exited 0, `spawnSync("claude", ["--dangerously-skip-permissions", "--resume", sessionId])` with `stdio: "inherit"`.

Neither flow runs in any current command. Removing them removes nothing the user can observe. The `Session` class, which models in-memory chat state for the live `InteractiveSession` machinery, is independent of these flows and continues to function.

## 6. Trade-offs

### 6.1 Risk: a future `plan` or `new` command will need two-phase logic and have to re-derive it

If `ralph plan <p>` or `ralph new <name>` is later built and follows the same shape (non-interactive kickoff → resume interactively), its author will have to write spawn/spawnSync calls inline rather than importing the helper.

**Accepted because:** the helper is ~37 lines of mostly straightforward `spawn`/`spawnSync` glue. Inlining once costs the same as importing. Inlining twice is the YAGNI threshold the project's own memory note already endorsed (extract on the *third* caller). Until a third caller exists, the helper's existence is the more expensive option (cognitive tax on every reader of `session.ts`).

### 6.2 Risk: deleting the test file lowers raw coverage numbers

CI coverage drops by however much `runTwoPhaseClaudeSession` and its 4 `it` cases contribute. No metric threshold is enforced today, so this is informational only.

**Accepted because:** the lost coverage was for code that nothing executes outside the test file itself. Coverage of dead code is misleading signal. Net signal-to-noise improves.

### 6.3 Risk: the `output.step` and `streamEvents` exports lose a consumer

`output.step` and `streamEvents` are still exported from their respective modules and used elsewhere in the codebase (the `streamEvents` symbol in particular is the heart of `loop.ts` stream rendering). Removing the import from `session.ts` does not affect those modules' public surface.

**Verification step (§9):** grep `streamEvents` and `output.step` whole-repo after the edit to confirm they retain consumers. Expected: both still appear in `src/cli/lib/loop.ts` and other live call sites.

## 7. Constraints

- The three import statements at `session.ts:1-3` must be removed *together*. Removing only one or two leaves an unused import that the project's lint rule (or `tsc --noEmit` with `noUnusedLocals`) would flag.
- The two interface declarations at `:104-112` must be removed *with* the function declaration at `:114-151`. The interfaces have no other consumer; leaving them strands two more dead exports.
- The test file deletion must be a single `git rm` — not a partial edit. Mocks at lines 3-26 cannot survive without their consumer.
- `npm run build` must succeed after edits. The `tsup` bundle does not currently special-case `session.ts`; the build verifies type-cleanliness implicitly.
- `npx tsc --noEmit` must pass. With `noUnusedLocals` (if enabled), an incomplete edit would fail here first.

## 8. Open questions

1. **Should `src/cli/lib/tests/` be removed if it becomes empty?** Leaving an empty directory is harmless (git ignores it) but slightly noisy on a fresh checkout. The implementation plan can decide based on what other files (if any) live in that directory at edit time.
2. **Is the `MEMORY.md` note removal in scope for the same PR, or a follow-up?** The note lives outside the repo and outside CI's reach. Treating it as a same-session manual step (per the plan's Step N) keeps the change atomic from the contributor's perspective; a strict reading of "PR scope = repo files only" would defer it. The design records the intent; the plan operationalizes it.

## 9. Verification approach

### 9.1 Static checks

Run after each edit, in order:

- `npx tsc --noEmit` — confirms no dangling references and no unused locals (the import deletions are the most likely failure surface).
- `grep -rn runTwoPhaseClaudeSession src/` — expected: zero hits in `src/`. Hits in `meditations/` are ignored (illumination corpus).
- `grep -rn TwoPhaseSessionOptions src/` and `grep -rn TwoPhaseSessionResult src/` — expected: zero hits.
- `grep -n "from \"child_process\"\|streamEvents\|from \"./output.js\"" src/cli/lib/session.ts` — expected: no matches (all three imports gone).
- `grep -rn "streamEvents" src/`, `grep -rn "output.step" src/`, and `grep -rn "output.stream" src/` — expected: all three still present in `src/cli/lib/loop.ts` and other live consumers (regression check on §6.3; the dead helper used `output.stream` at the old `:126` and `output.step` at the old `:139`, both via the `* as output` binding being removed).

### 9.2 Tests

- `npx vitest run src/cli/tests/session.test.ts` — `Session` class tests pass unchanged.
- `npx vitest run` — full suite passes. The deleted file's cases are gone; no other test imports from it.

### 9.3 Build

- `npm run build` — `tsup` produces a dist with the same set of `bin` entries (`ralph`) and no error.
- `node dist/cli/index.js --help` (or `ralph --help` if linked) — top-level help output is unchanged. No command surface change is intended or expected.

### 9.4 Memory hygiene

- After the manual `MEMORY.md` edit, re-grep the file for `runTwoPhaseClaudeSession` and `claude-session.ts` — both should be absent. The Memory Index table at the bottom remains intact; only the "Code Reuse Note" paragraph in the `ralph new` Command Design section is removed.

## 10. Summary

Three exports go, four imports go, one test file goes, one stale memory note goes. The bundled `ralph` CLI behaves identically before and after — `heartbeat`, `implement`, `meditate`, and `pipeline` never touched the deleted code path. The win is structural: `session.ts` becomes a file whose every export has at least one production caller, and a future reader who walks the import graph from `src/cli/index.ts` reaches every line that ships, with no detour through speculative scaffolding.
