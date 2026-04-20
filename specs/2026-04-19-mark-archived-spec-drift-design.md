# Mark-Archived Spec-Drift Resolution — `archive_reason_short` Design

**Date:** 2026-04-19
**Status:** Approved
**Source illumination:** `meditations/illuminations/2026-04-19T1300-mark-archived-spec-drift.md`
**Supersedes:** `specs/2026-04-19-mark-archived-reason-split-design.md`

## Overview

The prior spec (`mark-archived-reason-split-design.md`) prescribed a two-node split — `mark_archived_invalid` + `mark_archived_decline` — plus an `explain_removal` sidecar writing `$meditations_dir/.triage/$run_id/invalid-reason.txt` to ferry multi-word verifier rationale through `sh -c`. During refactor the pipeline collapsed to a single `mark_archived` node whose `script_args="$illumination_path $choice"` passes the literal gate token `Archive` or `Decline` (see `pipelines/illumination-to-implementation.dot:14-17,58,62`). `explain_removal` no longer exists. Spec and implementation disagree, and archived illuminations now record `reason: Archive` or `reason: Decline` — a two-state flag instead of a rationale. This spec resolves the drift by taking the recommended path (#3 in the illumination): add a shell-safe `archive_reason_short` field to the verifier's structured output and pass it as `mark_archived`'s reason arg. The single-node shape is preserved; the audit trail is restored.

No new nodes, no sidecar file, no engine change.

## What This Fixes

### Primary: stale audit-trail reason in archive frontmatter

`list_illuminations`, future pipeline runs, and meditate sessions read the illumination frontmatter `reason:` field to understand why a prior illumination was closed. Today every archive collapses to one of two tokens:

- `reason: Archive` — verifier rejected it (invalid path).
- `reason: Decline` — human declined after approval gate.

Neither carries the verifier's rationale or the reviewer's reason. Pattern-spotting ("verifier keeps killing 'add telemetry' illuminations for project-fit") is impossible. The original `mark-archived-reason-split` spec flagged this same risk; the current single-node pipeline re-introduces a weaker form of it.

After this change:

- Invalid path: `reason: Feature already implemented at src/bar.ts:42` (verifier's shell-safe one-liner).
- Decline path: `reason: Declined at approval gate` (literal default on the node).

### Secondary: spec/implementation divergence

The two-node + sidecar shape described in the prior spec does not exist in code. Leaving the stale spec in place misleads the next reader. This spec explicitly supersedes it (frontmatter + in-body note).

## What This Does NOT Do

- **No new pipeline nodes.** Single `mark_archived` stays. No reintroduction of `explain_removal`, `mark_archived_invalid`, or `mark_archived_decline`.
- **No sidecar file.** `$meditations_dir/.triage/$run_id/invalid-reason.txt` is not created. The verifier carries the short reason inline in structured output.
- **No engine change.** `src/attractor/handlers/tool.ts` `sh -c` raw-expansion behavior is unchanged. Safety comes from the verifier-emitted reason being pre-constrained to a shell-safe shape — not from engine quoting.
- **No change to `pipelines/scripts/mark-archived.mjs`.** The script already accepts either a file path or a literal reason string (`mark-archived.mjs:13-17`) and collapses whitespace (`mark-archived.mjs:20`). No edits required.
- **No change to verifier's read-only posture.** The verifier emits one additional structured field; it writes no files.
- **No retroactive rewrite of existing archives.** Existing archived illuminations retain whatever `reason:` the old path wrote (`Archive` or `Decline`). Change applies to new archival events only.
- **No decline-reason prompt at `approval_gate`.** The decline path uses a fixed default string. A richer decline-reason UX is out of scope.
- **No change to the `$summary` or `$explanation` fields.** Verifier continues to emit both. `archive_reason_short` is additive.

## Architecture

### Schema: `archive_reason_short` in `pipelines/schemas/verifier.json`

Add a fifth property to the verifier output schema:

```json
"archive_reason_short": {
  "type": "string",
  "description": "Shell-safe one-line reason suitable for archived frontmatter. Emit when preferred_label is 'false'. One sentence, ≤100 chars, no newlines, no shell metacharacters (no $, `, \", ', \\, ;, |, &, <, >, (, ), {, }). Written verbatim into the illumination's frontmatter reason: field if the user archives at remove_gate."
}
```

- **Not added to `required`.** The `preferred_label: true` and `preferred_label: empty` paths do not invoke `mark_archived`, so the field has no consumer on those branches. Making it required would force the verifier to emit a meaningless string on the success path.
- **Absence on the false path is a verifier-contract violation, not a schema violation.** The agent rubric (below) forbids it. If the verifier omits the field when `preferred_label=false`, the pipeline will substitute an empty string for `$archive_reason_short` and the script will exit with the usage error (`mark-archived.mjs:4-7`), which surfaces the bug.
- **`additionalProperties: false` is preserved.** Any other key remains a schema violation.

### Rubric: `src/cli/agents/verifier.md`

Under the existing "Output" section, add a fifth field and a new hard rule:

```
- `archive_reason_short`: required when `preferred_label` is `"false"`. One sentence, ≤100 chars,
  no newlines, no shell metacharacters. The illumination's archive frontmatter reads this verbatim.
  Example: `Feature already implemented at src/bar.ts:42` — not `This illumination is stale because…`.
  Omit (or set to empty) when `preferred_label` is `"true"` or `"empty"`.
```

And in "Hard rules":

```
- On `preferred_label: "false"`, you MUST emit `archive_reason_short`. The mark_archived script
  uses it verbatim as the illumination's archived frontmatter `reason:` value. Treat the shape
  constraints (one sentence, ≤100 chars, shell-safe) as strict.
```

The example reason (`Feature already implemented at src/bar.ts:42`) makes the `file:line` citation style explicit and matches the existing rubric's "Quote real lines, not paraphrases" instruction.

### Pipeline: `pipelines/illumination-to-implementation.dot`

One edit on the `mark_archived` node and one new default attribute:

| Line | Before | After |
|------|--------|-------|
| 14-17 | `mark_archived [type="tool", cwd="$project", script_file="scripts/mark-archived.mjs", script_args="$illumination_path $choice"]` | `mark_archived [type="tool", cwd="$project", script_file="scripts/mark-archived.mjs", default_archive_reason_short="Declined at approval gate", script_args="$illumination_path $archive_reason_short"]` |

Interpretation by branch:

- **Invalid path** (`remove_gate [label="Archive"] -> mark_archived`, line 58). `verifier` emits `archive_reason_short` (short rationale). The node's `default_archive_reason_short` is ignored because the context value is present. Script writes the verifier's reason.
- **Decline path** (`approval_gate [label="Decline"] -> mark_archived`, line 62). `verifier` emitted `preferred_label: true`, so by the rubric `archive_reason_short` is empty/omitted. The node's `default_archive_reason_short="Declined at approval gate"` supplies the value. Script writes the default.

The `default_*` mechanism is the existing pattern used by other nodes (e.g., `design_writer`'s `default_refinements` on line 32) — no new engine feature. The validator's existing variable-producer tracking will see `archive_reason_short` as declared on the verifier (via `produces`) with a default on the consumer; if producer-tracking rules currently warn on gate-side defaults, that warning is acceptable (runtime resolves correctly) and is explicitly out of scope for this spec.

### Producer declaration

Update the verifier node's `produces=` attribute (line 10) to include the new field:

```
produces="preferred_label, illumination_path, summary, explanation, archive_reason_short"
```

This keeps the validator's producer tracking accurate and documents the schema change in the `.dot` itself.

## Components

### 1. `pipelines/schemas/verifier.json`

Add one property. No change to `required`. No change to `additionalProperties`.

### 2. `src/cli/agents/verifier.md`

Add one bullet to the Output section and one rule to Hard rules. No change to the three-criterion rubric, procedure, or read-only posture.

### 3. `pipelines/illumination-to-implementation.dot`

Two edits:

- `verifier` node's `produces=` list gains `archive_reason_short`.
- `mark_archived` node gains `default_archive_reason_short="Declined at approval gate"` and swaps `$choice` → `$archive_reason_short` in `script_args`.

### 4. `specs/2026-04-19-mark-archived-reason-split-design.md`

Prepend a `**Status:** Superseded by specs/2026-04-19-mark-archived-spec-drift-design.md` line in the frontmatter block, and a one-paragraph note at the top of the body explaining why (single-node collapse, `archive_reason_short` substitutes for the sidecar). Body content stays for historical reference — do not delete.

### 5. Regression test surface (new)

A test that drives both archive paths end-to-end against a fixture illumination and asserts the resulting frontmatter `reason:` value. Preferred location: a new scenario under `src/cli/__tests__/scenarios/` following the existing scenario-test shape. Minimum assertions:

- Invalid path: `reason:` equals the verifier's `archive_reason_short` verbatim, not the literal `Archive`.
- Decline path: `reason:` equals `Declined at approval gate`, not the literal `Decline`.
- Absent-field guard: when the verifier skips `archive_reason_short` on the false path, the pipeline fails loudly (script exits non-zero with usage error); it does not silently write an empty `reason:`.

Exact test mechanics are the plan's to specify; this spec pins the assertions.

## Data Flow

### Invalid path (verifier rejected)

```
verifier
  emits { preferred_label: "false",
          illumination_path: ".../xxx.md",
          summary: "…",
          explanation: "pipelineFailed boolean already present; process.exitCode …",
          archive_reason_short: "pipelineFailed boolean already present at src/attractor/engine.ts:221" }
    │
    ▼
remove_gate   (label shows $illumination_path + $explanation)
    │
    └── Archive ──> mark_archived
                          │
                          │  sh -c "node pipelines/scripts/mark-archived.mjs \
                          │          meditations/illuminations/xxx.md \
                          │          pipelineFailed boolean already present at src/attractor/engine.ts:221"
                          │
                          │  (argv tokenized; script joins argv[3..] — see Script-tokenization note below)
                          │
                          │  writes frontmatter:
                          │    status: archived
                          │    archived_at: 2026-04-20
                          │    reason: pipelineFailed boolean already present at src/attractor/engine.ts:221
                          │
                          ▼
                         done
```

### Decline path (human declined at approval gate)

```
approval_gate
    │
    └── Decline ──> mark_archived
                          │
                          │  $archive_reason_short is absent in context (verifier
                          │  skipped it on the true path). Node's
                          │  default_archive_reason_short supplies the value.
                          │
                          │  sh -c "node pipelines/scripts/mark-archived.mjs \
                          │          meditations/illuminations/xxx.md \
                          │          Declined at approval gate"
                          │
                          │  writes frontmatter:
                          │    status: archived
                          │    archived_at: 2026-04-20
                          │    reason: Declined at approval gate
                          │
                          ▼
                         done
```

### Script-tokenization note

The verifier's `archive_reason_short` contains spaces (it is a sentence). After engine raw-expansion, `sh -c` tokenizes the space-separated words into multiple argv entries. `mark-archived.mjs` currently reads only `process.argv[3]` (`mark-archived.mjs:3`) and would drop everything after the first word.

The plan must resolve this. Two options:

1. **Script change** — rebuild the reason as `process.argv.slice(3).join(" ")` before the file-vs-literal branch. The existing `/\s+/g` whitespace collapse on line 20 already handles the resulting multiple-space artifacts. Preferred — self-contained and matches the existing whitespace-normalization comment.
2. **Verifier constraint** — require `archive_reason_short` to use hyphens or underscores instead of spaces. Possible but compresses legibility (`feature-already-implemented-at-src-bar-ts-42`); rejected as a worse UX.

This spec picks option 1. The decline-path default (`"Declined at approval gate"`) is itself multi-word, so the script change is required regardless of how verifier formats the invalid-path reason.

### Variable visibility

| Node | `$illumination_path` | `$archive_reason_short` | Reason source |
|------|:---:|:---:|---|
| `mark_archived` (invalid) | ✅ (from `verifier`) | ✅ (from `verifier`) | verifier field |
| `mark_archived` (decline) | ✅ (from `verifier`) | ✅ (node `default_*`) | `"Declined at approval gate"` |

All values passed to `script_args` are path-safe or rubric-constrained.

## Constraints

- **Schema + rubric are co-load-bearing.** The schema leaves the field optional because the success path has no consumer. The rubric makes it required on the false path. Both must land together, or the invalid path writes empty reasons.
- **Script must join argv[3..].** Without this, multi-word reasons are truncated to the first word. Specified in Data Flow → Script-tokenization note; the plan codifies it.
- **Rubric example must use `file:line` citation style.** Keeps the reason informative for pattern-spotting. Example string in the rubric is part of this spec, not a plan-time choice.
- **Shell-safety is verifier's responsibility.** The verifier is opus-class; treat the shell-metacharacter blacklist as part of the contract and test with a fixture that contains edge characters (e.g., a backtick in a filename). If a future verifier emits a disallowed character, the script's `/\s+/g` collapse will not sanitize it — safety lives in the agent.
- **Idempotency preserved.** `mark-archived.mjs:33-41` already handles re-runs (same-reason → `{"idempotent": true}`, different-reason → error). No change needed.
- **No landing gate beyond ralph's normal suite.** `npm run build && npm test` green, `ralph pipeline validate pipelines/illumination-to-implementation.dot` green, the new scenario test green.
- **Superseded spec stays in-tree.** Delete would break git-log archaeology. A superseded header is the lowest-churn signal.

## What This Excludes

- **Default-var whitelist extension.** Earlier discussion (original illumination step 3) mentioned a `default_archive_reason_short` may depend on a "default-var whitelist fix." Investigation for this spec shows `default_*` is already the generic attribute mechanism used elsewhere (e.g., line 32's `default_refinements`); no whitelist fix is required. If the validator does warn on `default_archive_reason_short`, treat that as a separate validator-tracking task, not a blocker.
- **A structured decline-reason UX.** Letting the human type a decline reason at `approval_gate` is a desirable future feature. Out of scope — changes gate UX, engine gate-value contract, and would make `archive_reason_short` load-bearing on the true path too.
- **Retroactive re-archival of existing illuminations.** Users can hand-edit if they care.
- **A verifier schema-level length/charset enforcer.** JSON Schema's `pattern` or `maxLength` could enforce the constraints structurally. Deferred because the rubric + opus agent handle it today; add structural enforcement only if we see a real violation.
- **Changes to `mark-dispatched.mjs` or its test file.** Unrelated script; not touched.
- **Reinstating `explain_removal`.** The verifier's `$explanation` is already interpolated directly into `remove_gate`'s label (line 12). A second agent-node rendering the same content would be pure duplication.
- **Commit-message prescription.** Plan's to write when the chunks land.
