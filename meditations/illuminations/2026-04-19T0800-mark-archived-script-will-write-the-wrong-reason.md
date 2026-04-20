---
date: 2026-04-18
status: dispatched
description: T0000 and T2300 both specify $summary as the reason arg for mark-archived.mjs, but $summary is the verifier's topic description — the false path needs $explanation (invalidity rationale) and the approval-decline path needs a reason no variable currently captures.
dispatched_at: 2026-04-19
plan_path: docs/superpowers/plans/2026-04-19-mark-archived-reason-split.md
---

## Core Idea

T0000 and T2300 both specify `script_args="$illumination_path $summary"` for the `mark_archived` script conversion. `$summary` is the verifier's topic description — e.g., "T0900: pipeline exits 0 on engine failure." That is what the illumination is *about*, not why it was archived. On the false path (verifier rejected), the correct reason is `$explanation` — the verifier's specific invalidity rationale (e.g., "pipelineFailed boolean already present; process.exitCode assignment already committed"). On the approval-decline path, no variable in context captures "human chose not to proceed after reviewing the explainer output." The script will write the wrong string into the frontmatter `reason` field in both cases.

## Why It Matters

`mark-archived.mjs` will be modeled on `mark-dispatched.mjs`. Read that script: it writes `plan_path` into the illumination frontmatter. `mark-archived.mjs` will write `reason`. That `reason` field is the only audit trail for why an illumination was closed without implementation. Future meditate sessions call `list_illuminations` — the reason field is what the analyst reads to understand whether a prior observation was superseded, proven wrong, or declined. "T0900: pipeline exits 0 on engine failure" is not a useful reason. "Verifier found the pipelineFailed boolean and process.exitCode = 1 already present" is.

The `mark_archived` node in `illumination-to-implementation.dot` has two callers:
1. `remove_gate -> mark_archived [label="Yes"]` — archive an illumination the verifier flagged as invalid and the human confirmed should be removed.
2. `approval_gate -> mark_archived [label="Decline"]` — archive an illumination that passed verification but the human chose not to implement.

These are semantically different acts. For path 1, `$explanation` is the right reason (it is the verifier's invalidity rationale). For path 2, no pipeline variable captures the human's reason — `$explanation` on the true path contains the verifier's *validity* rationale, which is the opposite of why it was archived.

If T0000's script conversion lands with `script_args="$illumination_path $summary"`, every archived illumination — regardless of path — will have a topic description as its reason. The archive becomes a list of topics, not a list of dispositions.

## Revised Implementation Steps

1. **Split `mark_archived` into two nodes in `illumination-to-implementation.dot`.** Name them `mark_archived_invalid` (false path) and `mark_archived_decline` (true path). Both are `type="tool", script_file="scripts/mark-archived.mjs"`, but with different `script_args`:
   - `mark_archived_invalid`: `script_args="$illumination_path $explanation"` — the verifier's invalidity rationale is the reason.
   - `mark_archived_decline`: `script_args="$illumination_path 'Declined at approval gate'"` — literal string, since no pipeline variable captures the human's reason.

2. **Update routing edges.** Change:
   - `remove_gate -> mark_archived [label="Yes"]` → `remove_gate -> mark_archived_invalid [label="Yes"]`
   - `approval_gate -> mark_archived [label="Decline"]` → `approval_gate -> mark_archived_decline [label="Decline"]`
   Remove the original `mark_archived` node declaration.

3. **Write `pipelines/scripts/mark-archived.mjs` to accept `<illumination-path> <reason>`.** Model on `mark-dispatched.mjs`: parse args, read frontmatter, reject if not `open`, write `status: archived` + `archived_at: <today>` + `reason: <arg2>`. Idempotency guard: if already `archived` with the same reason, return `{ marked_archived: path, idempotent: true }` and exit 0; if already `archived` with a different reason, exit 1 with an error.

4. **Add a test in `pipelines/scripts/tests/mark-archived.test.mjs`** covering: open → archived (correct frontmatter written), idempotent repeat (same reason → exit 0, `idempotent: true`), conflicting reason (exit 1), non-open status (exit 1). Follow the structure of `mark-dispatched.test.mjs` using the existing fixtures in `pipelines/scripts/tests/fixtures/`.

5. **Apply this fix as part of T0000's unified commit** — not as a follow-on. The split is four lines in the `.dot` file (two new node declarations replacing one, two edge updates). Bundling it with T0000 keeps the false-path cluster resolved in a single coherent diff. If T0000 has already landed with `script_args="$illumination_path $summary"`, apply steps 1–2 as a two-line patch to the `.dot` file and a one-line change to the script invocation.
