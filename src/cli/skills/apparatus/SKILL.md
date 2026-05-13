---
name: apparatus
description: Use whenever the user mentions apparat pipelines — running, validating, tracing, scheduling (heartbeat), creating/authoring new ones, or scaffolding a project with `apparat init`. Triggers on phrases like "create a new pipeline", "run a pipeline", "validate this pipeline", "apparat init", and on words "apparat", "pipeline", "illumination", "meditate", "janitor".
---

# apparatus skill

apparat is an agentic-loop runner that executes graphs of agents (pipelines, defined as `.dot` files) against a target project. Use this skill when the user wants to run, author, validate, trace, or schedule an apparat pipeline, or scaffold an apparat-shaped project.

## Commands (top-level CLI surface)

| Command | Purpose |
|---|---|
| `apparat init` | Scaffold `.apparat/` + docs in cwd. Idempotent. |
| `apparat implement <project>` | Run the implement loop. |
| `apparat meditate <project> [--steer <text>]` | Run a meditate session against the project's stimuli. |
| `apparat pipeline run <name> [project] [--var k=v]... [--resume [runId]]` | Execute a pipeline by folder name; pass the target project as the second positional. |
| `apparat pipeline validate <name>` | Structural + portability check. **Run before every `pipeline run`.** |
| `apparat pipeline show <name> [--no-open]` | Render the pipeline as SVG next to the source `.dot` and auto-open it in your OS default viewer; pass `--no-open` to skip. |
| `apparat pipeline trace <runId> [--node-receive <nodeReceiveId>] [--full]` | Inspect a past run's context + trace logs. |
| `apparat pipeline explain <name> [nodeId]` | Plain-text topology walkthrough; with `nodeId`, render the agent's prompt skeleton (placeholders, no LLM). |
| `apparat status [project] [pipeline] [runId]` | Mission control — zoom by appending tokens. |
| `apparat heartbeat pipeline <name> --project <dir> --every <minutes>` | Schedule a recurring pipeline run. |

When invoking from outside the project directory, pass the project folder as the second positional arg to `pipeline run`.

## Project shape

A project is "apparat-shaped" when it has a `.apparat/` folder at root:

```
<project>/
├── .apparat/
│   ├── pipelines/<name>/      ← project-local pipelines (pipeline.dot + sibling .md / .mjs)
│   ├── meditations/
│   │   ├── illuminations/     ← live illumination markdown files
│   │   └── stimuli/           ← meditation lenses
│   ├── sessions/              ← session-closure files
│   └── runs/<runId>/          ← checkpoint + pipeline.jsonl trace (gitignored)
├── CONTEXT.md                 ← domain glossary
├── VISION.md
├── README.md
└── docs/adr/                  ← decision records
```

## Preflight discipline

Every command that writes durable side-effects to a `<project>` path must
**orient before writing**:

1. Refuse paths that are not apparat-shaped. Hard-refuse paths whose basename
   is `.apparat` (a typo or autocomplete slip pointed you at the project's
   internal folder).
2. Require at least one shape signal at the path: `VISION.md`, `CONTEXT.md`,
   `.apparat/`, or `.git/`. Otherwise refuse with "did you mean its parent?".
3. Sweep stale run folders (`<project>/.apparat/runs/<runId>/` with heartbeat
   ≥ 5 min old) before writing new scratch. See ADR-0016.

The helper for steps 1+2 is `assertApparatShape(absPath)` from
`src/cli/lib/pipeline-bootstrap.ts`. Import it; do not re-derive the predicate.

The helper for step 3 is `gcStaleRuns(projectFolder)` from the same module.
It is already called inside `Agent.run`, so any command that spawns an agent
cooperates with the sweep automatically; commands that write scratch outside
the agent path (rare) should call it explicitly.

## Authoring or modifying pipelines — read the live reference FIRST

The deep authoring reference (DSL syntax, frontmatter schemas, validator rules, worked examples) lives **inside the installed `apparat-cli` npm package** so it always matches the user's pinned CLI version. **Do not skip this step** — pipeline syntax is strict and the validator will reject malformed graphs.

Resolve the path and read it before writing or editing any `.dot` or sibling agent `.md` file:

```bash
# 1. Resolve the npm global root (works for npm; pnpm/yarn report differently)
npm root -g
# → e.g. /Users/josu/.npm-global/lib/node_modules
```

Then use the `Read` tool on:

```
<npmRoot>/apparat-cli/dist/skills/apparatus/pipelines.md
```

If `npm root -g` does not contain `apparat-cli`, the user has a per-project install — try `node_modules/apparat-cli/dist/skills/apparatus/pipelines.md` relative to the project root instead.

## Required workflow when authoring a new pipeline

1. Read `pipelines.md` (live reference, see above).
2. Create folder `<project>/.apparat/pipelines/<name>/`.
3. Write `pipeline.dot` plus sibling agent `.md` / gate `.md` / script files.
4. Run `apparat pipeline validate <name>` until it reports no errors.
5. Run `apparat pipeline run <name> <project>` to execute.

Step 4 is mandatory before step 5. The validator catches missing `cwd=`, `loop:true` without `done:boolean`, undeclared variables, and portability violations — all common authoring mistakes.

## Choosing model + thinking

Every agent must declare both axes in frontmatter. Pick by job, not by inertia.

**Principle.** opus = decide / design / verify under ambiguity; sonnet = summarise /
transform / format / mechanical glue; thinking = on only when the agent must reason
under ambiguity, off for procedure.

| Tier | Use for | Example agents |
|---|---|---|
| `opus + thinking: high` | Decide / design / verify under ambiguity | verifier, design-writer, plan-writer, change-explainer, implement, memory-reflector, grill |
| `opus + thinking: off` | Procedure under opus reasoning (mechanical orchestration over many nodes) | tmux-tester, merge_resolver, batch_orchestrator, plan-scheduler |
| `sonnet + thinking: off` | Summarise / transform / format / mechanical glue | task, chat-refiner, chat-summarizer, memory-writer, slice_to_issues, implement_from_issues, write_prd, meditate, all gates |

### Example frontmatter per tier

```yaml
# opus + think:high — deep judgement
---
name: verifier
description: Verifies illumination is implementable
model: opus
thinking: high
permission_mode: dangerouslySkipPermissions
inputs: []
outputs:
  preferred_label: boolean
  summary: string
---
```

```yaml
# sonnet + think:off — mechanical transform
---
name: chat-summarizer
description: Summarises the interactive turn for downstream context
model: sonnet
thinking: off
permission_mode: dangerouslySkipPermissions
inputs: [chat.output]
outputs:
  refinements: string
---
```

If a node tiered to `sonnet` regresses on output quality, flip just that one to `opus` and note the exception in a comment — explicit per-node choice makes exceptions cheap to record and review.

## Stopping a running pipeline

`Ctrl+C` cleanly terminates the apparat process and its claude subprocess. To resume after Ctrl-C, a node failure, or a crash:

```bash
apparat pipeline run <name> <project> --resume       # auto-pick if one prior run
apparat pipeline run <name> <project> --resume <runId>
```

For `--resume` to work, tool-node scripts must be idempotent.
