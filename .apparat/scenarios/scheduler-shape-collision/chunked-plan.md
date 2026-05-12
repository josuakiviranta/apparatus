# Shape-consumer collision fixture plan

This is a fixture plan for `.apparat/scenarios/scheduler-shape-collision/`.
It freezes the contract that `plan_scheduler`'s literal-overlap algorithm
(`.apparat/pipelines/parallel-illumination-to-implementation/plan-scheduler.md:30-32`)
emits `c2.depends_on === ["c1"]` once `plan_writer`'s symbol-consumer Grep step
has propagated the shared file into c2's `Modify:` declaration.

## Chunk 1: Reshape SharedThing

- Modify: `src/lib/shared-thing.ts`
- Test: `src/tests/shared-thing.test.ts`

## Chunk 2: Add consumer that imports SharedThing

- Create: `src/lib/consumer.ts`
- Modify: `src/lib/shared-thing.ts`
- Test: `src/tests/consumer.test.ts`

plan_writer.under_declared_shape_consumer_suspected: c2 -> src/lib/shared-thing.ts
