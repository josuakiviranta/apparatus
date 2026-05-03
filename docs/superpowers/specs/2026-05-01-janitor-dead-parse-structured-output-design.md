# Design: Janitor — Delete the Dead `parseStructuredOutput` Helper

**Date:** 2026-05-01
**Status:** draft (pending review)
**Originating illumination:** `meditations/illuminations/2026-05-01T0921-janitor-dead-parse-structured-output.md`

## 1. Motivation

`src/cli/lib/parse-structured-output.ts` exports a single function — `parseStructuredOutput(rawText: string): unknown[]` — that no shipping code consumes. The only importer in the repo is the matching test file `src/cli/lib/parse-structured-output.test.ts`. Production extraction of structured agent output runs entirely through `evaluateAgentOutput` in `src/attractor/handlers/evaluate-agent-output.ts`, which is imported and called by `src/attractor/handlers/agent-handler.ts`.

Whole-repo verification (per `chat_summarizer.refinements`, Round 1) confirms the dead-code claim. A grep for `parseStructuredOutput|parse-structured-output` across `**/*.{json,md,ts,js,dot,yaml,yml}` returns hits only in:

- the module itself — `src/cli/lib/parse-structured-output.ts:5`
- its sole importer test — `src/cli/lib/parse-structured-output.test.ts:2`
- the originating illumination and the chat-notes triage doc

Zero hits in `src/attractor/`, `pipelines/`, `scripts/`, `package.json`, `tsup.config.ts`, or any non-test source file. No dynamic import, no `.dot` pipeline reference, no bundler entry. The orphan is unreachable from any live code path.

The matching live path stays untouched. `src/attractor/handlers/agent-handler.ts:14` declares `import { evaluateAgentOutput } from "./evaluate-agent-output.js";`, and the function is invoked at `src/attractor/handlers/agent-handler.ts:260` (first attempt) and `src/attractor/handlers/agent-handler.ts:289` (retry path). `evaluateAgentOutput` itself, defined at `src/attractor/handlers/evaluate-agent-output.ts:16`, performs JSON extraction via the file-private `extractResultPayload` at `src/attractor/handlers/evaluate-agent-output.ts:86`. None of that touches `parse-structured-output.ts`.

Every reader of `src/cli/lib/` currently pays a cognitive tax decoding a public helper with zero consumers. The matching `*.test.ts` filename amplifies the harm: green CI implies authoritative coverage of a live feature, when in fact the suite only exercises a dead module against itself. The `2026-05-01T0212-janitor-dead-two-phase-fn.md` cleanup already shipped against the exact same pattern (dead export with test-only importer); this design applies the same playbook to the second instance.

This change deletes a speculative helper. It does not introduce, modify, or relocate any behavior.

## 2. Decision Summary

1. **Delete `src/cli/lib/parse-structured-output.ts`** in full. The file declares only the single export `parseStructuredOutput` (lines 5–29) plus its leading docstring (lines 1–4). Nothing else lives in the file.
2. **Delete `src/cli/lib/parse-structured-output.test.ts`** in full. The file imports `parseStructuredOutput` from the deleted module (line 2) and contains a single `describe("parseStructuredOutput", ...)` block (line 4) covering 7 `it` cases. Removing the production module orphans every assertion in the file.

Out of scope (locked by `$chat_summarizer.refinements` Round 1 "Scope stays at verifier's original two files; no broader refactor"):

- Any change to `src/attractor/handlers/evaluate-agent-output.ts` or `src/attractor/handlers/agent-handler.ts`. The live JSON-extraction path stays bit-for-bit identical.
- Extracting `extractResultPayload` (`src/attractor/handlers/evaluate-agent-output.ts:86`) into a shared helper. The illumination explicitly defers that to "if/when JSON extraction is needed outside `evaluate-agent-output.ts`"; today, no second caller exists.
- Touching neighboring files in `src/cli/lib/` (e.g. `session.ts`, `loop.ts`, `stream-formatter.ts`).
- Memory hygiene. Unlike the sibling `2026-05-01T0212-janitor-dead-two-phase-fn` cleanup, no `MEMORY.md` note pins this helper as a planned extraction target — `parse-structured-output.ts` is not referenced anywhere in the user's auto-memory. Verified via Grep.

## 3. Architecture

### 3.1 Current shape

```
src/cli/lib/
├── parse-structured-output.ts        ← DEAD (29 lines, single export)
├── parse-structured-output.test.ts   ← DEAD (45 lines, 8 it cases)
└── …other helpers (session.ts, loop.ts, stream-formatter.ts, …)  ← unaffected
```

Function signature, verbatim from `src/cli/lib/parse-structured-output.ts:5`:

```ts
export function parseStructuredOutput(rawText: string): unknown[] {
```

Sole importer, verbatim from `src/cli/lib/parse-structured-output.test.ts:2`:

```ts
import { parseStructuredOutput } from "./parse-structured-output.js";
```

### 3.2 Target shape

```
src/cli/lib/
└── …other helpers (unchanged)
```

Both files are removed. No new file, no rename, no surrounding edit. The directory continues to host its remaining helpers.

### 3.3 Live JSON-extraction path (unaffected, documented for confidence)

The path that actually runs in production remains:

- `src/attractor/handlers/agent-handler.ts:14` — `import { evaluateAgentOutput } from "./evaluate-agent-output.js";`
- `src/attractor/handlers/agent-handler.ts:260` — `let evaluation = evaluateAgentOutput(result.output ?? "", zodSchema);`
- `src/attractor/handlers/agent-handler.ts:289` — `evaluation = evaluateAgentOutput(retryResult.output ?? "", zodSchema);`
- `src/attractor/handlers/evaluate-agent-output.ts:16` — `export function evaluateAgentOutput(`

Inside `evaluate-agent-output.ts`, JSON parsing is split across `normaliseRaw` (`src/attractor/handlers/evaluate-agent-output.ts:74`), `extractResultPayload` (`src/attractor/handlers/evaluate-agent-output.ts:86`), and `JSON.parse` against an extracted regex match (`src/attractor/handlers/evaluate-agent-output.ts:41-45`). None of those routines references `parseStructuredOutput`. Deletion changes nothing at this layer.

### 3.4 Why both files delete whole

The test file cannot survive without the production module — every one of the 7 `it` cases at `src/cli/lib/parse-structured-output.test.ts:5,11,17,23,29,35,40` calls `parseStructuredOutput` directly. Removing only the production file would leave an import failure on first test run. Removing only the test file would leave the production export with zero importers (still dead, just quieter). The two deletions are atomic by construction.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/lib/parse-structured-output.ts` | `git rm` — delete in full. |
| `src/cli/lib/parse-structured-output.test.ts` | `git rm` — delete in full. |

After the change, `git ls-files src/cli/lib/parse-structured-output.*` returns empty.

## 5. Data flow

No runtime data flow is affected. `parseStructuredOutput` was never invoked outside its own test harness. The live agent-output evaluation flow continues to read raw stream-json, normalize JSON arrays into NDJSON, walk lines for `result` events, and JSON-parse the extracted payload — all inside `evaluate-agent-output.ts`, all unchanged.

A user running `ralph implement`, `ralph meditate`, `ralph pipeline …`, or `ralph heartbeat` observes byte-identical behavior before and after the deletion.

## 6. Trade-offs

### 6.1 Risk: a future caller will need NDJSON-tolerant JSON parsing and have to re-derive it

If a new code path emerges that needs to parse a buffer that may be a JSON array, single JSON object, or NDJSON, its author cannot import `parseStructuredOutput` because it no longer exists.

**Accepted because:** the illumination explicitly designates `extractResultPayload` (already in production at `src/attractor/handlers/evaluate-agent-output.ts:86`) as the future extraction target. The two implementations differ — `parseStructuredOutput` returns `unknown[]` from raw text without filtering by event type; `extractResultPayload` walks lines and returns the last `result` event's payload. The live one is the more useful shape because the production format is always Claude stream-json. If a second caller ever appears, extracting from the live path gives a helper that already works against real input. Resurrecting `parseStructuredOutput` would mean grafting back a function shaped for a contract no shipping code uses.

### 6.2 Risk: deleting the test file lowers raw coverage numbers

CI coverage drops by however much the 7 `it` cases in `parse-structured-output.test.ts` contribute. No coverage threshold is currently enforced in `package.json` scripts, so the change is informational only.

**Accepted because:** the lost coverage was a self-loop — tests of a function that nothing executes outside the test file itself. Coverage of dead code is misleading signal; net signal-to-noise improves.

### 6.3 Risk: the matching test filename made the helper look load-bearing

A reader skimming `src/cli/lib/` would reasonably assume `parse-structured-output.ts` ↔ `parse-structured-output.test.ts` is "module + its tests, both live". Removing the helper without the test file would partially fix this; removing both fully fixes it.

**Accepted because:** this is the entire point of the deletion. The fix is the change itself.

## 7. Constraints

- The two file deletions must land together in a single commit. Splitting them produces an intermediate state where either tests reference a missing module (`tsc` fails) or a dead export with zero importers persists (defeats the cleanup).
- `npx tsc --noEmit` must pass after the change. With both files gone, the type checker has no dangling references to chase.
- `npm run build` must succeed. `tsup` does not list `parse-structured-output.ts` as a bundle entry (verified via `tsup.config.ts` audit for the matching string), so removing it cannot break the build configuration.
- `npx vitest run` must pass. The deleted test cases drop from the suite; no other test imports them.

## 8. Open questions

None. The verifier's three rubric criteria pass; the chat refinements close the blast-radius question with explicit Round-1 evidence; the scope is locked at "two files, nothing else". The reviewer loop may surface further nits, but no design-level question is open at draft time.

## 9. Verification approach

### 9.1 Static checks

Run after the deletion, in order:

- `git ls-files src/cli/lib/parse-structured-output.*` — expected: empty output. Confirms both files are tracked-as-deleted.
- `npx tsc --noEmit` — expected: clean. Any reference to the deleted module would surface here.
- Repo-wide grep for `parseStructuredOutput|parse-structured-output` (excluding `meditations/illuminations/`) — expected: zero hits in `src/`, `pipelines/`, `scripts/`, `docs/`, `package.json`, `tsup.config.ts`. Hits in the illumination corpus are the historical record and are ignored.

### 9.2 Tests

- `npx vitest run` — full suite passes. The deleted file's 8 cases are gone; no other test imports from `./parse-structured-output.js`.
- `npx vitest run src/attractor/handlers` — the live JSON-extraction tests around `evaluateAgentOutput` pass unchanged. This is the regression check on the live path.

### 9.3 Build & smoke

- `npm run build` — `tsup` produces a dist with the same set of `bin` entries (`ralph`) and no error.
- `node dist/cli/index.js --help` — top-level help output is byte-identical. No command surface changes; this is purely a sanity check that the build still loads.

## 10. Summary

Two files go: `src/cli/lib/parse-structured-output.ts` and `src/cli/lib/parse-structured-output.test.ts`. Roughly 30 lines of source plus 45 lines of tests leave the tree. The bundled `ralph` CLI behaves identically before and after — `heartbeat`, `implement`, `meditate`, and `pipeline` never touched the deleted code path; the live JSON-extraction path remains anchored at `src/attractor/handlers/evaluate-agent-output.ts:16`, called from `src/attractor/handlers/agent-handler.ts:260` and `:289`. The win is structural: `src/cli/lib/` becomes a directory whose every helper has at least one production caller, and a future reader walking the import graph reaches every line that ships, with no detour through speculative scaffolding.
