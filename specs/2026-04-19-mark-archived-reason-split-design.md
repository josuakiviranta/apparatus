# Mark-Archived Reason-Arg Split Design

**Date:** 2026-04-19
**Status:** Superseded by [`specs/2026-04-19-mark-archived-spec-drift-design.md`](2026-04-19-mark-archived-spec-drift-design.md)
**Source illumination:** `meditations/illuminations/2026-04-19T0800-mark-archived-script-will-write-the-wrong-reason.md`

> **Superseded.** During refactor the `mark_archived` pipeline collapsed from a two-node split (`mark_archived_invalid` + `mark_archived_decline`) plus an `explain_removal` sidecar to a single `mark_archived` node. The successor spec adds a shell-safe `archive_reason_short` verifier field that ferries the rationale inline through `sh -c` — obviating both the sidecar file and the node split. Body retained for historical context (audit-trail motivation and shell-tokenization analysis are still load-bearing); do not use the prescribed architecture.

## Overview

Two in-flight illuminations (T0000 and T2300) prescribe converting the current `mark_archived` agent node in `pipelines/illumination-to-implementation.dot` into a script tool modeled on `pipelines/scripts/mark-dispatched.mjs`, with `script_args="$illumination_path $summary"`. `$summary` is the verifier's topic description ("T0900: pipeline exits 0 on engine failure"), not a reason for archival. Writing that value into the illumination's frontmatter `reason` field would make the archive a list of topics instead of a list of dispositions — the only audit trail future `list_illuminations` callers use to distinguish "superseded", "proven wrong", and "declined".

The fix is a data-layer split. Replace the single `mark_archived` node with two script-tool nodes that write semantically correct reasons:

- `mark_archived_invalid` — false path (verifier rejected, human confirmed removal). Reason is the verifier's full invalidity rationale, read from a deterministic sidecar file that `explain_removal` writes. Passing the file path (not the prose) is the only way to ferry multi-word text through `sh -c` under the engine's current tokenization.
- `mark_archived_decline` — approve-decline path (verifier accepted, human declined to implement). Reason is a literal single-quoted string `'Declined at approval gate'`. Single-quoted literals are honored by `sh -c`'s tokenizer and contain no shell metacharacters, so this path needs no sidecar file.

Bundled: a new `pipelines/scripts/mark-archived.mjs` modeled on `mark-dispatched.mjs` but with a subtle asymmetry — arg2 can be either a literal reason string (decline path) or a path to a reason file (invalid path). The script treats arg2 as a file path if it exists on disk; otherwise it treats arg2 as a literal reason string. A matching vitest file `pipelines/scripts/tests/mark-archived.test.mjs` covers both modes. A one-line addition to `explain_removal`'s prompt instructs it to also write the full `$explanation` verbatim to `$meditations_dir/.triage/$run_id/invalid-reason.txt` so the invalid-path script can find it.

This design **bundles into T0000's unified commit** and is not independently landable. The engine's `graph.ts:289` reachability check errors on declared-but-unreferenced nodes, so the two new nodes must be introduced in the same diff that retargets `approval_gate [Decline]` and `remove_gate [Yes]` to them. T0000 already changes those edges; this spec's diff folds in.

No engine changes, no validator changes, no schema changes.

## What This Fixes

### Primary: wrong-reason bug in prescribed script conversion

T0000 (line 33) and T2300 (line 25) both specify `script_args="$illumination_path $summary"` for the future script-tool form of `mark_archived`. `$summary` is the verifier's topic description. The `reason` field in an illumination's frontmatter is the only audit trail future meditate sessions read via `list_illuminations` to understand prior dispositions. Compare:

- Wrong: `reason: T0900: pipeline exits 0 on engine failure.`
- Right (invalid path): `reason: pipelineFailed boolean already present; process.exitCode assignment already committed.`
- Right (decline path): `reason: Declined at approval gate.`

### Bundled: the script shape itself

T0000 assumes a `pipelines/scripts/mark-archived.mjs` will be written but does not spec its contract. This spec pins the contract: near-exact clone of `mark-dispatched.mjs` with frontmatter field renames (`dispatched` → `archived`, `dispatched_at` → `archived_at`, `plan_path` → `reason`), plus the file-path-or-literal arg2 branch described in Architecture.

### Bundled: reason-file emission in `explain_removal`

`explain_removal` today produces a one-sentence user-facing message for the `remove_gate` prompt. This spec extends its prompt to also write the full verifier `$explanation` verbatim to `$meditations_dir/.triage/$run_id/invalid-reason.txt`. The existing `.triage/$run_id/` directory is already established infrastructure (used by `chat_session` for `chat-notes.md`), so the new file is a natural addition.

## What This Does NOT Do

- **No engine changes.** Specifically, no change to the `sh -c` variable-expansion semantics in `src/attractor/handlers/tool.ts:96-101`. The shell-quoting limitation is worked around by (a) passing a file path for prose reasons and (b) using a space-containing literal only inside single quotes in the `.dot` source.
- **No new pipeline variables.** `$illumination_path`, `$explanation`, `$meditations_dir`, `$run_id` are all already in context. The reason-file path is composed inline in `script_args` using these existing variables.
- **No change to existing verifier or chat_summarizer schemas.**
- **No retroactive edits to already-archived illuminations.** Existing archives retain whatever reason the old agent-based `mark_archived` produced. The change applies only to new archival events.
- **No standalone landing.** This spec lands inside T0000's commit, in the same diff that adds `remove_gate -> mark_archived` routing and retires the MCP tool. Landing this spec alone would create an unreachable `mark_archived_invalid` node and fail `ralph pipeline validate` at `graph.ts:289`.
- **No decline-reason prompt at `approval_gate`.** A future spec could add a text-input phase so the human explains the decline; this spec uses a literal for now because no such prompt exists.
- **No sharing of the reason-file read helper between scripts.** `mark-dispatched.mjs` does not read files for its args. No helper is extracted.

## Architecture

### Two script-tool nodes replacing one agent node

Both new nodes share `type="tool"`, `cwd="$project"`, `script_file="scripts/mark-archived.mjs"`. They differ only in `script_args`:

| Node | Reached from | `script_args` (after T0000) |
|---|---|---|
| `mark_archived_invalid` | `remove_gate [label="Yes"]` | `$illumination_path $meditations_dir/.triage/$run_id/invalid-reason.txt` |
| `mark_archived_decline` | `approval_gate [label="Decline"]` | `$illumination_path 'Declined at approval gate'` |

Declaration shape:

```dot
mark_archived_invalid [type="tool",
                       cwd="$project",
                       script_file="scripts/mark-archived.mjs",
                       script_args="$illumination_path $meditations_dir/.triage/$run_id/invalid-reason.txt"]

mark_archived_decline [type="tool",
                       cwd="$project",
                       script_file="scripts/mark-archived.mjs",
                       script_args="$illumination_path 'Declined at approval gate'"]
```

Why the two modes differ:

- The engine expands `$var` raw into a string then passes the whole command to `sh -c`. Any variable value containing spaces, quotes, backticks, or `$` is interpreted by the shell. `$illumination_path`, `$meditations_dir`, `$run_id` are path-safe tokens (kebab-case UUIDs and fixed project paths), so direct expansion works for them.
- `$explanation` is free-form prose (verifier schema imposes no charset limit; description is "why the illumination is or isn't valid"). Raw expansion would produce multi-token argv or inject shell syntax. The only safe carrier is a filesystem path. `explain_removal` writes the prose to a file under a path composed entirely of path-safe variables; the script reads the file.
- Literal `'Declined at approval gate'` is inside single quotes in the `.dot` source. Single quotes are passed through the engine's raw expansion unchanged, then honored by `sh -c`'s tokenizer. The resulting argv is one element: `Declined at approval gate`. No shell metacharacters are inside the literal, so this is safe.

Properties worth noting:

- **No `default_*` values.** Both nodes are only reachable after `verifier` runs and (for the invalid path) after `explain_removal` writes the reason file. Variables are guaranteed populated.
- **No agent, no retry, no MCP.** Pure script invocation. The old `mark_archived` agent node and its call to `mcp__illumination__mark_archived` are removed as part of T0000.
- **`mark_archived_decline` does not read `$explanation`.** The explanation is the verifier's validity rationale — the *opposite* of why the human declined. A literal string is the honest default.

### `pipelines/scripts/mark-archived.mjs`

Clone of `mark-dispatched.mjs` with three changes:

1. **Renamed frontmatter fields.** `status: dispatched` → `status: archived`. `dispatched_at:` → `archived_at:`. `plan_path:` → `reason:`.
2. **Arg2 interpretation branch.** After parsing `process.argv`, if arg2 is a path that exists on disk (`fs.existsSync`), read the file contents as the reason; otherwise treat arg2 as a literal reason string. File contents are `readFileSync(path, 'utf8').trim()`.
3. **Newline collapse on write.** The reason (whether from file or literal) may contain newlines (`$explanation` prose often does). Before writing to the frontmatter, replace each `\n` with a single space and collapse consecutive spaces. This keeps the reason field on one line in YAML frontmatter.

All other behaviors clone `mark-dispatched.mjs` exactly:

- Exit code 2 on missing args (both illumination and reason required).
- Read illumination, split on `---\n`, exit 1 if no frontmatter.
- Status `archived` with same reason → print `{"marked_archived": path, "idempotent": true}`, exit 0.
- Status `archived` with different reason → error to stderr, exit 1.
- Status not `open` and not `archived` → error "status not open", exit 1.
- Status `open` → write `status: archived`, append `archived_at:` and `reason:` lines.
- Single `writeFileSync` (no tempfile rename). Print `{"marked_archived": path}` on success, exit 0.

### Test file: `pipelines/scripts/tests/mark-archived.test.mjs`

Vitest file, structured like the existing `mark-dispatched.test.mjs`. Coverage:

1. Literal reason → `open` → `archived` with correct frontmatter (status, archived_at, reason).
2. File-path reason → reads file, writes contents as reason.
3. Reason with embedded newlines → collapsed to single-line in frontmatter.
4. Already `archived` with same reason → exit 0, `{"idempotent": true}` on stdout.
5. Already `archived` with different reason → exit 1.
6. Status `dispatched` (not archivable) → exit 1 with "status not open".
7. Missing args → exit 2 with usage message.
8. File-path arg2 where file does not exist → treated as literal reason (documents the fallback semantics).

### Fixtures

New fixtures under `pipelines/scripts/tests/fixtures/` with `mark-archived-` prefix to avoid collision with existing mark-dispatched fixtures (e.g., the existing `open.md` is already consumed by `mark-dispatched.test.mjs`):

- `mark-archived-open.md`
- `mark-archived-archived-same-reason.md`
- `mark-archived-archived-different-reason.md`
- `mark-archived-dispatched.md`
- `mark-archived-reason-multiline.txt` (reason file for the file-path-arg tests)

### Edge changes in `pipelines/illumination-to-implementation.dot`

Applied as part of T0000's diff:

| # | Change | Before | After |
|---|---|---|---|
| 1 | Remove single `mark_archived` agent node | `mark_archived [agent="implement", ...]` (line 18) | Deleted |
| 2 | Add two script-tool nodes | (none) | `mark_archived_invalid` + `mark_archived_decline` |
| 3 | Retarget Decline edge | `approval_gate -> mark_archived [label="Decline"]` (line 71) | `approval_gate -> mark_archived_decline [label="Decline"]` |
| 4 | Retarget Yes edge (T0000's own change) | `remove_gate -> delete_file [label="Yes"]` (line 66) | `remove_gate -> mark_archived_invalid [label="Yes"]` |
| 5 | Retarget terminators | `mark_archived -> done` (line 79) | `mark_archived_invalid -> done` + `mark_archived_decline -> done` |
| 6 | Extend `explain_removal` prompt | One-sentence task | Plus: "Also write the full verifier explanation verbatim to `$meditations_dir/.triage/$run_id/invalid-reason.txt` — the next pipeline stage reads this file. Create parent directories if missing." |

Edge #4 is strictly T0000's to make; this spec depends on it. Edges #1–3, #5, and prompt #6 are this spec's contribution.

## Components

### 1. Two node declarations in `pipelines/illumination-to-implementation.dot`

Placed where the old `mark_archived` node lives (around line 18), under the Phase-1 header.

### 2. `pipelines/scripts/mark-archived.mjs`

New file, ~55 lines. Plain Node.js, no dependencies. Reads `process.argv[2]` (illumination path) and `process.argv[3]` (reason or reason-file path). Does the file-vs-literal branch. Writes frontmatter. Prints JSON success or plain-text error.

### 3. `pipelines/scripts/tests/mark-archived.test.mjs`

New vitest file, ~120 lines. Uses `describe`/`it`/`expect`. Spawns the script via `execFileSync` or `node:child_process.spawnSync` (match the exact mechanism in `mark-dispatched.test.mjs`).

### 4. Prompt change in `explain_removal`

Two additional sentences at the end of the existing prompt. The prompt already reads `$illumination_path` and `$explanation`; the write-to-file instruction uses those plus `$meditations_dir` and `$run_id`, all in context.

### 5. Validation after the edit

- `grep -n mark_archived_invalid pipelines/illumination-to-implementation.dot` → 3 hits (declaration + `remove_gate` edge + `-> done` edge).
- `grep -n mark_archived_decline pipelines/illumination-to-implementation.dot` → 3 hits (declaration + `approval_gate` edge + `-> done` edge).
- `grep -nE '\bmark_archived\b' pipelines/illumination-to-implementation.dot` → zero hits (old name fully removed).
- `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs` → all green.
- `ralph pipeline validate pipelines/illumination-to-implementation.dot` → succeeds (all nodes reachable, all reachable nodes have outgoing edges to `done`).

## Data Flow

### Decline path

```
approval_gate
    │
    └── Decline ──> mark_archived_decline
                          │
                          │  sh -c "node scripts/mark-archived.mjs \
                          │          meditations/illuminations/xxx.md \
                          │          'Declined at approval gate'"
                          │
                          │  script sees argv[3] = "Declined at approval gate"
                          │  fs.existsSync("Declined at approval gate") === false
                          │  → treat as literal reason
                          │
                          │  writes frontmatter:
                          │    status: archived
                          │    archived_at: 2026-04-19
                          │    reason: Declined at approval gate
                          │
                          ▼
                         done
```

### Invalid path (requires T0000's `remove_gate` retarget)

```
verifier  (produces $explanation)
    │
    ▼
explain_removal   (also writes $meditations_dir/.triage/$run_id/invalid-reason.txt)
    │
    ▼
remove_gate
    │
    └── Yes ──> mark_archived_invalid
                      │
                      │  sh -c "node scripts/mark-archived.mjs \
                      │          meditations/illuminations/xxx.md \
                      │          meditations/.triage/<run_id>/invalid-reason.txt"
                      │
                      │  script sees argv[3] = path
                      │  fs.existsSync(path) === true
                      │  → read file, treat contents as reason
                      │
                      │  writes frontmatter:
                      │    status: archived
                      │    archived_at: 2026-04-19
                      │    reason: pipelineFailed boolean already present; process.exitCode assignment already committed.
                      │
                      ▼
                     done
```

### Variable visibility

| Node | `$illumination_path` | Reason source | Carrier |
|---|:---:|---|---|
| `mark_archived_invalid` | ✅ (from `verifier`) | File written by `explain_removal` | path ($meditations_dir/.triage/$run_id/invalid-reason.txt) |
| `mark_archived_decline` | ✅ (from `verifier`) | Literal in `.dot` source | single-quoted string |

All variables referenced in `script_args` for both nodes are path-safe.

## Constraints

- **Bundled with T0000.** This spec does not land standalone. Reason: introducing `mark_archived_invalid` before `remove_gate` is retargeted to it would produce an unreachable node, which `graph.ts:289` flags at severity `error` and causes `ralph pipeline validate` to fail.
- **Reason-file path must be path-safe.** `$meditations_dir`, `$run_id`, and the fixed segment `.triage/` contain no spaces or shell metacharacters. Must remain so.
- **Script contract parity with `mark-dispatched`.** Same exit codes, same stdout JSON shape, same idempotency semantics. Only the arg2 file-vs-literal branch is new.
- **Idempotency.** Pipelines re-run. `mark-archived.mjs` MUST be safe to re-invoke with the same args on an already-archived file. Same-reason re-run returns `{"idempotent": true}`; different-reason re-run fails loudly.
- **Newline collapse is internal to the script.** The shell does not see a multi-line `$explanation` — it sees a path. The script reads the file and collapses newlines before writing the YAML line. The YAML-line constraint (single-line reason) is the motivation.
- **No changes to `mark-dispatched.mjs` or `mark-dispatched.test.mjs`.** Independent scripts; no shared helper extracted.
- **No file deletion.** The `delete_file` node's retirement (post-T0000) is T0000's responsibility. This spec does not touch it.
- **Gate.** `npm run build && npm test` green, `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs` green, `ralph pipeline validate pipelines/illumination-to-implementation.dot` succeeds inside the T0000 merge.

## What This Excludes

- **A decline-reason prompt at `approval_gate`.** Richer decline audit trail. Out of scope; would change gate UX and engine gate-value contract.
- **A shared frontmatter-writer helper between `mark-dispatched.mjs` and `mark-archived.mjs`.** Premature abstraction at ~40 lines each.
- **Retroactive re-archival.** Existing archives are not rewritten.
- **Changing `delete_file`'s semantics.** T0000's concern.
- **An engine-level `script_args` quoting fix.** `src/attractor/handlers/tool.ts:96-101`'s raw expansion is the root cause of why `$explanation` cannot travel as a literal. A future spec could harden the engine; this spec uses the file-path workaround.
- **Adding a JSON schema file for the script's output.** Script tools use generic stdout-JSON handling, not `json_schema_file`. Matches mark-dispatched.
- **Commit-message prescription.** The commit message is T0000's to write since this spec bundles into that commit.
