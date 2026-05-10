# 0010 — Rename `ralph` → `apparatus`

**Status:** Accepted (2026-05-05)

**Supersedes (in part):** ADR-0007 (`.ralph/` as project-local home) and ADR-0008 (partial revert + partition principle), but only their *naming*. The project-local layout principle and the §1.2 two-clause partition rule both still hold; only the folder name `.ralph/` becomes `.apparat/` and the brand `ralph` becomes `apparatus` (binary `apparat`).

## Context

The name `ralph` is a placeholder that has outlived its utility. The new name `apparatus` better describes the project's actual shape: a machine in which `apparatchik` agents do one job each toward a larger goal (per the spider/web mental model already in `MEMORY.md`). The rename is taste plus a better-fitting metaphor; there is no public collision driving urgency, no compatibility cohort to migrate, and no architectural change.

`VISION.md`'s "personal harness for one developer, one machine — not multi-tenant" charter eliminates the need for compatibility shims, cross-version transition releases, or auto-migration of legacy `.ralph/` folders.

## Decision

Adopt the following rename map:

| Surface | Before | After |
|---|---|---|
| Brand / repo / GitHub | `ralph-cli` | `apparatus` |
| Binary | `ralph` | `apparat` |
| Project-local folder | `<project>/.ralph/` | `<project>/.apparat/` |
| Env vars (7, +`APPARAT_HOME` net-new) | `RALPH_*` | `APPARAT_*` |
| Build constant | `__RALPH_PROD__` | `__APPARAT_PROD__` |
| Path-helper module | `src/cli/lib/ralph-paths.ts` | `src/cli/lib/apparat-paths.ts` |
| Path-helper function | `ralphDir()` | `apparatDir()` |
| Domain idiom | "ralph-shaped project" | "apparat-shaped project" |
| npm package name | `ralph-cli` | `apparat-cli` (provisional; finalized post-merge) |

`APPARAT_HOME` was added later (2026-05-10) as a test-isolation override — not a rename. It overrides `~/.apparat` for tests, fixtures, and embed callers; it has highest precedence in `getApparatHome()` (`src/daemon/state.ts`), falling back to `HOME` then `homedir()`.

Migration is big-bang: a single PR rewrites every reference. No compatibility layer, no transition release, no auto-migration code. Each project on the developer's machine that uses the tool runs `git mv .ralph .apparat && git commit` once, manually, after upgrading.

The brand-vs-binary split (apparatus + apparat) follows the `kubernetes/kubectl` and `terraform/tf` precedents. The brand noun is load-bearing for the metaphor (apparatchik = worker of *apparatus*); the short binary name optimizes daily typing.

The project-local folder name `.apparat/` matches the binary, not the brand, following the `.git/`/`.cargo/`/`.npm/` convention.

The "agent" vocabulary stays in code, schema, frontmatter, and CONTEXT.md §Agent loading. `apparatchik` is metaphor-only; it appears in README/VISION prose, not in pipeline DSL or runtime.

## Consequences

**Positive:**
- Brand reads as the project's actual mental model; future contributors (or future-me) read `apparatus` and recognize the machine-with-workers shape.
- Six-character binary `apparat` is faster to type than nine-character `apparatus`.
- `.apparat/` as folder name follows ecosystem convention; saves two characters per path string × ~1287 references in the codebase.
- Removes the legacy placeholder name from public surfaces.

**Negative:**
- 292 files touched in one PR. Diff is large but mechanical; review burden is verifying mechanics, not semantics.
- Breaking change for any external script invoking `RALPH_*` env vars or the `ralph` binary. Cohort size: one user.
- Frozen prose (ADRs 0001–0009, plans, sessions, runs, MEMORY.md topic files) continues to reference "ralph". Future readers must follow this ADR's supersession link to understand the rename.

**Out of scope (preserved from ADR-0007 + ADR-0008):**
- The two-clause partition principle (ralph-defined AND no pre-existing root convention). Still holds; only the folder name changes.
- Project-local pipelines as a tier (`.apparat/pipelines/` overrides bundled).
- Run-state inside `.apparat/runs/` (no user-home tier).
- Code vocabulary: "agent", "pipeline", "illumination", "session-closure file" all unchanged.

## Alternatives considered and rejected

- **Unified `apparatus` everywhere (no binary shorthand).** Rejected: nine-character binary is borderline-tedious for daily typing; loses the recognized brand-vs-binary precedent.
- **Unified `apparat` everywhere (no brand longform).** Rejected: collapses the metaphor (apparatchik = worker of *apparatus*).
- **Folder `.apparatus/` (brand-matching).** Rejected: departs from `.git/`/`.cargo/`/`.npm/` convention; longer path strings; folder is operational, not promotional.
- **Transition release with auto-migration.** Rejected: VISION explicitly scopes the project to one developer; compat code lives in the binary forever once added.
- **Editing ADRs 0007/0008 in place.** Rejected: violates the MADR append-only convention.

## References

- Spec: `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`
- Plan: `docs/superpowers/plans/2026-05-05-rename-to-apparatus.md`
- ADR-0007: `.ralph/` as project-local home (naming superseded by this ADR; substance retained).
- ADR-0008: Partial revert + partition principle (naming superseded by this ADR; substance retained).
