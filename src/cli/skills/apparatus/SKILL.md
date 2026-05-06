---
name: apparatus
description: Use whenever the user mentions apparat pipelines — running, validating, listing, tracing, scheduling (heartbeat), creating/authoring new ones, or scaffolding a project with `apparat init`. Triggers on phrases like "create a new pipeline", "run a pipeline", "validate this pipeline", "apparat init", and on words "apparat", "pipeline", "illumination", "meditate", "janitor".
---

# apparatus skill

apparat is an agentic-loop runner that executes graphs of agents (pipelines, defined as `.dot` files) against a target project. Use this skill when the user wants to run, author, validate, trace, or schedule an apparat pipeline, or scaffold an apparat-shaped project.

## Commands (top-level CLI surface)

| Command | Purpose |
|---|---|
| `apparat init` | Scaffold `.apparat/` + docs in cwd. Idempotent. |
| `apparat <project> [--max N] [--scenarios <path>]` | Run the implement loop (alias for `apparat implement`). |
| `apparat meditate <project> [--var steer=<text>]` | Run a meditate session against the project's stimuli. |
| `apparat pipeline run <name> [--var k=v]... [--resume [runId]]` | Execute a `.dot` pipeline by folder name. |
| `apparat pipeline validate <name>` | Structural + portability check. **Run before every `pipeline run`.** |
| `apparat pipeline list <project>` | List all `.dot` pipelines discoverable in the project. |
| `apparat pipeline trace <runId> [--node-receive <nodeId>] [--full]` | Inspect a past run's context + trace logs. |
| `apparat heartbeat pipeline <name> --project <dir> --every <minutes>` | Schedule a recurring pipeline run. |

When invoking from outside the project directory, pass `--project <folder>`.

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
5. Run `apparat pipeline run <name> --project <project>` to execute.

Step 4 is mandatory before step 5. The validator catches missing `cwd=`, `loop:true` without `done:boolean`, undeclared variables, and portability violations — all common authoring mistakes.

## Stopping a running pipeline

`Ctrl+C` cleanly terminates the apparat process and its claude subprocess. To resume after Ctrl-C, a node failure, or a crash:

```bash
apparat pipeline run <name> --project <project> --resume       # auto-pick if one prior run
apparat pipeline run <name> --project <project> --resume <runId>
```

For `--resume` to work, tool-node scripts must be idempotent.
