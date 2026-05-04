# Design: `.ralph/` as Project-Local Home for Ralph-Touchable State

**Date:** 2026-05-04
**Status:** draft (pending review)
**ADR:** `docs/adr/0007-ralph-folder-as-project-local-home.md`

## 1. Motivation

Ralph-touchable state in a target project lives in three disjoint locations
today, and an agent working inside the project has to navigate all three to
orient itself:

| Location | What it holds | Owned by |
|---|---|---|
| `<project>/meditations/illuminations/` | live illuminations (markdown) | the project |
| `<project>/meditations/stimuli/` | meditation stimuli (markdown) | the project |
| `<project>/docs/adr/`, `<project>/CONTEXT.md`, `<project>/VISION.md` | documentation channels | the project |
| `~/.ralph/<projectKey>/runs/<runId>/` | run state, checkpoints, jsonl trace | the user-home tier (ralph-cli) |
| `src/cli/pipelines/` (in npm package) | bundled pipelines + bundled stimuli | ralph-cli |

The user-home tier `~/.ralph/<projectKey>/` exists because run state was
considered ephemeral machine-local data. But it crosses a filesystem
boundary that agents inside a project cannot read without extra path
plumbing (`os.homedir()`, project-key derivation, scan logic). And a
project's "ralph-shape" is implicit — no single folder declares "this is
a ralph project."

Two consequences:

- Agents that meditate on a project (e.g. janitor, future self-reflective
  pipelines) cannot include run state, project-local pipelines, or memory
  in their lens, because those things either don't exist project-locally
  or live behind the user-home boundary.
- A project's identity as a ralph project is inferred from "has a
  `meditations/` folder?" — implicit, easy to drift, easy to typo.

The user-stated vision (VISION.md) reverses earlier framing: pipelines
*should* be project-local where it makes sense, so meditation can iterate
on them. ADR-0001 (2026-04-30) rejected a per-user `~/.ralph/agents/`
tier on the principle "no global agent library." That principle still
holds at the agent layer — agents live next to their pipeline. The
unit-of-ownership at the next layer up is the **pipeline**, and a
project naturally owns its pipelines (like it owns its CI config).

ADR-0007 captures the resolved direction: a single project-local folder
`<project>/.ralph/` becomes the home for everything ralph-touchable.

## 2. Decision summary

1. **`<project>/.ralph/` exists as the home for everything ralph-touchable
   in a target project.**

   ```
   .ralph/
   ├── pipelines/                    ← project-local pipelines (override bundled)
   ├── meditations/
   │   ├── illuminations/
   │   └── stimuli/                  ← project-local stimuli (bundled stimuli stay in ralph-cli)
   ├── memory/                       ← project-local agent memory
   ├── docs/
   │   └── adr/
   ├── VISION.md
   ├── CONTEXT.md
   └── runs/                         ← gitignored
   ```

2. **A new `ralph init` command scaffolds the tree in-place.** It does:
   - `mkdir -p` every subfolder above
   - Scaffold empty `.ralph/VISION.md`, `.ralph/CONTEXT.md` if absent
   - Scaffold root `README.md` if absent
   - `git init -b main` if not already a repo
   - Append `.ralph/runs/` to `<project>/.gitignore` (create file if absent)
   - No kickoff flow, no `--migrate` flag, no `config.json`
   - Idempotent: running on an existing `.ralph/` fills missing
     subfolders, never overwrites existing files

3. **Path constants centralize in a new `src/cli/lib/ralph-paths.ts`
   module.** All in-tree consumers import from there. The module exports:

   ```ts
   export function ralphDir(projectRoot: string): string;        // <project>/.ralph
   export function meditationsDir(projectRoot: string): string;  // <project>/.ralph/meditations
   export function illuminationsDir(projectRoot: string): string;
   export function stimuliDir(projectRoot: string): string;
   export function memoryDir(projectRoot: string): string;
   export function docsAdrDir(projectRoot: string): string;
   export function pipelinesDir(projectRoot: string): string;    // <project>/.ralph/pipelines
   export function runsDir(projectRoot: string): string;         // <project>/.ralph/runs
   export function runDir(projectRoot: string, runId: string): string;
   ```

   No `userHomeRalphDir` export. The `~/.ralph/` tier goes away entirely.

4. **Run state moves from `~/.ralph/<projectKey>/runs/<runId>/` to
   `<project>/.ralph/runs/<runId>/`.** The `projectKey` map and
   cross-project trace lookup logic disappear. Trace listing becomes
   "scan `<project>/.ralph/runs/`" — same shape as before, different
   parent directory. `--resume` continues to work.

5. **MCP server path constants update.** `src/cli/mcp/illumination-server.ts`
   currently joins `projectRoot + "meditations/illuminations"` etc. After
   migration, it joins `projectRoot + ".ralph/meditations/illuminations"`
   via the new paths module. Plans path is unchanged for now
   (`docs/superpowers/plans/`) — that's a separate decision; this design
   keeps the plans surface untouched.

6. **Bundled pipelines reference the new layout.** The bundled
   `meditate` pipeline's `meditations_dir` default and the bundled
   `janitor` pipeline's illumination paths update to the new `.ralph/`
   convention. Bundled pipelines themselves (the `.dot` and `.md` files)
   stay in `src/cli/pipelines/`.

7. **ralph-cli's own repo migrates atomically.** `git mv` moves
   `meditations/` → `.ralph/meditations/`, `docs/adr/` →
   `.ralph/docs/adr/`, `CONTEXT.md` → `.ralph/CONTEXT.md`,
   `VISION.md` → `.ralph/VISION.md`. The migration commit also updates
   path-string references in code, tests, README.md, help text, and the
   bundled pipelines.

8. **No backward compatibility window.** Hard cut. Old ralph-cli versions
   stay on npm if rollback is needed.

Out of scope (locked):

- Plans surface (`list_plans`, `consume_plan`, `docs/superpowers/plans/`).
  That stays where it is. Re-locating plans into `.ralph/` is a future
  decision; this design does not pre-commit.
- `~/.ralph/harness/` (tmux-tester scratchpad). May move later; not part
  of this scope. The harness is a debugging surface, not run state.
- A `ralph doctor` validator that detects typo'd manual creation
  (`.Ralph/`, `.ralphs/`). Footgun acknowledged, no tooling now.
- Version-pinning machinery (`.ralph/version` file) for schema-coupled
  Tier-2 fragility. Solo-dev vision = small blast radius; revisit if
  forks accumulate.
- A `ralph kickoff` command (the two-phase Claude session that earlier
  designs of `ralph new` ran). Killed entirely; user opens claude
  themselves after `ralph init`.
- Any change to the agent-loader, agent-registry resolution, or agent
  rubric prepend. ADR-0001's "agents live next to pipeline" stays.

## 3. Architecture

### 3.1 Current shape

```
target project (e.g. ralph-cli itself)
├── meditations/illuminations/<file>.md
├── meditations/stimuli/<file>.md
├── docs/adr/0001-*.md
├── CONTEXT.md
├── VISION.md
└── (repo source)

user home
└── .ralph/
    ├── <projectKey>/
    │   └── runs/<runId>/
    │       ├── checkpoint.json
    │       └── pipeline.jsonl
    └── harness/<run-id>/         ← tmux-tester scratchpad (out of scope)

ralph-cli npm package (source-controlled in this repo)
└── src/cli/pipelines/
    ├── janitor/<files>
    ├── meditate/
    │   ├── pipeline.dot
    │   └── stimuli/<29 lenses>.md
    └── implement/<files>
```

### 3.2 Target shape

```
target project
├── .ralph/
│   ├── pipelines/
│   ├── meditations/
│   │   ├── illuminations/<file>.md
│   │   └── stimuli/<file>.md           ← project-local extensions (29 bundled stimuli stay in ralph-cli)
│   ├── memory/
│   ├── docs/adr/0001-*.md
│   ├── VISION.md
│   ├── CONTEXT.md
│   └── runs/<runId>/
│       ├── checkpoint.json
│       └── pipeline.jsonl
└── README.md, src/, package.json, etc.

user home
└── .ralph/                              ← REMOVED for run state. Harness scratchpad stays out-of-scope.

ralph-cli npm package (unchanged)
└── src/cli/pipelines/
    ├── janitor/<files>
    ├── meditate/
    │   ├── pipeline.dot
    │   └── stimuli/<29 lenses>.md
    └── implement/<files>
```

### 3.3 Two-tier pipeline read

Pipeline resolution becomes:

1. **Project-local:** `<project>/.ralph/pipelines/<name>/pipeline.dot`
2. **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

If the project-local file exists, it wins. Bundled pipelines in `src/cli/pipelines/`
remain canonical and continue to refactor with ralph-cli releases. Forking
a bundled pipeline into `.ralph/pipelines/` is a deliberate "I'm taking
ownership" act — same as forking a vendor library.

The pipeline-resolver module (`src/cli/lib/pipeline-resolver.ts`) already
implements a search-path pattern. The change is:
- Drop the search through `<project>/pipelines/` (current project-local convention)
- Add the search through `<project>/.ralph/pipelines/`

Two-tier stimuli read for the meditate pipeline mirrors this.

### 3.4 Run state I/O

Today (`src/cli/lib/claudeTracePath.ts` + checkpoint writer + trace lookup):

```
~/.ralph/<projectKey>/runs/<runId>/checkpoint.json
~/.ralph/<projectKey>/runs/<runId>/pipeline.jsonl
```

`<projectKey>` is derived from a hash of the absolute project path.
`pipeline trace <runId>` scans across all `<projectKey>` directories.

After:

```
<project>/.ralph/runs/<runId>/checkpoint.json
<project>/.ralph/runs/<runId>/pipeline.jsonl
```

The `<projectKey>` derivation function and the cross-project scan in
`pipeline trace` go away. `pipeline trace <runId>` always looks under
`<project>/.ralph/runs/`. The `--project` flag becomes mandatory for
`pipeline trace` (it was optional before, with cross-project scan as
fallback).

`RALPH_RUNS_KEEP` env var still works; lazy pruning logic continues to
operate on `<project>/.ralph/runs/`.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/lib/ralph-paths.ts` | NEW. Exports the path-resolver functions in §2 item 3. ~30 lines. |
| `src/cli/tests/ralph-paths.test.ts` | NEW. One vitest case per exported function. ~50 lines. |
| `src/cli/commands/init.ts` | NEW. Implements `ralph init`. ~80 lines: mkdir tree, scaffold files, gitignore append, optional `git init`. |
| `src/cli/tests/init.test.ts` | NEW. Cases: fresh dir, existing `.ralph/` (idempotent), existing git repo, existing README, gitignore append (no duplicate). ~100 lines. |
| `src/cli/program.ts` | Register `init` command. Update help text examples to show `ralph init` and the new tree. |
| `src/cli/mcp/illumination-server.ts` | Replace `join(projectRoot, "meditations", "illuminations", ...)` etc. with calls to `illuminationsDir(projectRoot)` from `ralph-paths.ts`. Same for stimuli paths. ~6 path-string sites. |
| `src/cli/lib/claudeTracePath.ts` | Replace `~/.ralph/<projectKey>/runs/...` derivation with `<project>/.ralph/runs/...` from `ralph-paths.ts`. Drop the `projectKey` derivation function. |
| `src/cli/tests/claudeTracePath.test.ts` | Update assertions to match new path shape. |
| `src/cli/lib/pipeline-resolver.ts` | Replace `<project>/pipelines/<name>` search with `<project>/.ralph/pipelines/<name>`. Bundled fallback unchanged. |
| `src/cli/tests/pipeline-resolver.test.ts` | Update fixture paths. |
| `src/cli/commands/pipeline.ts` | Update `pipeline trace` to require `--project` (or default to cwd). Remove cross-project scan loop. |
| `src/cli/tests/pipeline-trace-lookup.test.ts`, `pipeline-trace-command-validation.test.ts`, `pipeline-failure-reason.test.ts` | Update expected paths. |
| `src/daemon/state.ts`, `src/daemon/index.ts` | Audit: do these write to `~/.ralph/`? If yes, migrate to `<project>/.ralph/runs/` if project-scoped, or keep at user-home if daemon is genuinely user-scoped (heartbeat scheduler is user-scoped, not project-scoped — see §9 open question). |
| `src/daemon/tests/state.test.ts` | Reflect daemon decision. |
| `src/cli/pipelines/meditate/pipeline.dot` | Update `meditations_dir` default from `meditations/illuminations` to `.ralph/meditations/illuminations` (or whatever the bundled default needs). Same for stimuli paths. |
| `src/cli/pipelines/janitor/*.md` (agent prompt files) | Update any hardcoded path strings referencing `meditations/illuminations`. |
| `src/cli/pipelines/illumination-to-implementation/*.md` | Update path references. |
| `src/cli/program.ts` (help text) | Update mentions of `~/.ralph/<projectKey>/runs/` → `<project>/.ralph/runs/`. |
| `README.md` | Update path strings: `meditations/illuminations` → `.ralph/meditations/illuminations`. Mention `ralph init`. Update the `--resume` paragraph (§3.4 path). |
| `CONTEXT.md` | Update "Illumination lifecycle" path string `meditations/illuminations/` → `.ralph/meditations/illuminations/`. Add new term entry "Project-local layout" pointing at ADR-0007 + describing the tree. (After the `git mv`, this file will live at `.ralph/CONTEXT.md`.) |
| `meditations/` → `.ralph/meditations/` | `git mv` (one shell command per directory). |
| `docs/adr/` → `.ralph/docs/adr/` | `git mv`. |
| `CONTEXT.md` → `.ralph/CONTEXT.md` | `git mv` (after content update above). |
| `VISION.md` → `.ralph/VISION.md` | `git mv`. |
| `.gitignore` | Add `.ralph/runs/` line. |

Approximately:
- 4 new files (`ralph-paths.ts`, `ralph-paths.test.ts`, `init.ts`, `init.test.ts`)
- ~10 source-code edits (path-string sites)
- ~9 test-file updates (path assertion sites)
- 4 `git mv` commands (4 directories/files)
- 2 doc updates (README.md, CONTEXT.md)
- 1 `.gitignore` line

## 5. Data flow

### 5.1 Pipeline run — before

```
ralph pipeline run foo.dot --project ./my-app
        │
        ▼
engine derives projectKey = hash(abspath(./my-app))
        │
        ▼
runDir = ~/.ralph/<projectKey>/runs/<runId>/
        │
        ├── mkdir -p
        ├── write checkpoint.json
        └── write pipeline.jsonl
```

### 5.2 Pipeline run — after

```
ralph pipeline run foo.dot --project ./my-app
        │
        ▼
runDir = ./my-app/.ralph/runs/<runId>/
        │
        ├── mkdir -p (creates parent .ralph/runs if absent)
        ├── write checkpoint.json
        └── write pipeline.jsonl
```

`projectKey` is gone. `runId` remains a timestamp/hash of the run's
identity. Resume logic looks at `<project>/.ralph/runs/<runId>/checkpoint.json`.

### 5.3 Illumination write — before / after

```
mcp__illumination__write_illumination(slug, body)
        │
        ▼ before:                                  after:
~/<project>/meditations/illuminations/<slug>.md    ~/<project>/.ralph/meditations/illuminations/<slug>.md
```

Path string changes; behavior identical.

## 6. Blast radius / impact surface

- **Size:** L (larger than typical because it touches every path-string
  site in the codebase).
- **Files touched:** ~25 total — 4 new files, ~10 source edits, ~9 test
  updates, 4 `git mv`s, 2 doc updates, 1 gitignore line.
- **Surfaces crossed:**
  - **CLI:** affected. New `ralph init` command, updated help text, and
    updated `pipeline trace` (loses cross-project scan).
  - **Pipeline engine:** affected. Run-state I/O moves; pipeline-resolver
    search path changes.
  - **MCP server:** affected. Path constants update.
  - **Agents:** affected. Prompt files in bundled pipelines that
    hardcode path strings update.
  - **Docs:** affected. README, CONTEXT.md, ADR-0007 (already shipped).
  - **Tests:** affected. ~9 test files update path assertions.
  - **Build:** unaffected. tsup config is unchanged; new files follow
    existing entry conventions.
  - **npm package:** the new `ralph init` command becomes part of the
    public CLI surface. No removed surface (since `ralph new` was never
    actually wired up).
- **Breaking changes for downstream projects:**
  - `meditations/illuminations/` and `meditations/stimuli/` no longer
    read at the old paths. Projects using ralph-cli must run `git mv` in
    their own repos.
  - Run state at `~/.ralph/<projectKey>/runs/` no longer written. Old
    runs there become unreadable by the new ralph-cli; rollback to
    previous version if needed.
  - `pipeline trace <runId>` without `--project` no longer scans across
    projects. Callers must pass `--project` (or rely on cwd default).

## 7. Trade-offs

### 7.1 Risk: schema coupling between project-local pipelines and ralph-cli

Project-local pipelines in `<project>/.ralph/pipelines/` are still
ralph-cli DSL files. Refactors to the DSL (frontmatter shape, node
attributes, rubric format) can break them silently.

**Accepted because:** solo-dev vision = one operator authors both
ralph-cli and the consuming projects. Blast radius is small. If forks
accumulate beyond what one operator can re-migrate manually, revisit
with a `.ralph/version` pin and `ralph upgrade` migration tool.

### 7.2 Risk: discoverability drop on GitHub

ADRs and CONTEXT.md move under `.ralph/`, which is a less-discoverable
location for an outsider browsing the repo on GitHub. The convention
`docs/adr/` is well-known (MADR / Nygard); `.ralph/docs/adr/` is not.

**Accepted because:** vision is solo-dev. README.md remains at root as
the human entry point; `.ralph/` is the agent entry point. The split
is the explicit design choice — one folder per audience.

### 7.3 Risk: typo'd manual creation silently ignored

A user who creates `.Ralph/` or `.ralphs/` manually gets silent failure —
ralph-cli simply doesn't see the folder.

**Accepted because:** convention-based tools all share this failure mode
(git ignores `.GIT/`, npm ignores `.NPMRC/`). A future `ralph doctor`
command can detect the mismatch if the footgun bites in practice. Not
shipped now.

### 7.4 Risk: cross-project trace lookup goes away

`ralph pipeline trace <runId>` previously scanned all `<projectKey>`
folders to find a runId. After migration, it requires `--project`.

**Accepted because:** the cross-project scan was a workaround for the
user-home tier. With state inside the project, there's no ambiguity —
the run was for one project, and you're standing in it. Scan complexity
disappears.

### 7.5 Risk: meditations/ rename is a content move, not a refactor

`git mv meditations/ .ralph/meditations/` moves potentially many files
in one commit. Reviewers see a noisy diff.

**Accepted because:** big-bang is the explicit choice (Q6 of the grill
session). Solo-dev = one operator, no reviewer coordination cost.
Chunked migration would leave the repo in a half-migrated state for
each transitional commit, which is worse for both the repo and any
in-flight ralph runs against the repo.

### 7.6 Risk: ADR-0001 reversal at the pipeline layer

ADR-0001 (2026-04-30) rejected the `~/.ralph/agents/` per-user tier on
the principle "no global agent library." This design re-introduces a
per-project tier — for *pipelines*. A future reader may see this as
inconsistent.

**Accepted because:** ADR-0007 explicitly addresses the tension. The
unit-of-ownership at the agent layer is the agent next to its pipeline
(unchanged from ADR-0001). The unit-of-ownership at the pipeline layer
is the project (new in ADR-0007). Two layers, two answers.

## 8. Constraints

- All edits land in a single coherent series of commits (one per chunk
  in the implementation plan). Splitting the path-constant update from
  the `git mv` of `meditations/` leaves the codebase in a state where
  source code reads `<project>/.ralph/meditations/...` but the actual
  files still live at `<project>/meditations/...` — broken at runtime.
- `npx tsc --noEmit` must pass after each chunk. The new
  `ralph-paths.ts` module's exports must be the single source of truth
  for path strings; no remaining hardcoded `meditations/illuminations`
  literals in `src/`.
- `npx vitest run` must pass after each chunk. Path-string updates in
  test fixtures land alongside the source edits they test.
- `npm run build` must succeed. The new `init.ts` command bundles
  cleanly under tsup; no new top-level entry, no removed entry that
  other entries depend on.
- `ralph init` must be idempotent. Running it twice on the same
  directory produces the same result as running it once. Existing files
  are never overwritten.
- The bundled pipelines (`src/cli/pipelines/janitor/`, `meditate/`,
  `illumination-to-implementation/`, `implement/`) continue to work
  against ralph-cli's own repo after migration. End-to-end smoke for
  one bundled pipeline is the green-light criterion for declaring the
  migration complete.

## 9. Open questions

1. **Daemon state.** `src/daemon/state.ts` writes some state (heartbeat
   schedule, task list). The daemon is **user-scoped**, not
   project-scoped — it manages tasks across projects. This state should
   probably stay at `~/.ralph/heartbeat/` or similar, *not* move into
   `<project>/.ralph/`. Confirm during implementation: is daemon state
   genuinely user-scoped? If yes, leave it at `~/.ralph/`. If it has
   per-project pieces, those move into `<project>/.ralph/`.

2. **Harness scratchpad** (`~/.ralph/harness/<run-id>/`) for tmux-tester.
   This is debugging surface, not run state. Out of scope for now;
   stays at `~/.ralph/harness/`. Revisit if it accumulates project-
   specific data.

3. **Plans surface** (`docs/superpowers/plans/`, `docs/superpowers/specs/`).
   This design does not move them. They could move to `.ralph/plans/`
   and `.ralph/specs/` later; not now.

4. **Bundled stimuli vs project-local stimuli.** Bundled stimuli ship
   in `src/cli/pipelines/meditate/stimuli/` (29 lenses). Project-local
   stimuli go in `<project>/.ralph/meditations/stimuli/`. The meditate
   pipeline must read both at runtime, with a defined precedence (e.g.
   project-local overrides bundled by filename). Confirm pipeline-side
   wiring during implementation.

5. **Existing projects' migration path.** Other projects using ralph-cli
   (besides ralph-cli itself) need to migrate too. They run `git mv`
   manually. No tooling. Document the migration in README.md? Or in
   ADR-0007 as a "rollout" section? Implementation plan can decide.

## 10. Verification approach

### 10.1 Static checks

After each chunk:

- `grep -rn 'meditations/illuminations\|meditations/stimuli' src/` — expected: zero hits in `src/` (all reads go through `ralph-paths.ts`). Hits in `src/cli/pipelines/` may remain in agent prompts where the path is rendered into a Claude prompt; those should also use the new path.
- `grep -rn '~/.ralph\|os\.homedir().*ralph' src/cli/` — expected: zero hits except in daemon code (if daemon stays user-scoped per §9.1).
- `grep -rn 'projectKey' src/cli/` — expected: zero hits (function deleted with claudeTracePath migration).
- `npx tsc --noEmit` — clean.

### 10.2 Tests

- `npx vitest run src/cli/tests/ralph-paths.test.ts` — new tests pass.
- `npx vitest run src/cli/tests/init.test.ts` — new tests pass.
- `npx vitest run` — full suite green; test count moves but stays green.

### 10.3 Smoke

- `ralph init` in a fresh `mktemp -d` directory. Confirms tree
  scaffolds, gitignore appended, idempotent on second invocation.
- `ralph pipeline run src/cli/pipelines/meditate/pipeline.dot --project .`
  in ralph-cli's own repo (post-migration). Confirms run state writes
  to `.ralph/runs/<runId>/`, illumination writes land in
  `.ralph/meditations/illuminations/`.
- `ralph pipeline trace <runId> --project .` reads the run from the
  new location.

## 11. Summary

A single project-local folder `<project>/.ralph/` becomes the home for
everything ralph-touchable in a target project: pipelines, meditations
(illuminations + stimuli), memory, ADRs, CONTEXT.md, VISION.md, and run
state. The `~/.ralph/<projectKey>/` user-home tier and the implicit
"is this a ralph project?" inference both go away. A new idempotent
`ralph init` command scaffolds the tree. All in-tree path constants
centralize in a new `ralph-paths.ts` module. ralph-cli's own repo
migrates atomically via `git mv` in a single coherent commit series.
ADR-0007 captures the decision; this design captures the implementation
shape; the implementation plan captures the bite-sized steps.
