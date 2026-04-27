---
source: review
date: 2026-04-26
description: Risk and UX review of the meditations/stimuli/ refactor plan
---

# Stimuli Refactor — Risk & UX Review

## Strengths

- Plan correctly identifies all production code touchpoints (`assets.ts:62`, `meditate-create.md`, `PROMPT_meditate_create.md`, `illumination-server.ts:300-301`, `.gitignore`).
- `package.json` already ships the whole `meditations/` tree (`files: ["dist","meditations"]`), so the new `stimuli/` subdir flows into the tarball with zero packaging change.
- `.triage/` co-located inside `stimuli/` keeps the env-var wiring (`META_MEDITATIONS_DIR` and `$meditations_dir`) functional for `pipelines/illumination-to-plan.dot:26`.

## Critical

1. **Missed touchpoint: `PROMPT_pipeline_create.md:80,86`** — references `meditations/illuminations/` and `tool_command="ls meditations/"` as hardcoded examples. Not strictly broken (these are illustrative), but they teach future authors a now-incorrect layout. **Update both lines** to `meditations/stimuli/illuminations/` is wrong (illuminations stays at root); revise example text to reflect the split. Otherwise the authoring prompt drifts from reality.

2. **`MetaMeditation` install hint string** (`illumination-server.ts` `NO_META_MEDITATIONS_MESSAGE`) currently tells users: *"create .md files in the meditations/ folder of your ralph-cli installation (e.g. ~/.npm-global/lib/node_modules/ralph-cli/meditations/)"*. After refactor that path is the wrong location for adding lenses — the agent will read from `stimuli/`. Plan item 4 mentions `300-301`, but the real string lives a few lines above (in `NO_META_MEDITATIONS_MESSAGE`). Confirm the edit covers the constant, not just nearby lines.

3. **`meditate.md` agent (`agents/meditate.md:20`) is unchanged by the plan and that is correct** — it consumes `META_MEDITATIONS_DIR` opaquely. But its prose at line 37–40 frames meta-meditations as "curated lenses from the ralph-cli tool itself". No layout language; safe. Verified, not a blocker.

## Important

4. **Naming integrity — keep `meditations_dir`, but only because it is *not* the meta-lenses dir.** In `pipelines/illumination-to-plan.dot:4`, `meditations_dir` resolves to the user's project meditations folder (the project root containing `illuminations/` and `.triage/`), **not** the bundled stimuli dir. The refactor does NOT change pipeline semantics — it only moves the *bundled lens corpus* under `stimuli/`. The variable's meaning is unchanged. **Recommendation: keep the name.** Renaming would suggest the pipeline points at `stimuli/`, which it does not. The two namespaces (project-side `meditations/` vs package-side `meditations/stimuli/`) should stay nominally distinct.

5. **Agent layout knowledge audit** — verified across `agents/*.md`:
   - `verifier.md:44` and `memory-writer.md:122` reference `meditations/illuminations/` (project side) — **unaffected**.
   - `meditate-create.md:10,14` — affected, in the plan.
   - `meditate.md`, `meditate-observer.md`, `task.md`, `change-explainer.md` — no layout assumptions. Clean.

6. **First-run UX after upgrade.** `list_meta_meditations` reads `meditationsDir` via `readdirSync(...).filter(.md)` (`illumination-server.ts` `listMetaMeditations`). After refactor the dir is `meditations/stimuli/`. The `.md` filter excludes `.triage/` automatically. **But:** the function does not skip subdirs in the listing — currently safe because `meditations/` only had `.md` files + the `illuminations/` and `.triage/` subdirs (filtered out by extension). Post-refactor `stimuli/` likewise contains only `.md` + `.triage/`. UX preserved.

## Minor

7. **MCP tool descriptions** (`list_meta_meditations`, `read_meta_meditation`) are layout-agnostic ("lens files from the ralph-cli installation"). No change needed. External MCP clients consuming these descriptions are unaffected.

8. **`.triage/` lazy creation:** `pipelines/illumination-to-plan.dot:26` writes `$meditations_dir/.triage/$run_id/chat-notes.md`. This is project-side (user's `meditations/.triage/`), not bundled. The `git mv` of the *repo's own* `.triage/` does not touch user installs. No live-write risk during refactor for end users.

## Recommendations

- Add to plan: edit `PROMPT_pipeline_create.md:80,86` examples (or document why kept as-is).
- Add to plan: explicitly grep for `NO_META_MEDITATIONS_MESSAGE` constant and confirm install-hint update lands on the constant.
- Add a test: `assets.test.ts` should add a case that `getMetaMeditationsDir()` resolves to a directory containing the known stimuli files (e.g. `red-green-tdd-is-non-negotiable.md`). Current regex `/meditations$/` is **insufficient** — it would still match a stale path. Replace with `/meditations\/stimuli$/` AND assert a known file exists.
- npm `-g` upgrade replaces the package directory atomically (npm unpacks the new tarball to a staging dir, then renames). Legacy `meditations/foo.md` from an older install **is wiped**. Document this in the meditation: any user who hand-edited the bundled meditations folder loses changes (extremely unlikely; CLAUDE.md lists no such workflow).
- The plan's "this is safe" framing for the variable rename is correct **only because** `meditations_dir` was never aliased to the bundled corpus. Document this distinction in the refactor PR description so reviewers don't conflate the two namespaces.

## Assessment

**Approve with the three Important/Critical fixes folded in.** The refactor is structurally low-risk — variable semantics are preserved, packaging path is already wildcarded, and only one agent prompt + one MCP server hint string carry layout language. The Critical items are documentation drift, not functional regressions, but should land in the same PR to prevent future-you confusion.

Risk score: 2/10 (low). Confidence: high after agent-layout audit.
