# ralph-cli Directory Inventory

> Quick-orientation reference for new sessions (human or agent).
> Consult this before exploring the codebase.

## Top-Level Directories

| Directory | Role |
|---|---|
| `src/` | All TypeScript source. Five sub-roots: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/`. |
| `docs/` | Design specs (`superpowers/specs/`), code-review records (`superpowers/reviews/`), implementation plans (`superpowers/plans/`), orientation docs (`orientation/`), and the tmux harness guide (`harness/`). |
| `specs/` | Authoritative feature specs (`architecture.md`, `commands.md`, `meditate.md`, etc.). Source of truth for what each subsystem is supposed to do. |
| `pipelines/` | `.dot` pipeline definitions, JSON output schemas (`schemas/`), and `smoke/` sub-folder for CI-level pipeline fixtures. |
| `meditations/` | Two subfolders: `stimuli/` (meta-meditation lenses — `.md` pattern files used as reflection input) and `illuminations/` (LLM-generated insights — output of meditate sessions). |
| `scenario-tests/` | Shell-based integration tests that drive the CLI end-to-end, organized by feature. Complement vitest unit/component tests in `src/`. |
| `memory/` | Claude auto-memory files persisted across sessions. Session logs and architectural decisions. |
| `.claude/` | Local Claude Code settings (`settings.local.json`). Machine-local only, not checked in. |

## src/ Sub-Roots

| Sub-root | Contents |
|---|---|
| `cli/` | `commands/`, `components/`, `lib/`, `mcp/`, `agents/`, `prompts/`, `tests/` |
| `attractor/` | `handlers/`, `core/`, `transforms/`, `interviewer/`, `tests/` |
| `daemon/` | Background scheduler + socket server |
| `lib/` | Shared utilities used across cli, attractor, and daemon |
| `types/` | Ambient type declarations (`globals.d.ts`) |

## Where to Put Things

1. **New feature:** Check `specs/` first -- the spec likely already exists.
2. **New pipeline:** Place `.dot` files under `pipelines/smoke/` (CI fixtures) or `pipelines/` root (production workflows); add output schemas to `pipelines/schemas/`.
3. **New CLI command:** Touch `src/cli/commands/`, register in `src/cli/program.ts`, add agent prompt to `src/cli/agents/`, write tests in `src/cli/tests/`.
4. **New attractor handler:** Place implementation in `src/attractor/handlers/`, register in `registry.ts`, add tests in `src/attractor/tests/`.
5. **Debugging Ink TUI:** Consult `docs/harness/tmux-drive.md` before writing any tmux commands.

## Clarifications

- **specs/ vs docs/superpowers/specs/:** `specs/` holds current authoritative behavioral specs. `docs/superpowers/specs/` holds historical design documents that motivated those specs.
- **src/ has five sub-roots, not three:** Earlier references to "three sub-roots" (cli, attractor, daemon) are outdated. `lib/` and `types/` are first-class sub-roots.
