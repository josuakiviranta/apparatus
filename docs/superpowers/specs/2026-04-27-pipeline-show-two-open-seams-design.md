---
date: 2026-04-27
status: approved
shipped_in: null
shipped_sha: null
supersedes: null
superseded_by: null
related:
  - meditations/illuminations/2026-04-27T1459-pipeline-show-two-open-seams.md
  - meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md
  - docs/superpowers/specs/2026-04-27-pipeline-graph-preview-command-design.md
  - src/cli/commands/pipeline.ts
  - src/cli/lib/code-frame.ts
---

# Pipeline-show two open seams — Design

## 1. Problem

`ralph pipeline show` shipped exactly to spec — pure DOT passthrough, WASM
renderer, validate-gate, zero flags. But the implementation left two open
seams visible in the current tree.

**Seam 1 — duplicated diagnostic formatter.** Two byte-identical `formatDiag`
closures live in the same file:

- `src/cli/commands/pipeline.ts:199-204`, inside `pipelineValidateCommand`:
  ```ts
  function formatDiag(d: Diagnostic): string {
    const loc = d.location ? `${relPath}:${d.location.line}:${d.location.column} ` : "";
    const hint = d.hint ? `\n${indentHint(d.hint)}` : "";
    const frame = d.location ? `\n${indentHint(renderCodeFrame(src, d.location, { context: 2, color: false }))}` : "";
    return `${loc}[${d.rule}] ${d.message}${hint}${frame}`;
  }
  ```
- `src/cli/commands/pipeline.ts:1068-1073`, inside `pipelineShowCommand`:
  same body, same signature, same `renderCodeFrame` call.

The owning spec told the implementer verbatim — at
`docs/superpowers/specs/2026-04-27-pipeline-graph-preview-command-design.md:88`:
*"Reuse the function or a tiny shared helper; do not re-implement the
formatter."* A copy shipped instead.

**Seam 2 — committed SVGs have no staleness guard.** Two rendered diagrams
sit in the repo today:

- `pipelines/illumination-to-implementation.svg`
- `pipelines/janitor.svg`

Both were committed as proof-of-life artifacts when `pipeline show` shipped.
Their `.dot` siblings will keep changing; the SVGs will silently lag. There
is no CI check, no pre-commit hook, no `pipeline lint` advisory to catch the
drift.

## 2. Why now

- **Two copies is a 10-line extraction; three is a refactor.** The next
  diagnostic-emitting subcommand — `pipeline lint` (per illumination
  T2400), `pipeline test`, or validate-on-create — will face the same fork:
  copy `formatDiag` again, or extract it. The cheap window is now.
- **Spec-violation drift is the loudest possible signal.** The author of
  the original design wrote down "do not re-implement the formatter", a
  reviewer approved it, and the implementer copied it anyway. Sealing the
  seam restores spec→code fidelity for one of the most-cited examples of
  pipeline tooling discipline.
- **SVG drift is invisible until embarrassing.** A stale committed SVG
  looks authoritative in PR review and on GitHub's rendered preview. A
  one-line mtime check catches every drift the moment a contributor runs
  `pipeline lint`.

## 3. Goals

**In scope:**

1. Extract `formatDiag` into a shared helper at
   `src/cli/lib/pipeline-diag-format.ts`, exporting
   `formatPipelineDiag(d, src, relPath)`. Update both call sites to import
   and call it; delete both inner closures.
2. Add one unit test at
   `src/cli/tests/pipeline-diag-format.test.ts` that pins the exact
   `file:line:col [rule] message` output string for a representative
   diagnostic.
3. Mark `meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md`
   as implemented once steps 1–2 land.
4. **Conditional on `pipeline lint` (illumination T2400) shipping** — add
   an `[stale_svg]` advisory to that lane. mtime-compare each `.dot` with
   its sibling `.svg`; if the `.svg` is older, warn:
   `pipelines/foo.svg is older than foo.dot — re-run: ralph pipeline show foo`.
   This is a pure I/O check, no parse required. Ship inside the
   `pipeline lint` PR, not standalone.
5. Lock `pipeline show` as zero-flag for the foreseeable future. The
   originally-deferred `--focus`, `--flow`, `--mermaid` ideas need a
   *fresh* illumination with UX justification — not a retrofit through
   this design.

**Out of scope:**

- Any user-facing output change. Both existing `formatDiag` closures are
  byte-identical today; the extraction must produce the same string.
- CI enforcement, pre-commit hooks, or auto-regeneration of SVGs.
- A new home for the staleness check if `pipeline lint` does not ship —
  the check rides on T2400's lane or it does not ship at all.
- Parse-then-render of the SVG, byte snapshots, or layout-quality
  assertions. Out of scope for the helper test; out of scope for the
  staleness check.
- New flags on `pipeline show`. Period.

## 4. User experience

The default user experience does not change. Both validate-failure and
show-failure already render the same `file:line:col [rule] message` line
plus a code frame; this design keeps that exact layout.

### `pipeline lint` advisory (conditional, when T2400 ships)

```
$ ralph pipeline lint
⚠ [stale_svg] pipelines/illumination-to-implementation.svg is older than illumination-to-implementation.dot
    re-run: ralph pipeline show pipelines/illumination-to-implementation.dot
```

The warning carries the `[stale_svg]` rule label so it follows the
existing diagnostic conventions (rule + message), and it spells out the
exact remediation command — no thinking required.

## 5. Architecture

### 5.1 Surface area

One new file:

```ts
// src/cli/lib/pipeline-diag-format.ts
import { renderCodeFrame } from "./code-frame.js";
import type { Diagnostic } from "../../attractor/types.js";

function indentHint(s: string): string {
  return s.split("\n").map(l => "    " + l).join("\n");
}

export function formatPipelineDiag(
  d: Diagnostic,
  src: string,
  relPath: string,
): string {
  const loc = d.location ? `${relPath}:${d.location.line}:${d.location.column} ` : "";
  const hint = d.hint ? `\n${indentHint(d.hint)}` : "";
  const frame = d.location
    ? `\n${indentHint(renderCodeFrame(src, d.location, { context: 2, color: false }))}`
    : "";
  return `${loc}[${d.rule}] ${d.message}${hint}${frame}`;
}
```

Both call sites become two-liners:

```ts
// src/cli/commands/pipeline.ts (replaces both 199-204 and 1068-1073)
import { formatPipelineDiag } from "../lib/pipeline-diag-format.js";
// …
const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);
```

The local `formatDiag` arrow is preserved at each call site so the rest
of the bodies (calls like `await output.error(formatDiag(diag))`) stay
untouched. Net change inside `pipeline.ts`: −12 lines, +4 lines, +2
imports.

### 5.2 `indentHint` location

`indentHint` is currently defined elsewhere in `pipeline.ts` and used by
both closures. Two acceptable options:

- **A (preferred).** Move `indentHint` into the new helper file (it is a
  pure string utility used only by the diagnostic formatter today). Keep
  `pipeline.ts` as the only importer otherwise.
- **B.** Leave `indentHint` in `pipeline.ts` and re-export it from there
  for the helper to consume.

Option A keeps the dependency graph one-directional (`pipeline.ts` →
`pipeline-diag-format.ts`) and avoids a circular re-export. Pick A unless
implementation surfaces a concrete reason to do otherwise.

### 5.3 Data flow

Unchanged. Both call sites already build `relPath` and read `src` before
invoking the closure; the helper signature mirrors that exact contract:
`(diagnostic, sourceText, displayPath) → formatted string`.

```
Diagnostic ─┐
src ─────────┼──► formatPipelineDiag ──► "<relPath>:<line>:<col> [<rule>] <message>\n<hint>\n<frame>"
relPath ────┘
```

No new branches, no new state, no async, no I/O.

### 5.4 SVG-staleness check (conditional lane)

Inside the `pipeline lint` command (specified separately under T2400),
add one block:

```ts
import { statSync, existsSync } from "fs";
// for each foundDotFile:
const svgPath = dotPath.replace(/\.dot$/, ".svg");
if (existsSync(svgPath) && statSync(svgPath).mtimeMs < statSync(dotPath).mtimeMs) {
  emit({
    rule: "stale_svg",
    severity: "warning",
    message: `${relSvg} is older than ${relDot} — re-run: ralph pipeline show ${relDot}`,
  });
}
```

Pure I/O, no parse. Two filesystem stats per `.dot` file. The advisory
flows through the same diagnostic pipeline as every other lint warning
and so reuses `formatPipelineDiag` for free — closing the loop on Seam
1's value.

## 6. Components & files touched

| File | Change |
|---|---|
| `src/cli/lib/pipeline-diag-format.ts` (new) | Export `formatPipelineDiag` (and `indentHint` per §5.2 option A). |
| `src/cli/commands/pipeline.ts` | Replace two inner `formatDiag` closures with calls to `formatPipelineDiag`. Add one import. Delete `indentHint` from this file if option A is taken. |
| `src/cli/tests/pipeline-diag-format.test.ts` (new) | Pin exact format string for one representative diagnostic with location + rule + message; one fixture without `location`; one fixture with `hint`. |
| `meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md` | Front-matter `status: implemented`, `implemented_in: <this PR>`. |
| `pipelines/lint.dot` (or wherever T2400 lands its lint lane) | If and only if T2400 ships in the same window: add `[stale_svg]` mtime check (§5.4). Not part of this PR otherwise. |

No edits to `src/attractor/`. No edits to `src/cli/program.ts`. No
package.json changes.

## 7. Constraints & invariants

- **Zero user-facing output change.** The two existing closures are
  byte-identical; the helper produces the same bytes. The unit test pins
  this — any future edit to the helper must update the test, surfacing
  the diff in review.
- **No new flags on `pipeline show`.** The original T2500 illumination
  proposed `--focus`, `--flow`, and `--mermaid`. They were deferred, not
  rejected. Reopening that scope requires a fresh illumination with UX
  justification.
- **Staleness check rides T2400's lane.** Do not invent a new home
  (no `ralph pipeline check`, no pre-commit hook). If `pipeline lint`
  slips, the staleness check slips with it.
- **DRY scoped to actual duplication.** Do not pre-extract anything
  else from `pipeline.ts` "while we're in there". The justification
  here is two byte-identical closures, not general refactor energy.
- **Helper is pure.** No side effects, no async, no I/O. Trivially
  testable, trivially callable from anywhere.

## 8. Testing

New file: `src/cli/tests/pipeline-diag-format.test.ts`. Vitest, no
mocks needed (the helper is pure).

Behavior assertions:

1. **Diagnostic with location, rule, message produces exact format
   string.** Fixture: a 5-line `src`, a `Diagnostic` with `location =
   { line: 3, column: 5 }`, `rule = "schema_error"`, `message = "bad
   key"`. Assert the exact returned string — `relPath:3:5 [schema_error]
   bad key\n    <indented code frame>`. This is the load-bearing test
   for the no-output-change guarantee.
2. **Diagnostic without location omits the prefix and the frame.**
   Same rule and message, no `location`. Assert returned string is
   `[schema_error] bad key` — no leading `relPath:…`, no trailing
   frame.
3. **Diagnostic with `hint` interleaves the indented hint between
   message and frame.** Fixture adds `hint = "try X instead"`. Assert
   the hint appears indented four spaces, on its own line, before the
   code frame.

What we do not test:

- The two call sites continue to behave correctly. That is covered by
  the existing `pipeline-show.test.ts` (validation-failure path) and
  by the validate-command tests; both already pin output via mocks of
  `output.error`. Re-pinning their bytes here would couple the tests
  to the helper's internals twice over.
- `renderCodeFrame` itself — already tested elsewhere.
- The conditional `[stale_svg]` check — that test lives in T2400's PR.

## 9. Rollout

Single PR:

1. Add `src/cli/lib/pipeline-diag-format.ts` with the helper (and
   `indentHint` per §5.2 option A).
2. Replace the two inner `formatDiag` closures in
   `src/cli/commands/pipeline.ts` with calls to `formatPipelineDiag`.
   Add the import.
3. Add `src/cli/tests/pipeline-diag-format.test.ts`.
4. Mark both
   `meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md`
   and
   `meditations/illuminations/2026-04-27T1459-pipeline-show-two-open-seams.md`
   as implemented (front-matter only).
5. Run the existing test suite. `pipeline-show.test.ts`,
   `pipeline-preflight.test.ts`, and any other consumers of pipeline
   diagnostic output must still pass with no test edits — the bytes
   produced have not changed.

The `[stale_svg]` advisory (Goal 4) ships as part of T2400's PR, not
this one. If T2400 lands first, the advisory waits for this helper to
exist (it depends on `formatPipelineDiag`); if this design ships
first, the advisory hooks in cleanly when T2400 lands. Either order
works.

No version-bump considerations — pure internal refactor.

## 10. Open questions

None. The refinement loop converged on a five-step scope (extract,
swap, test, mark-implemented, lock-zero-flag) with one conditional
add (mtime check on T2400's lane). All scope locks are documented in
§3 and §7; future scope expansions require a fresh illumination.

## 11. Cross-references

- Source illumination:
  `meditations/illuminations/2026-04-27T1459-pipeline-show-two-open-seams.md`.
- Spec being respected (the one whose verbatim instruction was
  violated): `docs/superpowers/specs/2026-04-27-pipeline-graph-preview-command-design.md:88`.
- Concrete code anchors: `formatDiag` closure 1 at
  `src/cli/commands/pipeline.ts:199-204`; `formatDiag` closure 2 at
  `src/cli/commands/pipeline.ts:1068-1073`; shared `renderCodeFrame`
  at `src/cli/lib/code-frame.ts:5`.
- Committed SVGs awaiting staleness coverage:
  `pipelines/illumination-to-implementation.svg`,
  `pipelines/janitor.svg`.
- Conditional lane this design hooks into:
  `pipeline lint` (illumination T2400), still to ship.
- Adjacent shipped work: `docs/superpowers/specs/2026-04-20-source-location-diagnostics-design.md`
  (the diagnostic shape this helper formats).
