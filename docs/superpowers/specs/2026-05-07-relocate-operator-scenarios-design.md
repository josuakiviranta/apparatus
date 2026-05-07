# Design: relocate operator scenarios from `src/tests/scenarios/` to `.apparat/scenarios/`

**Date:** 2026-05-07
**Status:** draft (pending review)
**Predecessor ADRs:** ADR-0003 (scenario tests in implement pipeline), ADR-0007 + ADR-0008 (`.apparat/` as project-local home; naming superseded by ADR-0010), ADR-0010 (rename to apparatus)

## 1. Motivation

`src/tests/scenarios/` currently holds three operator-scenario markdown files used by apparatus's own dogfooding of its `--scenarios` branch:

- `src/tests/scenarios/apparat-init-idempotent.md`
- `src/tests/scenarios/apparat-init-scaffolds-tree.md`
- `src/tests/scenarios/pipeline-list-reads-apparat-pipelines-dir.md`

Each file is a Setup / Action / Expect prose spec consumed by the bundled `implement` pipeline's `--scenarios <path>` branch (ADR-0003). The agents `scenario-author.md` write into the directory; the `tmux-tester` agent verifies them against the current build.

`src/` exists for TypeScript source. Test-fixture markdown sitting under `src/tests/` is the only artefact in the tree that violates that boundary. Project-local artefacts (pipelines, meditations, sessions, smoke fixtures, run state) already live under `.apparat/` per VISION.md line 32 and ADR-0007 / ADR-0008 / ADR-0010. Operator scenarios are also project-local artefacts; they belong with the rest.

### 1.1 Why `.apparat/scenarios/` works as the new home

`.apparat/scenarios/` already exists with 15 subdirectories holding pipeline smoke fixtures (`pipeline.dot` + agent siblings), e.g. `.apparat/scenarios/conditional/pipeline.dot`. Two distinct file shapes coexist without collision:

- **Operator scenarios** — bare `.md` at the directory root. Setup / Action / Expect prose. Consumed by `apparat implement --scenarios <path>` and the `tmux-tester` agent.
- **Pipeline smoke fixtures** — subdirectory containing `pipeline.dot` + agent siblings. Consumed by the 11 `src/cli/tests/pipeline-smoke-*-folder.test.ts` files and by the `illumination-to-implementation` pipeline's manual tmux-tester (`.apparat/pipelines/illumination-to-implementation/tmux-tester.md:200`).

Existing tooling already filters by shape (three guards):

- `ls $project/.apparat/scenarios/*/pipeline.dot` (tmux-tester operator instructions, `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:200`) — matches subdirs only, ignores root `.md`.
- Per-folder smoke tests reference `.apparat/scenarios/<name>/pipeline.dot` paths verbatim — match only their named subdir.
- `src/attractor/tests/dual-parser.test.ts:16-21` walks `.apparat/scenarios/` recursively but filters with `name.endsWith(".dot")` — root `.md` invisible.

A bare `.md` at `.apparat/scenarios/` root is invisible to all three filters. Coexistence is mechanical, not aesthetic.

### 1.2 Why the word "scenarios" widens

VISION.md line 32 currently glosses the folder as "smoke-pipeline test fixtures" — narrow. Both shapes ARE scenarios in the general sense (observable behavior under test); the narrow gloss was provisional, written when only smoke fixtures lived there. Widening the definition costs one line of doc and removes the cleanest argument against the move.

## 2. Decision summary

1. **Move the three operator scenario files** from `src/tests/scenarios/` to `.apparat/scenarios/` root. Use `git mv` to preserve history.
2. **Delete the empty directories** `src/tests/scenarios/` and `src/tests/`. `src/` returns to TypeScript-source-only.
3. **Update text references** in 5 files where the old path appears as a string literal, example, or definition. ADR-0003 historical body is left untouched (dated artifact).
4. **Widen VISION.md line 32** — "scenarios (operator scenarios + smoke-pipeline test fixtures)".
5. **Update CONTEXT.md "Harness scenario" entry** (line 98–104): replace the path on line 100 and append a single sentence cross-referencing coexistence with smoke fixtures (e.g. "Co-located under `.apparat/scenarios/` — operator scenarios at root, smoke fixtures in subdirs; see **Smoke-pipeline scenario**."). Do NOT add a new top-level section — the existing "Harness scenario" + "Smoke-pipeline scenario" entries already disambiguate.

## 3. File-shape coexistence (post-move)

```
.apparat/scenarios/
  apparat-init-idempotent.md                              ← operator
  apparat-init-scaffolds-tree.md                          ← operator
  pipeline-list-reads-apparat-pipelines-dir.md            ← operator
  agent-implement/                                        ← smoke fixture
    pipeline.dot
    ...
  agent-json-vars/
  chat-end-to-end/
  chat-only/
  conditional/
  gate/
  json-schema-stream/
  meditate-steer/
  missing-caller-var/
  static-multi-node/
  store/
  tmux-tester/
  tool/
  tool-runtime-vars/
```

## 4. Reference inventory (must update)

Verified via `grep -rn "src/tests/scenarios" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git`:

| File | Line(s) | Kind | Action |
|---|---|---|---|
| `CONTEXT.md` | 100 | definition: "typically under `src/tests/scenarios/`" | replace path |
| `src/cli/skills/apparatus/pipelines.md` | 377 | example `--var` value | replace path |
| `src/cli/program.ts` | 82 | `--scenarios` help-text example | replace path |
| `src/cli/pipelines/implement/scenario-author.md` | 120 | example output string | replace path |
| `src/cli/tests/implement.test.ts` | 69, 73, 89 | test fixture string | replace path |
| `docs/adr/0003-scenario-tests-in-implement-pipeline.md` | 189 | historical option-(c) | **leave untouched** (dated artifact, ADR convention) |

Verified via `grep -rn "scenarios" docs/adr/`: no other ADR pins this path.

## 5. What does NOT change

- **The `--scenarios` flag default stays empty.** No code hardcodes `src/tests/scenarios/`. The flag is caller-supplied; only example strings update.
- **The 15 pipeline smoke fixtures stay under `.apparat/scenarios/<name>/`.** No rename, no churn, no test edits.
- **The 11 `pipeline-smoke-*-folder.test.ts` files are not touched.** They reference `<name>/pipeline.dot` paths that the move does not affect.
- **`tmux-tester.md` glob `ls $project/.apparat/scenarios/*/pipeline.dot` keeps working.** Bare `.md` at root is invisible to it.
- **ADR-0003 body stays as historical record.** Path drift in dated ADRs is documented per ADR-0003's own status-note convention (top-of-file).
- **Scenario file format is not changed.** Setup / Action / Expect prose is preserved verbatim.

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A consumer hardcodes `src/tests/scenarios` outside the inventory | low | Final `grep -rn "src/tests/scenarios"` after edits must return zero non-historical hits. ADR-0003 line 189 is the one exception. |
| Operator passes `--scenarios src/tests/scenarios` from muscle memory | low | Empty directory will fail discovery loudly; help text updated to point at new path. |
| External documentation / blog posts reference the old path | n/a | Single-developer project per VISION.md §"Who it's for". |
| `git mv` followed by `git rm` of `src/tests/` orphans an empty directory in worktree | low | `rmdir` after `git mv` if directory is empty; otherwise leave for the next commit to clean. |

## 7. Acceptance gates

After execution:

1. `ls .apparat/scenarios/` shows 3 root `.md` + 15 subdirs.
2. `ls src/tests/` returns "No such file or directory" or shows directory removed.
3. `grep -rn "src/tests/scenarios" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git` returns only `docs/adr/0003-scenario-tests-in-implement-pipeline.md:189` (historical) and zero other hits.
4. `npm test` green — `implement.test.ts` re-runs against the new fixture string; pipeline-smoke suite untouched.
5. `apparat pipeline validate .apparat/scenarios/conditional/pipeline.dot` still validates (smoke-fixture untouched).
6. VISION.md line 32 reads the widened definition.

## 8. Out of scope

- Renaming `.apparat/scenarios/<name>/` smoke-fixture folders (would be a much larger refactor; not justified by this move).
- Splitting "scenarios" into two separate top-level folders (`.apparat/operator-scenarios/` + `.apparat/smoke/`). Rejected: word coexistence already documented; two-folder split is doc churn for marginal disambiguation.
- Changing the scenario-test format or the `--scenarios` flag surface.
- Adding new scenarios to cover the move itself.
