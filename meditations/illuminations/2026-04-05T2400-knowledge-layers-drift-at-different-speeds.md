---
date: 2026-04-05
description: 'This project represents its own state in at least five layers: code, commit history, design specs (`docs/superpowers/specs/`), memory (`MEMORY.md`), and illuminations (`meditations/illuminations/`).'
---

# Knowledge Layers Drift at Different Speeds

## Core Idea

This project represents its own state in at least five layers: code, commit history, design specs (`docs/superpowers/specs/`), memory (`MEMORY.md`), and illuminations (`meditations/illuminations/`). Only the code updates automatically. The other four drift the moment a commit lands. As of today, the code has already implemented the ESM migration and replaced all `basename(__dirname)` detection with the `__RALPH_PROD__` tsup constant — but `MEMORY.md` still lists `ralph heartbeat watch` crashing as a known issue, and `2026-04-05-esm-migration-design.md` still reads as a plan, not a record of completed work.

## Why It Matters

A developer arriving at this codebase tomorrow morning faces four navigational hazards simultaneously:

1. **`MEMORY.md` says the heartbeat watch crashes** due to ink/CJS incompatibility. `tsup.config.ts` shows `format: ["esm"]` already in place. The known issue is resolved, but the memory says otherwise. A new session started with this MEMORY.md will treat a fixed bug as an open problem.

2. **`2026-04-05-esm-migration-design.md` reads as a to-do list**. It instructs: change `format: ["cjs"]` to `format: ["esm"]`, add `"type": "module"` to `package.json`, rewrite `__dirname` in four files. All of this is done. The spec has no status field, no "completed" marker. It will mislead anyone who reads it as instructions.

3. **`2026-04-05T1045-basename-dirname-is-a-fragile-contract.md`** recommended using `__RALPH_PROD__` as the fix. The code adopted that recommendation. The illumination has no pointer back to the commit or the spec that resolved it. It reads as an open problem when it is a closed one.

4. **The prior illumination at `2330`** recommended adding a memory-read step to `PROMPT_meditation.md`. That prompt is identical to the system prompt running this very session — and this session did not read prior illuminations before exploring. The illumination identified a real gap, but the gap is still open.

The deeper issue: this project builds forward-only. Observations flow from the code into illuminations. Illuminations do not flow back into updated specs or MEMORY.md. Design specs do not get marked complete when their commits land. The observation infrastructure is one-way: it accumulates, but it never converges.

## Revised Implementation Steps

1. **Update `MEMORY.md` to remove or close the stale known issue.** The `ralph heartbeat watch` crash entry under "Known Issues" should be replaced with a note that the ESM migration was completed on 2026-04-05. This is a 2-minute edit that prevents every future agent session from starting with a false map.

2. **Add a `Status:` field to spec files.** Every file in `docs/superpowers/specs/` should have a header: `Status: Draft | Approved | Implemented | Superseded`. The ESM migration spec is `Implemented`. The meditate-add spec, meta-meditations spec, and others should be audited against the code and marked accordingly. A one-line convention prevents a directory of plans from becoming a graveyard.

3. **Add a terminal section to acted-upon illuminations.** When an illumination's recommendation is executed (the `__RALPH_PROD__` fix from `1045`, for example), append a `## Resolution` section: the date, the relevant commit hash, and one sentence on what was done. This doesn't require tooling — it's a manual edit the developer makes at merge time, taking 30 seconds. It makes the illumination archive legible as history rather than a static pile of open problems.

4. **Amend `PROMPT_meditation.md` to include the prior-illuminations read step** described in `2026-04-05T2330-meditate-prompt-has-no-memory-read-step.md`. That illumination is directly actionable and has not been acted on. It is the highest-leverage single edit in the repository today: one new step before exploration that prevents every future session from re-discovering what the previous nine already noticed.

5. **Treat the spec directory as an audit target in `ralph meditate`.** Add one line to `PROMPT_meditation.md` instructing the agent, after surveying the codebase, to glob `docs/superpowers/specs/*.md` and check whether any spec marked `Approved` describes work that already appears in the code. If so, name the drift explicitly in the illumination. This turns the meditation agent into a convergence mechanism, not just an observation one.
