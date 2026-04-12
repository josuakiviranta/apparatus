# Headless Governance Gates — COMPLETED (0.0.63)

All tasks implemented and shipped as tag `0.0.63`.

## What was done

- **Task 1.1**: Added `headlessSafe?: boolean` to `Graph` interface in `src/attractor/types.ts`
- **Task 1.2**: Parse `headless_safe` DOT graph attribute in `parseDot()` — `src/attractor/core/graph.ts`
- **Task 1.3**: Reordered gate labels in `pipelines/illumination-to-plan.dot` for safe defaults, added `headless_safe=false`
- **Task 2.1**: Added TTY guard in `pipelineRunCommand()` — `src/cli/commands/pipeline.ts`
- **Task 2.2**: Added warning in heartbeat pipeline registration — `src/cli/commands/heartbeat.ts`
- **Task 2.3**: All 604 tests pass, build clean, smoke test + dotfile validation pass

## Reference spec
`docs/superpowers/specs/2026-04-12-headless-governance-gates-design.md`
