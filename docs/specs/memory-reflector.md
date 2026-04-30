# memory-reflector

Tail node of `pipelines/illumination-to-implementation.dot`. Runs after `memory_writer` finalises the session.

## Responsibility

Read the memory file just written, cross-reference it against the design / plan / original illumination, and decide whether the run surfaced anything worth filing as a new illumination. Emit zero or one illumination per invocation.

The downstream verifier + human review gate already filter for "is this worth implementing", so the reflector's bar is "is this worth surfacing", not "is this worth implementing".

## Inputs

- `$run_id` — pipeline run identifier
- `$project` — repo root
- `$memory_path` — memory-writer output
- `$design_doc_path`, `$plan_path` — upstream artifacts
- `$illumination_path` — original path of the illumination file (deleted by `consume` on implement; reflector records path as provenance even after deletion)

## Output

Structured JSON: `{illumination_path: string | null, reasoning: string}`. `null` denotes a deliberate skip. `reasoning` is always present so the pipeline trace records the call.

## Idempotency

Reflector globs `meditations/illuminations/*.md` and greps each body for `Pipeline run id: <run_id>` before writing. On `--resume`, a partial run that already wrote the illumination is detected and the existing path is returned without a duplicate write.

## Provenance

Reflector-written illuminations carry provenance in a final `## Provenance` body section listing the source memory, run id, and writer. Frontmatter shape is identical to meditate-written illuminations (date, description) so downstream tooling cannot distinguish writers structurally.

## Failure mode

Errors propagate. Memory-writer has already committed and pushed by the time reflector runs, so a reflector failure does not lose work. Recovery is `ralph pipeline run ... --resume <runId>`.
