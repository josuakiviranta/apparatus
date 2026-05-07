# Chat round notes — 2026-05-07T22:40

## What the user raised

- **"So if implemented how output will look like exactly?"** — wanted concrete shapes for the three new design-time surfaces (`pipeline preview`, `pipeline explain`, `pipeline trace --node-receive` addition) before approving.
- **"Use illumination-to-implementation pipeline as example"** — wanted the `pipeline explain` output drawn against a real, complex pipeline (15 nodes, 4 gates, 3 loops) rather than a toy.
- **"Does this implementation need a lot of code changes?"** — wanted the blast radius re-confirmed and broken down per-file before committing.
- **"What does `stimuli/deep-modules-hide-complexity.md` say about this implementation?"** — wanted the plan checked against the cited stimulus, not just name-dropped.
- **"What's your take, should we do this implementation?"** — wanted a concrete recommendation, not a neutral summary.
- **"Yep ok let's drop step 5 and continue"** — accepted recommendation; explicitly removed step 5 (`.last-rendered/` mirror) from scope.

## Conclusions reached

- **Ship steps 1, 2, 3, 4, 6 of the illumination. Drop step 5. Step 7 stays deferred.**
  - Came from: "let's drop step 5 and continue" + prior agreement that step 7 was already deferred to the authoring-loop illumination.
  - Rationale: Step 5 (`.last-rendered/` mirror) solves a real-but-rare "lazy prune nuked my evidence" problem at the cost of a per-node-per-run write. User accepted the recommendation to defer until evidence loss is observed in practice. `cp -r .apparat/runs/<id>/` is an adequate manual workaround in the meantime.

- **`pipeline preview <pipeline> --node <id> --var k=v` is the headline feature.**
  - Came from: implicit acceptance of the "killer feature" framing in the recommendation turn (user moved on without pushback) plus explicit confirmation via the example output sketch.
  - Rationale: Today the edit → see-LLM-input loop is structurally impossible without a full pipeline run + dig into `.apparat/runs/<runId>/<nodeId>/prompt.md`. Steps 1+2 alone close that gap; everything else is supporting work on the same seam.

- **`pipeline explain <pipeline>` output format: plain-text node list with `consumes:` / `produces:` / `branches:` / `next:` per node, plus a separate Loops section and Reachability check.**
  - Came from: user requested a concrete render against `illumination-to-implementation` and accepted the format shown without revisions.
  - Rationale: Output must run in any terminal (no SVG, no Graphviz), pipe to `less`/`grep`, and answer "what does this pipeline do?" without forcing the author to stare at a graph. Phase comments from the `.dot` source become section headers.

- **`pipeline trace --node-receive` gets exactly one new line: `prompt: <runDir>/<nodeId>/prompt.md`.**
  - Came from: format confirmed in the example output turn, no objection raised.
  - Rationale: Minimal trace.ts edit (~3 lines). Closes the gap between "node started with these keys" and "and here is the literal text it received."

- **Step 1 (pure-core split of `assembleAgentPrompt` into `buildAgentPrompt`) is the linchpin and must preserve the existing signature.**
  - Came from: confirmed via the deep-modules-stimulus alignment discussion and the verifier's "no breaking changes" finding.
  - Rationale: The existing signature is consumed by `looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`, `tests/agent-prep.test.ts:44,71,92`. Pure split is the seam that both runtime and `pipeline preview` consume — textbook deep-module move per `stimuli/deep-modules-hide-complexity.md`.

- **Documentation work (step 6) is not optional and lives in `pipelines.md`.**
  - Came from: deep-modules stimulus discussion, where the user accepted the framing that "interface = method signatures **and** documentation about how/when to call them."
  - Rationale: Tag-mangling rule (`<sourceNode>_<localKey>` from `inputs-resolver.ts:41`) is currently undocumented in the live `src/cli/skills/apparatus/pipelines.md` reference — verifier confirmed it's NOT in there at all (illumination's "buried in one paragraph" claim was an overstatement; the gap is larger). New §8 + inputs-block subsection in §3 are required, not nice-to-haves.

- **Hold the line on `--var` parsing scope.**
  - Came from: user implicitly accepted the "where it could go wrong" warning in the recommendation turn.
  - Rationale: Literal substitution + agent-frontmatter defaults only. Anything fancier (env vars, `$project` resolution, full `pipeline run` semantics) becomes a follow-up illumination, not part of this scope. Otherwise blast radius slides from M to M-large.

- **Hold the line on `pipeline explain` output style.**
  - Came from: user accepted the sketched format without asking for ASCII art or graph rendering.
  - Rationale: "Plain English" per illumination step 3. Resist the urge to ASCII-art the topology; output stays as a structured text list, not a tree.

- **Blast radius confirmed: M-sized, ~13–15 files, ~360 lines, no breaking changes.**
  - Came from: user asked "does this need a lot of code changes?" and accepted the breakdown.
  - Rationale: Verifier's estimate stands. Ceiling of ~450 lines if `--var` parsing or loop-detection grow; both are scope-controlled by the prior bullets above.

- **Sequencing left to implementer's discretion: single PR or two-PR split (pure-core split + docs first, then preview/explain).**
  - Came from: presented as an option in the recommendation turn; user did not pick one explicitly.
  - Rationale: Both work. Two-PR split lands the seam first and minimises review surface per PR. Single PR is fine for an M-sized change. Default to single PR unless implementer prefers smaller review chunks.

## Open questions

- **Should `pipeline preview` accept a `--show-schema` flag to also print the JSON schema derived from the agent's `outputs:` frontmatter?** — deferred because not in illumination scope; the rendered prompt is the headline, schema visibility can be a follow-up if authors ask for it.
- **Should `pipeline explain` group nodes by phase comments from the `.dot` source, or by topological levels?** — deferred to implementer; phase comments (when present) are richer and the example output uses them, but pipelines without phase comments will fall back to topological grouping. Decide at implementation time based on `.dot` parser availability.
- **PR sequencing (single vs. two-PR split)** — deferred to implementer per rationale above.
