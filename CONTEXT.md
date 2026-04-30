# ralph-cli — Domain Language

## Glossary

### Agent loading

An agent is the file `<pipeline-folder>/<agent-name>.md` sitting next to its
`pipeline.dot`. There is **no global agent library**. Cross-pipeline reuse
is by file copy into the consuming pipeline's folder.

The runtime path is `loadAgent(name, pipelineDir)` in
`src/cli/lib/agent-loader.ts`. A missing file fails fast with
`Agent file not found: <path>`.

Excised on 2026-04-30 (see `docs/adr/0001-agents-live-next-to-pipeline.md`):
the old `agent-registry.ts` multi-tier resolver, the user-dir tier
(`~/.ralph/agents/`), the bundled-agents dir (`getBundledAgentsDir`), the
`ralph agent list/show` CLI subcommands, and the
`allowBundledFallback`/`RegistryOptions` shape. Stray
`~/.ralph/agents/` files on contributor machines are now inert.

All pipelines live in this repo (`pipelines/`, `src/cli/pipelines/`). A
pipeline is run against an external target project via `--project <folder>`
(positional refactor pending).

### Illumination lifecycle

An illumination has two states by location: **alive** (file exists in
`meditations/illuminations/`) or **consumed** (file deleted). There are no
side folders, no `archived` or `implemented` lifecycle directories, no
in-flight `dispatched` state.

Consumption is the single terminal operation. Two reasons annotate why a
consumption happened — `implemented` (the implement loop succeeded and
memory was written) or `declined` (operator rejected at the pipeline gate)
— but both reasons map to the same effect: `git rm <file>` plus commit
`meditate: consume <filename> (<reason>)`. The reason lives only in the
commit message; no audit-trail folder.

Frontmatter on a live illumination: `date` + `description`. No `status:`
field (location is the state). No `dispatched_at`, no `plan_path`. Plan
files no longer carry `illumination_source` either; filename slug
coincidence between illumination and plan is incidental, not relied upon.

The MCP surface (`src/cli/mcp/illumination-server.ts`):

- `list_illuminations()` — no parameters; returns every file in
  `meditations/illuminations/`.
- `write_illumination(date, description, body)` — creates an illumination.
- `consume(filename, reason: "implemented" | "declined")` — deletes +
  commits.

Excised on 2026-04-30 (see `docs/adr/0002-consume-only-illumination-lifecycle.md`):
the `mark_dispatched`, `mark_implemented`, `mark_archived` MCP tools; the
`meditations/archived-illuminations/` and `meditations/implemented-illuminations/`
directories; the `status` parameter on `list_illuminations`; the
`pipelines/illumination-to-implementation/mark-archived.mjs` script; the
dispatch gate path in the illumination-to-implementation pipeline.

### Scenario test

A markdown file (typically under `src/tests/scenarios/` in a target project)
that describes observable behavior of the system from the operator's seat:
command invocations and expected effects. Not executable code; consumed by an
agent — `tmux-tester` — which reads each clause and drives the real CLI/UI to
verify it.

Distinct from **unit tests** and **integration tests** under
`src/cli/tests/` which are vitest-executable. Scenario tests are written for
agents, not humans, and the test-author agent decides whether existing
scenarios cover the just-implemented changes or new ones must be written.

Each scenario file follows a fixed three-section shape:

```markdown
# Scenario: <one-line description>

## Setup
<commands or state required before the action; may be empty>

## Action
<the single command invocation under test>

## Expect
- <observable claim 1 — exit code, file existence, output substring, etc.>
- <observable claim 2>
- ...
```

`tmux-tester` parses each file, drives `## Action`, then checks each `## Expect`
bullet against observed reality. Scenarios are **authoritative**: when a clause
fails, tmux-tester fixes the code, never the scenario.

### Janitor

A scheduled agent (run via `ralph heartbeat` against
`pipelines/janitor/pipeline.dot`) that scans the workspace through a KISS
lens — identifies bloat, YAGNI-violating abstractions, and refactor
opportunities — and writes one illumination per candidate via
`mcp__illumination__write_illumination`. It calls `list_illuminations`
first to avoid duplicate writes for candidates already raised.

Janitor does not consume illuminations, does not flip frontmatter, does
not reconcile lifecycle. Its sole output is new illuminations describing
code-hygiene candidates.

Pre-2026-04-30 the janitor was a lifecycle reconciler that walked
dispatched illuminations and flipped them to implemented when their plans
completed (captured in pre-rewrite commits to `pipelines/janitor/janitor.md`
and the memory entry at `memory/2026-04-25-state-machine-exists-verifier-ignores-it.md`).
That role disappeared with the lifecycle simplification.
