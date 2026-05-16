---
date: 2026-05-16
description: apparatus has six top-level directories each with a distinct role: src/ (engine), .apparat/ (project-local artefacts), docs/ (ADRs + specs), pipelines/ (smoke tests), .claude/ (harness settings), and root config files.
---

## Core Idea

The apparatus repo has six top-level directories, each with a clear and distinct role. Understanding the partition matters because apparatus itself enforces a two-tier pipeline architecture — bundled vs. project-local — and the repo layout reflects that split directly.

Top-level inventory:

| Directory | Role |
|-----------|------|
| `src/` | All TypeScript source: engine (`attractor/`), CLI commands and components (`cli/`), background daemon (`daemon/`), shared lib (`lib/`), ambient types (`types/`) |
| `.apparat/` | Project-local artefacts: pipelines, meditations (illuminations + stimuli), scenarios, sessions, run state |
| `docs/` | Architecture decision records (`adr/`), harness documentation, superpowers specs/reviews/verifications |
| `pipelines/` | Smoke test pipeline fixtures (`smoke/`) used by CI and manual verification |
| `.claude/` | Claude Code local settings (`settings.local.json`) |
| Root config files | `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `VISION.md`, `CONTEXT.md`, `AGENTS.md`, `README.md`, `IMPLEMENTATION_PLAN.md` |

## Why It Matters

The two-tier pipeline split — bundled pipelines in `src/cli/pipelines/` vs. project-local pipelines in `.apparat/pipelines/` — is the core architectural commitment of VISION.md. The repo layout makes this concrete: `src/` owns the engine and bundled pipelines, `.apparat/` owns the project-local layer that apparatus itself uses when running pipelines against itself. This self-hosting property (apparatus running pipelines against apparatus) is the canonical proof of the design.

`pipelines/` at root is easy to confuse with `src/cli/pipelines/` — the former holds smoke fixtures used by tests, the latter holds the actual bundled pipeline definitions that ship with the npm package.

## Revised Implementation Steps

1. Add a comment or README note in `pipelines/` clarifying it holds smoke test fixtures only — not bundled pipeline definitions — to prevent future confusion with `src/cli/pipelines/`.
2. Verify that `CONTEXT.md` documents the `src/cli/pipelines/` vs. `.apparat/pipelines/` vs. `pipelines/` (smoke) distinction explicitly — if not, add a single paragraph.
3. No other changes needed: the directory layout is clean and mirrors the architecture as described.
