# Skill distribution as thin shim plus live reference

The apparatus skill (consumer-facing Claude Code skill that teaches Claude how to run, author, validate, and trace apparat pipelines) is split into two files: a small stable `SKILL.md` shim that `apparat init` copies into `<project>/.claude/skills/apparatus/`, and a larger `pipelines.md` authoring reference that is **never copied** — Claude reads it live from inside the installed npm package at `<npmRoot>/apparat-cli/dist/skills/apparatus/pipelines.md`. The shim lists the top-level CLI commands (stable surface) and instructs Claude to resolve and read the live reference before any pipeline-authoring work.

This shape eliminates drift between the consumer's pinned apparat-cli version and the authoring reference Claude consults: when the user upgrades apparat-cli, the live reference auto-updates with the new release; the shim only needs refreshing if the top-level command surface itself changes, which is rare. Consumer projects keep one tiny stable file in version control rather than churning hundreds of lines of reference content on every CLI bump.

## Considered Options

- **Copy everything on `init`, never overwrite.** Predictable but the reference rots silently after upgrades; user must manually `rm` and re-init to refresh. Rejected — drift is the dominant failure mode for fast-moving CLIs like this one.
- **User-global skill at `~/.claude/skills/apparatus/`.** One-time install, simpler distribution. Rejected — version skew between a globally installed skill and per-project pinned `apparat-cli` versions, and breaks the "consumer repo is the unit of truth" pattern that `.apparat/pipelines/` already follows.
- **Auto-sync on every `apparat` invocation.** Zero drift, but magic and surprising; consumer's `git diff` shows skill churn after each CLI upgrade. Rejected — violates the principle that init operations are explicit and idempotent.
- **`apparat skill print` subcommand instead of `npm root -g` path resolution.** Cleaner abstraction but adds a CLI surface to maintain. Deferred — revisit if path resolution proves brittle across npm/pnpm/yarn or non-global installs.

## Consequences

- The shim hardcodes a path-resolution recipe (`npm root -g` → `<npmRoot>/apparat-cli/dist/skills/apparatus/pipelines.md`). Non-global installs (per-project `npm install apparat-cli`) require a different recipe; the shim must document both or fall back gracefully.
- The build (`tsup`) must copy `src/cli/skills/**` into `dist/skills/` so the live reference is present in the published npm package.
- The shim and the live reference can disambiguate their roles in their own frontmatter — shim is the trigger surface, reference is the authoring schema. They do not duplicate content.
