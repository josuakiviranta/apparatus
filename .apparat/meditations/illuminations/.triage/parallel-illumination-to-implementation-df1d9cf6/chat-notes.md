# Chat round notes — 2026-05-11T16:00

## What the user raised

- Bloat / feature-creep concern: "What ??? Is this bloat or feature creep? How simplifies things?"
- TOML format concern: "I don't even currently use toml and it's more for python projects anyway"
- Request for plain, concrete examples of post-unification user experience: "Talk normaly and simple I'm dumb. Use examples"
- Confirmation of scope-down direction after seeing before/after CLI examples: "Ok sounds good"
- Drop `--max` and `--scenarios` entirely: "I never use implement with max_iterations or scenarios_dir so these can be removed"
- Keep `--steer` flag: "However, steer flag I use often"

## Conclusions reached

- **Scope down to CLI surface unification only.** Defer the declarative-preflight / `pipeline.toml` portion of the illumination.
  - Came from: bloat / feature-creep concern + TOML concern
  - Rationale: User sees the new file format as added cognitive cost without a matching simplification gain. The PID-lock / gitignore-append / ensureDirs code runs either way — relocating it into a sibling file is aesthetic, not functional. Project uses zero TOML today; introducing it for one sibling is format-creep. The cheap wins (positional unification + flag handling) do not require a new file format.

- **Drop `--max` and `--scenarios` flags from `apparat implement` entirely.** No alias, no migration to `--var`. Just gone.
  - Came from: "I never use implement with max_iterations or scenarios_dir so these can be removed"
  - Rationale: User confirms they never invoke these flags. Pipeline.dot already has safe defaults — `implementer` declares `default_max_iterations="0"` (line 13) and `scenarios_dir` conditions check for empty string (lines 27-28), so the pipeline runs cleanly without either var. If the user ever needs them, generic `--var max_iterations=N` / `--var scenarios_dir=...` remains available via `pipeline run`.

- **Keep `--steer` as a real first-class flag on `apparat meditate`.** Translates internally to `--var steer=...`.
  - Came from: "However, steer flag I use often"
  - Rationale: Daily-driver ergonomics. The translation is one line of code in the thin shim, not a new file format.

- **Unify positional shape to `apparat <pipeline-name> <project> [--var k=v ...]`.**
  - Came from: scope-down acceptance after concrete before/after example
  - Rationale: One command shape across `implement`, `meditate`, and `pipeline run` reduces the user-facing surface from three shapes to one. Cheap to ship — Commander aliases plus arg-position fix in `pipeline run`.

- **Collapse `implement.ts` and `meditate.ts` to thin Commander aliases that call `pipelineRunCommand`.** Move shared bootstrap (PID lock, gitignore append, ensureDirs, tmux preflight) into one helper in TypeScript — not a declarative sibling file.
  - Came from: scope-down acceptance
  - Rationale: Consolidates duplicated bootstrap into one shared helper without inventing a new schema/format. Same simplification benefit for the maintainer; zero new format for users to learn.

## Open questions

- Where exactly the shared bootstrap helper lives (e.g., `src/cli/lib/pipeline-bootstrap.ts` vs. extending `pipeline-resolver.ts`) — deferred to the design-writer; not a user-facing decision.
- Whether `apparat <project>` shorthand for `implement` gets actually wired into `program.ts` (currently documented in README:49 but never implemented) — deferred; orthogonal to this scope-down.
