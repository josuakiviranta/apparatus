# apparatus — Domain Language

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
(`~/.apparat/agents/`), the bundled-agents dir (`getBundledAgentsDir`), the
`apparat agent list/show` CLI subcommands, and the
`allowBundledFallback`/`RegistryOptions` shape. Stray
`~/.apparat/agents/` files on contributor machines are now inert.

All pipelines live in this repo (`src/cli/pipelines/` for bundled) or in
a target project's `.apparat/pipelines/<name>/` folder. A pipeline is run
against an external target project via `--project <folder>`.

### Agent frontmatter

Required:
- `name:` — agent identifier (matches the `agent="…"` attribute on nodes).
- `description:` — short human-readable summary.
- `model:` — enum `opus | sonnet | haiku`.
- `prompt:` — bare body (markdown after the frontmatter).

Optional:
- `thinking:` — enum `off | low | high` (default `off`). Plumbed via `CLAUDE_THINKING_BUDGET`.
- `permission_mode:`, `tools:`, `mcp:`, `inputs:`, `outputs:`, `loop:`, `maxIterations:`.

The `model:` field is enforced both by the in-code schema in
`src/cli/lib/agent.ts` and by the per-node validator rule `model_required`
(see ADR-0012 amendment 2026-05-14). Agents missing or mis-typing `model:`
fail validation at the node site with `pipeline.dot` source-location.
There is no silent `opus` default.

#### Grounded opening (interactive nodes only)

When a node carries `interactive: true` (or the string `"true"`), the engine
appends a canonical orientation block — `GROUNDED_OPENING_BLOCK`, exported
from `src/attractor/transforms/grounded-opening.ts` — after the steering
section of the assembled prompt. The block requires the agent to restate
every injected value, quote `file:line` for every codebase claim, and open
with three labelled sections (`Here is what I can see / read in the code /
am inferring`) before its first question. The append is triggered by
`isInteractiveAgent(node)` (`src/attractor/core/graph.ts:44`) inside
`buildAgentPrompt` (`src/attractor/handlers/agent-prep.ts:115`); non-
interactive nodes are byte-identical to the pre-append assembled prompt.

The matching .md-side step ("Open with a grounded summary") in each
interactive agent file keeps that file self-documenting when read out of
pipeline context (e.g. `apparat pipeline explain` or direct read).

### Project-local layout

A target project declares itself apparat-shaped by having a `<project>/.apparat/`
folder. That folder is the home for apparat-defined project-local artefacts:

```
.apparat/
├── pipelines/                ← project-local pipelines
├── meditations/
│   ├── illuminations/
│   └── stimuli/
├── sessions/                 ← session-closure files (was memory/)
├── scenarios/                ← smoke-pipeline test fixtures
└── runs/                     ← pipeline run state + checkpoints
```

Pre-existing project-doc conventions stay at repo root, where humans, IDE
doc-outliners, GitHub, and third-party tooling expect them:

```
<repo root>/
├── CONTEXT.md      ← domain language (DDD glossary)
├── VISION.md       ← mission narrative
├── README.md       ← public-facing entry
└── docs/adr/       ← MADR-style decision records
```

Two-tier pipeline read at runtime:
- **Project-local:** `<project>/.apparat/pipelines/<name>/pipeline.dot`
- **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

Stimuli are project-local only. The meditate pipeline reads from
`<project>/.apparat/meditations/stimuli/` exclusively — there is no
bundled fallback. Each project curates its own lens library; an
`apparat init` scaffolds an empty `stimuli/` directory.

See `docs/adr/0007-ralph-folder-as-project-local-home.md` (naming superseded by ADR-0010) and the
partial-revert refinement in `docs/adr/0008-partial-revert-of-ralph-folder.md` (naming superseded by ADR-0010)
for the full layout and partition principle.

### Illumination lifecycle

An illumination has two states by location: **alive** (file exists in
`.apparat/meditations/illuminations/`) or **consumed** (file deleted). There are no
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
  `.apparat/meditations/illuminations/`.
- `write_illumination(date, description, body)` — creates an illumination.
- `consume(filename, reason: "implemented" | "declined")` — deletes +
  commits.

Excised on 2026-04-30 (see `docs/adr/0002-consume-only-illumination-lifecycle.md`):
the `mark_dispatched`, `mark_implemented`, `mark_archived` MCP tools; the
`.apparat/meditations/archived-illuminations/` and `.apparat/meditations/implemented-illuminations/`
directories; the `status` parameter on `list_illuminations`; the
`pipelines/illumination-to-implementation/mark-archived.mjs` script; the
dispatch gate path in the illumination-to-implementation pipeline.

### Harness scenario

A markdown file (typically under `.apparat/scenarios/` in a target project)
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

Co-located under `.apparat/scenarios/` — operator scenarios at root, smoke fixtures in subdirs.

See also: **Smoke-pipeline scenario**.

### Smoke-pipeline scenario

A pipeline-engine test fixture: a `pipeline.dot` plus its agent `.md` files
with apparat-specific frontmatter (`outputs:`, `inputs:`, gate prompts, tool
nodes). Lives at `<repo>/.apparat/scenarios/<name>/`. Consumed by the
`pipeline-smoke-<name>-folder.test.ts` files in `src/cli/tests/` to verify
parser, validator, runtime, and per-folder discovery — the engine's own
test surface, not user-facing operator scenarios.

Renamed from "smoke pipeline" on 2026-05-04 to disambiguate from the
illumination-to-implementation pipeline (production) and to land them
under `.apparat/scenarios/` rather than commingled with `.apparat/pipelines/`
where `pipeline list` would surface them.

See also: **Harness scenario**.

### Session-closure file

A markdown narrative written by the `memory-writer` pipeline node at the
end of each illumination-to-implementation session. Lives at
`<project>/.apparat/sessions/<YYYY-MM-DD>-<slug>.md`. Captures what was
attempted, what shipped, what surprised, and follow-up threads — for
future-Claude reading on later sessions.

Renamed from "memory" on 2026-05-04 (see ADR-0008): "memory" was
overloaded across Claude Code's auto-memory feature, ADR-0007's empty
`.apparat/memory/` slot, and these closure files. "Session-closure file"
names what the artefact actually is.

### Ceremony

**Ceremony** — `SessionStart:startup` hook payloads (`hook_started` / `hook_response` envelopes), `rate_limit_event` frames, `additional_context` skill-prelude bodies, and assistant-side `tool_result` echoes that the Claude Code subprocess emits in every invocation. Filtered from trace renderers by default (`apparat pipeline trace <runId>`, `apparat status … <runId>`) since their primary consumer is Claude in agent context and ceremony costs token budget without diagnostic value. Preserved verbatim on disk (`raw-attempt-N.txt`) for forensic reads when SessionStart itself misfires. Pass `--full` to disable the filter. See [ADR-0019](docs/adr/0019-trace-renderer-default-clean.md).

### Project-local artefact

A file or directory that meets BOTH clauses of the §1.2 partition principle
(see ADR-0008):

- **Clause A — apparat-defined.** Format, lifecycle, or discovery semantics
  specified by apparatus (illumination YAML schema, `.dot` files with apparat
  attributes, run-state checkpoint format, etc.).
- **Clause B — no pre-existing root convention.** No widely-adopted
  ecosystem convention places the file at repo root.

Both clauses are required. Project-local artefacts live in
`<project>/.apparat/`. Pre-existing project-doc conventions (CONTEXT.md,
VISION.md, docs/adr/, README.md) stay at repo root. See
`docs/adr/0007-ralph-folder-as-project-local-home.md` (naming superseded by ADR-0010) and
`docs/adr/0008-partial-revert-of-ralph-folder.md` (naming superseded by ADR-0010).

### Janitor

A scheduled agent (run via `apparat heartbeat` against
`src/cli/pipelines/janitor/pipeline.dot`) that scans the workspace through a KISS
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

- `apparat heartbeat meditate` — **Removed 2026-05-06.** The bespoke heartbeat subcommand existed only because the bundled meditate pipeline could not run unattended. The pipeline now self-acquires `vision` via a `read_vision` tool node. Use `apparat heartbeat pipeline meditate --project <folder> --every <n>` instead.

### Parallel-implementation pipeline

`.apparat/pipelines/parallel-illumination-to-implementation/` is the parallel-implementation analogue of `illumination-to-implementation`. Same head (verifier + chat refinement loop + approval gate + design_writer + plan_writer) and same tail (tmux_tester + tmux_confirm_gate + memory_writer + memory_reflector); the linear `implement` node in the middle is replaced by a three-node parallel chain. Validates the mechanism end-to-end against real illuminations; once stable, the parallel-impl nodes collapse into `illumination-to-implementation` directly and this folder retires. Five pieces of vocabulary apply to it:

- **plan_writer** — opus subagent in the parallel-implementation head. Authors a chunked plan from the approved design doc, grounding file paths via Glob and propagating cross-chunk shape-consumer overlaps via Grep: when a chunk creates / renames / deletes / signature-changes an exported symbol, `plan_writer` Greps importers of the file path and symbol name across `$project` and adds every match landing in another chunk's target file to that chunk's `- Modify:` declaration, emitting a `plan_writer.under_declared_shape_consumer_suspected: c<n> -> <path>` text line in its response so the trace records the detection. Covers shape changes only (type, interface, function signature, constant, schema export, CSS class); explicitly does not promise to surface behavior-only edits with stable signatures, cross-language consumers, runtime-ordering deps, test-state fixture races, dynamic-import string references, or codegen consumers.
- **plan_scheduler** — single-pass agent. Parses a chunked plan, computes a topological DAG over chunks by file-overlap, emits `<plan_path>.dag.json`. Read-only on source code; writes only `dag.json` and an append to `.gitignore`.
- **batch_orchestrator** — deep-loop agent. Drives one batch of parallel chunk implementation per iteration. Sole writer of `dag.json` and sole owner of `git merge` into the main worktree. Dispatches per-chunk subagents into freshly-created git worktrees; gates batch acceptance on a single project-wide test run.
- **merge_resolver** — deep-loop agent. Resolves one conflicted chunk per iteration by re-creating the conflict on disk and dispatching a Sonnet subagent. Caps at 3 resolution attempts per chunk before surfacing to the user.
- **dag.json** — JSON file at `<plan_path>.dag.json` recording the topological DAG over a chunked plan. Written by `plan_scheduler`; mutated by `batch_orchestrator` and `merge_resolver`. Not committed (the scheduler appends it to `.gitignore` on first write). Schema in `src/cli/lib/dag-schema.ts`.

### Documentation channels

apparatus has three documentation channels with disjoint roles:

- **`CONTEXT.md` (this file)** — domain language and glossary. Hand-curated.
  Updated during grill-with-docs sessions and ADR writes. Stable.
- **`docs/adr/`** — append-only decision records. Each captures a hard-to-reverse
  or surprising-without-context choice with its trade-off. Never edited after
  acceptance.
- **`src/` and `pipelines/`** — the authoritative description of behavior.
  Source code is truth. No spec file claims to mirror it.

Removed on 2026-05-01: `docs/specs/` (behavioral specs that drifted faster than
they could be maintained) and `docs/orientation/directory-inventory.md` (a
curated file-tree summary that drifted on every reorg). See
`docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md`.

Agents needing workspace orientation discover the project layout at runtime
(Glob source/docs roots) and read `CONTEXT.md` + `docs/adr/` + `README.md` +
a live `src/` inventory. No preloaded curated overview.

### Operator-global tier — `~/.apparat/`

apparat persists state at two tiers, mirroring ADR-0008's partition principle one
level up:

- **Project-local** — `<project>/.apparat/`: pipelines, agents, run traces, run
  checkpoints. Owned by the project's repo. One folder per project.
- **Operator-global** — `~/.apparat/`: orchestration state across all projects on
  this machine. Contents:
  - `tasks.json` — daemon-scheduled heartbeat tasks
  - `pids/` — running session PID files
  - `logs/<taskId>/<runId>.log` — daemon-authored orchestration breadcrumbs
    (start, end, exit code, cross-link to the project-local engine trace)
  - `projects.json` — index of project paths the operator has invoked apparat
    against, with `lastSeen` timestamps. Read by `apparat status`. Best-effort
    write per `--project`-resolving CLI invocation.

`~/.apparat/` is operator-state only. Agent definitions remain project-local
per ADR-0001. Tests and embed callers pin `~/.apparat/` via the `APPARAT_HOME`
env-var (highest precedence in `getApparatHome()`); the operator's `HOME`
should never be swapped for this purpose — that pattern caused a 213-entry
registry leak in 2026-05-09.

---

ADR-0007 (`.apparat/` as project-local home) is partly superseded by
ADR-0008 (partial revert + partition principle). See
`docs/adr/0008-partial-revert-of-ralph-folder.md`. ADR-0007 + ADR-0008 are partly superseded by ADR-0010 (naming-only).
