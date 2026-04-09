# Implementation Plan

No outstanding items. All tasks complete.

## Completed

- **Pipeline nodes overview IDs fix** (0.0.48): Changed `n.label ?? n.id` to `n.id` in `src/cli/commands/pipeline.ts:105`. Added regression test in `src/cli/tests/pipeline.test.ts`. Gate labels contain multi-line prompts with `$variables` — not suited for one-line overview.
