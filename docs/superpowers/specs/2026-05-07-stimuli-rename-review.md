# Spec Review: 2026-05-07-stimuli-rename-and-project-local-only-design.md

**Verdict:** Approved with two issues to address before plan-writing. The decisions are internally consistent and the cleanup (rename + drop bundled fallback) is well-motivated. File:line claims hold up under spot-check. Two real concerns surface around the commit shape and the test-file inventory.

---

## What was verified

| Spec claim | File:line | Holds? |
|---|---|---|
| `getMetaMeditationsDir()` at `assets.ts:40-47` | `src/cli/lib/assets.ts:40-47` | yes (verbatim) |
| `META_MEDITATIONS_DIR` in `SYSTEM_INJECTED_VARS` line 19, populated line 26, imported line 6 | `src/attractor/handlers/agent-prep.ts:6,19,26` | yes (verbatim) |
| `meditate.md` mcp.args lines 16–24, body 50–53/70 | `src/cli/pipelines/meditate/meditate.md:10-24,50-53,70` | yes |
| `assets.test.ts` test 11–18 | `src/cli/tests/assets.test.ts:11-18` | yes (verbatim) |
| `agent-handler.test.ts:196` assertion + 182 description | confirmed at 182 ("…meta-meditations dir") and 196 (`META_MEDITATIONS_DIR` matcher) | yes |
| `graph-validator-inputs.test.ts:284-290` | confirmed; test at 284 names `META_MEDITATIONS_DIR`, line 290 includes it in `inputs:` | yes |
| `stimuliDir(projectRoot)` already exported | `src/cli/lib/apparat-paths.ts:16-18` | yes |
| `package.json:files` is `["dist", "meditations"]` and `meditations/` does not exist at repo root | confirmed | yes |
| 32 lens files in `.apparat/meditations/stimuli/` | `ls | wc -l` = 32 | yes |
| CONTEXT.md lines 53–58 wording | `CONTEXT.md:53-58` | yes (verbatim) |
| `init.ts:19` already scaffolds empty `stimuli/` | `src/cli/commands/init.ts:8-19` | yes |

Surface inventory grep for `meta_meditation|MetaMeditation|META_MEDITATIONS` returns 13 files. Excluding the spec itself, the dated rename spec from 2026-05-05, and two frozen artefacts (sessions, .triage), the live hits are exactly the 9 files the file-edit map lists. Map appears exhaustive.

---

## Issue 1 (Important): Commit 2 leaves the build broken

§3.9 says commit 2 ("rename meta_meditations surface to stimuli") leaves "all tests still pass; bundled-stimuli plumbing is still in place but routed through new names." That is inconsistent with the §3.4 frontmatter shown.

In §3.4 the **after** state of `meditate.md` already drops `{{META_MEDITATIONS_DIR}}` from `mcp.args`. If commit 2 ships the `meditate.md` rewrite (it must — the frontmatter is part of the rename), and `META_MEDITATIONS_DIR` is still listed in `SYSTEM_INJECTED_VARS` until commit 3, then:

- The MCP server in commit 2 still expects `argv[3]` (until commit 3 narrows it). With `meditate.md` already dropping the third arg, an actual meditate run between commits 2 and 3 would launch the server with `argv[3] === undefined`, defaulting `meditationsDir = ""` and serving the no-stimuli sentinel.
- Conversely, if `meditate.md` keeps `{{META_MEDITATIONS_DIR}}` in commit 2, the rename of the helper/tool names is incomplete because the frontmatter still references the old var name. Either way, commit 2 is a half-step.

**Recommended fix:** collapse commits 2 and 3 into one logical refactor (the rename and the plumbing-removal are not separable without breaking either runtime or the §3.9 invariant). Or restate commit 2 as "rename only the helper/tool names; leave frontmatter unchanged" and move the frontmatter rewrite to commit 3. The acceptance criterion "must pass build + tsc + vitest after every commit" should not be aspirational.

## Issue 2 (Important): Test-file inventory misses `meditate.test.ts:161-162`

§3.2 lists test deletions but does not include `src/cli/tests/meditate.test.ts:161-162`, which hard-codes `mcp__illumination__list_meta_meditations` and `mcp__illumination__read_meta_meditation` in the expected-tools array. §4 (the "Components & file edits" table) does mention this file at line 145, which is correct, but §3.2 (the deletions table) does not — minor inconsistency between the two tables. Easy fix: cross-reference §3.2 and §4 to make sure both tell the same story. Verified via Read at `src/cli/tests/meditate.test.ts:155-163` — the array is exactly two entries that need flipping.

## Issue 3 (Suggestion): `isProduction()` becomes dead-code candidate, but spec hedges

§4 says "Drop `isProduction()` if unused after deletion (verify — likely still used by `getIlluminationServerPath`)." Verified: `getIlluminationServerPath` at `assets.ts:49-55` still uses `isProduction()`. So the hedge resolves to "keep". Spec could say so plainly to remove ambiguity for the implementer.

## Issue 4 (Suggestion): risk §5 doesn't surface the runtime-tests-as-MCP-clients risk

If any test elsewhere in the repo spawns `illumination-server.ts` as a subprocess and passes its own `argv[3]`, the signature narrowing (drop `argv[3]`) will silently ignore that arg. Grep shows the only `argv` references inside this file. No external spawner verified for this server in tests. Worth one sentence in §5 confirming no consumer outside `meditate.md` passes the third arg.

## Rejected-alternatives engagement

§5.3 (copy-on-init seeding) honestly engages: it cites artefact-size, semantic mismatch ("apparat-specific framing"), and explicit user direction. §5.4 (two-tier read-only library) also names a concrete failure mode (the disambiguation problem). Neither is dismissed shallowly.

---

## Files referenced

- `/Users/josu/Documents/projects/apparatus/docs/superpowers/specs/2026-05-07-stimuli-rename-and-project-local-only-design.md` — under review
- `/Users/josu/Documents/projects/apparatus/src/cli/lib/assets.ts:40-47`
- `/Users/josu/Documents/projects/apparatus/src/attractor/handlers/agent-prep.ts:6,19,26`
- `/Users/josu/Documents/projects/apparatus/src/cli/mcp/illumination-server.ts:163-182,247-255,307-308,411-430`
- `/Users/josu/Documents/projects/apparatus/src/cli/pipelines/meditate/meditate.md:10-24,50-53,70`
- `/Users/josu/Documents/projects/apparatus/src/cli/tests/assets.test.ts:11-18`
- `/Users/josu/Documents/projects/apparatus/src/cli/tests/meditate.test.ts:145-167`
- `/Users/josu/Documents/projects/apparatus/src/cli/tests/illumination-server.test.ts:398-454`
- `/Users/josu/Documents/projects/apparatus/src/attractor/tests/agent-handler.test.ts:182-197`
- `/Users/josu/Documents/projects/apparatus/src/attractor/tests/graph-validator-inputs.test.ts:284-304`
- `/Users/josu/Documents/projects/apparatus/src/cli/lib/apparat-paths.ts:16-18`
- `/Users/josu/Documents/projects/apparatus/src/cli/commands/init.ts:8-19`
- `/Users/josu/Documents/projects/apparatus/CONTEXT.md:53-58`
- `/Users/josu/Documents/projects/apparatus/package.json` (files array)
