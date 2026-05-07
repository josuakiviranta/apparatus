# Design: Rename `meta_meditations` → `stimuli`, drop bundled-stimuli concept

**Date:** 2026-05-07
**Status:** draft (pending review)
**Originating session:** subagent rename blast-radius scan + follow-up grill, 2026-05-07.

## 1. Motivation

The `meditations/stimuli/` folder rename shipped on 2026-04-26 (`v0.1.39` — see memory `2026-04-26-meditations-stimuli-split-shipped.md`) but stopped at the directory layer. The MCP surface, the helper functions, the system-injected variable, and the user-facing prompt all still call the lens files **meta-meditations**. Domain language drifts at every read site. Anyone reading `meditate.md` or `illumination-server.ts` cold sees `list_meta_meditations`, `META_MEDITATIONS_DIR`, `getMetaMeditationsDir()` — terms that no longer match `CONTEXT.md` line 36 (`stimuli/`) or the directory on disk.

A second issue surfaced during the rename audit: **the bundled-stimuli concept is dead in distribution**. `package.json:files` ships `["dist", "meditations"]`. There is no top-level `meditations/` directory (the entry is stale). `.apparat/` is not in the files array, so `npm pack` excludes it. `getMetaMeditationsDir()` resolves to `<package-root>/.apparat/meditations/stimuli/` — present in dev (apparat's own repo), absent for any npm consumer. Today, every npm-installed apparat user gets the `NO_META_MEDITATIONS_MESSAGE` fallback. The only person whose meditate session loads stimuli is the developer running apparat against itself.

The fix unifies both: rename to match the domain term, and delete the bundled-stimuli plumbing that was never functional outside this repo. Each project owns its own stimuli folder under `.apparat/meditations/stimuli/`. Other projects that install apparat get an empty stimuli dir on `apparat init` and populate it themselves. Apparat's own 32 lens files stay where they are — project-local content for the apparat repo, no different from any other project's stimuli.

## 2. Decision Summary

1. **Tool surface renames.** The MCP server tools `list_meta_meditations` and `read_meta_meditation` become `list_stimuli` and `read_stimulus`. The exported helpers `listMetaMeditations` and `readMetaMeditation` rename in lockstep. No alias, no deprecation period — single-developer harness, big-bang cut.

2. **Drop the bundled-stimuli code path entirely.** Delete `getMetaMeditationsDir()` from `src/cli/lib/assets.ts`. Delete `META_MEDITATIONS_DIR` from `SYSTEM_INJECTED_VARS` in `src/attractor/handlers/agent-prep.ts`. The MCP server stops accepting a stimuli directory as `argv[3]` and instead resolves the project-local stimuli dir internally via `stimuliDir(projectRoot)` (already imported by sibling helpers in `apparat-paths.ts`).

3. **Stimuli are strictly project-local.** Each project's `<project>/.apparat/meditations/stimuli/` is read in isolation. No cross-project sharing, no fallback to a curated bundle, no copy-on-init seeding. Other projects that install apparat get an empty `stimuli/` dir from `apparat init` (already correct — see `src/cli/commands/init.ts:19`) and populate it themselves.

4. **Apparat's own 32 lens files stay where they are.** `.apparat/meditations/stimuli/*.md` in this repo become regular project-local content for the apparat project, not a "bundled library". The files are tracked in git (already are), edited by the apparat developer like any other in-repo file, and consumed by apparat's own meditate sessions just like any other project consumes its own stimuli.

5. **Drop `"meditations"` from `package.json:files`.** It is stale (no such top-level dir exists). Removing it is independent of the rename but fits the same cleanup commit.

6. **Update `NO_META_MEDITATIONS_MESSAGE` to point at the project's own folder.** Current text instructs users to populate `~/.npm-global/lib/node_modules/apparat-cli/.apparat/meditations/stimuli/` of their *apparat-cli installation* — wrong direction. New text points at `<their project>/.apparat/meditations/stimuli/`. Constant renames to `NO_STIMULI_MESSAGE`.

7. **`CONTEXT.md` line 53–58 update.** Remove the "Two-tier stimuli reads (project-local + bundled)" claim. Replace with a single line stating stimuli are project-local only. The two-tier statement for *pipelines* (line 53–55) stays — pipelines genuinely have a bundled fallback that ships in `dist/pipelines/`.

8. **No CLI surface change.** `apparat meditate <project>` continues to work. `apparat init` continues to scaffold an empty `stimuli/` dir. The user-visible behaviour change: a fresh project's first meditate session sees the no-stimuli sentinel instead of the bundled lens library — matches what npm-installed users already get today, so this is a regression only for apparat-itself dev sessions, which this rename leaves untouched (apparat's stimuli dir stays populated as project-local content).

## 3. Architecture

### 3.1 Surface rename map

| Surface | Before | After |
|---|---|---|
| MCP tool | `list_meta_meditations` | `list_stimuli` |
| MCP tool | `read_meta_meditation` | `read_stimulus` |
| Exported helper | `listMetaMeditations(dir)` | `listStimuli(projectRoot)` |
| Exported helper | `readMetaMeditation(dir, filename)` | `readStimulus(projectRoot, filename)` |
| Sentinel constant | `NO_META_MEDITATIONS_MESSAGE` | `NO_STIMULI_MESSAGE` |
| Tool whitelist (`meditate.md` `tools:`) | `mcp__illumination__list_meta_meditations`, `mcp__illumination__read_meta_meditation` | `mcp__illumination__list_stimuli`, `mcp__illumination__read_stimulus` |

### 3.2 Deletions

| Surface | What goes away |
|---|---|
| `src/cli/lib/assets.ts` | `getMetaMeditationsDir()` function (lines 40–47) |
| `src/attractor/handlers/agent-prep.ts` | `META_MEDITATIONS_DIR` entry in `SYSTEM_INJECTED_VARS`; corresponding `META_MEDITATIONS_DIR: getMetaMeditationsDir()` line in `buildSystemInjectedVars`; `getMetaMeditationsDir` import |
| `src/cli/tests/meditate.test.ts` | The `list_meta_meditations` and `read_meta_meditation` entries in the expected-tools list (lines 161–162) — replaced, not deleted, by `list_stimuli` / `read_stimulus` |
| `src/cli/pipelines/meditate/meditate.md` (frontmatter) | The `"{{META_MEDITATIONS_DIR}}"` line in `mcp.args` |
| `src/cli/mcp/illumination-server.ts` | `argv[3]`-based `meditationsDir` parameter; the parameter is replaced by an internal call to `stimuliDir(projectRoot)`. The two MCP tool registrations (`list_meta_meditations`, `read_meta_meditation`) become `list_stimuli`, `read_stimulus` and pass `projectRoot` instead of `meditationsDir` |
| `src/cli/tests/assets.test.ts` | The `getMetaMeditationsDir returns a path to the stimulus library...` test case (lines 11–18). Import line drops `getMetaMeditationsDir`. |
| `src/attractor/tests/agent-handler.test.ts:196` | The `META_MEDITATIONS_DIR` assertion. Test name drops the `meta-meditations dir` parenthetical. |
| `src/attractor/tests/graph-validator-inputs.test.ts:284–290` | `META_MEDITATIONS_DIR` removed from the system-vars list and the agent's `inputs:` |
| `package.json:files` | `"meditations"` entry (stale; no such dir exists) |

### 3.3 Internal-resolution change inside the MCP server

Currently:
```ts
const projectRoot = process.argv[2];
const meditationsDir = process.argv[3] ?? "";
// ...
server.tool("list_meta_meditations", ..., async () => listMetaMeditations(meditationsDir));
server.tool("read_meta_meditation", ..., async ({ filename }) => readMetaMeditation(meditationsDir, filename));
```

After:
```ts
import { stimuliDir } from "../lib/apparat-paths.js";
const projectRoot = process.argv[2];
// ...
server.tool("list_stimuli", ..., async () => listStimuli(projectRoot));
server.tool("read_stimulus", ..., async ({ filename }) => readStimulus(projectRoot, filename));
```

`listStimuli`/`readStimulus` resolve the dir internally:
```ts
export function listStimuli(projectRoot: string): string {
  return listMdFolder(stimuliDir(projectRoot));
}
export function readStimulus(projectRoot: string, filename: string): string {
  return readMdFile(stimuliDir(projectRoot), filename);
}
```

The signature shift (`dir` → `projectRoot`) is the cleanest expression of the new contract: the server speaks in projects, not in opaque directory paths.

### 3.4 `meditate.md` frontmatter, before/after

Before (lines 16–24):
```yaml
tools:
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
      - "{{META_MEDITATIONS_DIR}}"
```

After:
```yaml
tools:
  - mcp__illumination__list_stimuli
  - mcp__illumination__read_stimulus
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
```

Body prose at `meditate.md:50–53, 70` rewords to use `stimuli` / `list_stimuli` / `read_stimulus`. The intent ("call list first, pick by description, then read by filename") is unchanged — only the names move.

### 3.5 `NO_STIMULI_MESSAGE` rewrite

Before:
```
No meta-meditations found. You can still proceed — reflect on the project code
directly and write your illumination using write_illumination.

To add meta-meditations: create .md files in the .apparat/meditations/stimuli/ folder of your
apparat-cli installation (e.g. ~/.npm-global/lib/node_modules/apparat-cli/.apparat/meditations/stimuli/).
Each file is a lens the agent will use to reflect on your project.
```

After:
```
No stimuli found. You can still proceed — reflect on the project code directly
and write your illumination using write_illumination.

To add stimuli: create .md files in this project's .apparat/meditations/stimuli/
folder. Each file is a lens the agent will use to reflect on your project.
```

### 3.6 `CONTEXT.md` line 53–58 update

Before:
```
Two-tier pipeline read at runtime:
- **Project-local:** `<project>/.apparat/pipelines/<name>/pipeline.dot`
- **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

Two-tier stimuli reads (project-local + bundled) work the same way for
the meditate pipeline.
```

After:
```
Two-tier pipeline read at runtime:
- **Project-local:** `<project>/.apparat/pipelines/<name>/pipeline.dot`
- **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

Stimuli are project-local only. The meditate pipeline reads from
`<project>/.apparat/meditations/stimuli/` exclusively — there is no
bundled fallback. Each project curates its own lens library; an
`apparat init` scaffolds an empty `stimuli/` directory.
```

### 3.7 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Code (`src/**/*.ts`) | `assets.ts`, `agent-prep.ts`, `illumination-server.ts` | Inline edit (rename + delete) |
| Tests (`src/**/tests/**/*.ts`) | `assets.test.ts`, `agent-handler.test.ts`, `graph-validator-inputs.test.ts`, `meditate.test.ts`, `illumination-server.test.ts` | Inline edit |
| Bundled pipeline | `src/cli/pipelines/meditate/meditate.md` | Inline edit (frontmatter + body) |
| Build config | `package.json` | Drop `"meditations"` from `files` |
| Public docs | `CONTEXT.md` | Inline edit (one paragraph) |
| Frozen prose (do NOT edit) | `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`, `.apparat/sessions/2026-04-25-...md`, `.apparat/meditations/stimuli/.triage/...`, ADR 0007/0008/0010 | Skip — historical record |
| Apparat's own stimuli content | `.apparat/meditations/stimuli/*.md` (32 lens files) | Skip — content unchanged; classification reframed by ADR |
| New ADR | `docs/adr/0012-stimuli-project-local-only.md` | Create |

### 3.8 New ADR-0012

A short MADR-style record. Captures the decision that stimuli are project-local only and the bundled-stimuli concept is excised. References this design spec. Supersedes nothing structurally — ADR 0010 (rename to apparatus) and `CONTEXT.md` already established the `.apparat/` layout; this ADR sharpens the partition principle for one specific subfolder.

### 3.9 Big-bang commit shape

Single PR, three logical commits. The two refactors do not split cleanly: any frontmatter change to `meditate.md`'s `mcp.args` must land together with the matching `argv` change in the MCP server, or the meditate session ships into a runtime mismatch (no compile error — just an empty stimuli list at runtime, undetectable until smoke). They land as one atomic refactor.

1. `chore: drop stale "meditations" entry from package.json files array` — independent cleanup, lands first.
2. `refactor: rename meta_meditations to stimuli + drop bundled-stimuli plumbing` — atomic surface rename and plumbing removal:
   - rename helpers/tools/sentinel constant in `illumination-server.ts`
   - drop `argv[3]` parsing in the MCP server; switch internal resolution to `stimuliDir(projectRoot)`
   - rename two `tools:` entries in `meditate.md` frontmatter and drop the `META_MEDITATIONS_DIR` arg
   - delete `getMetaMeditationsDir()` from `assets.ts`
   - drop `META_MEDITATIONS_DIR` from `SYSTEM_INJECTED_VARS` in `agent-prep.ts`
   - update all tests in lockstep
3. `docs: update CONTEXT.md + add ADR-0012 for project-local-only stimuli`.

The repo must pass `npm run build`, `npx tsc --noEmit`, and `npx vitest run` after every commit. No half-renamed checkpoint anyone reviews.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/lib/assets.ts` | Delete `getMetaMeditationsDir()` (lines 40–47). `isProduction()` stays — `getIlluminationServerPath()` still uses it. |
| `src/attractor/handlers/agent-prep.ts` | Drop `META_MEDITATIONS_DIR` from `SYSTEM_INJECTED_VARS` (line 19). Drop `META_MEDITATIONS_DIR: getMetaMeditationsDir()` line (26). Drop `getMetaMeditationsDir` from import (line 6). |
| `src/cli/mcp/illumination-server.ts` | Rename `listMetaMeditations` → `listStimuli`; signature changes to `(projectRoot: string)`. Same for `readMetaMeditation` → `readStimulus`. Rename `NO_META_MEDITATIONS_MESSAGE` → `NO_STIMULI_MESSAGE` and rewrite body. Tool registrations rename and pass `projectRoot`. Drop `argv[3]` parsing. Add `stimuliDir` import. |
| `src/cli/pipelines/meditate/meditate.md` | Frontmatter: rename two `tools:` entries; drop `META_MEDITATIONS_DIR` arg. Body: update lines 50–53 and 70 to use new names. |
| `src/cli/tests/assets.test.ts` | Delete `getMetaMeditationsDir returns a path...` test (11–18). Drop import. |
| `src/cli/tests/illumination-server.test.ts` | Rename `listMetaMeditations` describe block to `listStimuli`; tests pass `projectRoot` and seed `<projectRoot>/.apparat/meditations/stimuli/`. Same for `readMetaMeditation` → `readStimulus`. Update sentinel-text matchers (`No meta-meditations found` → `No stimuli found`). |
| `src/cli/tests/meditate.test.ts` | Update `whitelists exactly the 7 reflective-only tools` (line 145) expected list to use `list_stimuli` / `read_stimulus`. |
| `src/attractor/tests/agent-handler.test.ts` | Drop `META_MEDITATIONS_DIR` assertion (line 196). Update test description (line 182) to drop `meta-meditations dir` parenthetical. |
| `src/attractor/tests/graph-validator-inputs.test.ts` | Drop `META_MEDITATIONS_DIR` from system-vars test (lines 284, 290). |
| `CONTEXT.md` | Replace lines 53–58 per §3.6. |
| `package.json` | Drop `"meditations"` from `files`. |
| `docs/adr/0012-stimuli-project-local-only.md` | Create. Short MADR. |

### 4.1 Test additions (TDD-first)

For each rename, add a failing test that names the new tool/helper before the implementation flips. The minimum new coverage:

- `illumination-server.test.ts`: a test that calls `listStimuli(projectRoot)` after seeding `<projectRoot>/.apparat/meditations/stimuli/foo.md` and asserts the file is listed. Mirror for `readStimulus`. Sentinel test asserts `"No stimuli found"` substring and an instruction pointing at *the project's* `.apparat/meditations/stimuli/` (not at any `~/.npm-global/...` install path).
- `meditate.test.ts`: in addition to flipping the existing whitelist test, add an assertion that the `mcp.args` list in `meditate.md` is exactly two entries (`{{ILLUMINATION_SERVER_PATH}}`, `{{PROJECT_ROOT}}`) — pinning the dropped third arg.
- `agent-prep` integration: `agent-handler.test.ts` asserts `META_MEDITATIONS_DIR` is **absent** from the variables passed to `Agent.run`.

These tests stay after the rename ships — they pin the contract, not just the migration.

## 5. Risks & rejected alternatives

### 5.1 Risk: apparat-self meditate session loses access to its lens library

Mitigation: zero. Apparat's `.apparat/meditations/stimuli/` already contains the 32 lens files. The rename does not delete or move them. Post-rename, apparat's meditate session reads them via `stimuliDir(projectRoot)` where `projectRoot` is the apparat repo — same files, same path.

### 5.2 Risk: a user's existing project relies on the bundled stimuli fallback

Mitigation: zero by inspection. The bundled fallback was dead in npm distribution (`.apparat/` excluded by `package.json:files`). Every npm-installed user already saw `NO_META_MEDITATIONS_MESSAGE`. The rename ships parity for them.

### 5.2.1 Risk: a third caller passes `argv[3]` to the illumination server

Mitigation: verified absent. Only `src/cli/pipelines/meditate/meditate.md` constructs the `node <server> <projectRoot> <metaDir>` invocation (via the `mcp.args` frontmatter). No tests, scripts, or other agents spawn the server. `grep -r illumination-server src/` confirms a single launch site. Dropping `argv[3]` in the same commit as the frontmatter edit closes the loop atomically.

### 5.3 Rejected: copy-on-init seeding (option 2 from the brainstorm)

`apparat init` could copy `<bundle>/.apparat/meditations/stimuli/*.md` into `<project>/.apparat/meditations/stimuli/`. Seeds new projects with the curated library; user owns the copy thereafter.

Rejected because: (a) it requires shipping `.apparat/meditations/stimuli/` inside the npm package, growing the publish artefact and adding a coupling between bundle layout and `init` behaviour; (b) the curated lenses in apparat are specific to apparat's own concerns (e.g. `the-agentic-loop-is-a-graph.md`, `running-multiple-agents-in-parallel.md`), and seeding them into every fresh project pollutes other projects' lens libraries with apparat-specific framing; (c) user explicitly asked for project-specific isolation. A future cookbook-style command (`apparat stimuli import <bundle-name>`) could solve curated-distribution if it ever becomes a real need; not part of this design.

### 5.4 Rejected: keep bundled as a discoverable read-only library alongside project-local

Two MCP tools (`list_bundled_stimuli`, `list_project_stimuli`), agent picks. Rejected because: it reintroduces the disambiguation problem this design eliminates and contradicts the explicit user direction ("other projects should not be able to access this same stimuli").

### 5.5 Rejected: leave the names alone, only drop bundled plumbing

Smaller diff but leaves `meta_meditations` ↔ `stimuli` mismatch in code while the directory is `stimuli/`. Drift cost continues to compound at every read site. Mismatch already triggered the original blast-radius scan.

## 6. Out of scope

- Renaming or restructuring `.apparat/meditations/illuminations/`. Stays as is.
- Changing what fields appear in stimulus frontmatter. Today: `description`. Stays.
- Adding any cookbook / curated-bundle import command. Future work if ever needed.
- Editing apparat's 32 lens files. Content stays.
- Editing dated artefacts (sessions, plans, ADR 0007/0008/0010, the 2026-05-05 rename spec) that mention `meta_meditations` historically.

## 7. Acceptance

- `npm run build` passes.
- `npx tsc --noEmit` passes.
- `npx vitest run` passes.
- `grep -r meta_meditation src/ docs/adr/0012*.md CONTEXT.md package.json` returns no hits (excluding dated specs/sessions/plans/ADR 0007/0008/0010).
- `grep -r META_MEDITATIONS_DIR src/` returns no hits.
- `grep -r getMetaMeditationsDir src/` returns no hits.
- An `apparat meditate` run against a fresh `apparat init`-scaffolded project (with empty `stimuli/`) shows `No stimuli found.` and the meditate agent still completes (writes an illumination based on code-only reflection).
- An `apparat meditate` run against the apparat repo itself loads the 32 lens files unchanged.
