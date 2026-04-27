---
date: 2026-04-27
status: approved
shipped_in: null
shipped_sha: null
supersedes: null
superseded_by: null
related:
  - meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md
  - src/cli/commands/pipeline.ts
  - src/attractor/core/graph.ts
  - src/cli/program.ts
---

# `ralph pipeline show` — Design

## 1. Problem

Pipelines are now the primary orchestration surface for ralph (`implement`, `meditate`, `heartbeat`, the illumination-to-implementation lifecycle all run as `.dot` graphs). But inspection tooling has not kept pace. `pipelines/illumination-to-implementation.dot` is already 17 nodes; trace its variable flow flat and you spend more time reconstructing the topology in your head than reasoning about the change you want to make.

To answer "what feeds `$archive_reason_short` into `mark_archived`?", a maintainer must:

1. Open the `.dot` file.
2. Grep every `produces=` block.
3. Read every conditional edge's boolean expression.
4. Mentally reconstruct the traversal.

There is no ralph subcommand that draws the graph. The six existing pipeline subcommands (`run`, `validate`, `create`, `refine`, `list`, `trace`) are wired in `src/cli/program.ts:9-14`; grepping `pipeline.ts` for `pipelineShowCommand` or `"show"` returns zero matches. The capability gap is current.

## 2. Why now

`pipelines/illumination-to-implementation.dot` is the canary: 17 nodes today, climbing. Every new pipeline (e.g. the janitor agent at `docs/superpowers/specs/2026-04-25-janitor-agent-design.md`, the implement-as-pipeline shim at `docs/superpowers/specs/2026-04-16-implement-as-pipeline.md`) compounds the flat-read tax. A viewer collapses per-edit cognitive load, and the ROI scales with pipeline count.

Two pieces of foundation make the moment right:

- The `parseDot` / `validateGraph` pair is already factored into `src/attractor/core/graph.ts:11` and `:52`, with rich `file:line:col` diagnostics shipped in v0.1.31.
- WebAssembly graphviz (`@hpcc-js/wasm-graphviz`) ships as a pure npm dep — no system `dot` install, no `brew install graphviz` step gating contributors who clone the repo.

## 3. Goals

**In scope:**

- New `ralph pipeline show <file.dot>` subcommand. Single shape, zero flags.
- Validate-first, fail-fast: parse + validate the DOT through the existing `parseDot` + `validateGraph` pipeline. On any error diagnostic, render `file:line:col` plus the existing code-frame (matching `pipelineValidateCommand`'s output) and exit 1. No SVG written.
- On success: hand the original DOT bytes to `@hpcc-js/wasm-graphviz`, write `<basename>.svg` next to the source file, silent overwrite, exit 0.
- Pure DOT passthrough — no ralph-injected styling, no parse-mutate-emit, no walker.
- New npm dep: `@hpcc-js/wasm-graphviz` (Apache-2.0, LexisNexis Risk Solutions / RELX, currently v1.21.2). Bundled as a regular `dependencies` entry — runtime asset, not a dev dep.
- Tests: smoke + behavior assertions (file found, DOT passed through, SVG written next to source, refuses on broken DOT).
- Generated `.svg` artifacts are committed to the repo, not gitignored.

**Out of scope:**

- PNG, mermaid, ASCII output formats.
- Any flags whatsoever — `--png`, `--svg`, `--mermaid`, `--focus`, `--flow`, `--out`, `--force`, `--ascii`.
- An IR walker (`previewGraph(graph, opts)`) or a `src/attractor/preview/` directory.
- Path-highlighting integration with `pipeline trace` (deferred to its own future illumination).
- Validator hint integration — `pipeline validate` errors will not append "run `pipeline show` for context".
- Golden-file snapshots of rendered SVG bytes.
- Companion-illumination gating: this command ships standalone, independent of T2200 (explicit consumes), T2000 (post-rename labels), and T0400 (validator semantics).

## 4. User experience

### Happy path

```
$ ralph pipeline show pipelines/illumination-to-implementation.dot
✔ Wrote pipelines/illumination-to-implementation.svg (17 nodes, 22 edges)
$
```

### Validation failure (no SVG written)

```
$ ralph pipeline show pipelines/broken.dot
✖ pipelines/broken.dot:14:23 [schema_error] [mark_archived]: unrecognized key 'default_archive_reason_short'
    12 |   mark_archived [
    13 |     type=tool,
    14 |     default_archive_reason_short="…",
       |                              ^
    15 |     tool_command="…",
    16 |   ]
$ echo $?
1
$ ls pipelines/broken.svg
ls: pipelines/broken.svg: No such file or directory
```

The error layout is the same one `pipelineValidateCommand` emits at `src/cli/commands/pipeline.ts:199-204` — same `formatDiag` shape, same `renderCodeFrame` from `src/cli/lib/code-frame.ts`. Reuse the function or a tiny shared helper; do not re-implement the formatter.

### Syntax error (malformed DOT)

```
$ ralph pipeline show pipelines/syntactically-broken.dot
✖ pipelines/syntactically-broken.dot:8:1 [syntax] Unexpected token '}'
$
```

Catches `DotSyntaxError` from `parseDot` exactly as `pipelineValidateCommand:208-220` already does.

### File not found

```
$ ralph pipeline show pipelines/missing.dot
✖ Dot file not found: /abs/path/pipelines/missing.dot
$
```

## 5. Architecture

### 5.1 Surface area

One new exported function in `src/cli/commands/pipeline.ts`:

```ts
export async function pipelineShowCommand(
  dotFile: string,
  opts: PipelineShowOptions = {},
): Promise<number>;
```

`PipelineShowOptions` carries one field, `project?: string`, mirroring the rest of the pipeline command family. It exists solely to support the `pipeline-resolver` shorthand path (so `ralph pipeline show review --project my-app` can resolve `review` to a project-local DOT file). The user-facing surface still has zero flags — `--project` is inherited from the parent `pipeline` Commander group, the same way `validate` and `run` already inherit it.

Wire-up adds three lines to `src/cli/program.ts`:

1. Add `pipelineShowCommand` to the import block at `program.ts:9-14`.
2. Register the Commander subcommand alongside `validate` (`program.ts:172`), `list` (`:226`), `trace` (`:241`):

```ts
pipeline
  .command("show <dotfile>")
  .description("Render a pipeline as SVG next to the source file")
  .action(async (dotfile: string, _cmd, parent) => {
    const project = parent.optsWithGlobals().project;
    const exitCode = await pipelineShowCommand(dotfile, { project });
    process.exit(exitCode);
  });
```

3. Add a one-line entry to the `Pipeline engine` help block at `program.ts:47-56`.

No new files in `src/cli/`. No new module under `src/attractor/`.

### 5.2 Data flow

```
dotFile (string, may be name shorthand)
  │
  ▼  resolvePipelineArg / isNameShorthand
absPath (string)
  │
  ▼  readFileSync
src (string, original DOT bytes)
  │
  ▼  parseDot              (src/attractor/core/graph.ts:11)
graph (Graph)              ────► DotSyntaxError ──► formatDiag → output.error → exit 1
  │
  ▼  validateGraph         (src/attractor/core/graph.ts:52)
diags (Diagnostic[])
  │
  ▼  any errors?  ─────yes──► formatDiag (each) → output.error → exit 1
  │
  no
  │
  ▼  render(src)           (@hpcc-js/wasm-graphviz, see §5.3)
svg (string)
  │
  ▼  writeFileSync         (<basename>.svg next to absPath)
exit 0
```

The DOT source bytes flow straight through to the renderer. `parseDot` and `validateGraph` are gates only — their `Graph` output is used to count nodes/edges for the success message and is otherwise discarded. No re-emission, no styling injection.

### 5.3 Renderer integration

`@hpcc-js/wasm-graphviz` exposes a `Graphviz.load()` async factory that returns an instance with `dot(src: string): string` (returns SVG XML as a string). The renderer is loaded once per command invocation (no module-level cache — show is called from a short-lived CLI process).

Module shape (inline in `pipeline.ts`, behind one helper to keep `pipelineShowCommand` readable):

```ts
async function renderDotToSvg(dotSrc: string): Promise<string> {
  const { Graphviz } = await import("@hpcc-js/wasm-graphviz");
  const gv = await Graphviz.load();
  return gv.dot(dotSrc);
}
```

The dynamic `import()` keeps the WASM payload out of the cold-start path for unrelated subcommands. tsup's ESM output handles this cleanly (see `memory/tsup-multi-entry-path-issues.md` — same pattern).

### 5.4 Output filename

`<basename>.svg` next to the source. Computed via:

```ts
const svgPath = join(dirname(absPath), basename(absPath, ".dot") + ".svg");
```

If the input ends in `.gv` rather than `.dot`, basename strips no extension and the output is `<file>.gv.svg` — acceptable since ralph standardises on `.dot`.

Silent overwrite. No `--force`. No backup. The workflow is "edit DOT → re-run show → reload SVG", and any intermediate state is recoverable from git.

## 6. Components & files touched

| File | Change |
|---|---|
| `package.json` | Add `@hpcc-js/wasm-graphviz` to `dependencies`. |
| `src/cli/commands/pipeline.ts` | Add `pipelineShowCommand`, `PipelineShowOptions`, `renderDotToSvg`. Reuse the existing `formatDiag` body or extract it to a shared helper. |
| `src/cli/program.ts` | Import `pipelineShowCommand`, register `pipeline show <dotfile>` subcommand, add help-text line. |
| `src/cli/tests/pipeline-show.test.ts` (new) | Smoke + behavior tests (see §8). |

No edits to `src/attractor/core/graph.ts` — `parseDot` and `validateGraph` are consumed unchanged.

## 7. Constraints & invariants

- **Pure DOT passthrough.** The renderer receives the exact bytes that came off disk. No styling, no node-attribute mutation, no edge-label rewriting. If the user wants different colors or shapes, they edit the DOT.
- **Validation is the gate.** A DOT file that does not pass `validateGraph` has zero chance of producing an SVG. There is no "render anyway" fallback. (Rationale: render-on-broken would normalise broken DOT into the repo as a committed artifact, which is the opposite of fail-fast.)
- **Zero flags forever — until a fresh illumination revisits this.** Adding a flag is not a one-line change; it is a scope reopen. If filtering, alternative formats, or output redirection prove painful, log it as an illumination, do not bolt on.
- **WASM trust boundary.** `@hpcc-js/wasm-graphviz` is the only new code we did not write. License: Apache-2.0. Vendor: LexisNexis Risk Solutions, a unit of RELX (public). Pinned to v1.21.2 in `package.json`. No further sandboxing — graphviz layout is a pure function of input bytes; no filesystem or network access from inside the WASM module.
- **SVG is committed.** The generated `.svg` lives next to the source. Stale-drift between DOT and SVG is acknowledged but unaddressed: a pre-commit regenerator hook is premature, and a post-merge advisory hint is future scope. PR review catches stale diagrams when the diff is the topic of the PR.

## 8. Testing

Tests live at `src/cli/tests/pipeline-show.test.ts`. Vitest, with the project's existing test conventions (see neighboring `pipeline-validate.test.ts` for fixture style). All tests use temp directories — none mutate the real `pipelines/` tree.

Behavior assertions, no golden snapshots:

1. **File-not-found returns exit 1 and writes no SVG.** Pass a path that does not exist; assert exit code, assert no `.svg` produced anywhere in the temp dir.
2. **Validation failure returns exit 1 and writes no SVG.** Use a fixture DOT with a missing exit node (existing `validate` test helpers cover the failure shape). Assert exit code 1; assert the formatted diagnostic contains `file:line:col`; assert no SVG.
3. **DOT syntax error returns exit 1 and writes no SVG.** Fixture: `digraph { node1 ->` (truncated). Assert `[syntax]` rule in output, exit 1, no SVG.
4. **Happy path writes SVG next to source with same basename.** Use a known-valid pipeline (a 3-node fixture). Assert exit 0; assert `<basename>.svg` exists next to the input; assert the file is non-empty and starts with `<svg` or `<?xml` (proves the renderer ran, without locking us to a layout-byte snapshot).
5. **Silent overwrite.** Pre-create a stub `<basename>.svg` in the temp dir. Run `pipelineShowCommand`. Assert the file's contents change to the rendered SVG, no error, no prompt.
6. **Name shorthand resolves through `pipeline-resolver`.** Run with a bare name and `project: <tmpDir>`; assert the SVG is written into `<tmpDir>/pipelines/`.

What we do not test:

- Exact SVG output bytes. The WASM library is the camera; testing its rendering would test graphviz itself.
- Layout quality (node positions, edge routing). Out of scope.
- Re-render determinism across `wasm-graphviz` versions. Out of scope (and would break on upgrade).

## 9. Rollout

Single PR:

1. Add npm dep, run `npm install`, commit `package.json` + `package-lock.json`.
2. Add `pipelineShowCommand` and the wire-up.
3. Add tests.
4. Run `ralph pipeline show pipelines/illumination-to-implementation.dot` once and commit the resulting SVG so the repo ships with at least one rendered diagram (proof-of-life and contributor-onboarding artifact).
5. Update README's pipeline-engine help block in `program.ts:47-56` and the project README if it lists subcommands.

No version-bump considerations beyond the standard release cadence — additive, non-breaking surface.

## 10. Open questions

None at this stage. The refinement loop converged: single format, zero flags, no walker, no companion gating. If implementation surfaces a friction point that was not anticipated (most likely candidate: WASM cold-start latency on first invocation), surface it via an illumination rather than expanding scope here.

## 11. Cross-references

- Source illumination: `meditations/illuminations/2026-04-20T2500-pipeline-graph-preview-command.md`.
- Direct code anchors: `parseDot` at `src/attractor/core/graph.ts:11`, `validateGraph` at `src/attractor/core/graph.ts:52`, command-family registration at `src/cli/program.ts:9-14` and `:172` / `:226` / `:241`, validate-command formatter at `src/cli/commands/pipeline.ts:185-266`, name-shorthand resolver at `src/cli/lib/pipeline-resolver.ts:8-38`.
- Adjacent shipped work: `docs/superpowers/specs/2026-04-20-source-location-diagnostics-design.md` (the `file:line:col` diagnostic shape this command reuses), `docs/superpowers/specs/2026-04-20-dot-parser-ast-migration-design.md` (the AST-backed parser whose locations make fail-fast actionable).
- Deferred companions (no longer gating): `meditations/illuminations/2026-04-20T2200-explicit-consumes-declarations.md`, `meditations/illuminations/2026-04-20T2000-node-attr-rules-vs-output-contracts-naming.md`, `meditations/illuminations/2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md`.
