# Code Review — `specs/2026-04-27-illuminations-status-dirs-design.md`

Reviewer: code-reviewer agent
Date: 2026-04-27
Spec under review: `/Users/josu/Documents/projects/ralph-cli/specs/2026-04-27-illuminations-status-dirs-design.md`

---

## Strengths (acknowledged before issues)

1. **Supersedes-trail is clean.** The spec explicitly cites why the prior `archive/` subdir design (`specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`) is being replaced and verifies the prior design never shipped (`ls meditations/illuminations` 2026-04-27).
2. **Three-dir routing is the simpler architecture.** Status → directory mapping (line 56–62) makes fixture placement = expected output, eliminates the need for frontmatter parsing on `archived`/`implemented` reads, and is symmetric across the two terminal states.
3. **Backfill preconditions are sound.** `git status --porcelain` refusal + single atomic commit + reversibility via `git revert` (Risks table line 201) mirrors existing MCP auto-commit hygiene.
4. **`superseded` drop is verified safe.** Confirmed independently — `grep -ri superseded src/ pipelines/` returns no matches in code paths; only doc/spec/meditation references. No caller reads `status: superseded`.

---

## Issue 1 (Important) — `mark-archived.mjs` and MCP `markArchived` will diverge in commit semantics

**Spec lines:** 91 (MCP behavior), 99–101 (script behavior)

The spec says the MCP `markArchived` performs `git mv` semantics + auto-commit `meditate: archive <filename> (<reason>)`. But the script `mark-archived.mjs` is described as: "physically move … and emit JSON `{ marked_archived, archive_path }` on stdout so `produces_from_stdout` can re-resolve."

What the spec does NOT specify: **does the script also auto-commit?** The current `mark-archived.mjs` does not commit (verified `wc -l pipelines/scripts/mark-archived.mjs` = 58 lines, contrasted with the MCP auto-commit pattern). The pipeline `illumination-to-implementation.dot:14–17` invokes the script, not the MCP. After the change:

- **If the script doesn't commit:** the archive move shows up as dirty `git status` in the pipeline runner's tree until `commit_push` (which doesn't exist on the archive branch — `mark_archived → done`). Result: an archived illumination is moved on disk but never committed, defeating the whole point of the prior 2026-04-25 spec's auto-commit fix.
- **If the script does commit:** the spec needs to say so explicitly, with the same commit-message contract as the MCP path.

**Recommendation:** Add a sentence to §`mark-archived.mjs` (line 99–101): *"Script also auto-commits with the same commit message contract as `markArchived` MCP (`meditate: archive <filename> (<reason>)`) so the move is durable when invoked from a pipeline."* Or, alternative, retire the script and have the pipeline call the MCP via the `task` agent (the pattern `illumination-to-plan.dot:16` already uses).

---

## Issue 2 (Important) — Backfill re-run safety not specified

**Spec lines:** 154–165 (Backfill section)

Step 1 is `git status --porcelain` refusal. But that only protects against partial state from OTHER work, not from a half-completed prior run of this same script. Failure modes:

- **Partial completion:** Script crashes after moving 5 of 25 archived files. Re-running: `git status --porcelain` is dirty (because of the 5 moves) → script refuses. User has to manually unwind.
- **Already-migrated checkout:** Someone runs the script on a branch where the migration commit already landed. Step 2 iterates `meditations/illuminations/*.md` — the moved files aren't there anymore, so it's a no-op in steady state. But the `superseded` re-stamp clause (line 161) presumes the 3 superseded files still live in `meditations/illuminations/`. If they've already been moved, the re-stamp silently does nothing. Spec should explicitly state: *"Idempotent — re-running on a migrated checkout is a no-op (all source files are absent or already correct status)."*

**Recommendation:** Add a one-liner to the backfill steps: *"Script is idempotent across re-runs; it operates only on files still in `meditations/illuminations/` whose status is `implemented`, `archived`, or `superseded`. Re-running after partial completion: clean the partial state with `git reset --hard` to the pre-migration commit, then re-run."*

---

## Issue 3 (Suggestion) — Mid-pipeline `$illumination_path` invalidation: spec is silent but the analysis holds

**Spec lines:** 76–87 (markImplemented), §Risks table (199–204)

I verified `pipelines/illumination-to-implementation.dot`: `mark_archived` is a terminator (line 74: `mark_archived -> done`) and `mark_implemented` is only called from `memory_writer` (the last node before `done`) and `janitor` (separate run). So **no downstream node ever reads `$illumination_path` after a move** in any current pipeline — the risk is real in principle but unrealized in practice.

This is fortunate but fragile. The Risks table (lines 199–204) doesn't mention it. A future pipeline author wiring `mark_implemented` mid-flow would be surprised that `$illumination_path` becomes stale.

**Recommendation:** Add a row to the Risks table:

| Risk | Mitigation |
|---|---|
| Future pipeline calls `mark_implemented` or `mark_archived` mid-flow, and a downstream node reads `$illumination_path` | Both MCP responses now return `new_path` (line 87) / `archive_path` (line 91). Authors should re-bind the variable from the response, not reuse the stale capture. Document this in `specs/mcp-illumination.md` when the MCP contract is updated. |

---

## Issue 4 (Suggestion) — `specs/mcp-illumination.md` not in scope but should be

**Spec coverage:** Implementation Approach §MCP server lists tool description string updates at lines ~549, ~657, ~671 (line 95 of the spec), but does not mention `specs/mcp-illumination.md`.

`specs/mcp-illumination.md:81` documents `mark_implemented` and line 113 has the path table that says `mark_implemented` modifies `meditations/illuminations/`. After the split, that table is stale. This is a doc deliverable, not a code deliverable, but it's load-bearing — anyone reading the MCP contract will see the wrong target dir.

**Recommendation:** Add to Implementation Approach: *"Update `specs/mcp-illumination.md` table at line 113 to reflect new target dirs for `mark_implemented` and `mark_archived`; update tool-output contract sections to mention `new_path` field on `mark_implemented`."*

---

## Issue 5 (Nit) — Verification Matrix counts check out, but "Active queue size" understates the saving

**Spec line:** 214 — "Active queue size 89 → 52 files"

The framing in the Overview (line 27) says "47 active queue is no longer 40% completed work" and "list_illuminations with no filter currently returns all 89 files. After this change, it returns 52 (open + dispatched)."

Cross-check arithmetic:
- 47 open + 5 dispatched + 9 implemented + 25 archived + 3 superseded = 89 ✅
- After: `meditations/illuminations/` = 47 + 5 = 52 ✅
- After: `meditations/implemented-illuminations/` = 9 ✅
- After: `meditations/archived-illuminations/` = 25 + 3 (superseded re-stamp) = 28 ✅
- 52 + 9 + 28 = 89 ✅

All counts internally consistent.

---

## Coverage cross-check against blast-radius punch list

| Blast-radius item | Covered in spec? |
|---|---|
| `illumination-server.ts` `markArchived` (~200, 238–241, 263) | Yes — §`markArchived` line 89–91 |
| `illumination-server.ts` `markImplemented` (~110) | Yes — §`markImplemented` line 74–87 |
| `illumination-server.ts` `listIlluminations` (333–334) | Yes — §`listIlluminations` line 50–64 |
| `illumination-server.ts` `writeIllumination` (49) | Yes — §`writeIllumination` line 66–68 (no code change, doc only) |
| `mark-archived.mjs` (~50–51) | Yes — but commit semantics unspecified (Issue 1) |
| `mark-dispatched.mjs` | Yes — line 103–105 (no change) |
| `verifier.md:44` hardcoded path | Yes — line 127–129 |
| `memory-writer.md:122` doc comment | Yes — line 131–133 |
| `illumination-to-implementation.dot:10` glob | Yes — line 113–115 |
| `illumination-to-plan.dot` already correct | Yes — line 117–119 |
| `meditate.ts:42` `ensureMeditationDirs` | Yes — line 141–143 |
| `new.ts` doesn't create `meditations/` | Yes — line 145–147 |
| 14 breaking test assertions | Yes — line 169–179 (specific line ranges 550–614, 634–733, 900–1070 cited) |
| `specs/mcp-illumination.md` doc table | **No (Issue 4)** |

---

## Out-of-scope completeness

The Out-of-Scope section (lines 37–44) is well-bounded. Items correctly excluded: plans-side lifecycle, new `mark_superseded` tool, archive subdir recursion, `mark_dispatched` `new_path` field. No scope creep detected.

One thing worth confirming: line 195 says "The old spec file is moved to `specs/archive/` or marked superseded inline once this design ships — out of scope for this design doc itself, handled in the implementation plan's final cleanup step." This is fine, but ensure the implementation plan's chunk 4 (per task list) actually contains that step.

---

## Summary

The spec is largely complete and the architecture is sound. Two Important issues (auto-commit divergence in `mark-archived.mjs` vs MCP, backfill re-run safety) and three Suggestions (mid-flow variable staleness Risks-table entry, `specs/mcp-illumination.md` update, no nit on counts).

Counts arithmetic: ✅ verified 9 + 25 + 3 = 37 → 28 archived, 52 stay, total preserved.
`superseded` drop: ✅ no code reads the value, safe to retire.
Blast-radius coverage: ✅ all items from the audit covered except the one MCP doc file (Issue 4).

## Files referenced

- `/Users/josu/Documents/projects/ralph-cli/specs/2026-04-27-illuminations-status-dirs-design.md`
- `/Users/josu/Documents/projects/ralph-cli/specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`
- `/Users/josu/Documents/projects/ralph-cli/specs/mcp-illumination.md`
- `/Users/josu/Documents/projects/ralph-cli/src/cli/mcp/illumination-server.ts:332–356`
- `/Users/josu/Documents/projects/ralph-cli/pipelines/illumination-to-implementation.dot:10,14–17,74`
- `/Users/josu/Documents/projects/ralph-cli/pipelines/illumination-to-plan.dot:16`
- `/Users/josu/Documents/projects/ralph-cli/pipelines/scripts/mark-archived.mjs`
- `/Users/josu/Documents/projects/ralph-cli/src/cli/agents/memory-writer.md:13,122,135`
- `/Users/josu/Documents/projects/ralph-cli/src/cli/agents/janitor.md:13,26,35,43,64,77`

---

## Verdict

❌ **Issues Found** — two Important issues should be addressed before approving the spec for plan execution:

1. `mark-archived.mjs` auto-commit semantics must be specified (Issue 1) — without this, archived files in pipeline runs go uncommitted.
2. Backfill re-run / partial-completion behavior should be documented (Issue 2).

Suggestions 3, 4, 5 are nice-to-have but not blocking.
