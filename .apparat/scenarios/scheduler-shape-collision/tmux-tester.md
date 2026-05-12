# Skip marker for tmux-tester

This scenario's `pipeline.dot` is documentation-only — it freezes the conceptual
shape of the shape-consumer collision contract for readers. The executable
contract is asserted statically by
`src/cli/tests/scheduler-shape-collision-scenario.test.ts`, which runs the
literal-overlap regex from
`.apparat/pipelines/parallel-illumination-to-implementation/plan-scheduler.md:30`
over `chunked-plan.md` in-process.

Presence of this file tells the `tmux-tester` agent (Phase 2 self-skip rule) to
skip running this scenario, because the nodes (`plan_writer`, `plan_scheduler`,
`assert_dag`) carry no `agent=` attribute and would fail to resolve at runtime.
