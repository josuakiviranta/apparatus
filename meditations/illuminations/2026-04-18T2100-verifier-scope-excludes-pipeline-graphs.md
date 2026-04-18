---
date: 2026-04-18
status: open
description: The verifier in illumination-to-implementation.dot is scoped to src/ and specs/ — it never reads pipelines/*.dot — so topological claims about graph structure pass verification unchallenged, as T2100's prescription of a node that already existed as mark_archived demonstrates.
---

## Core Idea

The `verifier` node in `illumination-to-implementation.dot` is instructed to check `src/` for code behavior claims and `specs/*.md` for specification claims. Its prompt contains no instruction to read `pipelines/*.dot` files. Illumination T2100 ("replace `delete_file` with `archive_invalid`") was marked `preferred_label=true` and dispatched despite prescribing the creation of a node that already exists in `illumination-to-implementation.dot` under a different name: `mark_archived`. The verifier confirmed `delete_file` was real (it is), confirmed no `archive_invalid` existed in `src/` or `specs/` (correct), but never read the graph topology to discover `mark_archived` already serving the archival function. T1900 was written by a human who caught the error after the fact. In normal pipeline operation — no human review between verifier and approval gate — the error would have reached the implementer, who would have added `archive_invalid` alongside the existing `mark_archived`, producing a graph with two nearly-identical nodes both calling `mcp__illumination__mark_archived`.

## Why It Matters

The verifier is the pipeline's quality gate. Every illumination it passes with `preferred_label=true` is certified as describing a real, still-present problem. When the verifier certifies topological claims it cannot check, it produces false positives — illuminations that look valid but prescribe infrastructure that already exists or conflicts with current graph structure.

Pipeline graphs are now load-bearing architecture in this project. `illumination-to-implementation.dot` defines the triage workflow, the decision branches, the state machine for every illumination the project generates. It is not a generated artifact that regenerates from TypeScript; it is the authoritative source. Treating it as outside the verifier's scope is equivalent to a TypeScript verifier that reads type definitions but skips the implementation files.

The risk is systemic, not incidental. Any illumination that proposes adding, renaming, removing, or re-routing pipeline nodes will reach the approval gate unchallenged if the topological claim appears consistent with `src/` and `specs/`. Today's false-path cluster — six open illuminations, all targeting the same five-node region — would have collapsed to four if the verifier had read `illumination-to-implementation.dot` before passing T2100. The `mark_archived` node is on line 18 of the file the verifier lives in.

## Revised Implementation Steps

1. **Add `pipelines/*.dot` as a third verification scope in the `verifier` node's prompt.** After the line "Check `specs/*.md` to verify claims about specifications", add: "Check `pipelines/*.dot` to verify claims about pipeline graph topology — node declarations, edge routing, edge labels, `produces=` attributes, `type=` values, and node attribute lists. If the illumination proposes adding a node, confirm no node with equivalent purpose exists under a different name before returning `preferred_label=true`." This is a prompt edit to one string in `illumination-to-implementation.dot` — no code change required.

2. **Add a topological accuracy criterion to the verifier's verification list.** The current two criteria are: "Still relevant: the issue or gap exists in the current code" and "Technically accurate: the claims match what the source code actually does." Add a third: "Topologically accurate: if the illumination proposes a pipeline graph change, no proposed new node already exists under a different name, and no proposed edge re-route contradicts a current edge the illumination does not mention." This criterion is what would have caught T2100 — `mark_archived` existed and served the same archival function T2100 proposed for `archive_invalid`.

3. **Validate the scope fix against T2100 before archiving it.** T1900 recommends archiving T2100. Before doing so, run the updated pipeline against T2100 and confirm the verifier now returns `preferred_label=false` — because `mark_archived` exists and serves the function T2100 prescribes for `archive_invalid`. This serves as both a regression test for the scope fix and confirmation that the updated verifier would have caught the error at source.

4. **Re-run verification on the remaining open false-path illuminations under the expanded scope.** T1100 (re-route `remove_gate→No` to `approval_gate`) proposes an edge change not present in the graph — it should still pass. T1500 (no `produces=` on `explain_removal`) is a node attribute claim readable directly from the `.dot` file — it should still pass. T1700 is superseded by T1900 regardless; archive it before the next verifier run to avoid a wasted dispatch.

5. **Consider path-mention heuristic for future scope coverage.** The current three-scope approach (`src/`, `specs/`, `pipelines/`) still requires manual updates when new directories become load-bearing. A forward-compatible extension: instruct the verifier that if an illumination file path-references a specific file (e.g., `pipelines/illumination-to-plan.dot`, `pipelines/schemas/verifier.json`), read that file as part of verification. Path mentions in illumination prose are already common and would serve as implicit scope declarations. This removes the need for prompt updates when new pipeline files are added.
