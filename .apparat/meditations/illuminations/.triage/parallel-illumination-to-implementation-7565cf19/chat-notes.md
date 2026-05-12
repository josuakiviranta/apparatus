# Chat round notes — 2026-05-12T19:06:50Z

## What the user raised

- **Verify the mental model against the workspace first:** user asked me to confirm my reading of `plan-scheduler.md`, the fe4624db incident, and the illumination's premise against the actual code/run artifacts before recommending anything. User wanted grounding, not analysis-by-vibes.
- **Where does the responsibility belong?** user asked specifically whether c3's plan author (i.e. `plan_writer`) *could have known* it would touch consumer files, and instructed me to "investigate and understand deeply how the pipeline and agents work and how the agents get their context" before answering.
- **Generalization check:** user pushed back that my recommendation cited the specific `LiveFooter.tsx` case and asked whether the rule generalizes to any other code-planning scenario for parallel implementation.
- **Acceptance of recommendation:** user said "Ok" to writing up the notes after I delivered the categorized generalization with named blind spots.

## Conclusions reached

- **The fix belongs in `plan_writer`, not `plan_scheduler`.**
  - Came from: user's question about c3's plan author + instruction to investigate how agents get their context.
  - Rationale: investigation showed `plan_writer` already reads source code before drafting (in fe4624db it read `pipelineEvents.ts`, `pipelineReducer.ts`, `LiveFooter.tsx`, `GateSelector.tsx`, `PipelineRunView.tsx`, `ink.ts`, `run.ts`, `classifyNode.ts` per its transcript). It has Read/Grep/Glob/Task/Skill tools and an existing "ground file-path claims by Globbing $project/src" mandate (`plan-writer.md` Procedure step 4). `plan_scheduler`, by contrast, has a hard rule against "LLM creativity in the DAG construction" (`plan-scheduler.md:81`). The upstream agent has both the context and the latitude; the downstream agent has neither by design.

- **`plan_writer` should `Grep` for importers/references of edited symbols and propagate them to consuming chunks' `Modify:`/`Test:` declarations.**
  - Came from: user's question about whether c3's author could have known + generalization check.
  - Rationale: verified that c3 declared only `pipeline.dot` + one new test file, while actually editing four shared files. With one additional `Grep "from.*pipelineEvents\|LiveBlock"` step, `plan_writer` would have enumerated the consumer test files needing 1-line shape-conformance edits. This is mechanical (import-graph + symbol grep), not speculative inference.

- **The rule must be written in its general form, not the LiveFooter-specific form.**
  - Came from: user's generalization-check question.
  - Rationale: user explicitly tested whether the recommendation overfit to one example. Agreed general form: *"For any chunk that creates, renames, deletes, or changes the signature of an exported symbol (type, function, constant, class) in any file other chunks may consume — Grep for importers/references of both the file path and the symbol name. Every match in a file another chunk will edit must appear in that chunk's `Modify:` declaration."* This covers type-shape changes, function renames/deletes, signature changes, constant renames, schema-file renames, CSS class renames.

- **Carve out known blind spots; do not promise the rule covers them.**
  - Came from: user's generalization-check pressure.
  - Rationale: agreed that the heuristic structurally cannot catch (1) behavior-only changes with stable signatures, (2) cross-language dependencies, (3) runtime-ordering deps like DB migrations and feature flags, (4) test-state races on shared fixtures, (5) implicit string-based references (dynamic imports, reflection), (6) macro-style codegen consumers. For apparatus specifically (TS-only, explicit imports, no codegen) only #1 is a real risk and belongs to the integration test suite, not the scheduler.

- **`plan_scheduler` stays mechanical; it becomes a witness, not an enforcer.**
  - Came from: combination of the user's "where does responsibility belong" question and the existing hard rule in `plan-scheduler.md:81` ("No LLM creativity in the DAG construction").
  - Rationale: rather than adding the shape-edit/consume classification to the scheduler, emit a warning trace event when the scheduler detects a chunk B that edits a file referenced by chunk A's edits where neither declared the overlap. Trace event name reframed as `plan_writer.under_declared_shape_consumer_suspected` so observability points at the right agent. No silent `depends_on` edges added by the scheduler — preserves its "mechanical, single-pass, deterministic" property.

- **Defer the full shape-edit/consume heuristic until a second incident.**
  - Came from: user's "what do you recommend" plus the verified evidence that fe4624db's root cause is an under-declared chunk, not a scheduler heuristic gap.
  - Rationale: the illumination's literal proposal (shape-edit vs shape-consume classification inside `plan_scheduler`) would not have caught the canonical positive case it cites — c3's declared `files_touched` had ∅ intersection with c2's, so no path-based heuristic over declared files fires the edge. Fixing the root cause (`plan_writer` under-declaration) is cheaper and addresses the actual incident; the scheduler heuristic earns its complexity only if `plan_writer` tightening fails on a later deep-driver refactor.

- **Keep illumination Steps 4 and 5 (smoke scenario + trace event); rewrite Steps 1–3.**
  - Came from: user's acceptance of the categorized recommendation.
  - Rationale: the smoke scenario at `.apparat/scenarios/scheduler-shape-collision/` is still cheap evidence-gathering, and the trace event gives us signal for round 2. But Steps 1–3 (classification, collision graph, `depends_on` emission inside the scheduler) move to `plan_writer` as a `Grep`-driven declaration-tightening step.

## Open questions

- **Should the smoke scenario live under `.apparat/scenarios/scheduler-shape-collision/` or be renamed to reflect that the fix moved to `plan_writer`?** — deferred because user did not weigh in on naming; design_writer can settle this when drafting the spec.
- **Behavior-only collisions (signature-stable semantic shifts) are explicitly out of scope** — deferred to integration tests rather than the DAG; user accepted the categorized blind-spot list without asking for any of them to be brought back in.
- **Cross-language / codegen / dynamic-import edge cases** — not in apparatus today; the rule's general form should not pretend to cover them.
