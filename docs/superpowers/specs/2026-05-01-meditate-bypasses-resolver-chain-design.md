# Design: Route `ralph meditate` Through the Pipeline Resolver Chain

**Date:** 2026-05-01
**Status:** draft (pending review)
**Originating illumination:** `meditations/illuminations/2026-05-01T0920-meditate-bypasses-resolver-chain.md`

## 1. Motivation

`ralph implement` and `ralph meditate` are sibling top-level shims over the same pipeline engine entry point (`pipelineRunCommand`). They disagree on how to look up their bundled pipeline:

- `src/cli/commands/implement.ts:30` passes the bare name `"implement"` and lets the runtime route through `resolvePipelineArg`:

  ```ts
  await pipelineRunCommand("implement", {
    project: absPath,
    variables: { ... },
  });
  ```

- `src/cli/commands/meditate.ts:79-86` resolves the bundled path itself and hands `pipelineRunCommand` an absolute path, bypassing the resolver chain entirely:

  ```ts
  const dotFile = resolveBundledPipeline("meditate");
  return await self.pipelineRunCommand(dotFile, {
    project: absPath,
    variables: { ... },
  });
  ```

`pipelineRunCommand` (in `src/cli/commands/pipeline.ts:237-241`) only routes through `resolvePipelineArg` when its argument satisfies `isNameShorthand`:

```ts
const absPath = isNameShorthand(dotFile)
  ? resolvePipelineArg(dotFile, project)
  : resolve(dotFile);
```

An absolute path passed in by `meditateCommand` skips the entire chain (`src/cli/lib/pipeline-resolver.ts:18-46`):

```
1. <project>/pipelines/<name>/pipeline.dot   (project folder-form)
2. <project>/pipelines/<name>.dot            (project flat-form)
3. ~/.ralph/pipelines/<name>/pipeline.dot    (user folder-form)
4. ~/.ralph/pipelines/<name>.dot             (user flat-form)
5. <bundled>/pipelines/<name>/pipeline.dot   (bundled fallback)
```

The user-visible consequence: dropping `pipelines/meditate/pipeline.dot` into a project is **honored** by `ralph pipeline run meditate --project <p>` and `ralph heartbeat pipeline meditate --project <p>` (both go through the resolver), but **silently ignored** by `ralph meditate <p>`. Same project, same pipeline name, three resolution policies depending on the verb.

The asymmetry is currently load-bearing: `src/cli/tests/meditate.test.ts:217` pins it as the contract:

```ts
expect(calls[0].dotFile.endsWith("meditate/pipeline.dot")).toBe(true);
```

The implement command's help advertises the override pattern explicitly (`src/cli/program.ts:79`):

```
The pipeline can be overridden by placing pipelines/implement.dot in your project folder.
```

The meditate command's help (`src/cli/program.ts:90`) carries no such note. Authors copying meditate as the exemplar for a future `ralph janitor` shim will reach for `resolveBundledPipeline`; authors copying implement will reach for the resolver chain. The surface fragments further with each new shim.

This change deletes a special case. It does not introduce new resolver behavior.

## 2. Decision Summary

1. **Pass the bare name** `"meditate"` from `meditateCommand` into `pipelineRunCommand`, mirroring `implementCommand`. The runtime's existing `isNameShorthand` branch routes through the full resolver chain.
2. **Drop the unused import** `resolveBundledPipeline` from `src/cli/commands/meditate.ts:4` once it has no callers in that file.
3. **Mirror the help-text override note** on the meditate subcommand at `src/cli/program.ts:90` so both sibling commands document the override pattern identically.
4. **Flip the meditate shim test** at `src/cli/tests/meditate.test.ts:217` from asserting the bundled `endsWith` path to asserting the bare name flowed through. Add a positive test that a project-local `pipelines/meditate/pipeline.dot` resolves and is invoked instead of the bundled file.
5. **Audit other entry points** that hand `pipelineRunCommand` an already-resolved absolute path when a bare name would do. Per current grep, `meditateCommand` is the only offender among shims; `pipeline run` and `heartbeat pipeline` already route through the resolver. The audit produces a one-line confirmation, not a code change, unless a second offender is found.

Out of scope:

- Changes to `implementCommand`, `pipelineRunCommand`, `resolvePipelineArg`, or `resolveBundledPipeline`.
- Changes to `pipeline run`, `pipeline validate`, `pipeline show`, or `heartbeat pipeline` paths — these already go through the resolver.
- New resolver features (e.g. additional lookup directories, fallback policies). This change only removes a divergent special case.

## 3. Architecture

### 3.1 Current vs target resolution flow

**Current** (asymmetric):

```
ralph implement <p>
  → implementCommand("p", opts)
  → pipelineRunCommand("implement", { project: absP, ... })
  → isNameShorthand("implement") === true
  → resolvePipelineArg("implement", absP)        ← honors project override
  → execute resolved .dot

ralph meditate <p>
  → meditateCommand("p", opts)
  → resolveBundledPipeline("meditate")            ← skips resolver chain
  → pipelineRunCommand("/abs/.../meditate/pipeline.dot", { ... })
  → isNameShorthand("/abs/...") === false
  → resolve("/abs/...")                           ← bundled-only
  → execute bundled .dot
```

**Target** (symmetric):

```
ralph implement <p>
  → implementCommand("p", opts)
  → pipelineRunCommand("implement", { project: absP, ... })   (unchanged)

ralph meditate <p>
  → meditateCommand("p", opts)
  → pipelineRunCommand("meditate", { project: absP, ... })    (mirrors implement)
  → isNameShorthand("meditate") === true
  → resolvePipelineArg("meditate", absP)
  → execute resolved .dot (project override honored)
```

### 3.2 Why `pipelineRunCommand` is the right contract boundary

`pipelineRunCommand` is the engine entry point. It already owns "given a `dotFile` argument, decide whether it's a name or a path, then resolve". Putting that decision behind a separate per-command branch (as `meditateCommand` does today) duplicates a policy that already lives one layer down. After this change, every callsite that wants the resolver chain hands `pipelineRunCommand` a bare name; every callsite that wants a literal path hands it a path. One rule, no special cases.

### 3.3 Preserved invariants

- **Bundled fallback still works.** `resolvePipelineArg` falls through to `resolveBundledPipeline` at `src/cli/lib/pipeline-resolver.ts:45` when no project-local or user-home file exists. A user with no `pipelines/meditate/` folder gets the bundled pipeline, exactly as today.
- **Pre-meditate guards run unchanged.** PID lock check (`src/cli/commands/meditate.ts:70-74`), `ensureMeditationDirs` (line 75), `appendMeditateGitignore` (line 76), and `writePid` (line 77) all execute before the call to `pipelineRunCommand`. The `try/finally` wrapping `removePid` (lines 78-89) is preserved.
- **Variable wiring unchanged.** `steer` and `vision` continue to be passed in `opts.variables`. `readVisionIfPresent` (line 84) still gates VISION.md inclusion.

## 4. Components & file edits

### 4.1 Source code

| File | Change |
|---|---|
| `src/cli/commands/meditate.ts:79-80` | Replace the two-statement block (`const dotFile = resolveBundledPipeline("meditate"); return await self.pipelineRunCommand(dotFile, { ... });`) with a single call: `return await self.pipelineRunCommand("meditate", { ... });`. The `{ ... }` body (project + variables) is unchanged. |
| `src/cli/commands/meditate.ts:4` | Remove the now-unused import `import { resolveBundledPipeline } from "../lib/assets.js";`. |

### 4.2 Help text

| File | Change |
|---|---|
| `src/cli/program.ts:90` | Replace the current `addHelpText("after", ...)` value `"\nExamples:\n  ralph meditate my-app\n"` with `"\nExamples:\n  ralph meditate my-app\n\nThe pipeline can be overridden by placing pipelines/meditate/pipeline.dot in your project folder.\n"`. The wording mirrors line 79 verbatim except for the pipeline name (`meditate` and the folder-form path, since that is the canonical layout per `pipeline-resolver.ts:29-30`). |

Note: line 79's wording for implement says `pipelines/implement.dot` (flat form), while the resolver checks folder-form first. The meditate help line uses folder-form to match what the resolver will actually find when an author follows the override pattern in 2026 (per the per-pipeline-folder architecture decision). Updating implement's help to match folder-form is out of scope here but flagged in the open questions.

### 4.3 Tests

| File | Action |
|---|---|
| `src/cli/tests/meditate.test.ts:209-220` | Update the existing `"delegates to pipelineRunCommand with the bundled meditate template + steer variable"` test. Replace `expect(calls[0].dotFile.endsWith("meditate/pipeline.dot")).toBe(true);` with `expect(calls[0].dotFile).toBe("meditate");`. Rename the test to `"delegates to pipelineRunCommand with the bare meditate name + steer variable"`. The `opts.project` and `opts.variables.steer` assertions remain. |
| `src/cli/tests/meditate.test.ts` (new test) | Add a positive override test inside the `meditateCommand (shim)` describe block: write `tmpDir/pipelines/meditate/pipeline.dot` with a minimal valid graph, call `meditateCommand(tmpDir)` without mocking `pipelineRunCommand`'s internals, and assert that the engine executes the project-local file rather than the bundled one. The straightforward shape: spy on `pipelineRunCommand`, assert `calls[0].dotFile === "meditate"` and `calls[0].opts.project === tmpDir` — the resolver runs inside `pipelineRunCommand`, so the shim test only needs to confirm the shim hands off the bare name and the correct project. A separate integration-level test in `pipeline-resolver.test.ts` already covers folder-form discovery (`src/cli/tests/pipeline-resolver.test.ts:84-123`), so duplicating that here is unnecessary. |
| `src/cli/tests/meditate.test.ts` | No changes to the other shim tests (lines 222-275) — they assert variable wiring (`steer`, `vision`, `specs_dir` absence) and preflight behavior (`ensureMeditationDirs`, gitignore, PID), all of which are independent of the resolver path. |

### 4.4 Audit

A one-line confirmation, recorded in the implementation plan but not committed as code:

```
$ grep -rn "pipelineRunCommand(" src/cli/commands/
src/cli/commands/implement.ts:30:   pipelineRunCommand("implement", { ... })          ← bare name
src/cli/commands/meditate.ts:80:    self.pipelineRunCommand(dotFile, { ... })         ← absolute path (THIS PR fixes)
src/cli/commands/pipeline.ts:125:   pipelineRunCommand(dotFile, { ... })              ← user-supplied arg, isNameShorthand handles it
```

Daemon-spawned heartbeat tasks invoke `meditate` and `implement` through the same shims, so this audit fully covers the call surface. No daemon-side edits required.

## 5. Data flow

Before (`ralph meditate my-app`, with `my-app/pipelines/meditate/pipeline.dot` present):

```
shell → meditateCommand("my-app", {})
      → resolveBundledPipeline("meditate")    [bundled path resolved]
      → pipelineRunCommand("/abs/dist/.../meditate/pipeline.dot", { project: "/abs/my-app", ... })
      → resolve("/abs/dist/.../meditate/pipeline.dot")    [no shorthand, literal resolve]
      → execute bundled file. Project override IGNORED.
```

After:

```
shell → meditateCommand("my-app", {})
      → pipelineRunCommand("meditate", { project: "/abs/my-app", ... })
      → isNameShorthand("meditate") === true
      → resolvePipelineArg("meditate", "/abs/my-app")
      → finds "/abs/my-app/pipelines/meditate/pipeline.dot" → returns it
      → execute project-local file. Project override HONORED.
```

Bundled fallback (no project override present): same path, but `resolvePipelineArg` falls through to `resolveBundledPipeline` at `pipeline-resolver.ts:45` and returns the bundled file. Behavior unchanged from today's bundled-only path.

## 6. Trade-offs

### 6.1 Risk: project-local override masks a bug in the bundled meditate

A user who unintentionally has `pipelines/meditate/pipeline.dot` in their project (e.g. copied from a tutorial, never cleaned up) will silently get that pipeline instead of the bundled one. The same risk already exists for `implement` (and for `ralph pipeline run meditate`), and is the explicit point of the override mechanism.

**Mitigation:** none required — this is the documented contract for `implement` already. The new help-text line on meditate (§4.2) makes the behavior discoverable.

### 6.2 Test deletes a previously-load-bearing assertion

`src/cli/tests/meditate.test.ts:217` currently pins the bundled-only path. Flipping it removes a regression guard against accidental future code that re-introduces `resolveBundledPipeline`-direct calls in `meditateCommand`.

**Mitigation:** the replacement assertion (`dotFile === "meditate"`) is itself a regression guard against the inverse mistake (someone re-introducing path-resolution in the shim). The bundled-fallback path remains exercised by `pipeline-resolver.test.ts:62-82`.

### 6.3 Help-text wording divergence from implement

Implement's help (line 79) uses flat-form `pipelines/implement.dot`; the new meditate help (line 90) uses folder-form `pipelines/meditate/pipeline.dot`. They are inconsistent.

**Accepted because:** folder-form is the canonical layout per the per-pipeline-folder decision (project memory `2026-04-27-chunk-4-completion-per-folder-architecture.md`). Updating implement's help to fold-form is the right cleanup, but it is outside this change's scope. Tracked as an open question.

## 7. Constraints

- The edit to `src/cli/commands/meditate.ts:79-80` must replace **both** the `const dotFile = ...` line and the `self.pipelineRunCommand(dotFile, ...)` line. Deleting one without the other leaves an unused variable or a `ReferenceError`.
- The import removal at `src/cli/commands/meditate.ts:4` is conditional on no remaining callers in that file. Verify with grep before removing.
- Test edits must precede any merge that runs the `meditate.test.ts` shim block, since the existing assertion at line 217 will fail the moment the source change lands.
- `npm run build` must succeed after edits — the bundled `dist/cli/pipelines/meditate/pipeline.dot` is the file `resolveBundledPipeline` returns when no override is present. Build output unchanged from today's flow.

## 8. Open questions

1. **Should `src/cli/program.ts:79` be updated to folder-form for consistency?** The implement help line currently advertises `pipelines/implement.dot` (flat-form), but the resolver prefers folder-form. Out of scope here, but a small follow-up would close the asymmetry.
2. **Should the resolver chain be documented in a single canonical location?** The illumination proposed `docs/specs/pipeline.md`, but `docs/specs/` was deleted on 2026-05-01 (per `2026-05-01-source-as-truth-no-behavioral-specs-design.md`). The replacement venue is either CONTEXT.md (glossary entry "pipeline resolver chain") or an ADR. This design defers the documentation question — the resolver source itself (`src/cli/lib/pipeline-resolver.ts:18-46`) is now the single canonical location, with this design doc as one-time scaffolding.

## 9. Verification approach

### 9.1 Unit tests

After edits:

- `npx vitest run src/cli/tests/meditate.test.ts` — the updated shim test passes; existing tests for `ensureMeditationDirs`, gitignore, PID, VISION.md, and template body all pass unchanged.
- `npx vitest run src/cli/tests/pipeline-resolver.test.ts` — all resolver tests pass (no edits expected).
- `npx vitest run` — full suite passes.
- `npx tsc --noEmit` — types check (the import removal is the only type-surface change).

### 9.2 End-to-end smoke

Two manual smokes to confirm the user-visible behavior change:

1. **Bundled fallback unchanged.** In a fresh project folder with no `pipelines/` directory, run `ralph meditate <p>`. Assert: the bundled pipeline runs (same as today).
2. **Project override honored.** In a project folder with a minimal `pipelines/meditate/pipeline.dot` (e.g. just `digraph m { goal="test"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done }`), run `ralph meditate <p>`. Assert: the project-local file runs. Confirm by adding a distinguishing comment or `goal=` line and observing it in the trace output.

### 9.3 Help-text sanity

- `ralph meditate --help` includes the override note, mirroring `ralph implement --help`.

## 10. Summary

The change is structural deletion: `meditateCommand` stops doing what `pipelineRunCommand` already does. After this PR, `ralph meditate` and `ralph implement` follow the same resolver policy, the same help-text convention, and the same test-shim shape. New bundled shims (e.g. a future `ralph janitor`) inherit one rule no matter which sibling their author copies.
