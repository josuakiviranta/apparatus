---
date: 2026-05-12
description: Two unmarked notes — `.claude/settings.local.json` still allowlists the pre-rename `ralph` binary while missing `apparat`/`git`/`rg`/`open`, and `apparat pipeline show` writes an SVG but never opens it — are one pattern: solo-developer inner-loop ergonomics deferred. Both are evening-sized fixes.
---

## Core Idea

Two open notes in `.apparat/notes.md` describe the same drift: the daily solo-developer loop carries small frictions the project keeps not fixing.

> - [ ] When meditator takes this task it should explore the workspace and think are there some tools that would make codebase searches easier and should be whitelisted. If everything is already almost optimal for workspace exploration this should be also noted.
> - [ ] Pipeline show command should create svg as it does right now but also then open the svg automatically in firefox (if possible to detect user's default browser and open there even better but if introduce a lot complicance should be forgotten)

`.claude/settings.local.json` (5 entries total) still grants `Bash(ralph:*)` — a binary that no longer exists post-ADR-0010 rename — while omitting the verbs the operator actually runs all day (`apparat`, `git`, `rg`/`ast-grep`, `node`/`tsx`/`vitest`, `open`). And `src/cli/commands/pipeline/show.ts:73-87` writes an SVG to disk and returns — the operator switches windows and runs `open foo.svg` by hand every single time. Both are <30-line fixes; neither is glamorous, neither has been done.

## Why It Matters

The vision is unambiguous: *"Solo-developer tooling... When it works, running a pipeline feels like delegating to someone who already understands the shape of the problem."* The operator **is** the end user. Friction in their inner loop is the user-experience metric for this project — there is no other.

The stale `Bash(ralph:*)` line is renaming debt left behind by ADR-0010 (rename to apparatus). It is a silent dead grant: the binary `ralph` does not exist, so the permission grants nothing. Meanwhile every `apparat status`, `apparat pipeline validate`, `apparat pipeline run`, `apparat init` invocation must be hand-approved during a normal day. Same for `git status` / `git log` / `git diff` (which both human and agent run dozens of times per session) and `rg` (which the apparatus skill at `src/cli/skills/apparatus/SKILL.md` doesn't even hint is the right tool — and which the meditate agent itself can't reach without escalating to subagents). Claude Code already ships the `less-permission-prompts` skill for exactly this audit — apparatus doesn't need to invent it, just run it.

For `pipeline show`: the only purpose of the command is to **visualise** the pipeline. Writing the artefact and stopping is half a feature — the same shallow-handler smell that closed sessions like `2026-05-05-shallow-control-flow-handlers.md` were written about. The note explicitly says "if introduce a lot complicance should be forgotten" — meaning: skip browser detection, use the OS default opener (`open` on darwin, `xdg-open` on linux, `start` on win32). One `execFile` call. KISS.

Both items also expose a missing meta-routine. Nothing in the project periodically re-audits the operator's daily verbs against the allowlist. A rename like `ralph → apparat` will silently halve the allowlist's value again next time. Worth folding into `apparat doctor` if and when it earns its keep — not today.

This composes with the prior illumination `2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md`: that illumination shaves opus-tax off pipeline tails; this one shaves wall-clock-and-prompt-tax off the developer's outer loop. Same project posture (KISS, solo-dev, no feature creep), different layer.

## Revised Implementation Steps

1. **Rewrite `.claude/settings.local.json` allowlist.** Drop the dead `Bash(ralph:*)`. Add `Bash(apparat:*)`, `Bash(git status:*)`, `Bash(git log:*)`, `Bash(git diff:*)`, `Bash(git show:*)`, `Bash(git branch:*)`, `Bash(rg:*)`, `Bash(ast-grep:*)`, `Bash(node:*)`, `Bash(tsx:*)`, `Bash(vitest:*)`, `Bash(npx:*)`, `Bash(open:*)`, `Bash(npm root:*)`, `mcp__illumination__*`. Keep destructive verbs (`git push`, `git reset --hard`, `rm`, `git commit` if you want commit-message review) **prompted**. One commit.

2. **Run the `less-permission-prompts` Claude Code skill** against this repo's transcripts to surface verbs missed in step 1 (every project has a dialect — heartbeat, scheduler, MCP servers, scenario fixtures all have their own one-off commands). Fold the diff into the same baseline file. This makes the audit reproducible the next time a rename happens.

3. **Make `pipeline show` open the SVG.** Add `--open / --no-open` (default `--open`). In `src/cli/commands/pipeline/show.ts` after the `writeFileSync` at line ~78, branch on `process.platform`: darwin → `execFile("open", [svgPath])`, linux → `execFile("xdg-open", [svgPath])`, win32 → `execFile("cmd", ["/c", "start", "", svgPath])`. Failure to spawn is non-fatal — log `wrote svg; open manually at <relPath>` and exit 0. No browser detection; let the OS pick. Add a test that asserts `--no-open` skips the spawn.

4. **Update `src/cli/skills/apparatus/SKILL.md`'s `pipeline show` row** to mention the auto-open default + `--no-open` escape. Update `README.md`'s `pipeline show` paragraph too — the auto-open is part of the feature, not a hidden behavior.

5. **Append a one-line ADR** (`docs/adr/0016-pipeline-show-opens-svg.md`) recording: `pipeline show` deliberately uses the OS default opener; we **do not** detect the user's preferred browser. Reason: solo-dev, single-machine, fragile detection logic is YAGNI. Cross-link to ADR-0010 for the naming/posture context.

6. **Sweep for stale `ralph` references in living files** — non-historical (i.e. exclude `.apparat/sessions/`, `docs/adr/0007/0008`, and any in-memory transcript). `grep -rn "ralph" --include="*.json" --include="*.md" --include="*.ts"` outside the explicitly-historical folders. Fold any non-historical matches into the same PR; this is renaming-debt collection, not a separate effort.

7. **(Deferred, do not build yet.)** An `apparat doctor` command that prints allowlist gaps + stale grants + missing-but-installed binaries. Tempting, but YAGNI unless prompt rate stays high after steps 1-2. Note the option in this illumination and walk away; revisit only if it pays for itself.

## Provenance

- Source notes: `.apparat/notes.md` line 1 (tool whitelist) and line 4 (svg auto-open) — both still unmarked.
- Source files: `.claude/settings.local.json` (stale `Bash(ralph:*)`, 5-entry allowlist), `src/cli/commands/pipeline/show.ts:73-87` (writes svg, returns, never opens), `src/cli/skills/apparatus/SKILL.md` (`pipeline show` row has no auto-open hint), `README.md` ("Useful for sharing topology snapshots or eyeballing branching structure" — eyeballing requires opening it).
- Adjacent illumination intentionally NOT restated: `2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` (covers notes 2+3 on model tiering + sessions/ writes).
- Pipeline run id: `meditate-c9977811`
- Surfaced by: meditate
