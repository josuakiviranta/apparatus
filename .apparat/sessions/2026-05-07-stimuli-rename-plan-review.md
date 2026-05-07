# Plan Review — 2026-05-07-stimuli-rename-and-project-local-only

**Reviewer:** Senior code reviewer (Claude Opus 4.7)
**Plan:** `docs/superpowers/plans/2026-05-07-stimuli-rename-and-project-local-only.md`
**Spec:** `docs/superpowers/specs/2026-05-07-stimuli-rename-and-project-local-only-design.md`

## Verdict

**Issues Found** — 1 blocker, 3 important, 2 nits. None fatal to design intent; all are mechanical line-number / TDD-ordering corrections that keep the plan from misfiring during execution.

## Strengths (acknowledge first)

- Spec coverage is complete: every files-touched bucket in §3.7 maps to a Task. Every acceptance gate in §7 maps to a step in Chunk 4.
- The atomic-commit framing in Chunk 2 is correctly motivated (server `argv[3]` ↔ frontmatter coupling = silent-runtime failure if split). Big-bang is the right call here.
- TDD discipline is real: Task 2.1, 2.2, 2.3, 2.5 explicitly require red-then-green. The plan even pins the `argv` test against the bundled `argv` literal so the diff is observable.
- Grep gates in Task 2.8 + 4.1 give a clean machine-checkable end state.

## Issues

### 1. BLOCKER — Task 2.5 line range for `describe("listMetaMeditations")` is wrong

Plan claims (line 262): "Replace the entire `describe(\"listMetaMeditations\", ...)` block (around lines 398–431)" — those lines match.
Plan claims (line 313): "Replace the existing block (around lines 433–454)" for `readMetaMeditation` — matches.

Both are correct on the **current** repo state. Good.

But Task 2.5 Step 2's old `describe("listMetaMeditations")` block has tests that pass `tmpDir` directly (e.g. `writeFileSync(join(tmpDir, "b-lens.md"))` then `listMetaMeditations(tmpDir)`). The plan's replacement block changes the contract: tests now seed at `<tmpDir>/.apparat/meditations/stimuli/` and call `listStimuli(tmpDir)` where `tmpDir` is the project root. That is correct given the new signature.

However: **Task 2.5 Step 4 expects "FAIL with `No matching export ... listStimuli`"**, but at that point the tests will fail at *import time* before any `it` runs. Vitest reports an unresolved-import compile error, not a per-test assertion. The plan's expected-failure message ("or equivalent") covers this loosely, but it means **Step 4 will not produce 9 individually-failing tests** — it produces 1 module-load error. Anyone driving the plan from a TDD-discipline lens will misread this as "the new tests are not yet wired" and may try to debug. Tighten Step 4 to: "expected: vitest reports module-load failure on the `listStimuli` import — this is the intended red-state for the file as a whole".

Severity: blocker for execution clarity (false-negative TDD signal), trivial fix.

### 2. IMPORTANT — Task 2.7 Step 2 sequencing breaks TDD ordering

Step 1 edits `assets.test.ts` to drop `getMetaMeditationsDir` from the import. Step 5 deletes the actual function from `assets.ts`. Step 2 runs the test in between — which the plan correctly predicts will *pass* (the import was already removed). So Step 2 is not red, it's green-by-vacuum.

Then Step 3 edits `agent-handler.test.ts` to drop the `META_MEDITATIONS_DIR` assertion and add `not.toHaveProperty("META_MEDITATIONS_DIR")`. At this moment, `assets.ts:getMetaMeditationsDir()` and `agent-prep.ts:META_MEDITATIONS_DIR` both still exist. The new `not.toHaveProperty` assertion will **fail red** as desired — but the plan never says to run it. Step 8 only runs after the whole code change lands.

Likewise, Step 4's edit to `graph-validator-inputs.test.ts` would fail red (the validator's `SYSTEM_INJECTED_VARS` still contains `META_MEDITATIONS_DIR`, so removing it from the inputs list does not change the diagnostic outcome — but the test name and inputs literal change, which would be a no-op pass. So this one is also green-by-vacuum.).

Recommendation: insert a "run the failing test now" step after Step 3 to demonstrate red, then a re-run after Step 6 to confirm green. This is a 1-minute addition and lifts the chunk from "tests-edited-then-code-edited" to true red-green.

Severity: important — a TDD reviewer reading the diff later cannot verify red-state happened.

### 3. IMPORTANT — Task 2.6 Step 1 import-line replacement is non-unique

Plan instructs: replace `import { illuminationsDir } from "../lib/apparat-paths.js";` with `import { illuminationsDir, stimuliDir } from "../lib/apparat-paths.js";`.

I confirmed line 6 of `illumination-server.ts` matches verbatim. Edit will succeed.

But **Task 2.6 Step 5** says replace:
```
const projectRoot = process.argv[2];
const meditationsDir = process.argv[3] ?? "";
```
with `const projectRoot = process.argv[2];`. That is in the `if (!isTestEnv) { ... }` body at line 307–308. The plan does not pin the surrounding context. If Step 2 (rewriting the sentinel constant block) or Step 3 (rewriting `listMetaMeditations`) shifts line counts by adding/removing lines, the Edit's `old_string` is still unique by content but the file:line annotation in the plan header (`src/cli/mcp/illumination-server.ts:6, 163-182, 247-255, 308, 410-430`) becomes stale.

Recommendation: drop the line-number annotations from the **Files** header on Task 2.6 — they will be wrong after Step 2 lands. Replace with "see steps for surgical edits". The Edit tool's content-based matching is robust; the line numbers are decorative noise that ages badly in mid-chunk.

Severity: important — line numbers in the plan header lie after the first edit in the chunk.

### 4. IMPORTANT — Task 2.7 Step 6's `old_string` may not match exactly

Plan replaces lines 16–28. I read agent-prep.ts: actual content at lines 16–28 is:
```
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
  "META_MEDITATIONS_DIR",
] as const;

function buildSystemInjectedVars(projectRoot: string): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
    META_MEDITATIONS_DIR: getMetaMeditationsDir(),
  };
}
```

This is lines 16–28 exactly. Edit will succeed. Good.

But the plan annotation `src/attractor/handlers/agent-prep.ts:6, 19, 26` in Task 2.7's Files header is misleading — line 19 is `META_MEDITATIONS_DIR` (correct in current file), line 26 is `META_MEDITATIONS_DIR: getMetaMeditationsDir(),` (correct). Only line 6 is the import. Acceptable, but inconsistent with the actual edit which spans 16–28. Tighten: write the header as `src/attractor/handlers/agent-prep.ts (lines 6 + 16–28)`.

Severity: important — minor but adds confusion if a reviewer cross-reads the bullet against the diff.

### 5. NIT — Smoke-test in Chunk 4 Step 5 uses `init` correctly

Plan: `node dist/cli/index.js init "$TMP"`. Verified `src/cli/program.ts:90` registers `init [project-folder]` and `src/cli/commands/init.ts:14` exports `initCommand`. The build outputs to `dist/cli/index.js` per `package.json:bin`. This will work.

Note: the directory expected (`.apparat/meditations/stimuli/`) is created by `init.ts:19` (`stimuliDir(projectRoot)` is in the `dirs` array). So `ls "$TMP/.apparat/meditations/stimuli/"` will succeed and show empty. Good.

Severity: nit — confirming the spec's smoke-test claim is real.

### 6. NIT — `parseIlluminationDescription` is private in current code

Plan's Task 2.6 Step 3 keeps `parseIlluminationDescription` as the description extractor. That function is currently *not exported* (`src/cli/mcp/illumination-server.ts:186`). The new `listStimuli` calls it from the same module, so no export is needed. Confirmed.

Severity: nit — the spec's "shared parser" hidden assumption holds; same module = same scope.

## Spec-vs-plan coverage matrix (spot-checked)

| Spec §3.2 deletion | Plan task | Status |
|---|---|---|
| `getMetaMeditationsDir()` from `assets.ts:40-47` | Task 2.7 Step 5 | covered |
| `META_MEDITATIONS_DIR` from `SYSTEM_INJECTED_VARS` | Task 2.7 Step 6 | covered |
| `meditate.test.ts` lines 161–162 | Task 2.2 Step 1 | covered |
| `meditate.md` `META_MEDITATIONS_DIR` arg | Task 2.4 Step 2 | covered |
| `illumination-server.ts` `argv[3]` | Task 2.6 Step 5 | covered |
| `assets.test.ts` lines 11–18 | Task 2.7 Step 1 | covered |
| `agent-handler.test.ts:196` | Task 2.7 Step 3 | covered |
| `graph-validator-inputs.test.ts:284–290` | Task 2.7 Step 4 | covered |
| `package.json:files` `meditations` | Task 1.1 Step 3 | covered |

| Spec §4.1 test addition | Plan task | Status |
|---|---|---|
| `listStimuli` with seed | Task 2.5 Step 2 | covered |
| `readStimulus` with seed | Task 2.5 Step 3 | covered |
| Sentinel asserts project-path, not npm-global | Task 2.5 Step 2 (last `it`) | covered |
| `meditate.test.ts` mcp.args = exactly 2 | Task 2.1 Step 1 | covered |
| `agent-handler.test.ts` `META_MEDITATIONS_DIR` absent | Task 2.7 Step 3 | covered |

| Spec §7 acceptance gate | Plan task | Status |
|---|---|---|
| `npm run build` | Chunk 4 Step 1 | covered |
| `npx tsc --noEmit` | Chunk 4 Step 2 | covered |
| `npx vitest run` | Chunk 4 Step 3 | covered |
| Greps clean | Chunk 4 Step 4 | covered |
| `apparat init` smoke | Chunk 4 Step 5 | covered |
| Apparat-self meditate loads 32 lenses | Chunk 4 Step 6 (validates pipeline only) | partial — see note |

**Note on the partial gate:** spec §7 last bullet asks for "An `apparat meditate` run against the apparat repo itself loads the 32 lens files unchanged" — a runtime check. Plan's Chunk 4 Step 6 only runs `pipeline validate`, which proves no validator regression but does not prove the MCP server actually reads from `stimuliDir(projectRoot)`. The plan acknowledges this in the "(Optional: a manual `apparat meditate .` run is the final integration check…)" parenthetical. This is acceptable for a single-developer harness — the validator + tests prove the plumbing — but it should be called out explicitly as a deferred manual smoke, not silently skipped.

## Atomic-commit safety analysis (spec §3.9 / plan Chunk 2)

Walked the order:
1. Task 2.1: add new test → red.
2. Task 2.2: edit existing test → red.
3. Task 2.3: add new test → red.
4. Task 2.4: edit `meditate.md` → tests 2.1–2.3 turn green.
5. Task 2.5: edit `illumination-server.test.ts` → red (import fails).
6. Task 2.6: edit `illumination-server.ts` → tests in 2.5 turn green.
7. Task 2.7: edit `assets.ts`, `agent-prep.ts`, three test files → all green.
8. Task 2.8: full-suite verify.

**Mid-chunk build state:** between Task 2.5 and Task 2.6 Step 8, `npx tsc --noEmit` will fail (test imports `listStimuli` which doesn't exist). Between Task 2.7 Step 1 and Step 5, `npx tsc --noEmit` will fail (test no longer imports `getMetaMeditationsDir`, but `agent-prep.ts` still does — so the function still exists, no compile error there; the test compiles fine without the import. Actually safe.).

Between Task 2.6 Step 7 (run new tests) and Task 2.7 Step 1, the suite is in mixed state: new tests pass, but `agent-handler.test.ts:196` still asserts `META_MEDITATIONS_DIR` on a system-injected-vars dict that still contains it — passes. `graph-validator-inputs.test.ts:284-290` still references the old constant — passes. `assets.test.ts:11-18` still passes. So full suite is green here. **Good intermediate state for a panic-stop.**

Between Task 2.7 Step 1 and Step 5: `assets.test.ts` does not import `getMetaMeditationsDir`, the `it()` block referencing it still exists in the file but the variable is undefined → ReferenceError at test runtime → red. The plan's Step 1 instruction says "delete the entire `getMetaMeditationsDir returns a path...` test (lines 11–18)" — but the bullet wording could be misread as "drop import only". Recommend tightening Step 1 wording: "First drop the import, **then** delete the test block" with both as explicit Edit operations.

Severity addressed under Issue #2 above.

## Summary

The plan is structurally sound and faithfully covers the spec. Fixing the 4 numbered issues above turns it into an executable plan that preserves true red-green TDD signals end to end. The atomic-commit walk in Chunk 2 holds — no intermediate state breaks `tsc` once the chunk completes its arc, and the only mid-chunk failures are the deliberate red phases.

Recommend **revising before execution**, mainly to:
1. Tighten Task 2.5 Step 4's expected-failure description.
2. Insert explicit red-state runs in Task 2.7 between test edits and code edits.
3. Drop or correct line-number annotations on Task 2.6 / 2.7 Files headers (they will be stale after the first Edit in each chunk).
4. Note the deferred manual `apparat meditate .` smoke as explicitly out-of-CI.

After those edits, Approved.
