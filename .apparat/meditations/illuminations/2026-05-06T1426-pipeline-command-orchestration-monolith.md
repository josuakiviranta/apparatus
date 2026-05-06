---
date: 2026-05-06
description: src/cli/commands/pipeline.ts is a 762-LOC god module wiring CLI args, resolver, parser, validator, transforms, runtime, Ink TUI, and diagnostics into one file with 21+ unrelated imports.
---

## Files

- `src/cli/commands/pipeline.ts` (762 LOC)

## Problem

A single command file orchestrates every concern of the `apparat pipeline` surface:

- CLI argument parsing (commander)
- Pipeline resolution (project-local vs bundled tier)
- DOT parsing (`parseDot`)
- Validation (`validateGraph`, preflight diagnostics)
- Variable expansion (multiple imports from `variable-expansion.ts`)
- Runtime invocation
- Ink TUI rendering (`PipelineApp`)
- Stream-formatter wiring
- Pretty-printed diagnostics (`preflight-format`, `pipeline-diag-format`)

`pipeline.ts` imports across the entire codebase: attractor core, attractor transforms, CLI lib, CLI components, MCP. Sub-commands (`run`, `show`, `list`, `validate`) live as conditional branches inside one file.

The "invocation pipeline" — resolve → parse → validate → expand — is open-coded once per sub-command, with subtle differences in error handling between branches. There is no named module for this sequence; it lives in `pipeline.ts` only.

**Deletion test:** removing `pipeline.ts` would require reconstructing the invocation pipeline at every CLI entry. Complexity is real; the question is whether it lives in one giant file or behind named seams.

## Solution

Two-step split:

1. **Extract a `PipelineInvocation` module** that owns the resolve → parse → validate → expand sequence, returning a typed `LoadedPipeline` (graph + diagnostics + project root + run id). Every sub-command consumes this single function.

2. **Split `pipeline.ts` by sub-command** into `commands/pipeline/run.ts`, `commands/pipeline/show.ts`, `commands/pipeline/list.ts`, `commands/pipeline/validate.ts`. Each sub-command file imports `PipelineInvocation` plus only the sub-command-specific deps (Ink TUI for `run`, `annotate-show` for `show`, etc.).

The current `pipeline.ts` becomes a tiny commander registration shim that wires sub-commands into the parent program.

## Benefits

- **Locality:** "what does `pipeline run` do?" answered by reading one file under 200 LOC instead of skimming 762.
- **Leverage:** `PipelineInvocation` becomes the single seam for "load a pipeline graph from disk" — reusable by daemon, smoke tests, and future tooling without re-deriving the sequence.
- **Tests:** each sub-command testable without spinning up the full Ink runtime; the invocation module testable without commander.
- **Deletion test:** complexity *concentrates* — the invocation sequence becomes a named module instead of an open-coded ritual; sub-commands shed unrelated imports.
