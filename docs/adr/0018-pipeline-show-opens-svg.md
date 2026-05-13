# ADR 0018 — `pipeline show` auto-opens the SVG via the OS default opener

**Status:** Accepted
**Date:** 2026-05-13
**Related:** ADR-0010 (rename to apparatus — supplies context for the parallel allowlist refresh shipped in the same PR), ADR-0004 (source code, CONTEXT.md, and ADRs are the only authoritative documentation — rationale for recording the choice here).

## Context

`pipeline show` writes the rendered SVG next to the source `.dot` and returns 0. The operator has no other reason to invoke the command — the *purpose* of `pipeline show` is to **visualise** the pipeline. Before this change, `src/cli/commands/pipeline/show.ts:64-75` ended at `writeFileSync` + `output.success`, leaving the operator to switch windows and run `open foo.svg` by hand every single time. The same half-handler smell drove earlier illuminations (`.apparat/meditations/illuminations/2026-05-05-shallow-control-flow-handlers.md`).

The originating illumination at `.apparat/meditations/illuminations/2026-05-12T2324-inner-loop-ergonomics-debt.md` calls this out alongside the parallel Claude allowlist debt. VISION.md and CONTEXT.md (line 9 "no global agent library", line 70 "no side folders") make the project posture explicit: the operator **is** the end user. Friction in their inner loop is the user-experience metric for this project — there is no other.

## Decision

`pipeline show` spawns the OS default opener after writing the SVG:

- **darwin** → `spawn("open", [svgPath], { stdio: "ignore", detached: true })`
- **linux / other POSIX** → `spawn("xdg-open", [svgPath], { stdio: "ignore", detached: true })`
- **win32** → `spawn("cmd", ["/c", "start", "", svgPath], { stdio: "ignore", detached: true })`

Two flags surface on the subcommand:

- `--open` — force auto-open even when stdout is not a TTY.
- `--no-open` — skip auto-open even in an interactive shell.

When neither flag is passed, `opts.open` is `undefined` and `pipelineShowCommand` falls back to `Boolean(process.stdout.isTTY)`. This means interactive operator use auto-opens, while vitest workers and CI scripts (which pass `{}` and run without a TTY) stay no-op.

Spawn failure is non-fatal. Both synchronous `spawn` throw paths (missing binary on a stripped container) and the async `'error'` event are absorbed; the operator sees a `warn`-level "Could not auto-open SVG (…); open manually at <path>" and the command exits 0. The visualisation artefact is still on disk.

The opener is spawned with `detached: true` + `child.unref()` so the long-lived GUI (Preview.app, Firefox, etc.) does not hold the apparat CLI's event loop open after `pipelineShowCommand` returns.

## Considered alternatives

- **Preferred-browser detection** (read `$BROWSER`, parse macOS `LSHandlers` plist, scan `~/.config/mimeapps.list` on linux). Rejected — the illumination is explicit: *"if introduce a lot complicance should be forgotten."* Solo-dev + single-machine means the OS default is already configured exactly the way the operator wants. Detection code would carry its own maintenance burden for a feature the OS already provides.
- **No flag, always open.** Rejected — `pipeline-show-annotation.test.ts:40` and any CI / scripted caller would spawn `open` against a worker process. The `--no-open` escape is cheap and the TTY-aware default makes it ergonomic.
- **Auto-open opt-in (default `--no-open`).** Rejected — half-handler again; the operator still has to remember to add the flag. Goal is to remove the friction, not relocate it.

## Consequences

- Inner-loop friction shrinks: zero manual `open` calls during typical `pipeline show` use.
- CI / tests are unaffected — the TTY default makes the spawn a no-op outside interactive shells.
- The opener is the OS default, so customisation lives where the operator already configured it (macOS "Open with…" → "Always", linux `xdg-mime default`, win32 file-association settings). apparat does not duplicate that configuration surface.
- ADR-0004 ("source code, CONTEXT.md, and ADRs are the only authoritative documentation") means the choice is recorded here rather than buried in a session log.

## Cross-refs

- ADR-0010 (rename to apparatus) — supplies context for the parallel `.claude/settings.local.json` refresh shipped in the same PR.
- ADR-0004 — rationale for recording the choice as an ADR rather than a session note.
- Originating illumination: `.apparat/meditations/illuminations/2026-05-12T2324-inner-loop-ergonomics-debt.md`.
- Design doc: `docs/superpowers/specs/2026-05-13-inner-loop-ergonomics-debt-design.md`.

## 2026-05-14 amendment

Agent node labels now render a third line below `out:` showing the agent's `model`
and (when set to `low`/`high`) its `thinking:` budget — e.g. `opus · think:high`
or `sonnet`. The label answers "where am I burning tokens?" at a glance.
