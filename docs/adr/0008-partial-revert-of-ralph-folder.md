# 0008 — Partial Revert of ADR-0007: Restore Third-Party Convention Files to Repo Root

**Status:** Accepted (2026-05-04)

**Supersedes (in part):** ADR-0007. Specifically, the layout-tree clauses placing `CONTEXT.md`, `VISION.md`, `docs/adr/`, and the unused `memory/` slot under `.ralph/`. The remainder of ADR-0007 (project-local pipelines, meditations, run state, the two-tier resolver) stands.

The verbatim fragment from ADR-0007's Decision section being reversed:

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
└── runs/                         ← gitignored (state, checkpoints, jsonl)
```

The four lines `memory/`, `docs/adr/`, `VISION.md`, and `CONTEXT.md` are reversed by this ADR. The `pipelines/`, `meditations/`, and `runs/` lines stand.

## Context

ADR-0007 (one week prior) introduced `<project>/.ralph/` as "the home for everything ralph-touchable." Operational evidence accumulated within days of dogfooding revealed an over-claim: third-party skills (`grill-with-docs`, `improve-codebase-architecture`) hard-code `CONTEXT.md` and `docs/adr/` at repo root by ecosystem convention. Placing these files under `.ralph/` made them invisible to skills that expect the standard layout. Two further symptoms: discoverability drop on GitHub (where outsiders browse root-level docs by default) and incomplete migration drift (root `pipelines/` and `memory/` never moved, while their `.ralph/` slots remained empty).

The principle "ralph reads it, therefore ralph owns it" does not hold. Reading a file is not the same as defining its convention.

## Decision

Adopt a **two-clause partition principle**:

A file or directory belongs in `<project>/.ralph/` only if **both**:

- **Clause A — ralph-defined.** Its format, lifecycle, or discovery semantics are specified by ralph (illumination YAML schema, `.dot` files with ralph attributes, run-state checkpoint format, etc.).
- **Clause B — no pre-existing root convention.** No widely-adopted ecosystem convention places the file at repo root (DDD glossary, MADR ADRs, generic markdown project-docs, npm `package.json`, etc.).

Both clauses are necessary. Clause A alone is too permissive (ralph parses many files). Clause B alone is too restrictive (it forbids `.ralph/` entirely). The combination is the rule.

### Concrete moves

| File | Lives at |
|------|----------|
| `CONTEXT.md`, `VISION.md` | repo root (clause B fails: pre-existing project-doc conventions) |
| `docs/adr/` | repo root (clause B fails: MADR convention) |
| `.ralph/pipelines/` | inside `.ralph/` (both clauses) |
| `.ralph/meditations/{illuminations,stimuli}/` | inside `.ralph/` (both clauses) |
| `.ralph/sessions/` | inside `.ralph/` (both clauses; renamed from "memory" — overloaded term) |
| `.ralph/scenarios/` | inside `.ralph/` (both clauses; smoke-pipeline test fixtures) |
| `.ralph/runs/` | inside `.ralph/` (both clauses; unchanged from ADR-0007) |

### Deprecated from ADR-0007

The `.ralph/memory/` slot is removed. Session-closure files written by the `memory-writer` pipeline node now land at `.ralph/sessions/`. The `memoryDir()` helper in `ralph-paths.ts` is renamed `sessionsDir()`. The `docsAdrDir()` helper is deleted; ADR paths use root `docs/adr/`.

## Consequences

**Positive:**
- Third-party skills land correctly at root-conventional paths.
- GitHub/IDE doc-outliners surface project docs by default.
- Operational test exists for future placement decisions; reduces re-litigation risk.

**Negative:**
- Reverses an accepted ADR within one week. Sets a precedent that ADRs encode best-understanding-at-time and update with new operational evidence. Mitigated by the append-only ADR convention: ADR-0007's body stays unchanged; ADR-0008 supersedes by reference.
- Dual locations for project content (`.ralph/` for ralph-defined, root for pre-existing conventions) require operators to learn the partition. The §Decision table is the reference.

**Out of scope (preserved from ADR-0007):**
- Project-local pipelines as a tier (`.ralph/pipelines/` overrides bundled).
- Run-state inside `.ralph/runs/` (no user-home tier).
- `~/.ralph/agents/` rejected (per ADR-0001).

## Alternatives considered and rejected

- **`CONTEXT-MAP.md` at root pointing into `.ralph/`.** Documented escape hatch in the skill ecosystem. Rejected: only fixes the primary skill, leaves humans + IDE outliners + secondary tools unhelped; codifies the over-claim instead of correcting it.
- **Patch the skills to look at `.ralph/CONTEXT.md` first.** Rejected: global blast radius (every project on the machine), bus-factor (collaborators on fresh machines silently fall back), sibling-skill drift (each doc-aware skill needs its own patch).
- **Symlinks.** Rejected: platform-fragile; doesn't match what humans see in GitHub UI.

## References

- ADR-0007: `.ralph/` as project-local home for ralph-touchable state.
- Spec: `docs/superpowers/specs/2026-05-04-ralph-folder-partial-revert-design.md` — full design and operational test.
- Plan: `docs/superpowers/plans/2026-05-04-ralph-folder-partial-revert.md` — implementation plan.

---

**Update 2026-05-05:** Naming superseded by [ADR-0010](0010-rename-to-apparatus.md). The folder name `.ralph/` becomes `.apparat/`; the two-clause partition principle stands.
