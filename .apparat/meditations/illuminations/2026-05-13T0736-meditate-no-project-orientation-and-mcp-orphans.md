---
date: 2026-05-13
description: `apparat meditate <path>` accepts any folder without checking it is an apparat-shaped root — passing `.apparat/` already produced a buried ghost run at `.apparat/.apparat/`, and crash-leaked `.mcp-meditate-*.json` files pile up at the same level; both are missing-preflight + missing-cleanup symptoms.
---

## Core Idea

`apparat meditate <projectFolder>` (`src/cli/commands/meditate.ts:18-37`) only checks `existsSync(absPath)` before launching the pipeline. Any folder will do — including the project's own `.apparat/`. There is no preflight that the path is *apparat-shaped* (has `.apparat/`, `VISION.md`, etc.), and no startup GC for the side-effect files meditate is about to write. Two on-disk fingerprints confirm both gaps right now: a complete ghost run at `.apparat/.apparat/runs/meditate-4ab00e87/` (with a real, committed illumination at `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` that `list_illuminations` for the real project will never surface), and two orphaned MCP configs at the repo root (`.mcp-meditate-1777197355164.json`, `.mcp-meditate-1778650415070.json`).

## Why It Matters

The two artefacts are different bugs but the same shape: meditate writes durable side-effects (illuminations, runs, commits, MCP configs) without proving it is pointed at the right place or sweeping debris from a previous abort. Both penalties are silent.

**The path footgun.** `meditate-4ab00e87/checkpoint.json` records `project: /Users/josu/Documents/projects/apparatus/.apparat` — i.e. someone (operator typo, shell autocomplete, or a stale path env) invoked meditate against the project's own internal folder. The pipeline cheerfully:

- created `.apparat/.apparat/meditations/illuminations/` and wrote an illumination there;
- read empty `VISION.md` and empty `notes.md` (because they live one level up);
- committed and pushed the orphaned outputs (the illumination is in git history);
- finished with `success: true` and no warning.

This is exactly the failure mode the canonical `interaction-driver-escape` scenario was supposed to teach the engine to refuse — "are you really pointed at a project?" The tell-tale signal was right there in the inputs: `read_vision.vision` was empty *and* `read_notes.notes` was empty *and* the destination contained no prior illuminations. Any one of those should have been a "this folder doesn't look apparat-shaped — did you mean its parent?" prompt before writing anything. The pipeline trusts the path argument like an open-mode file write trusts a filename.

A nice analogy: `git init` will happily run inside an existing `.git/` directory and make a nested mess. The fix there is `git rev-parse --show-toplevel` — orient first, then write. Meditate has no equivalent.

**The cleanup gap.** `agent.ts:writeMcpConfig` writes `.mcp-{name}-{Date.now()}.json` to `cwd` and `cleanupMcpConfig` unlinks it in `run()`'s `finally`. That covers the happy path. It does *not* cover SIGKILL, OOM, or the meditate harness's own PID-aliveness fence (which can leave a child reaped while the parent dies between `writeMcpConfig` and the `finally`). The triage chat-notes `meditations/stimuli/.triage/7a505b4e-.../chat-notes.md:17` already flagged "delete orphaned `.mcp-meditate-1776156013597.json`" — and two months later there are two more. The gitignore (`.mcp-*-*.json`) hides them from `git status` but does not delete them. They accumulate. The `pipeline-bootstrap.ts:appendMeditateGitignore` step is half the symmetry — it adds the ignore line — but there is no matching startup sweep that GCs stragglers from prior runs.

The deeper observation: meditate has *no preflight discipline*. It validates `existsSync` and a PID file, then writes. The `pipeline-bootstrap.ts` module is named for "bootstrap" but only bootstraps gitignore lines and meditation dirs — not "is this the right kind of folder" or "is there leaked state from last time." Symmetry per `open-close-push-pull-lock-unlock.md`: every "create ghost outputs if path is wrong" needs a paired "refuse if path doesn't smell like a project root," and every "write `.mcp-{ts}.json` on the way in" needs a "sweep stale `.mcp-*-*.json` older than X minutes on the way in."

## Revised Implementation Steps

1. **Add a "project shape" preflight to `meditateCommand`.** Before calling `pipelineRunCommand`, assert at least one of: a `VISION.md`, a `CONTEXT.md`, an existing `.apparat/` directory at `absPath` (i.e. the *target*'s `.apparat/`, not a nested one), or a non-empty `.git/` adjacent. If none match, refuse with `Error: <absPath> does not look like an apparat-shaped project root. Did you mean its parent?`. Bonus heuristic: if `basename(absPath) === ".apparat"`, hard-refuse with the suggestion to use the parent. This is one if-block at `meditate.ts:22`.

2. **Sweep `.mcp-*-*.json` older than N minutes at startup.** In `pipeline-bootstrap.ts` add `gcStaleMcpConfigs(projectFolder, maxAgeMs = 30 * 60_000)` — glob the pattern, stat each, unlink if mtime older than threshold. Call it from `meditateCommand` right after `ensureMeditationDirs`. Symmetric pair to `appendMeditateGitignore`. (Same call site is the right place to GC stale `.meditate.pid` whose owner died — extending the existing aliveness check beyond the single-PID case.)

3. **Move (or delete) the existing ghost.** Delete `.apparat/.apparat/` from the working tree (one revert commit). Decide: is the buried illumination at `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-...md` worth keeping? It is a real, useful illumination. Cherry-pick its content into `.apparat/meditations/illuminations/` under the same slug (or supersede it with an updated one). Then `rm -rf .apparat/.apparat/`. Same commit removes the two `.mcp-meditate-1777197355164.json` / `.mcp-meditate-1778650415070.json` files at the repo root.

4. **Make the failure mode a smoke scenario.** Add `scenarios/meditate-rejects-internal-folder/` with a `pipeline.dot` (or operator-scenario stub) that invokes `apparat meditate .apparat` against a fixture and asserts a non-zero exit + the suggestion-to-use-parent error string. This is the smoke test that would have caught the original ghost run. Pair with `scenarios/meditate-sweeps-stale-mcp-configs/` asserting that a fresh meditate run unlinks a fixture `.mcp-meditate-0.json` whose mtime is in the past.

5. **Document the orient-then-write rule in SKILL.md.** One paragraph in `src/cli/skills/apparatus/SKILL.md` under a new "preflight discipline" section: every command that writes durable side-effects to `<project>` must validate the project is apparat-shaped *and* sweep its own debris before writing. Frame it as a generalisable rule so the next command (`init`, `janitor`, future `pipeline create`) inherits the obligation rather than re-discovering it.

## Provenance

- Source files: `src/cli/commands/meditate.ts`, `src/cli/lib/pipeline-bootstrap.ts`, `src/cli/lib/agent.ts` (`writeMcpConfig` / `cleanupMcpConfig` / `MCP_CONFIG_GLOB`).
- Ghost run evidence: `.apparat/.apparat/runs/meditate-4ab00e87/checkpoint.json` (project field = `.apparat`), buried illumination at `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md`.
- MCP debris: `.mcp-meditate-1777197355164.json`, `.mcp-meditate-1778650415070.json` (gitignored by `.mcp-*-*.json` line in root `.gitignore`).
- Prior triage hint: `.apparat/meditations/stimuli/.triage/7a505b4e-621a-409e-8669-5ae1e7c91b8c/chat-notes.md:17` already flagged orphaned mcp-meditate file two months ago.
- Steer: "focus on .apparat/notes.md if not already marked" — every note in `.apparat/notes.md` is already `[x]`; this illumination is not anchored to a note. Stimuli applied (implicit): `open-close-push-pull-lock-unlock`, `every-action-needs-an-escape`, `idempotency-run-it-twice`.
- Pipeline run id: `meditate-a04b97b4`.
- Surfaced by: meditate.
