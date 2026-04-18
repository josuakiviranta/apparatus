---
date: 2026-04-18
status: open
description: specs/commands.md documents only three ralph pipeline subcommands but six are implemented — validate, refine, and trace are absent, leaving the verifier without spec ground truth for any illumination that reasons about those commands' behavior.
---

## Core Idea

`specs/commands.md` lists three `ralph pipeline` subcommands: `run`, `list`, and `create`. Six are registered in `src/cli/program.ts` and fully implemented in `src/cli/commands/pipeline.ts`: the three documented, plus `validate`, `refine`, and `trace`. All three missing commands have detailed `.addHelpText()` blocks in `program.ts` — their behavioral contract exists only in help text and source code, not in the spec layer. `specs/commands.md` is currently being edited (it appears as `M` in the working tree), which means an implementer is touching it right now, likely to add T0900's exit-code note — without a specific signal to add the three missing entries.

## Why It Matters

The `illumination-to-implementation` pipeline verifier explicitly reads `specs/*.md` as one of its two verification sources (the other is `src/`). Its prompt: "Check specs/*.md to verify claims about specifications." For any illumination that makes behavioral claims about `validate`, `refine`, or `trace`, the verifier's spec-check subagent finds nothing in `specs/commands.md`. The verifier must fall back to `src/` alone — which means spec-level claims ("this command should exit 1 on validation failure", "refine injects the last three run traces") cannot be confirmed as specified, only as implemented. This is exactly the class of claim where spec and implementation can diverge, and where the spec is the authority.

The practical consequence is already in motion: `2026-04-19T0400` identifies that T0900's fix requires adding exit-code documentation to `specs/commands.md` under `ralph pipeline run`. If that edit is made in isolation, the file still has no entry for `refine` (which also has exit-code behavior — exits non-zero when `claude` is not in PATH, exits 0 when refine session completes, exits the validate result), no entry for `validate` (exits 0 on success, 1 on errors — already explicitly documented in its `program.ts` help), and no entry for `trace` (exits 1 with a clear error if the trace file is not found, 0 on success). Three commands with observable exit contracts, none documented in the spec layer.

The `refine` gap is the largest. The command has meaningful behavioral complexity: two-phase Claude session, trace injection gated by `--no-traces`, edge-label diff validation via `diffEdgeLabels()`, conflict-guard (must exist, vs. `create`'s must-not-exist). The design spec `specs/2026-04-17-refine-run-history-and-failure-tip-design.md` describes what was *already shipped*, not the command's interface — it is an implementation record, not a command reference. `specs/commands.md` is where the command reference lives.

## Revised Implementation Steps

1. **Add `### ralph pipeline validate <dotfile>` to `specs/commands.md`** under the `ralph pipeline` section. Cover: accepts name shorthand or path, resolves via `isNameShorthand` + `getPipelinesDir`, exits 0 on valid, exits 1 on any structural error. List the check categories: missing start/exit nodes, unknown shapes, edges referencing undeclared nodes. Note that when called from `pipelineRefineCommand`, it receives `previousGraph` and also emits edge-label diff diagnostics. One paragraph, no more.

2. **Add `### ralph pipeline refine <name>` to `specs/commands.md`**.  Cover: requires the file to already exist (inverse of `create`'s conflict check); runs `composeCreatePrompt()` to inject project-local agent awareness; injects up to three recent run trace digests unless `--no-traces`; passes `previousGraph` to `pipelineValidateCommand` for edge-label diff on exit. Flags: `--project <folder>`, `--no-traces`. Exit behavior: exits non-zero if `claude` not in PATH, if the `.dot` file does not exist after session completes, or if the validate step returns errors; exits 0 on clean validate.

3. **Add `### ralph pipeline trace <runId>` to `specs/commands.md`**. Cover: reads `~/.ralph/runs/<runId>/pipeline.jsonl`; without `--node-receive`, lists all node invocations with status and context key summary; with `--node-receive <nodeReceiveId>`, shows the full context snapshot at that invocation point plus completed stages up to that point. Flags: `--node-receive <id>`, `--full`. Exit behavior: exits 1 if trace file not found.

4. **Add exit-code documentation to `ralph pipeline run`** as part of the same edit (T0900 step 3). Don't make a separate commit for this — it belongs in the same `specs/commands.md` update as steps 1–3 above. The four entries (run exit codes, validate, refine, trace) are all spec-layer gaps in the same file; fixing them in one commit keeps the diff coherent and ensures the verifier's spec-check subagent gets complete ground truth in a single update.

5. **Archive this illumination** once the four `specs/commands.md` additions are committed. No design doc, no plan, no TDD cycle — the file is pure documentation. The diff is straightforward prose following the conventions already in `specs/commands.md`.
