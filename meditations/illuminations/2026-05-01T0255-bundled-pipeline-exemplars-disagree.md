---
date: 2026-05-01
description: The three bundled pipelines (meditate, janitor, implement) are the canonical exemplars but they disagree on goal, headless_safe, inputs, and quoting style — and program.ts help still shows a prompt="..." anatomy that no bundled pipeline uses, so every authoring session starts from contradictory samples.
---

## Core Idea

VISION.md frames `illumination-to-implementation` as the canonical example and pipelines as ralph's primary extension surface. Authoring a new pipeline today is a fork-from-exemplar exercise (gene transfusion), but the four exemplars in the repo — `src/cli/pipelines/{meditate,janitor,implement}/pipeline.dot` and `pipelines/illumination-to-implementation/pipeline.dot` — disagree on every optional convention, and the help text in `program.ts` advertises a `prompt="..."` agent-node shape that *no* bundled pipeline uses. Because forking is the authoring UX, contradictory exemplars are not stylistic noise; they are the authoring docs lying about themselves.

## Why It Matters

Concrete drift, file:line cited:

- **`meditate/pipeline.dot:2`** declares `inputs="steer,vision,specs_dir"` but `src/cli/commands/meditate.ts:80` always overwrites `vision` with the on-disk `VISION.md`: `vision: readVisionIfPresent(absPath)`. `vision` is *not* a caller-supplied input — it is command-managed. The pipeline contract is fiction for that key. Anyone running `ralph pipeline run meditate --var vision=...` finds their value silently dropped — and the validator will not catch it because the input *is* declared.
- **Three exemplars, three shapes** for the same optional metadata:

  | File | `goal=` | `headless_safe=` | `inputs=` |
  |------|---------|------------------|-----------|
  | `meditate/pipeline.dot` | absent | absent | present |
  | `janitor/pipeline.dot` | present | `true` | present |
  | `implement/pipeline.dot` | present | absent | present |
  | `illumination-to-implementation/pipeline.dot` | present | `false` | present |

  `headless_safe` defaults silently when omitted, so `implement` and `meditate` work today; the inconsistency is invisible at runtime but lethal for fork-and-edit. An author who copies `meditate/` will produce a pipeline that has no goal, no headlessness contract, and a phantom input.
- **`program.ts:88-104`** is the "DOT file anatomy" help that every `ralph --help` user sees. It shows `work [shape=box, prompt="...", max_iterations=2]` as the canonical work-node shape. **Zero** bundled pipelines use `prompt=` on agent nodes — every one uses `agent="<name>"` plus a sibling `.md` file. `docs/specs/pipeline.md` states "agent-node `prompt=` is *not* variable-expanded — agent inputs are injected automatically via the Inputs block rendered from agent frontmatter." That sentence describes a half-extracted state: the attribute is documented, the spec says it doesn't variable-expand, no exemplar uses it, and the help text recommends it. Either delete it or commit to it — the current limbo is the worst of both.
- **`produces_from_stdout` quoting drift:** `janitor/pipeline.dot:9` writes `produces_from_stdout=true` (bare); `implement/pipeline.dot:10` writes `produces_from_stdout="true"` (quoted); both parse identically but they're the two bundled exemplars side-by-side. Authors copying both end up with mixed style in their own pipelines.
- **Scenario-author working-tree diff (`src/cli/pipelines/implement/scenario-author.md`)** just trimmed `scenario_paths: string[]` and `summary: string` from `outputs:`, leaving only `tests_written: boolean`. That's correct — the agent's job is the side effect (write scenario files), and the only signal callers need is "did it write any". But this is a load-bearing convention nowhere documented: when an agent's job is side-effect-only, `outputs:` should be one boolean. Without that codified, the next side-effect agent author copies the previous shape and re-introduces fictitious string outputs.

This connects to the steer ("simpler pipeline creation, management"). Authoring is forking — and right now, forking from any exemplar bakes in at least one drift. The fix is not a feature; it is canonising the four bundled pipelines so they all teach the same lesson.

Adjacent illuminations:
- `2026-05-01T0050-pipeline-location-drift-vs-vision.md` covers *where* pipelines live; this one covers *what shape* they should be once they live there.
- `2026-05-01T0211-pipeline-lifecycle-cli-surface-gap.md` step 6 calls out "fork an existing pipeline" as the right authoring UX. This illumination is the prerequisite work — exemplars must be coherent before "fork from one" becomes a usable affordance.

## Revised Implementation Steps

1. **Add `src/cli/tests/bundled-pipeline-shape.test.ts`.** Walk every `src/cli/pipelines/*/pipeline.dot` and `pipelines/illumination-to-implementation/pipeline.dot`. Assert each declares `goal=` (non-empty), `headless_safe=` (`true` or `false`, no default), and only lists `inputs=` keys actually consumed by callers. Failing this test is the cheapest insurance against re-drift. Mirror the lens of `templates-validate.test.ts`.

2. **Fix `meditate/pipeline.dot`.** Drop `vision` from `inputs=`; it is command-managed. Add `goal="Surface insights into meditations/illuminations/"` and `headless_safe=false` (it spawns Claude interactively under MCP, never wants headless). Re-run `templates-validate.test.ts` and the new shape test.

3. **Fix `implement/pipeline.dot`.** Add `headless_safe=true` (the loop already runs unattended). Quote `produces_from_stdout="true"` to match the rest of the file's quoting style, *or* unquote `janitor`'s — pick one and lint-enforce it (warning level in `validateGraph`).

4. **Resolve `prompt=` on agent nodes.** Either (a) delete the attribute from the schema and rewrite the `program.ts:88-104` help to show `agent="<name>"` with a sibling `.md`, or (b) commit to it as a tiny-pipeline shortcut for prompts that have no `inputs:` and no per-call frontmatter, and add an exemplar that uses it. The middle ground (documented, advertised in help, used by nobody) is the current bug.

5. **Add `src/cli/pipelines/README.md`.** One screen: "Each subfolder is a bundled pipeline used as both runtime asset and authoring exemplar. To author a new pipeline, copy `<recommended-canonical>` (folder + sibling `.md` files) into your project's `pipelines/<name>/`. Each bundled pipeline declares the canonical shape; lint-tested by `bundled-pipeline-shape.test.ts`." Anchors the "fork from exemplar" UX the steer points at.

6. **Codify the side-effect-only agent contract** in `docs/specs/pipeline.md` under "Agent Schema Descriptions" or a sibling section: when an agent's purpose is to produce filesystem side effects, `outputs:` should be a single boolean signalling completion (e.g. `tests_written: boolean`). Reference the current `scenario-author.md` shape. Removes the temptation to fabricate string outputs that no downstream node consumes.

7. **Once 1-6 are green, add `ralph pipeline new <name> [--from <bundled-name>]`** that copies a chosen bundled pipeline folder into `<project>/pipelines/<name>/`, runs `ralph pipeline validate <name> --project <project>`, and opens `pipeline.dot` in `$EDITOR`. This is the lifecycle illumination's step 6 — but it only becomes useful once exemplars stop contradicting each other. Authoring = "fork an example", and that requires examples worth forking.
